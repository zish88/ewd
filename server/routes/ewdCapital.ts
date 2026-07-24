/**
 * Capital package resource APIs: FaceViews, LocationViews, reports, intro (RU).
 */
import { Router } from "express";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { ewdDataDir, resolveIndexedPath, safeUnderDataDir } from "../ewdPaths.js";

const ROOT = resolve(process.cwd());
const EWD_DATA = resolve(process.env.EWD_DATA_DIR || process.env.EWD_DIR || join(ROOT, "data", "ewd"));

type FaceIndex = {
  by_code?: Record<
    string,
    Array<{ objectUid?: string; designUid?: string; html?: string; svg?: string; pinCount?: number }>
  >;
  by_key?: Record<string, Array<Record<string, unknown>>>;
};

type LocIndex = {
  by_code?: Record<
    string,
    Array<{
      code?: string;
      svg?: string;
      svgs?: string[];
      svgRel?: string;
      systems?: Array<Record<string, string>>;
      type?: string;
    }>
  >;
};

let faceIndex: FaceIndex | null = null;
let locIndex: LocIndex | null = null;

function loadJson<T>(name: string): T | null {
  const path = join(EWD_DATA, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function ensure() {
  if (!faceIndex) faceIndex = loadJson<FaceIndex>("face_view_index.json");
  if (!locIndex) locIndex = loadJson<LocIndex>("location_index.json");
}

function normalizeCode(raw: string): string {
  const m = String(raw || "")
    .trim()
    .match(/^(\d+)[A-Z]?\/(\d+)/i);
  return m ? `${m[1]}/${m[2]}` : String(raw || "").trim();
}

function resourcesRoot(): string {
  return join(ewdDataDir(), "Resources");
}

function introDir(): string {
  return join(resourcesRoot(), "Introduction");
}

const REPORT_FILES: Record<string, string> = {
  fuse: "{FuseReport}.html",
  inline: "{inlineReport}.html",
  splice: "{splicereport}.html",
  grounds: join("..", "Harness", "Grounds.html"),
};

const INTRO_SLUGS: Record<string, RegExp> = {
  intro: /^1\s*-/i,
  publication: /^2\s*-/i,
  guide: /^3\s*-/i,
  abbreviations: /^4\s*-/i,
  faq: /^5\s*-/i,
};

function findIntroFile(slug: string): string | null {
  const dir = introDir();
  if (!existsSync(dir)) return null;
  const re = INTRO_SLUGS[slug] || INTRO_SLUGS.guide;
  const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
  const ru = files.find((f) => re.test(f) && /_RU\.html$/i.test(f));
  if (ru) return join(dir, ru);
  const any = files.find((f) => re.test(f));
  return any ? join(dir, any) : null;
}

function remapStoredPath(stored: string): string | null {
  if (!stored) return null;
  const viaIndex = resolveIndexedPath(stored);
  if (viaIndex) return viaIndex;
  const posix = stored.replace(/\\/g, "/");
  const data = ewdDataDir();
  if (posix.includes("FaceViews/")) {
    const m = posix.match(/\/(UID[^/]+\/FaceViews\/[^/]+\.(?:html|svg))$/i);
    if (m) {
      const cand = join(data, m[1].replace(/\//g, "\\") === m[1] ? m[1] : m[1]);
      const p = join(data, ...m[1].split("/"));
      if (existsSync(p) && safeUnderDataDir(p)) return p;
      void cand;
    }
  }
  if (posix.includes("TwoDviews/")) {
    const base = basename(posix);
    const p = join(data, "Resources", "TwoDviews", base);
    if (existsSync(p)) return p;
  }
  const direct = resolve(posix);
  if (existsSync(direct) && safeUnderDataDir(direct)) return direct;
  return null;
}

export function createEwdCapitalRouter() {
  const router = Router();

  router.get("/faceview", (req, res) => {
    ensure();
    const code = normalizeCode(String(req.query.code || ""));
    if (!code) {
      res.status(400).json({ error: "code required" });
      return;
    }
    const systemUid = String(req.query.systemUid || "").trim();
    const faces = faceIndex?.by_code?.[code] || [];
    if (!faces.length) {
      res.json({ code, count: 0, faces: [], pins: [] });
      return;
    }
    let picked = faces[0];
    if (systemUid) {
      picked = faces.find((f) => f.designUid === systemUid || f.objectUid === systemUid) || picked;
    }
    const htmlPath = remapStoredPath(String(picked.html || ""));
    const svgPath = remapStoredPath(String(picked.svg || ""));
    const pinKey = String(req.query.pin || "").trim().toUpperCase();
    let pins =
      faceIndex?.by_key?.[`${code}|${pinKey}`] ||
      Object.entries(faceIndex?.by_key || {})
        .filter(([k]) => k.startsWith(`${code}|`) && k.split("|").length === 2)
        .flatMap(([, v]) => v);
    if (systemUid) {
      const scoped = pins.filter((p) => String(p.systemUid || p.designUid || "") === systemUid);
      if (scoped.length) pins = scoped;
    }
    let html = "";
    if (htmlPath && existsSync(htmlPath)) {
      html = readFileSync(htmlPath, "utf-8");
    }
    res.json({
      code,
      objectUid: picked.objectUid,
      designUid: picked.designUid,
      htmlPath: htmlPath || null,
      svgPath: svgPath || null,
      svgAvailable: Boolean(svgPath),
      html,
      pins: pins.slice(0, 120),
      faces: faces.map((f) => ({
        objectUid: f.objectUid,
        designUid: f.designUid,
        pinCount: f.pinCount,
        hasHtml: Boolean(remapStoredPath(String(f.html || ""))),
      })),
      count: faces.length,
    });
  });

  router.get("/location", (req, res) => {
    ensure();
    const code = normalizeCode(String(req.query.code || ""));
    if (!code) {
      res.status(400).json({ error: "code required" });
      return;
    }
    const views = locIndex?.by_code?.[code] || [];
    const primary = views[0];
    const svgPath = primary ? remapStoredPath(String(primary.svg || "")) : null;
    let svg = "";
    if (svgPath && existsSync(svgPath)) {
      svg = readFileSync(svgPath, "utf-8");
    }
    res.json({
      code,
      count: views.length,
      svgPath: svgPath || null,
      svgAvailable: Boolean(svgPath),
      svg,
      systems: primary?.systems || [],
      views: views.slice(0, 12).map((v) => ({
        svg: remapStoredPath(String(v.svg || "")),
        svgRel: v.svgRel,
        type: v.type,
        systemCount: (v.systems || []).length,
      })),
    });
  });

  router.get("/report/:kind", (req, res) => {
    const kind = String(req.params.kind || "").toLowerCase();
    const file = REPORT_FILES[kind];
    if (!file) {
      res.status(400).type("text").send("kind must be fuse|inline|splice|grounds");
      return;
    }
    const path =
      kind === "grounds"
        ? join(ewdDataDir(), "Harness", "Grounds.html")
        : join(resourcesRoot(), file);
    if (!existsSync(path) || !safeUnderDataDir(path)) {
      res.status(404).type("text").send("Report not found");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(readFileSync(path, "utf-8"));
  });

  router.get("/intro/:slug", (req, res) => {
    const slug = String(req.params.slug || "guide").toLowerCase();
    const path = findIntroFile(slug);
    if (!path || !existsSync(path)) {
      res.status(404).type("text").send("Intro page not found");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(readFileSync(path, "utf-8"));
  });

  router.get("/intro", (_req, res) => {
    const dir = introDir();
    if (!existsSync(dir)) {
      res.json({ pages: [] });
      return;
    }
    const pages = readdirSync(dir)
      .filter((f) => /_RU\.html$/i.test(f))
      .map((f) => {
        let slug = "guide";
        if (f.startsWith("1")) slug = "intro";
        else if (f.startsWith("2")) slug = "publication";
        else if (f.startsWith("3")) slug = "guide";
        else if (f.startsWith("4")) slug = "abbreviations";
        else if (f.startsWith("5")) slug = "faq";
        return { slug, file: f, title: f.replace(/_RU\.html$/i, "") };
      });
    res.json({ pages });
  });

  return router;
}

/** Lookup FaceView edges for highlight (shared with ewd.ts). */
export function lookupFacePins(
  code: string,
  pin: string,
  systemUid?: string,
): Array<Record<string, unknown>> {
  ensure();
  const pinKey = String(pin || "")
    .trim()
    .toUpperCase();
  if (!code || !pinKey || !faceIndex?.by_key) return [];
  let rows = faceIndex.by_key[`${code}|${pinKey}`] || [];
  if (systemUid) {
    const scoped = rows.filter(
      (r) => String(r.systemUid || r.designUid || "") === systemUid,
    );
    if (scoped.length) rows = scoped;
  }
  return rows;
}
