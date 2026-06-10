#include <esp_now.h>
#include <WiFi.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>


uint8_t broadcastAddress[] = {0xAC, 0xA7, 0x04, 0x26, 0x85, 0xC4};
//AC:A7:04:26:85:C4
uint8_t battleGroundMac[] = {0x10, 0x20, 0xBA, 0x4C, 0x50, 0x8C};

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
const int btn1 = 6;
const int btn2 = 5;

// --- Manual / Automated mode (btn2 hold 5s) ---
const unsigned long MODE_HOLD_MS = 5000;
const unsigned long MANUAL_LABEL_MS = 500;
const int JOYSTICK_CENTER = 2048;

bool isAutomatedMode = false;
unsigned long btn2PressStart = 0;
bool btn2Holding = false;
bool btn2HoldHandled = false;
unsigned long manualDisplayUntil = 0;

// Global health variable (0-100 range assumed)
volatile int currentHealth = 100;
volatile int enemyHealth = 100;
unsigned long lastBattleGroundMsgTime = 0;
const unsigned long BG_TIMEOUT_MS = 2000;

const int HALL_THRESHOLD = 100;

// LED
const int damage = LED_BUILTIN;



typedef struct {
  uint8_t rangeHealth;
  uint8_t tankHealth;
  uint32_t fanCooldownMs;
  uint32_t laserCooldownMs;
} GlobalStateData;

typedef struct {
  bool isAutomatedMode;
} ModeControlData;

typedef struct {
  int x1;
  int y1;
  bool sw1;
  bool btn1, btn2;
  bool isAutomatedMode;
} ControllerData;

// Receiving Data Structure (Bot Status/Damage Data)
typedef struct {
  bool d1;           // Laser Gun/Hit Signal
  bool ir1;         // IR Damage Sensor 1
  bool ir2;         // IR Damage Sensor 2
  int hallValue;    // Hall Sensor Analog Value 
  float m1;
} ReceivingData;

ControllerData ctrlData;


esp_now_peer_info_t peerInfo;

void drawCenteredText(const char *text, uint8_t textSize, int16_t y) {
  display.setTextSize(textSize);
  int16_t x1, y1;
  uint16_t w, h;
  display.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  display.setCursor((SCREEN_WIDTH - (int16_t)w) / 2, y);
  display.println(text);
}

void showLoadingScreen() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  drawCenteredText("Mahasona", 2, 8);
  drawCenteredText("Squad", 2, 32);
  display.display();
  delay(1000);
}

// Callback when data is sent
void OnDataSent(const wifi_tx_info_t *tx_info, esp_now_send_status_t status) {
  Serial.print("\r\nLast Packet Send Status:\t");
  if (status == ESP_NOW_SEND_SUCCESS) {
    Serial.println("Data sent successfully");
  } else {
    Serial.println("Send failed");
  }
}

// Callback when data is received
void OnDataRecv(const esp_now_recv_info *recv_info, const uint8_t *incomingData, int len) {
  const uint8_t *mac = recv_info->src_addr;
  if (len == sizeof(GlobalStateData) && memcmp(mac, battleGroundMac, 6) == 0) {
    GlobalStateData state;
    memcpy(&state, incomingData, sizeof(state));
    lastBattleGroundMsgTime = millis();
    if (state.tankHealth < currentHealth) {
      digitalWrite(damage, HIGH);
      delay(50);
      digitalWrite(damage, LOW);
    }
    currentHealth = state.tankHealth;
    enemyHealth = state.rangeHealth;
    return;
  }

  if (len == sizeof(ModeControlData) && memcmp(mac, battleGroundMac, 6) == 0) {
    ModeControlData mode;
    memcpy(&mode, incomingData, sizeof(mode));
    isAutomatedMode = mode.isAutomatedMode;
    if (!isAutomatedMode) {
      manualDisplayUntil = millis() + MANUAL_LABEL_MS;
    }
    Serial.println(isAutomatedMode ? "Mode set from BattleGround: Automated"
                                 : "Mode set from BattleGround: Manual");
    return;
  }

  if (len == sizeof(ReceivingData)) {
    ReceivingData receivedData;
    memcpy(&receivedData, incomingData, sizeof(receivedData));

    bool receivedHitSignal = receivedData.d1;
    bool irDamage = (receivedData.ir1 || receivedData.ir2);
    int receivedHallValue = receivedData.hallValue;

    bool freezeSignal = (receivedHallValue < HALL_THRESHOLD);
    if (freezeSignal && !isFrozen) {
      isFrozen = true;
      freezeStartTime = millis();
      Serial.println("!!! FREEZE ACTIVATED for 10 seconds (Hall) !!!");
    }

    if (!receivedHitSignal || irDamage) {
      digitalWrite(damage, HIGH);
      delay(50);
      digitalWrite(damage, LOW);
    } else if (receivedHitSignal && !irDamage) {
      digitalWrite(damage, LOW);
    }
    return;
  }

  Serial.println("Received unexpected data size.");
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
  display.setTextColor(SSD1306_WHITE);
  showLoadingScreen();

  // Init ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }


  esp_now_register_send_cb(OnDataSent);
  
  // Register peer
  memcpy(peerInfo.peer_addr, broadcastAddress, 6);
  peerInfo.channel = 0;  
  peerInfo.encrypt = false;
  
  // Add peer (TankBot)
  if (esp_now_add_peer(&peerInfo) != ESP_OK){
    Serial.println("Failed to add TankBot peer");
    return;
  }

  memcpy(peerInfo.peer_addr, battleGroundMac, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;
  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("Failed to add BattleGround peer");
    return;
  }

  // Register for a callback function that will be called when data is received
  esp_now_register_recv_cb(OnDataRecv);
}
 
