#include <WiFi.h> 
#include <esp_now.h> 
#include <Wire.h> 
#include <Adafruit_GFX.h> 
#include <Adafruit_SSD1306.h> 

// OLED setup 
#define SCREEN_WIDTH 128 
#define SCREEN_HEIGHT 64 
#define OLED_RESET -1 
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET); 

// Custom I2C pins 
#define I2C_SDA 37 
#define I2C_SCL 21 

// Joystick 1 
const int VRx1 = 17; 
const int VRy1 = 16; 
const int joySW1 = 11; 

// Joystick 2 
const int VRx2 = 9; 
const int VRy2 = 8; 
const int joySW2 = 12; 

// Push buttons 
const int btn1 = 4; 
const int btn2 = 5; 
const int btn3 = 6; 
const int btn4 = 7; 

// --- RATE LIMITING / DEBOUNCE VARIABLES FOR ROBOT FUNCTIONS --- 
const unsigned long ACTUATOR_1_COOLDOWN = 10000; 
const unsigned long ACTUATOR_2_COOLDOWN = 10000; 

unsigned long lastAct1Press = -ACTUATOR_1_COOLDOWN; 
unsigned long lastAct2Press = -ACTUATOR_2_COOLDOWN; 
unsigned long timer = 0; 
unsigned long timer2 = 0; 
unsigned long oledTimer = 0; 
unsigned long statusLedOffAt = 0; 
volatile bool statusLedOn = false; 

// Global system status
volatile int systemLevel = 100; 
const int statusIndicatorPin = 48; 

// Device MAC addresses 
uint8_t receiver1Mac[] = {0x10, 0x20, 0xBA, 0x4C, 0xE3, 0x30};         
uint8_t receiver2Mac[] = { 0x10, 0x20, 0xBA, 0x4C, 0x50, 0x8C }; 

// Sending Data structure 
typedef struct { 
  int x1, y1; 
  bool sw1; 
  int x2, y2; 
  bool sw2; 
  bool btn1, btn2, btn3, btn4; 
} ControllerData; 
ControllerData ctrlData; 

typedef struct { 
  int act1; 
  int act2; 
} PowerValues; 
PowerValues power; 

// Receiving Data Structure 
typedef struct { 
  int d1; 
  bool sensor1; 
  bool sensor2; 
  float m1; 
} ReceivingData; 

// ESP-NOW callbacks (FIXED: matching wifi_tx_info_t for Core v3.x)
void onDataSent(const wifi_tx_info_t *tx_info, esp_now_send_status_t status) {} 

void onDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *incomingData, int len) { 
  if (len == sizeof(ReceivingData)) { 
    ReceivingData receivedData; 
    memcpy(&receivedData, incomingData, sizeof(receivedData)); 
    int trigger = (receivedData.d1 > 400 || receivedData.sensor1 || receivedData.sensor2) ? 1 : 0; 
    if (trigger) { 
      systemLevel -= 5; 
      if (systemLevel < 0) systemLevel = 0; 
      digitalWrite(statusIndicatorPin, HIGH); 
      statusLedOn = true; 
      statusLedOffAt = millis() + 50; 
    } 
  } else { 
    Serial.println("Received unexpected data size."); 
  } 
} 

