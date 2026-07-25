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

    const first = recordVisit({
      sessionId: "sessabcd12",
      path: "/",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    });
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.recorded, true);

    assert.deepEqual(recordVisit({ sessionId: "sessabcd12", path: "/" }), { ok: true, recorded: false });
    assert.deepEqual(
      recordVisit({
        sessionId: "sessother99",
        path: "/?x=1",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      }),
      { ok: true, recorded: true },
    );
    assert.equal(recordVisit({ sessionId: "x", path: "/" }).ok, false);
    assert.deepEqual(recordVisit({ sessionId: "adminsess1", path: "/admin" }), { ok: true, recorded: false });

    const stats = getVisitStats(10);
    assert.equal(stats.total, 2);
    assert.equal(stats.today, 2);
    assert.equal(stats.yesterday, 0);
    assert.equal(stats.week, 2);
    assert.equal(stats.month, 2);
    assert.equal(stats.online30m, 2);
    assert.equal(stats.recent.length, 2);
    assert.equal(stats.recent[0]?.uaLabel, "Safari 17 · macOS");
    assert.equal(stats.recent[1]?.uaLabel, "Chrome 130 · Windows");
  });
});
