import { beforeEach, describe, expect, it } from "vitest";
import {
  InvalidWeightsError,
  parseWeights,
  rankCaller,
  requireWeights,
  resetWeights,
  setWeights,
  WeightsNotLoadedError,
  type RankWeights,
  type SettledCall,
} from "../app/scoring.js";

// A plausible weight set for testing ONLY. The production values are provisioned
// encrypted at runtime and are not in this repo — that is the entire point of the
// design, and a fixture here is not a leak of anything real.
const TEST_WEIGHTS: RankWeights = {
  hitRate: 1,
  meanReturn: 1,
  consistency: 1,
  recency: 1,
  conviction: 1,
  contradictionPenalty: 0.5,
  priorStrength: 10,
  returnClampBps: 5000,
  recencyHalfLifeDays: 90,
};

const DAY = 86_400;
const T0 = 1_755_100_000;

function call(overrides: Partial<SettledCall> = {}): SettledCall {
  return {
    pnlBps: 500,
    postedAt: T0 - 7 * DAY,
    settledAt: T0,
    confidenceBps: 8000,
    contradicted: false,
    ...overrides,
  };
}

beforeEach(() => resetWeights());

describe("weights are never implicit", () => {
  /**
   * The load-bearing test for the confidential-compute claim. If ranking silently fell
   * back to a built-in default, the extension would be producing scores under weights
   * that are public (the image is open source and reproducibly built) while still
   * signing them as confidential output. Failing closed is the only honest behaviour.
   */
  it("refuses to rank before weights are provisioned", () => {
    expect(() => requireWeights()).toThrow(WeightsNotLoadedError);
  });

  it("ranks once weights are provisioned", () => {
    setWeights(TEST_WEIGHTS);
    expect(() => requireWeights()).not.toThrow();
  });
});

describe("parseWeights", () => {
  it("accepts a well-formed weight set", () => {
    expect(parseWeights(JSON.stringify(TEST_WEIGHTS))).toEqual(TEST_WEIGHTS);
  });

  // Coercing bad input would produce NaN scores that an attested machine then signs and
  // writes on-chain — an authentic signature over garbage, which is worse than an error.
  it("rejects malformed input rather than coercing it", () => {
    expect(() => parseWeights("not json")).toThrow(InvalidWeightsError);
    expect(() => parseWeights("null")).toThrow(InvalidWeightsError);
    expect(() => parseWeights(JSON.stringify({ ...TEST_WEIGHTS, hitRate: "high" }))).toThrow(
      InvalidWeightsError,
    );
    expect(() => parseWeights(JSON.stringify({ ...TEST_WEIGHTS, hitRate: NaN }))).toThrow(
      InvalidWeightsError,
    );
  });

  it("rejects values that would break the maths", () => {
    expect(() => parseWeights(JSON.stringify({ ...TEST_WEIGHTS, returnClampBps: 0 }))).toThrow();
    expect(() => parseWeights(JSON.stringify({ ...TEST_WEIGHTS, recencyHalfLifeDays: 0 }))).toThrow();
    expect(() => parseWeights(JSON.stringify({ ...TEST_WEIGHTS, priorStrength: -1 }))).toThrow();
  });

  it("rejects a set missing a field entirely", () => {
    const { consistency: _omitted, ...partial } = TEST_WEIGHTS;
    expect(() => parseWeights(JSON.stringify(partial))).toThrow(InvalidWeightsError);
  });
});

