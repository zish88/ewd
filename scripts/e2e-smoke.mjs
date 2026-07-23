/**
 * Temporary Playwright E2E smoke tester for Volvo EWD UI.
 * Usage: ensure `npm run:dev` is up, then `npm run test:e2e`
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:5173";
const REPORT_PATH = resolve("scripts/e2e-smoke-report.json");
const MAX_PDF_CLICKS = 3;

const QUICK_BUTTONS = [
  "quick-horn",
  "quick-front-left-door",
  "quick-front-right-door",
  "quick-fuses",
  "quick-engine",
  "quick-locations",
  "quick-diagram",
];

const SEARCH_QUERIES = ["16/10", "3/26", "CEM", "RD-GY", "задняя правая дверь"];

const report = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  steps: [],
  consoleErrors: [],
  pageErrors: [],
  httpErrors: [],
  pdfFailures: [],
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
  const notice = page.getByTestId("results-notice");
  await page.waitForSelector('[data-testid="results-panel"]', { timeout: 15000 });
  // Wait until notice no longer says "Загрузка"
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
  return notice;
}

async function openDiagrams(page, stepLabel, { requirePdf = false } = {}) {
  const buttons = page.getByTestId("show-on-diagram");
  const count = await buttons.count();
  if (count === 0) {
    if (requirePdf) {
      fail(`${stepLabel}/pdf`, "expected show-on-diagram buttons but found none");
      report.pdfFailures.push({ step: stepLabel, reason: "empty results" });
    } else {
      pass(`${stepLabel}/pdf`, "no show-on-diagram buttons (empty or page-less results)");
    }
    return;
  }
  const n = Math.min(MAX_PDF_CLICKS, count);
  for (let i = 0; i < n; i++) {
    await buttons.nth(i).click();
    try {
      await page.waitForSelector('[data-testid="pdf-panel"]', { timeout: 10000 });
      await page.waitForFunction(
        () => {
          const err = document.querySelector('[data-testid="pdf-error"]');
          if (err && (err.textContent || "").trim()) return "error";
          const canvas = document.querySelector('[data-testid="pdf-canvas"]');
          if (!canvas) return false;
          return canvas.width > 50 && canvas.height > 50 ? "ok" : false;
        },
        { timeout: 20000 },
      );
      const loading = page.getByTestId("pdf-loading");
      if (await loading.count()) {
        await loading.waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
      }
      const pdfErr = page.getByTestId("pdf-error");
      if (await pdfErr.count()) {
        const errText = (await pdfErr.textContent()) || "";
        if (errText.trim()) {
          fail(`${stepLabel}/pdf-${i}`, `PDF error: ${errText.trim()}`);
          report.pdfFailures.push({ step: stepLabel, index: i, reason: errText.trim() });
          continue;
        }
      }
      const bodyText = await page.locator("body").innerText();
      if (/Критическая ошибка|PDF книги недоступен|Книга не найдена/i.test(bodyText)) {
        fail(`${stepLabel}/pdf-${i}`, "PDF error text visible", { snippet: bodyText.slice(0, 200) });
        report.pdfFailures.push({ step: stepLabel, index: i, reason: "error text" });
      } else {
        pass(`${stepLabel}/pdf-${i}`, "canvas rendered");
      }
    } catch (err) {
      fail(`${stepLabel}/pdf-${i}`, String(err.message || err));
      report.pdfFailures.push({ step: stepLabel, index: i, reason: String(err.message || err) });
    }
  }
}

async function main() {
  // Health check
  try {
    const health = await fetch("http://localhost:4173/api/health");
    if (!health.ok) throw new Error(`API health ${health.status}`);
  } catch (err) {
    fail("preflight", `API not reachable on :4173 — start npm run:dev first (${err.message})`);
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
      if (
        /Uncaught|TypeError|ReferenceError|is not defined|Критическая ошибка рендеринга|Invalid page request/i.test(
          text,
        )
      ) {
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
    if (status >= 400 && (/\/api\//.test(url) || /pdf/i.test(url))) {
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
    // Engine option text may include spaces
    await page.getByTestId("vehicle-engine").selectOption({ label: "3.2 i6" });
    pass("vehicle", "XC70 / 2008 / 3.2 i6");

    for (const testId of QUICK_BUTTONS) {
      const step = `quick/${testId}`;
      try {
        await page.getByTestId(testId).click();
        await waitResultsSettled(page);
        pass(step, "results settled");
        await openDiagrams(page, step, { requirePdf: true });
        await page.getByTestId("clear-results").click().catch(() => {});
        await waitForIdle(page, 300);
      } catch (err) {
        fail(step, String(err.message || err));
      }
    }

    for (const q of SEARCH_QUERIES) {
      const step = `search/${q}`;
      try {
        await page.getByTestId("smart-search-input").fill(q);
        await page.getByTestId("smart-search-submit").click();
        await waitResultsSettled(page);
        pass(step, "results settled");
        await openDiagrams(page, step, { requirePdf: true });
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

  // Treat hard JS page errors as failure; soft console noise alone does not fail if steps passed
  if (report.pageErrors.length) report.ok = false;
  if (report.httpErrors.length) report.ok = false;
  if (report.pdfFailures.length) report.ok = false;
  if (report.steps.some((s) => s.status === "fail")) report.ok = false;

  report.finishedAt = new Date().toISOString();
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${REPORT_PATH}`);
  console.log(report.ok ? "\nE2E PASSED" : "\nE2E FAILED");
  process.exit(report.ok ? 0 : 1);
}

main();
