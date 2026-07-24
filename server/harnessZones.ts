/** Map Volvo harness header strings / Capital harness IDs → RU zone buckets. */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type ZoneId =
  | "front_doors"
  | "rear_doors"
  | "front_bumper"
  | "rear_bumper"
  | "trunk"
  | "engine"
  | "dashboard"
  | "floor"
  | "roof"
  | "seats"
  | "other";

export const ZONE_LABELS: Record<ZoneId, string> = {
  front_doors: "Передние двери",
  rear_doors: "Задние двери",
  front_bumper: "Передний бампер",
  rear_bumper: "Задний бампер",
  trunk: "Багажник / задняя дверь",
  engine: "Моторный отсек",
  dashboard: "Панель / салон",
  floor: "Пол / туннель",
  roof: "Крыша",
  seats: "Сиденья",
  other: "Прочее",
};

/** Known Capital/CHS harness ids → zone (from Introduction + dominant netlist use). */
export const CAPITAL_HARNESS_ZONE: Record<string, ZoneId> = {
  "14014": "floor",
  "14240_RL": "rear_doors",
  "14240_RR": "rear_doors",
  "14240_FL": "front_doors",
  "14240_FR": "front_doors",
  "14241": "front_doors",
  "14242": "front_doors",
  "14243": "rear_doors",
  "14297": "front_bumper",
  "14301": "engine",
  "14324": "engine",
  "14335": "roof",
  "14401": "dashboard",
  "483_AMB": "dashboard",
  // Frequent unlabeled Capital netlist ids (inferred from subject codes)
  "12A690": "engine",
  "14K733": "engine",
  "14A584": "front_doors",
  "14K138": "front_doors",
  "17N400": "trunk",
  "15K857": "dashboard",
  "15K868": "dashboard",
  "15K867": "dashboard",
  "15A871": "dashboard",
  "14A280": "dashboard",
  "14B079": "dashboard",
  "14B310": "seats",
  "14B245_HV": "engine",
  "10B705": "engine",
  "10K699": "engine",
  "2C054": "engine",
  "2C055": "engine",
  "19A397": "rear_bumper",
  "PDCF_4C": "front_bumper",
  AFBT: "front_bumper",
  CONTROLPANEL: "dashboard",
  "TRAILER-4P": "trunk",
  "ACU Adapter": "dashboard",
};

const ZONE_RULES: Array<{ id: ZoneId; re: RegExp }> = [
  {
    id: "front_bumper",
    re: /\bbumper,?\s*front|front\s*bumper|бампер.*перед|передн\w*\s*бампер|washer\s*nozzle|омывател|parking\s*assistance|forward-?aimed\s*radar|\bFLC\b|\bfront\s*pas\b/i,
  },
  {
    id: "rear_bumper",
    re: /\bbumper,?\s*rear|rear\s*bumper|бампер.*зад|задн\w*\s*бампер|\brear\s*pas\b|park\s*assist(?:ance)?\s*system\s*rear/i,
  },
  {
    id: "trunk",
    re: /\btrunk\s*lid|tailgate|tail\s*gate|cargo|багажн|пята\w*\s*двер|fifth\s*door/i,
  },
  // Allow words between «задней … двери» (Capital RU labels)
  { id: "front_doors", re: /\bfront\s*door|передн\w*.{0,24}двер|двер\w*.{0,16}передн/i },
  { id: "rear_doors", re: /\brear\s*door|задн\w*.{0,24}двер|двер\w*.{0,16}задн/i },
  {
    id: "engine",
    re: /\bengine\s*(compartment\s*)?harness|\bengine\s*compartment\b|моторн\w*\s*отсек|капот|двигател|starter\s*motor|форсун|inject(?:or|ion)?|ECM\b|alternator|generator|аккумулятор|заземляющ\w*\s*кабел/i,
  },
  {
    id: "dashboard",
    re: /\bdashboard|instrument(\s*panel)?|heater\s*harness|\bheater\b|cabin|infotainment(\s*harness)?|center\s*console|climate|салон|панел|торпед|приборн/i,
  },
  {
    id: "floor",
    re: /\bfloor|tunnel|напольн|\bпол\b|туннел|rear\s*axle|axle\s*harness/i,
  },
  { id: "roof", re: /\broof|потолк|крыш|windshield\s*module/i },
  { id: "seats", re: /\bseat|сиден/i },
];

