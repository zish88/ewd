# Деплой Volvo XC70 EWD на VPS (без SSH)

Сервер: `195.19.12.173` · каталог: `/opt/ewd-app` · контейнер: `volvo-xc70-wiring` · порт: `3000`

SSH может давать timeout — используйте **веб-консоль / VNC** хостинга и **File Manager / FTP**.

## Что лежит в GitHub, а что нет

| В GitHub (git pull) | Только вручную на сервер (FTP/панель) |
|---------------------|----------------------------------------|
| Код `server/`, `client/`, Docker | `data/ewd/ewd_source/` (SVG, большой архив) |
| `data/wiring.sqlite` (~0.6 MB) | `data/ewd/EPC.zip`, `imagerepository_Data.MDF` (не обязательны для списка узлов) |
| `data/ewd/*_index.json` | |

## 1. Обновить код

В консоли сервера (по одной строке):

```bash
cd /opt/ewd-app
git fetch origin
```

Если `git checkout master` пишет  
`Your local changes ... would be overwritten` (часто файл `run.sh`) — сбросить локальные правки и взять код с GitHub:

```bash
git checkout -f master
git reset --hard origin/master
```

Если ветки `master` ещё нет локально:

```bash
git checkout -f -B master origin/master
```

Это удаляет только локальные отличия на сервере; нужен именно код из репозитория.

## 2. Восстановить SQLite (если список узлов пустой)

Зоны в UI всегда видны (хардкод меток). Пустой «Компонент / разъём» = **пустая или старая БД** на диске `/opt/ewd-app/data/`.

Восстановить БД из Git (на сервере):

```bash
cd /opt/ewd-app
git fetch origin
git checkout -f master
git reset --hard origin/master
git checkout HEAD -- data/wiring.sqlite
ls -la data/wiring.sqlite
docker restart volvo-xc70-wiring
curl -s http://127.0.0.1:3000/api/health
```

В `health` должно быть примерно: `"components":746,"wires":4775,"pages":368` и `"ok":true`.

Если `git checkout HEAD -- data/wiring.sqlite` не помог — залить файл с ПК  
`C:\Users\eni19\volvo-xc70-wiring\data\wiring.sqlite` → `/opt/ewd-app/data/wiring.sqlite` через File Manager, затем:

```bash
docker restart volvo-xc70-wiring
```

## 3. Залить SVG-источник (для схем)

1. На ПК упаковать `data/ewd/ewd_source` в zip/tar.
2. Загрузить архив в `/opt/ewd-app/data/ewd/`.
3. Распаковать на сервере, чтобы получилось `/opt/ewd-app/data/ewd/ewd_source/...`.

Индексы JSON подтянутся из git. MDF/EPC можно не копировать для старта.

## 4. Пересобрать Docker без кэша

```bash
cd /opt/ewd-app
docker rm -f volvo-xc70-wiring
docker-compose build --no-cache
docker-compose up -d
docker ps
docker logs --tail 50 volvo-xc70-wiring
```

В логах должны быть `DATABASE_PATH=/app/data/wiring.sqlite` и старт без SQLITE wipe.

## 5. Проверка API

```bash
curl -s "http://127.0.0.1:3000/api/health"
curl -s "http://127.0.0.1:3000/api/nav/components?zone=all" | head -c 400
curl -s "http://127.0.0.1:3000/api/nav/components?zone=rear_doors" | head -c 400
```

Ожидание: JSON с `groups` и непустыми `items`.

## 6. Проверка в браузере

1. Открыть `http://195.19.12.173:3000` (или ваш домен/прокси).
2. Модель **XC70**, год **2008**.
3. Зона **Задние двери** → в «Компонент / разъём» появятся узлы.

## Конфликт имени контейнера

Если `docker-compose up` пишет Conflict:

```bash
docker rm -f volvo-xc70-wiring
docker-compose up -d
```
