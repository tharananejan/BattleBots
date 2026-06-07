// BattleGround: relay control, health authority, automation bridge (Serial <-> ESP-NOW)

#include <WiFi.h>
#include <esp_now.h>

// --- Shared structs (keep layout identical on all ESP32 nodes) ---

typedef struct {
  uint8_t rangeHealth;
  uint8_t tankHealth;
} GlobalStateData;

typedef struct {
  int piezo;
  bool ir1;
  bool ir2;
  bool humidityHit;
  float m1;
} RangeBotTelemetry;

typedef struct {
  bool laserValue;
  bool ir1Value;
  bool ir2Value;
  int hallValue;
  float m1;
} TankBotTelemetry;

typedef struct {
  int fanVal;
  int laserVal;
} RangeBotData;

typedef struct {
  int x1;
  int y1;
  bool sw1;
  bool btn1, btn2;
  bool isAutomatedMode;
} TankBotRemoteData;

typedef struct {
  int xVal;
  int yVal;
  bool sw1;
  bool btn1;
  bool btn2;
  bool isAutomatedMode;
} RemoteCommandData;

// --- Relay pins ---
int fanout = 18;
int lasorout = 7;
int humidifier = 17;

unsigned long fanStartTime = 0;
bool fanon = false;
bool laseron = false;
unsigned long laserStartTime = 0;

// --- MAC addresses ---
uint8_t tankBotMac[] = {0xAC, 0xA7, 0x04, 0x26, 0x85, 0xC4};
uint8_t rangeBotMac[] = {0x10, 0x20, 0xBA, 0x4C, 0xE3, 0x30};
uint8_t tankBotRemoteMac[] = {0xA0, 0xF2, 0x62, 0xE0, 0x47, 0xCC};
uint8_t rangeBotRemoteMac[] = {0x10, 0x20, 0xBA, 0x4C, 0x5C, 0xC4};

RangeBotData rangeBotPowers;
TankBotRemoteData tankBotRemoteData;
bool tankBotAutomatedMode = false;
bool humidifierPending = false;
bool humidifierOn = false;
unsigned long humidifierStartTime = 0;

// --- Health (server-authoritative) ---
uint8_t rangeBotHealth = 100;
uint8_t tankBotHealth = 100;
const int RANGE_DAMAGE = 5;
const int RANGE_HUMIDITY_DAMAGE = 5;
const int TANK_LASER_DAMAGE = 10;
const int TANK_IR_DAMAGE = 2;
const int PIEZO_HIT_THRESHOLD = 200;//piezo 
const unsigned long DAMAGE_DEBOUNCE_MS = 400;
const unsigned long STATE_BROADCAST_MS = 100;
const unsigned long SERIAL_STATE_MS = 200;
const unsigned long MATCH_RESET_MS = 5000;

unsigned long lastRangeDamageMs = 0;
unsigned long lastRangeHumidityDamageMs = 0;
unsigned long lastTankLaserDamageMs = 0;
unsigned long lastTankIrDamageMs = 0;
unsigned long lastStateBroadcastMs = 0;
unsigned long lastSerialStateMs = 0;
unsigned long matchEndMs = 0;
bool matchEnded = false;

TankBotTelemetry lastTankTelemetry = {false, false, false, 9999, 0};

const int JOYSTICK_CENTER = 2048;
const int JOYSTICK_LOW = 0;
const int JOYSTICK_HIGH = 4095;
const unsigned long COMMAND_TIMEOUT_MS = 700;

RemoteCommandData autoCommand = {
  JOYSTICK_CENTER, JOYSTICK_CENTER, false, false, false, false
};

bool automationActive = false;
unsigned long lastAutomationTime = 0;

bool isSameMac(const uint8_t *a, const uint8_t *b) {
  return memcmp(a, b, 6) == 0;
}

void clampHealth() {
  if (rangeBotHealth > 100) rangeBotHealth = 100;
  if (tankBotHealth > 100) tankBotHealth = 100;
}

