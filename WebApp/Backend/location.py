import asyncio
import copy
import json
import math
import os
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import cv2 as cv
import numpy as np
import serial
import websockets

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GAME_SETTINGS_PATH = os.path.join(SCRIPT_DIR, "game_settings.json")
CALIBRATION_PATH = os.path.join(SCRIPT_DIR, "calibration.json")

CORNER_KEYS = ("top_left", "top_right", "bottom_right", "bottom_left")
MIN_CORNER_AREA = 1000

DEFAULT_GAME_SETTINGS = {
    "damage": {
        "rangePiezoIr": 5,
        "rangeHumidity": 5,
        "tankLaser": 10,
        "tankLaserGrid": 3,
        "tankIr": 2,
        "piezoHitThreshold": 200,
        "damageDebounceMs": 400,
        "hallFreezeThreshold": 100,
        "tankFreezeDurationMs": 10000,
    },
    "powers": {
        "fan": {"activeMs": 5000, "cooldownMs": 10000},
        "laser": {"activeMs": 5000, "cooldownMs": 10000},
        "humidifier": {"activeMs": 5000, "cooldownMs": 10000},
        "hammer": {"activeMs": 1500, "cooldownMs": 1500},
        "dodge": {"activeMs": 3000, "cooldownMs": 5000},
    },
    "camera": {"url": "http://10.18.205.90:8080/video"},
}

SERIAL_PORT = "COM14"
BAUD_RATE = 115200
CAMERA_INDEX =0
FRAME_SIZE = 720
MIN_CONTOUR_AREA = 400
TRACK_MAX_DIST_PX = 150

# MPU pursuit tuning
REACH_MARGIN_PX = 10
TURN_DEADBAND_DEG = 18
FORWARD_MAX_ERROR_DEGREES = 90
MPU_SIGN = 1  # flip to -1 if MPU rotation direction is inverted
DEBUG_IGNORE_DEATH = False  # set True in debug to keep chasing after a bot dies
# Drive char used to advance toward red; change to b"s" ONLY if w drives backward.
APPROACH_DRIVE = b"s"
WS_HOST = "127.0.0.1"
WS_PORT = 8765
CAMERA_PROXY_PORT = 8766
OPEN_TIMEOUT_MS = 5000
READ_TIMEOUT_MS = 5000
CAMERA_OPEN_TIMEOUT_S = 6.0

# BattleGroundv2.ino serial strings when relays energize
RELAY_LINE_TO_POWER = {
    "Fan relay activated": "fan",
    "Laser relay activated": "laser",
    "Humidifier relay activated": "humidifier",
    "Hammer relay activated": "hammer",
}

outbound_queue: queue.Queue[str | None] = queue.Queue()
inbound_queue: queue.Queue[str] = queue.Queue()
serial_buffer = ""
game_settings = copy.deepcopy(DEFAULT_GAME_SETTINGS)
latest_jpeg_frame: bytes | None = None
jpeg_lock = threading.Lock()

DEFAULT_CALIBRATION = {
    "corners": {},
    "homography": None,
}


def corner_dst_points() -> np.ndarray:
    size = FRAME_SIZE - 1
    return np.array(
        [
            [0, 0],
            [size, 0],
            [size, size],
            [0, size],
        ],
        dtype=np.float32,
    )


def corners_valid(corners: dict) -> bool:
    """Reject missing, out-of-bounds, duplicate, or near-degenerate corner sets."""
    if not all(key in corners for key in CORNER_KEYS):
        return False

    points = []
    for key in CORNER_KEYS:
        corner = corners.get(key) or {}
        x = corner.get("x")
        y = corner.get("y")
        if x is None or y is None:
            return False
        if not (0 <= float(x) < FRAME_SIZE and 0 <= float(y) < FRAME_SIZE):
            return False
        points.append((float(x), float(y)))

    if len(set(points)) < 4:
        return False

    src = np.array(points, dtype=np.float32).reshape(-1, 1, 2)
    area = abs(float(cv.contourArea(src)))
    return area >= MIN_CORNER_AREA


def homography_matrix_valid(matrix: np.ndarray | None) -> bool:
    if matrix is None:
        return False
    if not np.all(np.isfinite(matrix)):
        return False
    return abs(float(np.linalg.det(matrix))) >= 1e-6


