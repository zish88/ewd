#pragma once
#include <Arduino.h>
#include <stdint.h>

struct CanBusStats {
  uint32_t txError;
  uint32_t rxError;
  uint32_t busError;
  const char* stateName;
};

bool canBusBegin();
bool canBusSend(uint32_t id, const uint8_t* data, uint8_t len);
bool canBusRecv(uint32_t* id, uint8_t* data, uint8_t* len);
bool canBusMsgAvailable();
bool canBusGetStats(CanBusStats* out);
