"""
VIDA 2014D extractor — pull RU component names + connector part numbers
from SQL Server MDF files under MANUAL_DIR into data/*.json for Stage 3.

Requires a running SQL engine (prefers LocalDB MSSQLLocalDB).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[1]
_LOCAL_MANUAL = _REPO_ROOT / "data" / "ewd"
MANUAL_DIR_DEFAULT = os.environ.get("MANUAL_DIR") or (
    str(_LOCAL_MANUAL) if _LOCAL_MANUAL.is_dir() else r"E:\manual"
)
OUT_DIR_DEFAULT = "data"
TMP_DIR_DEFAULT = os.path.join("data", "vida_tmp")

VOLVO_CODE_RE = re.compile(r"\b(\d{1,3})/(\d{1,5})\b")
INTERESTING_TABLE_RE = re.compile(
    r"desc|lang|translat|component|glossary|text|part|connector|harness|symbol|title|name|lexicon|graphic|localiz|word|catalogue",
    re.I,
)
LANG_COL_RE = re.compile(r"^(language|lang|culture|lcid|languageid|langid)$", re.I)
CODE_COL_RE = re.compile(
    r"^(component|comp|code|symbol|noderef|node|object|item).*(code|id|nr|no|number)?$|^(code|symbol)$",
    re.I,
)
DESC_COL_RE = re.compile(
    r"^(description|desc|title|name|text|translation|displayname|label)",
    re.I,
)
PART_COL_RE = re.compile(r"part.*(number|nr|no)|articlenumber|partno|pnr|partnumber", re.I)

DB_IMAGE = "VidaImageRepo"
DB_EPC = "VidaEPC"


def log(msg: str) -> None:
    print(msg, flush=True)


def normalize_component_code(raw: str) -> str:
    m = re.match(r"^(\d+)/(\d+)", str(raw or "").strip(), re.I)
    return f"{m.group(1)}/{m.group(2)}" if m else ""


# Dealer-standard labels for common body/harness connectors (P3 XC70 / V70 / S80)
KNOWN_74_LABELS = {
    "74/301": "Переходной разъем жгута моторного отсека",
    "74/302": "Переходной разъем жгута моторного отсека",
    "74/507": "Разъем левой передней двери (кузов-дверь)",
    "74/508": "Разъем правой передней двери (кузов-дверь)",
    "74/509": "Разъем левой задней двери (кузов-дверь)",
    "74/510": "Разъем правой задней двери (кузов-дверь)",
}


def clean_vida_component_name(code: str, name: str, harness_hint: str = "") -> str:
    """
    Compact dealer-style RU labels for Dropdown.
    Long EPC notes like «Для подсоединения к жгуту…» → short harness connector names.
    """
    code = normalize_component_code(code) or str(code or "").strip()
    name = re.sub(r"\s+", " ", str(name or "").strip()).rstrip(" .;")
    if not name:
        return KNOWN_74_LABELS.get(code, "")

    low = name.lower()
    hint = (harness_hint or "").lower()

    if code in KNOWN_74_LABELS:
        # Prefer known dealer label when EPC text is vague / prose / already-generic
        if (
            len(name) > 45
            or re.search(
                r"для подсоединения|for connection|контактный разъем|промежуточный разъем|"
                r"^connector$|^разъем$|^разъём$",
                low,
            )
            or low in {"контактный разъем", "разъем", "разъём", "connector", "промежуточный разъем"}
        ):
            return KNOWN_74_LABELS[code]

    # Color-only / noise
    if low in {
        "черный", "белый", "серый", "красный", "синий", "зеленый", "зелёный",
        "желтый", "жёлтый", "оранжевый", "коричневый", "бежевый", "прозрачный",
        "+", "-",
    }:
        return ""

    def zone_from_text(blob: str) -> str:
        b = blob.lower()
        if re.search(r"моторн|engine|compartment|капот|двигател", b):
            return "моторного отсека"
        if re.search(r"передн.*лев|left.*front|front.*left|лев.*передн", b):
            return "левой передней двери"
        if re.search(r"передн.*прав|right.*front|front.*right|прав.*передн", b):
            return "правой передней двери"
        if re.search(r"задн.*лев|left.*rear|rear.*left|лев.*задн", b):
            return "левой задней двери"
        if re.search(r"задн.*прав|right.*rear|rear.*right|прав.*задн", b):
            return "правой задней двери"
        if re.search(r"передн.*двер|front\s*door", b):
            return "передней двери"
        if re.search(r"задн.*двер|rear\s*door", b):
            return "задней двери"
        if re.search(r"панел|dashboard|instrument|салон|cabin|торпед", b):
            return "панели / салона"
        if re.search(r"пол|floor|tunnel|туннел", b):
            return "пола / туннеля"
        if re.search(r"багаж|trunk|tailgate", b):
            return "багажника"
        return ""

    if code.startswith("74/"):
        blob = f"{name} {hint}"
        zone = zone_from_text(blob)
        # Passenger / driver door shorthand from EPC
        if re.search(r"двер[ьи].*пассажир|passenger\s*door|front\s*passenger", blob, re.I):
            zone = zone or "правой передней двери"
        if re.search(r"двер[ьи].*водител|driver\s*door", blob, re.I):
            zone = zone or "левой передней двери"
        if re.search(r"rear\s*door|задн.*двер", blob, re.I) and "двер" not in (zone or ""):
            zone = "задней двери"

        if re.search(r"для подсоединения|подключ|жгуту проводов|жгута проводов|for connection to", low):
            if zone and "двер" in zone:
                return f"Разъем {zone} (кузов-дверь)"
            if zone:
                return f"Переходной разъем жгута {zone}"
            return "Переходной разъем жгута"
        if low in {"контактный разъем", "разъем", "connector", "контактный разъём"} or re.fullmatch(
            r"двер[ьи].*", low
        ):
            if zone and "двер" in zone:
                return f"Разъем {zone} (кузов-дверь)"
            if zone:
                return f"Переходной разъем жгута {zone}"
            return "Промежуточный разъем"
        # Still too long / verbose EPC prose
        if len(name) > 55 or name.count(" ") > 8:
            if zone and "двер" in zone:
                return f"Разъем {zone} (кузов-дверь)"
            if zone:
                return f"Переходной разъем жгута {zone}"
            short = re.split(r"[.]", name)[0].strip()
            if 8 <= len(short) <= 55:
                return short
            return "Промежуточный разъем"
        # Short but vague door label
        if zone and "двер" in zone and re.search(r"двер|door|разъем|connector", low):
            return f"Разъем {zone} (кузов-дверь)"

    if code.startswith("3/") and len(name) > 70:
        name = name[:67].rstrip() + "…"

    return name


def find_sqlcmd() -> str | None:
    env = os.environ.get("SQLCMD_PATH")
    if env and os.path.isfile(env):
        return env
    candidates = []
    for root in (
        r"C:\Program Files\Microsoft SQL Server",
        r"C:\Program Files (x86)\Microsoft SQL Server",
        r"C:\Program Files\SqlCmd",
    ):
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            for name in ("SQLCMD.EXE", "sqlcmd.exe"):
                if name in files:
                    candidates.append(os.path.join(dirpath, name))
    which = shutil.which("sqlcmd")
    if which and which not in candidates:
        candidates.append(which)

    def rank(path: str) -> tuple:
        pl = path.lower()
        if "\\sqlcmd\\sqlcmd.exe" in pl.replace("/", "\\"):
            return (0, path)
        if "client sdk" in pl:
            return (1, path)
        # SQL Server 2008-era tools (poor LocalDB support)
        if re.search(r"[\\/]100[\\/]", pl):
            return (9, path)
        return (5, path)

    candidates.sort(key=rank)
    return candidates[0] if candidates else None


def resolve_server() -> str:
    return os.environ.get("VIDA_SQL_SERVER", r"(localdb)\MSSQLLocalDB")


def _find_localdb_exe() -> Path | None:
    localdb = Path(r"C:\Program Files\Microsoft SQL Server\160\Tools\Binn\SqlLocalDB.exe")
    if localdb.is_file():
        return localdb
    for cand in Path(r"C:\Program Files\Microsoft SQL Server").glob(r"*\Tools\Binn\SqlLocalDB.exe"):
        return cand
    return None


def ensure_localdb_started() -> None:
    localdb = _find_localdb_exe()
    if not localdb:
        return
    subprocess.run([str(localdb), "start", "MSSQLLocalDB"], capture_output=True, text=True)


def localdb_named_pipe(instance: str = "MSSQLLocalDB") -> str | None:
    """go-sqlcmd cannot resolve LocalDB host syntax; use the instance pipe instead."""
    localdb = _find_localdb_exe()
    if not localdb:
        return None
    ensure_localdb_started()
    proc = subprocess.run(
        [str(localdb), "info", instance],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    text = (proc.stdout or "") + "\n" + (proc.stderr or "")
    for line in text.splitlines():
        if "pipe" in line.lower() and "localdb" in line.lower():
            val = line.split(":", 1)[1].strip() if ":" in line else line.split()[-1]
            val = val.strip()
            if val.startswith("np:"):
                return val
    m = re.search(r"(np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query)", text)
    return m.group(1) if m else None


def resolve_sqlcmd_server(server: str) -> str:
    env_pipe = os.environ.get("VIDA_SQLCMD_SERVER")
    if env_pipe:
        return env_pipe
    if "(localdb)" in server.lower():
        inst = server.split("\\", 1)[-1] if "\\" in server else "MSSQLLocalDB"
        pipe = localdb_named_pipe(inst)
        if pipe:
            return pipe
    return server


def sqlcmd_run(server: str, sql: str, database: str = "master", timeout: int = 600) -> tuple[int, str, str]:
    # Prefer pyodbc — ODBC Driver 18 resolves (localdb)\MSSQLLocalDB reliably.
    odbc_msg = ""
    try:
        conn = get_odbc_connection(server, database)
        try:
            conn.autocommit = True
            cur = conn.cursor()
            cur.execute(sql)
            rows: list[str] = []
            try:
                fetched = cur.fetchall()
                for row in fetched:
                    rows.append("|".join("" if v is None else str(v) for v in row))
            except Exception:
                pass
            return 0, "\n".join(rows), ""
        finally:
            conn.close()
    except Exception as odbc_err:
        odbc_msg = f"{odbc_err}"

    sqlcmd = find_sqlcmd()
    if not sqlcmd:
        return 1, "", f"pyodbc failed: {odbc_msg}; sqlcmd not found"
    sqlcmd_server = resolve_sqlcmd_server(server)
    cmd = [
        sqlcmd,
        "-S",
        sqlcmd_server,
        "-E",
        "-d",
        database,
        "-b",
        "-I",
        "-W",
        "-h",
        "-1",
        "-s",
        "|",
        "-Q",
        sql,
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        if proc.returncode == 0:
            return proc.returncode, proc.stdout or "", proc.stderr or ""
        return (
            proc.returncode,
            proc.stdout or "",
            (proc.stderr or "") + f"\n[pyodbc fallback was: {odbc_msg}]",
        )
    except Exception as e:
        return 1, "", f"pyodbc: {odbc_msg}; sqlcmd: {e}"


def get_odbc_connection(server: str, database: str = "master"):
    import pyodbc

    drivers = [d for d in pyodbc.drivers() if "SQL Server" in d]
    # Prefer ODBC Driver 17/18, then Native Client
    prefer = sorted(
        drivers,
        key=lambda d: (
            0 if "ODBC Driver 18" in d else 1 if "ODBC Driver 17" in d else 2 if "Native" in d else 3,
            d,
        ),
    )
    if not prefer:
        raise RuntimeError(f"No SQL Server ODBC driver. Found: {pyodbc.drivers()}")
    driver = prefer[0]
    conn_str = (
        f"DRIVER={{{driver}}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        "Trusted_Connection=yes;"
        "TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str, timeout=60)


def copy_if_needed(src: Path, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size == src.stat().st_size:
        log(f"  reuse copy {dest}")
        return dest
    log(f"  copying {src.name} → {dest} ({src.stat().st_size // (1024*1024)} MB)…")
    shutil.copy2(src, dest)
    return dest


def detach_db(server: str, name: str) -> None:
    sql = f"""
