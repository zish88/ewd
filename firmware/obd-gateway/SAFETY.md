# Политика безопасности OBD Gateway

Публичная прошивка **не** содержит:

- алгоритмов Security Access / seed-key;
- записи DID, coding, flash, RoutineControl;
- автоматического Clear DTC при подключении.

Разрешено по умолчанию:

- OBD-II Mode 01 (live, напр. PID 05);
- UDS TesterPresent, DiagnosticSessionControl (для чтения);
- UDS ReadDTCInformation (`0x19`);
- короткий probe ECU online.

Clear DTC (`0x14`):

1. Двойное подтверждение в UI сайта.
2. HTTP `POST /clear?ecu=…&confirm=1` или WS с `"confirm":true`.
3. Без `confirm` шлюз отвечает 400 и **не** шлёт кадры в CAN.

На дороге — только чтение. Не публикуйте форки с обходом иммобилайзера.