void handleModeHold(unsigned long currentTime, bool btn2Down) {
  if (btn2Down) {
    if (!btn2Holding) {
      btn2Holding = true;
      btn2PressStart = currentTime;
      btn2HoldHandled = false;
    } else if (!btn2HoldHandled && (currentTime - btn2PressStart >= MODE_HOLD_MS)) {
      isAutomatedMode = !isAutomatedMode;
      btn2HoldHandled = true;
      if (!isAutomatedMode) {
        manualDisplayUntil = currentTime + MANUAL_LABEL_MS;
      }
      Serial.println(isAutomatedMode ? "Button 2 held 5s: Automated mode ON"
                                   : "Button 2 held 5s: Manual mode ON");
    }
  } else {
    btn2Holding = false;
    btn2HoldHandled = false;
  }
}

void loop() {
  unsigned long currentTime = millis();
  bool btn2Down = digitalRead(btn2) == LOW;
  static bool prevBtn2Down = false;
  static bool prevBtn1Down = false;

  handleModeHold(currentTime, btn2Down);

  if (isFrozen) {
    if (currentTime - freezeStartTime >= FREEZE_DURATION) {
      isFrozen = false;
      Serial.println("Freeze ended. Resuming control.");
    }
  }

  ctrlData.isAutomatedMode = isAutomatedMode;

  if (currentHealth > 0 && !isFrozen && !isAutomatedMode) {
    bool btn1Down = digitalRead(btn1) == LOW;
    if (btn1Down && !prevBtn1Down) {
      Serial.println("Button 1 pressed");
    }

    ctrlData.x1 = analogRead(VRx1);
    ctrlData.y1 = analogRead(VRy1);
    ctrlData.sw1 = digitalRead(joySW1) == LOW;
    ctrlData.btn1 = btn1Down;
    ctrlData.btn2 = false;

    esp_now_send(broadcastAddress, (uint8_t *)&ctrlData, sizeof(ctrlData));
    esp_now_send(battleGroundMac, (uint8_t *)&ctrlData, sizeof(ctrlData));

    if (prevBtn2Down && !btn2Down && !btn2HoldHandled &&
        (currentTime - btn2PressStart < MODE_HOLD_MS)) {
      ControllerData humidifierPulse = ctrlData;
      humidifierPulse.btn2 = true;
      esp_now_send(battleGroundMac, (uint8_t *)&humidifierPulse, sizeof(humidifierPulse));
      Serial.println("Button 2 pressed. Signal sent to BattleGround.");
    }
  } else if (currentHealth > 0 && !isFrozen && isAutomatedMode) {
    ctrlData.x1 = JOYSTICK_CENTER;
    ctrlData.y1 = JOYSTICK_CENTER;
    ctrlData.sw1 = false;
    ctrlData.btn1 = false;
    ctrlData.btn2 = false;

    esp_now_send(broadcastAddress, (uint8_t *)&ctrlData, sizeof(ctrlData));
    esp_now_send(battleGroundMac, (uint8_t *)&ctrlData, sizeof(ctrlData));
  } else {
    ctrlData.x1 = 0;
    ctrlData.y1 = 0;
    ctrlData.sw1 = false;
    ctrlData.btn1 = false;
    ctrlData.btn2 = false;

    esp_now_send(broadcastAddress, (uint8_t *)&ctrlData, sizeof(ctrlData));
    esp_now_send(battleGroundMac, (uint8_t *)&ctrlData, sizeof(ctrlData));
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  bool battleGroundConnected = (lastBattleGroundMsgTime > 0) &&
                               (currentTime - lastBattleGroundMsgTime <= BG_TIMEOUT_MS);

  if (!battleGroundConnected) {
    drawCenteredText("BattleGround", 1, 16);
    drawCenteredText("Not Connected", 1, 32);
  } else if (currentHealth == 0) {
    drawCenteredText("Game Over", 2, 20);
  } else if (enemyHealth == 0) {
    drawCenteredText("Victory", 2, 20);
  } else {
    display.setTextSize(1);
    display.setCursor(0, 0);

    if (isFrozen) {
      unsigned long timePassed = currentTime - freezeStartTime;
      unsigned long timeRemaining = (timePassed < FREEZE_DURATION) ? (FREEZE_DURATION - timePassed) : 0;
      display.print("FREEZE! ");
      display.print(timeRemaining / 1000);
      display.println("s");
    } else if (isAutomatedMode) {
      display.println("Automated");
    } else if (currentTime < manualDisplayUntil) {
      display.println("Manual");
    } else {
      display.println("READY");

      const int BAR_X = 0;
      const int BAR_Y = 20;
      const int MAX_BAR_WIDTH = 128;
      const int BAR_HEIGHT = 10;
      int fillWidth = map(currentHealth, 0, 100, 0, MAX_BAR_WIDTH);
      fillWidth = constrain(fillWidth, 0, MAX_BAR_WIDTH);
      display.drawRect(BAR_X, BAR_Y, MAX_BAR_WIDTH, BAR_HEIGHT, SSD1306_WHITE);
      if (fillWidth > 0) {
        display.fillRect(BAR_X + 1, BAR_Y + 1, fillWidth - 2, BAR_HEIGHT - 2, SSD1306_WHITE);
      }
      display.setCursor(0, 50);
      display.print("HP: ");
      display.print(currentHealth);
      display.print("/100");
    }
  }

  display.display();
  prevBtn2Down = btn2Down;
  if (currentHealth > 0 && !isFrozen && !isAutomatedMode) {
    prevBtn1Down = digitalRead(btn1) == LOW;
  } else {
    prevBtn1Down = false;
  }
  delay(100);
}
