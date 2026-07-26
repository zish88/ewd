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
#include "obd_signals.h"
#include "safety.h"
#include "uds.h"
#include "web_api.h"

static bool canOk = false;
static uint32_t lastPidMs = 0;
static uint32_t lastStatusMs = 0;
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

  JsonArray supported = doc["supportedPids"].to<JsonArray>();
  for (uint8_t p : obdSupportedPids()) {
    char b[4];
    snprintf(b, sizeof(b), "%02X", p);
    supported.add(b);
  }

  JsonArray signals = doc["signals"].to<JsonArray>();
  for (const auto& s : obdSignalCache()) {
    JsonObject o = signals.add<JsonObject>();
    o["id"] = s.id;
    o["pid"] = s.pidHex;
    o["name"] = s.name;
    o["value"] = s.value;
    o["unit"] = s.unit;
  }

  JsonDocument busDoc;
  deserializeJson(busDoc, obdBusStatusToJsonObject(millis()));
  doc["busStatus"] = busDoc.as<JsonObject>();

  String out;
  serializeJson(doc, out);
  return out;
}

static void publishStatusCaches() {
  uint32_t now = millis();
  webApiSetSignalsJson(obdSignalsApiJson(now));
  String health = "{\"ok\":";
  health += canOk ? "true" : "false";
  health += ",\"device\":\"esp32-s3-n16r8-twai\",\"bus\":\"HS-CAN\",\"readOnlyDefault\":true";
  health += ",\"busStatus\":";
  health += obdBusStatusToJsonObject(now);
  health += ",\"supportedPids\":";
  health += obdSupportedPidsToJsonArray();
  health += "}";
  webApiSetHealthJson(health);
}

static void runScan() {
  Serial.println("UDS scan start (read-only)");
  sessionActive = true;
  UdsScanResult scan = udsFullScan(OBD_UDS_TIMEOUT_MS);
  obdSignalsMarkScanDone(millis());
  // Kick discovery immediately around scan
  obdSignalsTick(true, millis());
  String json = buildScanJson(scan);
  webApiSetScanJson(json);
  publishStatusCaches();
  Serial.printf("Scan done: ecu=%u dtc=%u signals=%u\n", (unsigned)scan.ecus.size(),
                (unsigned)scan.dtcs.size(), (unsigned)obdSignalCache().size());
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
  Serial.println("Live: Mode 01 supported-PID discovery + GET /signals");
  Serial.printf("Pins: TWAI_TX=GPIO%d  TWAI_RX=GPIO%d\n", OBD_TWAI_TX, OBD_TWAI_RX);

  canOk = canBusBegin();
  obdSignalsSetBusOk(canOk);
  webApiBegin();
  publishStatusCaches();

  if (!canOk) {
    Serial.println("CAN not ready — check SN65HVD230 wiring");
  } else {
    Serial.println("CAN ready — POST /scan then poll GET /signals");
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
          "{\"error\":\"CAN not ready\",\"bus\":\"HS-CAN\",\"ecus\":[],\"dtcs\":[],\"signals\":[],"
          "\"supportedPids\":[]}");
      publishStatusCaches();
    }
  }

  String clearEcu;
  if (webApiClearRequested(&clearEcu)) {
    webApiClearClearRequest();
    if (canOk) runClear(clearEcu);
  }

  uint32_t now = millis();
  if (canOk && sessionActive && now - lastPidMs >= OBD_PID_POLL_MS) {
    lastPidMs = now;
    obdSignalsTick(true, now);
  }

  if (now - lastStatusMs >= 1000) {
    lastStatusMs = now;
    publishStatusCaches();
  }

  delay(2);
}