void setup() { 
  Serial.begin(115200); 
  WiFi.mode(WIFI_STA); 

  // Pin setup 
  pinMode(VRx1, INPUT); 
  pinMode(VRy1, INPUT); 
  pinMode(joySW1, INPUT_PULLUP); 
  pinMode(VRx2, INPUT); 
  pinMode(VRy2, INPUT); 
  pinMode(joySW2, INPUT_PULLUP); 
  pinMode(btn1, INPUT_PULLUP); 
  pinMode(btn2, INPUT_PULLUP); 
  pinMode(btn3, INPUT_PULLUP); 
  pinMode(btn4, INPUT_PULLUP); 
  pinMode(statusIndicatorPin, OUTPUT); 

  // Initialize I2C on custom pins 
  Wire.begin(I2C_SDA, I2C_SCL); 

  // OLED init 
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { 
    Serial.println("OLED failed"); 
    while (true); 
  } 
  display.setRotation(2); 
  display.clearDisplay(); 
  display.setTextSize(1); 
  display.setTextColor(SSD1306_WHITE); 
  display.display(); 

  // ESP-NOW init 
  if (esp_now_init() != ESP_OK) { 
    Serial.println("ESP-NOW init failed"); 
    return; 
  } 
  esp_now_register_send_cb(onDataSent); 
  esp_now_register_recv_cb(onDataRecv); 

  // Register Peer 1
  esp_now_peer_info_t peerInfo1 = {}; 
  memcpy(peerInfo1.peer_addr, receiver1Mac, 6); 
  peerInfo1.channel = 1; 
  peerInfo1.encrypt = false; 
  if (esp_now_add_peer(&peerInfo1) != ESP_OK) { 
    Serial.println("Failed to add Peer 1"); 
    return; 
  } 

  // Register Peer 2
  esp_now_peer_info_t peerInfo2 = {}; 
  memcpy(peerInfo2.peer_addr, receiver2Mac, 6); 
  peerInfo2.channel = 1; 
  peerInfo2.encrypt = false; 
  if (esp_now_add_peer(&peerInfo2) != ESP_OK) { 
    Serial.println("Failed to add Peer 2"); 
    return; 
  } 

  Serial.println("Setup complete"); 
} 

void loop() { 
  if (statusLedOn && (long)(millis() - statusLedOffAt) >= 0) { 
    digitalWrite(statusIndicatorPin, LOW); 
    statusLedOn = false; 
  } 

  unsigned long currentTime = millis(); 
  bool act1Ready = (currentTime - lastAct1Press >= ACTUATOR_1_COOLDOWN); 
  bool act2Ready = (currentTime - lastAct2Press >= ACTUATOR_2_COOLDOWN); 

  int currentAct1Signal = 0; 
  int currentAct2Signal = 0; 

  // --- ACTUATOR 1 LOGIC (BTN4) --- 
  if (act1Ready && digitalRead(btn4) == LOW) { 
    lastAct1Press = currentTime; 
    ctrlData.btn4 = true; 
    currentAct1Signal = 1; 
  } else { 
    ctrlData.btn4 = false; 
    currentAct1Signal = 0; 
  } 

  // --- ACTUATOR 2 LOGIC (BTN3) --- 
  if (act2Ready && digitalRead(btn3) == LOW) { 
    lastAct2Press = currentTime; 
    ctrlData.btn3 = true; 
    currentAct2Signal = 1; 
  } else { 
    ctrlData.btn3 = false; 
    currentAct2Signal = 0; 
  } 

  // Read joystick and button values 
  ctrlData.x1 = analogRead(VRx1); 
  ctrlData.y1 = analogRead(VRy1); 
  ctrlData.sw1 = digitalRead(joySW1) == LOW; 
  ctrlData.x2 = analogRead(VRx2); 
  ctrlData.y2 = analogRead(VRy2); 
  ctrlData.sw2 = digitalRead(joySW2) == LOW; 
  ctrlData.btn1 = digitalRead(btn1) == LOW; 
  ctrlData.btn2 = digitalRead(btn2) == LOW; 

  power.act1 = currentAct1Signal; 
  power.act2 = currentAct2Signal; 

  // Communication timing
  if ((currentTime - timer) > 15) { 
    esp_now_send(receiver2Mac, (uint8_t *)&power, sizeof(power)); 
    timer = currentTime; 
  } 

  if ((currentTime - timer2) > 10) { 
    esp_now_send(receiver1Mac, (uint8_t *)&ctrlData, sizeof(ctrlData)); 
    timer2 = currentTime; 
  } 

  // --- OLED UPDATE --- 
  if (currentTime - oledTimer >= 100) { 
    oledTimer = currentTime; 
    display.setRotation(0); 
    display.clearDisplay(); 
    display.setCursor(0, 0); 
    display.setTextColor(SSD1306_WHITE); 

    display.print("ACT1: "); 
    display.println(act1Ready ? "READY" : "WAIT"); 
    display.print("ACT2: "); 
    display.println(act2Ready ? "READY" : "WAIT"); 

    int fillWidth = map(systemLevel, 0, 100, 0, 118); 
    display.drawRect(0, 45, 118, 8, SSD1306_WHITE); 
    if (fillWidth > 0) display.fillRect(1, 46, fillWidth - 2, 6, SSD1306_WHITE); 
    display.display(); 
  } 
}
