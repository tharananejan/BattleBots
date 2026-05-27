#include <esp_now.h>
#include <WiFi.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>


uint8_t broadcastAddress[] = {0xAC, 0xA7, 0x04, 0x26, 0x85, 0xC4};
//AC:A7:04:26:85:C4 

// --- Frrezing variables
volatile bool isFrozen = false;
unsigned long freezeStartTime = 0;
const unsigned long FREEZE_DURATION = 10000; // 10 seconds


// OLED setup
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET   -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// Custom I2C pins
#define I2C_SDA 37
#define I2C_SCL 21

unsigned long timer = 0;

// Joystick 1
const int VRx1 = 17;
const int VRy1 = 16;
const int joySW1 = 11;
// Push buttons (For sending commands)
const int btn1 = 4;
const int btn2 = 5;

// --- RATE LIMITING / DEBOUNCE VARIABLES FOR btn4 ---
const unsigned long BUTTON_COOLDOWN = 10000;
unsigned long lastPressTime = -BUTTON_COOLDOWN;
static bool lastReadyState = false;
// ----------------------------------------------------

// Global health variable (0-100 range assumed)
volatile int currentHealth = 100; 

// Define the amount of damage taken per hit
const int DAMAGE_PER_HIT = 10;
const int DAMAGE_PER_HIT_IR = 2;
const int HALL_THRESHOLD = 100; // Threshold for Hall sensor to trigger freeze

// LED
const int damage = LED_BUILTIN;



typedef struct {
  int x1, y1;
  bool sw1;
  bool btn1, btn2;
} ControllerData;

// Receiving Data Structure (Bot Status/Damage Data)
typedef struct {
  bool d1;           // Laser Gun/Hit Signal
  bool ir1;         // IR Damage Sensor 1
  bool ir2;         // IR Damage Sensor 2
  int hallValue;    // Hall Sensor Analog Value 
} ReceivingData;

ControllerData ctrlData;


esp_now_peer_info_t peerInfo;

// Callback when data is sent
void OnDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
  Serial.print("\r\nLast Packet Send Status:\t");
  if (status == ESP_NOW_SEND_SUCCESS) {
    Serial.println("Data sent successfully");
  } else {
    Serial.println("Send failed");
  }
}

// Callback when data is received
void OnDataRecv(const uint8_t * mac, const uint8_t *incomingData, int len) {
  if (len == sizeof(ReceivingData)) {
    ReceivingData receivedData;
    memcpy(&receivedData, incomingData, sizeof(receivedData));
    
    bool receivedHitSignal = receivedData.d1;
    bool irDamage = (receivedData.ir1 || receivedData.ir2);
    int receivedHallValue = receivedData.hallValue;
    
    Serial.print("Received laser: "); Serial.print(receivedHitSignal);
    Serial.print(" Hall Value: "); Serial.println(receivedHallValue);
    Serial.println("Received");
    
    // --- 1. FREEZE LOGIC (Triggered by Hall Sensor Value) ---
    bool freezeSignal = (receivedHallValue < HALL_THRESHOLD);

    if (freezeSignal && !isFrozen) {
      isFrozen = true;
      freezeStartTime = millis();
      Serial.println("!!! FREEZE ACTIVATED for 10 seconds (Hall) !!!");
    }

    // --- 2. LASER GUN DAMAGE LOGIC (d1) ---
    if (!receivedHitSignal) {
      currentHealth -= DAMAGE_PER_HIT;
      if (currentHealth < 0) {
        currentHealth = 0;
      }
      Serial.print("Health Deducted by Laser! Current Health: ");
      Serial.println(currentHealth);
      
      digitalWrite(damage, HIGH);
      delay(50);
      digitalWrite(damage, LOW);
    }

    // --- 3. IR DAMAGE LOGIC (ir1/ir2) ---
    if (irDamage) { 
      currentHealth -= DAMAGE_PER_HIT_IR;
      if (currentHealth < 0) {
        currentHealth = 0;
      }
      Serial.print("Health Deducted by IR! Current Health: ");
      Serial.println(currentHealth);
      
      digitalWrite(damage, HIGH);
      delay(50);
      digitalWrite(damage, LOW);
      
    } else if (receivedHitSignal < 400 && !irDamage) {
      digitalWrite(damage, LOW);
    }

  } else {
    Serial.println("Received unexpected data size.");
  }
}
 
