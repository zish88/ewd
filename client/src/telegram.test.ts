import assert from "node:assert/strict";
import test from "node:test";
import { hasTelegramLaunchParams, isTelegramMiniApp, type TelegramWebApp } from "./telegram.js";

function withTelegram(initData: string, run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const app: TelegramWebApp = {
    initData,
    themeParams: {},
    ready() {},
    expand() {},
    onEvent() {},
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { Telegram: { WebApp: app } },
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("WebApp object without initData is not a Telegram Mini App", () => {
  withTelegram("", () => assert.equal(isTelegramMiniApp(), false));
});

test("non-empty initData identifies a Telegram Mini App", () => {
  withTelegram("query_id=abc&auth_date=123&hash=def", () => assert.equal(isTelegramMiniApp(), true));
});

test("Telegram SDK is requested only for Telegram launch parameters", () => {
  assert.equal(hasTelegramLaunchParams({ search: "", hash: "" }), false);
  assert.equal(hasTelegramLaunchParams({ search: "?tgWebAppPlatform=android", hash: "" }), true);
  assert.equal(hasTelegramLaunchParams({ search: "", hash: "#tgWebAppData=query_id%3Dabc" }), true);
});