describe("rankCaller", () => {
  it("returns zero for an empty record", () => {
    expect(rankCaller([], TEST_WEIGHTS, T0)).toEqual({ scoreBps: 0, sampleSize: 0, contradictions: 0 });
  });

  /**
   * The most obvious attack on any track-record product: post once, get lucky, top the
   * leaderboard. Bayesian shrinkage toward the prior is what stops it.
   */
  it("does not let a single lucky call outrank a long good record", () => {
    const lucky = rankCaller([call({ pnlBps: 5000 })], TEST_WEIGHTS, T0);
    const sustained = rankCaller(
      Array.from({ length: 40 }, (_, i) => call({ pnlBps: 800, settledAt: T0 - i * DAY })),
      TEST_WEIGHTS,
      T0,
    );
    expect(sustained.scoreBps).toBeGreaterThan(lucky.scoreBps);
  });

  it("scores a winning record above a losing one", () => {
    const winners = Array.from({ length: 20 }, (_, i) => call({ pnlBps: 900, settledAt: T0 - i * DAY }));
    const losers = Array.from({ length: 20 }, (_, i) => call({ pnlBps: -900, settledAt: T0 - i * DAY }));
    expect(rankCaller(winners, TEST_WEIGHTS, T0).scoreBps).toBeGreaterThan(
      rankCaller(losers, TEST_WEIGHTS, T0).scoreBps,
    );
  });

  /**
   * Trading against your own advice is not "slightly worse", it is a different category
   * of thing. The penalty is multiplicative so a strong hit rate cannot absorb it.
   */
  it("punishes contradictions multiplicatively", () => {
    const clean = Array.from({ length: 10 }, (_, i) => call({ settledAt: T0 - i * DAY }));
    const one = clean.map((c, i) => (i === 0 ? { ...c, contradicted: true } : c));
    const two = clean.map((c, i) => (i < 2 ? { ...c, contradicted: true } : c));

    const cleanScore = rankCaller(clean, TEST_WEIGHTS, T0).scoreBps;
    const oneScore = rankCaller(one, TEST_WEIGHTS, T0).scoreBps;
    const twoScore = rankCaller(two, TEST_WEIGHTS, T0).scoreBps;

    expect(oneScore).toBeLessThan(cleanScore);
    expect(twoScore).toBeLessThan(oneScore);
    expect(rankCaller(two, TEST_WEIGHTS, T0).contradictions).toBe(2);
  });

  it("weights recent results above ancient ones", () => {
    const recent = Array.from({ length: 10 }, (_, i) => call({ pnlBps: 900, settledAt: T0 - i * DAY }));
    const ancient = Array.from({ length: 10 }, (_, i) =>
      call({ pnlBps: 900, settledAt: T0 - (i + 1000) * DAY }),
    );
    expect(rankCaller(recent, TEST_WEIGHTS, T0).scoreBps).toBeGreaterThan(
      rankCaller(ancient, TEST_WEIGHTS, T0).scoreBps,
    );
  });

  // A record so old that every recency weight underflows must not divide by zero and
  // emit NaN — which would be signed and written on-chain as a real score.
  it("survives a fully decayed record without producing NaN", () => {
    const fossil = [call({ settledAt: T0 - 1_000_000 * DAY })];
    const result = rankCaller(fossil, TEST_WEIGHTS, T0);
    expect(Number.isFinite(result.scoreBps)).toBe(true);
    expect(result.scoreBps).toBeGreaterThanOrEqual(0);
  });

  it("clamps outliers so one 100x cannot define a record", () => {
    const withOutlier = [call({ pnlBps: 10_000_000 }), ...Array.from({ length: 9 }, () => call({ pnlBps: -500 }))];
    const withClamped = [call({ pnlBps: TEST_WEIGHTS.returnClampBps }), ...Array.from({ length: 9 }, () => call({ pnlBps: -500 }))];
    expect(rankCaller(withOutlier, TEST_WEIGHTS, T0).scoreBps).toBe(
      rankCaller(withClamped, TEST_WEIGHTS, T0).scoreBps,
    );
  });

  it("always returns a score inside the basis-point range the chain accepts", () => {
    for (const pnl of [-1_000_000, -5000, 0, 5000, 1_000_000]) {
      const s = rankCaller([call({ pnlBps: pnl })], TEST_WEIGHTS, T0).scoreBps;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(10_000);
      expect(Number.isInteger(s)).toBe(true);
    }
  });

  /**
   * Two machines scoring the same record must agree, and re-scoring an unchanged record
   * next year must give the same number. Both fail if `now` is read from the clock,
   * which is why it is a parameter.
   */
  it("is deterministic for fixed inputs", () => {
    const calls = Array.from({ length: 15 }, (_, i) => call({ pnlBps: 300 * (i % 5) - 400, settledAt: T0 - i * DAY }));
    const first = rankCaller(calls, TEST_WEIGHTS, T0);
    for (let i = 0; i < 20; i++) {
      expect(rankCaller(calls, TEST_WEIGHTS, T0)).toEqual(first);
    }
  });

  it("is order-independent", () => {
    const calls = Array.from({ length: 12 }, (_, i) => call({ pnlBps: 200 * i - 600, settledAt: T0 - i * DAY }));
    const reversed = [...calls].reverse();
    expect(rankCaller(reversed, TEST_WEIGHTS, T0)).toEqual(rankCaller(calls, TEST_WEIGHTS, T0));
  });

  it("reports the sample size it scored", () => {
    const calls = Array.from({ length: 7 }, () => call());
    expect(rankCaller(calls, TEST_WEIGHTS, T0).sampleSize).toBe(7);
  });
});
