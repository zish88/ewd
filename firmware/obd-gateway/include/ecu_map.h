#pragma once
#include <Arduino.h>

/**
 * Candidate HS-CAN diagnostic request/response IDs (11-bit).
 * Vehicle-agnostic: not tied to a model, year, or platform family.
 * Scan reports only ECUs that answer TesterPresent; silent addresses are offline.
 * Expand the table from on-vehicle discovery — never assume a fixed car profile.
 */
struct EcuEntry {
  const char* id;
  uint32_t reqId;
  uint32_t rspId;
};

// SAE powertrain pairs (7E0/7E8, 7E1/7E9) + common body/chassis candidates.
// Label strings are stable keys for UI/API, not claims about a specific vehicle.
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
