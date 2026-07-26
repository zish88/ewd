"""Resolve dealer EWD package paths.

Prefer in-repo copy under data/ewd/ewd_source, then EWD_SOURCE_DIR.

Packages (from packages.xml):
  1/2 — main P3 Capital tree (default)
  4/5 — VEA / Drive-E add-on (B4204TX / D4204TX)

Env:
  EWD_SOURCE_DIR — ewd_source root or package root or data dir
  EWD_PACKAGE_FOLDER — e.g. \"4/5\" or \"4\\\\5\" to select data dir (default 1/2)
"""
from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_LOCAL_EWD_ROOT = _REPO_ROOT / "data" / "ewd" / "ewd_source"


def default_ewd_root() -> Path:
    env = os.environ.get("EWD_SOURCE_DIR")
    if env:
        return Path(env)
    if (_LOCAL_EWD_ROOT / "39363002" / "config.xml").is_file() or (
        _LOCAL_EWD_ROOT / "39363002" / "1" / "2"
    ).is_dir():
        return _LOCAL_EWD_ROOT
    return _LOCAL_EWD_ROOT


DEFAULT_EWD_ROOT = default_ewd_root()


def _normalize_folder(raw: str | None) -> str:
    s = str(raw or "").strip().replace("\\", "/")
    s = re.sub(r"/+", "/", s).strip("/")
    return s


def find_package_root(ewd_root: Path | None = None) -> Path:
    """
    Locate package dir that contains config.xml + at least one data folder (1/2 or 4/5).
    Typical layout: ewd_source/39363002/
    """
    root = Path(ewd_root or default_ewd_root())
    if (root / "config.xml").is_file() and (
        (root / "1" / "2").is_dir() or (root / "4" / "5").is_dir()
    ):
        return root
    if root.name in ("2", "1", "5", "4") or (root / "Signals").is_dir():
        for parent in [root, *root.parents]:
            if (parent / "config.xml").is_file() and (
                (parent / "1" / "2").is_dir() or (parent / "4" / "5").is_dir()
            ):
                return parent
    if not root.is_dir():
        raise FileNotFoundError(f"EWD root not found: {root}")

    for child in sorted(root.iterdir()):
        if child.is_dir() and (child / "config.xml").is_file() and (
            (child / "1" / "2").is_dir() or (child / "4" / "5").is_dir()
        ):
            return child

    raise FileNotFoundError(
        f"No EWD package with config.xml + 1/2 or 4/5 under {root}"
    )


def list_package_folders(package_root: Path) -> list[str]:
    """Folder ids from packages.xml (posix), falling back to on-disk 1/2 and 4/5."""
    root = Path(package_root)
    pkgs = root / "packages.xml"
    found: list[str] = []
    if pkgs.is_file():
        try:
            tree = ET.parse(pkgs)
            for el in tree.getroot().findall("package"):
                folder = _normalize_folder(el.attrib.get("folder") or el.attrib.get("id") or "")
                if folder:
                    found.append(folder)
        except ET.ParseError:
            found = []
    if not found:
        for cand in ("1/2", "4/5"):
            if (root / Path(cand)).is_dir():
                found.append(cand)
    return found


def package_data_dir(package_root: Path, folder: str | None = None) -> Path:
    """
    Resolve a Capital data directory under the package.
    Default folder: EWD_PACKAGE_FOLDER or 1/2.
    """
    root = Path(package_root)
    chosen = _normalize_folder(folder or os.environ.get("EWD_PACKAGE_FOLDER") or "1/2")
    d = root / Path(chosen)
    if not d.is_dir():
        # fall back to first available
        for alt in list_package_folders(root):
            cand = root / Path(alt)
            if cand.is_dir():
                return cand
        raise FileNotFoundError(f"Package data missing: {d}")
    return d


def all_package_data_dirs(package_root: Path | None = None) -> list[Path]:
    root = find_package_root(package_root)
    out: list[Path] = []
    for folder in list_package_folders(root):
        d = root / Path(folder)
        if d.is_dir():
            out.append(d)
    return out
