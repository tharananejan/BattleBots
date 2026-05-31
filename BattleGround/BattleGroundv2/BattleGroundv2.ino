// BattleGround: relay control (RangeBot / TankBot remote) + TankBot automation bridge (Serial <-> ESP-NOW)

#include <WiFi.h>
#include <esp_now.h>

// --- Relay pins ---
int fanout = 18;
int lasorout = 7;
int humidifier = 17;

unsigned long fanStartTime = 0;
bool fanon = false;
bool laseron = false;
unsigned long laserStartTime = 0;

// --- Known device MAC addresses ---
uint8_t tankBotMac[] = {0xAC, 0xA7, 0x04, 0x26, 0x85, 0xC4};
uint8_t tankBotRemoteMac[] = {0xA0, 0xF2, 0x62, 0xE0, 0x47, 0xCC};
uint8_t rangeBotRemoteMac[] = {0x10, 0x20, 0xBA, 0x4C, 0x5C, 0xC4};

// --- RangeBot remote -> fan / laser (8 bytes) ---
typedef struct {
  int fanVal;
  int laserVal;
} RangeBotData;

RangeBotData rangeBotPowers;

// --- TankBot remote -> humidifier (same layout as TankBot command packet) ---
typedef struct {
  int x1;
  int y1;
  bool sw1;
  bool btn1, btn2;
} TankBotRemoteData;

TankBotRemoteData tankBotRemoteData;
bool humidifierPending = false;
bool humidifierOn = false;
unsigned long humidifierStartTime = 0;

// --- TankBot telemetry (must match TankBot/tankbot.ino SensorData) ---
typedef struct {
  bool laserValue;
  bool ir1Value;
  bool ir2Value;
  int hallValue;
  float m1;
} SensorData;

// --- Automation commands to TankBot (must match RemoteCommandData on TankBot) ---
typedef struct {
  int xVal;
  int yVal;
  bool sw1;
  bool btn1;
  bool btn2;
} RemoteCommandData;

const int JOYSTICK_CENTER = 2048;
const int JOYSTICK_LOW = 0;
const int JOYSTICK_HIGH = 4095;
const unsigned long COMMAND_TIMEOUT_MS = 700;

RemoteCommandData autoCommand = {
  JOYSTICK_CENTER, JOYSTICK_CENTER, false, false, false
};

bool automationActive = false;
unsigned long lastAutomationTime = 0;

bool isSameMac(const uint8_t *a, const uint8_t *b) {
  return memcmp(a, b, 6) == 0;
}

void sendAutomationToTankBot() {
  esp_now_send(tankBotMac, (uint8_t *)&autoCommand, sizeof(autoCommand));
}

void stopTankBotAutomation() {
  autoCommand.xVal = JOYSTICK_CENTER;
  autoCommand.yVal = JOYSTICK_CENTER;
  autoCommand.sw1 = false;
  autoCommand.btn1 = false;
  autoCommand.btn2 = false;
  automationActive = false;
  sendAutomationToTankBot();
}

void setTurnFromChar(char cmd) {
  if (cmd == 'a') {
    autoCommand.yVal = JOYSTICK_LOW;
  } else if (cmd == 'd') {
    autoCommand.yVal = JOYSTICK_HIGH;
  } else {
    autoCommand.yVal = JOYSTICK_CENTER;
  }
}

void setDriveFromChar(char cmd) {
  if (cmd == 'w') {
    autoCommand.xVal = JOYSTICK_LOW;
  } else if (cmd == 's') {
    autoCommand.xVal = JOYSTICK_HIGH;
  } else {
    autoCommand.xVal = JOYSTICK_CENTER;
  }
}

bool isValidMotionChar(char cmd) {
  return cmd == 'w' || cmd == 'a' || cmd == 's' || cmd == 'd' || cmd == 'x';
}

void applySerialCommandPair(char turnCmd, char driveCmd) {
  if (!isValidMotionChar(turnCmd) || !isValidMotionChar(driveCmd)) {
    return;
  }

  setTurnFromChar(turnCmd);
  setDriveFromChar(driveCmd);
  autoCommand.sw1 = false;
  autoCommand.btn1 = false;
  autoCommand.btn2 = false;

  sendAutomationToTankBot();
  automationActive = true;
  lastAutomationTime = millis();
}

