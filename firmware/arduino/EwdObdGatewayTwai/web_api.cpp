#include "web_api.h"
#include "config.h"
#include <WebServer.h>
#include <WiFi.h>

// HTTP only (no WebSockets library required). Site uses GET/POST /scan.

static WebServer server(OBD_HTTP_PORT);
static String scanJson = "{\"bus\":\"HS-CAN\",\"ecus\":[],\"dtcs\":[],\"live\":{}}";
static volatile bool scanReq = false;
static volatile bool clearReq = false;
static String clearEcu = "";

static void sendCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

static void handleOptions() {
  sendCors();
  server.send(204);
}

static void handleRoot() {
  sendCors();
  server.send(200, "text/plain",
              "EWD OBD Gateway (HTTP)\n"
              "GET  /health\n"
              "GET  /scan\n"
              "POST /scan\n"
              "POST /clear?ecu=ECM&confirm=1\n");
}

static void handleHealth() {
  sendCors();
  server.send(200, "application/json",
              "{\"ok\":true,\"device\":\"esp32-s3-n16r8-twai\",\"bus\":\"HS-CAN\",\"readOnlyDefault\":true}");
}

static void handleGetScan() {
  sendCors();
  server.send(200, "application/json", scanJson);
}

static void handlePostScan() {
  sendCors();
  scanReq = true;
  server.send(202, "application/json", "{\"accepted\":true,\"message\":\"scan started\"}");
}

static void handleClear() {
  sendCors();
  if (!server.hasArg("confirm") || server.arg("confirm") != "1") {
    server.send(400, "application/json",
                "{\"error\":\"Clear DTC requires confirm=1 after UI double-confirm\"}");
    return;
  }
  clearEcu = server.hasArg("ecu") ? server.arg("ecu") : "";
  if (clearEcu.length() == 0) {
    server.send(400, "application/json", "{\"error\":\"ecu required\"}");
    return;
  }
  clearReq = true;
  server.send(202, "application/json", "{\"accepted\":true,\"ecu\":\"" + clearEcu + "\"}");
}

void webApiBegin() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP(OBD_WIFI_SSID, OBD_WIFI_PASS);
  IPAddress ip = WiFi.softAPIP();
  Serial.printf("SoftAP %s  IP %s\n", OBD_WIFI_SSID, ip.toString().c_str());

  server.on("/", HTTP_GET, handleRoot);
  server.on("/health", HTTP_GET, handleHealth);
  server.on("/scan", HTTP_GET, handleGetScan);
  server.on("/scan", HTTP_POST, handlePostScan);
  server.on("/scan", HTTP_OPTIONS, handleOptions);
  server.on("/clear", HTTP_POST, handleClear);
  server.on("/clear", HTTP_OPTIONS, handleOptions);
  server.begin();
  Serial.printf("HTTP ready on port %d\n", OBD_HTTP_PORT);
}

void webApiLoop() { server.handleClient(); }

void webApiSetScanJson(const String& json) { scanJson = json; }

String webApiScanJson() { return scanJson; }

bool webApiScanRequested() { return scanReq; }
void webApiClearScanRequest() { scanReq = false; }

bool webApiClearRequested(String* ecuOut) {
  if (!clearReq) return false;
  if (ecuOut) *ecuOut = clearEcu;
  return true;
}

void webApiClearClearRequest() {
  clearReq = false;
  clearEcu = "";
}
