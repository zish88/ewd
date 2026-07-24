/**
 * Playwright E2E smoke for Capital EWD UI (no PDF).
 * Usage: ensure `npm run:dev` is up, then `npm run test:e2e`
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:5173";
const API_URL = process.env.E2E_API_URL || "http://localhost:4173";
const REPORT_PATH = resolve("scripts/e2e-smoke-report.json");
const MAX_DIAGRAM_CLICKS = 3;

/** Reference codes from Capital FaceView golden set */
const GOLDEN_CODES = ["74/507", "4/83", "3/74", "15/36", "16/10"];

const report = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  steps: [],
  consoleErrors: [],
  pageErrors: [],
  httpErrors: [],
  diagramFailures: [],
  ok: true,
};

function fail(step, message, extra = {}) {
  report.ok = false;
  report.steps.push({ step, status: "fail", message, ...extra });
  console.error(`✗ ${step}: ${message}`);
}

function pass(step, message = "ok") {
  report.steps.push({ step, status: "pass", message });
  console.log(`✓ ${step}: ${message}`);
}

async function waitForIdle(page, ms = 800) {
  await page.waitForTimeout(ms);
  try {
    await page.waitForLoadState("networkidle", { timeout: 5000 });
  } catch {
    /* ignore */
  }
}

async function waitResultsSettled(page) {
  await page.waitForSelector('[data-testid="results-panel"]', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="results-notice"]');
      if (!el) return false;
      const t = el.textContent || "";
      return !t.includes("Загрузка");
    },
    { timeout: 20000 },
  );
  await waitForIdle(page, 400);
}

async function openDiagrams(page, stepLabel, { requireDiagram = false } = {}) {
  const buttons = page.getByTestId("show-on-diagram");
  const count = await buttons.count();
  if (count === 0) {
    if (requireDiagram) {
      fail(`${stepLabel}/diagram`, "expected show-on-diagram buttons but found none");
      report.diagramFailures.push({ step: stepLabel, reason: "empty results" });
    } else {
      pass(`${stepLabel}/diagram`, "no show-on-diagram buttons");
    }
    return;
  }
  const n = Math.min(MAX_DIAGRAM_CLICKS, count);
  for (let i = 0; i < n; i++) {
    await buttons.nth(i).click();
    try {
      await page.waitForSelector('[data-testid="svg-panel"]', { timeout: 12000 });
      const notice = (await page.getByTestId("results-notice").textContent().catch(() => "")) || "";
      if (/не найдена|pin-miss|Контакт не найден/i.test(notice) && !/пробуем следующий/i.test(notice)) {
        // Soft warn — still count as opened if svg-panel present
        report.steps.push({
          step: `${stepLabel}/diagram-${i}`,
          status: "warn",
          message: notice.slice(0, 160),
        });
      }
      pass(`${stepLabel}/diagram-${i}`, "svg panel open");
    } catch (err) {
      fail(`${stepLabel}/diagram-${i}`, String(err.message || err));
      report.diagramFailures.push({ step: stepLabel, index: i, reason: String(err.message || err) });
    }
  }
}

async function openFaceView(page, stepLabel) {
  const btn = page.getByTestId("show-faceview").first();
  if (!(await btn.count())) {
    pass(`${stepLabel}/faceview`, "no FaceView button");
    return;
  }
  await btn.click();
  try {
    await page.waitForSelector('[data-testid="capital-panel"], [data-testid="capital-panel-host"]', {
      timeout: 10000,
    });
    pass(`${stepLabel}/faceview`, "capital panel open");
  } catch (err) {
    fail(`${stepLabel}/faceview`, String(err.message || err));
  }
}

async function selectNavCode(page, code) {
  await page.getByTestId("nav-zone").selectOption("all").catch(() => {});
  await page.getByTestId("nav-component").selectOption(code);
  await waitResultsSettled(page);
}

async function main() {
  try {
    const health = await fetch(`${API_URL}/api/health`);
    if (!health.ok) throw new Error(`API health ${health.status}`);
    const body = await health.json();
    if (!body.capitalOnly && body.pdfExists) {
      report.steps.push({
        step: "preflight",
        status: "warn",
        message: "health still reports PDF — Capital upgrade incomplete?",
      });
    }
    if (body.faceViewIndex === false || body.ewdSourceExists === false) {
      throw new Error(`Capital EWD unhealthy: ${JSON.stringify(body)}`);
    }
    pass("preflight", `health ok components=${body.counts?.components} wires=${body.counts?.wires}`);
  } catch (err) {
    fail("preflight", `API not reachable on ${API_URL} — start npm run:dev first (${err.message})`);
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      report.consoleErrors.push({ text });
      if (/Uncaught|TypeError|ReferenceError|is not defined|Критическая ошибка/i.test(text)) {
        report.ok = false;
        console.error("console error:", text.slice(0, 200));
      }
    }
  });
  page.on("pageerror", (err) => {
    report.pageErrors.push(String(err));
    report.ok = false;
    console.error("pageerror:", err.message);
  });
  page.on("dialog", async (dialog) => {
    report.steps.push({ step: "dialog", status: "warn", message: dialog.message() });
    await dialog.dismiss();
  });
  page.on("response", (response) => {
    const url = response.url();
    const status = response.status();
    if (status >= 400 && /\/api\//.test(url)) {
      report.httpErrors.push({ url, status });
      report.ok = false;
      console.error(`HTTP ${status} ${url}`);
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    pass("goto", BASE_URL);

    await page.getByTestId("vehicle-model").selectOption("XC70");
    await page.getByTestId("vehicle-year").selectOption("2008");
    await page.getByTestId("vehicle-engine").selectOption({ label: "3.2 i6" });
    pass("vehicle", "XC70 / 2008 / 3.2 i6");

    for (const code of GOLDEN_CODES) {
      const step = `golden/${code}`;
      try {
        await selectNavCode(page, code);
        pass(step, "wires loaded");
        await openDiagrams(page, step, { requireDiagram: true });
        await openFaceView(page, step);
        await page.getByTestId("clear-results").click().catch(() => {});
        await waitForIdle(page, 300);
      } catch (err) {
        fail(step, String(err.message || err));
      }
    }
  } catch (err) {
    fail("fatal", String(err.message || err));
  } finally {
    await browser.close();
  }

  if (report.pageErrors.length) report.ok = false;
  if (report.httpErrors.length) report.ok = false;
  if (report.diagramFailures.length) report.ok = false;
  if (report.steps.some((s) => s.status === "fail")) report.ok = false;

  report.finishedAt = new Date().toISOString();
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${REPORT_PATH}`);
  console.log(report.ok ? "\nE2E PASSED" : "\nE2E FAILED");
  process.exit(report.ok ? 0 : 1);
}

main();