IF DB_ID(N'{name}') IS NOT NULL
BEGIN
  ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
  EXEC sp_detach_db N'{name}', 'true';
END
"""
    code, out, err = sqlcmd_run(server, sql)
    if code != 0 and "does not exist" not in (out + err).lower():
        log(f"  detach {name}: {err or out}")


def attach_mdf(server: str, name: str, mdf: Path, ldf: Path | None = None) -> None:
    detach_db(server, name)
    mdf_s = str(mdf.resolve()).replace("'", "''")
    if ldf and ldf.is_file():
        ldf_s = str(ldf.resolve()).replace("'", "''")
        sql = f"""
CREATE DATABASE [{name}] ON
  (FILENAME = N'{mdf_s}'),
  (FILENAME = N'{ldf_s}')
FOR ATTACH;
"""
    else:
        sql = f"""
CREATE DATABASE [{name}] ON
  (FILENAME = N'{mdf_s}')
FOR ATTACH_REBUILD_LOG;
"""
    log(f"  attaching {name}…")
    code, out, err = sqlcmd_run(server, sql, timeout=900)
    if code != 0:
        raise RuntimeError(f"Attach {name} failed ({code}): {err or out}")
    log(f"  attached {name}")


def unzip_epc(zip_path: Path, dest: Path) -> tuple[Path, Path | None]:
    dest.mkdir(parents=True, exist_ok=True)
    mdf = dest / "EPC_Data.mdf"
    ldf = dest / "EPC_Log.ldf"
    if mdf.is_file() and mdf.stat().st_size > 1_000_000:
        log(f"  EPC already extracted at {dest}")
        return mdf, ldf if ldf.is_file() else None
    log(f"  unzipping {zip_path} → {dest}…")
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(dest)
    if not mdf.is_file():
        # search
        found = list(dest.rglob("*.mdf"))
        if not found:
            raise FileNotFoundError("EPC_Data.mdf not found after unzip")
        mdf = found[0]
        ldf_cands = list(dest.rglob("*.ldf"))
        ldf = ldf_cands[0] if ldf_cands else None
    return mdf, ldf if ldf and ldf.is_file() else None


def probe_database(server: str, db_name: str) -> dict[str, Any]:
    conn = get_odbc_connection(server, db_name)
    cur = conn.cursor()
    tables = []
    cur.execute(
        """
        SELECT s.name AS schema_name, t.name AS table_name
        FROM sys.tables t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        ORDER BY s.name, t.name
        """
    )
    for schema, table in cur.fetchall():
        tables.append({"schema": schema, "table": table})

    columns: dict[str, list[dict[str, str]]] = {}
    interesting = []
    for t in tables:
        key = f"{t['schema']}.{t['table']}"
        cur.execute(
            """
            SELECT c.name, ty.name
            FROM sys.columns c
            JOIN sys.types ty ON ty.user_type_id = c.user_type_id
            JOIN sys.tables tb ON tb.object_id = c.object_id
            JOIN sys.schemas s ON s.schema_id = tb.schema_id
            WHERE s.name = ? AND tb.name = ?
            ORDER BY c.column_id
            """,
            t["schema"],
            t["table"],
        )
        cols = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
        columns[key] = cols
        if INTERESTING_TABLE_RE.search(t["table"]) or INTERESTING_TABLE_RE.search(key):
            interesting.append({"table": key, "columns": cols})

    lang_values: dict[str, list[Any]] = {}
    for info in interesting:
        col_names = [c["name"] for c in info["columns"]]
        lang_cols = [c for c in col_names if LANG_COL_RE.match(c)]
        for lc in lang_cols[:2]:
            try:
                cur.execute(
                    f"SELECT DISTINCT TOP 30 [{lc}] FROM [{info['table'].split('.')[0]}].[{info['table'].split('.')[1]}] WHERE [{lc}] IS NOT NULL"
                )
                lang_values[f"{info['table']}.{lc}"] = [r[0] for r in cur.fetchall()]
            except Exception as e:
                lang_values[f"{info['table']}.{lc}"] = [f"ERR:{e}"]

    conn.close()
    return {
        "database": db_name,
        "table_count": len(tables),
        "tables": tables,
        "interesting_tables": interesting,
        "language_samples": lang_values,
    }


def _qtable(schema: str, table: str) -> str:
    return f"[{schema}].[{table}]"


def extract_ru_components(server: str, db_name: str, probe: dict[str, Any]) -> dict[str, str]:
    """Pull RU names from VIDA EPC Lexicon via ComponentDescriptions.

    EPC stores Volvo designation (e.g. 3/74) as DescriptionTypeId=1 and human
    names as type 2/3 on the same CatalogueComponent, language Id 11 = ru-RU.
    ImageRepository has no RU titles (en-GB graphics only).
    """
    conn = get_odbc_connection(server, db_name)
    cur = conn.cursor()
    mapping: dict[str, str] = {}

    # Detect EPC schema
    cur.execute(
        """
        SELECT COUNT(*) FROM sys.tables t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = 'dbo' AND t.name IN ('ComponentDescriptions', 'Lexicon', 'Languages')
        """
    )
    if cur.fetchone()[0] < 3:
        log("  RU extract: not an EPC lexicon DB — falling back to heuristics")
        mapping = _extract_ru_heuristic(server, db_name, probe, conn)
        conn.close()
        return mapping

    log("  RU extract: EPC ComponentDescriptions + Lexicon (ru-RU)…")
    # Prefer type 3 (component text), then type 2 (assembly/note). Skip tiny/color-only later.
    cur.execute(
        """
        SELECT
            LTRIM(RTRIM(code_lex.Description)) AS component_code,
            name_cd.DescriptionTypeId AS name_type,
            LTRIM(RTRIM(name_lex.Description)) AS name_ru
        FROM dbo.ComponentDescriptions AS code_cd
        JOIN dbo.Lexicon AS code_lex
          ON code_lex.DescriptionId = code_cd.DescriptionId
         AND code_lex.fkLanguage IN (15, 16)
        JOIN dbo.ComponentDescriptions AS name_cd
          ON name_cd.fkCatalogueComponent = code_cd.fkCatalogueComponent
         AND name_cd.DescriptionTypeId IN (2, 3)
        JOIN dbo.Lexicon AS name_lex
          ON name_lex.DescriptionId = name_cd.DescriptionId
         AND name_lex.fkLanguage = 11
        WHERE code_cd.DescriptionTypeId = 1
          AND code_lex.Description LIKE N'[0-9]%/[0-9]%'
          AND LEN(code_lex.Description) <= 14
          AND name_lex.Description IS NOT NULL
          AND LTRIM(RTRIM(name_lex.Description)) <> N''
          AND name_lex.Description <> code_lex.Description
        """
    )
    color_like = {
        "черный", "белый", "серый", "красный", "синий", "зеленый", "зелёный",
        "желтый", "жёлтый", "оранжевый", "коричневый", "бежевый", "прозрачный",
        "black", "white", "grey", "gray", "red", "blue", "green", "yellow",
        "+", "-",
    }
    rows = cur.fetchall()
    log(f"  RU extract: {len(rows)} raw lexicon rows")
    scored: dict[str, tuple[int, str]] = {}
    for code_raw, name_type, name_ru in rows:
        code = normalize_component_code(str(code_raw or ""))
        if not code:
            m = VOLVO_CODE_RE.search(str(code_raw or ""))
            if m:
                code = f"{m.group(1)}/{m.group(2)}"
        name = str(name_ru or "").strip()
        if not code or not name or len(name) < 2:
            continue
        if not re.search(r"[А-Яа-яЁё]", name):
            continue
        low = name.lower()
        if low in color_like:
            score = 1
        elif int(name_type or 0) == 3:
            score = 50 + min(len(name), 80)
        else:
            score = 30 + min(len(name), 80)
        prev = scored.get(code)
        if prev is None or score > prev[0]:
            scored[code] = (score, name)
    for code, (_score, name) in scored.items():
        mapping[code] = name

    # Also ingest type-1 rows that are already Cyrillic (rare)
    cur.execute(
        """
        SELECT LTRIM(RTRIM(code_lex.Description)), LTRIM(RTRIM(name_lex.Description))
        FROM dbo.ComponentDescriptions AS code_cd
        JOIN dbo.Lexicon AS code_lex
          ON code_lex.DescriptionId = code_cd.DescriptionId AND code_lex.fkLanguage IN (15, 16)
        JOIN dbo.ComponentDescriptions AS name_cd
          ON name_cd.fkCatalogueComponent = code_cd.fkCatalogueComponent AND name_cd.DescriptionTypeId = 1
         AND name_cd.DescriptionId <> code_cd.DescriptionId
        JOIN dbo.Lexicon AS name_lex
          ON name_lex.DescriptionId = name_cd.DescriptionId AND name_lex.fkLanguage = 11
        WHERE code_cd.DescriptionTypeId = 1
          AND code_lex.Description LIKE N'[0-9]%/[0-9]%'
          AND LEN(code_lex.Description) <= 14
          AND name_lex.Description LIKE N'%[А-Яа-яЁё]%'
        """
    )
    _ingest_code_desc_rows(mapping, cur.fetchall())

    conn.close()
    return mapping


def _extract_ru_heuristic(
    server: str, db_name: str, probe: dict[str, Any], conn=None
) -> dict[str, str]:
    """Legacy column-heuristic scan (ImageRepository / unknown schemas)."""
    own = conn is None
    if own:
        conn = get_odbc_connection(server, db_name)
    cur = conn.cursor()
    mapping: dict[str, str] = {}

    candidates: list[tuple] = []
    for info in probe.get("interesting_tables") or []:
        key = info["table"]
        schema, table = key.split(".", 1)
        cols = [c["name"] for c in info["columns"]]
        code_cols = [c for c in cols if CODE_COL_RE.search(c) or c.lower() in ("fkcomponent", "componentid", "iec")]
        desc_cols = [c for c in cols if DESC_COL_RE.search(c)]
        lang_cols = [c for c in cols if LANG_COL_RE.match(c)]
        if not code_cols:
            code_cols = [c for c in cols if re.search(r"code|symbol|iec", c, re.I)]
        if not desc_cols:
            desc_cols = [c for c in cols if re.search(r"desc|title|name|text", c, re.I)]
        if code_cols and desc_cols:
            candidates.append((schema, table, code_cols[0], desc_cols[0], lang_cols[0] if lang_cols else None))

    if len(candidates) < 3:
        for t in probe.get("tables") or []:
            cur.execute(
                """
                SELECT c.name FROM sys.columns c
                JOIN sys.tables tb ON tb.object_id = c.object_id
                JOIN sys.schemas s ON s.schema_id = tb.schema_id
                WHERE s.name = ? AND tb.name = ?
                """,
                t["schema"],
                t["table"],
            )
            cols = [r[0] for r in cur.fetchall()]
            code_cols = [c for c in cols if re.search(r"code|symbol|iec|component", c, re.I)]
            desc_cols = [c for c in cols if re.search(r"desc|title|name|text|translation", c, re.I)]
            lang_cols = [c for c in cols if LANG_COL_RE.match(c)]
            if code_cols and desc_cols:
                candidates.append((t["schema"], t["table"], code_cols[0], desc_cols[0], lang_cols[0] if lang_cols else None))

    seen = set()
    uniq = []
    for c in candidates:
        k = (c[0], c[1], c[2], c[3])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(c)

    log(f"  RU heuristic: {len(uniq)} candidate tables")
    for schema, table, code_col, desc_col, lang_col in uniq[:80]:
        qt = _qtable(schema, table)
        try:
            if lang_col:
                for lang_filter in (
                    f"CAST([{lang_col}] AS NVARCHAR(50)) IN (N'ru-RU', N'ru', N'RU', N'rus', N'1049')",
                    f"CAST([{lang_col}] AS INT) = 1049",
                    f"LOWER(CAST([{lang_col}] AS NVARCHAR(50))) LIKE N'ru%'",
                ):
                    sql = f"""
                    SELECT TOP 50000 CAST([{code_col}] AS NVARCHAR(200)), CAST([{desc_col}] AS NVARCHAR(500))
                    FROM {qt}
                    WHERE [{code_col}] IS NOT NULL AND [{desc_col}] IS NOT NULL AND ({lang_filter})
                    """
                    try:
                        cur.execute(sql)
                        rows = cur.fetchall()
                        if rows:
                            _ingest_code_desc_rows(mapping, rows)
                            break
                    except Exception:
                        continue
            sql = f"""
            SELECT TOP 50000 CAST([{code_col}] AS NVARCHAR(200)), CAST([{desc_col}] AS NVARCHAR(500))
            FROM {qt}
            WHERE [{code_col}] IS NOT NULL AND [{desc_col}] IS NOT NULL
            """
            cur.execute(sql)
            rows = cur.fetchall()
            cyr = [(a, b) for a, b in rows if b and re.search(r"[А-Яа-яЁё]", str(b))]
            if cyr:
                _ingest_code_desc_rows(mapping, cyr)
        except Exception as e:
            log(f"  skip {qt}: {e}")

    if len(mapping) < 50:
        log("  RU heuristic: wide Cyrillic scan…")
        for info in (probe.get("interesting_tables") or [])[:40]:
            schema, table = info["table"].split(".", 1)
            text_cols = [
                c["name"]
                for c in info["columns"]
                if c["type"] in ("nvarchar", "varchar", "nchar", "char", "ntext", "text")
            ]
            if not text_cols:
                continue
            qt = _qtable(schema, table)
            select_cols = ", ".join(f"CAST([{c}] AS NVARCHAR(400))" for c in text_cols[:6])
            try:
                cur.execute(f"SELECT TOP 20000 {select_cols} FROM {qt}")
                for row in cur.fetchall():
                    cells = [str(x) if x is not None else "" for x in row]
                    joined = " | ".join(cells)
                    codes = VOLVO_CODE_RE.findall(joined)
                    cyr_cells = [c for c in cells if re.search(r"[А-Яа-яЁё]", c)]
                    if not codes or not cyr_cells:
                        continue
                    desc = max(cyr_cells, key=len)
                    for a, b in codes:
                        code = f"{a}/{b}"
                        prev = mapping.get(code, "")
                        if len(desc) > len(prev):
                            mapping[code] = desc.strip()
            except Exception:
                continue

    if own:
        conn.close()
    return mapping


def _ingest_code_desc_rows(mapping: dict[str, str], rows: list) -> None:
    for code_raw, desc_raw in rows:
        code = normalize_component_code(str(code_raw or ""))
        if not code:
            m = VOLVO_CODE_RE.search(str(code_raw or ""))
            if m:
                code = f"{m.group(1)}/{m.group(2)}"
        desc = str(desc_raw or "").strip()
        if not code or not desc or len(desc) < 2:
            continue
        prev = mapping.get(code, "")
        prev_cyr = bool(re.search(r"[А-Яа-яЁё]", prev))
        new_cyr = bool(re.search(r"[А-Яа-яЁё]", desc))
        if new_cyr and not prev_cyr:
            mapping[code] = desc
        elif new_cyr == prev_cyr and len(desc) > len(prev):
            mapping[code] = desc
        elif not prev:
            mapping[code] = desc


def classify_bom_role(name: str) -> str:
    """Heuristic role for connector BOM children (not a typed Volvo BOM role)."""
    t = (name or "").lower()
    if re.search(r"seal|gasket|rubber|grommet|bushing|boot|уплотн|резин", t):
        return "seal"
    if re.search(
        r"terminal|contact pin|pin contact|socket|cavity|контакт|терминал|"
        r"excluded.?article|mm\s*%?\s*2|type\s*[abc]|tin\s*\(",
        t,
    ):
        return "terminal"
    if re.search(r"housing|shell|connector hous|корпус|колодк", t):
        return "housing"
    return "other"


DEVICE_NAME_RE = re.compile(
    r"\b(motor|module|speaker|loudspeaker|tweeter|lamp|sensor|switch|pump|valve|"
    r"antenna|camera|microphone|actuator|relay|resistor|blower|fan|wiper|"
    r"mirror|lock|horn|heater|compressor|generator|alternator|starter|"
    r"amplifier|radio|display|unit|control|climate|ecu|dim|cem|rem|sum)\b",
    re.I,
)
CONNECTORISH_NAME_RE = re.compile(
    r"\b(housing|connector|shell|cavity|terminal|contact|pole|pin|колодк|корпус)\b",
    re.I,
)
_COLOR_ONLY_NAMES = {
    "black",
    "white",
    "grey",
    "gray",
    "blue",
    "green",
    "red",
    "yellow",
    "natural",
    "light",
    "+",
    "-",
}


def _device_name_score(name: str) -> int:
    """Higher = more likely a replaceable device assembly title."""
    n = (name or "").strip()
    if not n or n.lower() in _COLOR_ONLY_NAMES:
        return 0
    if CONNECTORISH_NAME_RE.search(n) and not DEVICE_NAME_RE.search(n):
        return 0
    score = 0
    if DEVICE_NAME_RE.search(n):
        score += 40
    score += min(len(n), 80)
    return score


def extract_epc_device_parts(
    server: str,
    db_name: str,
    housing_by_code: dict[str, dict[str, str]] | None = None,
) -> dict[str, dict[str, str]]:
    """
    Best-effort map wiring code → replaceable device/assembly ItemNumber.

    EPC often lists only connector housings under a designation (6/28, 16/3).
    When a distinct level-0 PN or included_article (non-terminal) exists beyond
    housing/mate, record it as device_part_number. Coverage is intentionally sparse.
    """
    conn = get_odbc_connection(server, db_name)
    cur = conn.cursor()
    out: dict[str, dict[str, str]] = {}
    housing_by_code = housing_by_code or {}

    cur.execute(
        """
        SELECT COUNT(*) FROM sys.tables t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = 'dbo' AND t.name IN ('CatalogueComponents', 'PartItems', 'ComponentDescriptions', 'Lexicon')
        """
    )
    if cur.fetchone()[0] < 4:
        log("  EPC device parts: required tables missing — skip")
        conn.close()
        return out

    log("  EPC device parts: level-0 PNs + included articles in BOM window…")
    cur.execute(
        """
        SELECT
            LTRIM(RTRIM(code_lex.Description)) AS component_code,
            LTRIM(RTRIM(pi.ItemNumber)) AS part_number,
            LTRIM(RTRIM(ISNULL(n.Description, N''))) AS name_en,
            ISNULL(cc.IndentationLevel, 0) AS ind
        FROM dbo.ComponentDescriptions AS code_cd
        JOIN dbo.Lexicon AS code_lex
          ON code_lex.DescriptionId = code_cd.DescriptionId AND code_lex.fkLanguage IN (15, 16)
        JOIN dbo.CatalogueComponents AS cc ON cc.Id = code_cd.fkCatalogueComponent
        JOIN dbo.PartItems AS pi ON pi.Id = cc.fkPartItem
        LEFT JOIN dbo.ComponentDescriptions AS name_cd
          ON name_cd.fkCatalogueComponent = cc.Id AND name_cd.DescriptionTypeId IN (2, 3)
        LEFT JOIN dbo.Lexicon AS n
          ON n.DescriptionId = name_cd.DescriptionId AND n.fkLanguage IN (15, 16)
        WHERE code_cd.DescriptionTypeId = 1
          AND code_lex.Description LIKE N'[0-9]%/[0-9]%'
          AND LEN(code_lex.Description) <= 14
          AND ISNULL(cc.IndentationLevel, 0) = 0
          AND pi.ItemNumber IS NOT NULL
          AND LTRIM(RTRIM(pi.ItemNumber)) <> N''
        """
    )
    level0: dict[str, dict[str, str]] = {}
    for code_raw, part_raw, name_en, _ind in cur.fetchall():
        code = normalize_component_code(str(code_raw or ""))
        if not code:
            m = VOLVO_CODE_RE.search(str(code_raw or ""))
            if m:
                code = f"{m.group(1)}/{m.group(2)}"
        if not code or not re.match(r"^(3|4|6|7|10|16|20|31|54|74)/", code):
            continue
        part = str(part_raw or "").strip()
        if not part or not re.search(r"\d", part):
            continue
        name = str(name_en or "").strip()
        if name.lower() in _COLOR_ONLY_NAMES:
            name = ""
        prev = level0.setdefault(code, {})
        # Keep best name per PN
        key = f"_pn:{part}"
        prev_name = prev.get(key, "")
        if _device_name_score(name) >= _device_name_score(prev_name):
            prev[key] = name[:200]
        # ordered unique PNs
        ordered = prev.setdefault("_ordered", "")
        parts_list = [p for p in ordered.split("|") if p] if ordered else []
        if part not in parts_list:
            parts_list.append(part)
            prev["_ordered"] = "|".join(parts_list)

    # BOM-window included articles (reuse sibling walk)
    cur.execute(
        """
        SELECT DISTINCT
            cc.Id AS comp_id,
            cc.ParentComponentId AS parent_id,
            cc.SequenceId AS seq,
            ISNULL(cc.IndentationLevel, 0) AS ind,
            LTRIM(RTRIM(code_lex.Description)) AS component_code
        FROM dbo.ComponentDescriptions AS code_cd
        JOIN dbo.Lexicon AS code_lex
          ON code_lex.DescriptionId = code_cd.DescriptionId AND code_lex.fkLanguage IN (15, 16)
        JOIN dbo.CatalogueComponents AS cc ON cc.Id = code_cd.fkCatalogueComponent
        WHERE code_cd.DescriptionTypeId = 1
          AND code_lex.Description LIKE N'[0-9]%/[0-9]%'
          AND LEN(code_lex.Description) <= 14
        """
    )
    anchors = cur.fetchall()
    parent_ids = sorted({int(a[1]) for a in anchors if a[1] is not None})
    siblings_by_parent: dict[int, list[tuple]] = {}
    chunk = 400
    for i in range(0, len(parent_ids), chunk):
        batch = parent_ids[i : i + chunk]
        placeholders = ",".join("?" * len(batch))
        cur.execute(
            f"""
            SELECT
                c.ParentComponentId,
                c.Id,
                c.SequenceId,
                ISNULL(c.IndentationLevel, 0) AS ind,
                LTRIM(RTRIM(ISNULL(c.IndentationType, N''))) AS ind_type,
                LTRIM(RTRIM(ISNULL(pi.ItemNumber, N''))) AS part_number,
                LTRIM(RTRIM(ISNULL(n.Description, N''))) AS name_en
            FROM dbo.CatalogueComponents AS c
            LEFT JOIN dbo.PartItems AS pi ON pi.Id = c.fkPartItem
            LEFT JOIN dbo.ComponentDescriptions AS nd
              ON nd.fkCatalogueComponent = c.Id AND nd.DescriptionTypeId IN (2, 3)
            LEFT JOIN dbo.Lexicon AS n
              ON n.DescriptionId = nd.DescriptionId AND n.fkLanguage IN (15, 16)
            WHERE c.ParentComponentId IN ({placeholders})
            ORDER BY c.ParentComponentId, c.SequenceId, c.Id
            """,
            batch,
        )
        for row in cur.fetchall():
            siblings_by_parent.setdefault(int(row[0]), []).append(row)

    included_by_code: dict[str, list[tuple[str, str]]] = {}
    for comp_id, parent_id, seq, ind, code_raw in anchors:
        code = normalize_component_code(str(code_raw or ""))
        if not code:
            m = VOLVO_CODE_RE.search(str(code_raw or ""))
            if m:
                code = f"{m.group(1)}/{m.group(2)}"
        if not code or not re.match(r"^(3|4|6|7|10|16|20|31|54|74)/", code):
            continue
        if parent_id is None:
            continue
        sibs = siblings_by_parent.get(int(parent_id), [])
        collecting = False
        for _pid, sid, sseq, sind, sind_type, part, name_en in sibs:
            if int(sid) == int(comp_id):
                collecting = True
                continue
            if not collecting:
                continue
            if int(sseq) <= int(seq):
                continue
            if int(sind) <= int(ind or 0):
                break
            if "included" not in str(sind_type).lower():
                continue
            part_s = str(part or "").strip()
            name = str(name_en or "").strip()
            if not part_s or not re.search(r"\d", part_s):
                continue
            if name.lower() in _COLOR_ONLY_NAMES:
                continue
            role = classify_bom_role(f"{name} {sind_type}")
            if role in {"terminal", "seal", "housing"}:
                continue
            if _device_name_score(name) < 40:
                continue
            included_by_code.setdefault(code, []).append((part_s, name[:200]))

    for code, rec in level0.items():
        housing_rec = housing_by_code.get(code) or {}
        housing = str(housing_rec.get("part_number") or "").strip()
        mate = str(housing_rec.get("part_number_mate") or "").strip()
        ordered = [p for p in str(rec.get("_ordered") or "").split("|") if p]
        if not housing and ordered:
            housing = ordered[0]
        if not mate and len(ordered) > 1:
            mate = ordered[1]
        exclude = {p for p in (housing, mate) if p}

        candidates: list[tuple[int, str, str]] = []
        for pn in ordered:
            if pn in exclude:
                continue
            name = str(rec.get(f"_pn:{pn}") or housing_rec.get("name_en") or "").strip()
            score = _device_name_score(name) + 25  # level-0 extra PN is strong signal
            if score < 25:
                continue
            candidates.append((score, pn, name))

        for pn, name in included_by_code.get(code, []):
            if pn in exclude:
                continue
            score = _device_name_score(name) + 15
            candidates.append((score, pn, name))

        if not candidates:
            continue
        candidates.sort(key=lambda t: (-t[0], t[1]))
        best_score, best_pn, best_name = candidates[0]
        if best_score < 25:
            continue
        out[code] = {
            "device_part_number": best_pn,
            "name_en": best_name or str(housing_rec.get("name_en") or "")[:200],
        }

    log(f"  EPC device parts: {len(out)} codes with device_part_number")
    conn.close()
    return out


def extract_epc_connector_bom(server: str, db_name: str) -> dict[str, list[dict[str, str]]]:
    """
    Related PN under a coded catalogue row via IndentationLevel siblings.

    In EPC, a Volvo code (type1, IndentationLevel=0) is followed by indented
    articles (terminals / seals, often IndentationType=excluded_article) until
    the next same-or-shallower level row. ParentComponentId children are empty
    for these leaves.
    Returns { "16/3": [ { part_number, role, name_en } ] }.
    """
    conn = get_odbc_connection(server, db_name)
    cur = conn.cursor()
    out: dict[str, list[dict[str, str]]] = {}

    cur.execute(
        """
        SELECT COUNT(*) FROM sys.tables t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = 'dbo' AND t.name IN ('CatalogueComponents', 'PartItems', 'ComponentDescriptions', 'Lexicon')
        """
    )
    if cur.fetchone()[0] < 4:
        log("  EPC BOM: required tables missing — skip")
        conn.close()
        return out

    log("  EPC BOM: indented articles after coded components…")
    # Anchors: coded components with a part number
    cur.execute(
        """
        SELECT DISTINCT
            cc.Id AS comp_id,
            cc.ParentComponentId AS parent_id,
            cc.SequenceId AS seq,
            ISNULL(cc.IndentationLevel, 0) AS ind,
            LTRIM(RTRIM(code_lex.Description)) AS component_code,
            LTRIM(RTRIM(ISNULL(pi.ItemNumber, N''))) AS root_part
        FROM dbo.ComponentDescriptions AS code_cd
        JOIN dbo.Lexicon AS code_lex
          ON code_lex.DescriptionId = code_cd.DescriptionId
         AND code_lex.fkLanguage IN (15, 16)
        JOIN dbo.CatalogueComponents AS cc
          ON cc.Id = code_cd.fkCatalogueComponent
        LEFT JOIN dbo.PartItems AS pi
          ON pi.Id = cc.fkPartItem
        WHERE code_cd.DescriptionTypeId = 1
          AND code_lex.Description LIKE N'[0-9]%/[0-9]%'
          AND LEN(code_lex.Description) <= 14
        """
    )
    anchors = cur.fetchall()
    log(f"  EPC BOM: {len(anchors)} coded anchors")

    # Prefetch sibling rows per parent (SequenceId ordered) — one query, group in Python
    parent_ids = sorted({int(a[1]) for a in anchors if a[1] is not None})
    siblings_by_parent: dict[int, list[tuple]] = {}
    # Chunk parent ids to keep IN-list reasonable
    chunk = 400
    for i in range(0, len(parent_ids), chunk):
        batch = parent_ids[i : i + chunk]
        placeholders = ",".join("?" * len(batch))
        cur.execute(
            f"""
            SELECT
                c.ParentComponentId,
                c.Id,
                c.SequenceId,
                ISNULL(c.IndentationLevel, 0) AS ind,
                LTRIM(RTRIM(ISNULL(c.IndentationType, N''))) AS ind_type,
                LTRIM(RTRIM(ISNULL(pi.ItemNumber, N''))) AS part_number,
                LTRIM(RTRIM(ISNULL(n.Description, N''))) AS name_en
            FROM dbo.CatalogueComponents AS c
            LEFT JOIN dbo.PartItems AS pi ON pi.Id = c.fkPartItem
            LEFT JOIN dbo.ComponentDescriptions AS nd
              ON nd.fkCatalogueComponent = c.Id AND nd.DescriptionTypeId IN (2, 3)
            LEFT JOIN dbo.Lexicon AS n
              ON n.DescriptionId = nd.DescriptionId AND n.fkLanguage IN (15, 16)
            WHERE c.ParentComponentId IN ({placeholders})
            ORDER BY c.ParentComponentId, c.SequenceId, c.Id
            """,
            batch,
        )
        for row in cur.fetchall():
            siblings_by_parent.setdefault(int(row[0]), []).append(row)

    seen: dict[str, set[str]] = {}
    for comp_id, parent_id, seq, ind, code_raw, root_part in anchors:
        code = normalize_component_code(str(code_raw or ""))
        if not code:
            m = VOLVO_CODE_RE.search(str(code_raw or ""))
            if m:
                code = f"{m.group(1)}/{m.group(2)}"
        if not code or not re.match(r"^(3|4|6|7|10|16|20|31|54|74)/", code):
            continue
        if parent_id is None:
            continue
        sibs = siblings_by_parent.get(int(parent_id), [])
        # Walk forward after this SequenceId while deeper indentation
        collecting = False
        for _pid, sid, sseq, sind, sind_type, part, name_en in sibs:
            if int(sid) == int(comp_id):
                collecting = True
                continue
            if not collecting:
                continue
            if int(sseq) <= int(seq):
                continue
            if int(sind) <= int(ind or 0):
                break
            part_s = str(part or "").strip()
            if not part_s or not re.search(r"\d", part_s):
                continue
            root_pn = str(root_part or "").strip()
            if root_pn and part_s == root_pn:
                continue
            name = str(name_en or "").strip()
            # Prefer descriptive name; skip useless EPC fillers
            if name.lower() in {
                "black",
                "white",
                "grey",
                "gray",
                "+",
                "-",
                "tin (sn)",
                "type a",
                "type b",
                "type c",
                "excluded article",
                "excluded_article",
            }:
                name = ""
            keyset = seen.setdefault(code, set())
            if part_s in keyset:
                continue
            keyset.add(part_s)
            role = classify_bom_role(f"{name} {sind_type}")
            if role == "other" and "excluded_article" in str(sind_type).lower():
                role = "terminal"
            out.setdefault(code, []).append(
                {
                    "part_number": part_s,
                    "role": role,
                    "name_en": name[:200],
                }
            )

    for code, items in out.items():
        items.sort(key=lambda r: (r.get("role") or "", r.get("part_number") or ""))

    log(f"  EPC BOM: {len(out)} codes with related parts")
    conn.close()
    return out


def extract_epc_parts(server: str, db_name: str, probe: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Map Volvo wiring codes (e.g. 16/3) to EPC PartItems.ItemNumber.

    Semantics for the whole project: part_number / part_number_mate are catalogue
    numbers of the *connector / mating housing* on that designation — not the
    consumer device (speaker, module, lamp assembly). name_en is the EPC title
    of the catalogue row (often the device name) and must not be read as the PN's
    product type.
    """
    conn = get_odbc_connection(server, db_name)
    cur = conn.cursor()
    out: dict[str, dict[str, str]] = {}

    cur.execute(
        """
        SELECT COUNT(*) FROM sys.tables t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = 'dbo' AND t.name IN ('CatalogueComponents', 'PartItems', 'ComponentDescriptions', 'Lexicon')
        """
    )
    if cur.fetchone()[0] < 4:
        log("  EPC extract: required tables missing — heuristic fallback")
        out = _extract_epc_heuristic(cur, probe)
        conn.close()
        return out

    log("  EPC extract: code (type1) + PartItems.ItemNumber…")
    cur.execute(
        """
        SELECT
            LTRIM(RTRIM(code_lex.Description)) AS component_code,
            LTRIM(RTRIM(pi.ItemNumber)) AS part_number,
            name_cd.DescriptionTypeId AS name_type,
            LTRIM(RTRIM(name_en.Description)) AS name_en
        FROM dbo.ComponentDescriptions AS code_cd
        JOIN dbo.Lexicon AS code_lex
          ON code_lex.DescriptionId = code_cd.DescriptionId
         AND code_lex.fkLanguage IN (15, 16)
        JOIN dbo.CatalogueComponents AS cc
          ON cc.Id = code_cd.fkCatalogueComponent
        JOIN dbo.PartItems AS pi
          ON pi.Id = cc.fkPartItem
        LEFT JOIN dbo.ComponentDescriptions AS name_cd
          ON name_cd.fkCatalogueComponent = cc.Id
         AND name_cd.DescriptionTypeId IN (2, 3)
        LEFT JOIN dbo.Lexicon AS name_en
          ON name_en.DescriptionId = name_cd.DescriptionId
         AND name_en.fkLanguage IN (15, 16)
        WHERE code_cd.DescriptionTypeId = 1
          AND code_lex.Description LIKE N'[0-9]%/[0-9]%'
          AND LEN(code_lex.Description) <= 14
          AND pi.ItemNumber IS NOT NULL
          AND LTRIM(RTRIM(pi.ItemNumber)) <> N''
        """
    )
    rows = cur.fetchall()
    log(f"  EPC extract: {len(rows)} code/part rows")
    for code_raw, part_raw, name_type, name_en in rows:
        code = normalize_component_code(str(code_raw or ""))
        if not code:
            m = VOLVO_CODE_RE.search(str(code_raw or ""))
            if m:
                code = f"{m.group(1)}/{m.group(2)}"
        # Focus on wiring-style designations used in diagrams
        if not code or not re.match(r"^(3|4|6|7|10|16|20|31|54|74)/", code):
            continue
        part = str(part_raw or "").strip()
        if not part or not re.search(r"\d", part):
            continue
        rec = out.setdefault(code, {})
        if "part_number" not in rec:
            rec["part_number"] = part
        elif part != rec.get("part_number") and "part_number_mate" not in rec:
            rec["part_number_mate"] = part
        name = str(name_en or "").strip()
        if name and name.lower() not in {"black", "white", "grey", "gray", "+", "-"}:
            prev = rec.get("name_en", "")
            # Prefer type 3, then longer
            score = (10 if int(name_type or 0) == 3 else 0) + len(name)
            prev_score = (10 if rec.get("_name_type") == 3 else 0) + len(prev)
            if score > prev_score:
                rec["name_en"] = name[:200]
                rec["_name_type"] = int(name_type or 0)

    for rec in out.values():
        rec.pop("_name_type", None)

    if len(out) < 10:
        log("  EPC extract: heuristic fallback (sparse structured result)…")
        extra = _extract_epc_heuristic(cur, probe)
        for k, v in extra.items():
            out.setdefault(k, v)

    conn.close()
    return out


