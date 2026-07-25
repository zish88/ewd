#pragma once
#include <Arduino.h>
#include <vector>
#include "ecu_map.h"

struct UdsDtcItem {
  String ecu;
  String code;
  String status;
  String raw;
};

struct UdsEcuStatus {
  String id;
  String req;
  String rsp;
  bool online;
};

struct UdsScanResult {
  std::vector<UdsEcuStatus> ecus;
  std::vector<UdsDtcItem> dtcs;
};

bool udsProbeEcu(const EcuEntry& ecu, uint32_t timeoutMs);
bool udsReadDtcs(const EcuEntry& ecu, std::vector<UdsDtcItem>& out, uint32_t timeoutMs);
UdsScanResult udsFullScan(uint32_t timeoutMs);
bool udsClearDtcs(const EcuEntry& ecu, bool confirmed, uint32_t timeoutMs);
bool obdReadCoolantC(int* outC);
