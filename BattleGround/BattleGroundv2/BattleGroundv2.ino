//Updated code to correctly turn on relays according to the timers.

#include <WiFi.h>
#include <esp_now.h>


int fanout = 18;    
int lasorout = 7;  
int humidifier = 17;

unsigned long fanStartTime = 0;
unsigned long fanLockTimer = 0;
bool fanon = false;
bool laseron = false;
unsigned long laserStartTime = 0;
unsigned long laserLockTime = 0;
bool fanIsLocked = false;    
bool laserIsLocked = false;  
const long interval = 5000; 

typedef struct {
  int fanVal;
  int laserVal;
} RangeBotData;

RangeBotData rangeBotPowers;

void onDataRecv(const esp_now_recv_info *recv_info, const uint8_t *incomingData, int len) {
  if (len == sizeof(RangeBotData)) {
    memcpy(&rangeBotPowers, incomingData, sizeof(rangeBotPowers));
    if (rangeBotPowers.fanVal == 1) {
      Serial.println("Signal Received: Fan ON");
    }
    if (rangeBotPowers.laserVal == 1) {
      Serial.println("Signal Received: Laser ON");
    }
  }
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

  esp_now_register_recv_cb(onDataRecv);
  Serial.println("System Ready. Relays Forced OFF at boot.");
}

void loop() {
  unsigned long currentTime = millis();

  // Handle Fan Timer
  if (rangeBotPowers.fanVal==1) {
      Serial.println("Signal Received: Fan relay activated");
      digitalWrite(fanout,HIGH);
      fanon=true;
      fanStartTime = millis();  
  }
  if(fanon&&millis()-fanStartTime>5*1000){
    fanon=false;
    digitalWrite(fanout,LOW);
  }

  // Handle Laser Timer
  if (rangeBotPowers.laserVal==1) {
      Serial.println("Signal Received: Laser relay activated");
      digitalWrite(lasorout,HIGH);
      laseron=true;
      laserStartTime = millis();  
  }
  if(laseron&&millis()-laserStartTime>5*1000){
    laseron=false;
    digitalWrite(lasorout,LOW);
  }

}