let cachedLabels: Record<string, string> | null | undefined;

function ewdDataDir(): string {
  return resolve(process.env.EWD_DATA_DIR || process.env.EWD_DIR || join(process.cwd(), "data", "ewd"));
}

function loadHarnessLabels(): Record<string, string> {
  if (cachedLabels !== undefined) return cachedLabels || {};
  const path = join(ewdDataDir(), "harness_labels.json");
  if (!existsSync(path)) {
    cachedLabels = {};
    return cachedLabels;
  }
  try {
    const payload = JSON.parse(readFileSync(path, "utf-8")) as { by_id?: Record<string, string> };
    cachedLabels = payload.by_id || {};
  } catch {
    cachedLabels = {};
  }
  return cachedLabels;
}

/** Test helper */
export function resetHarnessLabelCache(): void {
  cachedLabels = undefined;
}

function classifyByRules(text: string): ZoneId | null {
  const s = String(text || "").trim();
  if (!s) return null;
  if (ZONE_LABELS[s as ZoneId]) return s as ZoneId;
  for (const rule of ZONE_RULES) {
    if (rule.re.test(s)) return rule.id;
  }
  return null;
}

/** Extract Capital harness id token from raw harness_left (id alone or "label id"). */
export function extractCapitalHarnessId(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (CAPITAL_HARNESS_ZONE[s] || loadHarnessLabels()[s]) return s;
  // Prefer known keys appearing as whole tokens
  for (const id of Object.keys(CAPITAL_HARNESS_ZONE)) {
    if (new RegExp(`(?:^|[\\s,;/])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[\\s,;/])`, "i").test(s)) {
      return id;
    }
  }
  for (const id of Object.keys(loadHarnessLabels())) {
    if (new RegExp(`(?:^|[\\s,;/])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[\\s,;/])`, "i").test(s)) {
      return id;
    }
  }
  // Bare Capital-style id
  const m = s.match(/^([0-9A-Za-z][0-9A-Za-z_-]{2,20})$/);
  return m ? m[1] : null;
}

function zoneFromCapitalId(id: string): ZoneId | null {
  if (CAPITAL_HARNESS_ZONE[id]) return CAPITAL_HARNESS_ZONE[id];
  const label = loadHarnessLabels()[id];
  if (label) {
    const z = classifyByRules(label);
    if (z) return z;
  }
  return null;
}

/** Classify harness / system title text into a zone (unknown → other). */
export function harnessToZone(harness: string | null | undefined): ZoneId {
  const s = String(harness || "").trim();
  if (!s) return "other";
  if (ZONE_LABELS[s as ZoneId]) return s as ZoneId;

  const capitalId = extractCapitalHarnessId(s);
  if (capitalId) {
    const z = zoneFromCapitalId(capitalId);
    if (z) return z;
  }

  const byRules = classifyByRules(s);
  if (byRules) return byRules;

  // Label-only resolve when harness is a known id without explicit map
  const label = loadHarnessLabels()[s];
  if (label) {
    const z = classifyByRules(label);
    if (z) return z;
  }

  if (/\bdoor|двер/i.test(s)) return /rear|задн/i.test(s) ? "rear_doors" : "front_doors";
  return "other";
}

/**
 * Soft classify for diagram/system titles.
 * Returns null when the text has no zone signal (keep row if other context matches).
 */
export function classifySystemText(text: string | null | undefined): ZoneId | null {
  const s = String(text || "").trim();
  if (!s) return null;
  const byRules = classifyByRules(s);
  if (byRules) return byRules;
  // EWD LogicDesign-style titles
  if (/\bfront\s*pas\b|park\s*assistance\s*system\s*front|\bfog\b|headlamp\s*wash/i.test(s)) {
    return "front_bumper";
  }
  if (/\brear\s*pas\b|park\s*assistance\s*system\s*rear/i.test(s)) return "rear_bumper";
  if (/\binject|ECM|engine\s*control|alternator|generator|starter|VEA|grounding\s*engine/i.test(s)) {
    return "engine";
  }
  if (/\bpower\s*window|exterior\s*mirror|door\s*lock|door\s*module|central\s*locking/i.test(s)) {
    return /rear/i.test(s) ? "rear_doors" : "front_doors";
  }
  if (/\btrunk|tailgate|rear\s*wiper|backlight|rear\s*window\s*heat/i.test(s)) return "trunk";
  return null;
}

