#include <WiFi.h>
#include <esp_now.h>

uint8_t tankBotMac[] = { 0xAC, 0xA7, 0x04, 0x26, 0x85, 0xC4 };

const int JOYSTICK_CENTER = 2048;
const int JOYSTICK_LOW = 0;
const int JOYSTICK_HIGH = 4095;
const unsigned long COMMAND_TIMEOUT_MS = 700;

// Memory footprint matching the 6-field system
typedef struct {
  int xVal;
  int yVal;
  bool sw1;
  bool btn1;
  bool btn2;
  bool btn3; 
} RemoteCommandData;

typedef struct {
  bool laserValue;
  bool ir1Value;
  bool ir2Value;
  int hallValue;
  float m1;
  bool automationActive; // ◄ Synchronizes bridge sending execution gates
} SensorData;

RemoteCommandData autoCommand = { JOYSTICK_CENTER, JOYSTICK_CENTER, false, false, false, false };

bool expectingTurnChannel = true;
bool commandActive = false;
unsigned long lastCommandTime = 0;
bool bridgeAllowTransmission = false; // State-gate latch 

void sendAutoCommand() {
  // CRITICAL: Prevent sending automation coordinates unless explicitly permitted by the remote toggle state
  if (!bridgeAllowTransmission) {
    return;
  }

  esp_err_t result = esp_now_send(tankBotMac, (uint8_t *)&autoCommand, sizeof(autoCommand));
  if (result != ESP_OK) {
    Serial.println("Send failed");
  }
}

void stopTankBot() {
  autoCommand.xVal = JOYSTICK_CENTER;
  autoCommand.yVal = JOYSTICK_CENTER;
  autoCommand.sw1 = false;
  autoCommand.btn1 = false;
  autoCommand.btn2 = false;
  autoCommand.btn3 = false;
  commandActive = false;
  sendAutoCommand();
}

void applyTurnCommand(char cmd) {
  if (cmd == 'a')      autoCommand.yVal = JOYSTICK_LOW;
  else if (cmd == 'd') autoCommand.yVal = JOYSTICK_HIGH;
  else if (cmd == 'x') autoCommand.yVal = JOYSTICK_CENTER;
}

void applyDriveCommand(char cmd) {
  if (cmd == 'w')      autoCommand.xVal = JOYSTICK_LOW;
  else if (cmd == 's') autoCommand.xVal = JOYSTICK_HIGH;
  else if (cmd == 'x') autoCommand.xVal = JOYSTICK_CENTER;
}

void handleSerialCommand(char cmd) {
  if (!bridgeAllowTransmission) {
    return; // Ignore incoming computer keystrokes silently if in Manual mode
  }

  if (cmd != 'w' && cmd != 'a' && cmd != 's' && cmd != 'd' && cmd != 'x') {
    return;
  }

  if (expectingTurnChannel) {
    applyTurnCommand(cmd);
    expectingTurnChannel = false;
  } else {
    applyDriveCommand(cmd);
    expectingTurnChannel = true;
    sendAutoCommand();
  }

  commandActive = true;
  lastCommandTime = millis();
}

void onDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {}

void onDataRecv(const uint8_t *mac, const uint8_t *incomingData, int len) {
  if (len != sizeof(SensorData)) return;

  SensorData sensorData;
  memcpy(&sensorData, incomingData, sizeof(sensorData));

  // Check state transitions to echo notifications to terminal environment safely
  if (sensorData.automationActive != bridgeAllowTransmission) {
    bridgeAllowTransmission = sensorData.automationActive;
    if (bridgeAllowTransmission) {
      Serial.println("{\"BRIDGE_STATUS\":\"AUTOMATION_RUNNING\"}");
    } else {
      Serial.println("{\"BRIDGE_STATUS\":\"MANUAL_OVERRIDE_LOCK\"}");
      stopTankBot();
    }
  }

  // Consistent JSON reporting frame
  Serial.print("{\"m1\":");
  Serial.print(sensorData.m1);
  Serial.print(",\"d1\":");
  Serial.print(sensorData.laserValue ? 1 : 0);
  Serial.print(",\"ir1\":");
  Serial.print(sensorData.ir1Value ? 1 : 0);
  Serial.print(",\"ir2\":");
  Serial.print(sensorData.ir2Value ? 1 : 0);
  Serial.print(",\"hall\":");
  Serial.print(sensorData.hallValue);
  Serial.print(",\"auto_active\":");
  Serial.print(bridgeAllowTransmission ? 1 : 0);
  Serial.println("}");
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  if (esp_now_init() != ESP_OK) return;

  esp_now_register_send_cb(esp_now_send_cb_t(onDataSent));
  esp_now_register_recv_cb(esp_now_recv_cb_t(onDataRecv));

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, tankBotMac, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;

  esp_now_add_peer(&peerInfo);
  Serial.println("System Bridge Initialized");
}

void loop() {
  while (Serial.available()) {
    handleSerialCommand((char)Serial.read());
  }

  if (commandActive && millis() - lastCommandTime > COMMAND_TIMEOUT_MS) {
    stopTankBot();
    expectingTurnChannel = true;
  }
}
