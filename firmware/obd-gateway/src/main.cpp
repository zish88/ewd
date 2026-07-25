#include <Arduino.h>
#include <ArduinoJson.h>
#include "can_bus.h"
#include "config.h"
#include "ecu_map.h"
#include "safety.h"
#include "uds.h"
#include "web_api.h"

static bool canOk = false;
static int coolantC = -1;
static uint32_t lastPidMs = 0;
static bool sessionActive = false;  // true after first /scan until reboot (live PID allowed)

static String buildScanJson(const UdsScanResult& scan) {
  JsonDocument doc;
  doc["bus"] = "HS-CAN";
  doc["device"] = "esp32-s3-n16r8";
  doc["readOnlyDefault"] = true;
  JsonArray ecus = doc["ecus"].to<JsonArray>();
  for (const auto& e : scan.ecus) {
    JsonObject o = ecus.add<JsonObject>();
    o["id"] = e.id;
    o["req"] = e.req;
    o["rsp"] = e.rsp;
    o["online"] = e.online;
  }
  JsonArray dtcs = doc["dtcs"].to<JsonArray>();
  for (const auto& d : scan.dtcs) {
    JsonObject o = dtcs.add<JsonObject>();
    o["ecu"] = d.ecu;
    o["code"] = d.code;
    o["status"] = d.status;
    o["raw"] = d.raw;
  }
  JsonObject live = doc["live"].to<JsonObject>();
  if (coolantC >= -40) live["coolantC"] = coolantC;
  String out;
  serializeJson(doc, out);
  return out;
}

static void runScan() {
  Serial.println("UDS scan start (read-only)");
  sessionActive = true;
  UdsScanResult scan = udsFullScan(OBD_UDS_TIMEOUT_MS);
  String json = buildScanJson(scan);
  webApiSetScanJson(json);
  Serial.printf("Scan done: ecu=%u dtc=%u\n", (unsigned)scan.ecus.size(), (unsigned)scan.dtcs.size());
}

static void runClear(const String& ecuId) {
  const EcuEntry* found = nullptr;
  for (size_t i = 0; i < kEcuMapLen; i++) {
    if (ecuId.equalsIgnoreCase(kEcuMap[i].id)) {
      found = &kEcuMap[i];
      break;
    }
  }
  if (!found) {
    Serial.println("Clear: unknown ECU");
    return;
  }
  // Explicit confirm already validated in web_api
  bool ok = udsClearDtcs(*found, true, OBD_UDS_TIMEOUT_MS);
  Serial.printf("Clear %s -> %s\n", found->id, ok ? "OK" : "FAIL");
  runScan();
}

void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println("\n=== EWD OBD Gateway (N16R8) ===");
  Serial.println("Policy: read-only default; ClearDTC needs confirm=1; no SecurityAccess");

  canOk = canBusBegin();
  webApiBegin();

  if (canOk) {
    // Phase-0 smoke: one silent attempt is OK at boot for Serial log only
    if (obdReadCoolantC(&coolantC)) {
      Serial.printf("Smoke PID05 coolantC=%d\n", coolantC);
    } else {
      Serial.println("Smoke PID05: no response (ignition/bus?)");
    }
  }
}

void loop() {
  webApiLoop();

  if (webApiScanRequested()) {
    webApiClearScanRequest();
    if (canOk) runScan();
    else {
      webApiSetScanJson(
          "{\"error\":\"CAN not ready\",\"bus\":\"HS-CAN\",\"ecus\":[],\"dtcs\":[],\"live\":{}}");
    }
  }

  String clearEcu;
  if (webApiClearRequested(&clearEcu)) {
    webApiClearClearRequest();
    if (canOk) runClear(clearEcu);
  }

  // Live PID only after user started a scan session (avoid chatter when parked idle)
  if (canOk && sessionActive && millis() - lastPidMs >= OBD_PID_POLL_MS) {
    lastPidMs = millis();
    int c = 0;
    if (obdReadCoolantC(&c)) {
      coolantC = c;
    }
  }

  delay(2);
}
