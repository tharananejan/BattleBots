#include <esp_now.h>
#include <WiFi.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

uint8_t broadcastAddress[] = {0xAC, 0xA7, 0x04, 0x26, 0x85, 0xC4};

volatile bool isFrozen = false;
unsigned long freezeStartTime = 0;
const unsigned long FREEZE_DURATION = 10000; 

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET   -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

#define I2C_SDA 37
#define I2C_SCL 21

// Controller Peripherals
const int VRx1 = 17;
const int VRy1 = 16;
const int joySW1 = 11;
const int btn1 = 4;
const int btn2 = 5;
const int btn3 = 13; // ◄ NEW: Physical Automation Button wired to Pin 13

const unsigned long BUTTON_COOLDOWN = 10000;
unsigned long lastPressTime = -BUTTON_COOLDOWN;

volatile int currentHealth = 100; 
const int DAMAGE_PER_HIT = 10;
const int DAMAGE_PER_HIT_IR = 2;
const int HALL_THRESHOLD = 100; 

const int damage = LED_BUILTIN;

// Standardized Match Structs
typedef struct {
  int x1, y1;
  bool sw1;
  bool btn1, btn2;
  bool btn3; // ◄ NEW
} ControllerData;

typedef struct {
  bool d1;           
  bool ir1;          
  bool ir2;          
  int hallValue;     
  float m1;          
  bool automationActive; // ◄ NEW: Evaluated during reception to display state
} ReceivingData;

ControllerData ctrlData;
bool remoteAutomationState = false; // Internal tracking display state
esp_now_peer_info_t peerInfo;

void OnDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {}

void OnDataRecv(const uint8_t * mac, const uint8_t *incomingData, int len) {
  if (len == sizeof(ReceivingData)) {
    ReceivingData receivedData;
    memcpy(&receivedData, incomingData, sizeof(receivedData));
    
    bool receivedHitSignal = receivedData.d1;
    bool irDamage = (receivedData.ir1 || receivedData.ir2);
    int receivedHallValue = receivedData.hallValue;
    remoteAutomationState = receivedData.automationActive; // ◄ Sync UI view state

    bool freezeSignal = (receivedHallValue < HALL_THRESHOLD);
    if (freezeSignal && !isFrozen) {
      isFrozen = true;
      freezeStartTime = millis();
    }

    if (!receivedHitSignal) {
      currentHealth -= DAMAGE_PER_HIT;
      if (currentHealth < 0) currentHealth = 0;
      digitalWrite(damage, HIGH); delay(50); digitalWrite(damage, LOW);
    }

    if (irDamage) { 
      currentHealth -= DAMAGE_PER_HIT_IR;
      if (currentHealth < 0) currentHealth = 0;
      digitalWrite(damage, HIGH); delay(50); digitalWrite(damage, LOW);
    }
  }
}
 
void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);

  pinMode(VRx1, INPUT);
  pinMode(VRy1, INPUT);
  pinMode(joySW1, INPUT_PULLUP);
  pinMode(btn1, INPUT_PULLUP);
  pinMode(btn2, INPUT_PULLUP);
  pinMode(btn3, INPUT_PULLUP); // ◄ NEW
  pinMode(damage, OUTPUT);

  Wire.begin(I2C_SDA, I2C_SCL);
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.display();

  if (esp_now_init() != ESP_OK) return;

  esp_now_register_send_cb(esp_now_send_cb_t(OnDataSent));
  memcpy(peerInfo.peer_addr, broadcastAddress, 6);
  peerInfo.channel = 0;  
  peerInfo.encrypt = false;
  
  esp_now_add_peer(&peerInfo);
  esp_now_register_recv_cb(esp_now_recv_cb_t(OnDataRecv));
}
 
void loop() {
  unsigned long currentTime = millis();

  if (isFrozen) {
    if (currentTime - freezeStartTime >= FREEZE_DURATION) {
      isFrozen = false;
    }
  }

  if (!isFrozen) {
    bool isReady = (currentTime - lastPressTime >= BUTTON_COOLDOWN);
    int currentBtn1State = digitalRead(btn1);
    
    if (isReady && currentBtn1State == LOW) {
      lastPressTime = currentTime;
      ctrlData.btn1 = true;
    } else {
      ctrlData.btn1 = (digitalRead(btn1) == LOW); 
    }

    ctrlData.x1 = analogRead(VRx1);
    ctrlData.y1 = analogRead(VRy1);
    ctrlData.sw1 = digitalRead(joySW1) == LOW;
    ctrlData.btn2 = digitalRead(btn2) == LOW;
    ctrlData.btn3 = digitalRead(btn3) == LOW; // ◄ NEW: Populate outgoing packet

    esp_now_send(broadcastAddress, (uint8_t *)&ctrlData, sizeof(ctrlData));

  } else {
    ctrlData.x1 = 2048; ctrlData.y1 = 2048; // Standardized clean neutral centers
    ctrlData.sw1 = false; ctrlData.btn1 = false; ctrlData.btn2 = false; ctrlData.btn3 = false;
    esp_now_send(broadcastAddress, (uint8_t *)&ctrlData, sizeof(ctrlData));
  }

  // --- OLED DRAWING ---
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0); 
  
  if (isFrozen) {
    int secondsRemaining = (FREEZE_DURATION - (currentTime - freezeStartTime)) / 1000;
    display.print("FREEZE! Remaining: "); display.print(secondsRemaining); display.println("s");
  } else {
    // Render dynamic status mode tags
    if (remoteAutomationState) {
      display.println("MODE: AUTONOMOUS");
    } else {
      display.println("MODE: MANUAL");
    }
  }

  // Health rendering block
  display.drawRect(0, 20, 128, 10, SSD1306_WHITE);
  int fillWidth = map(currentHealth, 0, 100, 0, 128);
  if (fillWidth > 0) {
    display.fillRect(1, 21, fillWidth - 2, 8, SSD1306_WHITE);
  }
  
  display.setCursor(0, 50);
  display.print("HP: "); display.print(currentHealth); display.print("/100");
  display.display();

  delay(100);
}
