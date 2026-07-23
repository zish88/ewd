#!/bin/bash
# Restore SQLite + start existing image (no rebuild).
set -euo pipefail
cd /opt/ewd-app
docker rm -f volvo-xc70-wiring 2>/dev/null || true
rm -f data/wiring.sqlite data/wiring.sqlite-wal data/wiring.sqlite-shm
git checkout HEAD -- data/wiring.sqlite
ls -la data/wiring.sqlite
python3 -c "import sqlite3;c=sqlite3.connect('data/wiring.sqlite');print('components',c.execute('select count(*) from components').fetchone()[0])"
docker run -d --name volvo-xc70-wiring --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production -e PORT=3000 \
  -e DATABASE_PATH=/app/data/wiring.sqlite \
  -e EWD_DATA_DIR=/app/data/ewd \
  -e CLIENT_DIST=/app/client/dist \
  -v /opt/ewd-app/data:/app/data \
  ewd-app:latest
sleep 2
curl -sS http://127.0.0.1:3000/api/health
echo
