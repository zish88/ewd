/** Map Volvo harness header strings → RU zone buckets for Dropdown facets. */

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

const ZONE_RULES: Array<{ id: ZoneId; re: RegExp }> = [
  { id: "front_bumper", re: /\bbumper,?\s*front|front\s*bumper|бампер.*перед|передн\w*\s*бампер|washer\s*nozzle|parking\s*assistance|forward-?aimed\s*radar|\bFLC\b/i },
  { id: "rear_bumper", re: /\bbumper,?\s*rear|rear\s*bumper|бампер.*зад|задн\w*\s*бампер/i },
  { id: "trunk", re: /\btrunk\s*lid|tailgate|tail\s*gate|cargo|багажн|задн\w*\s*двер[ьи].*крыш|fifth\s*door/i },
  { id: "front_doors", re: /\bfront\s*door|передн\w*\s*двер/i },
  { id: "rear_doors", re: /\brear\s*door|задн\w*\s*двер/i },
  { id: "engine", re: /\bengine\s*(compartment\s*)?harness|\bengine\b|compartment|мотор|капот|двигател|starter\s*motor/i },
  { id: "dashboard", re: /\bdashboard|instrument|heater|cabin|infotainment|center\s*console|climate|салон|панел|торпед/i },
  { id: "floor", re: /\bfloor|tunnel|пол|туннел|rear\s*axle|axle\s*harness/i },
  { id: "roof", re: /\broof|крыш|windshield\s*module/i },
  { id: "seats", re: /\bseat|сиден/i },
];

/** Classify harness / system title text into a zone (unknown → other). */
export function harnessToZone(harness: string | null | undefined): ZoneId {
  const s = String(harness || "").trim();
  if (!s) return "other";
  for (const rule of ZONE_RULES) {
    if (rule.re.test(s)) return rule.id;
  }
  if (/\bdoor|двер/i.test(s)) return "front_doors";
  return "other";
}

/**
 * Soft classify for diagram/system titles.
 * Returns null when the text has no zone signal (keep row if other context matches).
 */
export function classifySystemText(text: string | null | undefined): ZoneId | null {
  const s = String(text || "").trim();
  if (!s) return null;
  for (const rule of ZONE_RULES) {
    if (rule.re.test(s)) return rule.id;
  }
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
