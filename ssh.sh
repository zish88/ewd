#!/bin/bash
set -e

echo "=== 1. Собираем Docker образ ==="
cd /opt/ewd-app
docker build -t volvo-xc70-wiring-app .

echo "=== 2. Перезапускаем контейнер ==="
docker rm -f volvo-xc70-wiring 2>/dev/null || true
docker run -d \
  --name volvo-xc70-wiring \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DATABASE_PATH=/app/data/wiring.sqlite \
  -e EWD_DATA_DIR=/app/data/ewd \
  -e CLIENT_DIST=/app/client/dist \
  -e MANUAL_DIR=/data/manual \
  -v /opt/ewd-app/data:/app/data \
  -v /opt/manual:/data/manual:ro \
  --restart unless-stopped \
  volvo-xc70-wiring-app

echo "=== 3. Устанавливаем pip и pdfplumber ==="
docker exec -it volvo-xc70-wiring apt-get update
docker exec -it volvo-xc70-wiring apt-get install -y python3-pip
docker exec -it volvo-xc70-wiring pip3 install pdfplumber --break-system-packages

echo "=== 4. Запускаем импорт схем ==="
docker exec -it volvo-xc70-wiring python3 scripts/full_reimport.py

echo "=== ГОТОВО! ==="