"""
CLI: extract dealer EWD indexes (devices, SVG desc linkage, connectivity).

Examples:
  python scripts/ewd_extract.py
  python scripts/ewd_extract.py --connectivity-limit 100
  python scripts/ewd_extract.py --ewd-root data/ewd/ewd_source --step devices
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow `python scripts/ewd_extract.py` without installing package
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ewd.index_devices import run as run_devices  # noqa: E402
from ewd.parse_svg_desc import run as run_svg  # noqa: E402
from ewd.import_connectivity import run as run_connectivity  # noqa: E402
from ewd.build_pin_wire_index import run as run_pin_wire  # noqa: E402
from ewd.parse_faceviews import run as run_faceviews  # noqa: E402
from ewd.parse_locations import run as run_locations  # noqa: E402
from ewd.parse_langdictionary import run as run_lang  # noqa: E402
from ewd.paths import find_package_root, package_data_dir  # noqa: E402


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="Extract EWD device/SVG/connectivity indexes")
    ap.add_argument(
        "--ewd-root",
        default=None,
        help="EWD source root (default: data/ewd/ewd_source, then E:\\manual\\ewd_source)",
    )
    ap.add_argument(
        "--out-dir",
        default=str(Path("data") / "ewd"),
        help="Output directory for JSON indexes",
    )
    ap.add_argument(
        "--step",
        choices=(
            "all",
            "devices",
            "svg",
            "connectivity",
            "pin_wire",
            "faceviews",
            "locations",
            "lang",
            "capital",
        ),
        default="all",
    )
    ap.add_argument(
        "--connectivity-limit",
        type=int,
        default=80,
        help="Max connectivity*.zip files to scan (default 80; use 0 for all)",
    )
    ap.add_argument(
        "--svg-limit",
        type=int,
        default=0,
        help="Max SVG files to parse (0 = all design SVGs)",
    )
    ap.add_argument(
        "--full-parse-limit",
        type=int,
        default=3,
        help="How many connectivity files to fully expand to JSON samples",
    )
    args = ap.parse_args()

    ewd_root = Path(args.ewd_root) if args.ewd_root else None
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    package = find_package_root(ewd_root)
    data = package_data_dir(package)
    print(f"EWD package: {package}")
    print(f"Data dir:    {data}")
    print(f"Out dir:     {out_dir}")

    report: dict = {
        "package": str(package),
        "data_dir": str(data),
        "outputs": {},
    }

    if args.step in ("all", "devices"):
        print("\n=== devices index ===")
        path = run_devices(ewd_root, out_dir / "device_index.json")
        payload = json.loads(path.read_text(encoding="utf-8"))
        print(f"Wrote {path}")
        print(f"  unique_codes={payload['unique_codes']} raw={payload['raw_object_count']}")
        print(f"  design_folders={payload['design_folders_scanned']}")
        for code, sample in (payload.get("samples") or {}).items():
            print(
                f"  sample {code}: objectIds={len(sample['objectIds'])} "
                f"diagramUids={sample['diagramUids'][:2]} kinds={sample['kinds']}"
            )
        report["outputs"]["device_index"] = str(path)

    if args.step in ("all", "svg"):
        print("\n=== SVG desc index ===")
        limit = args.svg_limit or None
        path = run_svg(ewd_root, out_dir / "svg_desc_index.json", limit=limit)
        payload = json.loads(path.read_text(encoding="utf-8"))
        print(f"Wrote {path}")
        print(
            f"  svg_count={payload['svg_count']} "
            f"desc_groups={payload['desc_group_total']}"
        )
        # Show one diagram sample
        for duid, rec in list((payload.get("diagrams") or {}).items())[:1]:
            print(
                f"  sample diagram {duid}: paths={rec['pathCount']} "
                f"codes={rec['textCodes'][:8]} groups={rec['descGroupCount']}"
            )
        report["outputs"]["svg_desc_index"] = str(path)

    if args.step in ("all", "connectivity"):
        print("\n=== connectivity index ===")
        max_files = None if args.connectivity_limit == 0 else args.connectivity_limit
        path = run_connectivity(
            ewd_root,
            out_dir / "connectivity_index.json",
            max_files=max_files,
            full_parse_limit=args.full_parse_limit,
        )
        payload = json.loads(path.read_text(encoding="utf-8"))
        print(f"Wrote {path}")
        print(
            f"  total_files={payload['connectivity_files_total']} "
            f"scanned={payload['connectivity_files_scanned']} "
            f"errors={payload['errors']}"
        )
        for s in (payload.get("fullSamples") or [])[:3]:
            if s.get("error"):
                print(f"  sample ERROR {s.get('source')}: {s['error']}")
            else:
                print(
                    f"  sample {s['source']}: devices={s['deviceCount']} "
                    f"wires={s['wireCount']} pinLinks={s['pinLinkCount']}"
                )
        report["outputs"]["connectivity_index"] = str(path)
        report["outputs"]["connectivity_samples"] = str(out_dir / "connectivity_samples")

    if args.step in ("all", "pin_wire"):
        print("\n=== pin_wire + global_signal indexes ===")
        max_files = None if args.connectivity_limit == 0 else args.connectivity_limit
        pin_path, glob_path = run_pin_wire(
            ewd_root,
            out_dir,
            max_files=max_files,
            global_max=None,
        )
        report["outputs"]["pin_wire_index"] = str(pin_path)
        report["outputs"]["global_signal_index"] = str(glob_path)

    if args.step in ("all", "capital", "faceviews"):
        print("\n=== face_view_index ===")
        path = run_faceviews(ewd_root, out_dir / "face_view_index.json")
        payload = json.loads(path.read_text(encoding="utf-8"))
        print(
            f"Wrote {path} files={payload.get('face_html_files')} "
            f"pins={payload.get('pin_rows')} codes={payload.get('codes_with_faceview')}"
        )
        report["outputs"]["face_view_index"] = str(path)

    if args.step in ("all", "capital", "locations"):
        print("\n=== location_index ===")
        path = run_locations(ewd_root, out_dir / "location_index.json")
        payload = json.loads(path.read_text(encoding="utf-8"))
        print(
            f"Wrote {path} locations={payload.get('location_count')} "
            f"codes={payload.get('unique_codes')}"
        )
        report["outputs"]["location_index"] = str(path)

    if args.step in ("all", "capital", "lang"):
        print("\n=== lang_ru + harness_labels ===")
        lang_path, harness_path = run_lang(ewd_root)
        print(f"Wrote {lang_path}")
        print(f"Wrote {harness_path}")
        report["outputs"]["lang_ru_index"] = str(lang_path)
        report["outputs"]["harness_labels"] = str(harness_path)

    summary_path = out_dir / "extract_report.json"
    summary_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {summary_path}")
    print("EWD extract complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
