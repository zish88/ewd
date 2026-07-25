# Протокол OBD Gateway ↔ сайт

Контракт JSON между прошивкой [`firmware/obd-gateway`](../firmware/obd-gateway) и UI ewd-volvo.ru.

## Транспорт

| Канал | Назначение |
|-------|------------|
| `GET http://<gateway>/health` | Статус адаптера |
| `GET/POST http://<gateway>/scan` | Последний скан / запуск UDS-скана |
| `POST http://<gateway>/clear?ecu=ECM&confirm=1` | Сброс DTC (**только** с `confirm=1`) |
| `POST /api/obd/enrich` (сайт) | Обогащение кодов словарём `dtc.sqlite` |

HTTPS-сайт не может напрямую ходить на `http://192.168.4.1` (mixed content). В проде: демо-скан, вставка JSON из вкладки шлюза, либо локальный dev-прокси.

## ELM327 (классика Wi‑Fi / Bluetooth)

UI: кнопка **«OBD тест»** в шапке → вкладка **ELM327**.

| Канал | Из браузера |
|-------|-------------|
| Wi‑Fi ELM (TCP :35000 AT) | **Нет** сырого TCP. Вставьте ответ Mode `03` / `0105` в поле или используйте внешний терминал / будущий локальный мост. |
| Bluetooth Classic (SPP) | Web Bluetooth **не** поддерживает SPP. |
| Bluetooth BLE UART | Частично: Android Chrome → «Подключить BLE»; разбор AT → тот же `ObdScanPayload`. |

Парсер: `client/src/obd/elmParse.ts` (кадры `43…`, `47…`, `4A…`, `4105`).

## JSON скана (MVP)

```json
{
  "vin": null,
  "bus": "HS-CAN",
  "device": "esp32-s3-n16r8",
  "readOnlyDefault": true,
  "ecus": [{ "id": "ECM", "req": "0x7E0", "rsp": "0x7E8", "online": true }],
  "dtcs": [{ "ecu": "ECM", "code": "P0420", "status": "confirmed", "raw": "042000:01" }],
  "live": { "coolantC": 92 }
}
```

## Безопасность

- По умолчанию только чтение (PID + UDS 0x19 + probe).
- Clear DTC — двойное подтверждение в UI + `confirm=1` на шлюзе.
- Security Access / запись в ECU — запрещены в публичной прошивке.