def sanitize_calibration(calibration: dict) -> dict:
    """Drop invalid saved corners/homography so the raw camera feed always works."""
    sanitized = copy.deepcopy(calibration)
    corners = sanitized.get("corners") or {}
    if not isinstance(corners, dict) or not corners_valid(corners):
        sanitized["corners"] = {}
        sanitized["homography"] = None
        return sanitized

    if sanitized.get("homography") is not None:
        try:
            matrix = np.array(sanitized["homography"], dtype=np.float32)
            if not homography_matrix_valid(matrix):
                sanitized["homography"] = None
        except Exception:
            sanitized["homography"] = None

    return sanitized


def load_calibration() -> dict:
    if os.path.exists(CALIBRATION_PATH):
        try:
            with open(CALIBRATION_PATH, encoding="utf-8") as calibration_file:
                data = json.load(calibration_file)
                merged = copy.deepcopy(DEFAULT_CALIBRATION)
                if isinstance(data.get("corners"), dict):
                    merged["corners"] = data["corners"]
                if data.get("homography") is not None:
                    merged["homography"] = data["homography"]
                sanitized = sanitize_calibration(merged)
                if sanitized != merged:
                    print("Discarded invalid calibration data from disk")
                return sanitized
        except Exception as error:
            print(f"Failed to load calibration: {error}")
    return copy.deepcopy(DEFAULT_CALIBRATION)


def save_calibration(calibration: dict) -> None:
    try:
        with open(CALIBRATION_PATH, "w", encoding="utf-8") as calibration_file:
            json.dump(calibration, calibration_file, indent=2)
            calibration_file.write("\n")
    except Exception as error:
        print(f"Failed to save calibration: {error}")


def homography_from_calibration(calibration: dict) -> np.ndarray | None:
    corners = calibration.get("corners") or {}
    if not corners_valid(corners):
        return None

    src = np.array(
        [
            [corners["top_left"]["x"], corners["top_left"]["y"]],
            [corners["top_right"]["x"], corners["top_right"]["y"]],
            [corners["bottom_right"]["x"], corners["bottom_right"]["y"]],
            [corners["bottom_left"]["x"], corners["bottom_left"]["y"]],
        ],
        dtype=np.float32,
    )
    matrix = cv.getPerspectiveTransform(src, corner_dst_points())
    if not homography_matrix_valid(matrix):
        return None
    return matrix


def transform_point(homography: np.ndarray | None, x: float, y: float) -> tuple[float, float]:
    if homography is None:
        return x, y
    point = np.array([[[float(x), float(y)]]], dtype=np.float32)
    transformed = cv.perspectiveTransform(point, homography)
    return float(transformed[0, 0, 0]), float(transformed[0, 0, 1])


def calibration_status_payload(calibration: dict, calibration_mode: bool) -> dict:
    corners = calibration.get("corners") or {}
    homography_ready = calibration.get("homography") is not None and corners_valid(corners)
    return {
        "type": "CALIBRATION_STATUS",
        "calibration_mode": calibration_mode,
        "color_calibrated": True,
        "corners": {key: key in corners for key in CORNER_KEYS},
        "homography_ready": homography_ready,
    }


def merge_game_settings(partial: dict | None) -> dict:
    if not partial:
        return copy.deepcopy(DEFAULT_GAME_SETTINGS)

    merged = copy.deepcopy(DEFAULT_GAME_SETTINGS)
    if "damage" in partial:
        merged["damage"].update(partial["damage"])
    if "powers" in partial:
        for power_id, values in partial["powers"].items():
            if power_id in merged["powers"] and isinstance(values, dict):
                merged["powers"][power_id].update(values)
    if "camera" in partial and isinstance(partial["camera"], dict):
        merged["camera"].update(partial["camera"])
    return merged


def normalize_camera_url(url: str) -> str:
    normalized = (url or "").strip()
    if not normalized:
        return DEFAULT_GAME_SETTINGS["camera"]["url"]
    if not normalized.startswith(("http://", "https://")):
        normalized = f"http://{normalized}"
    parsed = urlparse(normalized)
    if not parsed.path or parsed.path == "/":
        normalized = normalized.rstrip("/") + "/video"
    return normalized


def get_camera_url(settings: dict | None = None) -> str:
    merged = merge_game_settings(settings or game_settings)
    return normalize_camera_url(merged["camera"]["url"])


def load_game_settings() -> dict:
    global game_settings
    if os.path.exists(GAME_SETTINGS_PATH):
        try:
            with open(GAME_SETTINGS_PATH, encoding="utf-8") as settings_file:
                game_settings = merge_game_settings(json.load(settings_file))
                print(f"Loaded game settings from {GAME_SETTINGS_PATH}")
                return game_settings
        except Exception as error:
            print(f"Failed to load game settings: {error}")
    game_settings = copy.deepcopy(DEFAULT_GAME_SETTINGS)
    save_game_settings(game_settings)
    return game_settings


