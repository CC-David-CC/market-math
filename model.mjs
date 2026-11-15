import {
  SeededRng,
  clone,
  decodeSave,
  encodeSave,
  exactKeys,
  integer,
  plainObject,
  string,
  uniqueNumbers,
} from "@webos/learning-game-core/core";
import {makeLearningReport} from "@webos/learning-game-core/experience";

export const MARKET_MATH_APP_ID = "market-math";
export const MARKET_MATH_CONTENT_VERSION = "market-math-core-2";
const STALL_KINDS = ["total", "change", "estimate", "two-step", "total", "change", "estimate", "two-step", "total", "change", "estimate", "two-step"];
const ITEM_NAMES = ["pencil", "eraser", "notebook", "apple", "juice", "paint", "brush", "poster"];

export class MarketMathSession {
  #state;
  #rng;

  constructor(seed) {
    if (plainObject(seed) && Array.isArray(seed.stalls)) {
      validatePayload(seed);
      this.#state = clone(seed);
      this.#rng = SeededRng.fromState(seed.rngState);
      return;
    }
    const rng = new SeededRng(seed);
    const state = {
      version: MARKET_MATH_CONTENT_VERSION,
      seed: String(seed),
      rngState: 0,
      phase: "question",
      stalls: STALL_KINDS.map(kind => ({kind, solved: false, firstTry: false})),
      index: 0,
      question: null,
      related: null,
      attemptsForStall: 0,
      attempts: 0,
      firstTry: 0,
      stars: 0,
    };
    state.question = makeQuestion(state.stalls[0].kind, rng);
    state.rngState = rng.state;
    this.#state = state;
    this.#rng = rng;
  }

  static fromSave(text) {
    return new MarketMathSession(decodeSave(text, MARKET_MATH_APP_ID, MARKET_MATH_CONTENT_VERSION, validatePayload));
  }

  get phase() {
    return this.#state.phase;
  }

  get index() {
    return this.#state.index;
  }

