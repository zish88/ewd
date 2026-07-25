#pragma once
#include <Arduino.h>
#include <stdint.h>

bool canBusBegin();
bool canBusSend(uint32_t id, const uint8_t* data, uint8_t len);
bool canBusRecv(uint32_t* id, uint8_t* data, uint8_t* len);
bool canBusMsgAvailable();
