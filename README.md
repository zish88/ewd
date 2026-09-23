# Volvo EWD — электросхемы Volvo P3

Интерактивный справочник по электросхемам платформы **Volvo P3** (XC70, V70, S80, XC60, S60, V60).  
Основа данных — выгрузки **VIDA** и **Capital EWD** (разъёмы, контакты, цепи, SVG-схемы, словарь DTC/OBD).

Сайт: [https://ewd-volvo.ru](https://ewd-volvo.ru)

## Возможности

- Фильтры: модель, год, двигатель, КПП; опционально VIN
- Навигация по зонам / жгутам и узлам (компонент / разъём)
- Карточки цепей: контакты, цвет, сечение, номера деталей, понятные подписи
- Схемы EWD (SVG): подсветка провода, FaceView разъёма, расположение
- Поиск DTC / OBD по словарю VIDA
- Скан с адаптера ESP32-S3 (см. `firmware/`)
- Предложения правок с карточек
- Мобильный UI: фильтры и параметры узла — bottom sheet

## Данные

| Что | Путь |
|-----|------|
| Wiring | `data/wiring.sqlite` |
| DTC | `data/dtc.sqlite` |
| EWD / Capital | `data/ewd/` |
| Enrichment | `data/enrichment/wire-enrichment.json` (`npm run enrich:wires`) |

## Стек
