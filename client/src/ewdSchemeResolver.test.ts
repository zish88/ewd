import test from "node:test";
import assert from "node:assert/strict";
import { cardFocusContact, resolveHighlightPin } from "./ewdSchemeResolver.js";

test("cardFocusContact: owner primary is Откуда (from_detail)", () => {
  const focus = cardFocusContact(
    {
      match_role: "owner",
      subject_code: "74/508",
      pin_number: "13",
      from_detail: "74/508:13 — Разъём",
      to_detail: "4/93:22 — KVM",
    },
    "74/508",
  );
  assert.equal(focus.code, "74/508");
  assert.equal(focus.pin, "13");
});

test("cardFocusContact: owner Откуда not peer Куда (10/289:2)", () => {
  const focus = cardFocusContact(
    {
      match_role: "owner",
      subject_code: "74/508",
      pin_number: "10",
      from_detail: "74/508:10 — Разъём",
      to_detail: "10/289:2 — Динамик",
    },
    "74/508",
  );
  assert.equal(focus.code, "74/508");
  assert.equal(focus.pin, "10");
});

test("cardFocusContact: 3/81:2→3/127:21 marks Откуда pin 2 not Куда 21", () => {
  const focus = cardFocusContact(
    {
      match_role: "owner",
      subject_code: "3/81",
      pin_number: "2",
      from_detail: "3/81:2 — Электроника, стеклоподъемник, левый передний",
      to_detail: "3/127:21 — Модуль двери пассажира (PDM)",
    },
    "3/81",
  );
  assert.equal(focus.code, "3/81");
  assert.equal(focus.pin, "2");
});

test("cardFocusContact: transit primary is Откуда even when subject is elsewhere", () => {
  const focus = cardFocusContact(
    {
      match_role: "transit",
      subject_code: "3/81",
      pin_number: "1",
      from_detail: "3/83:1 — Электроника, стеклоподъемник, правый передний",
      to_detail: "3/81:5 — Электроника, стеклоподъемник, левый передний",
    },
    "3/81",
  );
  assert.equal(focus.code, "3/83");
  assert.equal(focus.pin, "1");
});

test("cardFocusContact: never takes pin from to_detail when from empty", () => {
  const focus = cardFocusContact(
    {
      match_role: "owner",
      from_node: "3/81",
      pin_number: "5",
      to_detail: "3/83:1 — peer",
    },
    "3/81",
  );
  assert.equal(focus.code, "3/81");
  assert.equal(focus.pin, "5");
});

test("resolveHighlightPin still exposes both ends for dual markers", () => {
  const r = resolveHighlightPin(
    {
      from_detail: "3/75:2 — Замок",
      to_detail: "74/508:13 — Разъём",
      pin_number: "2",
    },
    "74/508",
    "2",
  );
  assert.equal(r.pin, "13");
  assert.equal(r.peerCode, "3/75");
  assert.equal(r.peerPin, "2");
  assert.equal(r.fromCode, "3/75");
  assert.equal(r.pinFrom, "2");
  assert.equal(r.toCode, "74/508");
  assert.equal(r.pinTo, "13");
});
