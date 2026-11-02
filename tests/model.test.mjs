import assert from "node:assert/strict";
import test from "node:test";
import {MarketMathSession} from "../model.mjs";

function solve(session) {
  while (session.phase !== "done") {
    if (session.phase === "explain") {
      session.continueAfterMiss();
      continue;
    }
    session.answer(session.question.answer);
  }
}

test("all money questions use bounded integer cents and one correct choice", () => {
  for (let seed = 0; seed < 50; seed++) {
    const session = new MarketMathSession(`market-${seed}`);
    while (session.phase !== "done") {
      const question = session.question;
      assert.ok(Number.isSafeInteger(question.answer));
      assert.equal(question.choices.filter(value => value === question.answer).length, 1);
      assert.equal(new Set(question.choices).size, 4);
      assert.equal(question.items.reduce((sum, item) => sum + item.cents, 0), question.total);
      session.answer(question.answer);
    }
  }
});

test("change is never negative and two-step coupons stay below the total", () => {
  for (let seed = 0; seed < 80; seed++) {
    const session = new MarketMathSession(`change-${seed}`);
    while (session.phase !== "done") {
      const question = session.question;
      if (question.kind === "change") {
        assert.ok(question.paid >= question.total);
        assert.equal(question.answer, question.paid - question.total);
      }
      if (question.kind === "two-step") assert.ok(question.coupon < question.total);
      session.answer(question.answer);
    }
  }
});

test("wrong answers preserve the stall and re-ask the same kind", () => {
  const session = new MarketMathSession("marker");
  const index = session.index, kind = session.question.kind;
  const wrong = session.question.choices.find(value => value !== session.question.answer);
  assert.equal(session.answer(wrong).correct, false);
  assert.equal(session.index, index);
  session.continueAfterMiss();
  assert.equal(session.question.kind, kind);
});

test("a complete market ends once with stars and score", () => {
  const session = new MarketMathSession("market-complete");
  solve(session);
  assert.equal(session.phase, "done");
  assert.equal(session.stars, 3);
  assert.ok(session.score > 0);
  assert.throws(() => session.answer(0));
});

test("seeded state and snapshot restore the exact cents", () => {
  const one = new MarketMathSession("market-snapshot");
  const two = new MarketMathSession("market-snapshot");
  assert.deepEqual(one.state, two.state);
  one.answer(one.question.answer);
  two.answer(two.question.answer);
  const restored = MarketMathSession.fromSave(two.encodeSave());
  assert.deepEqual(restored.state, two.state);
  restored.answer(restored.question.answer);
  two.answer(two.question.answer);
  assert.deepEqual(restored.state, two.state);
});

test("negative, fractional, duplicate, and malformed saves are rejected", () => {
  const session = new MarketMathSession("market-invalid");
  const valid = JSON.parse(session.encodeSave());
  for (const mutate of [
    value => { value.payload.question.answer = -1; },
    value => { value.payload.question.choices[1] = value.payload.question.choices[0]; },
    value => { value.payload.question.total += 1; },
    value => { value.payload.index = 12; },
  ]) {
    const broken = structuredClone(valid);
    mutate(broken);
    assert.throws(() => MarketMathSession.fromSave(JSON.stringify(broken)));
  }
});
