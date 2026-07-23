#!/usr/bin/env bash
# One-shot VPS deploy without docker-compose (avoids ContainerConfig bug).
# Type on hosting console (3 lines):
#   cd /opt/ewd-app
#   git pull
#   bash deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ewd-app}"
IMAGE="${IMAGE:-ewd-app:latest}"
NAME="${NAME:-volvo-xc70-wiring}"
PORT="${PORT:-3000}"

echo "==> APP_DIR=$APP_DIR"
cd "$APP_DIR"

echo "==> stop old containers first (unlock sqlite)"
docker rm -f "$NAME" 2>/dev/null || true
docker ps -a --format '{{.ID}} {{.Names}}' | awk '/volvo|ewd/ {print $1}' | xargs -r docker rm -f 2>/dev/null || true

if [ -d .git ]; then
  echo "==> git sync"
  git fetch origin
  git checkout -f master 2>/dev/null || git checkout -f main
  git reset --hard origin/master 2>/dev/null || git reset --hard origin/main
fi

echo "==> force-restore SQLite from git"
mkdir -p data
rm -f data/wiring.sqlite data/wiring.sqlite-wal data/wiring.sqlite-shm
git checkout HEAD -- data/wiring.sqlite
ls -la data/wiring.sqlite

BYTES=$(wc -c < data/wiring.sqlite | tr -d ' ')
if [ "$BYTES" -lt 100000 ]; then
  echo "ERROR: wiring.sqlite too small ($BYTES bytes)"
  exit 1
fi

COMPONENTS=$(python3 - <<'PY'
import sqlite3
c = sqlite3.connect("data/wiring.sqlite")
print(c.execute("select count(*) from components").fetchone()[0])
PY
)
echo "==> components in sqlite: $COMPONENTS"
if [ "$COMPONENTS" -lt 1 ]; then
  echo "ERROR: sqlite restored but components=0. Check git object for data/wiring.sqlite"
  exit 1
fi

echo "==> docker build --no-cache (may take several minutes)"
docker build --no-cache -t "$IMAGE" .

echo "==> docker run"
docker run -d --name "$NAME" --restart unless-stopped \
  -p "${PORT}:3000" \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DATABASE_PATH=/app/data/wiring.sqlite \
  -e EWD_DATA_DIR=/app/data/ewd \
  -e CLIENT_DIST=/app/client/dist \
  -v "${APP_DIR}/data:/app/data" \
  "$IMAGE"

sleep 3
echo "==> status"
docker ps --filter "name=$NAME"
echo "==> health"
curl -sS "http://127.0.0.1:${PORT}/api/health" || true
echo
echo "Done. Open http://SERVER:${PORT}"
