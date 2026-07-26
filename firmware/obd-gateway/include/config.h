#pragma once

// SoftAP for phone ↔ gateway (browser opens site + connects to this AP / LAN IP)
#ifndef OBD_WIFI_SSID
#define OBD_WIFI_SSID "EWD-OBD-Gateway"
#endif
#ifndef OBD_WIFI_PASS
#define OBD_WIFI_PASS "volvo-obd"
#endif

#ifndef OBD_HTTP_PORT
#define OBD_HTTP_PORT 80
#endif
#ifndef OBD_WS_PORT
#define OBD_WS_PORT 81
#endif

// MCP2515 SPI (ESP32-S3 N16R8) — override if your PCB differs
#ifndef OBD_CAN_CS
#define OBD_CAN_CS 10
#endif
#ifndef OBD_CAN_INT
#define OBD_CAN_INT 9
#endif
#ifndef OBD_SPI_SCK
#define OBD_SPI_SCK 12
#endif
#ifndef OBD_SPI_MISO
#define OBD_SPI_MISO 13
#endif
#ifndef OBD_SPI_MOSI
#define OBD_SPI_MOSI 11
#endif

// TWAI ↔ SN65HVD230 (this Arduino sketch is TWAI-only)
// CTX(TXD) ← GPIO17, CRX(RXD) → GPIO18  — see ASSEMBLY-N16R8-SN65HVD230.md
#ifndef OBD_TWAI_TX
#define OBD_TWAI_TX 17
#endif
#ifndef OBD_TWAI_RX
#define OBD_TWAI_RX 18
#endif

#ifndef OBD_CAN_KBPS
#define OBD_CAN_KBPS 500
#endif

// Round-robin Mode 01 data-PID poll interval when session active
#ifndef OBD_PID_POLL_MS
#define OBD_PID_POLL_MS 200
#endif

// UDS timings
#ifndef OBD_UDS_TIMEOUT_MS
#define OBD_UDS_TIMEOUT_MS 80
#endif
#ifndef OBD_TESTER_PRESENT_MS
#define OBD_TESTER_PRESENT_MS 2000
#endif
