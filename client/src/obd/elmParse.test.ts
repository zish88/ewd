import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeMode01Pid, decodeObdDtcWord, parseElmResponse } from "./elmParse.js";

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

  it("parses Mode 01 into signals (not live.coolantC)", () => {
    const r = parseElmResponse("41 05 5B");
    const coolant = r.signals?.find((s) => s.id === "coolant_temp");
    assert.ok(coolant);
    assert.equal(coolant?.value, 51);
    assert.equal(r.live, undefined);
  });

  it("parses RPM signal 410C", () => {
    // ((0x0C << 8) | 0xE0) / 4 = 3296 / 4 = 824
    const r = parseElmResponse("41 0C 0C E0");
    const rpm = r.signals?.find((s) => s.id === "engine_rpm");
    assert.ok(rpm);
    assert.equal(rpm?.value, 824);
  });

  it("parses combined dump", () => {
    const r = parseElmResponse("SEARCHING...\n41 05 5B\n43 04 20 00\n>");
    assert.ok(r.signals?.some((s) => s.id === "coolant_temp" && s.value === 51));
    assert.ok(r.dtcs?.some((d) => d.code === "P0420"));
  });

  it("decodeMode01Pid covers throttle", () => {
    const s = decodeMode01Pid(0x11, [0xff]);
    assert.equal(s?.id, "throttle");
    assert.equal(s?.value, 100);
  });
});
