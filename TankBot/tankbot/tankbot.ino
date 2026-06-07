#include <esp_now.h>
#include <WiFi.h>
#include <Wire.h>
#include <ESP32Servo.h> 
#include <MPU6050_light.h>

#define HALL_SENSOR_PIN 18
#define LASER_RECEIVER_PIN 4
#define IRSENSOR1_PIN 42
#define IRSENSOR2_PIN 41

#define MPU_SDA_PIN 20
#define MPU_SCL_PIN 21

#define motorPinA 35
#define motorPinB 36
#define motorPinC 37
#define motorPinD 38

#define SERVO_PIN 11 // UPDATED: Servo is now on pin 11

uint8_t remoteMac[] = { 0xA0, 0xF2, 0x62, 0xE0, 0x47, 0xCC };
uint8_t battleGroundMac[] = { 0x10, 0x20, 0xBA, 0x4C, 0x50, 0x8C };
// A0:F2:62:E0:47:CC
uint8_t bridgeMac[6] = { 0 };
bool hasBridgePeer = false;

TwoWire MPUWire = TwoWire(0);
MPU6050 mpu(MPUWire);
bool mpuReady = false;

const int LOW_THRESHOLD = 500;
const int HIGH_THRESHOLD = 3500;
const unsigned long MANUAL_TIMEOUT_MS = 600;
const unsigned long AUTO_TIMEOUT_MS = 600;
const int HALL_THRESHOLD = 100;
const unsigned long FREEZE_DURATION = 10000;

// ---------------- Data Structures ----------------
typedef struct {
  int xVal; 
  int yVal; 
  bool sw1;
  bool btn1, btn2;
  bool isAutomatedMode;
} RemoteCommandData;

// Layout must match BattleGround TankBotTelemetry
typedef struct {
  bool laserValue;
  bool ir1Value;
  bool ir2Value;
  int hallValue;
  float m1;
} SensorData;

RemoteCommandData manualData = { 2048, 2048, false, false, false, false };
RemoteCommandData autoData = { 2048, 2048, false, false, false, false };
SensorData sensorData;

esp_now_peer_info_t peerInfo;
unsigned long lastManualTime = 0;
unsigned long lastAutoTime = 0;
unsigned long lastTelemetryTime = 0;
unsigned long freezeStartTime = 0;
bool isFrozen = false;

// ---------------- Servo / Hammer Variables ----------------
Servo myServo;
bool lastBtn1State = false;

enum HammerState { HAMMER_IDLE, HAMMER_STRIKING, HAMMER_RETURNING };
HammerState hammerState = HAMMER_IDLE;
int currentHammerAngle = 0;
unsigned long lastHammerStepTime = 0;

const int HAMMER_STEP_DELAY = 10;
const int HAMMER_STEP_SIZE = 6;

// Forward declaration of functions
void moveMotor();
void moveMotor(const RemoteCommandData &commandData, bool turnFirst = false);
void moveForward();
void moveBackward();
void turnRight();
void turnLeft();
void motorStop();
bool isSameMac(const uint8_t *a, const uint8_t *b);
bool isManualActive(const RemoteCommandData &commandData);
void addBridgePeerIfNeeded(const uint8_t *mac);
void handleHammerStrike(const RemoteCommandData &commandData);
void printRemoteCommandData(const char *label, const RemoteCommandData &data);
void sendTelemetry();

// Callback when data is sent
void OnDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
  // Serial.print("\r\nLast Packet Send Status:\t");
  // Serial.println(status == ESP_NOW_SEND_SUCCESS ? "Success" : "Failed");
}

// Callback when data is received
void OnDataRecv(const uint8_t *mac, const uint8_t *incomingData, int len) {
  if (len != sizeof(RemoteCommandData)) {
    // Serial.println("Unexpected command size");
    return;
  }

  RemoteCommandData incomingCommand;
  memcpy(&incomingCommand, incomingData, sizeof(incomingCommand));

  if (isSameMac(mac, remoteMac)) {
    manualData = incomingCommand;
    lastManualTime = millis();
  } else {
    autoData = incomingCommand;
    lastAutoTime = millis();
    addBridgePeerIfNeeded(mac);
  }

  // Run movement logic immediately whenever new data arrives
  moveMotor();
}

void handleHammerStrike(const RemoteCommandData &commandData) {
  if (commandData.btn1 == true && lastBtn1State == false) {
    if (hammerState == HAMMER_IDLE) {
      hammerState = HAMMER_STRIKING;
      lastHammerStepTime = millis();
      // Serial.println("Button 1 pressed: Hammer strike");
    }
  }
  lastBtn1State = commandData.btn1;
}

