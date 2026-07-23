/**
 * Promote location-section pages by system_name without full ETL.
 * Only upgrades → locations; does not demote existing fuses/diagram.
 */
import Database from "better-sqlite3";

function isLocationsTitle(systemName) {
  const title = String(systemName || "").toLowerCase();
  return /overview\s*locations|обзор\s*размещен|component\s*illustrations|ground\s*connections|узловые\s*соединения|component\s*locations?|locations?\s*of\s*components?|components?\s*location|расположение\s*компонент|карта\s*расположен/.test(
    title,
  );
}

const db = new Database("data/wiring.sqlite");
const rows = db.prepare("SELECT id, system_name, page_type FROM pages").all();
const upd = db.prepare("UPDATE pages SET page_type = 'locations' WHERE id = ?");
let changed = 0;

const tx = db.transaction(() => {
  for (const row of rows) {
    if (row.page_type === "locations") continue;
    if (!isLocationsTitle(row.system_name)) continue;
    upd.run(row.id);
    changed += 1;
  }
});
tx();

const types = db.prepare("SELECT page_type, COUNT(*) c FROM pages GROUP BY page_type").all();
console.log({ changed, types });
db.close();
