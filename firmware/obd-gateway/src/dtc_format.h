#pragma once
#include <Arduino.h>
#include <stdint.h>

/** Decode 3-byte UDS DTC into SAE-like string (P0xxx / C0xxx / B0xxx / U0xxx). */
String formatUdsDtc(uint8_t b0, uint8_t b1, uint8_t b2);
