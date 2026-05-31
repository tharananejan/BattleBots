import json
import math
import time

import cv2 as cv
import numpy as np
import serial


SERIAL_PORT = "COM14"
BAUD_RATE = 115200
CAMERA_INDEX = 0
FRAME_SIZE = 480
MIN_CONTOUR_AREA = 400
TURN_DEADBAND_DEGREES = 20
FORWARD_MAX_ERROR_DEGREES = 90


def open_serial():
    try:
        connection = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=0.01)
        time.sleep(2)
        print(f"Connected to {SERIAL_PORT}")
        return connection
    except Exception as error:
        print(f"Serial Error: {error}")
        return None


def read_latest_telemetry(connection, current_heading):
    if connection is None or not connection.in_waiting:
        return current_heading

    latest_line = ""
    while connection.in_waiting:
        latest_line = connection.readline().decode(errors="ignore").strip()

    if not latest_line.startswith("{"):
        return current_heading

    try:
        data = json.loads(latest_line)
    except json.JSONDecodeError:
        return current_heading

    heading = data.get("m1", current_heading)
    print("ESP -> m1:", heading)
    return heading


def find_largest_marker(mask):
    contours, _ = cv.findContours(mask, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    contour = max(contours, key=cv.contourArea)
    if cv.contourArea(contour) <= MIN_CONTOUR_AREA:
        return None

    (x, y), radius = cv.minEnclosingCircle(contour)
    return int(x), int(y), int(radius)


def send_stop(connection):
    if connection is None:
        return

    try:
        connection.write(b"x")
        connection.write(b"x")
    except Exception:
        pass


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


def main():
    ser = open_serial()

    cap, used_index, used_backend = open_camera(CAMERA_INDEX, FRAME_SIZE)
    if cap is None:
        tried = [CAMERA_INDEX] + [i for i in (0, 1, 2) if i != CAMERA_INDEX]
        print(
            f"Camera failed to open: tried indices {tried} with CAP_DSHOW and CAP_ANY backends."
        )
        send_stop(ser)
        raise SystemExit(1)

    width = int(cap.get(cv.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv.CAP_PROP_FRAME_HEIGHT))
    print(f"Camera: index={used_index}, backend={used_backend}")
    print(f"Actual resolution: {width}x{height}")

    heading = 0

    try:
        while True:
            heading = read_latest_telemetry(ser, heading)

            ret, frame = cap.read()
            if not ret or frame is None:
                print("Camera read failed; stopping automation.")
                break

            frame = cv.flip(frame, 1)
            hsv = cv.cvtColor(frame, cv.COLOR_BGR2HSV)

            lower_blue = np.array([100, 150, 50])
            upper_blue = np.array([140, 255, 255])
            mask_blue = cv.inRange(hsv, lower_blue, upper_blue)

            lower_red1 = np.array([0, 120, 70])
            upper_red1 = np.array([10, 255, 255])
            lower_red2 = np.array([170, 120, 70])
            upper_red2 = np.array([180, 255, 255])
            mask_red = cv.inRange(hsv, lower_red1, upper_red1) | cv.inRange(
                hsv, lower_red2, upper_red2
            )

            blue_marker = find_largest_marker(mask_blue)
            red_marker = find_largest_marker(mask_red)

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

            if blue_marker is not None and red_marker is not None and heading is not None:
                bx, by, _ = blue_marker
                rx, ry, _ = red_marker

                target_angle = (math.degrees(math.atan2(by - ry, rx - bx)) - 90) % 360
                robot_angle = heading % 360
                error = target_angle - robot_angle

                if error > 180:
                    error -= 360
                if error < -180:
                    error += 360

                print("Target:", target_angle, "Robot:", robot_angle, "Error:", error)

                if error > TURN_DEADBAND_DEGREES:
                    cmd_turn = b"a"
                elif error < -TURN_DEADBAND_DEGREES:
                    cmd_turn = b"d"

                if abs(error) <= FORWARD_MAX_ERROR_DEGREES:
                    cmd_drive = b"w"

            if ser is not None:
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
        send_stop(ser)
        if ser is not None:
            ser.close()
        if cap is not None:
            cap.release()
        cv.destroyAllWindows()


if __name__ == "__main__":
    main()
