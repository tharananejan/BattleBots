import asyncio
import copy
import json
import math
import os
import queue
import threading
import time

import cv2 as cv
import numpy as np
import serial
import websockets

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GAME_SETTINGS_PATH = os.path.join(SCRIPT_DIR, "game_settings.json")

DEFAULT_GAME_SETTINGS = {
    "damage": {
        "rangePiezoIr": 5,
        "rangeHumidity": 5,
        "tankLaser": 10,
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
    "relayActiveMs": {
        "fan": 5000,
        "laser": 5000,
        "humidifier": 5000,
    },
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
ATTACK_COOLDOWN_S = 1.5
MPU_SIGN = 1  # flip to -1 if MPU rotation direction is inverted
DEBUG_IGNORE_DEATH = False  # set True in debug to keep chasing after a bot dies
# Drive char used to advance toward red; change to b"s" ONLY if w drives backward.
APPROACH_DRIVE = b"s"
url = "http://10.11.186.189:8080/video"
WS_HOST = "127.0.0.1"
WS_PORT = 8765

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


def merge_game_settings(partial: dict | None) -> dict:
    if not partial:
        return copy.deepcopy(DEFAULT_GAME_SETTINGS)

    merged = copy.deepcopy(DEFAULT_GAME_SETTINGS)
    if "damage" in partial:
        merged["damage"].update(partial["damage"])
    if "relayActiveMs" in partial:
        merged["relayActiveMs"].update(partial["relayActiveMs"])
    if "powers" in partial:
        for power_id, values in partial["powers"].items():
            if power_id in merged["powers"] and isinstance(values, dict):
                merged["powers"][power_id].update(values)
    return merged


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
    merged = merge_game_settings(settings)
    return {
        "SETTINGS": True,
        "rangePiezoIr": merged["damage"]["rangePiezoIr"],
        "rangeHumidity": merged["damage"]["rangeHumidity"],
        "tankLaser": merged["damage"]["tankLaser"],
        "tankIr": merged["damage"]["tankIr"],
        "piezoHitThreshold": merged["damage"]["piezoHitThreshold"],
        "damageDebounceMs": merged["damage"]["damageDebounceMs"],
        "fanRelayActiveMs": merged["relayActiveMs"]["fan"],
        "laserRelayActiveMs": merged["relayActiveMs"]["laser"],
        "humidifierRelayActiveMs": merged["relayActiveMs"]["humidifier"],
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
        connection.write((json.dumps(payload) + "\n").encode())
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
        self.cap.set(cv.CAP_PROP_FRAME_WIDTH, frame_size)
        self.cap.set(cv.CAP_PROP_FRAME_HEIGHT, frame_size)
        self.cap.set(cv.CAP_PROP_BUFFERSIZE, 1)

        self.ret, self.frame = self.cap.read()
        self.stopped = False

    def start(self):
        threading.Thread(target=self.update, daemon=True).start()
        return self

    def update(self):
        while not self.stopped:
            self.ret, self.frame = self.cap.read()

    def read(self):
        return self.ret, self.frame

    def release(self):
        self.stopped = True
        self.cap.release()

    def get(self, prop_id):
        return self.cap.get(prop_id)


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


def broadcast_positions(blue_marker, red_marker):
    payload = {}
    if blue_marker is not None:
        bx, by, _ = blue_marker
        payload["blue_x"] = bx
        payload["blue_y"] = by
    if red_marker is not None:
        rx, ry, _ = red_marker
        payload["red_x"] = rx
        payload["red_y"] = ry
    if payload:
        ws_broadcast(payload)


def apply_game_settings_update(msg: dict, ser) -> None:
    global game_settings
    incoming = msg.get("settings", msg)
    game_settings = merge_game_settings(incoming)
    save_game_settings(game_settings)
    broadcast_game_settings(game_settings)
    send_serial_json(ser, to_firmware_settings(game_settings))
    print("Game settings updated:", game_settings)


def main():
    load_game_settings()
    start_websocket_server()
    ser = open_serial()
    send_serial_json(ser, to_firmware_settings(game_settings))

    cap = RealTimeIPCamera(url, FRAME_SIZE)
    cv.namedWindow("Tank Bot Automation", cv.WINDOW_NORMAL)
    cv.resizeWindow("Tank Bot Automation", 1000, 720)
    if not cap.ret:
        print(f"Camera failed to open: {url}")
        send_stop(ser)
        raise SystemExit(1)

    cap.start()

    width = int(cap.get(cv.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv.CAP_PROP_FRAME_HEIGHT))
    print(f"Camera: {url}")
    print(f"Actual resolution: {width}x{height}")

    heading = 0.0
    angle_offset = 0.0
    needs_calibration = False
    last_attack_ts = 0.0

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
                except Exception as e:
                    print(f"Error parsing inbound message: {e}")

            heading = drain_serial(ser, heading, state)

            if state.get("tankHealth", 100) <= 0 or state.get("rangeHealth", 100) <= 0:
                state["match_over"] = True
                state["gameActive"] = False

            ret, frame = cap.read()
            if not ret or frame is None:
                print("Camera read failed; stopping automation.")
                break

            hsv = cv.cvtColor(frame, cv.COLOR_BGR2HSV)

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

            if blue_marker is not None:
                state["last_blue_pos"] = (blue_marker[0], blue_marker[1])
            else:
                state["last_blue_pos"] = None

            if red_marker is not None:
                state["last_red_pos"] = (red_marker[0], red_marker[1])
            else:
                state["last_red_pos"] = None
            broadcast_positions(blue_marker, red_marker)

            if blue_marker is not None:
                bx, by, br = blue_marker
                cv.circle(frame, (bx, by), br, (255, 0, 0), 2)
                cv.circle(frame, (bx, by), 5, (0, 0, 255), -1)
                cv.putText(
                    frame,
                    f"TANK ({bx},{by})",
                    (bx + 10, by - 10),
                    cv.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (255, 0, 0),
                    2,
                )

            if red_marker is not None:
                rx, ry, rr = red_marker
                cv.circle(frame, (rx, ry), rr, (0, 0, 255), 2)
                cv.circle(frame, (rx, ry), 5, (255, 255, 255), -1)
                cv.putText(
                    frame,
                    f"TARGET ({rx},{ry})",
                    (rx + 10, ry - 10),
                    cv.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 0, 255),
                    2,
                )

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
                    now = time.time()

                    dist = math.hypot(rx - bx, ry - by)
                    reach_dist = br + rr + REACH_MARGIN_PX

                    if dist <= reach_dist:
                        if now - last_attack_ts >= ATTACK_COOLDOWN_S:
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

            cv.imshow("Tank Bot Automation", frame)

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
