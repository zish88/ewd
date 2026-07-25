#!/bin/bash
# Generate VAPID keys and write them into /opt/ewd-app/.env (no manual copy).
#
# Usage on VPS:
#   cd /opt/ewd-app
#   git pull   # or: git fetch && git reset --hard origin/master
#   bash scripts/setup-vapid.sh
#
# Optional:
#   FORCE=1 bash scripts/setup-vapid.sh          # overwrite existing VAPID_*
#   RESTART=1 bash scripts/setup-vapid.sh        # then bash deploy.sh (no BUILD)
#   BUILD=1 RESTART=1 bash scripts/setup-vapid.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ewd-app}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env}"
FORCE="${FORCE:-0}"
RESTART="${RESTART:-0}"
BUILD="${BUILD:-0}"
SUBJECT_DEFAULT="${VAPID_SUBJECT:-mailto:elzidevelop@gmail.com}"

cd "$APP_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "==> creating $ENV_FILE"
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE" || true
fi

has_vapid() {
  grep -qE '^[[:space:]]*VAPID_PUBLIC_KEY=' "$ENV_FILE" 2>/dev/null \
    && grep -qE '^[[:space:]]*VAPID_PRIVATE_KEY=' "$ENV_FILE" 2>/dev/null
}

if has_vapid && [ "$FORCE" != "1" ]; then
  echo "==> VAPID_* already in $ENV_FILE (skip). To regenerate: FORCE=1 bash scripts/setup-vapid.sh"
  if [ "$RESTART" = "1" ]; then
    echo "==> RESTART=1 → deploy.sh"
    BUILD="$BUILD" bash "${APP_DIR}/deploy.sh"
  fi
  exit 0
fi

echo "==> generating VAPID keys…"
TMP="$(mktemp)"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

gen_ok=0
if command -v npx >/dev/null 2>&1; then
  if npx --yes web-push generate-vapid-keys >"$TMP" 2>/dev/null; then
    gen_ok=1
  fi
fi
if [ "$gen_ok" != "1" ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: need npx or docker to generate keys"
    exit 1
  fi
  echo "==> using docker node:22-alpine (npx missing on host)"
  docker run --rm node:22-alpine npx --yes web-push generate-vapid-keys >"$TMP"
fi

# web-push prints either "Public Key: XXX" or "Public Key:\nXXX"
parse_vapid() {
  local label="$1" file="$2"
  awk -v label="$label" '
    BEGIN { IGNORECASE = 0 }
    {
      line = $0
      sub(/\r$/, "", line)
    }
    index(line, label) == 1 {
      rest = substr(line, length(label) + 1)
      sub(/^[[:space:]]*/, "", rest)
      if (rest != "") { print rest; exit }
      getline line
      sub(/\r$/, "", line)
      sub(/^[[:space:]]*/, "", line)
      if (line != "" && line !~ /^=+$/) { print line; exit }
    }
  ' "$file"
}

PUBLIC_KEY="$(parse_vapid "Public Key:" "$TMP" | tr -d '[:space:]')"
PRIVATE_KEY="$(parse_vapid "Private Key:" "$TMP" | tr -d '[:space:]')"

if [ -z "$PUBLIC_KEY" ] || [ -z "$PRIVATE_KEY" ]; then
  echo "ERROR: failed to parse keys. Raw output:"
  cat "$TMP"
  exit 1
fi

# Preserve existing VAPID_SUBJECT if present
SUBJECT="$SUBJECT_DEFAULT"
if grep -qE '^[[:space:]]*VAPID_SUBJECT=' "$ENV_FILE" 2>/dev/null; then
  SUBJECT="$(grep -E '^[[:space:]]*VAPID_SUBJECT=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '\r')"
fi
# Prefer MODERATOR_EMAIL from .env for subject if still default and email set
if [ "$SUBJECT" = "mailto:elzidevelop@gmail.com" ] && grep -qE '^[[:space:]]*MODERATOR_EMAIL=' "$ENV_FILE" 2>/dev/null; then
  MAIL="$(grep -E '^[[:space:]]*MODERATOR_EMAIL=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'")"
  if [ -n "$MAIL" ]; then
    SUBJECT="mailto:${MAIL}"
  fi
fi

echo "==> writing VAPID_* into $ENV_FILE"
# Drop old VAPID lines, append fresh block
grep -vE '^[[:space:]]*VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=' "$ENV_FILE" >"${TMP}.env" || true
{
  cat "${TMP}.env"
  # ensure trailing newline
  [ -s "${TMP}.env" ] && [ "$(tail -c1 "${TMP}.env" | wc -l)" -eq 0 ] && echo
  echo ""
  echo "# Web Push (auto by scripts/setup-vapid.sh)"
  echo "VAPID_PUBLIC_KEY=${PUBLIC_KEY}"
  echo "VAPID_PRIVATE_KEY=${PRIVATE_KEY}"
  echo "VAPID_SUBJECT=${SUBJECT}"
} >"$ENV_FILE"
rm -f "${TMP}.env"
chmod 600 "$ENV_FILE" || true

echo "==> done"
echo "    VAPID_PUBLIC_KEY=${PUBLIC_KEY:0:16}… (${#PUBLIC_KEY} chars)"
echo "    VAPID_PRIVATE_KEY=${PRIVATE_KEY:0:8}… (${#PRIVATE_KEY} chars)"
echo "    VAPID_SUBJECT=${SUBJECT}"

if [ "$RESTART" = "1" ]; then
  echo "==> RESTART=1 → deploy.sh (BUILD=${BUILD})"
  BUILD="$BUILD" bash "${APP_DIR}/deploy.sh"
  echo "==> check:"
  docker exec volvo-xc70-wiring printenv VAPID_PUBLIC_KEY VAPID_SUBJECT 2>/dev/null || true
  curl -sS "http://127.0.0.1:3000/api/push/vapid-public-key" || true
  echo
else
  echo
  echo "Next: apply env into container:"
  echo "  cd ${APP_DIR} && bash deploy.sh"
  echo "Or in one go next time:"
  echo "  BUILD=1 RESTART=1 bash scripts/setup-vapid.sh"
fi
