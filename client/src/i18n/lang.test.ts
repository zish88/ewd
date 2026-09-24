import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectBrowserUiLang,
  detectInitialUiLang,
  browserLanguageTags,
} from "./lang.js";

describe("detectBrowserUiLang", () => {
  it("prefers ru when listed", () => {
    assert.equal(detectBrowserUiLang(["ru-RU", "en-US"], "ru-RU"), "ru");
    assert.equal(detectBrowserUiLang(["en-US", "ru"], "en-US"), "ru");
  });

  it("uses en for English browsers", () => {
    assert.equal(detectBrowserUiLang(["en-GB"], "en-GB"), "en");
    assert.equal(detectBrowserUiLang(["en"], "en"), "en");
  });

  it("maps other locales to en (international visitors)", () => {
    assert.equal(detectBrowserUiLang(["de-DE", "de"], "de-DE"), "en");
    assert.equal(detectBrowserUiLang(["sv-SE"], "sv-SE"), "en");
    assert.equal(detectBrowserUiLang(["pl-PL"], "pl"), "en");
  });

  it("defaults to ru when empty", () => {
    assert.equal(detectBrowserUiLang([], ""), "ru");
    assert.equal(detectBrowserUiLang(undefined, undefined), "ru");
  });
});

describe("detectInitialUiLang", () => {
  it("honors ?lang= over storage and browser", () => {
    assert.equal(
      detectInitialUiLang({
        search: "?lang=en",
        stored: "ru",
        languages: ["ru-RU"],
        language: "ru-RU",
      }),
      "en",
    );
  });

  it("honors stored over browser", () => {
    assert.equal(
      detectInitialUiLang({
        search: "",
        stored: "en",
        languages: ["ru-RU"],
        language: "ru-RU",
      }),
      "en",
    );
  });

  it("falls back to browser when no query/storage", () => {
    assert.equal(
      detectInitialUiLang({
        search: "",
        stored: null,
        languages: ["en-US"],
        language: "en-US",
      }),
      "en",
    );
  });
});

describe("browserLanguageTags", () => {
  it("dedupes and lowercases", () => {
    assert.deepEqual(browserLanguageTags(["en-US", "en-US", "RU"], "en-US"), ["en-us", "ru"]);
  });
});
