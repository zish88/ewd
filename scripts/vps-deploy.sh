#!/usr/bin/env bash
# One-shot VPS deploy without docker-compose (avoids ContainerConfig bug).
# Usage (paste ONE line in hosting console):
#   curl -fsSL https://raw.githubusercontent.com/zish88/ewd/master/scripts/vps-deploy.sh | bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ewd-app}"
IMAGE="${IMAGE:-ewd-app:latest}"
NAME="${NAME:-volvo-xc70-wiring}"
PORT="${PORT:-3000}"

echo "==> APP_DIR=$APP_DIR"
cd "$APP_DIR"

if [ -d .git ]; then
  echo "==> git sync"
  git fetch origin
  git checkout -f master 2>/dev/null || git checkout -f main
  git reset --hard origin/master 2>/dev/null || git reset --hard origin/main
  git checkout HEAD -- data/wiring.sqlite || true
fi

mkdir -p data
if [ ! -f data/wiring.sqlite ] || [ "$(wc -c < data/wiring.sqlite)" -lt 100000 ]; then
  echo "ERROR: data/wiring.sqlite missing or too small. Upload from PC or fix git checkout."
  ls -la data/wiring.sqlite 2>/dev/null || true
  exit 1
fi
ls -la data/wiring.sqlite

echo "==> remove old containers"
docker rm -f "$NAME" 2>/dev/null || true
docker ps -a --format '{{.ID}} {{.Names}}' | awk '/volvo|ewd/ {print $1}' | xargs -r docker rm -f 2>/dev/null || true

echo "==> docker build (may take several minutes)"
docker build -t "$IMAGE" .

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

sleep 2
echo "==> status"
docker ps --filter "name=$NAME"
echo "==> health"
curl -sS "http://127.0.0.1:${PORT}/api/health" || true
echo
echo "Done. Open http://SERVER:${PORT}"

