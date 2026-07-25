/**
 * EWD OBD Gateway — ESP32-S3 N16R8 + SN65HVD230 (TWAI 500 kbit)
 *
 * Wiring: see firmware/ASSEMBLY-N16R8-SN65HVD230.md
 *   GPIO17 → CTX (TXD), GPIO18 ← CRX (RXD), CANH/L → OBD 6/14
 *
 * SoftAP: EWD-OBD-Gateway / volvo-obd → http://192.168.4.1
 * Library: ArduinoJson v7 only (HTTP API, no WebSockets)
 *
 * Board: ESP32S3 Dev Module, Flash 16MB, USB CDC On Boot = Enabled
 */

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
static bool sessionActive = false;

static String buildScanJson(const UdsScanResult& scan) {
  JsonDocument doc;
  doc["bus"] = "HS-CAN";
  doc["device"] = "esp32-s3-n16r8-twai";
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
  bool ok = udsClearDtcs(*found, true, OBD_UDS_TIMEOUT_MS);
  Serial.printf("Clear %s -> %s\n", found->id, ok ? "OK" : "FAIL");
  runScan();
}

void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println("\n=== EWD OBD Gateway (N16R8 + SN65HVD230 / TWAI) ===");
  Serial.println("Policy: read-only default; ClearDTC needs confirm=1; no SecurityAccess");
  Serial.printf("Pins: TWAI_TX=GPIO%d  TWAI_RX=GPIO%d\n", OBD_TWAI_TX, OBD_TWAI_RX);

  canOk = canBusBegin();
  webApiBegin();

  if (canOk) {
    if (obdReadCoolantC(&coolantC)) {
      Serial.printf("Smoke PID05 coolantC=%d\n", coolantC);
    } else {
      Serial.println("Smoke PID05: no response (ignition/bus?)");
    }
  } else {
    Serial.println("CAN not ready — check SN65HVD230 wiring");
  }
}

void loop() {
  webApiLoop();

  if (webApiScanRequested()) {
    webApiClearScanRequest();
    if (canOk) {
      runScan();
    } else {
      webApiSetScanJson(
          "{\"error\":\"CAN not ready\",\"bus\":\"HS-CAN\",\"ecus\":[],\"dtcs\":[],\"live\":{}}");
    }
  }

  String clearEcu;
  if (webApiClearRequested(&clearEcu)) {
    webApiClearClearRequest();
    if (canOk) runClear(clearEcu);
  }

  if (canOk && sessionActive && millis() - lastPidMs >= OBD_PID_POLL_MS) {
    lastPidMs = millis();
    int c = 0;
    if (obdReadCoolantC(&c)) coolantC = c;
  }

  delay(2);
}