export function textMatchesZone(text: string | null | undefined, zone: string | null | undefined): boolean {
  const z = String(zone || "").trim();
  if (!z || z === "all") return true;
  const classified = classifySystemText(text);
  if (classified === null) return true; // unknown title — do not drop solely on title
  if (ZONE_LABELS[z as ZoneId]) return classified === z;
  for (const [id, label] of Object.entries(ZONE_LABELS)) {
    if (label === z) return classified === id;
  }
  return classified === harnessToZone(z);
}

/** Strict: text must classify into the zone (unknown → false). For empty-harness DBs. */
export function textBelongsToZone(text: string | null | undefined, zone: string | null | undefined): boolean {
  const z = String(zone || "").trim();
  if (!z || z === "all") return true;
  const classified = classifySystemText(text);
  if (classified === null) return false;
  if (ZONE_LABELS[z as ZoneId]) return classified === z;
  for (const [id, label] of Object.entries(ZONE_LABELS)) {
    if (label === z) return classified === id;
  }
  return false;
}

const BODY_ZONES = new Set<ZoneId>([
  "front_doors",
  "rear_doors",
  "front_bumper",
  "rear_bumper",
  "trunk",
  "roof",
  "seats",
]);

/**
 * True if the wire belongs to the selected zone.
 * Boundary cables (e.g. Engine compartment + Bumper front) are attributed to the
 * body zone, never to "engine", so duplicate codes like 74/309 stay isolated.
 */
export function wireMatchesZone(
  harnessLeft: string | null | undefined,
  harnessRight: string | null | undefined,
  zone: string | null | undefined,
): boolean {
  const z = String(zone || "").trim();
  if (!z || z === "all") return true;
  const left = String(harnessLeft || "").trim();
  const right = String(harnessRight || "").trim();
  if (left === z || right === z) return true;

  let zoneId = z as ZoneId;
  if (!ZONE_LABELS[zoneId]) {
    for (const [id, label] of Object.entries(ZONE_LABELS)) {
      if (label === z) {
        zoneId = id as ZoneId;
        break;
      }
    }
  }
  if (!ZONE_LABELS[zoneId]) {
    const zl = z.toLowerCase();
    return left.toLowerCase().includes(zl) || right.toLowerCase().includes(zl);
  }

  const lz = harnessToZone(left);
  const rz = harnessToZone(right);
  const sides = [lz, rz];
  const hasBody = sides.some((s) => BODY_ZONES.has(s));
  const hasZone = sides.includes(zoneId);

  // Engine compartment ↔ bumper/door: belongs to body zone only
  if (zoneId === "engine" && hasBody) return false;
  if (!hasZone) return false;
  return true;
}

/** Engine / bumper mutual exclusion helpers for peer sanity checks. */
export function zonesConflict(a: ZoneId, b: ZoneId): boolean {
  if (a === b || a === "other" || b === "other") return false;
  return (a === "engine" && BODY_ZONES.has(b)) || (b === "engine" && BODY_ZONES.has(a));
}

/**
 * Soft keep for empty-harness DBs: unknown text does NOT exclude the row.
 * Only drop when text classifies into a zone that conflicts with the selection
 * (e.g. engine ↔ bumper/doors).
 */
export function textConflictsWithZone(text: string | null | undefined, zone: string | null | undefined): boolean {
  const z = String(zone || "").trim();
  if (!z || z === "all") return false;
  let zoneId = z as ZoneId;
  if (!ZONE_LABELS[zoneId]) {
    for (const [id, label] of Object.entries(ZONE_LABELS)) {
      if (label === z) {
        zoneId = id as ZoneId;
        break;
      }
    }
  }
  if (!ZONE_LABELS[zoneId]) return false;
  const classified = classifySystemText(text);
  if (classified === null || classified === zoneId) return false;
  return zonesConflict(zoneId, classified);
}

/**
 * Resolve zone id from label or id string; null if unknown / all.
 */
export function resolveZoneId(zone: string | null | undefined): ZoneId | null {
  const z = String(zone || "").trim();
  if (!z || z === "all") return null;
  if (ZONE_LABELS[z as ZoneId]) return z as ZoneId;
  for (const [id, label] of Object.entries(ZONE_LABELS)) {
    if (label === z) return id as ZoneId;
  }
  return null;
}
