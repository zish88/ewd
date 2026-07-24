/**
 * Weighted scheme resolver smoke — module+connector beats junction-only (score 0).
 */
import { readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { createContext, runInContext } from "node:vm";

const root = resolve(import.meta.dirname, "..");
const bundlePath = resolve(root, "scripts/_scheme-resolver-smoke.js");

execSync(
  `npx esbuild client/src/ewdSchemeResolver.ts --bundle --format=iife --global-name=SR --outfile=scripts/_scheme-resolver-smoke.js`,
  { cwd: root, stdio: "inherit" },
);

const ctxVm = createContext({ console });
runInContext(`${readFileSync(bundlePath, "utf8")}\nthis.SR = SR;`, ctxVm);
const SR = ctxVm.SR;

const pageA = {
  diagramUid: "uid-full",
  textCodes: ["3/100", "74/200", "4/300"],
  pathCount: 10,
  title: "Modules + connector",
};
const pageB = {
  diagramUid: "uid-junction",
  textCodes: ["74/200"],
  pathCount: 99,
  title: "Junction only",
};
const pageC = {
  diagramUid: "uid-module",
  textCodes: ["3/100", "74/999"],
  pathCount: 50,
  title: "Module only (foreign junction)",
};
const pageD = {
  diagramUid: "uid-family20",
  textCodes: ["20/10", "74/200"],
  pathCount: 5,
  title: "Family 20 + connector",
};

const ctx = {
  selectedCode: "74/200",
  fromCode: "3/100",
  toCode: "4/300",
  viaCode: "74/200",
  peerCode: "4/300",
};

const ctx20 = {
  selectedCode: "74/200",
  fromCode: "20/10",
  toCode: "3/100",
  viaCode: "74/200",
  peerCode: "3/100",
};

const scoreA = SR.scoreDiagramForContext(pageA, ctx);
const scoreB = SR.scoreDiagramForContext(pageB, ctx);
const scoreC = SR.scoreDiagramForContext(pageC, ctx);
const scoreD = SR.scoreDiagramForContext(pageD, ctx20);
const picked = SR.pickBestDiagram([pageB, pageC, pageA], ctx);
const pickedDense = SR.pickBestDiagram([pageB, pageC], ctx);

const codeOnly = SR.extractSchemeContext(null, "74/200");
const pickedCodeOnly = SR.pickBestDiagram([pageB, pageA], codeOnly);

// Systemic pin remap: junction card pin ≠ module cavity on selected sheet
const cardPin21 = {
  from_detail: "3/126C1:2 — Driver Door Module (DDM) LHD",
  to_detail: "3/127C1:2 — Passenger Door Module (PDM)",
  pin_number: "21",
};
const pinOnModule = SR.resolveHighlightPin(cardPin21, "3/126", "21");
const pinOnJunction = SR.resolveHighlightPin(cardPin21, "74/507", "21");

const result = {
  scoreA,
  scoreB,
  scoreC,
  scoreD,
  bestUid: picked.diagram?.diagramUid ?? null,
  bestScore: picked.score,
  denseUid: pickedDense.diagram?.diagramUid ?? null,
  denseScore: pickedDense.score,
  codeOnlyUid: pickedCodeOnly.diagram?.diagramUid ?? null,
  codeOnlyScore: pickedCodeOnly.score,
  pinOnModule: pinOnModule.pin,
  pinOnJunction: pinOnJunction.pin,
  pinModuleCandidates: pinOnModule.pinCandidates,
  fromCode: pinOnModule.fromCode,
  toCode: pinOnModule.toCode,
  peerPin: pinOnModule.peerPin,
};

console.log(JSON.stringify(result, null, 2));

let ok = true;
const fail = (msg) => {
  console.error("FAIL:", msg);
  ok = false;
};

if (result.scoreA !== 100) fail(`module+connector should score 100, got ${result.scoreA}`);
if (result.scoreB !== 0) fail(`junction-only should score 0, got ${result.scoreB}`);
if (result.scoreC !== 50) fail(`module without target junction should score 50, got ${result.scoreC}`);
if (result.scoreD !== 100) fail(`family 20 + connector should score 100, got ${result.scoreD}`);
if (result.bestUid !== "uid-full") fail(`pickBest must choose full-path page, got ${result.bestUid}`);
if (result.bestScore !== 100) fail(`pickBest score must be 100, got ${result.bestScore}`);
if (result.denseUid !== "uid-module") {
  fail(`among junction+module, pickBest must choose module page, got ${result.denseUid}`);
}
if (result.denseScore !== 50) fail(`dense pick score must be 50, got ${result.denseScore}`);
if (result.codeOnlyUid !== null) {
  fail(`code-only junction context must not promote a sheet, got ${result.codeOnlyUid}`);
}
if (result.codeOnlyScore !== 0) fail(`code-only score must be 0, got ${result.codeOnlyScore}`);
if (result.pinOnModule !== "2") {
  fail(`selected module 3/126 must resolve cavity 2 from details, got ${result.pinOnModule}`);
}
if (result.pinOnJunction !== "21") {
  fail(`selected junction must keep card pin 21, got ${result.pinOnJunction}`);
}
// Selected-side candidates must NOT mix the peer/junction cavity (21) into module (2)
if (!Array.isArray(result.pinModuleCandidates) || !result.pinModuleCandidates.includes("2")) {
  fail(`module pin candidates must include 2, got ${JSON.stringify(result.pinModuleCandidates)}`);
}
if (result.pinModuleCandidates.includes("21")) {
  fail(`module pin candidates must not include peer cavity 21, got ${JSON.stringify(result.pinModuleCandidates)}`);
}
if (result.fromCode !== "3/126") {
  fail(`fromCode should be 3/126, got ${result.fromCode}`);
}
if (result.toCode !== "3/127") {
  fail(`toCode should be 3/127, got ${result.toCode}`);
}

// Pin probe must include junction-only sheets (score 0) after scored pages
const probe = SR.diagramsForPinProbe([pageB, pageC, pageA], ctx, 10);
const probeUids = probe.map((r) => r.diagram.diagramUid);
if (probeUids[0] !== "uid-full") fail(`pin probe should start with full-path page, got ${probeUids[0]}`);
if (!probeUids.includes("uid-junction")) {
  fail(`pin probe must include junction-only sheet for cavity search, got ${JSON.stringify(probeUids)}`);
}

try {
  unlinkSync(bundlePath);
} catch {
  /* ignore */
}

if (!ok) {
  console.error("SMOKE_FAIL");
  process.exit(1);
}
console.log("SMOKE_OK");