  get question() {
    return clone(this.#state.question);
  }

  get related() {
    return clone(this.#state.related);
  }

  get breakdown() {
    return this.#state.question ? marketBreakdown(this.#state.question) : null;
  }

  get stars() {
    return this.#state.stars;
  }

  get score() {
    return this.#state.stalls.filter(stall => stall.solved).length * 100 + this.#state.firstTry * 10;
  }

  get state() {
    return clone(this.#state);
  }

  get report() {
    return makeLearningReport({
      appId: MARKET_MATH_APP_ID,
      audience: "grade-5",
      phase: this.#state.phase,
      stars: this.#state.stars,
      score: this.score,
      firstTry: this.#state.firstTry,
      attempts: this.#state.attempts,
      hintsUsed: 0,
      remaining: this.#state.stalls.length - this.#state.index,
      objectives: ["Solve totals, change, estimates, and two-step money problems."],
      details: {stallsSolved: this.#state.stalls.filter(stall => stall.solved).length},
    });
  }

  answer(cents) {
    if (this.#state.phase !== "question") throw Error("No market question is ready.");
    const question = this.#state.question;
    if (question.kind === "estimate") {
      if (!validBand(cents)) throw Error("Estimate answers must be a cent band.");
      if (!question.choices.some(band => sameBand(band, cents))) throw Error("Answer must be one of the displayed choices.");
    } else {
      if (!Number.isSafeInteger(cents)) throw Error("Money answers must be integer cents.");
      if (!question.choices.includes(cents)) throw Error("Answer must be one of the displayed choices.");
    }
    const firstAttempt = this.#state.attemptsForStall === 0;
    this.#state.attemptsForStall++;
    this.#state.attempts++;
    const correct = question.kind === "estimate" ? sameBand(cents, question.answer) : cents === question.answer;
    if (!correct) {
      this.#state.phase = "explain";
      this.#state.related = makeDifferentQuestion(question, this.#rng);
      this.#state.rngState = this.#rng.state;
      return {correct: false, model: explainQuestion(question), next: "continue"};
    }
    this.#state.stalls[this.#state.index] = {
      ...this.#state.stalls[this.#state.index],
      solved: true,
      firstTry: firstAttempt,
    };
    if (firstAttempt) this.#state.firstTry++;
    this.#state.index++;
    this.#state.attemptsForStall = 0;
    this.#state.question = null;
    this.#state.related = null;
    if (this.#state.index === this.#state.stalls.length) {
      this.#state.phase = "done";
      this.#state.stars = this.#state.firstTry >= 10 ? 3 : this.#state.firstTry >= 7 ? 2 : 1;
    } else {
      this.#state.question = makeQuestion(this.#state.stalls[this.#state.index].kind, this.#rng);
      this.#state.rngState = this.#rng.state;
    }
    return {correct: true, done: this.#state.phase === "done", stars: this.#state.stars};
  }

  continueAfterMiss() {
    if (this.#state.phase !== "explain" || !this.#state.related) throw Error("No market explanation is active.");
    this.#state.question = this.#state.related;
    this.#state.related = null;
    this.#state.phase = "question";
  }

  encodeSave() {
    this.#state.rngState = this.#rng.state;
    return encodeSave(MARKET_MATH_APP_ID, clone(this.#state), MARKET_MATH_CONTENT_VERSION);
  }
}

function item(rng) {
  return {name: rng.pick(ITEM_NAMES), cents: rng.int(25, 1999)};
}

function makeQuestion(kind, rng) {
  const count = rng.int(2, 3);
  const items = Array.from({length: count}, () => item(rng));
  const total = items.reduce((sum, value) => sum + value.cents, 0);
  if (kind === "total") return withChoices({kind, items, total, answer: total}, rng);
  if (kind === "change") {
    const paid = Math.min(9999, Math.ceil((total + 25) / 500) * 500);
    return withChoices({kind, items, total, paid, answer: paid - total}, rng);
  }
  if (kind === "estimate") {
    const answer = {lower: Math.max(0, Math.floor(total / 100) * 100), upper: Math.min(9999, Math.floor(total / 100) * 100 + 99)};
    const values = [answer];
    for (const offset of rng.shuffle([-200, -100, 100, 200, -300, 300])) {
      const lower = answer.lower + offset;
      if (lower < 0 || lower > 9900) continue;
      const candidate = {lower, upper: lower + 99};
      if (!values.some(value => sameBand(value, candidate)) && values.length < 4) values.push(candidate);
    }
    for (let step = 1; values.length < 4; step++) {
      const lower = answer.lower + step * 500;
      if (lower <= 9900) {
        const candidate = {lower, upper: lower + 99};
        if (!values.some(value => sameBand(value, candidate))) values.push(candidate);
      }
    }
    if (values.length !== 4) throw Error("Could not generate estimate bands.");
    return {kind, items, total, answer, choices: rng.shuffle(values)};
  }
  const coupon = Math.min(total - 10, rng.int(10, Math.max(10, Math.floor(total / 3))));
  return withChoices({kind, items, total, coupon, answer: total - coupon}, rng);
}

function withChoices(question, rng) {
  const candidates = new Set([question.answer]);
  const wrongOperation = [];
  if (question.kind === "total") {
    const smallest = Math.min(...question.items.map(value => value.cents));
    wrongOperation.push(question.total - smallest, question.total + smallest);
  } else if (question.kind === "change") {
    wrongOperation.push(question.total, question.paid + question.answer);
  } else if (question.kind === "two-step") {
    wrongOperation.push(question.total + question.coupon, question.total - question.coupon - 1);
  }
  for (const candidate of wrongOperation) {
    if (Number.isSafeInteger(candidate) && candidate >= 0 && candidate !== question.answer) candidates.add(candidate);
    if (candidates.size === 4) break;
  }
  for (const delta of rng.shuffle([-1, 1, -10, 10, -100, 100, 5, -5])) {
    const candidate = question.answer + delta;
    if (candidate >= 0 && candidate !== question.answer) candidates.add(candidate);
    if (candidates.size === 4) break;
  }
  return {...question, choices: rng.shuffle([...candidates])};
}

function makeDifferentQuestion(previous, rng) {
  for (let count = 0; count < 30; count++) {
    const question = makeQuestion(previous.kind, rng);
    if (JSON.stringify(question) !== JSON.stringify(previous)) return question;
  }
  throw Error("Could not generate a related market question.");
}

function explainQuestion(question) {
  if (question.kind === "change") return `Pay ${money(question.paid)} for a ${money(question.total)} total; change is ${money(question.answer)}.`;
  if (question.kind === "estimate") return `The exact total is ${money(question.total)}, so the right dollar band is ${money(question.answer.lower)}–${money(question.answer.upper)}.`;
  if (question.kind === "two-step") return `Subtract the ${money(question.coupon)} coupon from ${money(question.total)} to get ${money(question.answer)}.`;
  return `Add the item prices to get ${money(question.answer)}.`;
}

function money(cents) {
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function marketBreakdown(question) {
  const coins = changeCoins(question.kind === "change" || question.kind === "two-step" ? question.answer : 0);
  if (question.kind === "total") {
    return {kind: question.kind, items: clone(question.items), total: question.total,
      steps: [{label: "sum", cents: question.total}], coins};
  }
  if (question.kind === "change") {
    return {kind: question.kind, items: clone(question.items), total: question.total,
      steps: [{label: "paid", cents: question.paid}, {label: "change", cents: question.answer}],
      coins: changeCoins(question.answer)};
  }
  if (question.kind === "estimate") {
    return {kind: question.kind, items: clone(question.items), total: question.total,
      band: clone(question.answer), steps: [], coins};
  }
  return {kind: question.kind, items: clone(question.items), total: question.total,
    steps: [{label: "coupon", cents: question.coupon}, {label: "after coupon", cents: question.answer}],
    coins: changeCoins(question.answer)};
}

function changeCoins(cents) {
  const denominations = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 1];
  const coins = [];
  let remaining = cents;
  for (const denomination of denominations) {
    const count = Math.floor(remaining / denomination);
    if (count > 0) {
      coins.push({cents: denomination, count});
      remaining -= count * denomination;
    }
  }
  if (remaining !== 0) throw Error("Coin breakdown did not cover the amount.");
  return coins;
}

function validBand(value) {
  return exactKeys(value, ["lower", "upper"]) && integer(value.lower, 0, 9900) &&
    integer(value.upper, value.lower, 9999);
}

function sameBand(left, right) {
  return left.lower === right.lower && left.upper === right.upper;
}

function validItems(items) {
  return Array.isArray(items) && items.length >= 2 && items.length <= 3 &&
    items.every(value => exactKeys(value, ["name", "cents"]) && string(value.name, 32) && ITEM_NAMES.includes(value.name) &&
      integer(value.cents, 10, 1999));
}

function validQuestion(question) {
  if (!plainObject(question) || !["total", "change", "estimate", "two-step"].includes(question.kind) ||
      !validItems(question.items) || !integer(question.total, 20, 5997) || !Array.isArray(question.choices) ||
      question.choices.length !== 4) return false;
  if (question.items.reduce((sum, value) => sum + value.cents, 0) !== question.total) return false;
  if (question.kind === "total") {
    return exactKeys(question, ["kind", "items", "total", "answer", "choices"]) &&
      uniqueNumbers(question.choices, 0, 99999) && integer(question.answer, 0, 99999) &&
      question.choices.filter(value => value === question.answer).length === 1 && question.answer === question.total;
  }
  if (question.kind === "change") {
    return exactKeys(question, ["kind", "items", "total", "paid", "answer", "choices"]) &&
      uniqueNumbers(question.choices, 0, 99999) && integer(question.paid, question.total, 9999) &&
      integer(question.answer, 0, 99999) && question.choices.filter(value => value === question.answer).length === 1 &&
      question.answer === question.paid - question.total;
  }
  if (question.kind === "estimate") {
    return exactKeys(question, ["kind", "items", "total", "answer", "choices"]) &&
      validBand(question.answer) && question.choices.every(validBand) &&
      question.choices.filter(band => sameBand(band, question.answer)).length === 1 &&
      question.total >= question.answer.lower && question.total <= question.answer.upper;
  }
  if (!uniqueNumbers(question.choices, 0, 99999) || !integer(question.answer, 0, 99999) ||
      question.choices.filter(value => value === question.answer).length !== 1) return false;
  return exactKeys(question, ["kind", "items", "total", "coupon", "answer", "choices"]) &&
    uniqueNumbers(question.choices, 0, 99999) && integer(question.coupon, 10, question.total - 1) &&
    integer(question.answer, 0, 99999) && question.choices.filter(value => value === question.answer).length === 1 &&
    question.answer === question.total - question.coupon;
}

function validatePayload(state) {
  if (!exactKeys(state, ["version", "seed", "rngState", "phase", "stalls", "index", "question", "related",
    "attemptsForStall", "attempts", "firstTry", "stars"]) || state.version !== MARKET_MATH_CONTENT_VERSION ||
    typeof state.seed !== "string" || !integer(state.rngState, 0, 0xffffffff) ||
    !["question", "explain", "done"].includes(state.phase) || !Array.isArray(state.stalls) || state.stalls.length !== 12 ||
    !integer(state.index, 0, 12) || !integer(state.attemptsForStall, 0, 1000) || !integer(state.attempts, 0, 10000) ||
    !integer(state.firstTry, 0, 12) || !integer(state.stars, 0, 3)) throw Error("Invalid Market Math snapshot.");
  state.stalls.forEach((stall, index) => {
    if (!exactKeys(stall, ["kind", "solved", "firstTry"]) || stall.kind !== STALL_KINDS[index] ||
        typeof stall.solved !== "boolean" || typeof stall.firstTry !== "boolean") throw Error("Invalid Market Math stall.");
  });
  if (state.phase === "done") {
    if (state.index !== 12 || !state.stalls.every(stall => stall.solved) || state.question !== null || state.related !== null) {
      throw Error("Invalid completed Market Math state.");
    }
  } else if (state.phase === "question") {
    if (state.index >= 12 || !validQuestion(state.question) || state.question.kind !== state.stalls[state.index].kind ||
        state.related !== null) throw Error("Invalid active Market Math question.");
  } else if (state.index >= 12 || !validQuestion(state.question) || !validQuestion(state.related) ||
      state.question.kind !== state.related.kind) throw Error("Invalid related Market Math question.");
}
