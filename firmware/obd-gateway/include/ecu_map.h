#pragma once
#include <Arduino.h>

/** Volvo P3 HS-CAN diagnostic addresses (starter map — expand on vehicle). */
struct EcuEntry {
  const char* id;
  uint32_t reqId;
  uint32_t rspId;
};

// 11-bit IDs commonly used on OBD HS-CAN for powertrain / body modules.
// CEM / others may need extended addressing on some cars — extend after road tests.
static const EcuEntry kEcuMap[] = {
  {"ECM", 0x7E0, 0x7E8},
  {"TCM", 0x7E1, 0x7E9},
  {"ABS", 0x760, 0x768},
  {"CEM", 0x726, 0x72E},
  {"DIM", 0x734, 0x73C},
  {"PSM", 0x733, 0x73B},
  {"AUD", 0x727, 0x72F},
  {"SRS", 0x730, 0x738},
};

static const size_t kEcuMapLen = sizeof(kEcuMap) / sizeof(kEcuMap[0]);