void setup() {
  // Init Serial Monitor
  Serial.begin(115200);


  WiFi.mode(WIFI_STA);

   pinMode(VRx1, INPUT);
  pinMode(VRy1, INPUT);
  pinMode(joySW1, INPUT_PULLUP);


  pinMode(btn1, INPUT_PULLUP);
  pinMode(btn2, INPUT_PULLUP);
  pinMode(damage, OUTPUT);

  // Initialize I2C on custom pins
  Wire.begin(I2C_SDA, I2C_SCL);

  // OLED init
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED failed");
    while (true);
  }
  //display.setRotation();
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.display();

  // Init ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }


  esp_now_register_send_cb(esp_now_send_cb_t(OnDataSent));
  
  // Register peer
  memcpy(peerInfo.peer_addr, broadcastAddress, 6);
  peerInfo.channel = 0;  
  peerInfo.encrypt = false;
  
  // Add peer        
  if (esp_now_add_peer(&peerInfo) != ESP_OK){
    Serial.println("Failed to add peer");
    return;
  }
  // Register for a callback function that will be called when data is received
  esp_now_register_recv_cb(esp_now_recv_cb_t(OnDataRecv));
}
 
void loop() {
  unsigned long currentTime = millis();

  // --- FREEZE STATE MANAGEMENT ---
  if (isFrozen) {
    if (currentTime - freezeStartTime >= FREEZE_DURATION) {
      isFrozen = false;
      Serial.println("Freeze ended. Resuming control.");
    }
  }

  // --- READ & SEND CONTROLLER DATA ---
  if (!isFrozen) {
    bool isReady = (currentTime - lastPressTime >= BUTTON_COOLDOWN);
    bool justPressed = false;
    int currentBtn4State = digitalRead(btn1);
    
    if (isReady && currentBtn4State == LOW) {
      lastPressTime = currentTime;
      ctrlData.btn1 = true;
      justPressed = true;
    } else {
      ctrlData.btn1 = (digitalRead(btn1) == LOW); 
    }

    ctrlData.x1 = analogRead(VRx1);
    ctrlData.y1 = analogRead(VRy1);
    ctrlData.sw1 = digitalRead(joySW1) == LOW;



    ctrlData.btn1 = digitalRead(btn1) == LOW;
    ctrlData.btn2 = digitalRead(btn2) == LOW;

    
    esp_now_send(broadcastAddress, (uint8_t *)&ctrlData, sizeof(ctrlData));
    
    if (justPressed) {
      ctrlData.btn1 = false;
    }

  } else {
    ctrlData.x1 = 0; 
    ctrlData.y1 = 0;
    ctrlData.sw1 = false;
    ctrlData.btn1 = false;
    ctrlData.btn2 = false;

    esp_now_send(broadcastAddress, (uint8_t *)&ctrlData, sizeof(ctrlData));
  }

  // --- OLED DRAWING ---
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0); 
  
  if (isFrozen) {
    unsigned long timePassed = currentTime - freezeStartTime;
    unsigned long timeRemaining = (timePassed < FREEZE_DURATION) ? (FREEZE_DURATION - timePassed) : 0;
    int secondsRemaining = timeRemaining / 1000;
    
    display.setTextSize(1);
    display.print("FREEZE! ");
    display.print("Time Left: ");
    display.print(secondsRemaining);
    display.println("s");
    
  
  } else {
    bool isReady = (currentTime - lastPressTime >= BUTTON_COOLDOWN);
    if (isReady) {
      display.println("READY");
    } else {
      unsigned long timeRemaining = BUTTON_COOLDOWN - (currentTime - lastPressTime);
      display.print("NR ");
    }
  }

  // 2. HEALTH BAR LOGIC 
  const int BAR_X = 0;
  const int BAR_Y = 20;
  const int MAX_BAR_WIDTH = 128; 
  const int BAR_HEIGHT = 10;
  const int MAX_HEALTH_VALUE = 100;

  int fillWidth = map(currentHealth, 0, MAX_HEALTH_VALUE, 0, MAX_BAR_WIDTH);
  fillWidth = constrain(fillWidth, 0, MAX_BAR_WIDTH);

  display.drawRect(BAR_X, BAR_Y, MAX_BAR_WIDTH, BAR_HEIGHT, SSD1306_WHITE);

  if (fillWidth > 0) {
    display.fillRect(BAR_X + 1, BAR_Y + 1, fillWidth - 2, BAR_HEIGHT - 2, SSD1306_WHITE);
  }
  
  display.setTextSize(1);
  display.setCursor(0,50);
  display.print("HP: ");
  display.print(currentHealth);
  display.print("/100");
 
  display.display();

  delay(100);
}
