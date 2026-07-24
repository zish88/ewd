#!/bin/bash
# Nginx reverse proxy + Let's Encrypt for ewd-volvo.ru → localhost:3000
#
# On VPS console:
#   cd /opt/ewd-app
#   git pull
#   sudo bash scripts/setup-domain.sh
#
# Optional env:
#   DOMAIN=ewd-volvo.ru
#   APP_PORT=3000
#   EMAIL=you@example.com   # for Let's Encrypt notices
set -euo pipefail

DOMAIN="${DOMAIN:-ewd-volvo.ru}"
APP_PORT="${APP_PORT:-3000}"
EMAIL="${EMAIL:-}"
SITE_CONF="/etc/nginx/sites-available/${DOMAIN}"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run as root: sudo bash scripts/setup-domain.sh"
  exit 1
fi

echo "==> domain=${DOMAIN} → 127.0.0.1:${APP_PORT}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx

# Open HTTP/HTTPS if ufw is active
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
fi

# Initial HTTP site (certbot will upgrade to HTTPS)
cat > "${SITE_CONF}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
        client_max_body_size 32m;
    }
}
EOF

ln -sf "${SITE_CONF}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx
systemctl reload nginx

echo "==> checking app on :${APP_PORT}"
if ! curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null; then
  echo "WARN: nothing answers on 127.0.0.1:${APP_PORT}"
  echo "      Start the app first: cd /opt/ewd-app && bash deploy.sh"
fi

CERTBOT_ARGS=(-d "${DOMAIN}" -d "www.${DOMAIN}" --nginx --non-interactive --agree-tos --redirect)
if [ -n "${EMAIL}" ]; then
  CERTBOT_ARGS+=(--email "${EMAIL}")
else
  CERTBOT_ARGS+=(--register-unsafely-without-email)
fi

echo "==> certbot (Let's Encrypt)"
if certbot "${CERTBOT_ARGS[@]}"; then
  echo "==> SSL OK"
else
  echo "WARN: certbot failed — HTTP proxy is still active on port 80."
  echo "      Check DNS A records for ${DOMAIN} / www → this server IP,"
  echo "      then re-run: sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
fi

nginx -t
systemctl reload nginx

echo
echo "Done."
echo "  http://${DOMAIN}  (should redirect to https)"
echo "  https://${DOMAIN}"
echo "  https://www.${DOMAIN}"
echo
echo "App must keep running on 127.0.0.1:${APP_PORT} (docker/pm2)."
echo "Do not open the site as :${APP_PORT} in the browser anymore."
