#include "can_bus.h"
#include "config.h"
#include <cstring>
#include "driver/twai.h"

// Arduino sketch build: always TWAI + SN65HVD230 (no MCP2515).

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
