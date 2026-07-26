#include "can_bus.h"
#include "config.h"
#include <cstring>

#if defined(OBD_CAN_BACKEND_TWAI)
#include "driver/twai.h"

bool canBusBegin() {
  twai_general_config_t g =
      TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)OBD_TWAI_TX, (gpio_num_t)OBD_TWAI_RX, TWAI_MODE_NORMAL);
  twai_timing_config_t t = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t f = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  if (twai_driver_install(&g, &t, &f) != ESP_OK) {
    Serial.println("TWAI driver_install FAIL");
    return false;
  }
  if (twai_start() != ESP_OK) {
    Serial.println("TWAI start FAIL");
    return false;
  }
  Serial.printf("TWAI 500k OK (TX=GPIO%d RX=GPIO%d)\n", OBD_TWAI_TX, OBD_TWAI_RX);
  return true;
}

bool canBusSend(uint32_t id, const uint8_t* data, uint8_t len) {
  twai_message_t msg = {};
  msg.identifier = id;
  msg.extd = 0;
  msg.data_length_code = len > 8 ? 8 : len;
  memcpy(msg.data, data, msg.data_length_code);
  return twai_transmit(&msg, pdMS_TO_TICKS(20)) == ESP_OK;
}

bool canBusMsgAvailable() {
  twai_status_info_t st;
  if (twai_get_status_info(&st) != ESP_OK) return false;
  return st.msgs_to_rx > 0;
}

bool canBusRecv(uint32_t* id, uint8_t* data, uint8_t* len) {
  twai_message_t msg;
  if (twai_receive(&msg, 0) != ESP_OK) return false;
  *id = msg.identifier;
  *len = msg.data_length_code;
  memcpy(data, msg.data, *len);
  return true;
}

bool canBusGetStats(CanBusStats* out) {
  if (!out) return false;
  twai_status_info_t st;
  if (twai_get_status_info(&st) != ESP_OK) return false;
  out->txError = st.tx_error_counter;
  out->rxError = st.rx_error_counter;
  out->busError = st.bus_error_count;
  switch (st.state) {
    case TWAI_STATE_STOPPED:
      out->stateName = "STOPPED";
      break;
    case TWAI_STATE_RUNNING:
      out->stateName = "RUNNING";
      break;
    case TWAI_STATE_BUS_OFF:
      out->stateName = "BUS_OFF";
      break;
    case TWAI_STATE_RECOVERING:
      out->stateName = "RECOVERING";
      break;
    default:
      out->stateName = "UNKNOWN";
      break;
  }
  return true;
}

#else
// Default: MCP2515 (proven on XC70 via vedomaya_OBD_v2)
#include <SPI.h>
#include <mcp_can.h>

static MCP_CAN CAN(OBD_CAN_CS);

bool canBusBegin() {
  pinMode(OBD_CAN_CS, OUTPUT);
  digitalWrite(OBD_CAN_CS, HIGH);
  SPI.begin(OBD_SPI_SCK, OBD_SPI_MISO, OBD_SPI_MOSI);
  if (CAN.begin(MCP_ANY, CAN_500KBPS, MCP_8MHZ) != CAN_OK) {
    Serial.println("MCP2515 init FAIL — check wiring / crystal 8MHz");
    return false;
  }
  CAN.setMode(MCP_NORMAL);
  Serial.println("MCP2515 500k / 8MHz OK");
  return true;
}

bool canBusSend(uint32_t id, const uint8_t* data, uint8_t len) {
  return CAN.sendMsgBuf(id, 0, len > 8 ? 8 : len, const_cast<byte*>(data)) == CAN_OK;
}

bool canBusMsgAvailable() {
  return CAN.checkReceive() == CAN_MSGAVAIL;
}

bool canBusRecv(uint32_t* id, uint8_t* data, uint8_t* len) {
  unsigned long rxId = 0;
  byte l = 0;
  byte buf[8] = {};
  if (CAN.readMsgBuf(&rxId, &l, buf) != CAN_OK) return false;
  *id = (uint32_t)rxId;
  *len = l;
  memcpy(data, buf, l);
  return true;
}

bool canBusGetStats(CanBusStats* out) {
  if (!out) return false;
  // MCP2515 lib has no rich error counters in this stack
  out->txError = 0;
  out->rxError = 0;
  out->busError = 0;
  out->stateName = "MCP2515";
  return true;
}
#endif
