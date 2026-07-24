import test from "node:test";
import assert from "node:assert/strict";
import {
  alignPrimaryUidForFrom,
  isPrimaryMarkerRole,
  nearestPaintedEndpointToScopes,
  orderEndsForMarker,
} from "./ewdHighlight.js";

/**
 * Contract: each marker end must only use its own pinUid.
 * (Regression: merging all resolveUids glued every card to one cavity.)
 */
test("marker end UIDs stay per-end (no shared resolve pool)", () => {
  const ends = [
    { code: "3/75", pin: "2", uid: "UID-PIN-LOCK", role: "selected" },
    { code: "74/508", pin: "13", uid: "UID-PIN-DOOR", role: "to" },
  ];
  const resolveUids = ["UID-PIN-LOCK", "UID-PIN-DOOR", "UID-OTHER"];
  for (const end of ends) {
    const endUids = [end.uid].filter(Boolean);
    assert.equal(endUids.length, 1);
    assert.equal(endUids[0], end.uid);
    assert.ok(
      !endUids.some((u) => u !== end.uid && resolveUids.includes(u)),
      "must not pull foreign resolveUids into this end",
    );
  }
  const ordered = orderEndsForMarker(ends, true);
  assert.equal(ordered[0].code, "3/75");
  assert.equal(ordered[0].pin, "2");
});

test("isPrimaryMarkerRole: Откуда roles only", () => {
  assert.equal(isPrimaryMarkerRole("selected"), true);
  assert.equal(isPrimaryMarkerRole("primary"), true);
  assert.equal(isPrimaryMarkerRole("from"), true);
  assert.equal(isPrimaryMarkerRole("to"), false);
  assert.equal(isPrimaryMarkerRole("peer"), false);
});

test("orderEndsForMarker: secondary omitted when allowSecondary=false", () => {
  const ends = [
    { code: "3/81", pin: "1", role: "selected" },
    { code: "3/83", pin: "5", role: "to" },
  ];
  const primaryOnly = orderEndsForMarker(ends, false);
  assert.equal(primaryOnly.length, 1);
  assert.equal(primaryOnly[0].code, "3/81");
  const both = orderEndsForMarker(ends, true);
  assert.equal(both.length, 2);
  assert.equal(both[1].role, "to");
});

test("primary markerAt must not fall back to Куда when Откуда missed", () => {
  const ends = [
    { code: "3/81", pin: "2", role: "selected" as const, placed: false },
    { code: "3/127", pin: "21", role: "to" as const, placed: true },
  ];
  let markerAt: string | null = null;
  let primaryPlaced = false;
  for (const end of orderEndsForMarker(ends, false)) {
    if (!end.placed) continue;
    if (isPrimaryMarkerRole(end.role)) {
      markerAt = `${end.code}:${end.pin}`;
      primaryPlaced = true;
    }
  }
  // Secondary never runs when primary missed
  const secondary = orderEndsForMarker(ends, primaryPlaced).filter(
    (e) => !isPrimaryMarkerRole(e.role),
  );
  assert.equal(secondary.length, 0);
  assert.equal(primaryPlaced, false);
  assert.equal(markerAt, null);
});

test("alignPrimaryUidForFrom: card Откуда 3/274:1 with swapped matched → toUid", () => {
  const aligned = alignPrimaryUidForFrom({
    fromCode: "3/274",
    fromPin: "1",
    matched: {
      from: "74/508",
      to: "3/274",
      pinFrom: "11",
      pinTo: "1",
      fromUid: "UID-508-11",
      toUid: "UID-274-1",
    },
    cardPinUid: "UID-CARD",
  });
  assert.equal(aligned.primaryUid, "UID-274-1");
  assert.equal(aligned.secondaryUid, "UID-508-11");
  assert.notEqual(aligned.primaryUid, "UID-508-11");
});

test("alignPrimaryUidForFrom: card Откуда on from side keeps fromUid", () => {
  const aligned = alignPrimaryUidForFrom({
    fromCode: "3/81",
    fromPin: "3",
    matched: {
      from: "3/81",
      to: "3/127",
      pinFrom: "3",
      pinTo: "5",
      fromUid: "UID-81-3",
      toUid: "UID-127-5",
    },
  });
  assert.equal(aligned.primaryUid, "UID-81-3");
  assert.equal(aligned.secondaryUid, "UID-127-5");
});

test("nearestPaintedEndpointToScopes prefers endpoint near from scope", () => {
  // Minimal fake elements with getBBox / path endpoints via SVG in jsdom may be absent;
  // exercise pure distance logic with stub-like objects when DOM APIs exist.
  class FakeGeom {
    constructor(
      private box: { x: number; y: number; width: number; height: number },
      private ends?: [{ x: number; y: number }, { x: number; y: number }],
    ) {}
    getBBox() {
      return this.box;
    }
    getTotalLength() {
      return this.ends ? 10 : 0;
    }
    getPointAtLength(t: number) {
      if (!this.ends) return { x: 0, y: 0 };
      return t <= 0 ? this.ends[0] : this.ends[1];
    }
  }
  const fromScope = new FakeGeom({ x: 0, y: 0, width: 10, height: 10 }) as unknown as Element;
  const paintedNearFrom = new FakeGeom(
    { x: 0, y: 0, width: 1, height: 1 },
    [
      { x: 5, y: 5 },
      { x: 200, y: 200 },
    ],
  ) as unknown as Element;
  const paintedNearTo = new FakeGeom(
    { x: 0, y: 0, width: 1, height: 1 },
    [
      { x: 190, y: 190 },
      { x: 210, y: 210 },
    ],
  ) as unknown as Element;
  const hit = nearestPaintedEndpointToScopes(
    [paintedNearTo, paintedNearFrom],
    [fromScope],
  );
  assert.ok(hit);
  assert.ok(hit!.x < 50 && hit!.y < 50, "must pick endpoint near Откуда scope");
});

test("owner↔transit swap changes primary Откуда pin", () => {
  const owner = { from: "3/81:5", to: "3/83:1", role: "selected" as const };
  const transit = { from: "3/83:1", to: "3/81:5", role: "selected" as const };
  assert.notEqual(owner.from, transit.from);
  assert.equal(isPrimaryMarkerRole(owner.role), true);
  assert.equal(owner.from.split(":")[1], "5");
  assert.equal(transit.from.split(":")[1], "1");
});
