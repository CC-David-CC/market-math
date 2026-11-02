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
} from "../shared/core.mjs";

export const MARKET_MATH_APP_ID = "market-math";
export const MARKET_MATH_CONTENT_VERSION = "market-math-core-1";
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

  get stars() {
    return this.#state.stars;
  }

  get score() {
    return this.#state.stalls.filter(stall => stall.solved).length * 100 + this.#state.firstTry * 10;
  }

  get state() {
    return clone(this.#state);
  }

  answer(cents) {
    if (this.#state.phase !== "question") throw Error("No market question is ready.");
    if (!Number.isSafeInteger(cents)) throw Error("Money answers must be integer cents.");
    if (!this.#state.question.choices.includes(cents)) throw Error("Answer must be one of the displayed choices.");
    const firstAttempt = this.#state.attemptsForStall === 0;
    this.#state.attemptsForStall++;
    if (cents !== this.#state.question.answer) {
      this.#state.phase = "explain";
      this.#state.related = makeDifferentQuestion(this.#state.question, this.#rng);
      this.#state.rngState = this.#rng.state;
      return {correct: false, model: explainQuestion(this.#state.question), next: "continue"};
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
    const estimate = Math.ceil(total / 100) * 100;
    return withChoices({kind, items, total, answer: estimate}, rng);
  }
  const coupon = Math.min(total - 10, rng.int(10, Math.max(10, Math.floor(total / 3))));
  return withChoices({kind, items, total, coupon, answer: total - coupon}, rng);
}

function withChoices(question, rng) {
  const candidates = new Set([question.answer]);
  for (const delta of rng.shuffle([-1, 1, -10, 10, -100, 100, 5, -5])) {
    if (question.answer + delta >= 0) candidates.add(question.answer + delta);
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
  if (question.kind === "estimate") return `The exact total is ${money(question.total)}, so the nearest dollar estimate is ${money(question.answer)}.`;
  if (question.kind === "two-step") return `Subtract the ${money(question.coupon)} coupon from ${money(question.total)} to get ${money(question.answer)}.`;
  return `Add the item prices to get ${money(question.answer)}.`;
}

function money(cents) {
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function validItems(items) {
  return Array.isArray(items) && items.length >= 2 && items.length <= 3 &&
    items.every(value => exactKeys(value, ["name", "cents"]) && string(value.name, 32) && ITEM_NAMES.includes(value.name) &&
      integer(value.cents, 10, 1999));
}

function validQuestion(question) {
  if (!plainObject(question) || !["total", "change", "estimate", "two-step"].includes(question.kind) ||
      !validItems(question.items) || !integer(question.total, 20, 5997) ||
      !uniqueNumbers(question.choices, 0, 99999) || question.choices.length !== 4 ||
      !integer(question.answer, 0, 99999) || question.choices.filter(value => value === question.answer).length !== 1) return false;
  if (question.items.reduce((sum, value) => sum + value.cents, 0) !== question.total) return false;
  if (question.kind === "total") {
    return exactKeys(question, ["kind", "items", "total", "answer", "choices"]) && question.answer === question.total;
  }
  if (question.kind === "change") {
    return exactKeys(question, ["kind", "items", "total", "paid", "answer", "choices"]) &&
      integer(question.paid, question.total, 9999) && question.answer === question.paid - question.total;
  }
  if (question.kind === "estimate") {
    return exactKeys(question, ["kind", "items", "total", "answer", "choices"]) &&
      question.answer === Math.ceil(question.total / 100) * 100;
  }
  return exactKeys(question, ["kind", "items", "total", "coupon", "answer", "choices"]) &&
    integer(question.coupon, 10, question.total - 1) && question.answer === question.total - question.coupon;
}

function validatePayload(state) {
  if (!exactKeys(state, ["version", "seed", "rngState", "phase", "stalls", "index", "question", "related",
    "attemptsForStall", "firstTry", "stars"]) || state.version !== MARKET_MATH_CONTENT_VERSION ||
    typeof state.seed !== "string" || !integer(state.rngState, 0, 0xffffffff) ||
    !["question", "explain", "done"].includes(state.phase) || !Array.isArray(state.stalls) || state.stalls.length !== 12 ||
    !integer(state.index, 0, 12) || !integer(state.attemptsForStall, 0, 1000) ||
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
