import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  _resetTicketGuardForTests,
  checkTicketRateLimit,
  issueTicketChallenge,
  markTicketAccepted,
  verifyTicketChallenge,
} from "./ticketGuard.js";

describe("ticketGuard", () => {
  beforeEach(() => _resetTicketGuardForTests());

  it("issues and verifies math challenge once", () => {
    const c = issueTicketChallenge();
    assert.ok(c.challenge);
    assert.equal(verifyTicketChallenge(c.challenge, String(c.a + c.b)), null);
    assert.match(verifyTicketChallenge(c.challenge, String(c.a + c.b)) || "", /использован/);
  });

  it("rejects wrong challenge answer", () => {
    const c = issueTicketChallenge();
    assert.match(verifyTicketChallenge(c.challenge, String(c.a + c.b + 1)) || "", /Неверный/);
  });

  it("rate-limits same wire and duplicate payload", () => {
    assert.equal(checkTicketRateLimit("1.1.1.1", "w1", "h1"), null);
    markTicketAccepted("1.1.1.1", "w1", "h1");
    assert.match(checkTicketRateLimit("1.1.1.1", "w1", "h2") || "", /карточке/);
    _resetTicketGuardForTests();
    assert.equal(checkTicketRateLimit("2.2.2.2", "w2", "dup"), null);
    markTicketAccepted("2.2.2.2", "w2", "dup");
    // different wire, same payload hash
    assert.match(checkTicketRateLimit("2.2.2.2", "w3", "dup") || "", /Такая же/);
  });
});
