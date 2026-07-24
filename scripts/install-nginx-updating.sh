#!/bin/bash
# One-time on VPS: wire branded /updating.html into nginx for 502/503/504.
# Run as root from anywhere:
#   bash /opt/ewd-app/scripts/install-nginx-updating.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ewd-app}"
SNIPPET="/etc/nginx/snippets/ewd-updating.conf"
HTML="${APP_DIR}/client/public/updating.html"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: запускайте от root (в консоли хостинга обычно уже root)."
  exit 1
fi

if [ ! -f "$HTML" ]; then
  echo "ERROR: нет файла $HTML"
  echo "Сначала: cd $APP_DIR && git pull (или reset --hard origin/master)"
  exit 1
fi

echo "==> пишем $SNIPPET"
mkdir -p /etc/nginx/snippets
cat > "$SNIPPET" <<'EOF'
proxy_intercept_errors on;
error_page 502 503 504 /updating.html;
location = /updating.html {
    root /opt/ewd-app/client/public;
    default_type text/html;
    charset utf-8;
    add_header Cache-Control "no-store";
}
EOF

echo "==> ищем nginx-конфиг с proxy_pass :3000"
mapfile -t CONFS < <(grep -rlE 'proxy_pass[[:space:]]+http://(127\.0\.0\.1|localhost):3000' \
  /etc/nginx/sites-enabled /etc/nginx/sites-available /etc/nginx/conf.d 2>/dev/null || true)

if [ "${#CONFS[@]}" -eq 0 ]; then
  echo "ERROR: не найден конфиг с proxy_pass на :3000"
  echo "Покажите вывод: grep -rn proxy_pass /etc/nginx --include='*.conf'"
  exit 1
fi

CONF="${CONFS[0]}"
echo "==> конфиг: $CONF"
cp -a "$CONF" "${CONF}.bak.$(date +%Y%m%d%H%M%S)"

if grep -q 'ewd-updating.conf' "$CONF"; then
  echo "==> include уже есть — пропускаю вставку"
else
  echo "==> вставляю include после первого server {"
  # Insert once after the first "server {" line
  awk '
    BEGIN { done=0 }
    !done && /^[[:space:]]*server[[:space:]]*\{/ {
      print
      print "    include /etc/nginx/snippets/ewd-updating.conf;"
      done=1
      next
    }
    { print }
  ' "$CONF" > "${CONF}.tmp"
  mv "${CONF}.tmp" "$CONF"
fi

echo "==> nginx -t"
nginx -t
echo "==> reload nginx"
systemctl reload nginx

echo
echo "OK. Проверка:"
echo "  curl -sI https://ewd-volvo.ru/updating.html | head"
echo "  docker stop volvo-xc70-wiring"
echo "  curl -s https://ewd-volvo.ru/ | head -n 20   # должно быть «сайт на обновлении»"
echo "  docker start volvo-xc70-wiring"
