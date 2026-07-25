# OBD Gateway — железо

## Рекомендуемый вариант (текущий)

| Параметр | Значение |
|----------|----------|
| MCU | **ESP32-S3 N16R8** |
| CAN | **TWAI + SN65HVD230** (3.3 V) |
| Шина | HS-CAN **500 kbit/s**, OBD **6 / 14** |
| TX / RX | **GPIO 17** / **GPIO 18** |

Подробная сборка и заливка: **[../ASSEMBLY-N16R8-SN65HVD230.md](../ASSEMBLY-N16R8-SN65HVD230.md)**  
Arduino-скетч: **[../arduino/EwdObdGatewayTwai](../arduino/EwdObdGatewayTwai)**

## Альтернатива (уже проверенная на XC70)

| Параметр | Значение |
|----------|----------|
| CAN | **MCP2515 + TJA1050**, кварц **8 MHz** (как vedomaya_OBD_v2) |
| Прошивка | PlatformIO env `esp32-s3-n16r8-mcp2515` |

## Пины TWAI (по умолчанию)

| Сигнал | GPIO |
|--------|------|
| TWAI TX → CTX модуля | 17 |
| TWAI RX ← CRX модуля | 18 |

Переопределение: `include/config.h` (`OBD_TWAI_TX` / `OBD_TWAI_RX`).
