# Market Math — core rules

Audience: grade 5. Learning target: decimal money, change, estimation, and
two-step problems without floating-point error.

## Canonical state

```
session = {
  version, seed, rngState, phase: "question" | "explain" | "done",
  stalls: [{id, kind, solved, stars}], index,
  question, attempts
}
question =
  | {kind: "total",   items: [{name, cents}], choices: cents[]}
  | {kind: "change",  total: cents, paid: cents, choices: cents[]}
  | {kind: "estimate", total: cents, choices: cents[]}
  | {kind: "twoStep", items: [{name, cents}], coupon: cents, choices: cents[]}
```

All money is integer cents. Conversion to a display string is a later
presentation concern and never participates in correctness.

## Operations

- `answer(choice)` submits one of the generated values.
- `explain()` shows the receipt/coin breakdown and then re-asks a nearby
  question.
- `nextStall()` is legal after the current stall is solved.

## Rules and invariants

- Generated totals stay within `$0.10–$99.99`, paid amounts are realistic
  denominations, and change is never negative.
- Choices are integer cents with exactly one correct value and distinct
  distractors generated from common off-by-one, wrong-operation, and dropped
  decimal errors.
- Estimation tasks accept the generated correct estimate band, not an exact
  cent value.
- No calculation uses floating point.

## Win and loss

All stalls solved ends the session with stars by first-try success. Wrong
answers move to the worked model without forfeiting the stall.

## Seeded behavior

One RNG stream selects stall kind, items, prices, paid amounts, and distractor
order. Deterministic given seed and action history.

## Snapshot

Store version, seed, RNG state, stall progress, current question, attempts,
stars, and phase. Validation rejects negative cents, totals outside bounds,
paid amounts below total, duplicate choices, and fractional cent values.

## Pure tests before a view

- Total, change, estimate, and two-step answer correctness in integer cents.
- Change cannot be negative and paid amounts use realistic denominations.
- Distractors are distinct and include no accidental correct duplicate.
- No float anywhere in generation or scoring.
- Wrong answer preserves the stall and transitions to the worked model.
- Snapshot round-trip and malformed-question rejection.
