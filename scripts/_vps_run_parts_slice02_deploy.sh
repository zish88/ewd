#!/bin/bash
set -euo pipefail
cd /opt/ewd-app
HEAD="$(git rev-parse --short=8 HEAD)"
python3 - <<PY
import json
from pathlib import Path
p = Path("client/public/deploy-notes.json")
d = json.loads(p.read_text(encoding="utf-8"))
d["git"] = "$HEAD"
p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("notes.git=", d["git"])
PY
# best-effort sync string in updating.html
sed -i "s/ce11cc29/${HEAD}/g; s/ba9016cb/${HEAD}/g; s/16db3795/${HEAD}/g" client/public/updating.html || true
sed -i 's/\r$//' scripts/_vps_deploy_parts_slice02.sh
# Skip node stamp path — notes already aligned
bash scripts/_vps_deploy_parts_slice02.sh
