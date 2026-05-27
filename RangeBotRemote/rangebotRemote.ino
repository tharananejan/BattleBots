#include <WiFi.h>
#include <esp_now.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// OLED setup
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
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
const int btn1 = 4; //api wada karana button eka
const int btn2 = 5;
const int btn3 = 6;
const int btn4 = 7; 

// --- RATE LIMITING / DEBOUNCE VARIABLES FOR btn4 ---
const unsigned long FAN_COOLDOWN = 10000;  // 10 Seconds
const unsigned long LASER_COOLDOWN = 10000;

unsigned long lastFanPress = -FAN_COOLDOWN;
unsigned long lastLaserPress = -LASER_COOLDOWN;
unsigned long timer = 0;
unsigned long timer2 = 0;
unsigned long oledTimer = 0;
unsigned long damageLedOffAt = 0;
volatile bool damageLedOn = false;

// Global health
volatile int currentHealth = 100;
const int damage = 48;
// Server MAC address
uint8_t serverMac[] = {0x10, 0x20, 0xBA, 0x4C, 0xE3, 0x30};
uint8_t centralDeviceMac[] = { 0x10, 0x20, 0xBA, 0x4C, 0x50, 0x8C };
// Sending Data structure
typedef struct {
  int x1, y1;
  bool sw1;
  int x2, y2;
  bool sw2;
  bool btn1, btn2, btn3, btn4;
} ControllerData;

//Receiving Data Structure

ControllerData ctrlData;


typedef struct {
  int fan;
  int laser;
} PowerValues;
PowerValues power;

typedef struct {
  int d1;
  bool ir1;
  bool ir2;
  float m1;
} ReceivingData;

// ESP-NOW callbacks

void onDataSent(const wifi_tx_info_t *tx_info, esp_now_send_status_t status) {}

void onDataRecv(const esp_now_recv_info *recv_info, const uint8_t *incomingData, int len) {
  if (len == sizeof(ReceivingData)) {
    ReceivingData receivedData;
    memcpy(&receivedData, incomingData, sizeof(receivedData));
    int hit = (receivedData.d1 > 400 || receivedData.ir1 || receivedData.ir2) ? 1 : 0;
    if (hit) {
      currentHealth -= 5;
      if (currentHealth < 0) currentHealth = 0;
      digitalWrite(damage, HIGH);
      damageLedOn = true;
      damageLedOffAt = millis() + 50;
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
  pinMode(damage, OUTPUT);

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

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, serverMac, 6);
  //was previously as peerInfo.channel=0;
  peerInfo.channel = 1;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("Peer add failed");
    return;
  }

  Serial.println("Setup complete");
}

void loop() {
  if (damageLedOn && (long)(millis() - damageLedOffAt) >= 0) {
    digitalWrite(damage, LOW);
    damageLedOn = false;
  }

  unsigned long currentTime = millis();
 
 bool fanReady = (currentTime - lastFanPress >= FAN_COOLDOWN);
  bool laserReady = (currentTime - lastLaserPress >= LASER_COOLDOWN);

  // Local variables to decide what to send to Central Device
  int currentFanSignal = 0;
  int currentLaserSignal = 0;

  // --- FAN LOGIC (BTN4) ---
  if (fanReady && digitalRead(btn4) == LOW) {
    lastFanPress = currentTime;
    ctrlData.btn4 = true;
    currentFanSignal = 1;
  } else {
    ctrlData.btn4 = false;
    currentFanSignal = 0;
  }

  // --- LASER LOGIC (BTN3) ---
  if (laserReady && digitalRead(btn3) == LOW) {
    lastLaserPress = currentTime;
    ctrlData.btn3 = true;
    currentLaserSignal = 1;
  } else {
    ctrlData.btn3 = false;
    currentLaserSignal = 0;
  }

  // Read joystick and button values (Remains the same)
  ctrlData.x1 = analogRead(VRx1);
  ctrlData.y1 = analogRead(VRy1);
  ctrlData.sw1 = digitalRead(joySW1) == LOW;

  ctrlData.x2 = analogRead(VRx2);
  ctrlData.y2 = analogRead(VRy2);
  ctrlData.sw2 = digitalRead(joySW2) == LOW;

  ctrlData.btn1 = digitalRead(btn1) == LOW;
  ctrlData.btn2 = digitalRead(btn2) == LOW;
  ctrlData.btn3 = digitalRead(btn3) == LOW;
  ctrlData.btn4 = digitalRead(btn4) == LOW;

  // Send data (Remains the same)
  power.fan = currentFanSignal;
  power.laser = currentLaserSignal;

  if ((millis() - timer) > 15) {
  // 1. To Central Device (Battleground)
    esp_now_send(centralDeviceMac, (uint8_t *)&power, sizeof(power));
    timer = millis();
  }

  if ((millis() - timer2) > 10) {
    // 2. To Server (Range Bot)
    esp_now_send(serverMac, (uint8_t *)&ctrlData, sizeof(ctrlData));
    timer2 = millis();
  }


  // --- OLED ---
  if (millis() - oledTimer >= 100) {
    oledTimer = millis();
    display.setRotation(0);
    display.clearDisplay();
    display.setCursor(0, 0);
    display.setTextColor(SSD1306_WHITE);

    display.print("FAN: ");
    display.println(fanReady ? "RDY" : "CD");
    display.print("LSR: ");
    display.println(laserReady ? "RDY" : "CD");

    int fillWidth = map(currentHealth, 0, 100, 0, 118);
    display.drawRect(0, 45, 118, 8, SSD1306_WHITE);
    if (fillWidth > 0) display.fillRect(1, 46, fillWidth - 2, 6, SSD1306_WHITE);

    display.display();
}}
