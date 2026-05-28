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

#define SERVO_PIN 11 

uint8_t remoteMac[] = { 0x10, 0x20, 0xBA, 0x40, 0xF6, 0x04 };
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

// ---------------- Standardized Data Structures ----------------
typedef struct {
  int xVal; 
  int yVal; 
  bool sw1;
  bool btn1;
  bool btn2;
  bool btn3; // ◄ NEW: Dedicated Automation Switch State
} RemoteCommandData;

typedef struct {
  bool laserValue;
  bool ir1Value;
  bool ir2Value;
  int hallValue;
  float m1;
  bool automationActive; // ◄ NEW: Communicates mode back to Remote and Bridge
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

// Automation state trackers
bool globalAutomationActive = false;
bool lastBtn3State = false;

// ---------------- Servo Variables ----------------
Servo myServo;
bool lastBtn2State = false; 
bool servoAt180 = false;    

// Forward declarations
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
void handleServoToggle(const RemoteCommandData &commandData);
void sendTelemetry();

void OnDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
  // Silent or debugging
}

void OnDataRecv(const uint8_t *mac, const uint8_t *incomingData, int len) {
  if (len != sizeof(RemoteCommandData)) {
    Serial.println("Unexpected command size");
    return;
  }

  RemoteCommandData incomingCommand;
  memcpy(&incomingCommand, incomingData, sizeof(incomingCommand));

  if (isSameMac(mac, remoteMac)) {
    manualData = incomingCommand;
    lastManualTime = millis();
    handleServoToggle(manualData);

    // Toggle Automation Mode cleanly when a rising edge of btn3 is noticed
    if (manualData.btn3 == true && lastBtn3State == false) {
      globalAutomationActive = !globalAutomationActive;
      Serial.print("Mode flipped by Physical Remote. Automation Active: ");
      Serial.println(globalAutomationActive);
    }
    lastBtn3State = manualData.btn3;

  } else {
    autoData = incomingCommand;
    lastAutoTime = millis();
    addBridgePeerIfNeeded(mac);
  }

  moveMotor();

  if (incomingCommand.btn1) {
    Serial.println("Button 1 pressed");
  }
}

void handleServoToggle(const RemoteCommandData &commandData) {
  if (commandData.btn2 == true && lastBtn2State == false) {
    servoAt180 = !servoAt180; 

    if (servoAt180) {
      myServo.write(180);
      Serial.println("Button 2 pressed: Servo toggled to 180 degrees");
    } else {
      myServo.write(0);
      Serial.println("Button 2 pressed: Servo toggled to 0 degrees");
    }
  }
  lastBtn2State = commandData.btn2;
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
      Serial.println("Failed to add automation bridge peer");
      hasBridgePeer = false;
      return;
    }
  }

  hasBridgePeer = true;
  Serial.println("Automation bridge peer ready");
}

bool isManualActive(const RemoteCommandData &commandData) {
  return commandData.xVal < LOW_THRESHOLD ||
         commandData.xVal > HIGH_THRESHOLD ||
         commandData.yVal < LOW_THRESHOLD ||
         commandData.yVal > HIGH_THRESHOLD;
}

void moveMotor() {
  unsigned long now = millis();

  if (isFrozen) {
    motorStop();
    return;
  }

  bool manualFresh = (now - lastManualTime) <= MANUAL_TIMEOUT_MS;
  bool autoFresh = (now - lastAutoTime) <= AUTO_TIMEOUT_MS;

  // Decide contextually which dataset handles movement priority
  if (!globalAutomationActive) {
    if (manualFresh && isManualActive(manualData)) {
      moveMotor(manualData);
    } else {
      motorStop();
    }
  } else {
    // Automation mode is active
    if (autoFresh) {
      moveMotor(autoData, true);
    } else {
      motorStop();
    }
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

void moveForward()  { digitalWrite(motorPinA, LOW);  digitalWrite(motorPinB, HIGH); digitalWrite(motorPinC, LOW);  digitalWrite(motorPinD, HIGH); }
void moveBackward() { digitalWrite(motorPinA, HIGH); digitalWrite(motorPinB, LOW);  digitalWrite(motorPinC, HIGH); digitalWrite(motorPinD, LOW);  }
void turnRight()    { digitalWrite(motorPinA, HIGH); digitalWrite(motorPinB, LOW);  digitalWrite(motorPinC, LOW);  digitalWrite(motorPinD, HIGH); }
void turnLeft()     { digitalWrite(motorPinA, LOW);  digitalWrite(motorPinB, HIGH); digitalWrite(motorPinC, HIGH); digitalWrite(motorPinD, LOW);  }
void motorStop()    { digitalWrite(motorPinA, LOW);  digitalWrite(motorPinB, LOW);  digitalWrite(motorPinC, LOW);  digitalWrite(motorPinD, LOW);   }

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

  motorStop(); 

  myServo.setPeriodHertz(50);
  myServo.attach(SERVO_PIN, 500, 2400);
  myServo.write(0); 

  MPUWire.begin(MPU_SDA_PIN, MPU_SCL_PIN, 400000);

  byte mpuStatus = mpu.begin();
  if (mpuStatus == 0) {
    mpuReady = true;
    delay(2000);
    mpu.calcOffsets();
  }

  WiFi.mode(WIFI_STA);

  if (esp_now_init() != ESP_OK) {
    return;
  }

  esp_now_register_send_cb(esp_now_send_cb_t(OnDataSent));

  memcpy(peerInfo.peer_addr, remoteMac, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;

  esp_now_add_peer(&peerInfo);
  esp_now_register_recv_cb(esp_now_recv_cb_t(OnDataRecv));
}

void loop() {
  if (mpuReady) {
    mpu.update();
  }

  sensorData.hallValue = analogRead(HALL_SENSOR_PIN);
  sensorData.laserValue = digitalRead(LASER_RECEIVER_PIN);
  sensorData.ir1Value = digitalRead(IRSENSOR1_PIN);
  sensorData.ir2Value = digitalRead(IRSENSOR2_PIN);
  sensorData.m1 = mpuReady ? mpu.getAngleZ() : 0;
  sensorData.automationActive = globalAutomationActive; // ◄ Continually feed back state

  unsigned long now = millis();

  if (sensorData.hallValue < HALL_THRESHOLD && !isFrozen) {
    isFrozen = true;
    freezeStartTime = now;
    motorStop();
  }

  if (isFrozen && (now - freezeStartTime >= FREEZE_DURATION)) {
    isFrozen = false;
  }

  moveMotor();

  if (millis() - lastTelemetryTime >= 500) {
    lastTelemetryTime = millis();
    sendTelemetry();
  }
}

void sendTelemetry() {
  esp_now_send(remoteMac, (uint8_t *)&sensorData, sizeof(sensorData));
  if (hasBridgePeer) {
    esp_now_send(bridgeMac, (uint8_t *)&sensorData, sizeof(sensorData));
  }
}
