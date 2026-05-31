//Libraries
  #include <Wire.h>
  #include <MPU6050_light.h>
  #include "Adafruit_HTU21DF.h"
  #include "WiFi.h"
  #include <esp_now.h>
  #include <ESP32Servo.h>

//Two Clock And SDA

  TwoWire I2C_1 = TwoWire(0);
  TwoWire I2C_2 = TwoWire(1);

//servo
  Servo servoX;  // Controls X-axisu
  Servo servoY;  // Controls Y-axis

// Pin setup
  int servoPinY = 12;
  int servoPinX = 11;
  int laserpin = 6;//pre17
  const int relaypin = 7;//pre14

//wifiserver


//MPU6050
  MPU6050 mpu(I2C_1);
  // Adafruit_HTU21DF htu = Adafruit_HTU21DF();

//timers
  unsigned long timer = 0;
  unsigned long timer2 = 0;
  unsigned long timer3 = 0;
  unsigned long telemetryTimer = 0;


//Pin setup 2
  int sensorPin = 5 ;
  int sensorValue=0;
  const int irSensor1Pin = 42; 
  const int irSensor2Pin = 41;// The GPIO pin you chose (e.g., GPIO 15)
  int sensor1State = 0;
  int sensor2State = 0;


//wifiserver2


  typedef struct struct_message {
      int yVal,xVal;
      bool rVal;
      int myVal,mxVal;
      bool r2Val;
      bool btn1,btn2,btn3,btn4;
  } struct_message;

  // Create a struct_message called myData
  struct_message joy_one_value;
  //relay
 
  //reveiving Data
  

void OnDataRecv(const uint8_t *mac, const uint8_t *incomingData, int len) {
    memcpy(&joy_one_value, incomingData, sizeof(joy_one_value));
    //move motor
    moveMotor();
    moveServo();
    // Serial.print("VALUES INCOMING: ");
    // Serial.print(joy_one_value.xVal);
    // Serial.print(" ");
    // Serial.print(joy_one_value.yVal);
    // Serial.print(" ");
    // Serial.print(joy_one_value.rVal);
    // Serial.print(" ");
    // Serial.print(joy_one_value.mxVal);
    // Serial.print(" ");
    // Serial.print(joy_one_value.myVal);
    // Serial.print(" ");
    // Serial.print(joy_one_value.r2Val);
    // Serial.print(" ");
    // Serial.print(" Buttons :");
    // Serial.print(joy_one_value.btn1);
    // Serial.print(" ");
    // Serial.print(joy_one_value.btn2);
    // Serial.print(" ");
    // Serial.print(joy_one_value.btn3);
    // Serial.print(" ");
    // Serial.print(joy_one_value.btn4);
    // Serial.print(" ");
    // Serial.println(" End ");


  }
  uint8_t rangeRemoteMac[] = {0x10, 0x20, 0xBA, 0x4C, 0x5C, 0xC4};  


void onDataSent(const wifi_tx_info_t *mac_addr, esp_now_send_status_t status) {
  // Serial.print("Send Status: ");
  // Serial.println(status == ESP_NOW_SEND_SUCCESS ? "Success" : "Fail");
  }

//making the structure 
  typedef struct {
      int x;
      bool r1;
      bool r2;
      float m1;
    }damageData;
    damageData damages;


//Motor Module
  #define motorPinA 35
  #define motorPinB 36
  #define motorPinC 37
  #define motorPinD 38



