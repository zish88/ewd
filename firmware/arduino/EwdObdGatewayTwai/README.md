# Arduino: EwdObdGatewayTwai

Скетч для **ESP32-S3 N16R8 + SN65HVD230**.

1. Сборка железа: [../../ASSEMBLY-N16R8-SN65HVD230.md](../../ASSEMBLY-N16R8-SN65HVD230.md)
2. Откройте `EwdObdGatewayTwai.ino` в Arduino IDE
3. Библиотека: **ArduinoJson** v7 (Sketch → Include Library → Manage Libraries)
4. Board: ESP32S3 Dev Module, Flash 16MB, USB CDC On Boot = Enabled → Upload

SoftAP: `EWD-OBD-Gateway` / `volvo-obd` → `http://192.168.4.1`

API: `GET /health`, `GET /signals` (Mode 01 discovery + universal signals), `GET|POST /scan`, `POST /clear?confirm=1`.
