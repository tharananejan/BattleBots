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

unsigned long timer = 0;

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
const unsigned long BUTTON_COOLDOWN = 10000;
unsigned long lastPressTime = -BUTTON_COOLDOWN;
static bool lastReadyState = false;
// ----------------------------------------------------
// Global health variable (0-100 range assumed)
volatile int currentHealth = 100; 

// Define the amount of damage taken per hit
const int DAMAGE_PER_HIT = 10;
const int DAMAGE_PER_HIT_IR = 2;

// LED
const int damage = LED_BUILTIN;

// Server MAC address
uint8_t serverMac[] = {0x10, 0x20, 0xBA, 0x4C, 0xE3, 0x30};

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

typedef struct{
  int d1;
  bool ir1;
  bool ir2;
} ReceivingData;




// ESP-NOW callbacks
void onDataSent(const wifi_tx_info_t *tx_info, esp_now_send_status_t status) {
  Serial.print("Last Packet Send Status: ");
    if (status == ESP_NOW_SEND_SUCCESS) {
        Serial.println("Delivery Success");
    } else {
        Serial.println("Delivery Fail");
    }
}

void onDataRecv(const esp_now_recv_info *recv_info, const uint8_t *incomingData, int len) {
    // 2. Check the length to ensure a complete structure was received
    if (len == sizeof(ReceivingData)) {
        ReceivingData receivedData;
        // 3. Copy the raw bytes directly into the structure variable
        memcpy(&receivedData, incomingData, sizeof(receivedData));
        
        

        int receivedHitSignal=receivedData.d1;
        int irDamage=(receivedData.ir1 || receivedData.ir2);
        //memcpy(&receivedHitSignal, incomingData, sizeof(receivedHitSignal));
        
        Serial.print("Received Signal: ");
        Serial.println(receivedHitSignal);
        
        // --- DAMAGE LOGIC: Check for the "Hit" signal (Value of 1) ---
        if(receivedHitSignal>400){
          receivedHitSignal = 1;
        }

        if (receivedHitSignal == 1) { 
          
          // 1. Deduct health
          currentHealth -= DAMAGE_PER_HIT;
          
          // 2. Ensure health does not drop below 0
          if (currentHealth < 0) {
            currentHealth = 0;
          }
          Serial.print("Health Deducted! Current Health: ");
          Serial.println(currentHealth);
          
          
          digitalWrite(damage, HIGH);
          delay(50); // Blink ON
          digitalWrite(damage, LOW);
          
        } else {
            // Received a 0 (or other signal), keep LED off.
            digitalWrite(damage, LOW);
        }

        if (irDamage == 1) { 
          
          // 1. Deduct health
          currentHealth -= DAMAGE_PER_HIT_IR;
          
          // 2. Ensure health does not drop below 0
          if (currentHealth < 0) {
            currentHealth = 0;
          }
          Serial.print("Health Deducted by IR! Current Health: ");
          Serial.println(currentHealth);
          
          
          digitalWrite(damage, HIGH);
          delay(50); // Blink ON
          digitalWrite(damage, LOW);
          
        } else {
            // Received a 0 (or other signal), keep LED off.
            digitalWrite(damage, LOW);
        }

    }
 
    
        
  else {
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

  unsigned long currentTime = millis();
  bool isReady = (currentTime - lastPressTime >= BUTTON_COOLDOWN);
  bool justPressed = false;

  int currentBtn4State = digitalRead(btn4);
  if (isReady && currentBtn4State == LOW) {
    lastPressTime = currentTime;
    ctrlData.btn4 = true;
    Serial.print("BTN4 Activated Status");
    Serial.println(ctrlData.btn4);
    justPressed = true;
  } else {
    ctrlData.btn4 = false;
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
  esp_now_send(serverMac, (uint8_t *)&ctrlData, sizeof(ctrlData));
  if (justPressed) {
  ctrlData.btn4 = false;
  }
  // --- OLED DRAWING ---
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);


  
  // Joystick 1 (J1)

  if (isReady != lastReadyState) {
    //Serial.print("Button Status: ");
    //Serial.println(ctrlData.btn4);
    Serial.println(isReady ? "READY" : "NR");
    lastReadyState = isReady;
  }
  display.setCursor(0, 0); // Row 1

  // ----------------------------------------------------
  if (isReady) {
    display.println("READY");
  } else {
    unsigned long timeRemaining = BUTTON_COOLDOWN - (currentTime - lastPressTime);
    display.println("NOT READY");
  }
  // 2. HEALTH BAR LOGIC (Bottom Half)
  
  const int BAR_X = 0;
  const int BAR_Y = 30; // Placed near the bottom, after button data
  const int MAX_BAR_WIDTH = 118; 
  const int BAR_HEIGHT = 8;
  const int MAX_HEALTH_VALUE = 100;

  // Calculate the filled width based on the current health (0 to 100)
  int fillWidth = map(currentHealth, 0, MAX_HEALTH_VALUE, 0, MAX_BAR_WIDTH);

  // Draw the background/border for the health bar
  display.drawRect(BAR_X, BAR_Y, MAX_BAR_WIDTH, BAR_HEIGHT, SSD1306_WHITE);

  // Draw the filled part (the actual health level)
  if (fillWidth > 2) {
    display.fillRect(BAR_X + 1, BAR_Y + 1, fillWidth - 2, BAR_HEIGHT - 2, SSD1306_WHITE);
  } else if (fillWidth > 0) {
    display.fillRect(BAR_X + 1, BAR_Y + 1, 1, BAR_HEIGHT - 2, SSD1306_WHITE);
  }
  
 
  display.setTextSize(1);
  display.display();

  delay(100);
}