void printRemoteCommandData(const char *label, const RemoteCommandData &data) {
  Serial.print(label);
  Serial.print(" xVal="); Serial.print(data.xVal);
  Serial.print(" yVal="); Serial.print(data.yVal);
  Serial.print(" sw1="); Serial.print(data.sw1);
  Serial.print(" btn1="); Serial.print(data.btn1);
  Serial.print(" btn2="); Serial.print(data.btn2);
  Serial.print(" auto="); Serial.println(data.isAutomatedMode);
}

bool isSameMac(const uint8_t *a, const uint8_t *b) {
  return memcmp(a, b, 6) == 0;
}

void addBridgePeerIfNeeded(const uint8_t *mac) {
  if (hasBridgePeer && isSameMac(mac, bridgeMac)) {
    return;
  }

  memcpy(bridgeMac, mac, 6);

  esp_now_peer_info_t bridgePeer = {};
  memcpy(bridgePeer.peer_addr, bridgeMac, 6);
  bridgePeer.channel = 0;
  bridgePeer.encrypt = false;

  if (!esp_now_is_peer_exist(bridgeMac)) {
    if (esp_now_add_peer(&bridgePeer) != ESP_OK) {
      // Serial.println("Failed to add automation bridge peer");
      hasBridgePeer = false;
      return;
    }
  }

  hasBridgePeer = true;
  // Serial.println("Automation bridge peer ready");
}

bool isManualActive(const RemoteCommandData &commandData) {
  return commandData.xVal < LOW_THRESHOLD ||
         commandData.xVal > HIGH_THRESHOLD ||
         commandData.yVal < LOW_THRESHOLD ||
         commandData.yVal > HIGH_THRESHOLD;
}

// --- MOTOR LOGIC ---
void moveMotor() {
  unsigned long now = millis();

  if (isFrozen) {
    motorStop();
    return;
  }

  bool manualFresh = (now - lastManualTime) <= MANUAL_TIMEOUT_MS;
  bool autoFresh = (now - lastAutoTime) <= AUTO_TIMEOUT_MS;

  RemoteCommandData activeCommand = { 2048, 2048, false, false, false, false };
  if (manualFresh && isManualActive(manualData)) {
    activeCommand = manualData;
  } else if (autoFresh) {
    activeCommand = autoData;
  }
  handleHammerStrike(activeCommand);

  if (manualFresh && isManualActive(manualData)) {
    moveMotor(manualData);
  } else if (autoFresh) {
    moveMotor(autoData, true);
  } else {
    motorStop();
  }
}

void moveMotor(const RemoteCommandData &commandData, bool turnFirst) {
  if (commandData.xVal == 0 && commandData.yVal == 0) {
    motorStop();
    return;
  }

  if (turnFirst) {
    if (commandData.yVal > HIGH_THRESHOLD) {
      turnRight();
      return;
    }
    if (commandData.yVal < LOW_THRESHOLD) {
      turnLeft();
      return;
    }
  }

  if (commandData.xVal > HIGH_THRESHOLD) {
    moveBackward();
  } 
  else if (commandData.xVal < LOW_THRESHOLD) {
    moveForward();
  } 
  else if (commandData.yVal > HIGH_THRESHOLD) {
    turnRight();
  } 
  else if (commandData.yVal < LOW_THRESHOLD) { 
    turnLeft();
  } 
  else {
    motorStop();
  }
}

void moveForward() {
  digitalWrite(motorPinA, LOW);
  digitalWrite(motorPinB, HIGH);
  digitalWrite(motorPinC, LOW);
  digitalWrite(motorPinD, HIGH);
}

void moveBackward() {
  digitalWrite(motorPinA, HIGH);
  digitalWrite(motorPinB, LOW);
  digitalWrite(motorPinC, HIGH);
  digitalWrite(motorPinD, LOW);
}

void turnRight() {
  digitalWrite(motorPinA, HIGH);
  digitalWrite(motorPinB, LOW);
  digitalWrite(motorPinC, LOW);
  digitalWrite(motorPinD, HIGH);
}

void turnLeft() {
  digitalWrite(motorPinA, LOW);
  digitalWrite(motorPinB, HIGH);
  digitalWrite(motorPinC, HIGH);
  digitalWrite(motorPinD, LOW);
}

void motorStop() {
  digitalWrite(motorPinA, LOW);
  digitalWrite(motorPinB, LOW);
  digitalWrite(motorPinC, LOW);
  digitalWrite(motorPinD, LOW);    
}

