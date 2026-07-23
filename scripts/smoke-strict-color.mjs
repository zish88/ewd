/**
 * Connector isolation + pin+color + wire-spec decoy rejection smoke.
 */
import { chromium } from "playwright";
import { readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const bundlePath = resolve(root, "scripts/_ewd-smoke-bundle.js");

execSync(
  `npx esbuild client/src/ewdHighlight.ts --bundle --format=iife --global-name=EWD --outfile=scripts/_ewd-smoke-bundle.js`,
  { cwd: root, stdio: "inherit" },
);

const bundle = readFileSync(bundlePath, "utf8");
// Pin 5 has BK wire nearby and BN-BU wire nearby — card BN-BU must not land on BK.
// Synthetic 99/1 has real pins 11/12; nearby wire-spec decoys 0,13 / 14014 / K413 and a foreign "11" on a conductor must not win.
const html = `<!DOCTYPE html><html><body>
<svg viewBox="0 0 20000 20000" width="800" height="600" xmlns="http://www.w3.org/2000/svg">
  <g id="conn-a">
    <text x="3000" y="4000">74/9</text>
    <text x="2800" y="4800">5</text>
    <g><desc>CAFConductor BK</desc>
      <path id="w-bk" d="M3000 4800 L8000 4800" fill="none" stroke="#111"/>
      <text x="5000" y="4785">BK</text>
    </g>
    <g><desc>CAFConductor BN-BU</desc>
      <path id="w-bn" d="M3000 4900 L8000 4900" fill="none" stroke="#854"/>
      <text x="5000" y="4885">BN-BU</text>
    </g>
  </g>
  <g id="conn-b">
    <text x="12000" y="14000">74/31</text>
    <text x="11800" y="14800">5</text>
    <g><desc>CAFConductor</desc>
      <path d="M12000 14800 L17000 14800" fill="none" stroke="#333"/>
      <text x="14000" y="14785">YE-BU</text>
    </g>
  </g>
  <g id="conn-synth">
    <text x="2000" y="9000">99/1</text>
    <text x="1900" y="9600">11</text>
    <text x="2100" y="9600">12</text>
    <!-- wire-spec decoys that used to steal pin score / anchors -->
    <text x="2600" y="9800">0,13</text>
    <text x="2800" y="10000">14014</text>
    <text x="3000" y="10200">K413</text>
    <g><desc>CAFConductor BK</desc>
      <path d="M2200 9600 L9000 11000" fill="none" stroke="#111"/>
      <text x="5500" y="10300">11</text>
      <text x="5600" y="10400">BK</text>
    </g>
  </g>
  <!-- Oversized parent: foreign module pin "4" LEFT must not steal connector pin "4" RIGHT -->
  <g id="sheet-blob">
    <g id="mod-foreign">
      <text x="1500" y="16000">3/100</text>
      <text x="1400" y="16600">4</text>
    </g>
    <g id="conn-target">
      <text x="14000" y="16000">99/2</text>
      <text x="13900" y="16600">4</text>
    </g>
  </g>
</svg>
<script>${bundle}</script>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });

const result = await page.evaluate(() => {
  const svg = document.querySelector("svg");
  const parseAt = () => {
    const t = svg.querySelector("g.pin-marker")?.getAttribute("transform") || "";
    const m = t.match(/translate\(([^,]+),([^)]+)\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };

  const rColor = EWD.highlightTarget(svg, svg, {
    connectorCode: "74/9",
    pinNumber: "5",
    wireColor: "BN-BU",
  });
  const atColor = parseAt();

  const rA = EWD.highlightTarget(svg, svg, {
    connectorCode: "74/9",
    pinNumber: "5",
    wireColor: "BN-BU",
  });
  const atA = parseAt();
  const rB = EWD.highlightTarget(svg, svg, {
    connectorCode: "74/31",
    pinNumber: "5",
    wireColor: "YE-BU",
  });
  const atB = parseAt();

  const rSynth = EWD.highlightTarget(svg, svg, {
    connectorCode: "99/1",
    pinNumber: "11",
    wireColor: "BK",
  });
  const atSynth = parseAt();
  // Real pin "11" is at ~1900,9600; conductor decoy "11" at 5500,10300
  const pin11 = { x: 1900, y: 9600 };
  const decoy11 = { x: 5500, y: 10300 };

  const rScoped = EWD.highlightTarget(svg, svg, {
    connectorCode: "99/2",
    pinNumber: "4",
    wireColor: "",
  });
  const atScoped = parseAt();
  const pinOnConn = { x: 13900, y: 16600 };
  const pinOnMod = { x: 1400, y: 16600 };

  return {
    color: { mode: rColor.debug?.anchorMode, at: atColor },
    a: { at: atA, mode: rA.debug?.anchorMode },
    b: { at: atB, mode: rB.debug?.anchorMode },
    distAB: atA && atB ? Math.hypot(atA.x - atB.x, atA.y - atB.y) : 0,
    distToBk: atColor ? Math.hypot(atColor.x - 3000, atColor.y - 4800) : Infinity,
    distToBn: atColor ? Math.hypot(atColor.x - 3000, atColor.y - 4900) : Infinity,
    decoy: {
      mode: rSynth.debug?.anchorMode,
      at: atSynth,
      distToPin: atSynth ? Math.hypot(atSynth.x - pin11.x, atSynth.y - pin11.y) : Infinity,
      distToDecoy: atSynth ? Math.hypot(atSynth.x - decoy11.x, atSynth.y - decoy11.y) : Infinity,
    },
    scoped: {
      stage: rScoped.stage,
      mode: rScoped.debug?.anchorMode,
      at: atScoped,
      distToConn: atScoped
        ? Math.hypot(atScoped.x - pinOnConn.x, atScoped.y - pinOnConn.y)
        : Infinity,
      distToMod: atScoped
        ? Math.hypot(atScoped.x - pinOnMod.x, atScoped.y - pinOnMod.y)
        : Infinity,
    },
  };
});

console.log(JSON.stringify(result, null, 2));

let ok = true;
const fail = (msg) => {
  console.error("FAIL:", msg);
  ok = false;
};

if (result.distAB < 2000) fail("connectors must not glue");
// Must prefer BN-BU wire (y=4900) over BK (y=4800)
if (result.distToBn > result.distToBk + 20 && result.color.mode === "wire-entry") {
  fail("BN-BU card snapped to BK wire");
}
if (result.color.mode === "wire-entry" && result.distToBn > 80) {
  fail("expected snap near BN-BU endpoint");
}
if (result.color.mode === "pin-terminal") {
  // acceptable if color labels not close enough — must not be on BK wire entry
  if (result.distToBk < 30 && result.distToBn > 50) fail("pin-terminal landed on BK endpoint");
}

// Wire-spec decoys must not steal the pin anchor (wire-entry near pin pad is OK)
if (result.decoy.distToPin > 450) {
  fail(`99/1:11 should land near connector pin (dist=${result.decoy.distToPin})`);
}
if (result.decoy.distToDecoy < result.decoy.distToPin * 2) {
  fail("99/1:11 landed nearer conductor decoy '11' than connector pin");
}
if (result.decoy.at && result.decoy.at.x > 4000) {
  fail("99/1:11 marker drifted into wire forest (x>4000)");
}
if (!["pin-terminal", "wire-entry", "pin-frame"].includes(result.decoy.mode)) {
  fail(`unexpected mode for 99/1:11: ${result.decoy.mode}`);
}

// Scoped connector: pin "4" on 99/2 must not land on foreign module 3/100 pin "4"
if (result.scoped.stage === "none" || !result.scoped.at) {
  fail("99/2:4 should resolve a marker on the connector");
} else if (result.scoped.distToConn > 450) {
  fail(`99/2:4 should land near connector pin (dist=${result.scoped.distToConn})`);
} else if (result.scoped.distToMod < result.scoped.distToConn) {
  fail("99/2:4 landed on foreign module pin '4' instead of connector");
}

try {
  unlinkSync(bundlePath);
} catch {
  /* ignore */
}

await browser.close();
if (!ok) {
  console.error("SMOKE_FAIL");
  process.exit(1);
}
console.log("SMOKE_OK");
