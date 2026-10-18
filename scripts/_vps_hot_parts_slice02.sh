#!/bin/bash
# Hot-patch SLICE-02 into running image (no docker rebuild — tight disk).
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/ewd-app}"
NAME="${NAME:-volvo-xc70-wiring}"
IMAGE="${IMAGE:-ewd-app:latest}"
cd "$APP_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ ! -f data/parts.sqlite ]; then
  echo "ERROR: missing data/parts.sqlite"; exit 1
fi
if [ ! -d data/parts-graphics ]; then
  echo "ERROR: missing data/parts-graphics"; exit 1
fi
if [ ! -d client/dist ] || [ ! -f client/dist/index.html ]; then
  echo "ERROR: missing client/dist — build locally and scp first"; exit 1
fi

# Free leftover ingest from failed pull
docker system prune -f >/dev/null 2>&1 || true
df -h / | tail -1

if ! docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "==> container missing — start from existing image"
elif ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "==> container stopped — will recreate"
  docker rm -f "$NAME" 2>/dev/null || true
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  ADMIN_PASSWORD_TRIMMED="$(printf '%s' "${ADMIN_PASSWORD:-}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  ADMIN_ENV_ARGS=(-e "ADMIN_PASSWORD=${ADMIN_PASSWORD_TRIMMED}")
  if [ -n "${ADMIN_SECRET:-}" ]; then
    ADMIN_ENV_ARGS+=(-e "ADMIN_SECRET=${ADMIN_SECRET}")
  fi
  docker run -d --name "$NAME" --restart unless-stopped \
    -p 3000:3000 \
    --env-file "${APP_DIR}/.env" \
    -e NODE_ENV=production \
    -e PORT=3000 \
    -e DATABASE_PATH=/app/data/wiring.sqlite \
    -e DTC_DATABASE_PATH=/app/data/dtc.sqlite \
    -e EWD_DATA_DIR=/app/data/ewd \
    -e EWD_SOURCE_DIR=/app/data/ewd/ewd_source/39363002/1/2 \
    -e CLIENT_DIST=/app/client/dist \
    -e MANUAL_DIR=/data/manual \
    -e MODERATOR_EMAIL="${MODERATOR_EMAIL:-}" \
    "${ADMIN_ENV_ARGS[@]}" \
    -v "${APP_DIR}/data:/app/data" \
    -v "${APP_DIR}/manual:/data/manual:ro" \
    "$IMAGE"
  sleep 5
fi

echo "==> docker cp client dist + server parts modules"
docker cp "${APP_DIR}/client/dist/." "$NAME:/app/client/dist/"
docker cp "${APP_DIR}/server/partsDb.ts" "$NAME:/app/server/partsDb.ts"
docker cp "${APP_DIR}/server/routes/partsCatalog.ts" "$NAME:/app/server/routes/partsCatalog.ts"
docker restart "$NAME"
sleep 8

curl -sS "http://127.0.0.1:3000/api/parts-catalog/status"; echo
python3 <<'PY'
import json, urllib.request
base="http://127.0.0.1:3000/api/parts-catalog"
st=json.load(urllib.request.urlopen(f"{base}/status"))
assert st.get("available"), st
plates=json.load(urllib.request.urlopen(f"{base}/plates?fg=/5/51/511&model=V70&year=2014"))
ps=plates.get("plates") or []
print("fg511 plates", len(ps))
assert ps
pid=ps[0]["id"]
detail=json.load(urllib.request.urlopen(f"{base}/plate/{pid}?model=V70&year=2014"))
print("plate", pid, "parts", len(detail.get("parts") or []), "gfx", detail.get("graphicUrl"))
assert detail.get("parts") and detail.get("graphicUrl")
blob=urllib.request.urlopen("http://127.0.0.1:3000"+detail["graphicUrl"]).read(80)
print("graphic head", blob[:40])
tree=json.load(urllib.request.urlopen(f"{base}/tree?model=XC70&year=2008&parent=/5/51"))
paths=[n["path"] for n in (tree.get("nodes") or [])]
print("XC70 children", paths)
assert "/5/51/514" not in paths
print("SMOKE OK")
PY
curl -sS -o /dev/null -w 'parts_page=%{http_code}\n' "http://127.0.0.1:3000/parts"
docker ps --filter "name=$NAME" --format '{{.Names}} {{.Status}}'
echo "Done hot parts SLICE-02."
