#pragma once
#include <Arduino.h>
#include <vector>

struct ObdSignal {
  String id;
  String pidHex;  // e.g. "0C"
  String name;
  float value;
  String unit;
  bool valid;
};

struct ObdBusStatus {
  bool ok;
  String state;
  uint32_t txErr;
  uint32_t rxErr;
  uint32_t busErr;
  int32_t lastScanAgeMs;  // -1 if never scanned
};

/** Discover Mode 01 supported PIDs (bitmasks 00/20/40/…). */
bool obdDiscoverSupportedPids(std::vector<uint8_t>& outPids, uint32_t timeoutMs);

/** Read one Mode 01 PID (functional 0x7DF). */
bool obdReadPidRaw(uint8_t pid, uint8_t* dataOut, uint8_t* lenOut, uint32_t timeoutMs);

/** Decode known PIDs; unknown supported PIDs → raw first data byte as value. */
bool obdDecodePid(uint8_t pid, const uint8_t* data, uint8_t len, ObdSignal& out);

/** Refresh cache: discover (if empty) + round-robin read next data PID. */
void obdSignalsTick(bool sessionActive, uint32_t nowMs);

void obdSignalsMarkScanDone(uint32_t nowMs);
void obdSignalsSetBusOk(bool ok);

const std::vector<uint8_t>& obdSupportedPids();
const std::vector<ObdSignal>& obdSignalCache();
ObdBusStatus obdBusStatusSnapshot(uint32_t nowMs);

/** JSON array of signals for /signals and scan payload. */
String obdSignalsToJsonArray();
String obdSupportedPidsToJsonArray();
String obdBusStatusToJsonObject(uint32_t nowMs);
String obdSignalsApiJson(uint32_t nowMs);
