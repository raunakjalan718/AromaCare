#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// WiFi credentials
const char* ssid     = "realme7";
const char* password = "realme_7";

// Pin definitions
const int MQ135_PIN = 34;  // ADC1_CH6
const int MQ136_PIN = 35;  // ADC1_CH7
const int MQ137_PIN = 32;  // ADC1_CH4
const int SERVO_PIN = 25;  // PWM capable pin for servo

// Servo object
Servo fanServo;

// Servo positions
const int SERVO_OFF_POSITION = 0;    // Servo angle when fan is OFF
const int SERVO_ON_POSITION  = 90;   // Servo angle when fan is ON

// Threshold values
const int THRESHOLD_MQ135 = 2300;   // Air quality threshold
const int THRESHOLD_MQ136 = 1750;   // Gas detection threshold
const int THRESHOLD_MQ137 = 1750;   // Ammonia threshold

// Timing variables
unsigned long previousMillis = 0;
const long interval = 10000;        // Fan cycle interval (10 seconds)
unsigned long timeLeft = interval;

// Sensor readings
int    mq135Value  = 0;
int    mq136Value  = 0;
int    mq137Value  = 0;
String mq135Status = "GOOD";
String mq136Status = "GOOD";
String mq137Status = "GOOD";
String fanStatus   = "OFF";

// Web server on port 80
WebServer server(80);

// ─── Forward declarations ─────────────────────────────────────
void handleStatus();
void handleOptions();
void readSensors();
void updateFanStatus();
void sendCORSHeaders();

// ─── SETUP ───────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  // Servo
  fanServo.attach(SERVO_PIN);
  fanServo.write(SERVO_OFF_POSITION);
  Serial.println("Servo initialised at OFF position");

  // WiFi
  Serial.printf("\nConnecting to %s", ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
  Serial.println("Enter this IP in the AromaCare web portal Settings page.");

  // ── Routes ────────────────────────────────────────────────
  // GET  /status  — returns JSON sensor data
  server.on("/status", HTTP_GET,     handleStatus);

  // OPTIONS /status  — handles CORS preflight (Chrome Private Network Access)
  server.on("/status", HTTP_OPTIONS, handleOptions);

  // NOTE: Do NOT call server.enableCORS(true) here.
  // We handle CORS headers manually in sendCORSHeaders().
  // Calling enableCORS(true) AND sending headers manually causes the
  // 'Access-Control-Allow-Origin' to appear TWICE ('*, *') which
  // Chrome rejects with a CORS error.

  server.begin();
  Serial.println("HTTP server started.");
}

// ─── LOOP ────────────────────────────────────────────────────
void loop() {
  server.handleClient();
  readSensors();
  updateFanStatus();
  delay(100);
}

// ─── READ SENSORS ─────────────────────────────────────────────
void readSensors() {
  mq135Value = analogRead(MQ135_PIN);
  mq136Value = analogRead(MQ136_PIN);
  mq137Value = analogRead(MQ137_PIN);

  mq135Status = (mq135Value < THRESHOLD_MQ135) ? "GOOD" : "BAD";
  mq136Status = (mq136Value < THRESHOLD_MQ136) ? "GOOD" : "BAD";
  mq137Status = (mq137Value < THRESHOLD_MQ137) ? "GOOD" : "BAD";

  Serial.printf("MQ135: %d [%s]  MQ136: %d [%s]  MQ137: %d [%s]\n",
    mq135Value, mq135Status.c_str(),
    mq136Value, mq136Status.c_str(),
    mq137Value, mq137Status.c_str());
}

// ─── UPDATE FAN ───────────────────────────────────────────────
void updateFanStatus() {
  unsigned long currentMillis = millis();
  timeLeft = interval - (currentMillis - previousMillis);

  bool anyBad = (mq135Status == "BAD" || mq136Status == "BAD" || mq137Status == "BAD");

  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;
    if (anyBad) {
      fanStatus = "ON";
      Serial.println(">> Poor air quality — Fan ON");
    } else {
      fanStatus = "OFF";
      Serial.println(">> Air quality good — Fan OFF");
    }
  }

  // Keep PWM signal alive every loop
  fanServo.write((fanStatus == "ON") ? SERVO_ON_POSITION : SERVO_OFF_POSITION);
}

// ─── SHARED CORS HEADERS ──────────────────────────────────────
// Called by both handleOptions() and handleStatus() to ensure
// Chrome's Private Network Access preflight is satisfied.
void sendCORSHeaders() {
  server.sendHeader("Access-Control-Allow-Origin",          "*");
  server.sendHeader("Access-Control-Allow-Methods",         "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers",         "Content-Type, Accept");
  // ★ KEY FIX: required by Chrome 98+ when a page at file:// or http://
  //   tries to reach a local-network IP (e.g. 10.x.x.x / 192.168.x.x).
  //   Without this header the browser blocks the fetch silently.
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
}

// ─── OPTIONS HANDLER (CORS Preflight) ────────────────────────
// Chrome sends a preflight OPTIONS request before the real GET.
// We must respond 204 No Content with the CORS headers above.
void handleOptions() {
  sendCORSHeaders();
  server.send(204);   // 204 No Content — standard preflight response
  Serial.println("Preflight OPTIONS answered.");
}

// ─── GET /status ──────────────────────────────────────────────
void handleStatus() {
  StaticJsonDocument<300> doc;
  doc["mq135"]        = mq135Value;
  doc["mq135_status"] = mq135Status;
  doc["mq136"]        = mq136Value;
  doc["mq136_status"] = mq136Status;
  doc["mq137"]        = mq137Value;
  doc["mq137_status"] = mq137Status;
  doc["fan"]          = fanStatus;
  doc["time_left"]    = timeLeft;

  String response;
  serializeJson(doc, response);

  sendCORSHeaders();  // CORS + Private-Network headers on every response
  server.send(200, "application/json", response);
  Serial.println("GET /status served.");
}
