#!/bin/bash
# Restore SQLite + start existing image with EWD/PDF mounts (no rebuild).
set -euo pipefail
cd /opt/ewd-app
docker rm -f volvo-xc70-wiring 2>/dev/null || true
rm -f data/wiring.sqlite data/wiring.sqlite-wal data/wiring.sqlite-shm
git checkout HEAD -- data/wiring.sqlite
ls -la data/wiring.sqlite
python3 -c "import sqlite3;c=sqlite3.connect('data/wiring.sqlite');print('components',c.execute('select count(*) from components').fetchone()[0])"
mkdir -p manual data/ewd
docker run -d --name volvo-xc70-wiring --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production -e PORT=3000 \
  -e DATABASE_PATH=/app/data/wiring.sqlite \
  -e EWD_DATA_DIR=/app/data/ewd \
  -e EWD_SOURCE_DIR=/app/data/ewd/ewd_source/39363002/1/2 \
  -e CLIENT_DIST=/app/client/dist \
  -e MANUAL_DIR=/data/manual \
  -e ADMIN_PASSWORD="${ADMIN_PASSWORD:-}" \
  -e ADMIN_SECRET="${ADMIN_SECRET:-}" \
  -v /opt/ewd-app/data:/app/data \
  -v /opt/ewd-app/manual:/data/manual:ro \
  ewd-app:latest
sleep 2
curl -sS http://127.0.0.1:3000/api/health
echo