def save_game_settings(settings: dict) -> None:
    try:
        with open(GAME_SETTINGS_PATH, "w", encoding="utf-8") as settings_file:
            json.dump(settings, settings_file, indent=2)
            settings_file.write("\n")
    except Exception as error:
        print(f"Failed to save game settings: {error}")


def to_firmware_settings(settings: dict) -> dict:
    """Compact keys keep the serial JSON under the ESP32 RX buffer limit (~256 bytes)."""
    merged = merge_game_settings(settings)
    powers = merged["powers"]
    damage = merged["damage"]
    return {
        "SETTINGS": True,
        "rPi": damage["rangePiezoIr"],
        "rHum": damage["rangeHumidity"],
        "tLas": damage["tankLaser"],
        "tLG": damage["tankLaserGrid"],
        "tIr": damage["tankIr"],
        "pTh": damage["piezoHitThreshold"],
        "dDb": damage["damageDebounceMs"],
        "fanM": powers["fan"]["activeMs"],
        "lasM": powers["laser"]["activeMs"],
        "humM": powers["humidifier"]["activeMs"],
        "fanC": powers["fan"]["cooldownMs"],
        "lasC": powers["laser"]["cooldownMs"],
        "hmrM": powers["hammer"]["activeMs"],
        "hmrC": powers["hammer"]["cooldownMs"],
    }


def broadcast_game_settings(settings: dict | None = None) -> None:
    payload = {
        "type": "GAME_SETTINGS",
        "settings": settings if settings is not None else game_settings,
    }
    ws_broadcast(payload)


def ws_broadcast(payload: dict) -> None:
    outbound_queue.put(json.dumps(payload))


async def _ws_broadcast_loop(clients: set) -> None:
    while True:
        await asyncio.sleep(0.01)
        while True:
            try:
                message = outbound_queue.get_nowait()
            except queue.Empty:
                break
            if message is None:
                return
            dead = []
            for client in list(clients):
                try:
                    await client.send(message)
                except Exception:
                    dead.append(client)
            for client in dead:
                clients.discard(client)


async def _ws_server(clients: set) -> None:
    async def handler(websocket):
        clients.add(websocket)
        print("WebSocket client connected")
        try:
            await websocket.send(
                json.dumps({"type": "GAME_SETTINGS", "settings": game_settings})
            )
            calibration = load_calibration()
            await websocket.send(
                json.dumps(calibration_status_payload(calibration, False))
            )
            async for message in websocket:
                inbound_queue.put(message)
        finally:
            clients.discard(websocket)
            print("WebSocket client disconnected")

    broadcaster = asyncio.create_task(_ws_broadcast_loop(clients))
    async with websockets.serve(handler, WS_HOST, WS_PORT):
        print(f"WebSocket server listening on ws://{WS_HOST}:{WS_PORT}")
        await asyncio.Future()


def start_websocket_server() -> None:
    clients: set = set()

    def run():
        asyncio.run(_ws_server(clients))

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    time.sleep(0.3)


def open_serial():
    try:
        connection = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=0.01)
        time.sleep(2)
        print(f"Connected to {SERIAL_PORT}")
        return connection
    except Exception as error:
        print(f"Serial Error: {error}")
        return None


def send_serial_json(connection, payload: dict) -> None:
    if connection is None:
        return
    try:
        line = json.dumps(payload, separators=(",", ":")) + "\n"
        connection.write(line.encode())
    except Exception as error:
        print(f"Serial write error: {error}")


