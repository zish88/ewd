#!/bin/bash
# Restore SQLite + start existing image with EWD/PDF mounts (no rebuild).
set -euo pipefail
cd /opt/ewd-app
if [ -f /opt/ewd-app/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /opt/ewd-app/.env
  set +a
fi
docker rm -f volvo-xc70-wiring 2>/dev/null || true
rm -f data/wiring.sqlite data/wiring.sqlite-wal data/wiring.sqlite-shm
rm -f data/dtc.sqlite data/dtc.sqlite-wal data/dtc.sqlite-shm
git checkout HEAD -- data/wiring.sqlite data/dtc.sqlite
ls -la data/wiring.sqlite data/dtc.sqlite
python3 -c "import sqlite3;c=sqlite3.connect('data/wiring.sqlite');print('components',c.execute('select count(*) from components').fetchone()[0])"
mkdir -p manual data/ewd
ENV_FILE_ARGS=()
if [ -f /opt/ewd-app/.env ]; then
  ENV_FILE_ARGS+=(--env-file /opt/ewd-app/.env)
fi
docker run -d --name volvo-xc70-wiring --restart unless-stopped \
  -p 3000:3000 \
  "${ENV_FILE_ARGS[@]}" \
  -e NODE_ENV=production -e PORT=3000 \
  -e DATABASE_PATH=/app/data/wiring.sqlite \
  -e DTC_DATABASE_PATH=/app/data/dtc.sqlite \
  -e EWD_DATA_DIR=/app/data/ewd \
  -e EWD_SOURCE_DIR=/app/data/ewd/ewd_source/39363002/1/2 \
  -e CLIENT_DIST=/app/client/dist \
  -e MANUAL_DIR=/data/manual \
  -e MODERATOR_EMAIL="${MODERATOR_EMAIL:-elzidevelop@gmail.com}" \
  -v /opt/ewd-app/data:/app/data \
  -v /opt/ewd-app/manual:/data/manual:ro \
  ewd-app:latest
sleep 2
curl -sS http://127.0.0.1:3000/api/health
echo
