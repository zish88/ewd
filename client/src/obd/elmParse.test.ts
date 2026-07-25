import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeObdDtcWord, parseElmResponse } from "./elmParse.js";

describe("elmParse", () => {
  it("decodeObdDtcWord maps common P-codes", () => {
    assert.equal(decodeObdDtcWord(0x01, 0x33), "P0133");
    assert.equal(decodeObdDtcWord(0x04, 0x20), "P0420");
  });

  it("parses Mode 03 DTC list 43 …", () => {
    const r = parseElmResponse("43 01 33 00\r\n>");
    assert.equal(r.device, "elm327");
    assert.equal(r.ecus?.[0]?.online, true);
    assert.ok(r.dtcs?.some((d) => d.code === "P0133"));
  });

  it("parses coolant 4105", () => {
    // 0x5B = 91 → 51°C
    const r = parseElmResponse("41 05 5B");
    assert.equal(r.live?.coolantC, 51);
  });

  it("parses combined dump", () => {
    const r = parseElmResponse("SEARCHING...\n41 05 5B\n43 04 20 00\n>");
    assert.equal(r.live?.coolantC, 51);
    assert.ok(r.dtcs?.some((d) => d.code === "P0420"));
  });
});
