import test from "node:test";
import assert from "node:assert/strict";
import {
  allowWireColorFallback,
  dualHighlightSpec,
  extendPaintAlongPaintedPath,
} from "./ewdHighlight.js";

test("dualHighlightSpec: dual wire colors get solid + dashed overlay colors", () => {
  const vtOg = dualHighlightSpec("VT-OG");
  assert.ok(vtOg.primary);
  assert.ok(vtOg.secondary);
  assert.notEqual(vtOg.primary, vtOg.secondary);
  assert.equal(vtOg.dash, "6 4");
});

test("dualHighlightSpec: single color has no overlay", () => {
  const ye = dualHighlightSpec("YE");
  assert.ok(ye.primary);
  assert.equal(ye.secondary, null);
});

test("allowWireColorFallback: disabled when pin + wireUid (no foreign VT extend)", () => {
  assert.equal(
    allowWireColorFallback({
      hasPinFocus: true,
      hasUidAnchor: true,
      wireUidsLength: 1,
      paintedLength: 0,
      wireColor: "VT",
      endCodesLength: 2,
    }),
    false,
  );
});

test("allowWireColorFallback: disabled when UID paint already succeeded", () => {
  assert.equal(
    allowWireColorFallback({
      hasPinFocus: true,
      hasUidAnchor: true,
      wireUidsLength: 1,
      paintedLength: 3,
      wireColor: "VT",
      endCodesLength: 2,
    }),
    false,
  );
});

test("allowWireColorFallback: allowed only without UID anchors", () => {
  assert.equal(
    allowWireColorFallback({
      hasPinFocus: false,
      hasUidAnchor: false,
      wireUidsLength: 0,
      paintedLength: 0,
      wireColor: "VT",
      endCodesLength: 2,
    }),
    true,
  );
});

test("extendPaintAlongPaintedPath: no-op without painted seeds", () => {
  const svg = {
    getAttribute: () => "0 0 1000 1000",
  } as unknown as SVGSVGElement;
  const root = { querySelectorAll: () => [] } as unknown as Element;
  const more = extendPaintAlongPaintedPath(root, svg, "GN-RD", [], ["74/508"]);
  assert.equal(more.length, 0);
});
