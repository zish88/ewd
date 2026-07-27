/**
 * Project-wide bilingual search lexicon.
 * Used by nav node search (client) and wire/card search (server).
 * Keep entries stem-like so one group covers RU inflection + EN synonyms.
 */

/** Tokens that describe “wiring of X” rather than a part — drop from AND queries. */
export const SEARCH_STOPWORDS = new Set(
  [
    "проводка",
    "проводки",
    "проводк",
    "провод",
    "провода",
    "жгут",
    "жгута",
    "жгуты",
    "harness",
    "wiring",
    "wire",
    "wires",
    "система",
    "системы",
    "схема",
    "схемы",
    "для",
    "на",
    "по",
    "из",
    "the",
    "and",
    "of",
    "a",
  ].map((s) => s.toLowerCase()),
);

/**
 * Synonym / stem groups. Matching is substring-based against any member.
 * Orientation, zones, and common component families — not a single keyword list.
 */
export const SEARCH_SYNONYM_GROUPS: string[][] = [
  // orientation
  ["передн", "front", "передняя", "передний", "передней"],
  ["задн", "rear", "задняя", "задний", "задней"],
  ["лев", "left", "lh", "водитель", "driver", "левой", "левая"],
  ["прав", "right", "rh", "пассажир", "passenger", "правой", "правая"],

  // body zones
  ["двер", "door"],
  ["багажн", "trunk", "tailgate", "cargo", "хвостов", "пята"],
  ["бампер", "bumper"],
  ["моторн", "engine", "двигател", "compartment"],
  ["панел", "dashboard", "торпед", "приборн", "салон", "cabin", "console"],
  ["крыш", "roof", "потолк", "headliner", "люк", "sunroof"],
  ["сиден", "seat", "поясниц"],
  ["пол", "floor", "туннел", "tunnel", "порог"],

  // lighting / signalling
  ["фар", "headlamp", "headlight"],
  ["фонар", "taillight", "rear lamp"],
  ["противотуман", "fog"],
  ["освещен", "light", "lamp", "подсветк", "плафон", "courtesy"],
  ["стоп", "stop lamp", "brake light"],
  ["указател", "indicator", "turn signal", "blinker"],

  // doors / glass / mirrors
  ["стеклоподъем", "window", "стекл"],
  ["зеркал", "mirror"],
  ["замок", "lock", "locking", "замк"],
  ["ручк", "handle"],

  // audio / antennas / cameras
  ["динамик", "speaker", "колонк", "аудио"],
  ["микрофон", "microphone", "mic"],
  ["антенн", "antenna"],
  ["камер", "camera"],
  ["навигац", "navigation", "gps"],

  // powertrain / climate / chassis
  ["датчик", "sensor"],
  ["реле", "relay"],
  ["предохранител", "fuse"],
  ["аккумулятор", "battery"],
  ["стартер", "starter"],
  ["генератор", "alternator"],
  ["форсун", "injector", "injection"],
  ["катушк", "ignition coil", "coil"],
  ["климат", "climate", "hvac", "отопител", "печк", "heater"],
  ["кондиц", "a/c", "ac compressor"],
  ["топливн", "fuel"],
  ["тормоз", "brake"],
  ["педал", "pedal"],
  ["рулев", "steering"],
  ["радар", "radar", "flr", "flc"],
  ["парктроник", "park assist", "pas", "parking"],
  ["подогрев", "heater", "heated", "heat"],
  ["вентиляц", "ventilation", "blower"],
  ["массаж", "massage"],
  ["дифференциал", "differential", "erad", "dem"],
  ["зарядн", "charger", "obc"],
];

/** Extra RU/EN aliases injected into nav `search_text` per home_zone. */
export const ZONE_SEARCH_ALIASES: Record<string, string[]> = {
  front_doors: [
    "передние двери",
    "дверь водителя",
    "дверь пассажира",
    "front door",
    "door harness",
    "проводка двери",
    "жгут двери",
  ],
  rear_doors: [
    "задние двери",
    "rear door",
    "проводка задней двери",
    "жгут задней двери",
  ],
  front_bumper: [
    "передний бампер",
    "front bumper",
    "парктроник передний",
    "противотуманки",
    "омыватель фар",
  ],
  rear_bumper: [
    "задний бампер",
    "rear bumper",
    "парктроник задний",
    "переходник бампера",
  ],
  trunk: [
    "багажный отсек",
    "хвостовая дверь",
    "пятая дверь",
    "tailgate",
    "cargo compartment",
    "проводка багажника",
    "жгут багажника",
  ],
  engine: [
    "моторный отсек",
    "engine compartment",
    "проводка моторного отсека",
    "жгут двигателя",
  ],
  dashboard: [
    "панель приборов",
    "торпедо",
    "салон",
    "центральная консоль",
    "instrument panel",
    "cabin harness",
  ],
  floor: [
    "пол",
    "туннель",
    "порог",
    "floor harness",
    "tunnel",
    "напольный жгут",
  ],
  roof: [
    "крыша",
    "потолок",
    "люк",
    "headliner",
    "sunroof",
    "потолочная консоль",
  ],
  seats: [
    "сиденье",
    "сиденья",
    "подогрев сидений",
    "seat harness",
    "seat module",
  ],
  other: [],
};

export function normalizeSearchQuery(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]+/gu, " ")
    .replace(/\s+/g, " ");
}

export function isSearchStopword(token: string): boolean {
  const t = token.toLowerCase();
  if (SEARCH_STOPWORDS.has(t)) return true;
  for (const sw of SEARCH_STOPWORDS) {
    if (sw.length >= 4 && (t.startsWith(sw) || sw.startsWith(t))) return true;
  }
  return false;
}

/** Resolve one query token to OR-alternatives (self + synonym group). */
export function resolveSearchAlternatives(rawWord: string): string[] {
  const word = normalizeSearchQuery(rawWord).replace(/\s+/g, "");
  if (!word || isSearchStopword(word)) return [];

  for (const group of SEARCH_SYNONYM_GROUPS) {
    for (const candidate of group) {
      const stem = candidate.toLowerCase();
      if (!stem) continue;
      const hit =
        word === stem ||
        (stem.length >= 3 && word.includes(stem)) ||
        (word.length >= 3 && stem.includes(word));
      if (hit) {
        return [...new Set([word, ...group.map((x) => x.toLowerCase())])];
      }
    }
  }
  return [word];
}

/**
 * Turn a free-text query into AND-of-OR groups.
 * Drops stopwords; expands synonyms; strips leading «проводка/жгут …».
 */
export function buildSearchAndGroups(query: string): string[][] {
  let q = normalizeSearchQuery(query);
  if (!q) return [];

  // «проводка X / жгут X / wiring X» → search for X (stopword already dropped)
  q = q
    .replace(/^(проводк\w*|жгут\w*|harness|wiring|wire)\s+/u, "")
    .replace(/\s+(проводк\w*|жгут\w*|harness|wiring)$/u, "")
    .trim();

  const groups: string[][] = [];
  for (const token of q.split(/\s+/)) {
    const alts = resolveSearchAlternatives(token);
    if (alts.length) groups.push(alts);
  }
  return groups;
}

/** True if haystack contains at least one alternative from every AND group. */
export function haystackMatchesAndGroups(haystack: string, groups: string[][]): boolean {
  if (!groups.length) return true;
  const hay = haystack.toLowerCase();
  return groups.every((alts) => alts.some((alt) => alt.length > 0 && hay.includes(alt)));
}
