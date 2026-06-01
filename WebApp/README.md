# Battle Bots

Hardware-integrated Battle Bots project with a React frontend, Python OpenCV/ESP32 backend, and Node.js cloud relay server.

## Project Structure

```text
BattleBots -Git Repo Local/
├── Backend/
│   ├── location.py
│   └── requirements.txt
├── BattleBotsFrontend/
└── Relay-server/
    ├── package.json
    └── server.js
```

## Backend

The Python backend uses OpenCV to track bot positions and reads telemetry from an ESP32 over serial. It broadcasts bot telemetry over WebSocket.

```bash
cd Backend
pip install -r requirements.txt
python location.py
```

## Frontend

The React frontend displays the battle arena and bot telemetry.

```bash
cd BattleBotsFrontend
npm install
npm run dev
```

## Relay Server

The relay server forwards WebSocket messages between connected clients.

```bash
cd Relay-server
npm install
npm start
```
