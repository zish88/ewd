#!/bin/bash
set -euo pipefail
APP=/opt/ewd-app
SRC=/opt/ewd-app/tmp_parts_upload
cd "$APP"

# Install artifacts into app tree
rm -rf client/dist
if [ -d "$SRC/client/dist" ]; then
  cp -a "$SRC/client/dist" client/dist
elif [ -d "$SRC/dist" ]; then
  cp -a "$SRC/dist" client/dist
else
  echo "missing dist"; exit 1
fi
cp -f "$SRC/server/partsDb.ts" server/partsDb.ts 2>/dev/null || cp -f "$SRC/partsDb.ts" server/partsDb.ts
mkdir -p server/routes
cp -f "$SRC/server/routes/partsCatalog.ts" server/routes/partsCatalog.ts 2>/dev/null || cp -f "$SRC/partsCatalog.ts" server/routes/partsCatalog.ts
cp -f "$SRC/_vps_hot_parts_slice02.sh" scripts/_vps_hot_parts_slice02.sh
cp -f "$SRC/.dockerignore" .dockerignore
sed -i 's/\r$//' scripts/_vps_hot_parts_slice02.sh .dockerignore

# Drop failed pull leftovers
docker builder prune -af >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true
df -h / | tail -1

bash scripts/_vps_hot_parts_slice02.sh
rm -rf "$SRC"
