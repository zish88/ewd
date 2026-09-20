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
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      acceptLanguage: "ru-RU,ru;q=0.9",
      referrer: "https://t.me/somebot",
      countryHint: "RU",
      timezone: "Europe/Moscow",
      screenW: 1920,
      screenH: 1080,
    });
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.recorded, true);

    assert.deepEqual(recordVisit({ sessionId: "sessabcd12", path: "/" }), { ok: true, recorded: false });
    assert.deepEqual(
      recordVisit({
        sessionId: "sessother99",
        path: "/?x=1",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
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
    assert.equal(stats.filtered, null);
    assert.equal(stats.recent.length, 2);
    assert.equal(stats.recent[0]?.uaLabel, "Safari 17 · macOS · desktop");
    assert.equal(stats.recent[1]?.uaLabel, "Chrome 130 · Windows · desktop");
    assert.equal(stats.recent[1]?.lang, "ru-RU");
    assert.equal(stats.recent[1]?.country, "RU");
    assert.equal(stats.recent[1]?.timezone, "Europe/Moscow");
    assert.equal(stats.recent[1]?.screen, "1920x1080");
    assert.equal(stats.recent[1]?.referrer, "t.me/somebot");

    const today = new Date().toISOString().slice(0, 10);
    const filtered = getVisitStats(10, { from: today, to: today });
    assert.equal(filtered.filtered, 2);
    assert.equal(filtered.recent.length, 2);

    const empty = getVisitStats(10, { from: "2000-01-01", to: "2000-01-02" });
    assert.equal(empty.filtered, 0);
    assert.equal(empty.recent.length, 0);
  });
});
