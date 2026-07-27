import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  normalizeWiringCode,
  partImageUrl,
  resetPartImageIndexCache,
  resolvePartImageFile,
  wiringCodeFromPath,
} from "./partImageIndex.js";

test("wiringCodeFromPath reads __3-80 slug", () => {
  assert.equal(wiringCodeFromPath("vida_part_images/978305__3-80.svg"), "3/80");
  assert.equal(wiringCodeFromPath("vida_part_images/981801__3-80_85e59bc8.svg"), "3/80");
  assert.equal(wiringCodeFromPath("vida_part_images/30656635.svg"), "");
});

test("normalizeWiringCode", () => {
  assert.equal(normalizeWiringCode("3/80"), "3/80");
  assert.equal(normalizeWiringCode(" 10 / 1 "), "10/1");
});

test("resolvePartImageFile requires matching wiring code for card indicator", () => {
  const root = mkdtempSync(join(tmpdir(), "part-img-"));
  const imgDir = join(root, "data", "vida_part_images");
  mkdirSync(imgDir, { recursive: true });
  writeFileSync(join(imgDir, "30656635__10-1.svg"), "<svg></svg>");
  writeFileSync(join(imgDir, "978305__3-80.svg"), "<svg></svg>");
  writeFileSync(join(imgDir, "30656635.cgm"), "CGM");
  writeFileSync(
    join(root, "data", "vida_part_image_index.json"),
    JSON.stringify({
      parts: [
        {
          part_number: "30656635",
          files: [
            {
              path: "vida_part_images/30656635.cgm",
              mime: "CGM",
            },
            {
              path: "vida_part_images/30656635__10-1.svg",
              wiring_code: "10/1",
              mime: "image/svg+xml",
            },
          ],
        },
        {
          part_number: "978305",
          files: [
            {
              path: "vida_part_images/978305__3-80.svg",
              wiring_code: "3/80",
              mime: "image/svg+xml",
            },
          ],
        },
      ],
    }),
  );

  const prev = process.cwd();
  try {
    process.chdir(root);
    resetPartImageIndexCache(join(root, "data", "vida_part_image_index.json"));

    // Unscoped CGM must not light the indicator on a wiring card
    assert.equal(resolvePartImageFile("30656635", "3/80"), null);
    assert.equal(partImageUrl("30656635", "3/80"), null);

    assert.ok(resolvePartImageFile("30656635", "10/1"));
    assert.equal(partImageUrl("30656635", "10/1"), "/api/parts/image/30656635?code=10%2F1");

    assert.ok(resolvePartImageFile("978305", "3/80"));
    assert.equal(resolvePartImageFile("978305", "10/1"), null);
  } finally {
    process.chdir(prev);
    resetPartImageIndexCache();
    rmSync(root, { recursive: true, force: true });
  }
});