void setup() {
  Serial.begin(115200);

  Serial.print("Setting AP (Access Point)…");
  WiFi.mode(WIFI_STA);

  delay(500);

  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }
  

  //servo
  servoX.attach(servoPinX);
  servoY.attach(servoPinY);
  servoX.write(90);
  servoY.write(45);

  //Motor Pin
      pinMode(motorPinA, OUTPUT);
      pinMode(motorPinB,OUTPUT);
      pinMode(motorPinC, OUTPUT);
      pinMode(motorPinD,OUTPUT);

  esp_now_register_recv_cb(esp_now_recv_cb_t(OnDataRecv));    




  pinMode(irSensor1Pin, INPUT); 
  pinMode(irSensor2Pin, INPUT); 

  pinMode(relaypin,OUTPUT);
  pinMode(laserpin,OUTPUT);

  I2C_1.begin(20, 21, 400000); // I2C bus 1 (for MPU)
  I2C_2.begin(8, 9, 400000); // I2C bus 2 (for HTU21D)

  //MPU
  // if (!mpu.begin()) {
  //   Serial.println("MPU6050 not found!");
  // } else {
  //   Serial.println("MPU6050 ready");
  // }

  byte status=mpu.begin();
  Serial.print("MPU Status:");
  Serial.println(status);
  while(status!=0){}

  Serial.print("Do not move MPU:");
  delay(2000);
  mpu.calcOffsets();
  Serial.print("Done\n");

  //HTU
  // if (!htu.begin(&I2C_2)) { // some HTU libraries allow this form
  //   Serial.println("HTU21D not found!");
  // } else {
  //   Serial.println("HTU21D ready");
  // }

  //WifiServer2- sending
  esp_now_register_send_cb(onDataSent);

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, rangeRemoteMac, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("Failed to add peer!");
    return;
  }
  else {
    Serial.println("Peer added successfully!");
  }
  


  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  motorStop() ;

}
void loop() {
  //IR
  mpu.begin();

  sensor1State = digitalRead(irSensor1Pin);
  damages.r1 = sensor1State; 
  sensor2State = digitalRead(irSensor2Pin);
  damages.r2 = sensor2State; 
  // if (sensor1State == HIGH) {
  //   Serial.print("Out of range 1 \t");
  // } else {
  //   Serial.print("sensor1 :in Zone \t");
  // }
  // if (sensor2State == HIGH) {
  //   Serial.println("Out of range 2 \t");
  // } else {
  //   Serial.println("sensor2 :in Zone \t");
  // }

  //HTU

  // float temp = htu.readTemperature();
  // float humidity = htu.readHumidity();

  // Serial.print("Temp: "); Serial.print(temp);
  // Serial.print(" °C  Humidity: "); Serial.print(humidity); Serial.print(" % \t");

  //PIEZO

    sensorValue = analogRead(sensorPin);
    //Serial.print("PiezoValue: \t");
    damages.x = sensorValue ; 
    // Serial.println(sensorValue);


  //MPU

  
  if((millis()-timer)>10){ 
    Serial.print("\tZ : ");
    damages.m1=mpu.getAngleZ();
    Serial.println(damages.m1);
    timer = millis();  
  }

// Move servos

  //Move Motors 
  //Laser ON

  if(joy_one_value.btn2==HIGH){
    digitalWrite(laserpin,HIGH);
    }
    else{
      digitalWrite(laserpin,LOW);
  }

  //on relay

  if(joy_one_value.btn1==HIGH){
    digitalWrite(relaypin,HIGH);
    }
    else{
      digitalWrite(relaypin,LOW);
  }

  //sending data through server
  if ((millis() - telemetryTimer) > 100) {
    esp_err_t result = esp_now_send(rangeRemoteMac, (uint8_t *)&damages, sizeof(damages));
    telemetryTimer = millis();
    if (result == ESP_OK) {
    // Serial.println("Success");
    } else {
    // Serial.println("Send failed");
    }
  }

}
//Motor Module Functions
  void moveMotor(){
    if(joy_one_value.myVal>4000){
      moveForward();
    }
    else{
      motorStop();
      if(joy_one_value.myVal<300){
        moveBackward();
      }
      else{
          motorStop();
          if(joy_one_value.mxVal>4000){
            turnRight();
          }
          else{
            motorStop();
            if(joy_one_value.mxVal<300){
              turnLeft();
            }
            else{
              motorStop();
            }
          }
      }
    }
  }
  void moveBackward(){
    digitalWrite(motorPinA,HIGH);
    digitalWrite(motorPinB,LOW);
    digitalWrite(motorPinC,HIGH);
    digitalWrite(motorPinD,LOW);
  }
  void moveForward(){
    digitalWrite(motorPinA,LOW);
    digitalWrite(motorPinB,HIGH);
    digitalWrite(motorPinC,LOW);
    digitalWrite(motorPinD,HIGH);
  }
  void turnRight(){
    digitalWrite(motorPinA,HIGH);
    digitalWrite(motorPinB,LOW);
    digitalWrite(motorPinC,LOW);
    digitalWrite(motorPinD,HIGH);
  }
  void turnLeft(){
    digitalWrite(motorPinA,LOW);
    digitalWrite(motorPinB,HIGH);
    digitalWrite(motorPinC,HIGH);
    digitalWrite(motorPinD,LOW);
  }
  void motorStop(){
    digitalWrite(motorPinA,LOW);
    digitalWrite(motorPinB,LOW);
    digitalWrite(motorPinC,LOW);
    digitalWrite(motorPinD,LOW);    
  }

//move servo function 

  void moveServo(){

    int angleX = map(joy_one_value.xVal, 0, 4095, 45, 135);//0,100,0,10
    int angleY = map(joy_one_value.yVal, 0, 4095, 0, 90);

    // servoY.write(90-angleY);
    // servoX.write(180-angleX);
    if(angleY>70||angleY<20){
      servoY.write(90-angleY);
    }
    else{
      servoY.write(45);
      if(angleX>130||angleX<80){
        servoX.write(180-angleX);
      }
      else{
        servoX.write(90);
      }
    }
      
    timer2 = millis();
  
  }
