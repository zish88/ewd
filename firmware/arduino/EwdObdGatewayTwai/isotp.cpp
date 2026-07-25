#include "isotp.h"
#include "can_bus.h"

void IsoTpLink::setIds(uint32_t req, uint32_t rsp) {
  reqId_ = req;
  rspId_ = rsp;
}

bool IsoTpLink::sendSf(const uint8_t* payload, size_t len) {
  if (len == 0 || len > 7) return false;
  uint8_t frame[8] = {};
  frame[0] = (uint8_t)(0x00 | (len & 0x0F));
  memcpy(frame + 1, payload, len);
  return canBusSend(reqId_, frame, 8);
}

bool IsoTpLink::sendFfCf(const uint8_t* payload, size_t len) {
  if (len < 8 || len > 4095) return false;
  uint8_t ff[8] = {};
  ff[0] = (uint8_t)(0x10 | ((len >> 8) & 0x0F));
  ff[1] = (uint8_t)(len & 0xFF);
  memcpy(ff + 2, payload, 6);
  if (!canBusSend(reqId_, ff, 8)) return false;

  // Wait FlowControl
  uint32_t t0 = millis();
  bool gotFc = false;
  uint8_t bs = 0;
  uint8_t stMin = 0;
  while (millis() - t0 < 100) {
    if (!canBusMsgAvailable()) {
      delay(1);
      continue;
    }
    uint32_t id = 0;
    uint8_t data[8] = {};
    uint8_t l = 0;
    if (!canBusRecv(&id, data, &l) || id != rspId_) continue;
    if ((data[0] & 0xF0) == 0x30) {
      bs = data[1];
      stMin = data[2];
      gotFc = true;
      break;
    }
  }
  if (!gotFc) return false;

  size_t offset = 6;
  uint8_t sn = 1;
  uint8_t sentInBlock = 0;
  while (offset < len) {
    uint8_t cf[8] = {};
    cf[0] = (uint8_t)(0x20 | (sn & 0x0F));
    size_t chunk = (len - offset) < 7 ? (len - offset) : 7;
    memcpy(cf + 1, payload + offset, chunk);
    if (!canBusSend(reqId_, cf, 8)) return false;
    offset += chunk;
    sn = (sn + 1) & 0x0F;
    sentInBlock++;
    if (stMin <= 0x7F) delay(stMin);
    else delay(1);
    if (bs > 0 && sentInBlock >= bs && offset < len) {
      // wait next FC
      sentInBlock = 0;
      t0 = millis();
      gotFc = false;
      while (millis() - t0 < 100) {
        if (!canBusMsgAvailable()) {
          delay(1);
          continue;
        }
        uint32_t id = 0;
        uint8_t data[8] = {};
        uint8_t l = 0;
        if (!canBusRecv(&id, data, &l) || id != rspId_) continue;
        if ((data[0] & 0xF0) == 0x30) {
          bs = data[1];
          stMin = data[2];
          gotFc = true;
          break;
        }
      }
      if (!gotFc) return false;
    }
  }
  return true;
}

bool IsoTpLink::recvResponse(std::vector<uint8_t>& out, uint32_t timeoutMs) {
  out.clear();
  uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    if (!canBusMsgAvailable()) {
      delay(1);
      continue;
    }
    uint32_t id = 0;
    uint8_t data[8] = {};
    uint8_t l = 0;
    if (!canBusRecv(&id, data, &l) || id != rspId_ || l < 1) continue;

    uint8_t pci = data[0] & 0xF0;
    if (pci == 0x00) {
      uint8_t n = data[0] & 0x0F;
      if (n > 7) continue;
      out.assign(data + 1, data + 1 + n);
      return true;
    }
    if (pci == 0x10) {
      size_t total = ((size_t)(data[0] & 0x0F) << 8) | data[1];
      out.assign(data + 2, data + 8);
      // FC CTS
      uint8_t fc[8] = {0x30, 0x00, 0x00, 0, 0, 0, 0, 0};
      canBusSend(reqId_, fc, 8);
      uint8_t expectSn = 1;
      while (out.size() < total && millis() - t0 < timeoutMs) {
        if (!canBusMsgAvailable()) {
          delay(1);
          continue;
        }
        if (!canBusRecv(&id, data, &l) || id != rspId_) continue;
        if ((data[0] & 0xF0) != 0x20) continue;
        if ((data[0] & 0x0F) != expectSn) continue;
        size_t need = total - out.size();
        size_t chunk = need < 7 ? need : 7;
        out.insert(out.end(), data + 1, data + 1 + chunk);
        expectSn = (expectSn + 1) & 0x0F;
      }
      return out.size() >= total;
    }
  }
  return false;
}

bool IsoTpLink::request(const uint8_t* payload, size_t len, std::vector<uint8_t>& response, uint32_t timeoutMs) {
  if (!payload || len == 0) return false;
  bool ok = (len <= 7) ? sendSf(payload, len) : sendFfCf(payload, len);
  if (!ok) return false;
  return recvResponse(response, timeoutMs);
}