void printTankTelemetryJson(const SensorData &telemetry) {
  Serial.print("{\"m1\":");
  Serial.print(telemetry.m1);
  Serial.print(",\"d1\":");
  Serial.print(telemetry.laserValue ? 1 : 0);
  Serial.print(",\"ir1\":");
  Serial.print(telemetry.ir1Value ? 1 : 0);
  Serial.print(",\"ir2\":");
  Serial.print(telemetry.ir2Value ? 1 : 0);
  Serial.print(",\"hall\":");
  Serial.print(telemetry.hallValue);
  Serial.println("}");
}

void onDataRecv(const esp_now_recv_info *recv_info, const uint8_t *incomingData, int len) {
  const uint8_t *src = recv_info->src_addr;

  if (isSameMac(src, rangeBotRemoteMac) && len == sizeof(RangeBotData)) {
    memcpy(&rangeBotPowers, incomingData, sizeof(rangeBotPowers));
    if (rangeBotPowers.fanVal == 1) {
      Serial.println("Signal Received: Fan ON");
    }
    if (rangeBotPowers.laserVal == 1) {
      Serial.println("Signal Received: Laser ON");
    }
    return;
  }

  if (isSameMac(src, tankBotRemoteMac) && len == sizeof(TankBotRemoteData)) {
    memcpy(&tankBotRemoteData, incomingData, sizeof(tankBotRemoteData));
    if (tankBotRemoteData.btn2) {
      humidifierPending = true;
      Serial.println("Signal Received from TankBot Remote: Humidifier ON");
    }
    return;
  }

  if (isSameMac(src, tankBotMac) && len == sizeof(SensorData)) {
    SensorData telemetry;
    memcpy(&telemetry, incomingData, sizeof(telemetry));
    printTankTelemetryJson(telemetry);
    return;
  }
}

void setup() {
  pinMode(fanout, OUTPUT);
  pinMode(lasorout, OUTPUT);
  pinMode(humidifier, OUTPUT);

  digitalWrite(fanout, LOW);
  digitalWrite(lasorout, LOW);
  digitalWrite(humidifier, LOW);

  Serial.begin(115200);
  WiFi.mode(WIFI_STA);

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW Init Failed");
    return;
  }

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, tankBotMac, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("Failed to add TankBot peer");
    return;
  }

  esp_now_register_recv_cb(onDataRecv);
  Serial.println("System Ready. Relays OFF. Tank automation bridge ready.");
}

void loop() {
  while (Serial.available() >= 2) {
    char turnCmd = (char)Serial.read();
    char driveCmd = (char)Serial.read();
    applySerialCommandPair(turnCmd, driveCmd);
  }

  if (automationActive && (millis() - lastAutomationTime > COMMAND_TIMEOUT_MS)) {
    stopTankBotAutomation();
  }

  if (rangeBotPowers.fanVal == 1) {
    Serial.println("Signal Received: Fan relay activated");
    digitalWrite(fanout, HIGH);
    fanon = true;
    fanStartTime = millis();
  }
  if (fanon && millis() - fanStartTime > 5 * 1000) {
    fanon = false;
    digitalWrite(fanout, LOW);
  }

  if (rangeBotPowers.laserVal == 1) {
    Serial.println("Signal Received: Laser relay activated");
    digitalWrite(lasorout, HIGH);
    laseron = true;
    laserStartTime = millis();
  }
  if (laseron && millis() - laserStartTime > 5 * 1000) {
    laseron = false;
    digitalWrite(lasorout, LOW);
  }

  if (humidifierPending) {
    Serial.println("Signal Received: Humidifier relay activated");
    digitalWrite(humidifier, HIGH);
    humidifierOn = true;
    humidifierStartTime = millis();
    humidifierPending = false;
  }
  if (humidifierOn && millis() - humidifierStartTime > 5 * 1000) {
    humidifierOn = false;
    digitalWrite(humidifier, LOW);
  }
}
