#include "obd_signals.h"
#include "can_bus.h"
#include "config.h"
#include "safety.h"
#include <cstring>

static std::vector<uint8_t> gSupported;
static std::vector<uint8_t> gDataPids;  // supported minus bitmask PIDs
static std::vector<ObdSignal> gSignals;
static size_t gPollIdx = 0;
static bool gBusOk = false;
static uint32_t gLastScanMs = 0;
static bool gEverScanned = false;
static bool gDiscovered = false;

static bool isBitmaskPid(uint8_t pid) {
  return (pid & 0x1F) == 0x00;  // 00,20,40,60,80,A0,C0,E0
}

static String pidHex(uint8_t pid) {
  char b[4];
  snprintf(b, sizeof(b), "%02X", pid);
  return String(b);
}

static void upsertSignal(const ObdSignal& s) {
  for (auto& row : gSignals) {
    if (row.pidHex == s.pidHex) {
      row = s;
      return;
    }
  }
  if (gSignals.size() < 48) gSignals.push_back(s);
}

bool obdReadPidRaw(uint8_t pid, uint8_t* dataOut, uint8_t* lenOut, uint32_t timeoutMs) {
  if (!dataOut || !lenOut || !obdOpAllowed(ObdOpClass::ReadLive, false)) return false;
  uint8_t req[8] = {0x02, 0x01, pid, 0, 0, 0, 0, 0};
  // Drain stale RX briefly
  uint32_t drainT0 = millis();
  while (millis() - drainT0 < 5 && canBusMsgAvailable()) {
    uint32_t id = 0;
    uint8_t d[8] = {};
    uint8_t l = 0;
    canBusRecv(&id, d, &l);
  }
  if (!canBusSend(0x7DF, req, 8)) return false;
  uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    if (!canBusMsgAvailable()) {
      delay(1);
      continue;
    }
    uint32_t id = 0;
    uint8_t data[8] = {};
    uint8_t len = 0;
    if (!canBusRecv(&id, data, &len)) continue;
    // ISO-TP single frame: PCI, 41, pid, …
    if (len >= 3 && data[1] == 0x41 && data[2] == pid) {
      *lenOut = len;
      memcpy(dataOut, data, len);
      return true;
    }
    if (len >= 3 && data[0] == 0x41 && data[1] == pid) {
      // Some stacks omit PCI nibble packing differently
      *lenOut = len;
      memcpy(dataOut, data, len);
      return true;
    }
  }
  return false;
}

bool obdDiscoverSupportedPids(std::vector<uint8_t>& outPids, uint32_t timeoutMs) {
  outPids.clear();
  uint8_t next = 0x00;
  for (int block = 0; block < 8; block++) {
    uint8_t frame[8] = {};
    uint8_t flen = 0;
    if (!obdReadPidRaw(next, frame, &flen, timeoutMs)) break;
    // Find A B C D after 41 pid
    size_t off = 0;
    if (flen >= 7 && frame[1] == 0x41 && frame[2] == next) off = 3;
    else if (flen >= 6 && frame[0] == 0x41 && frame[1] == next) off = 2;
    else break;
    if (off + 4 > flen) break;
    uint32_t bits = ((uint32_t)frame[off] << 24) | ((uint32_t)frame[off + 1] << 16) |
                    ((uint32_t)frame[off + 2] << 8) | (uint32_t)frame[off + 3];
    for (int i = 0; i < 32; i++) {
      if (bits & (0x80000000u >> i)) {
        uint8_t pid = (uint8_t)(next + 1 + i);
        outPids.push_back(pid);
      }
    }
    // Bit 0 of the 32-bit map (PID next+0x20) means "next support PID present"
    bool more = (bits & 0x00000001u) != 0;
    next = (uint8_t)(next + 0x20);
    if (!more || next == 0x00) break;
  }
  return !outPids.empty();
}

