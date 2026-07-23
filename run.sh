#!/bin/bash
set -e

echo "=== 1. Собираем Docker-образ ==="
docker build -t volvo-xc70-wiring-app:latest .

echo "=== 2. Перезапускаем контейнер ==="
docker rm -f volvo-xc70-wiring 2>/dev/null || true

docker run -d \
  --name volvo-xc70-wiring \
  --restart unless-stopped \
  -p 3000:3000 \
  -v /opt/ewd-app/data:/app/data \
  volvo-xc70-wiring-app:latest

echo "=== ГОТОВО! Контейнер успешно запущен на порту 3000 ==="