import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeSmtpPass, formatSmtpError } from "./smtpMail.js";

describe("smtpMail", () => {
  it("strips spaces, hyphens and CR from app password", () => {
    assert.equal(normalizeSmtpPass("pszn-uxxw-epcy-gxhs"), "psznuxxwepcygxhs");
    assert.equal(normalizeSmtpPass("pszn uxxw epcy gxhs"), "psznuxxwepcygxhs");
    assert.equal(normalizeSmtpPass("psznuxxwepcygxhs\r"), "psznuxxwepcygxhs");
  });

  it("formats errors without dumping secrets", () => {
    const msg = formatSmtpError({
      code: "EAUTH",
      responseCode: 535,
      message: "Invalid login pass=secret123",
    });
    assert.match(msg, /EAUTH/);
    assert.doesNotMatch(msg, /secret123/);
  });
});
