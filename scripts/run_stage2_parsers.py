"""
Stage 2 runner: read book_manifest.json → isolated parsers → JSON datasets.
Does not write SQLite.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from parsers.connector_parser import parse_connector_pages
from parsers.diagram_parser import parse_diagram_pages

MANUALS_DIR = os.environ.get("MANUAL_DIR", r"E:\manual")
MANIFEST_PATH = os.path.join("data", "book_manifest.json")
OUT_DIR = os.path.join("data", "stage2")


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=MANIFEST_PATH)
    parser.add_argument("--manual-dir", default=MANUALS_DIR)
    parser.add_argument("--out-dir", default=OUT_DIR)
    args = parser.parse_args()

    if not os.path.isfile(args.manifest):
        print(f"ERROR: missing {args.manifest}", file=sys.stderr)
        return 1

    with open(args.manifest, encoding="utf-8") as f:
        manifest = json.load(f)

    os.makedirs(args.out_dir, exist_ok=True)

    print("Stage 2: connector_parser …")
    connectors = parse_connector_pages(manifest, args.manual_dir)
    conn_path = os.path.join(args.out_dir, "connector_circuits.json")
    with open(conn_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "count": len(connectors),
                "circuits": connectors,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"  wrote {conn_path} ({len(connectors)} circuits)")

    print("Stage 2: diagram_parser …")
    diagrams = parse_diagram_pages(manifest, args.manual_dir)
    diag_path = os.path.join(args.out_dir, "diagram_records.json")
    with open(diag_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "count": len(diagrams),
                "records": diagrams,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"  wrote {diag_path} ({len(diagrams)} records)")
    print("Stage 2 complete. No SQLite writes.")
    return 0


if __name__ == "__main__":
    # Ensure scripts/ is on path for `parsers` package
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    raise SystemExit(main())
