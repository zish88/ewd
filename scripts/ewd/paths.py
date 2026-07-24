"""Resolve dealer EWD package paths.

Prefer in-repo copy under data/ewd/ewd_source (mirror of E:\\manual\\ewd_source),
then EWD_SOURCE_DIR / E:\\manual\\ewd_source.
"""
from __future__ import annotations

import os
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_LOCAL_EWD_ROOT = _REPO_ROOT / "data" / "ewd" / "ewd_source"
_LEGACY_EWD_ROOT = Path(r"E:\manual\ewd_source")


def default_ewd_root() -> Path:
    env = os.environ.get("EWD_SOURCE_DIR")
    if env:
        return Path(env)
    if (_LOCAL_EWD_ROOT / "39363002" / "config.xml").is_file() or (
        _LOCAL_EWD_ROOT / "39363002" / "1" / "2"
    ).is_dir():
        return _LOCAL_EWD_ROOT
    if _LEGACY_EWD_ROOT.is_dir():
        return _LEGACY_EWD_ROOT
    return _LOCAL_EWD_ROOT


DEFAULT_EWD_ROOT = default_ewd_root()


def find_package_root(ewd_root: Path | None = None) -> Path:
    """
    Locate package dir that contains config.xml + 1/2 data.
    Typical layout: ewd_source/39363002/1/2/
    """
    root = Path(ewd_root or default_ewd_root())
    # Env may point at …/39363002/1/2 or …/39363002 — normalize to package or source root
    if (root / "config.xml").is_file() and (root / "1" / "2").is_dir():
        return root
    if root.name in ("2", "1") or (root / "Signals").is_dir():
        # data dir or similar — walk up to package
        for parent in [root, *root.parents]:
            if (parent / "config.xml").is_file() and (parent / "1" / "2").is_dir():
                return parent
    if not root.is_dir():
        raise FileNotFoundError(f"EWD root not found: {root}")

    # Nested: ewd_source/<packageId>/
    for child in sorted(root.iterdir()):
        if child.is_dir() and (child / "config.xml").is_file() and (child / "1" / "2").is_dir():
            return child

    raise FileNotFoundError(
        f"No EWD package with config.xml + 1/2 under {root}"
    )


def package_data_dir(package_root: Path) -> Path:
    d = package_root / "1" / "2"
    if not d.is_dir():
        raise FileNotFoundError(f"Package data missing: {d}")
    return d
