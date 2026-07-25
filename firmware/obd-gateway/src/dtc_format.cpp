#include "dtc_format.h"

String formatUdsDtc(uint8_t b0, uint8_t b1, uint8_t b2) {
  const char letters[] = {'P', 'C', 'B', 'U'};
  char letter = letters[(b0 >> 6) & 0x03];
  uint8_t d1 = (b0 >> 4) & 0x03;
  uint8_t d2 = b0 & 0x0F;
  uint8_t d3 = (b1 >> 4) & 0x0F;
  uint8_t d4 = b1 & 0x0F;
  char buf[8];
  snprintf(buf, sizeof(buf), "%c%X%X%X%X", letter, d1, d2, d3, d4);
  (void)b2;  // failure type byte kept in raw hex on caller side
  return String(buf);
}
