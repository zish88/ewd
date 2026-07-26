#include "uds.h"
#include "can_bus.h"
#include "config.h"
#include "dtc_format.h"
#include "isotp.h"
#include "safety.h"

static String hexId(uint32_t id) {
  char b[12];
  snprintf(b, sizeof(b), "0x%03X", (unsigned)id);
  return String(b);
}

bool udsProbeEcu(const EcuEntry& ecu, uint32_t timeoutMs) {
  if (!obdOpAllowed(ObdOpClass::EcuProbe, false)) return false;
  IsoTpLink link;
  link.setIds(ecu.reqId, ecu.rspId);
  const uint8_t req[] = {0x3E, 0x00};  // TesterPresent
  std::vector<uint8_t> rsp;
  if (!link.request(req, sizeof(req), rsp, timeoutMs)) return false;
  return rsp.size() >= 1 && rsp[0] == 0x7E;
}

bool udsReadDtcs(const EcuEntry& ecu, std::vector<UdsDtcItem>& out, uint32_t timeoutMs) {
  if (!obdOpAllowed(ObdOpClass::ReadDtc, false)) return false;
  IsoTpLink link;
  link.setIds(ecu.reqId, ecu.rspId);

  // Extended session (best-effort; ignore NRC)
  {
    const uint8_t sess[] = {0x10, 0x03};
    std::vector<uint8_t> rsp;
    link.request(sess, sizeof(sess), rsp, timeoutMs);
  }

  // 0x19 0x02 0xFF — report DTCs by status mask (all)
  const uint8_t read[] = {0x19, 0x02, 0xFF};
  std::vector<uint8_t> rsp;
  if (!link.request(read, sizeof(read), rsp, timeoutMs)) return false;
  if (rsp.size() < 3 || rsp[0] != 0x59) return false;

  // Positive: 59 02 <mask> then N * (DTC_H DTC_M DTC_L status)
  size_t i = 3;
  while (i + 3 < rsp.size()) {
    uint8_t b0 = rsp[i];
    uint8_t b1 = rsp[i + 1];
    uint8_t b2 = rsp[i + 2];
    uint8_t st = rsp[i + 3];
    i += 4;
    if (b0 == 0 && b1 == 0 && b2 == 0) continue;
    UdsDtcItem item;
    item.ecu = String(ecu.id);
    item.code = formatUdsDtc(b0, b1, b2);
    item.status = (st & 0x01) ? "confirmed" : "stored";
    char raw[16];
    snprintf(raw, sizeof(raw), "%02X%02X%02X:%02X", b0, b1, b2, st);
    item.raw = String(raw);
    out.push_back(item);
  }
  return true;
}

UdsScanResult udsFullScan(uint32_t timeoutMs) {
  UdsScanResult result;
  for (size_t i = 0; i < kEcuMapLen; i++) {
    const EcuEntry& e = kEcuMap[i];
    UdsEcuStatus st;
    st.id = String(e.id);
    st.req = hexId(e.reqId);
    st.rsp = hexId(e.rspId);
    st.online = udsProbeEcu(e, timeoutMs);
    result.ecus.push_back(st);
    if (!st.online) continue;
    udsReadDtcs(e, result.dtcs, timeoutMs);
  }
  return result;
}

bool udsClearDtcs(const EcuEntry& ecu, bool confirmed, uint32_t timeoutMs) {
  if (!obdOpAllowed(ObdOpClass::ClearDtc, confirmed)) {
    Serial.println("ClearDTC blocked (safety: need confirm)");
    return false;
  }
  IsoTpLink link;
  link.setIds(ecu.reqId, ecu.rspId);
  const uint8_t clr[] = {0x14, 0xFF, 0xFF, 0xFF};
  std::vector<uint8_t> rsp;
  if (!link.request(clr, sizeof(clr), rsp, timeoutMs)) return false;
  return rsp.size() >= 1 && rsp[0] == 0x54;
}