def process_serial_line(line: str, current_heading: float, state: dict) -> float:
    """Parse ESP serial; broadcast telemetry and relay events. Returns updated heading."""
    if not line:
        return current_heading

    for pattern, power_id in RELAY_LINE_TO_POWER.items():
        if pattern in line:
            print(f"Relay event -> {power_id}")
            ws_broadcast({"power_activated": power_id})
            return current_heading

    if not line.startswith("{"):
        return current_heading

    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        return current_heading

    heading = data.get("m1", current_heading)
    telemetry = {
        "m1": data.get("m1", 0),
        "d1": 1 if data.get("d1") else 0,
        "ir1": 1 if data.get("ir1") else 0,
        "ir2": 1 if data.get("ir2") else 0,
        "hall": data.get("hall", 9999),
    }
    if "rangeHealth" in data:
        telemetry["rangeHealth"] = data["rangeHealth"]
        state["rangeHealth"] = data["rangeHealth"]
    if "tankHealth" in data:
        telemetry["tankHealth"] = data["tankHealth"]
        state["tankHealth"] = data["tankHealth"]
    if "debugDamage" in data:
        telemetry["debugDamage"] = data["debugDamage"]

    if "isAutomatedMode" in data:
        telemetry["isAutomatedMode"] = data["isAutomatedMode"]
        state["isAutomatedMode"] = data["isAutomatedMode"]
    if "gameActive" in data:
        telemetry["gameActive"] = data["gameActive"]
        state["gameActive"] = data["gameActive"]
    if "testMode" in data:
        telemetry["testMode"] = data["testMode"]
        state["testMode"] = data["testMode"]

    ws_broadcast(telemetry)
    print("ESP telemetry:", telemetry)
    return heading


def drain_serial(connection, current_heading: float, state: dict) -> float:
    global serial_buffer
    if connection is None or not connection.in_waiting:
        return current_heading

    try:
        new_data = connection.read(connection.in_waiting).decode(errors="ignore")
        serial_buffer += new_data
    except Exception as e:
        print(f"Serial read error: {e}")
        return current_heading

    heading = current_heading
    while "\n" in serial_buffer:
        line, serial_buffer = serial_buffer.split("\n", 1)
        line = line.strip()
        if line:
            heading = process_serial_line(line, heading, state)

    return heading