void checkMatchEnd() {
  if (rangeBotHealth == 0 || tankBotHealth == 0) {
    if (!matchEnded) {
      matchEnded = true;
      matchEndMs = millis();
    }
  } else {
    matchEnded = false;
  }

  if (matchEnded && (millis() - matchEndMs >= MATCH_RESET_MS)) {
    rangeBotHealth = 100;
    tankBotHealth = 100;
    matchEnded = false;
    Serial.println("Match reset: health restored to 100");
  }
}

void broadcastGlobalState() {
  GlobalStateData state = {rangeBotHealth, tankBotHealth};
  esp_now_send(rangeBotRemoteMac, (uint8_t *)&state, sizeof(state));
  esp_now_send(tankBotRemoteMac, (uint8_t *)&state, sizeof(state));
}

void applyRangeDamage(const RangeBotTelemetry &t) {
  if (rangeBotHealth == 0) return;

  bool hit = (t.piezo > PIEZO_HIT_THRESHOLD || t.ir1 || t.ir2);
  if (hit && (millis() - lastRangeDamageMs >= DAMAGE_DEBOUNCE_MS)) {
    lastRangeDamageMs = millis();
    if (rangeBotHealth > RANGE_DAMAGE) {
      rangeBotHealth -= RANGE_DAMAGE;
    } else {
      rangeBotHealth = 0;
    }
    Serial.print("RangeBot IR/piezo damage -> health ");
    Serial.println(rangeBotHealth);
  }

  if (t.humidityHit && (millis() - lastRangeHumidityDamageMs >= DAMAGE_DEBOUNCE_MS)) {
    lastRangeHumidityDamageMs = millis();
    if (rangeBotHealth > RANGE_HUMIDITY_DAMAGE) {
      rangeBotHealth -= RANGE_HUMIDITY_DAMAGE;
    } else {
      rangeBotHealth = 0;
    }
    Serial.print("RangeBot humidity damage -> health ");
    Serial.println(rangeBotHealth);
  }
}

void applyTankDamage(const TankBotTelemetry &t) {
  if (tankBotHealth == 0) return;

  if (!t.laserValue && (millis() - lastTankLaserDamageMs >= DAMAGE_DEBOUNCE_MS)) {
    lastTankLaserDamageMs = millis();
    if (tankBotHealth > TANK_LASER_DAMAGE) {
      tankBotHealth -= TANK_LASER_DAMAGE;
    } else {
      tankBotHealth = 0;
    }
    Serial.print("TankBot laser damage -> health ");
    Serial.println(tankBotHealth);
  }

  if ((t.ir1Value || t.ir2Value) && (millis() - lastTankIrDamageMs >= DAMAGE_DEBOUNCE_MS)) {
    lastTankIrDamageMs = millis();
    if (tankBotHealth > TANK_IR_DAMAGE) {
      tankBotHealth -= TANK_IR_DAMAGE;
    } else {
      tankBotHealth = 0;
    }
    Serial.print("TankBot IR damage -> health ");
    Serial.println(tankBotHealth);
  }
}

void printCombinedStateJson() {
  Serial.print("{\"m1\":");
  Serial.print(lastTankTelemetry.m1);
  Serial.print(",\"d1\":");
  Serial.print(lastTankTelemetry.laserValue ? 1 : 0);
  Serial.print(",\"ir1\":");
  Serial.print(lastTankTelemetry.ir1Value ? 1 : 0);
  Serial.print(",\"ir2\":");
  Serial.print(lastTankTelemetry.ir2Value ? 1 : 0);
  Serial.print(",\"hall\":");
  Serial.print(lastTankTelemetry.hallValue);
  Serial.print(",\"rangeHealth\":");
  Serial.print(rangeBotHealth);
  Serial.print(",\"tankHealth\":");
  Serial.print(tankBotHealth);
  Serial.println("}");
}

void sendAutomationToTankBot() {
  if (tankBotHealth == 0) {
    stopTankBotAutomation();
    return;
  }
  esp_now_send(tankBotMac, (uint8_t *)&autoCommand, sizeof(autoCommand));
}

