/**
 * Audit repair-catalog image coverage using code-strict browser-viewable resolve.
 * Writes data/reports/repair-image-coverage.json
 *
 * Usage: npx tsx scripts/audit-repair-image-coverage.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { partImageUrl, resetPartImageIndexCache } from "../server/partImageIndex.js";

const root = process.cwd();
const catalogPath = join(root, "data", "vida_harness_repair_catalog.json");
const outPath = join(root, "data", "reports", "repair-image-coverage.json");

type RoleKey = "housing" | "mate" | "device" | "terminal" | "seal" | "pigtail" | "tool" | "tool_kit" | "other";

type PnAgg = {
  part_number: string;
  roles: Set<string>;
  wiring_codes: Set<string>;
  with_image_codes: Set<string>;
};

function roleOf(raw: string | undefined): RoleKey {
  const r = String(raw || "").toLowerCase();
  if (r === "housing" || r === "mate" || r === "device" || r === "terminal" || r === "seal" || r === "pigtail" || r === "tool" || r === "tool_kit") {
    return r;
  }
  return "other";
}

function main() {
  if (!existsSync(catalogPath)) {
    console.error(`Missing ${catalogPath}`);
    process.exit(1);
  }
  resetPartImageIndexCache();
  const cat = JSON.parse(readFileSync(catalogPath, "utf-8")) as {
    connectors?: Record<string, any>;
    tools?: Array<{ part_number?: string; role?: string }>;
  };

  const byPn = new Map<string, PnAgg>();
  const connectorStats = {
    full: 0,
    partial: 0,
    none: 0,
    housing_ok: 0,
    mate_ok: 0,
    mate_total: 0,
  };

  function touch(pn: string, role: string, code: string, hasImg: boolean) {
    const key = String(pn || "").trim();
    if (!key) return;
    let agg = byPn.get(key);
    if (!agg) {
      agg = { part_number: key, roles: new Set(), wiring_codes: new Set(), with_image_codes: new Set() };
      byPn.set(key, agg);
    }
    agg.roles.add(role);
    if (code) agg.wiring_codes.add(code);
    if (hasImg && code) agg.with_image_codes.add(code);
  }

  for (const [code, rec] of Object.entries(cat.connectors || {})) {
    const checks: Array<{ role: RoleKey; pn: string }> = [];
    if (rec?.housing?.part_number) checks.push({ role: "housing", pn: String(rec.housing.part_number) });
    if (rec?.mate?.part_number) {
      connectorStats.mate_total += 1;
      checks.push({ role: "mate", pn: String(rec.mate.part_number) });
    }
    if (rec?.device?.part_number) checks.push({ role: "device", pn: String(rec.device.part_number) });
    for (const it of rec?.items || []) {
      checks.push({ role: roleOf(it.role), pn: String(it.part_number || "") });
    }

    let ok = 0;
    let tracked = 0;
    for (const { role, pn } of checks) {
      if (!pn) continue;
      if (role === "housing" || role === "mate") tracked += 1;
      const url = partImageUrl(pn, code);
      const has = Boolean(url);
      touch(pn, role, code, has);
      if (role === "housing" && has) {
        connectorStats.housing_ok += 1;
        ok += 1;
      }
      if (role === "mate" && has) {
        connectorStats.mate_ok += 1;
        ok += 1;
      }
    }
    if (tracked === 0) connectorStats.none += 1;
    else if (ok === 0) connectorStats.none += 1;
    else if (ok < tracked) connectorStats.partial += 1;
    else connectorStats.full += 1;
  }

  for (const t of cat.tools || []) {
    const pn = String(t.part_number || "").trim();
    if (!pn) continue;
    touch(pn, roleOf(t.role), "", Boolean(partImageUrl(pn, null)));
  }

  const missing_by_role: Record<string, number> = {};
  const missing_pns: Array<{
    part_number: string;
    roles: string[];
    wiring_codes_count: number;
    wiring_codes_sample: string[];
  }> = [];
  let with_image = 0;

  for (const agg of byPn.values()) {
    const hasAny = agg.with_image_codes.size > 0 || (agg.wiring_codes.size === 0 && Boolean(partImageUrl(agg.part_number, null)));
    // PN counts as "with_image" if any card code resolves a viewable plate
    const resolvedAnywhere = [...agg.wiring_codes].some((c) => Boolean(partImageUrl(agg.part_number, c)));
    if (resolvedAnywhere || (agg.wiring_codes.size === 0 && hasAny)) {
      with_image += 1;
      continue;
    }
    for (const role of agg.roles) {
      missing_by_role[role] = (missing_by_role[role] || 0) + 1;
    }
    missing_pns.push({
      part_number: agg.part_number,
      roles: [...agg.roles].sort(),
      wiring_codes_count: agg.wiring_codes.size,
      wiring_codes_sample: [...agg.wiring_codes].sort().slice(0, 8),
    });
  }

  missing_pns.sort((a, b) => a.part_number.localeCompare(b.part_number));

  const payload = {
    generated_for: "repair-card image gap audit",
    generated_at: new Date().toISOString(),
    resolve_rules: "wiring_code exact match + browser-viewable ext (svg/png/…); CGM alone does not count",
    repair_unique_pns: byPn.size,
    with_image,
    missing: missing_pns.length,
    coverage_pct: byPn.size ? Math.round((with_image / byPn.size) * 1000) / 10 : 0,
    connectors: {
      total: Object.keys(cat.connectors || {}).length,
      housing_with_image: connectorStats.housing_ok,
      mate_with_image: connectorStats.mate_ok,
      mate_total: connectorStats.mate_total,
      full_shell_coverage: connectorStats.full,
      partial_shell_coverage: connectorStats.partial,
      no_shell_image: connectorStats.none,
    },
    missing_by_role,
    missing_pns,
  };

  mkdirSync(join(root, "data", "reports"), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(
    `Coverage: ${with_image}/${byPn.size} PN (${payload.coverage_pct}%); housing cards ok=${connectorStats.housing_ok}; wrote ${outPath}`,
  );
}

main();
