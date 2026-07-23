/**
 * EN → RU phrase map for card display (DB stays English).
 * Longer phrases first when applying replacements.
 */
const PHRASE_MAP: Array<[string, string]> = [
  ["Driver Door Module (DDM)", "Модуль двери водителя (DDM)"],
  ["Passenger Door Module (PDM)", "Модуль двери пассажира (PDM)"],
  ["Rear Door Module (RDM)", "Модуль задней двери (RDM)"],
  ["Central Electronic Module (CEM)", "Центральный электронный модуль (CEM)"],
  ["Branching point ground", "Точка массы"],
  ["Branching point", "Точка разветвления"],
  ["Left-hand front door speaker", "Динамик левой передней двери"],
  ["Right-hand front door speaker", "Динамик правой передней двери"],
  ["Left-hand rear door speaker", "Динамик левой задней двери"],
  ["Right-hand rear door speaker", "Динамик правой задней двери"],
  ["Driver Door Module", "Модуль двери водителя"],
  ["Passenger Door Module", "Модуль двери пассажира"],
  ["Rear Door Module", "Модуль задней двери"],
  ["Central Electronic Module", "Центральный электронный модуль"],
  ["Infotainment control module", "Модуль управления infotainment"],
  ["Window lift motor", "Мотор стеклоподъёмника"],
  ["Door lock motor", "Мотор замка двери"],
  ["Exterior mirror", "Наружное зеркало"],
  ["Connector", "Разъем"],
  ["Ground connection", "Точка массы"],
  ["Ground", "Точка массы"],
];

/** Translate known engineering phrases in a free-text field for RU UI. */
export function localizeEngineeringText(text: string | null | undefined): string {
  let s = String(text || "");
  if (!s) return s;
  for (const [en, ru] of PHRASE_MAP) {
    if (!en) continue;
    const re = new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    s = s.replace(re, ru);
  }
  return s;
}
