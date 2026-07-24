# Volvo EWD — интерактивный справочник электросхем

Веб-приложение для поиска разъёмов, контактов и цепей по данным **Capital / VIDA EWD** (платформа P3: XC70, V70, S80, XC60, S60, V60).  
Прод: [https://ewd-volvo.ru](https://ewd-volvo.ru) · репозиторий: [github.com/zish88/ewd](https://github.com/zish88/ewd)

## Возможности

- Фильтры: модель, год, двигатель, КПП; опционально VIN
- Навигация по зонам / жгутам и узлам (компонент / разъём)
- Карточки цепей: контакты, цвет, сечение, номера деталей (деталь / корпус / ответная)
- Схемы EWD (SVG): подсветка провода, FaceView разъёма, расположение
- Поиск DTC / OBD по словарю VIDA
- Предложения правок с карточек (почта модератору)
- Мобильный UI: меню фильтров и параметры узла — bottom sheet, карточки на весь экран

## Стек

| Слой | Технологии |
|------|------------|
| UI | React, Vite, Tailwind |
| API | Express, TypeScript (`tsx`) |
| Данные | SQLite (`better-sqlite3`): wiring + DTC |
| Схемы | Capital EWD SVG + JSON-индексы |
| Прод | Docker на VPS, Nginx → HTTPS |

## Быстрый старт

```bash
npm install
npm run dev
```

Или: `npm run dev:local` (подставит `.env` из `.env.example`, если файла ещё нет).

| Что | URL |
|-----|-----|
| UI (Vite) | http://localhost:5173 |
| API | http://localhost:3000 (`/api` проксируется с UI) |

В репозитории уже есть основные SQLite и JSON-индексы EWD. Пакет SVG-схем Capital в git не входит — его нужно положить рядом с индексами (см. [DEPLOY.md](./DEPLOY.md)).

Скопируйте `.env.example` → `.env`.

Проверка:

```bash
npm run typecheck
npm test
```

## Данные

| Что | Назначение |
|-----|------------|
| Wiring SQLite | Узлы, провода, зоны |
| DTC SQLite | Словарь DTC / OBD |
| EWD indexes + SVG | Индексы и исходник схем Capital |
| VIDA / EPC JSON | Номера деталей на карточках |

Опциональный импорт PDF-мануала (не нужен для основного EWD):

```bash
npm run import:manual -- path/to/manual.pdf
```

## Деплой

Подробно: [DEPLOY.md](./DEPLOY.md).

Кратко на сервере:

```bash
git fetch origin
git checkout -f master
git reset --hard origin/master
BUILD=1 bash deploy.sh
```

Код и sqlite — из git; SVG-пакет схем — отдельно. После смены только `.env` достаточно перезапуска контейнера (без обязательного `BUILD=1`).

## Важно

Данные — справочные выгрузки EWD/VIDA, а не гарантия конфигурации конкретной машины. Перед работами сверяйте VIN, двигатель, разъём и фактическую проводку. Не вмешивайтесь в SRS/SIPS и силовые цепи без профильной документации и безопасного обесточивания.
