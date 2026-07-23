import { Router } from "express";
import type Database from "better-sqlite3";
import type { PageType } from "../db/schema.js";
import { localizeEngineeringText } from "../termGlossary.js";
import {
  ZONE_LABELS,
  classifySystemText,
  harnessToZone,
  textBelongsToZone,
  textMatchesZone,
  wireMatchesZone,
  zonesConflict,
  type ZoneId,
} from "../harnessZones.js";
import { componentTypeRu, wireColorRu } from "../volvoStandards.js";

const NAV_SELECT = `
  SELECT
    w.id,
    w.pin_number,
    w.wire_color_raw,
    w.wire_color_ru,
    w.function_text,
    w.from_detail,
    w.to_detail,
    w.from_token,
    w.to_token,
    w.steering_side,
    w.subject_code,
    w.source_kind,
    w.is_verified,
    w.requires_manual_review,
    w.integrity_score,
    w.harness_left,
    w.harness_right,
    w.diagram_source_page,
    w.diagram_page_id,
    w.from_component_id,
    w.to_component_id,
    w.via_component_id,
    p.manual_id AS book_id,
    p.source_page AS pinout_page_number,
    p.system_name,
    p.page_type,
    cf.component_code AS from_code,
    cf.component_type_ru AS from_type_ru,
    cf.description_ru AS from_desc_ru,
    cf.description_en AS from_desc_en,
    ct.component_code AS to_code,
    ct.component_type_ru AS to_type_ru,
    ct.description_ru AS to_desc_ru,
    ct.description_en AS to_desc_en,
    cv.component_code AS via_code,
    cv.component_type_ru AS via_type_ru,
    cv.description_ru AS via_desc_ru,
    cv.description_en AS via_desc_en
  FROM wire_connections w
  JOIN pages p ON p.id = w.page_id
  JOIN manuals m ON m.id = p.manual_id
  LEFT JOIN components cf ON cf.id = w.from_component_id
  LEFT JOIN components ct ON ct.id = w.to_component_id
  LEFT JOIN components cv ON cv.id = w.via_component_id
`;

function normalizePin(v: unknown): string {
  const s = String(v ?? "").trim();
  return s && s !== "—" ? s : "";
}

function normalizeColor(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  return s && s !== "—" ? s : "";
}

function pickDescription(row: any): string {
  return (
    String(row.function_text || "").trim() ||
    String(row.from_desc_ru || row.from_desc_en || "").trim() ||
    String(row.to_desc_ru || row.to_desc_en || "").trim() ||
    ""
  );
}

function calculateDataScore(card: {
  from_node?: string;
  to_node?: string;
  wire_color?: string;
  pin_number?: string;
}): number {
  const fields = [card.from_node, card.to_node, card.wire_color, card.pin_number];
  const filled = fields.filter((v) => v && v !== "—").length;
  return Math.round((100 * filled) / fields.length);
}

const NON_DIAGRAM_TITLE_RE =
  /overview\s+designations|list\s+of\s+components|\babbreviations\b|table\s+of\s+contents|^explanations\b|how\s+to\s+use\s+the\s+wiring|branching\s+points|^structure\s+week\b|vehicles\s+with\s+srs|control\s+modules\s+overview\s+designations|list\s+of\s+fuses|list\s+of\s+relays/i;

function isNonDiagramReferenceTitle(title: string): boolean {
  return NON_DIAGRAM_TITLE_RE.test(String(title || "").trim());
}

function isSpamDiagramTitle(title: string): boolean {
  const t = String(title || "").trim();
  if (!t || t.length < 4) return true;
  if (isNonDiagramReferenceTitle(t)) return true;
  const colorHits = (t.match(/\b(?:LGN|BK|SB|BN|BU|BL|GN|GY|GR|OG|OR|PK|RD|VT|VO|WH|YE|GO|TV|KB|DR|AU)(?:-[A-Z]{2,3})?\b/gi) || [])
    .length;
  if (colorHits >= 2) return true;
  if (/\b[A-Z]?\d+[A-Z]?:\d+[A-Z]?\b/i.test(t) && colorHits >= 1) return true;
  if (/^[\d/\s:A-Za-z-]{1,40}$/.test(t) && colorHits >= 1) return true;
  return false;
}

function formatDiagramButtonTitle(raw: string, page: number, componentCode: string): string {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  t = t.replace(/\s*\(стр\.\s*\d+\)\s*$/i, "").trim();
  if (t && !isSpamDiagramTitle(t)) {
    // Already human title from assemble
    if (/\(стр\.\s*\d+\)/i.test(String(raw || ""))) return String(raw).trim();
    return `${t} (стр. ${page})`;
  }
  if (componentCode) return `Схема: ${componentCode} (стр. ${page})`;
  return `Схема (стр. ${page})`;
}

