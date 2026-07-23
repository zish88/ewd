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
git checkout master
git pull origin master
```

## 2. Восстановить SQLite (если список узлов пустой)

С ПК залить файл `data/wiring.sqlite` в `/opt/ewd-app/data/wiring.sqlite` (перезаписать).

Проверка:

```bash
ls -la /opt/ewd-app/data/wiring.sqlite
```

Ожидание: размер около **600 KB+**.

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
