/**
 * Bridge UI zones ↔ EWD LogicDesign systems (diagramAsSystem.xml).
 * Used to keep netlist / endpoints isolated by selected zone.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifySystemText, type ZoneId } from "./harnessZones.js";

export type EwdSystemRec = {
  designUid: string;
  name: string;
  folders: string;
  zone: ZoneId | null;
  diagramUids: string[];
};

let catalog: Map<string, EwdSystemRec> | null = null;
let catalogPath = "";

function parseDiagramAsSystem(xml: string): Map<string, EwdSystemRec> {
  const map = new Map<string, EwdSystemRec>();
  const blocks = xml.match(/<system\b[\s\S]*?<\/system>/gi) || [];
  for (const block of blocks) {
    const open = block.match(/<system\b[^>]*>/i)?.[0] || "";
    const idAttr = /\bid="([^"]+)"/i.exec(open)?.[1] || "";
    const name = /\bname="([^"]*)"/i.exec(open)?.[1] || "";
    const folders = /\bfolders="([^"]*)"/i.exec(open)?.[1] || "";
    const designUid = idAttr.split(":")[0] || "";
    if (!designUid.startsWith("UID")) continue;
    const diagramUids = [...block.matchAll(/<diagram\b[^>]*\bid="(UID[^"]+)"/gi)].map((m) => m[1]);
    const blob = `${name} ${folders}`;
    const zone = classifySystemText(blob);
    map.set(designUid, { designUid, name, folders, zone, diagramUids });
  }
  return map;
}

export function loadEwdSystemCatalog(dataDir: string): Map<string, EwdSystemRec> {
  const path = join(dataDir, "diagramAsSystem.xml");
  if (catalog && catalogPath === path) return catalog;
  catalogPath = path;
  if (!existsSync(path)) {
    catalog = new Map();
    return catalog;
  }
  try {
    catalog = parseDiagramAsSystem(readFileSync(path, "utf-8"));
  } catch {
    catalog = new Map();
  }
  return catalog;
}

export function systemZone(designUid: string, dataDir: string): ZoneId | null {
  return loadEwdSystemCatalog(dataDir).get(designUid)?.zone ?? null;
}

export function systemMatchesZone(designUid: string, zone: string | null | undefined, dataDir: string): boolean {
  const z = String(zone || "").trim();
  if (!z || z === "all") return true;
  const rec = loadEwdSystemCatalog(dataDir).get(designUid);
  if (!rec) return true; // unknown system — do not invent a match; caller should intersect carefully
  if (rec.zone === null) return true;
  return rec.zone === z;
}

/** Filter a list of design UIDs down to those belonging to the selected zone. */
export function filterDesignUidsByZone(
  designUids: string[],
  zone: string | null | undefined,
  dataDir: string,
): string[] {
  const z = String(zone || "").trim();
  if (!z || z === "all") return designUids;
  const cat = loadEwdSystemCatalog(dataDir);
  const matched = designUids.filter((uid) => {
    const rec = cat.get(uid);
    if (!rec) return false;
    return rec.zone === z;
  });
  return matched;
}
