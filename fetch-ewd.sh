#!/bin/bash
# Download EWD SVG + PDF bundle from GitHub Release (no PC→VPS upload).
# Type:
#   cd /opt/ewd-app
#   git pull
#   bash fetch-ewd.sh
set -euo pipefail
cd /opt/ewd-app

URL="${EWD_BUNDLE_URL:-https://github.com/zish88/ewd/releases/download/ewd-runtime-v1/ewd-runtime.tar.gz}"
TMP=/tmp/ewd-runtime.tar.gz

echo "==> download $URL"
# free space first
docker system prune -af >/dev/null 2>&1 || true
rm -f "$TMP"
curl -fL --progress-bar -o "$TMP" "$URL"
ls -lh "$TMP"

echo "==> extract into /opt/ewd-app"
mkdir -p data/ewd manual
tar -xzf "$TMP" -C /opt/ewd-app
# expected: /opt/ewd-app/ewd_source and /opt/ewd-app/manual
if [ -d /opt/ewd-app/ewd_source ]; then
  rm -rf data/ewd/ewd_source
  mv /opt/ewd-app/ewd_source data/ewd/ewd_source
fi
if [ -f manual/schemes-xc70.pdf ]; then
  ls -lh manual/schemes-xc70.pdf
fi
ls data/ewd/ewd_source/39363002/1/2 | head
rm -f "$TMP"

echo "==> restart app"
bash fixdb.sh
echo "Done."