function dedupeDiagrams(
  rows: Array<{ book_id: number; page_number: number; system_name: string }>,
  componentCode: string,
): Array<{ book_id: number; page_number: number; system_name: string; title: string }> {
  const seen = new Set<string>();
  const out: Array<{ book_id: number; page_number: number; system_name: string; title: string }> = [];
  for (const d of rows) {
    const page = Number(d.page_number) || 0;
    if (page < 1) continue;
    if (isNonDiagramReferenceTitle(d.system_name || "")) continue;
    const key = `${d.book_id}:${page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = formatDiagramButtonTitle(d.system_name, page, componentCode);
    if (isNonDiagramReferenceTitle(title)) continue;
    out.push({
      book_id: d.book_id,
      page_number: page,
      system_name: title,
      title,
    });
  }
  return out;
}

function sanitizeDiagramPageNumber(
  rawPage: number,
  pageMetaBySource: Map<number, { page_type: string; system_name: string }>,
  allowedDiagramPages: Set<number>,
  fallbackPage: number,
): number {
  if (rawPage > 0 && allowedDiagramPages.has(rawPage)) return rawPage;
  if (rawPage > 0) {
    const meta = pageMetaBySource.get(rawPage);
    if (
      meta &&
      meta.page_type === "diagram" &&
      !isNonDiagramReferenceTitle(meta.system_name) &&
      allowedDiagramPages.size === 0
    ) {
      // No CDP list, but page itself looks like a real diagram
      return rawPage;
    }
  }
  if (fallbackPage > 0) return fallbackPage;
  return 0;
}

function rowToNavCard(
  row: any,
  selectedCode: string,
  matchRole: "owner" | "transit",
  partByCode: Map<string, string>,
  pageMetaBySource?: Map<number, { page_type: string; system_name: string }>,
  allowedDiagramPages?: Set<number>,
  fallbackDiagramPage?: number,
) {
  const from_node = row.from_code || "—";
  const to_node = row.to_code || "—";
  const via_node = row.via_code || "—";
  const pin = normalizePin(row.pin_number) || "—";
  const color = normalizeColor(row.wire_color_raw) || "—";
  const colorRu = color !== "—" ? wireColorRu(color) : "—";
  const page_type = (row.page_type || "connector") as PageType;
  const system_name = String(row.system_name || "").trim();
  const subject = String(row.subject_code || "").trim();
  const pinout = Number(row.pinout_page_number) || 0;
  const rawDiagram = Number(row.diagram_source_page) || 0;
  const diagram = sanitizeDiagramPageNumber(
    rawDiagram,
    pageMetaBySource || new Map(),
    allowedDiagramPages || new Set(),
    fallbackDiagramPage || 0,
  );
  const page_number = diagram > 0 ? diagram : pinout;
  const from_detail = localizeEngineeringText(String(row.from_detail || "").trim());
  const to_detail = localizeEngineeringText(String(row.to_detail || "").trim());
  const description = localizeEngineeringText(pickDescription(row));
  const function_text = localizeEngineeringText(String(row.function_text || "").trim() || description);
  const harness_left = String(row.harness_left || "").trim();
  const harness_right = String(row.harness_right || "").trim();
  const sel = selectedCode.trim();
  let card_title = "";
  if (matchRole === "transit" && sel && subject && subject !== sel) {
    card_title = `${sel} · через ${subject}${pin !== "—" ? `, контакт ${pin}` : ""}`;
  } else if (matchRole === "owner" && subject) {
    card_title = `Разъем ${subject}${pin !== "—" ? `, контакт ${pin}` : ""}`;
  }
  const part_number =
    (sel && partByCode.get(sel)) ||
    (subject && partByCode.get(subject)) ||
    (via_node !== "—" && partByCode.get(via_node)) ||
    (from_node !== "—" && partByCode.get(from_node)) ||
    (to_node !== "—" && partByCode.get(to_node)) ||
    "";
  const out = {
    id: row.id,
    book_id: row.book_id,
    pinout_page_number: pinout,
    diagram_page_number: diagram,
    page_number,
    pin_number: pin,
    pins: pin !== "—" ? [pin] : [],
    wire_color: color,
    wire_color_ru: colorRu,
    wire_color_label:
      colorRu && colorRu !== "—" && color !== "—" ? `${colorRu} (${color})` : colorRu,
    color,
    component_code: sel || subject || (from_node !== "—" ? from_node : to_node),
    component_type_ru:
      (sel ? componentTypeRu(sel) : "") ||
      (subject ? componentTypeRu(subject) : "") ||
      row.from_type_ru ||
      row.to_type_ru ||
      "",
    from_node,
    to_node,
    via_node,
    via_code: via_node !== "—" ? via_node : "",
    from_type_ru: row.from_type_ru || (from_node !== "—" ? componentTypeRu(from_node) : "") || "",
    to_type_ru: row.to_type_ru || (to_node !== "—" ? componentTypeRu(to_node) : "") || "",
    via_type_ru: row.via_type_ru || "",
    from_detail,
    to_detail,
    from_token: String(row.from_token || "").trim(),
    to_token: String(row.to_token || "").trim(),
    steering_side: String(row.steering_side || "").toUpperCase(),
    subject_code: subject,
    match_role: matchRole,
    card_title,
    part_number,
    is_verified: Number(row.is_verified) === 1 ? 1 : 0,
    requires_manual_review: Number(row.requires_manual_review) === 1 ? 1 : 0,
    description,
    function_text,
    system_name: localizeEngineeringText(system_name),
    page_type,
    search_target: sel || subject || (from_node !== "—" ? from_node : to_node !== "—" ? to_node : ""),
    integrity_score: Number(row.integrity_score) || 0,
    harness_left,
    harness_right,
    harness_zone_left: harnessToZone(harness_left),
    harness_zone_right: harnessToZone(harness_right),
    score: 0,
  };
  out.score = calculateDataScore(out);
  return out;
}

function componentGroup(code: string): "modules" | "connectors" | "other" {
  if (/^(3|4)\//.test(code)) return "modules";
  if (/^74\//.test(code)) return "connectors";
  return "other";
}

export function createNavRouter(db: Database.Database) {
  const router = Router();

  router.get("/zones", (_req, res) => {
    const rows = db
      .prepare(
        `SELECT IFNULL(w.harness_left,'') AS harness_left,
                IFNULL(w.harness_right,'') AS harness_right,
                IFNULL(p.system_name,'') AS system_name
         FROM wire_connections w
         JOIN pages p ON p.id = w.page_id`,
      )
      .all() as Array<{ harness_left: string; harness_right: string; system_name: string }>;

    const counts = new Map<ZoneId, number>();
    for (const id of Object.keys(ZONE_LABELS) as ZoneId[]) counts.set(id, 0);

    for (const row of rows) {
      const zones = new Set<ZoneId>();
      if (row.harness_left) zones.add(harnessToZone(row.harness_left));
      if (row.harness_right) zones.add(harnessToZone(row.harness_right));
      // Fallback when harness columns are empty (common on older sqlite dumps)
      if (!row.harness_left && !row.harness_right) {
        const fromPage = classifySystemText(row.system_name);
        if (fromPage) zones.add(fromPage);
      }
      for (const z of zones) counts.set(z, (counts.get(z) || 0) + 1);
    }

    const zones = (Object.keys(ZONE_LABELS) as ZoneId[]).map((id) => ({
      id,
      label: ZONE_LABELS[id],
      count: counts.get(id) || 0,
    }));

    res.json({ zones });
  });

  router.get("/components", (req, res) => {
    const zone = String(req.query.zone || "").trim();
    const wireRows = db
      .prepare(
        `SELECT w.from_component_id, w.to_component_id, w.via_component_id,
                IFNULL(w.subject_code,'') AS subject_code,
                IFNULL(w.harness_left,'') AS harness_left,
                IFNULL(w.harness_right,'') AS harness_right,
                IFNULL(p.system_name,'') AS system_name,
                IFNULL(w.from_detail,'') AS from_detail,
                IFNULL(w.to_detail,'') AS to_detail,
                IFNULL(w.function_text,'') AS function_text
         FROM wire_connections w
         JOIN pages p ON p.id = w.page_id`,
      )
      .all() as Array<{
      from_component_id: number | null;
      to_component_id: number | null;
      via_component_id: number | null;
      subject_code: string;
      harness_left: string;
      harness_right: string;
      system_name: string;
      from_detail: string;
      to_detail: string;
      function_text: string;
    }>;

    const idSet = new Set<number>();
    const subjectCodes = new Set<string>();
    for (const w of wireRows) {
      const zoneOk =
        !zone ||
        zone === "all" ||
        wireMatchesZone(w.harness_left, w.harness_right, zone) ||
        // Older DBs: no harness_* → require a positive zone signal from page/details
        ((!w.harness_left && !w.harness_right) &&
          (textBelongsToZone(w.system_name, zone) ||
            textBelongsToZone(`${w.from_detail} ${w.to_detail} ${w.function_text}`, zone)));
      if (!zoneOk) continue;
      for (const id of [w.from_component_id, w.to_component_id, w.via_component_id]) {
        if (id) idSet.add(id);
      }
      if (w.subject_code) subjectCodes.add(w.subject_code);
    }

    const comps = db
      .prepare(
        `SELECT id, component_code, component_type_ru, description_en, description_ru,
                IFNULL(name_ru,'') AS name_ru, IFNULL(part_number,'') AS part_number
         FROM components ORDER BY component_code`,
      )
      .all() as Array<{
      id: number;
      component_code: string;
      component_type_ru: string;
      description_en: string;
      description_ru: string;
      name_ru: string;
      part_number: string;
    }>;

    const byCode = new Map<string, (typeof comps)[0]>();
    for (const c of comps) {
      if (idSet.has(c.id) || subjectCodes.has(c.component_code)) {
        byCode.set(c.component_code, c);
      }
    }

    const groups = {
      modules: [] as Array<{ code: string; label: string; type_ru: string }>,
      connectors: [] as Array<{ code: string; label: string; type_ru: string }>,
      other: [] as Array<{ code: string; label: string; type_ru: string }>,
    };

    for (const c of [...byCode.values()].sort((a, b) =>
      a.component_code.localeCompare(b.component_code, undefined, { numeric: true }),
    )) {
      const desc = localizeEngineeringText(c.name_ru || c.description_ru || c.description_en || "");
      const pn = c.part_number ? ` [${c.part_number}]` : "";
      const label = desc ? `${c.component_code} — ${desc}${pn}` : `${c.component_code}${pn}`;
      const item = { code: c.component_code, label, type_ru: c.component_type_ru || "" };
      groups[componentGroup(c.component_code)].push(item);
    }

    res.json({
      zone: zone || "all",
      groups: [
        { id: "modules", label: "Блоки управления", items: groups.modules },
        { id: "connectors", label: "Промежуточные разъёмы", items: groups.connectors },
        { id: "other", label: "Прочее", items: groups.other },
      ],
    });
  });

  router.get("/wires", (req, res) => {
    const code = String(req.query.code || "").trim();
    const zone = String(req.query.zone || "").trim();
    const systemHint = String(req.query.system || req.query.systemName || "").trim();
    if (!code) {
      res.status(400).json({ error: "code required", results: [], owner_wires: [], transit_wires: [], diagrams: [] });
      return;
    }

    const order = `ORDER BY w.integrity_score DESC, CAST(w.pin_number AS INTEGER) ASC, w.id ASC`;
    const zoneActive = Boolean(zone && zone !== "all");

    /**
     * Owner rows: subject_code match. When zone is set, require harness zone in SQL-adjacent
     * filter (applied after fetch) — joins never expand by code alone into other zones.
     */
    const ownerRows = db
      .prepare(`${NAV_SELECT} WHERE IFNULL(w.subject_code,'') = ? ${order}`)
      .all(code) as any[];

    /**
     * Transit: endpoint mentions code on a *different* subject connector.
     * Component joins are required to resolve codes, but results are always
     * post-filtered by harness zone + page system_name (no cross-zone dump).
     */
    const transitRows = db
      .prepare(
        `${NAV_SELECT}
         WHERE IFNULL(w.subject_code,'') != ?
           AND (
             cf.component_code = ? OR ct.component_code = ? OR cv.component_code = ?
             OR IFNULL(w.from_token,'') = ? OR IFNULL(w.to_token,'') = ?
             OR IFNULL(w.from_token,'') LIKE ? OR IFNULL(w.to_token,'') LIKE ?
             OR IFNULL(w.from_token,'') LIKE ? OR IFNULL(w.to_token,'') LIKE ?
           )
         ${order}`,
      )
      .all(
        code,
        code,
        code,
        code,
        code,
        code,
        `${code}:%`,
        `${code}:%`,
        `${code}C%`,
        `${code}C%`,
      ) as any[];

    const partRows = db
      .prepare(
        `SELECT component_code, IFNULL(part_number,'') AS part_number
         FROM components
         WHERE TRIM(IFNULL(part_number,'')) != ''`,
      )
      .all() as Array<{ component_code: string; part_number: string }>;
    const partByCode = new Map(partRows.map((r) => [r.component_code, r.part_number]));

    let diagrams: Array<{ book_id: number; page_number: number; system_name: string; title: string }> = [];
    try {
      const rawDiagrams = db
        .prepare(
          `SELECT p.manual_id AS book_id, cdp.source_page AS page_number, cdp.system_name
           FROM component_diagram_pages cdp
           JOIN pages p ON p.id = cdp.page_id
           WHERE cdp.component_code = ?
             AND p.page_type = 'diagram'
           ORDER BY cdp.source_page ASC`,
        )
        .all(code) as Array<{ book_id: number; page_number: number; system_name: string }>;
      diagrams = dedupeDiagrams(rawDiagrams, code);
      if (zoneActive) {
        diagrams = diagrams.filter(
          (d) => textMatchesZone(d.system_name, zone) && textMatchesZone(d.title, zone),
        );
      }
      if (systemHint) {
        const hint = systemHint.toLowerCase();
        diagrams = diagrams.filter(
          (d) =>
            String(d.system_name || "").toLowerCase().includes(hint) ||
            String(d.title || "").toLowerCase().includes(hint),
        );
      }
    } catch {
      diagrams = [];
    }

    const allowedDiagramPages = new Set(diagrams.map((d) => d.page_number));
    const fallbackDiagramPage = diagrams[0]?.page_number || 0;
    const pageMetaBySource = new Map<number, { page_type: string; system_name: string }>();
    try {
      const metaRows = db
        .prepare(`SELECT source_page, page_type, system_name FROM pages`)
        .all() as Array<{ source_page: number; page_type: string; system_name: string }>;
      for (const m of metaRows) {
        pageMetaBySource.set(Number(m.source_page), {
          page_type: String(m.page_type || ""),
          system_name: String(m.system_name || ""),
        });
      }
    } catch {
      /* ignore */
    }

    const inZoneContext = (row: {
      harness_left?: string;
      harness_right?: string;
      system_name?: string;
      from_detail?: string;
      to_detail?: string;
      function_text?: string;
    }) => {
      if (!zoneActive && !systemHint) return true;
      if (zoneActive) {
        const harnessOk = wireMatchesZone(row.harness_left, row.harness_right, zone);
        const noHarness =
          !String(row.harness_left || "").trim() && !String(row.harness_right || "").trim();
        const pageOk =
          noHarness &&
          (textBelongsToZone(row.system_name, zone) ||
            textBelongsToZone(
              `${row.from_detail || ""} ${row.to_detail || ""} ${row.function_text || ""}`,
              zone,
            ));
        if (!harnessOk && !pageOk) return false;
        // Drop rows whose endpoint text clearly belongs to a conflicting zone
        // (duplicate connector codes: engine injectors vs bumper PAM).
        const detailBlob = `${row.from_detail || ""} ${row.to_detail || ""} ${row.function_text || ""}`;
        const detailZone = (() => {
          if (/inject|ECM|Engine Control Module|форсун/i.test(detailBlob)) return "engine" as ZoneId;
          if (/parking\s*assistance|парктрон|бампер|bumper|fog\s*lamp|washer/i.test(detailBlob)) {
            return "front_bumper" as ZoneId;
          }
          if (/trunk|tailgate|rear\s*wiper|багаж/i.test(detailBlob)) return "trunk" as ZoneId;
          if (/front\s*door|зеркал|стеклоподъем|door\s*lock|mirror|window\s*lift/i.test(detailBlob)) {
            return "front_doors" as ZoneId;
          }
          return null;
        })();
        const zid = zone as ZoneId;
        if (detailZone && ZONE_LABELS[zid] && detailZone !== zid && zonesConflict(zid, detailZone)) {
          return false;
        }
        if (detailZone && ZONE_LABELS[zid] && detailZone !== zid && zid === "engine" && detailZone !== "engine") {
          return false;
        }
        if (detailZone === "engine" && zid !== "engine" && ZONE_LABELS[zid]) {
          return false;
        }
      }
      if (systemHint) {
        const blob = `${row.system_name || ""} ${row.harness_left || ""} ${row.harness_right || ""}`.toLowerCase();
        if (!blob.includes(systemHint.toLowerCase())) return false;
      }
      return true;
    };

    let owner_wires = ownerRows
      .filter((r) => inZoneContext(r))
      .map((r) =>
        rowToNavCard(r, code, "owner", partByCode, pageMetaBySource, allowedDiagramPages, fallbackDiagramPage),
      );
    let transit_wires = transitRows
      .filter((r) => inZoneContext(r))
      .map((r) =>
        rowToNavCard(r, code, "transit", partByCode, pageMetaBySource, allowedDiagramPages, fallbackDiagramPage),
      );

    const selected_part_number = partByCode.get(code) || "";
    const results = [...owner_wires, ...transit_wires];
    res.json({
      code,
      zone: zone || "all",
      system: systemHint || null,
      count: results.length,
      part_number: selected_part_number,
      diagrams,
      owner_wires,
      transit_wires,
      results,
    });
  });

  return router;
}
