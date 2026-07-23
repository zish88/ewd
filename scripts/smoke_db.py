import sqlite3

conn = sqlite3.connect("data/wiring.sqlite")
c = conn.cursor()
print("manuals:", c.execute("select count(*) from manuals").fetchone()[0])
print("pages:", c.execute("select count(*) from pages").fetchone()[0])
print("components:", c.execute("select count(*) from components").fetchone()[0])
print("wire_connections:", c.execute("select count(*) from wire_connections").fetchone()[0])
print("page_types:", c.execute("select page_type, count(*) from pages group by page_type").fetchall())
print(
    "sample:",
    c.execute(
        """
        select p.source_page, cf.component_code, ct.component_code, w.wire_color_raw, w.wire_color_ru
        from wire_connections w
        join pages p on p.id = w.page_id
        left join components cf on cf.id = w.from_component_id
        left join components ct on ct.id = w.to_component_id
        limit 5
        """
    ).fetchall(),
)
conn.close()
