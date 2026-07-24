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
- Админка `/admin`: открыть/закрыть сайт, флаги функций, счётчик посещений (сутки / неделя / месяц / всего)

## Стек

| Слой | Технологии |
|------|------------|
| UI | React, Vite, Tailwind |
| API | Express, TypeScript (`tsx`) |
| Данные | SQLite (`better-sqlite3`): `wiring.sqlite`, `dtc.sqlite` |
| Схемы | Capital EWD SVG + JSON-индексы в `data/ewd/` |
| Прод | Docker на VPS, Nginx → HTTPS |

## Быстрый старт (локально)

```powershell
cd C:\Users\eni19\volvo-xc70-wiring
npm install
npm run dev
```

Или: `npm run dev:local` (подставит `.env` из `.env.example`, если файла ещё нет).

| Что | URL |
|-----|-----|
| UI (Vite) | http://localhost:5173 |
| API | http://localhost:3000 (`/api` проксируется с UI) |
| Админ | http://localhost:5173/admin |

Нужны на диске:

- `data/wiring.sqlite`, `data/dtc.sqlite` — в git
- `data/ewd/*_index.json` — в git
- `data/ewd/ewd_source/…` — SVG-пакет Capital (**не** в git; один раз положить локально / на VPS)

Скопируйте `.env.example` → `.env`. Для админки локально задайте `ADMIN_PASSWORD` (и желательно `ADMIN_SECRET`).

Проверка:

```powershell
npm run typecheck
npm test
```

## Данные

| Путь | Назначение |
|------|------------|
| `data/wiring.sqlite` | Узлы, провода, зоны (деплой восстанавливает из git) |
| `data/dtc.sqlite` | Словарь DTC / OBD |
| `data/ewd/` | Индексы и SVG-источник схем |
| `data/visits.sqlite` | Счётчик посещений (создаётся на сервере, **не** в git; деплой не затирает) |
| `data/site-settings.json` | Открыт ли сайт и флаги функций (на volume) |
| `data/vida_*.json` | PN / BOM с EPC для карточек |

Опциональный импорт PDF-мануала (не нужен для основного EWD):

```powershell
npm run import:manual -- "C:\path\to\manual.pdf"
```

## Админ

Страница: `/admin` (пароль из `ADMIN_PASSWORD`).

- Доступность сайта и отдельные функции (схемы, VIN, навигация, DTC, предложения)
- Посещения: сутки / неделя / месяц / всего и лента «когда заходили»
- Ручное добавление узлов / проводов в SQLite

Заявки с ✎ на карточке уходят на `MODERATOR_EMAIL` через SMTP (см. `.env.example`). Секреты только в `/opt/ewd-app/.env` на VPS — не коммитить.

## Деплой

Подробно: [DEPLOY.md](./DEPLOY.md).

Кратко (веб-консоль VPS; SSH с ПК часто таймаутится):

```bash
cd /opt/ewd-app
git fetch origin
git checkout -f master
git reset --hard origin/master
BUILD=1 bash deploy.sh
```

- Каталог: `/opt/ewd-app` · контейнер: `volvo-xc70-wiring` · порт: `3000`
- Код и sqlite — из git; SVG `ewd_source` — отдельно (`fetch-ewd.sh` / FTP)
- После смены только `.env` достаточно перезапуска контейнера (без обязательного `BUILD=1`)

## Важно

Данные — справочные выгрузки EWD/VIDA, а не гарантия конфигурации конкретной машины. Перед работами сверяйте VIN, двигатель, разъём и фактическую проводку. Не вмешивайтесь в SRS/SIPS и силовые цепи без профильной документации и безопасного обесточивания.
