# Деплой Volvo XC70 EWD на VPS (без SSH)

Сервер: `195.19.12.173` · каталог: `/opt/ewd-app` · контейнер: `volvo-xc70-wiring` · порт: `3000`

SSH может давать timeout — используйте **веб-консоль / VNC** хостинга и **File Manager / FTP**.

## Что лежит в GitHub, а что нет

| В GitHub (git pull) | Только вручную на сервер (FTP/панель) |
|---------------------|----------------------------------------|
| Код `server/`, `client/`, Docker | `data/ewd/ewd_source/` (SVG, большой архив) |
| `data/wiring.sqlite` (~0.6 MB) | `data/ewd/EPC.zip`, `imagerepository_Data.MDF` (не обязательны для списка узлов) |
| `data/dtc.sqlite` (~словарь DTC/OBD из VIDA) | |
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

## 3. Схемы (SVG) и таблицы (PDF) — без прямого доступа ПК→VPS

Список узлов = SQLite. Схемы/таблицы = архив ~287 MB.

### A. Один раз: выложить части в GitHub Release (с ПК в браузере)

Целый файл 287 MB GitHub в поле описания не принимает (лимит 25 MB).  
Нужны **части по 20 MB** из папки:

`C:\Users\eni19\volvo-xc70-wiring\dist-upload\parts\`  
файлы: `ewd-runtime.tar.gz.00` … `ewd-runtime.tar.gz.14` (15 штук)

1. Откройте https://github.com/zish88/ewd/releases/new  
2. Tag: `ewd-runtime-v1` · Title: `EWD runtime`  
3. **Не** кидайте файлы в «Describe this release»  
4. Прокрутите вниз до **Attach binaries** и прикрепите все 15 частей  
5. Publish release  

### B. На VPS (веб-консоль)

```bash
cd /opt/ewd-app
git pull
bash fetch-ewd.sh
BUILD=1 bash deploy.sh
```

Скрипт скачает все части, склеит, распакует SVG+PDF.

В `health`: `"ewdSourceExists":true` и `"pdfExists":true`.

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

## 6. Домен ewd-volvo.ru + HTTPS (Nginx)

DNS на reg.ru (A `@` и `www` → IP VPS) **не открывает порт 3000**. Нужен reverse proxy на 80/443.

На VPS (веб-консоль), когда приложение уже работает на `:3000`:

```bash
cd /opt/ewd-app
git pull
sudo bash scripts/setup-domain.sh
```

Скрипт: ставит Nginx → проксирует на `127.0.0.1:3000` → выпускает Let's Encrypt для `ewd-volvo.ru` и `www`.

Свой email для Let's Encrypt (рекомендуется):

```bash
sudo EMAIL=you@example.com bash scripts/setup-domain.sh
```

После успеха открывайте **https://ewd-volvo.ru** (не `:3000`).

Если сертификаты уже выпущены вручную на reg.ru — всё равно нужен Nginx (или другой прокси) на сервере; DNS сам SSL не включает.

## 7. Проверка в браузере

1. Открыть `https://ewd-volvo.ru` (или временно `http://195.19.12.173:3000`).
2. Модель **XC70**, год **2008**.
3. Зона **Задние двери** → в «Компонент / разъём» появятся узлы.

## 8. Как обновляются данные на сервере

| Что меняется | Как обновить |
|--------------|--------------|
| Код приложения (фильтры, UI, API) | `git pull` → `BUILD=1 bash deploy.sh` |
| SQLite из репозитория | `bash fixdb.sh` (осторожно: затрёт правки админа в БД) |
| SVG + PDF | `bash fetch-ewd.sh` (после GitHub Release) |
| Ручные пины/разъёмы/провода | кнопка **Админ** на сайте → пишутся в `/opt/ewd-app/data/wiring.sqlite` (volume, переживают рестарт) |

Перед `fixdb.sh` / восстановлением sqlite с GitHub сделайте копию:  
`cp data/wiring.sqlite data/wiring.sqlite.bak`

## 9. Админ-панель (отдельная страница)

Адрес: `http://SERVER:3000/admin`

В `/opt/ewd-app/.env` (подхватывается `deploy.sh` / `fixdb.sh` и пробрасывается в контейнер):

```bash
ADMIN_PASSWORD=ваш_секретный_пароль
ADMIN_SECRET=случайная_длинная_строка
MODERATOR_EMAIL=elzidevelop@gmail.com

# Почта заявок (Gmail App Password)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=elzidevelop@gmail.com
SMTP_PASS=xxxx-xxxx-xxxx-xxxx
SMTP_FROM=elzidevelop@gmail.com
```

После правок `.env` перезапустите контейнер: `BUILD=1 bash scripts/vps-deploy.sh` или `bash fixdb.sh`  
(скрипты подхватывают `.env` через `docker --env-file`).

Проверка SMTP в консоли VPS:

```bash
docker exec volvo-xc70-wiring printenv SMTP_HOST SMTP_USER SMTP_FROM MODERATOR_EMAIL
docker logs volvo-xc70-wiring --tail 40
# после входа в /admin:
curl -sS -X POST http://127.0.0.1:3000/api/admin/smtp-test -H "Cookie: $(…)" 
```

Или снова ✎ на карточке: в ответе должно быть `emailSent: true`.  
Если снова ошибка — в `warning` теперь будет код (`EAUTH` / `ETIMEDOUT` / `ESOCKET`).

Частые причины: App Password отозван; outbound TCP 587 закрыт у хостера; контейнер без `SMTP_*` (не сделали restart после правки `.env`).

**Важно:** пароль приложения Gmail (`SMTP_PASS`) только в `/opt/ewd-app/.env` на VPS — никогда в git.

### DTC / OBD словарь

Файл `data/dtc.sqlite` (~18 MB) поднимается вместе с wiring при `deploy.sh` / `fixdb.sh`.
Пересборка с ПК: `python scripts/extract_vida_dtc.py` (нужен LocalDB + `DiagSwdlRepository_Data.MDF`).
На сайте: блок «Коды ошибок DTC / OBD» → `/api/dtc/search?q=…`.

На `/admin` после входа:
- открыть / закрыть весь сайт;
- включить / выключить функции (схемы, таблицы, VIN, навигацию, предложения правок);
- добавлять узлы и провода в SQLite.

Пользователи на главной жмут **✎** на карточке → заявка на почту со **ссылкой на карточку** (`wireId` + zone + code).

## Конфликт имени контейнера

Если `up` пишет Conflict:

```bash
docker rm -f volvo-xc70-wiring
docker compose up -d
```
