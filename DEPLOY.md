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

## 3. Схемы (SVG) и таблицы (PDF) — через File Manager

Список узлов = SQLite. **Схемы** и кнопка **«Таблица»** требуют файлы с ПК (~0.9 GB + 46 MB).

### Схемы (иначе `SVG file missing`)

1. На ПК: упаковать папку  
   `C:\Users\eni19\volvo-xc70-wiring\data\ewd\ewd_source` → `ewd_source.zip`
2. File Manager: залить zip в `/opt/ewd-app/data/ewd/`
3. Распаковать так, чтобы было:  
   `/opt/ewd-app/data/ewd/ewd_source/39363002/1/2/`  
   (внутри — папки `UID…` и файлы `.svg`)

Проверка в консоли:

```bash
ls /opt/ewd-app/data/ewd/ewd_source/39363002/1/2 | head
```

### Таблицы / PDF (иначе «PDF недоступен»)

1. С ПК скопировать файл  
   `Электросхемы XC70.pdf`  
   (лежит рядом с `data\ewd\` или в `E:\manual\`)
2. File Manager: залить в `/opt/ewd-app/manual/Электросхемы XC70.pdf`

### После заливки файлов

Освободить место и пересобрать образ (нужен фикс путей Windows→Linux):

```bash
cd /opt/ewd-app
docker system prune -af
git pull
BUILD=1 bash deploy.sh
```

В `health` смотрите: `"ewdSourceExists":true` и `"pdfExists":true`.

## 4. Деплой одной строкой (рекомендуется для веб-консоли)

На многих панелях нельзя вставить многострочные команды, а `docker-compose` 1.29 падает с `KeyError: 'ContainerConfig'`.
Скрипт сам: git sync → восстановление SQLite → `docker build` → `docker run` (без compose).

Если в веб-консоли **нет вставки**, наберите три строки:

```bash
cd /opt/ewd-app
git pull
bash deploy.sh
```

Скрипт: остановит контейнер → восстановит `data/wiring.sqlite` из git → проверит `components > 0` → `docker build --no-cache` → `docker run`.

Быстрый ремонт БД без пересборки (если образ уже новый):

```bash
cd /opt/ewd-app
git pull
bash fixdb.sh
```

В конце `/api/health` должен дать `"ok":true` и `"components":746`.

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

Если `up` пишет Conflict:

```bash
docker rm -f volvo-xc70-wiring
docker compose up -d
```