void setup() {
  Serial.begin(115200);

  pinMode(HALL_SENSOR_PIN, INPUT);
  pinMode(LASER_RECEIVER_PIN, INPUT);
  pinMode(IRSENSOR1_PIN, INPUT);
  pinMode(IRSENSOR2_PIN, INPUT);

  pinMode(motorPinA, OUTPUT);
  pinMode(motorPinB, OUTPUT);
  pinMode(motorPinC, OUTPUT);
  pinMode(motorPinD, OUTPUT);

  motorStop(); // Force stop on boot

  // --- SERVO SETUP ---
  myServo.setPeriodHertz(50);
  myServo.attach(SERVO_PIN, 500, 2400);
  myServo.write(0); // Start at 0 degrees
  // -------------------

  MPUWire.begin(MPU_SDA_PIN, MPU_SCL_PIN, 400000);

  byte mpuStatus = mpu.begin();
  // Serial.print("MPU Status: ");
  // Serial.println(mpuStatus);
  if (mpuStatus == 0) {
    mpuReady = true;
    // Serial.println("Do not move Tank Bot. Calibrating MPU...");
    delay(2000);
    mpu.calcOffsets();
    // Serial.println("MPU calibration done");
  } else {
    // Serial.println("MPU6050 not found. m1 will stay at 0.");
  }

  WiFi.mode(WIFI_STA);

  if (esp_now_init() != ESP_OK) {
    // Serial.println("Error initializing ESP-NOW");
    return;
  }

  esp_now_register_send_cb(esp_now_send_cb_t(OnDataSent));

  memcpy(peerInfo.peer_addr, remoteMac, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    // Serial.println("Failed to add peer");
    return;
  }

  memcpy(peerInfo.peer_addr, battleGroundMac, 6);
  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    // Serial.println("Failed to add BattleGround peer");
    return;
  }
  // Serial.println("BattleGround peer added");

  esp_now_register_recv_cb(esp_now_recv_cb_t(OnDataRecv));
}

void loop() {
  if (mpuReady) {
    mpu.update();
  }

  // Read sensors continuously
  sensorData.hallValue = analogRead(HALL_SENSOR_PIN);
  sensorData.laserValue = digitalRead(LASER_RECEIVER_PIN);
  sensorData.ir1Value = digitalRead(IRSENSOR1_PIN);
  sensorData.ir2Value = digitalRead(IRSENSOR2_PIN);
  sensorData.m1 = mpuReady ? mpu.getAngleZ() : 0;

  unsigned long now = millis();

  if (sensorData.hallValue < HALL_THRESHOLD && !isFrozen) {
    isFrozen = true;
    freezeStartTime = now;
    motorStop();
    // Serial.println("Tank freeze activated by Hall sensor");
  }

  if (isFrozen && (now - freezeStartTime >= FREEZE_DURATION)) {
    isFrozen = false;
    // Serial.println("Tank freeze ended");
  }

  if (hammerState != HAMMER_IDLE) {
    if (now - lastHammerStepTime >= HAMMER_STEP_DELAY) {
      lastHammerStepTime = now;

      if (hammerState == HAMMER_STRIKING) {
        currentHammerAngle += HAMMER_STEP_SIZE;
        if (currentHammerAngle >= 120) {
          currentHammerAngle = 120;
          hammerState = HAMMER_RETURNING;
        }
      } else if (hammerState == HAMMER_RETURNING) {
        currentHammerAngle -= HAMMER_STEP_SIZE;
        if (currentHammerAngle <= 0) {
          currentHammerAngle = 0;
          hammerState = HAMMER_IDLE;
          // Serial.println("Hammer returned to rest");
        }
      }
      myServo.write(currentHammerAngle);
    }
  }

  moveMotor();

  // Non-blocking timer to send telemetry and print data every 500ms
  if (millis() - lastTelemetryTime >= 500) {
    lastTelemetryTime = millis();

    sendTelemetry();

    printRemoteCommandData("Manual: ", manualData);
    printRemoteCommandData("Auto:   ", autoData);

    // Debug prints
    // Serial.println("-------------------------------------------------");
    // Serial.print("Manual: X="); Serial.print(manualData.xVal);
    // Serial.print(" Y="); Serial.print(manualData.yVal);
    // Serial.print(" | Auto: X="); Serial.print(autoData.xVal);
    // Serial.print(" Y="); Serial.println(autoData.yVal);

    // Serial.print("Hall: "); Serial.print(sensorData.hallValue);
    // Serial.print(" | Laser: "); Serial.print(sensorData.laserValue);
    // Serial.print(" | IR1: "); Serial.print(sensorData.ir1Value);
    // Serial.print(" | IR2: "); Serial.print(sensorData.ir2Value);
    // Serial.print(" | m1: "); Serial.println(sensorData.m1);
  }
}

void sendTelemetry() {
  esp_now_send(remoteMac, (uint8_t *)&sensorData, sizeof(sensorData));
  esp_now_send(battleGroundMac, (uint8_t *)&sensorData, sizeof(sensorData));

  if (hasBridgePeer) {
    esp_now_send(bridgeMac, (uint8_t *)&sensorData, sizeof(sensorData));
  }
}
