# Протокол OBD Gateway ↔ сайт

Контракт JSON между прошивкой [`firmware/obd-gateway`](../firmware/obd-gateway) и UI ewd-volvo.ru.

**Vehicle-agnostic:** шлюз и протокол не привязаны к модели, году или платформе. ECU в `/scan` — результат probe кандидатных адресов; live `signals` — Mode 01 discovery на конкретной машине.

## Транспорт

| Канал | Назначение |
|-------|------------|
| `GET http://<gateway>/health` | Статус шины TWAI/MCP + `supportedPids` |
| `GET http://<gateway>/signals` | Универсальный live API: `signals[]` + discovery |
| `GET/POST http://<gateway>/scan` | UDS-скан ECU/DTC + снимок `signals` / `supportedPids` |
| `POST http://<gateway>/clear?ecu=ECM&confirm=1` | Сброс DTC (**только** с `confirm=1`) |
| `POST /api/obd/enrich` (сайт) | Обогащение кодов словарём `dtc.sqlite` |

HTTPS-сайт не может напрямую ходить на `http://192.168.4.1` (mixed content). В проде: демо-скан, вставка JSON из вкладки шлюза, либо локальный dev-прокси.

## Почему BLE / ELM «не видит» ESP (плата N16R8)

Прошивка шлюза EWD (**ESP32-S3 N16R8 + SN65HVD230**) отдаёт **только Wi‑Fi SoftAP + HTTP JSON**. В ней **нет** BLE/NimBLE и **нет** эмуляции ELM327 AT.

| Ожидание | Реальность |
|----------|------------|
| Подключить N16R8 как ELM по Bluetooth | Нельзя: на плате нет BLE и нет AT-протокола ELM |
| Classic BT (SPP) из браузера | Web Bluetooth **не умеет** SPP |
| Кнопка «Скан со шлюза» с https://ewd-volvo.ru | **Mixed content**: HTTPS-страница не делает `fetch` на `http://192.168.4.1` |

**Как правильно:** телефон/ПК → Wi‑Fi `EWD-OBD-Gateway` / пароль `volvo-obd` → `http://192.168.4.1` → JSON с `/scan` → вставить во вкладку **ESP шлюз** на сайте (или демо-скан). Вкладка **ELM327** — только для внешних адаптеров ELM.

UI по умолчанию открывает вкладку **ESP шлюз**.

## ELM327 (классика Wi‑Fi / Bluetooth)

UI: OBD → вкладка **ELM327** (не для платы EWD N16R8).

| Канал | Из браузера |
|-------|-------------|
| Wi‑Fi ELM (TCP :35000 AT) | **Нет** сырого TCP. Вставьте ответ Mode `03` / `01xx` в поле или используйте внешний терминал / будущий локальный мост. |
| Bluetooth Classic (SPP) | Web Bluetooth **не** поддерживает SPP. |
| Bluetooth BLE UART | Частично: Android Chrome → «Подключить BLE»; разбор AT → тот же `ObdScanPayload`. |

Парсер: `client/src/obd/elmParse.ts` (кадры `43…` / `47…` / `4A…` и Mode 01 `41 <pid> …` → `signals[]`).

## Live signals (SLICE-03)

После `POST /scan` шлюз делает **Mode 01 supported-PID discovery** (`01 00` / `01 20` / …) и round-robin читает data-PID. UI и API **не завязаны** на один PID (в т.ч. не акцентируют PID 05 / ОЖ).

`GET /signals`:

```json
{
  "bus": "HS-CAN",
  "device": "esp32-s3-n16r8",
  "busStatus": { "ok": true, "state": "RUNNING", "txErr": 0, "rxErr": 0, "lastScanAgeMs": 900 },
  "supportedPids": ["04", "0C", "0D", "11", "42"],
  "signals": [
    { "id": "engine_rpm", "pid": "0C", "name": "Engine RPM", "value": 820, "unit": "rpm" },
    { "id": "throttle", "pid": "11", "name": "Throttle position", "value": 12.5, "unit": "%" }
  ]
}
```

Неизвестный, но supported PID → `id: "pid_XX"`, `unit: "raw"`.

## JSON скана

```json
{
  "vin": null,
  "bus": "HS-CAN",
  "device": "esp32-s3-n16r8",
  "readOnlyDefault": true,
  "ecus": [{ "id": "ECM", "req": "0x7E0", "rsp": "0x7E8", "online": true }],
  "dtcs": [{ "ecu": "ECM", "code": "P0420", "status": "confirmed", "raw": "042000:01" }],
  "supportedPids": ["04", "0C", "0D", "11"],
  "busStatus": { "ok": true, "state": "RUNNING", "txErr": 0, "rxErr": 0, "lastScanAgeMs": 500 },
  "signals": [
    { "id": "engine_rpm", "pid": "0C", "name": "Engine RPM", "value": 820, "unit": "rpm" }
  ]
}
```

Поле `live` устарело; клиент ещё умеет показать его как fallback signals.

## Безопасность

- По умолчанию только чтение (Mode 01 discovery/signals + UDS 0x19 + probe).
- Clear DTC — двойное подтверждение в UI + `confirm=1` на шлюзе.
- Security Access / запись в ECU — запрещены в публичной прошивке.