def _extract_epc_heuristic(cur, probe: dict[str, Any]) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    candidates = []
    for info in probe.get("interesting_tables") or []:
        schema, table = info["table"].split(".", 1)
        cols = [c["name"] for c in info["columns"]]
        part_cols = [c for c in cols if PART_COL_RE.search(c) or c.lower() in ("itemnumber",)]
        code_cols = [c for c in cols if re.search(r"code|symbol|connector|component|iec", c, re.I)]
        name_cols = [c for c in cols if re.search(r"name|desc|title", c, re.I)]
        if part_cols and code_cols:
            candidates.append((schema, table, code_cols[0], part_cols[0], name_cols[0] if name_cols else None))

    log(f"  EPC heuristic: {len(candidates)} candidate tables")
    for schema, table, code_col, part_col, name_col in candidates[:60]:
        qt = _qtable(schema, table)
        try:
            if name_col:
                sql = f"""
                SELECT TOP 50000 CAST([{code_col}] AS NVARCHAR(200)), CAST([{part_col}] AS NVARCHAR(80)),
                       CAST([{name_col}] AS NVARCHAR(300))
                FROM {qt}
                WHERE [{part_col}] IS NOT NULL AND [{code_col}] IS NOT NULL
                """
            else:
                sql = f"""
                SELECT TOP 50000 CAST([{code_col}] AS NVARCHAR(200)), CAST([{part_col}] AS NVARCHAR(80)), NULL
                FROM {qt}
                WHERE [{part_col}] IS NOT NULL AND [{code_col}] IS NOT NULL
                """
            cur.execute(sql)
            for code_raw, part_raw, name_raw in cur.fetchall():
                code = normalize_component_code(str(code_raw or ""))
                if not code:
                    m = VOLVO_CODE_RE.search(str(code_raw or ""))
                    if m:
                        code = f"{m.group(1)}/{m.group(2)}"
                if not code or not re.match(r"^(3|74)/", code):
                    continue
                part = str(part_raw or "").strip()
                if not part or not re.search(r"\d", part):
                    continue
                rec = out.setdefault(code, {})
                if "part_number" not in rec:
                    rec["part_number"] = part
                elif part != rec.get("part_number") and "part_number_mate" not in rec:
                    rec["part_number_mate"] = part
                if name_raw and not rec.get("name_en"):
                    rec["name_en"] = str(name_raw).strip()[:200]
        except Exception as e:
            log(f"  skip EPC {qt}: {e}")
    return out


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    log(f"Wrote {path}")


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="Extract VIDA RU names + EPC part numbers")
    ap.add_argument("--manual-dir", default=MANUAL_DIR_DEFAULT)
    ap.add_argument("--out-dir", default=OUT_DIR_DEFAULT)
    ap.add_argument("--tmp-dir", default=TMP_DIR_DEFAULT)
    ap.add_argument("--probe-only", action="store_true")
    ap.add_argument("--skip-copy", action="store_true", help="Attach original MDF paths (risky)")
    ap.add_argument(
        "--clean-only",
        action="store_true",
        help="Re-clean existing vida_components_ru.json (no MDF attach)",
    )
    ap.add_argument(
        "--bom-only",
        action="store_true",
        help="Attach EPC only and write vida_connector_bom.json (uses existing tmp/epc MDF if present)",
    )
    ap.add_argument(
        "--device-parts-only",
        action="store_true",
        help="Attach EPC only and write vida_device_parts.json (uses existing tmp/epc MDF if present)",
    )
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.device_parts_only:
        manual = Path(args.manual_dir)
        tmp = Path(args.tmp_dir)
        epc_zip = manual / "EPC.zip"
        epc_mdf_existing = tmp / "epc" / "EPC_Data.mdf"
        epc_ldf_existing = tmp / "epc" / "EPC_Log.ldf"
        try:
            import pyodbc  # noqa: F401
        except ImportError:
            log("ERROR: pyodbc required — pip install pyodbc")
            return 1
        ensure_localdb_started()
        server = resolve_server()
        log(f"SQL server: {server}")
        code, out, err = sqlcmd_run(server, "SELECT 1")
        if code != 0:
            log(f"ERROR: cannot connect to {server}: {err or out}")
            return 1
        attached: list[str] = []
        try:
            if epc_mdf_existing.is_file():
                epc_mdf = epc_mdf_existing
                epc_ldf = epc_ldf_existing if epc_ldf_existing.is_file() else None
                log(f"Using existing {epc_mdf}")
            else:
                if not epc_zip.is_file():
                    log(f"ERROR: missing {epc_zip}")
                    return 1
                epc_mdf, epc_ldf = unzip_epc(epc_zip, tmp / "epc")
            attach_mdf(server, DB_EPC, epc_mdf, epc_ldf)
            attached.append(DB_EPC)
            parts_path = out_dir / "vida_connector_parts.json"
            housing_by_code: dict[str, dict[str, str]] = {}
            if parts_path.is_file():
                housing_by_code = (
                    json.loads(parts_path.read_text(encoding="utf-8")).get("connectors") or {}
                )
            devices = extract_epc_device_parts(server, DB_EPC, housing_by_code)
            write_json(
                out_dir / "vida_device_parts.json",
                {
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "source": "EPC_Data.mdf CatalogueComponents (extra level-0 / included_article)",
                    "semantics": (
                        "device_part_number is a replaceable device/assembly ItemNumber when EPC "
                        "lists one distinct from connector housing/mate under the wiring code. "
                        "Sparse by design — many designations only have connector PNs."
                    ),
                    "count": len(devices),
                    "devices": dict(sorted(devices.items(), key=lambda kv: kv[0])),
                },
            )
            for sample in ("6/28", "16/3", "3/112", "6/1"):
                log(f"  {sample}: {devices.get(sample, '(none)')}")
            return 0
        finally:
            for name in reversed(attached):
                try:
                    detach_db(server, name)
                    log(f"  detached {name}")
                except Exception as e:
                    log(f"  detach warn {name}: {e}")

    if args.bom_only:
        manual = Path(args.manual_dir)
        tmp = Path(args.tmp_dir)
        epc_zip = manual / "EPC.zip"
        epc_mdf_existing = tmp / "epc" / "EPC_Data.mdf"
        epc_ldf_existing = tmp / "epc" / "EPC_Log.ldf"
        try:
            import pyodbc  # noqa: F401
        except ImportError:
            log("ERROR: pyodbc required — pip install pyodbc")
            return 1
        ensure_localdb_started()
        server = resolve_server()
        log(f"SQL server: {server}")
        code, out, err = sqlcmd_run(server, "SELECT 1")
        if code != 0:
            log(f"ERROR: cannot connect to {server}: {err or out}")
            return 1
        attached: list[str] = []
        try:
            if epc_mdf_existing.is_file():
                epc_mdf = epc_mdf_existing
                epc_ldf = epc_ldf_existing if epc_ldf_existing.is_file() else None
                log(f"Using existing {epc_mdf}")
            else:
                if not epc_zip.is_file():
                    log(f"ERROR: missing {epc_zip}")
                    return 1
                epc_mdf, epc_ldf = unzip_epc(epc_zip, tmp / "epc")
            attach_mdf(server, DB_EPC, epc_mdf, epc_ldf)
            attached.append(DB_EPC)
            bom = extract_epc_connector_bom(server, DB_EPC)
            parts_path = out_dir / "vida_connector_parts.json"
            if parts_path.is_file():
                parts = (json.loads(parts_path.read_text(encoding="utf-8")).get("connectors") or {})
                for code, items in list(bom.items()):
                    housing = (parts.get(code) or {}).get("part_number") or ""
                    mate = (parts.get(code) or {}).get("part_number_mate") or ""
                    filtered = [
                        it
                        for it in items
                        if it.get("part_number") not in {housing, mate} and it.get("part_number")
                    ]
                    if filtered:
                        bom[code] = filtered
                    else:
                        bom.pop(code, None)
            write_json(
                out_dir / "vida_connector_bom.json",
                {
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "source": "EPC_Data.mdf CatalogueComponents children",
                    "count": len(bom),
                    "connectors": dict(sorted(bom.items(), key=lambda kv: kv[0])),
                },
            )
            log(f"  EPC BOM codes: {len(bom)}")
            sample = bom.get("16/3") or bom.get("3/271") or next(iter(bom.values()), [])
            log(f"  sample items: {len(sample) if isinstance(sample, list) else 0}")
            return 0
        finally:
            for name in reversed(attached):
                try:
                    detach_db(server, name)
                    log(f"  detached {name}")
                except Exception as e:
                    log(f"  detach warn {name}: {e}")

    if args.clean_only:
        ru_path = out_dir / "vida_components_ru.json"
        pn_path = out_dir / "vida_connector_parts.json"
        if not ru_path.is_file():
            log(f"ERROR: missing {ru_path}")
            return 1
        payload = json.loads(ru_path.read_text(encoding="utf-8"))
        comps = payload.get("components") or {}
        hints: dict[str, str] = {}
        if pn_path.is_file():
            pn_payload = json.loads(pn_path.read_text(encoding="utf-8"))
            for code, rec in (pn_payload.get("connectors") or {}).items():
                if isinstance(rec, dict):
                    hints[str(code)] = str(rec.get("name_en") or "")
        cleaned: dict[str, str] = {}
        for code, name in comps.items():
            nice = clean_vida_component_name(str(code), str(name), hints.get(str(code), ""))
            if nice:
                cleaned[str(code)] = nice
        payload["components"] = dict(sorted(cleaned.items(), key=lambda kv: kv[0]))
        payload["count"] = len(cleaned)
        payload["cleaned_at"] = datetime.now(timezone.utc).isoformat()
        write_json(ru_path, payload)
        log(f"Cleaned {ru_path}: {len(cleaned)} names")
        for sample in ("74/301", "74/507", "74/508", "3/74"):
            log(f"  {sample}: {cleaned.get(sample, '(missing)')}")
        return 0

    manual = Path(args.manual_dir)
    tmp = Path(args.tmp_dir)
    image_src = manual / "imagerepository_Data.MDF"
    epc_zip = manual / "EPC.zip"

    if not image_src.is_file():
        log(f"ERROR: missing {image_src}")
        return 1
    if not epc_zip.is_file():
        log(f"ERROR: missing {epc_zip}")
        return 1

    try:
        import pyodbc  # noqa: F401
    except ImportError:
        log("ERROR: pyodbc required — pip install pyodbc")
        return 1

    ensure_localdb_started()
    server = resolve_server()
    log(f"SQL server: {server}")
    log(f"sqlcmd: {find_sqlcmd()}")

    # connectivity check
    code, out, err = sqlcmd_run(server, "SELECT 1")
    if code != 0:
        log(f"ERROR: cannot connect to {server}: {err or out}")
        log("Install/start SQL LocalDB or set VIDA_SQL_SERVER.")
        return 1
    log("SQL connectivity OK")

    tmp.mkdir(parents=True, exist_ok=True)
    attached: list[str] = []

    try:
        if args.skip_copy:
            image_mdf = image_src
        else:
            image_mdf = copy_if_needed(image_src, tmp / "imagerepository_Data.MDF")

        epc_mdf, epc_ldf = unzip_epc(epc_zip, tmp / "epc")
        if not args.skip_copy:
            # EPC already in tmp
            pass

        attach_mdf(server, DB_IMAGE, image_mdf, None)
        attached.append(DB_IMAGE)
        attach_mdf(server, DB_EPC, epc_mdf, epc_ldf)
        attached.append(DB_EPC)

        log("Probing ImageRepository…")
        probe_image = probe_database(server, DB_IMAGE)
        # attach full column map for extract
        conn = get_odbc_connection(server, DB_IMAGE)
        cur = conn.cursor()
        columns = {}
        for t in probe_image["tables"]:
            key = f"{t['schema']}.{t['table']}"
            cur.execute(
                """
                SELECT c.name, ty.name FROM sys.columns c
                JOIN sys.types ty ON ty.user_type_id = c.user_type_id
                JOIN sys.tables tb ON tb.object_id = c.object_id
                JOIN sys.schemas s ON s.schema_id = tb.schema_id
                WHERE s.name=? AND tb.name=?
                """,
                t["schema"],
                t["table"],
            )
            columns[key] = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
        conn.close()
        probe_image["columns"] = columns

        log("Probing EPC…")
        probe_epc = probe_database(server, DB_EPC)
        conn = get_odbc_connection(server, DB_EPC)
        cur = conn.cursor()
        columns_e = {}
        for t in probe_epc["tables"]:
            key = f"{t['schema']}.{t['table']}"
            cur.execute(
                """
                SELECT c.name, ty.name FROM sys.columns c
                JOIN sys.types ty ON ty.user_type_id = c.user_type_id
                JOIN sys.tables tb ON tb.object_id = c.object_id
                JOIN sys.schemas s ON s.schema_id = tb.schema_id
                WHERE s.name=? AND tb.name=?
                """,
                t["schema"],
                t["table"],
            )
            columns_e[key] = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
        conn.close()
        probe_epc["columns"] = columns_e

        # Slim probe for disk (drop full columns of every table — keep interesting + table list)
        probe_out = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "server": server,
            "image": {
                "database": DB_IMAGE,
                "table_count": probe_image["table_count"],
                "tables": probe_image["tables"],
                "interesting_tables": probe_image["interesting_tables"],
                "language_samples": probe_image["language_samples"],
            },
            "epc": {
                "database": DB_EPC,
                "table_count": probe_epc["table_count"],
                "tables": probe_epc["tables"],
                "interesting_tables": probe_epc["interesting_tables"],
                "language_samples": probe_epc["language_samples"],
            },
        }
        write_json(out_dir / "vida_schema_probe.json", probe_out)

        if args.probe_only:
            log("Probe-only complete.")
            return 0

        log("Extracting RU component names…")
        # RU names live in EPC Lexicon (ImageRepository titles are en-GB only).
        probe_epc_for_ru = {**probe_epc, "interesting_tables": list(probe_epc.get("interesting_tables") or [])}
        for t in probe_epc["tables"]:
            key = f"{t['schema']}.{t['table']}"
            cols = columns_e.get(key, [])
            if INTERESTING_TABLE_RE.search(t["table"]) or any(
                DESC_COL_RE.search(c["name"]) or CODE_COL_RE.search(c["name"]) for c in cols
            ):
                if not any(i.get("table") == key for i in probe_epc_for_ru["interesting_tables"]):
                    probe_epc_for_ru["interesting_tables"].append({"table": key, "columns": cols})

        ru_map = extract_ru_components(server, DB_EPC, probe_epc_for_ru)
        cleaned_ru: dict[str, str] = {}
        for code, name in ru_map.items():
            nice = clean_vida_component_name(code, name)
            if nice:
                cleaned_ru[code] = nice
        write_json(
            out_dir / "vida_components_ru.json",
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source": "EPC_Data.mdf (ComponentDescriptions/Lexicon ru-RU)",
                "count": len(cleaned_ru),
                "components": dict(sorted(cleaned_ru.items(), key=lambda kv: kv[0])),
            },
        )
        log(f"  RU components: {len(cleaned_ru)} (cleaned from {len(ru_map)})")

        log("Extracting EPC part numbers…")
        probe_epc_full = {**probe_epc, "interesting_tables": []}
        for t in probe_epc["tables"]:
            key = f"{t['schema']}.{t['table']}"
            cols = columns_e.get(key, [])
            if INTERESTING_TABLE_RE.search(t["table"]) or any(PART_COL_RE.search(c["name"]) for c in cols):
                probe_epc_full["interesting_tables"].append({"table": key, "columns": cols})

        parts = extract_epc_parts(server, DB_EPC, probe_epc_full)
        write_json(
            out_dir / "vida_connector_parts.json",
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source": "EPC_Data.mdf",
                "count": len(parts),
                "connectors": dict(sorted(parts.items(), key=lambda kv: kv[0])),
            },
        )
        log(f"  EPC connectors: {len(parts)}")

        log("Extracting EPC connector BOM (children)…")
        bom = extract_epc_connector_bom(server, DB_EPC)
        # Drop child PNs that already appear as housing/mate on the same code
        for code, items in list(bom.items()):
            housing = (parts.get(code) or {}).get("part_number") or ""
            mate = (parts.get(code) or {}).get("part_number_mate") or ""
            filtered = [
                it
                for it in items
                if it.get("part_number") not in {housing, mate}
                and it.get("part_number")
            ]
            if filtered:
                bom[code] = filtered
            else:
                bom.pop(code, None)
        write_json(
            out_dir / "vida_connector_bom.json",
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source": "EPC_Data.mdf CatalogueComponents children",
                "count": len(bom),
                "connectors": dict(sorted(bom.items(), key=lambda kv: kv[0])),
            },
        )
        log(f"  EPC BOM codes: {len(bom)}")

        log("Extracting EPC device/assembly part numbers…")
        devices = extract_epc_device_parts(server, DB_EPC, parts)
        write_json(
            out_dir / "vida_device_parts.json",
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source": "EPC_Data.mdf CatalogueComponents (extra level-0 / included_article)",
                "semantics": (
                    "device_part_number is a replaceable device/assembly ItemNumber when EPC "
                    "lists one distinct from connector housing/mate under the wiring code. "
                    "Sparse by design — many designations only have connector PNs."
                ),
                "count": len(devices),
                "devices": dict(sorted(devices.items(), key=lambda kv: kv[0])),
            },
        )
        log(f"  EPC device parts: {len(devices)}")
        log("VIDA extract complete.")
        return 0
    finally:
        for name in reversed(attached):
            try:
                detach_db(server, name)
                log(f"  detached {name}")
            except Exception as e:
                log(f"  detach warn {name}: {e}")


if __name__ == "__main__":
    raise SystemExit(main())