def find_tracked_marker(mask, last_pos=None, max_dist=TRACK_MAX_DIST_PX):
    contours, _ = cv.findContours(mask, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    candidates = []
    for contour in contours:
        area = cv.contourArea(contour)
        if area <= MIN_CONTOUR_AREA:
            continue
        (x, y), radius = cv.minEnclosingCircle(contour)
        candidates.append((int(x), int(y), int(radius), area))

    if not candidates:
        return None

    if last_pos is not None:
        lx, ly = last_pos
        closest = min(
            candidates,
            key=lambda marker: math.hypot(marker[0] - lx, marker[1] - ly),
        )
        dist = math.hypot(closest[0] - lx, closest[1] - ly)
        if dist <= max_dist:
            return closest[:3]

    largest = max(candidates, key=lambda marker: marker[3])
    return largest[:3]


class CameraProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/video":
            self.send_error(404)
            return

        self.send_response(200)
        self.send_header(
            "Content-Type", "multipart/x-mixed-replace; boundary=frame"
        )
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        try:
            while True:
                with jpeg_lock:
                    frame = latest_jpeg_frame
                if frame is not None:
                    self.wfile.write(b"--frame\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n\r\n")
                    self.wfile.write(frame)
                    self.wfile.write(b"\r\n")
                    self.wfile.flush()
                time.sleep(0.033)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def log_message(self, format, *args):
        pass


def start_camera_proxy_server() -> None:
    def run():
        server = ThreadingHTTPServer(
            (WS_HOST, CAMERA_PROXY_PORT), CameraProxyHandler
        )
        print(
            f"Camera proxy listening on http://{WS_HOST}:{CAMERA_PROXY_PORT}/video"
        )
        server.serve_forever()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    time.sleep(0.1)


def update_proxy_frame(frame) -> None:
    global latest_jpeg_frame
    ok, jpeg = cv.imencode(".jpg", frame, [cv.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return
    with jpeg_lock:
        latest_jpeg_frame = jpeg.tobytes()


def send_stop(connection):
    if connection is None:
        return

    try:
        connection.write(b"x")
        connection.write(b"x")
    except Exception:
        pass


class RealTimeIPCamera:
    """Background reader that keeps only the newest IP stream frame."""

    def __init__(self, url, frame_size):
        self.cap = cv.VideoCapture(url, cv.CAP_ANY)
        self.cap.set(cv.CAP_PROP_OPEN_TIMEOUT_MSEC, OPEN_TIMEOUT_MS)
        self.cap.set(cv.CAP_PROP_READ_TIMEOUT_MSEC, READ_TIMEOUT_MS)
        self.cap.set(cv.CAP_PROP_FRAME_WIDTH, frame_size)
        self.cap.set(cv.CAP_PROP_FRAME_HEIGHT, frame_size)
        self.cap.set(cv.CAP_PROP_BUFFERSIZE, 1)

        self.ret, self.frame = self.cap.read()
        self.stopped = False
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self.update, daemon=True)
        self.thread.start()
        return self

    def update(self):
        while not self.stopped:
            self.ret, self.frame = self.cap.read()
        self.cap.release()

    def read(self):
        return self.ret, self.frame

    def release(self):
        self.stopped = True
        if self.thread is not None and self.thread.is_alive():
            self.thread.join(timeout=1.0)

    def get(self, prop_id):
        return self.cap.get(prop_id)


def open_ip_camera(camera_url: str) -> RealTimeIPCamera | None:
    """Open an IP camera stream; returns None if the URL is unreachable."""
    camera_url = normalize_camera_url(camera_url)
    result: dict = {"cap": None, "error": None}

    def _open():
        try:
            result["cap"] = RealTimeIPCamera(camera_url, FRAME_SIZE)
        except Exception as error:
            result["error"] = error

    thread = threading.Thread(target=_open, daemon=True)
    thread.start()
    thread.join(timeout=CAMERA_OPEN_TIMEOUT_S)
    if thread.is_alive():
        print(f"Camera open timed out: {camera_url}")
        return None

    if result["error"] is not None:
        print(f"Camera open error ({camera_url}): {result['error']}")
        return None

    cap = result["cap"]
    if cap is None:
        return None

    try:
        if not cap.ret:
            try:
                cap.cap.release()
            except Exception:
                pass
            print(f"Camera failed to open: {camera_url}")
            return None
        cap.start()
        width = int(cap.get(cv.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv.CAP_PROP_FRAME_HEIGHT))
        print(f"Camera: {camera_url}")
        print(f"Actual resolution: {width}x{height}")
        return cap
    except Exception as error:
        print(f"Camera open error ({camera_url}): {error}")
        return None


def open_camera(preferred_index, frame_size):
    """Try CAP_DSHOW and default backend; indices preferred then 0,1,2. Warm-up reads."""
    backends = [(cv.CAP_DSHOW, "CAP_DSHOW"), (cv.CAP_ANY, "CAP_ANY")]
    indices = [preferred_index] + [i for i in (0, 1, 2) if i != preferred_index]

    for index in indices:
        for backend, backend_name in backends:
            cap = cv.VideoCapture(index, backend)
            cap.set(cv.CAP_PROP_FRAME_WIDTH, frame_size)
            cap.set(cv.CAP_PROP_FRAME_HEIGHT, frame_size)

            if not cap.isOpened():
                cap.release()
                continue

            for _ in range(10):
                cap.read()

            ret, frame = cap.read()
            if (
                ret
                and frame is not None
                and len(frame.shape) >= 2
                and frame.shape[0] > 0
                and frame.shape[1] > 0
            ):
                return cap, index, backend_name

            cap.release()

    return None, None, None


def broadcast_positions(blue_marker, red_marker, calib_marker=None, homography=None):
    payload = {}
    if blue_marker is not None:
        bx, by, _ = blue_marker
        bx, by = transform_point(homography, bx, by)
        payload["blue_x"] = int(round(bx))
        payload["blue_y"] = int(round(by))
    if red_marker is not None:
        rx, ry, _ = red_marker
        rx, ry = transform_point(homography, rx, ry)
        payload["red_x"] = int(round(rx))
        payload["red_y"] = int(round(ry))
    if calib_marker is not None:
        cx, cy, _ = calib_marker
        cx, cy = transform_point(homography, cx, cy)
        payload["calib_x"] = int(round(cx))
        payload["calib_y"] = int(round(cy))
    if payload:
        ws_broadcast(payload)


def handle_calibration_message(
    msg: dict,
    calibration: dict,
    calibration_mode: bool,
    target_marker,
) -> tuple[dict, bool, np.ndarray | None]:
    """Process calibration WS messages. Returns (calibration, calibration_mode, homography)."""
    msg_type = msg.get("type")
    homography = homography_from_calibration(calibration)

    if msg_type == "SET_CALIBRATION_MODE":
        calibration_mode = bool(msg.get("enabled", False))
        print(f"Calibration mode: {calibration_mode}")
        ws_broadcast(calibration_status_payload(calibration, calibration_mode))
        return calibration, calibration_mode, homography

    if msg_type == "CALIBRATE_POINT":
        corner = msg.get("corner")
        if corner not in CORNER_KEYS:
            ws_broadcast(
                {
                    "type": "CALIBRATION_ERROR",
                    "message": f"Invalid corner: {corner}",
                }
            )
            return calibration, calibration_mode, homography

        if target_marker is None:
            ws_broadcast(
                {
                    "type": "CALIBRATION_ERROR",
                    "message": "Target (range bot) not detected — place it in view and try again",
                }
            )
            return calibration, calibration_mode, homography

        cx, cy, _ = target_marker
        calibration.setdefault("corners", {})[corner] = {"x": cx, "y": cy}
        save_calibration(calibration)
        print(f"Captured corner {corner} from target at ({cx}, {cy})")
        ws_broadcast(
            {
                "type": "CALIBRATION_POINT_CAPTURED",
                "corner": corner,
                "x": cx,
                "y": cy,
            }
        )
        ws_broadcast(calibration_status_payload(calibration, calibration_mode))
        return calibration, calibration_mode, homography

    if msg_type == "CALIBRATE_FINISH":
        corners = calibration.get("corners") or {}
        missing = [key for key in CORNER_KEYS if key not in corners]
        if missing:
            ws_broadcast(
                {
                    "type": "CALIBRATION_ERROR",
                    "message": f"Missing corners: {', '.join(missing)}",
                }
            )
            return calibration, calibration_mode, homography

        if not corners_valid(corners):
            ws_broadcast(
                {
                    "type": "CALIBRATION_ERROR",
                    "message": "Invalid corners — points must be distinct and within the camera frame",
                }
            )
            return calibration, calibration_mode, homography

        matrix = homography_from_calibration(calibration)
        if matrix is None or not homography_matrix_valid(matrix):
            ws_broadcast(
                {
                    "type": "CALIBRATION_ERROR",
                    "message": "Failed to compute a valid perspective transform",
                }
            )
            return calibration, calibration_mode, homography

        calibration["homography"] = matrix.tolist()
        save_calibration(calibration)
        calibration_mode = False
        homography = matrix
        print("Calibration finished — homography saved")
        ws_broadcast({"type": "CALIBRATION_FINISHED"})
        ws_broadcast(calibration_status_payload(calibration, calibration_mode))
        return calibration, calibration_mode, homography

    if msg_type == "CALIBRATE_RESET":
        calibration = copy.deepcopy(DEFAULT_CALIBRATION)
        save_calibration(calibration)
        homography = None
        print("Calibration reset")
        ws_broadcast({"type": "CALIBRATION_RESET"})
        ws_broadcast(calibration_status_payload(calibration, calibration_mode))
        return calibration, calibration_mode, homography

    return calibration, calibration_mode, homography


def apply_game_settings_update(msg: dict, ser) -> None:
    global game_settings
    incoming = msg.get("settings", msg)
    game_settings = merge_game_settings(incoming)
    if "camera" in game_settings:
        game_settings["camera"]["url"] = normalize_camera_url(
            game_settings["camera"]["url"]
        )
    save_game_settings(game_settings)
    broadcast_game_settings(game_settings)
    send_serial_json(ser, to_firmware_settings(game_settings))
    print("Game settings updated:", game_settings)


def main():
    load_game_settings()
    if "camera" in game_settings:
        game_settings["camera"]["url"] = normalize_camera_url(
            game_settings["camera"]["url"]
        )
    start_websocket_server()
    start_camera_proxy_server()
    ser = open_serial()
    send_serial_json(ser, to_firmware_settings(game_settings))

    current_camera_url = get_camera_url()
    cap = open_ip_camera(current_camera_url)
    cv.namedWindow("Tank Bot Automation", cv.WINDOW_NORMAL)
    cv.resizeWindow("Tank Bot Automation", 1000, 720)

    heading = 0.0
    angle_offset = 0.0
    needs_calibration = False
    last_attack_ts = 0.0

    calibration = load_calibration()
    homography_matrix = None
    if calibration.get("homography"):
        try:
            homography_matrix = np.array(calibration["homography"], dtype=np.float32)
            if not homography_matrix_valid(homography_matrix):
                homography_matrix = None
        except Exception:
            homography_matrix = None
    if homography_matrix is None:
        homography_matrix = homography_from_calibration(calibration)
    calibration_mode = False

    state = {
        "isAutomatedMode": False,
        "tankHealth": 100,
        "rangeHealth": 100,
        "gameActive": False,
        "testMode": False,
        "match_over": False,
        "last_blue_pos": None,
        "last_red_pos": None,
    }

    try:
        while True:
            # Process inbound websocket messages
            while not inbound_queue.empty():
                try:
                    msg_str = inbound_queue.get_nowait()
                    msg = json.loads(msg_str)
                    if msg.get("type") == "START_BATTLE":
                        print("Received START_BATTLE signal. Calibrating MPU to camera.")
                        needs_calibration = True
                        state["match_over"] = False
                        state["gameActive"] = True
                        state["last_blue_pos"] = None
                        state["last_red_pos"] = None
                        send_serial_json(ser, {"START_BATTLE": True})
                    elif msg.get("type") == "SET_TEST_MODE":
                        enabled = bool(msg.get("enabled", False))
                        print(f"Received SET_TEST_MODE signal: {enabled}")
                        state["testMode"] = enabled
                        send_serial_json(ser, {"TEST_MODE": enabled})
                    elif msg.get("type") == "DEBUG_DAMAGE":
                        print("Received DEBUG_DAMAGE signal:", msg)
                        send_serial_json(ser, msg)
                    elif msg.get("type") == "LASER_GRID_HIT":
                        send_serial_json(ser, {"LASER_GRID_HIT": True})
                    elif msg.get("type") == "SET_MODE":
                        print("Received SET_MODE signal:", msg)
                        send_serial_json(ser, msg)
                    elif msg.get("type") == "UPDATE_SETTINGS":
                        print("Received UPDATE_SETTINGS signal")
                        apply_game_settings_update(msg, ser)
                    elif msg.get("type") == "ACTIVATE_POWER":
                        power_id = msg.get("power")
                        print(f"Received ACTIVATE_POWER signal: {power_id}")
                        if power_id == "dodge":
                            ws_broadcast({"power_activated": "dodge"})
                        elif power_id:
                            send_serial_json(ser, {"ACTIVATE_POWER": power_id})
                    elif msg.get("type") in (
                        "SET_CALIBRATION_MODE",
                        "CALIBRATE_POINT",
                        "CALIBRATE_FINISH",
                        "CALIBRATE_RESET",
                    ):
                        calibration, calibration_mode, homography_matrix = (
                            handle_calibration_message(
                                msg,
                                calibration,
                                calibration_mode,
                                state.get("latest_red_marker"),
                            )
                        )
                except Exception as e:
                    print(f"Error parsing inbound message: {e}")

            heading = drain_serial(ser, heading, state)

            if state.get("tankHealth", 100) <= 0 or state.get("rangeHealth", 100) <= 0:
                state["match_over"] = True
                state["gameActive"] = False

            new_camera_url = get_camera_url()
            if new_camera_url != current_camera_url:
                print(f"Camera URL changed: {current_camera_url} -> {new_camera_url}")
                if cap is not None:
                    cap.release()
                    time.sleep(0.5)
                current_camera_url = new_camera_url
                cap = open_ip_camera(current_camera_url)

            if cap is None:
                cap = open_ip_camera(current_camera_url)
                time.sleep(1.0)
                continue

            ret, frame = cap.read()
            if not ret or frame is None:
                print("Camera read failed; retrying...")
                cap.release()
                cap = None
                time.sleep(0.1)
                continue

            frame = cv.resize(frame, (FRAME_SIZE, FRAME_SIZE))
            hsv = cv.cvtColor(frame, cv.COLOR_BGR2HSV)
            state["latest_frame"] = frame
            state["latest_hsv"] = hsv

            lower_blue = np.array([90, 100, 50])
            upper_blue = np.array([150, 255, 255])
            mask_blue = cv.inRange(hsv, lower_blue, upper_blue)

            lower_red1 = np.array([0, 100, 50])
            upper_red1 = np.array([10, 255, 255])
            lower_red2 = np.array([160, 100, 50])
            upper_red2 = np.array([180, 255, 255])
            mask_red = cv.inRange(hsv, lower_red1, upper_red1) | cv.inRange(
                hsv, lower_red2, upper_red2
            )

            blue_marker = find_tracked_marker(mask_blue, state.get("last_blue_pos"))
            red_marker = find_tracked_marker(mask_red, state.get("last_red_pos"))
            state["latest_red_marker"] = red_marker

            if blue_marker is not None:
                state["last_blue_pos"] = (blue_marker[0], blue_marker[1])
            else:
                state["last_blue_pos"] = None

            if red_marker is not None:
                state["last_red_pos"] = (red_marker[0], red_marker[1])
            else:
                state["last_red_pos"] = None

            active_homography = (
                None if calibration_mode else homography_matrix
            )
            broadcast_positions(
                blue_marker, red_marker, None, active_homography
            )

            display_frame = frame.copy()

            if blue_marker is not None:
                bx, by, br = blue_marker
                cv.circle(display_frame, (bx, by), br, (255, 0, 0), 2)
                cv.circle(display_frame, (bx, by), 5, (0, 0, 255), -1)
                cv.putText(
                    display_frame,
                    f"TANK ({bx},{by})",
                    (bx + 10, by - 10),
                    cv.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (255, 0, 0),
                    2,
                )

            if red_marker is not None:
                rx, ry, rr = red_marker
                cv.circle(display_frame, (rx, ry), rr, (0, 0, 255), 2)
                cv.circle(display_frame, (rx, ry), 5, (255, 255, 255), -1)
                cv.putText(
                    display_frame,
                    f"TARGET ({rx},{ry})",
                    (rx + 10, ry - 10),
                    cv.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 0, 255),
                    2,
                )

            if calibration_mode:
                cv.putText(
                    display_frame,
                    "CALIBRATION MODE",
                    (20, 40),
                    cv.FONT_HERSHEY_SIMPLEX,
                    1.0,
                    (0, 255, 255),
                    2,
                )
            elif active_homography is not None:
                display_frame = cv.warpPerspective(
                    display_frame,
                    active_homography,
                    (FRAME_SIZE, FRAME_SIZE),
                )

            update_proxy_frame(display_frame)

            cmd_turn = b"x"
            cmd_drive = b"x"
            combat_allowed = state.get("gameActive") or state.get("testMode")
            automation_blocked = (
                not combat_allowed
                or (state.get("match_over") and not DEBUG_IGNORE_DEATH)
            )

            if state.get("isAutomatedMode") and not automation_blocked:
                if blue_marker is not None and red_marker is not None:
                    bx, by, br = blue_marker
                    rx, ry, rr = red_marker
                    if active_homography is not None:
                        bx, by = transform_point(active_homography, bx, by)
                        rx, ry = transform_point(active_homography, rx, ry)
                    now = time.time()

                    dist = math.hypot(rx - bx, ry - by)
                    reach_dist = br + rr + REACH_MARGIN_PX

                    if dist <= reach_dist:
                        hammer_cooldown_s = (
                            game_settings["powers"]["hammer"]["cooldownMs"] / 1000.0
                        )
                        if now - last_attack_ts >= hammer_cooldown_s:
                            cmd_drive = b"h"
                            last_attack_ts = now
                            print(f"Reach target (dist={dist:.1f}); hammer strike")
                    else:
                        camera_angle = (
                            math.degrees(math.atan2(by - ry, rx - bx)) - 90
                        ) % 360

                        if needs_calibration:
                            angle_offset = camera_angle - (heading * MPU_SIGN)
                            needs_calibration = False
                            print(
                                f"Calibrated! Camera: {camera_angle:.1f}, "
                                f"MPU: {heading:.1f}, Offset: {angle_offset:.1f}"
                            )

                        robot_angle = ((heading * MPU_SIGN) + angle_offset) % 360
                        error = camera_angle - robot_angle
                        if error > 180:
                            error -= 360
                        if error < -180:
                            error += 360

                        print(
                            f"Dist: {dist:.1f}, Target: {camera_angle:.1f}, "
                            f"Robot: {robot_angle:.1f}, Error: {error:.1f}"
                        )

                        if error > TURN_DEADBAND_DEG:
                            cmd_turn = b"a"
                        elif error < -TURN_DEADBAND_DEG:
                            cmd_turn = b"d"

                        if abs(error) <= FORWARD_MAX_ERROR_DEGREES:
                            cmd_drive = APPROACH_DRIVE
                else:
                    print("Marker lost; sending stop")
            elif state.get("isAutomatedMode") and automation_blocked:
                print("Match over; automation stopped until START_BATTLE")

            if ser is not None and state.get("isAutomatedMode") and combat_allowed:
                ser.write(cmd_turn)
                ser.write(cmd_drive)
                print(f"Commands sent: cmd_turn={cmd_turn}, cmd_drive={cmd_drive}")

            if display_frame is not None:
                cv.imshow("Tank Bot Automation", display_frame)

            if cv.waitKey(1) & 0xFF == ord("q"):
                break

            try:
                if cv.getWindowProperty("Tank Bot Automation", cv.WND_PROP_VISIBLE) < 1:
                    break
            except cv.error:
                pass

    finally:
        outbound_queue.put(None)
        send_stop(ser)
        if ser is not None:
            ser.close()
        if cap is not None:
            cap.release()
        cv.destroyAllWindows()


if __name__ == "__main__":
    main()
