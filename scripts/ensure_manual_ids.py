"""Ensure EN manuals at ids 1 & 2 (run after EN import, before RU)."""
import os
import sqlite3
import sys

# Avoid Windows console UnicodeEncodeError on emoji
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DB_PATH = os.path.join("data", "wiring.sqlite")
EN_PDF_NAME = "Электросхемы XC70.pdf"


def main():
    if not os.path.exists(DB_PATH):
        print(f"ERROR: {DB_PATH} not found")
        raise SystemExit(1)

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT id, source_path, title, revision, model, year, engines_json FROM manuals")
    manuals = cur.fetchall()
    en = None
    for row in manuals:
        name = os.path.basename(row[1] or "").lower()
        if "rus" not in name and "xc70" in name:
            en = row
            break
    if not en:
        print("ERROR: EN manual not found — import Электросхемы XC70.pdf first")
        raise SystemExit(1)

    en_id = en[0]
    cur.execute("SELECT id, source_path FROM manuals WHERE id = 2")
    existing_2 = cur.fetchone()
    if existing_2:
        name2 = os.path.basename(existing_2[1] or "").lower()
        if "rus" in name2:
            print("ERROR: manual_id=2 is occupied by RU. Wipe DB and re-run bootstrap.")
            raise SystemExit(1)
        print("OK: EN manual_id=2 already exists")
    else:
        alias = f"{en[1].split('#')[0]}#manual_id=2"
        cur.execute(
            """
            INSERT INTO manuals (id, title, revision, source_path, model, year, engines_json)
            VALUES (2, ?, ?, ?, ?, ?, ?)
            """,
            (f"{en[2] or EN_PDF_NAME} (EN #2)", en[3], alias, en[4], en[5], en[6]),
        )
        cur.execute(
            """
            INSERT OR IGNORE INTO pages
            (manual_id, source_page, printed_page, system_name, text, image_path)
            SELECT 2, source_page, printed_page, system_name, text, image_path
            FROM pages WHERE manual_id = ?
            """,
            (en_id,),
        )
        print(f"OK: created EN alias manual_id=2 from {en_id}")

    conn.commit()
    conn.close()
    print("OK: EN ids ready (RU import should become manual_id=3)")


if __name__ == "__main__":
    main()
