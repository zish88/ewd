#pragma once
#include <Arduino.h>
#include <stdint.h>
#include <vector>

/** Minimal ISO-TP (ISO 15765-2) over 11-bit CAN for UDS. */
class IsoTpLink {
 public:
  void setIds(uint32_t req, uint32_t rsp);
  bool request(const uint8_t* payload, size_t len, std::vector<uint8_t>& response, uint32_t timeoutMs);

 private:
  uint32_t reqId_ = 0;
  uint32_t rspId_ = 0;
  bool sendSf(const uint8_t* payload, size_t len);
  bool sendFfCf(const uint8_t* payload, size_t len);
  bool recvResponse(std::vector<uint8_t>& out, uint32_t timeoutMs);
};
