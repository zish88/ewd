# EWD OBD Gateway (ESP32-S3 N16R8)

Шлюз HS-CAN → Wi‑Fi JSON для [ewd-volvo.ru](https://ewd-volvo.ru).

- Сборка с **SN65HVD230**: [../ASSEMBLY-N16R8-SN65HVD230.md](../ASSEMBLY-N16R8-SN65HVD230.md)
- Arduino IDE: [../arduino/EwdObdGatewayTwai](../arduino/EwdObdGatewayTwai)
- Железо: [HARDWARE.md](./HARDWARE.md) · Протокол: [docs/obd-gateway-protocol.md](../../docs/obd-gateway-protocol.md)

## PlatformIO

```bash
cd firmware/obd-gateway
# Рекомендуется: TWAI + SN65HVD230
pio run -e esp32-s3-n16r8-twai -t upload
pio device monitor -e esp32-s3-n16r8-twai

# Альтернатива: MCP2515 8 MHz
pio run -e esp32-s3-n16r8-mcp2515 -t upload
```

## Поведение

1. SoftAP `EWD-OBD-Gateway` / пароль `volvo-obd` → IP обычно `192.168.4.1`
2. `POST /scan` — UDS probe + ReadDTCInformation (0x19) по карте ECU
3. После скана: **Mode 01 supported-PID discovery** + round-robin data PIDs → `GET /signals`
4. `GET /health` — состояние шины (`busStatus`) + список supported PIDs
5. `POST /clear?ecu=ECM&confirm=1` — единственный путь Clear DTC

Live API универсальный (`signals[]`), без акцента на одном PID.

**Нет** Security Access / seed-key / записи DID в этом дереве.
