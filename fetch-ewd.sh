#!/bin/bash
# Download multi-part EWD bundle from GitHub Release, join, extract.
# Type:
#   cd /opt/ewd-app
#   git pull
#   bash fetch-ewd.sh
set -euo pipefail
cd /opt/ewd-app

BASE="${EWD_BUNDLE_BASE:-https://github.com/zish88/ewd/releases/download/ewd-runtime-v1}"
# Number of parts (ewd-runtime.tar.gz.00 ..). Override with EWD_PARTS=N if needed.
PARTS="${EWD_PARTS:-15}"
TMPDIR=/tmp/ewd-parts
OUT=/tmp/ewd-runtime.tar.gz

echo "==> free docker junk"
docker system prune -af >/dev/null 2>&1 || true
rm -rf "$TMPDIR"
mkdir -p "$TMPDIR"
rm -f "$OUT"

echo "==> download $PARTS parts from $BASE"
i=0
while [ "$i" -lt "$PARTS" ]; do
  part=$(printf '%02d' "$i")
  url="$BASE/ewd-runtime.tar.gz.$part"
  dest="$TMPDIR/ewd-runtime.tar.gz.$part"
  echo "  part $part"
  curl -fL --retry 3 --retry-delay 2 -o "$dest" "$url"
  i=$((i + 1))
done

echo "==> join"
cat "$TMPDIR"/ewd-runtime.tar.gz.* > "$OUT"
ls -lh "$OUT"
rm -rf "$TMPDIR"

echo "==> extract"
mkdir -p data/ewd manual
tar -xzf "$OUT" -C /opt/ewd-app
rm -f "$OUT"

if [ -d /opt/ewd-app/ewd_source ]; then
  rm -rf data/ewd/ewd_source
  mv /opt/ewd-app/ewd_source data/ewd/ewd_source
fi
ls data/ewd/ewd_source/39363002/1/2 | head
ls -lh manual/schemes-xc70.pdf 2>/dev/null || true

echo "==> restart"
bash fixdb.sh
echo "Done."