bool obdDecodePid(uint8_t pid, const uint8_t* data, uint8_t len, ObdSignal& out) {
  out = {};
  out.pidHex = pidHex(pid);
  out.valid = false;
  // Payload after 41 pid
  size_t off = 0;
  if (len >= 3 && data[1] == 0x41 && data[2] == pid) off = 3;
  else if (len >= 2 && data[0] == 0x41 && data[1] == pid) off = 2;
  else return false;
  uint8_t a = off < len ? data[off] : 0;
  uint8_t b = off + 1 < len ? data[off + 1] : 0;
  uint8_t c = off + 2 < len ? data[off + 2] : 0;
  uint8_t d = off + 3 < len ? data[off + 3] : 0;
  (void)c;
  (void)d;

  out.valid = true;
  switch (pid) {
    case 0x04:
      out.id = "engine_load";
      out.name = "Engine load";
      out.value = a * 100.0f / 255.0f;
      out.unit = "%";
      break;
    case 0x05:
      out.id = "coolant_temp";
      out.name = "Coolant temperature";
      out.value = (float)a - 40.0f;
      out.unit = "°C";
      break;
    case 0x06:
      out.id = "stft_b1";
      out.name = "Short term fuel trim B1";
      out.value = ((float)a - 128.0f) * 100.0f / 128.0f;
      out.unit = "%";
      break;
    case 0x07:
      out.id = "ltft_b1";
      out.name = "Long term fuel trim B1";
      out.value = ((float)a - 128.0f) * 100.0f / 128.0f;
      out.unit = "%";
      break;
    case 0x0B:
      out.id = "map";
      out.name = "Intake manifold pressure";
      out.value = (float)a;
      out.unit = "kPa";
      break;
    case 0x0C:
      out.id = "engine_rpm";
      out.name = "Engine RPM";
      out.value = ((a * 256.0f) + b) / 4.0f;
      out.unit = "rpm";
      break;
    case 0x0D:
      out.id = "vehicle_speed";
      out.name = "Vehicle speed";
      out.value = (float)a;
      out.unit = "km/h";
      break;
    case 0x0E:
      out.id = "timing_advance";
      out.name = "Timing advance";
      out.value = (a / 2.0f) - 64.0f;
      out.unit = "°";
      break;
    case 0x0F:
      out.id = "intake_temp";
      out.name = "Intake air temperature";
      out.value = (float)a - 40.0f;
      out.unit = "°C";
      break;
    case 0x10:
      out.id = "maf";
      out.name = "MAF air flow";
      out.value = ((a * 256.0f) + b) / 100.0f;
      out.unit = "g/s";
      break;
    case 0x11:
      out.id = "throttle";
      out.name = "Throttle position";
      out.value = a * 100.0f / 255.0f;
      out.unit = "%";
      break;
    case 0x1F:
      out.id = "run_time";
      out.name = "Run time since start";
      out.value = (a * 256.0f) + b;
      out.unit = "s";
      break;
    case 0x21:
      out.id = "distance_mil";
      out.name = "Distance with MIL on";
      out.value = (a * 256.0f) + b;
      out.unit = "km";
      break;
    case 0x2F:
      out.id = "fuel_level";
      out.name = "Fuel level";
      out.value = a * 100.0f / 255.0f;
      out.unit = "%";
      break;
    case 0x33:
      out.id = "baro";
      out.name = "Barometric pressure";
      out.value = (float)a;
      out.unit = "kPa";
      break;
    case 0x42:
      out.id = "ecu_voltage";
      out.name = "Control module voltage";
      out.value = ((a * 256.0f) + b) / 1000.0f;
      out.unit = "V";
      break;
    case 0x46:
      out.id = "ambient_temp";
      out.name = "Ambient air temperature";
      out.value = (float)a - 40.0f;
      out.unit = "°C";
      break;
    case 0x5C:
      out.id = "oil_temp";
      out.name = "Engine oil temperature";
      out.value = (float)a - 40.0f;
      out.unit = "°C";
      break;
    case 0x5E:
      out.id = "fuel_rate";
      out.name = "Engine fuel rate";
      out.value = ((a * 256.0f) + b) / 20.0f;
      out.unit = "L/h";
      break;
    default: {
      char idbuf[12];
      snprintf(idbuf, sizeof(idbuf), "pid_%02X", pid);
      out.id = String(idbuf);
      out.name = String("PID ") + out.pidHex;
      out.value = (float)a;
      out.unit = "raw";
      break;
    }
  }
  return true;
}

static void rebuildDataPids() {
  gDataPids.clear();
  for (uint8_t p : gSupported) {
    if (!isBitmaskPid(p)) gDataPids.push_back(p);
  }
  gPollIdx = 0;
}

void obdSignalsSetBusOk(bool ok) { gBusOk = ok; }

