#!/bin/bash
# VPS deploy for parts-catalog SLICE-02 (3-pane + BOM + graphics).
# Expects: git already at stamped HEAD, data/parts.sqlite + data/parts-graphics/ present.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/ewd-app}"
IMAGE="${IMAGE:-ewd-app:latest}"
NAME="${NAME:-volvo-xc70-wiring}"
cd "$APP_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

HEAD="$(git rev-parse --short=8 HEAD)"
NOTES_GIT="$(python3 -c 'import json; print(json.load(open("client/public/deploy-notes.json",encoding="utf-8")).get("git",""))' 2>/dev/null || true)"
echo "HEAD=$HEAD notes=$NOTES_GIT"
if [ "$HEAD" != "$NOTES_GIT" ]; then
  echo "==> stamp deploy-notes on VPS (mismatch)"
  node scripts/stamp-updating.mjs
  HEAD="$(git rev-parse --short=8 HEAD)"
  NOTES_GIT="$(python3 -c 'import json; print(json.load(open("client/public/deploy-notes.json",encoding="utf-8")).get("git",""))')"
  echo "after stamp HEAD=$HEAD notes=$NOTES_GIT"
fi

if [ ! -f data/parts.sqlite ]; then
  echo "ERROR: missing data/parts.sqlite"
  exit 1
fi
if [ ! -d data/parts-graphics ]; then
  echo "ERROR: missing data/parts-graphics/"
  exit 1
fi
ls -lah data/parts.sqlite
echo "parts-graphics files: $(find data/parts-graphics -type f | wc -l)"

df -h / | tail -1
FREE_K="$(df -Pk / | awk 'NR==2{print $4}')"
if [ "${FREE_K:-0}" -lt 800000 ]; then
  echo "WARN: free disk < ~800MB — docker build may fail"
fi

docker rm -f "$NAME" 2>/dev/null || true
echo "==> docker build"
docker build -t "$IMAGE" .

ADMIN_PASSWORD_TRIMMED="$(printf '%s' "${ADMIN_PASSWORD:-}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
ENV_FILE_ARGS=(--env-file "${APP_DIR}/.env")
ADMIN_ENV_ARGS=(-e "ADMIN_PASSWORD=${ADMIN_PASSWORD_TRIMMED}")
if [ -n "${ADMIN_SECRET:-}" ]; then
  ADMIN_ENV_ARGS+=(-e "ADMIN_SECRET=${ADMIN_SECRET}")
fi

echo "==> docker run"
docker run -d --name "$NAME" --restart unless-stopped \
  -p 3000:3000 \
  "${ENV_FILE_ARGS[@]}" \
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

sleep 8
echo "==> health"
curl -sS "http://127.0.0.1:3000/api/health" || true
echo
echo "==> parts status"
curl -sS "http://127.0.0.1:3000/api/parts-catalog/status"
echo
python3 <<'PY'
import json, urllib.request
base="http://127.0.0.1:3000/api/parts-catalog"
st=json.load(urllib.request.urlopen(f"{base}/status"))
assert st.get("available"), st
plates=json.load(urllib.request.urlopen(f"{base}/plates?fg=/5/51/511&model=V70&year=2014"))
ps=plates.get("plates") or []
print("fg511 plates", len(ps))
assert ps, "no plates"
pid=ps[0]["id"]
detail=json.load(urllib.request.urlopen(f"{base}/plate/{pid}?model=V70&year=2014"))
print("plate", pid, "parts", len(detail.get("parts") or []), "gfx", detail.get("graphicUrl"))
assert detail.get("parts"), "empty BOM"
assert detail.get("graphicUrl"), "no graphicUrl"
code=urllib.request.urlopen("http://127.0.0.1:3000"+detail["graphicUrl"]).status
print("graphic HTTP", code)
tree=json.load(urllib.request.urlopen(f"{base}/tree?model=XC70&year=2008&parent=/5/51"))
paths=[n["path"] for n in (tree.get("nodes") or [])]
print("XC70 /5/51 children", paths)
assert "/5/51/514" not in paths, "empty FG 514 should be filtered"
print("SMOKE OK")
PY
curl -sS -o /dev/null -w 'parts_page=%{http_code}\n' "http://127.0.0.1:3000/parts"
docker ps --filter "name=$NAME" --format '{{.Names}} {{.Status}}'
echo "Done."
