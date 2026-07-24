import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _closeVisitsDbForTests, getVisitStats, recordVisit } from "./visits.js";

const dir = join(tmpdir(), `ewd-visits-${process.pid}-${Date.now()}`);

describe("visits", () => {
  after(() => {
    _closeVisitsDbForTests();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.VISITS_DATABASE_PATH;
  });

  it("records once per session within 30 minutes and aggregates counts", () => {
    mkdirSync(dir, { recursive: true });
    process.env.VISITS_DATABASE_PATH = join(dir, "visits.sqlite");

    const first = recordVisit({ sessionId: "sessabcd12", path: "/" });
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.recorded, true);

    assert.deepEqual(recordVisit({ sessionId: "sessabcd12", path: "/" }), { ok: true, recorded: false });
    assert.deepEqual(recordVisit({ sessionId: "sessother99", path: "/?x=1" }), { ok: true, recorded: true });
    assert.equal(recordVisit({ sessionId: "x", path: "/" }).ok, false);
    assert.deepEqual(recordVisit({ sessionId: "adminsess1", path: "/admin" }), { ok: true, recorded: false });

    const stats = getVisitStats(10);
    assert.equal(stats.total, 2);
    assert.equal(stats.day, 2);
    assert.equal(stats.week, 2);
    assert.equal(stats.month, 2);
    assert.equal(stats.recent.length, 2);
  });
});
