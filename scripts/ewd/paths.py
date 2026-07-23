"""Resolve dealer EWD package paths."""
from __future__ import annotations

import os
from pathlib import Path

DEFAULT_EWD_ROOT = Path(os.environ.get("EWD_SOURCE_DIR", r"E:\manual\ewd_source"))


def find_package_root(ewd_root: Path | None = None) -> Path:
    """
    Locate package dir that contains config.xml + 1/2 data.
    Typical layout: ewd_source/39363002/1/2/
    """
    root = Path(ewd_root or DEFAULT_EWD_ROOT)
    if not root.is_dir():
        raise FileNotFoundError(f"EWD root not found: {root}")

    # Direct package (config.xml next to 1/)
    if (root / "config.xml").is_file() and (root / "1" / "2").is_dir():
        return root

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