void stopTankBotAutomation() {
  autoCommand.xVal = JOYSTICK_CENTER;
  autoCommand.yVal = JOYSTICK_CENTER;
  autoCommand.sw1 = false;
  autoCommand.btn1 = false;
  autoCommand.btn2 = false;
  autoCommand.isAutomatedMode = false;
  automationActive = false;
  esp_now_send(tankBotMac, (uint8_t *)&autoCommand, sizeof(autoCommand));
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
  if (tankBotHealth == 0) return;
  if (!isValidMotionChar(turnCmd) || !isValidMotionChar(driveCmd)) {
    return;
  }

  setTurnFromChar(turnCmd);
  setDriveFromChar(driveCmd);
  autoCommand.sw1 = false;
  autoCommand.btn1 = false;
  autoCommand.btn2 = false;
  autoCommand.isAutomatedMode = true;

  sendAutomationToTankBot();
  automationActive = true;
  lastAutomationTime = millis();
}

void onDataRecv(const esp_now_recv_info *recv_info, const uint8_t *incomingData, int len) {
  const uint8_t *src = recv_info->src_addr;

  if (isSameMac(src, rangeBotRemoteMac) && len == sizeof(RangeBotData)) {
    if (rangeBotHealth == 0) return;
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
    tankBotAutomatedMode = tankBotRemoteData.isAutomatedMode;
    if (tankBotHealth > 0 && !tankBotAutomatedMode && tankBotRemoteData.btn2) {
      humidifierPending = true;
      Serial.println("Signal Received from TankBot Remote: Humidifier ON");
    }
    return;
  }

  if (isSameMac(src, rangeBotMac) && len == sizeof(RangeBotTelemetry)) {
    RangeBotTelemetry telemetry;
    memcpy(&telemetry, incomingData, sizeof(telemetry));
    applyRangeDamage(telemetry);
    return;
  }

  if (isSameMac(src, tankBotMac) && len == sizeof(TankBotTelemetry)) {
    TankBotTelemetry telemetry;
    memcpy(&telemetry, incomingData, sizeof(telemetry));
    lastTankTelemetry = telemetry;
    applyTankDamage(telemetry);
    return;
  }
}

bool addPeer(const uint8_t *mac) {
  if (esp_now_is_peer_exist(mac)) {
    return true;
  }
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, mac, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;
  return esp_now_add_peer(&peerInfo) == ESP_OK;
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

  addPeer(tankBotMac);
  addPeer(rangeBotMac);
  addPeer(tankBotRemoteMac);
  addPeer(rangeBotRemoteMac);

  esp_now_register_recv_cb(onDataRecv);
  Serial.println("System Ready. Health authority active.");
}

void loop() {
  checkMatchEnd();

  if (tankBotAutomatedMode && tankBotHealth > 0) {
    while (Serial.available() >= 2) {
      char turnCmd = (char)Serial.read();
      char driveCmd = (char)Serial.read();
      applySerialCommandPair(turnCmd, driveCmd);
    }

    if (automationActive && (millis() - lastAutomationTime > COMMAND_TIMEOUT_MS)) {
      stopTankBotAutomation();
    }
  } else {
    while (Serial.available() > 0) {
      Serial.read();
    }
    if (automationActive) {
      stopTankBotAutomation();
    }
  }

  if (rangeBotHealth > 0 && rangeBotPowers.fanVal == 1) {
    Serial.println("Signal Received: Fan relay activated");
    digitalWrite(fanout, HIGH);
    fanon = true;
    fanStartTime = millis();
  }
  if (fanon && millis() - fanStartTime > 5 * 1000) {
    fanon = false;
    digitalWrite(fanout, LOW);
  }

  if (rangeBotHealth > 0 && rangeBotPowers.laserVal == 1) {
    Serial.println("Signal Received: Laser relay activated");
    digitalWrite(lasorout, HIGH);
    laseron = true;
    laserStartTime = millis();
  }
  if (laseron && millis() - laserStartTime > 5 * 1000) {
    laseron = false;
    digitalWrite(lasorout, LOW);
  }

  if (tankBotHealth > 0 && humidifierPending) {
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

  if (millis() - lastStateBroadcastMs >= STATE_BROADCAST_MS) {
    lastStateBroadcastMs = millis();
    broadcastGlobalState();
  }

  if (millis() - lastSerialStateMs >= SERIAL_STATE_MS) {
    lastSerialStateMs = millis();
    printCombinedStateJson();
  }
}
