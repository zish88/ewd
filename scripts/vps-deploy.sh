#!/bin/bash
# Type on hosting console:
#   cd /opt/ewd-app
#   git pull
#   bash deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ewd-app}"
IMAGE="${IMAGE:-ewd-app:latest}"
NAME="${NAME:-volvo-xc70-wiring}"
PORT="${PORT:-3000}"
# Set BUILD=1 to force docker build --no-cache
BUILD="${BUILD:-0}"

echo "==> APP_DIR=$APP_DIR"
cd "$APP_DIR"

# Load host secrets for docker -e (SMTP, admin). Do not commit .env.
if [ -f "${APP_DIR}/.env" ]; then
  echo "==> loading ${APP_DIR}/.env"
  set -a
  # shellcheck disable=SC1091
  . "${APP_DIR}/.env"
  set +a
fi

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
rm -f data/dtc.sqlite data/dtc.sqlite-wal data/dtc.sqlite-shm
git checkout HEAD -- data/wiring.sqlite data/dtc.sqlite
ls -la data/wiring.sqlite data/dtc.sqlite

BYTES=$(wc -c < data/wiring.sqlite | tr -d ' ')
if [ "$BYTES" -lt 100000 ]; then
  echo "ERROR: wiring.sqlite too small ($BYTES bytes)"
  exit 1
fi
DTC_BYTES=$(wc -c < data/dtc.sqlite | tr -d ' ')
if [ "$DTC_BYTES" -lt 10000 ]; then
  echo "WARN: dtc.sqlite missing or tiny ($DTC_BYTES bytes) — DTC search may be empty"
fi

COMPONENTS=$(python3 - <<'PY'
import sqlite3
c = sqlite3.connect("data/wiring.sqlite")
print(c.execute("select count(*) from components").fetchone()[0])
PY
)
echo "==> components in sqlite: $COMPONENTS"
if [ "$COMPONENTS" -lt 1 ]; then
  echo "ERROR: sqlite restored but components=0"
  exit 1
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  BUILD=1
fi

if [ "$BUILD" = "1" ]; then
  echo "==> freeing docker disk before build"
  docker system prune -af || true
  echo "==> docker build --no-cache"
  docker build --no-cache -t "$IMAGE" .
else
  echo "==> skip build (image exists). To force: BUILD=1 bash deploy.sh"
fi

mkdir -p "${APP_DIR}/manual" "${APP_DIR}/data/ewd"
echo "==> docker run"
# Prefer --env-file so SMTP_PASS is not mangled by shell expansion; -e overrides paths.
ENV_FILE_ARGS=()
if [ -f "${APP_DIR}/.env" ]; then
  ENV_FILE_ARGS+=(--env-file "${APP_DIR}/.env")
  echo "==> docker --env-file ${APP_DIR}/.env"
fi
docker run -d --name "$NAME" --restart unless-stopped \
  -p "${PORT}:3000" \
  "${ENV_FILE_ARGS[@]}" \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DATABASE_PATH=/app/data/wiring.sqlite \
  -e DTC_DATABASE_PATH=/app/data/dtc.sqlite \
  -e EWD_DATA_DIR=/app/data/ewd \
  -e EWD_SOURCE_DIR=/app/data/ewd/ewd_source/39363002/1/2 \
  -e CLIENT_DIST=/app/client/dist \
  -e MANUAL_DIR=/data/manual \
  -e MODERATOR_EMAIL="${MODERATOR_EMAIL:-elzidevelop@gmail.com}" \
  -v "${APP_DIR}/data:/app/data" \
  -v "${APP_DIR}/manual:/data/manual:ro" \
  "$IMAGE"

sleep 3
echo "==> status"
docker ps --filter "name=$NAME"
echo "==> health"
curl -sS "http://127.0.0.1:${PORT}/api/health" || true
echo
echo "Done. Open http://SERVER:${PORT}"