void obdSignalsMarkScanDone(uint32_t nowMs) {
  gLastScanMs = nowMs;
  gEverScanned = true;
}

void obdSignalsTick(bool sessionActive, uint32_t nowMs) {
  (void)nowMs;
  if (!gBusOk || !sessionActive) return;
  if (!gDiscovered) {
    std::vector<uint8_t> found;
    if (obdDiscoverSupportedPids(found, 100)) {
      gSupported = found;
      rebuildDataPids();
      gDiscovered = true;
      Serial.printf("OBD supported PIDs: %u (data=%u)\n", (unsigned)gSupported.size(),
                    (unsigned)gDataPids.size());
    } else {
      // Retry later; do not spam
      static uint32_t lastTry = 0;
      if (nowMs - lastTry > 3000) {
        lastTry = nowMs;
        Serial.println("OBD PID discovery: no response");
      }
      return;
    }
  }
  if (gDataPids.empty()) return;
  uint8_t pid = gDataPids[gPollIdx % gDataPids.size()];
  gPollIdx++;
  uint8_t frame[8] = {};
  uint8_t flen = 0;
  if (!obdReadPidRaw(pid, frame, &flen, 80)) return;
  ObdSignal sig;
  if (obdDecodePid(pid, frame, flen, sig) && sig.valid) upsertSignal(sig);
}

const std::vector<uint8_t>& obdSupportedPids() { return gSupported; }
const std::vector<ObdSignal>& obdSignalCache() { return gSignals; }

ObdBusStatus obdBusStatusSnapshot(uint32_t nowMs) {
  ObdBusStatus st;
  st.ok = gBusOk;
  st.txErr = 0;
  st.rxErr = 0;
  st.busErr = 0;
  CanBusStats stats;
  if (canBusGetStats(&stats)) {
    st.txErr = stats.txError;
    st.rxErr = stats.rxError;
    st.busErr = stats.busError;
    st.state = String(stats.stateName);
  } else {
    st.state = gBusOk ? "UNKNOWN" : "BUS_OFF";
  }
  st.lastScanAgeMs = gEverScanned ? (int32_t)(nowMs - gLastScanMs) : -1;
  return st;
}

String obdSignalsToJsonArray() {
  String out = "[";
  for (size_t i = 0; i < gSignals.size(); i++) {
    const auto& s = gSignals[i];
    if (i) out += ",";
    out += "{\"id\":\"";
    out += s.id;
    out += "\",\"pid\":\"";
    out += s.pidHex;
    out += "\",\"name\":\"";
    out += s.name;
    out += "\",\"value\":";
    out += String(s.value, 2);
    out += ",\"unit\":\"";
    out += s.unit;
    out += "\"}";
  }
  out += "]";
  return out;
}

String obdSupportedPidsToJsonArray() {
  String out = "[";
  for (size_t i = 0; i < gSupported.size(); i++) {
    if (i) out += ",";
    out += "\"";
    out += pidHex(gSupported[i]);
    out += "\"";
  }
  out += "]";
  return out;
}

String obdBusStatusToJsonObject(uint32_t nowMs) {
  ObdBusStatus st = obdBusStatusSnapshot(nowMs);
  String out = "{";
  out += "\"ok\":";
  out += st.ok ? "true" : "false";
  out += ",\"state\":\"";
  out += st.state;
  out += "\",\"txErr\":";
  out += String(st.txErr);
  out += ",\"rxErr\":";
  out += String(st.rxErr);
  out += ",\"busErr\":";
  out += String(st.busErr);
  out += ",\"lastScanAgeMs\":";
  out += String(st.lastScanAgeMs);
  out += ",\"supportedPidCount\":";
  out += String((unsigned)gSupported.size());
  out += ",\"signalCount\":";
  out += String((unsigned)gSignals.size());
  out += "}";
  return out;
}

String obdSignalsApiJson(uint32_t nowMs) {
  String out = "{";
  out += "\"bus\":\"HS-CAN\",";
  out += "\"device\":\"esp32-s3-n16r8\",";
  out += "\"busStatus\":";
  out += obdBusStatusToJsonObject(nowMs);
  out += ",\"supportedPids\":";
  out += obdSupportedPidsToJsonArray();
  out += ",\"signals\":";
  out += obdSignalsToJsonArray();
  out += "}";
  return out;
}
