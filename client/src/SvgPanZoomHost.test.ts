import test from "node:test";
import assert from "node:assert/strict";
import {
  schematicBaseTargetPx,
  usesCssScaleZoom,
} from "./SvgPanZoomHost.js";

test("usesCssScaleZoom: Safari desktop / iOS only", () => {
  assert.equal(
    usesCssScaleZoom(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    ),
    true,
  );
  assert.equal(
    usesCssScaleZoom(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ),
    true,
  );
  assert.equal(
    usesCssScaleZoom(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ),
    false,
  );
  assert.equal(
    usesCssScaleZoom(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ),
    false,
  );
});

test("schematicBaseTargetPx: CSS-scale path gets higher base than size-mutate", () => {
  const css = schematicBaseTargetPx(true, 1);
  const sharp = schematicBaseTargetPx(false, 1);
  assert.ok(css >= 1600, `css base ${css}`);
  assert.ok(sharp >= 1200, `sharp base ${sharp}`);
  assert.ok(css > sharp, `css ${css} should exceed sharp ${sharp}`);
});
