/**
 * Caller ranking, under weights that never leave the enclave.
 *
 * This is the reason TAPE needs confidential compute rather than a smart contract.
 *
 * The inputs are all public: every call is an FDC-attested post, every entry and settle
 * mark came from FTSOv2, and every realised P&L is readable on-chain. The output is
 * public too — a score, signed by an attested TEE machine, written back to the chain.
 * The only private thing is the FUNCTION.
 *
 * Why that asymmetry is the right one. A ranking whose formula is public gets optimised
 * against rather than satisfied: callers learn that (say) sample size dominates and post
 * a hundred trivial calls, or that recency dominates and stay quiet after a good week.
 * Goodhart's law is not a hypothetical here, it is the predictable end state of any
 * public leaderboard with money attached. Hiding the formula does not make the system
 * unaccountable, because anyone can still check that the inputs are real and that the
 * machine which produced the score is the registered one. It just stops the metric from
 * being farmed.
 *
 * The weights are delivered encrypted (OP_COMMAND_WEIGHTS) and held in enclave memory
 * only. They are deliberately NOT compiled in: this extension is open source and
 * reproducibly built, so anything in the image is public by construction.
 */

/** Per-call facts the ranker reasons over. All of these are already on-chain. */
export interface SettledCall {
  /** Realised return in basis points, signed. */
  pnlBps: number;
  /** Unix seconds the call was published. */
  postedAt: number;
  /** Unix seconds the call settled. */
  settledAt: number;
  /** Classifier confidence in basis points, 0..10_000. */
  confidenceBps: number;
  /**
   * Whether the caller's own wallet contradicted the call (said accumulate, sold hours
   * later). The single most damning thing the record can contain.
   */
  contradicted: boolean;
}

/**
 * The secret coefficients.
 *
 * Field names are public — they are in this open-source file — but the VALUES are not,
 * and the values are what determines how to game the score. Knowing that consistency is
 * a term tells an attacker very little; knowing it carries four times the weight of hit
 * rate tells them exactly what to do.
 */
export interface RankWeights {
  /** Weight on the fraction of calls that made money. */
  hitRate: number;
  /** Weight on mean realised return. */
  meanReturn: number;
  /** Weight on consistency (low dispersion of returns). */
  consistency: number;
  /** Weight on how recent the caller's record is. */
  recency: number;
  /** Weight on whether the caller commits (high-confidence, specific calls). */
  conviction: number;
  /** Multiplier applied per contradicted call. Expected to be punitive. */
  contradictionPenalty: number;
  /**
   * Bayesian shrinkage prior. Small samples get pulled toward the middle so that one
   * lucky call cannot top the leaderboard — the most obvious attack on any track-record
   * system, and the reason a raw hit rate is useless on its own.
   */
  priorStrength: number;
  /** Returns are clamped to +/- this many bps before averaging, so a single 100x does
   *  not dominate a caller's entire record. */
  returnClampBps: number;
  /** Half-life in days for the recency decay. */
  recencyHalfLifeDays: number;
}

export class WeightsNotLoadedError extends Error {
  constructor() {
    super(
      "ranking weights have not been provisioned — send a SCORE/WEIGHTS instruction before SCORE/RANK",
    );
    this.name = "WeightsNotLoadedError";
  }
}

export class InvalidWeightsError extends Error {
  constructor(reason: string) {
    super(`invalid ranking weights: ${reason}`);
    this.name = "InvalidWeightsError";
  }
}

const REQUIRED_NUMERIC_FIELDS: Array<keyof RankWeights> = [
  "hitRate",
  "meanReturn",
  "consistency",
  "recency",
  "conviction",
  "contradictionPenalty",
  "priorStrength",
  "returnClampBps",
  "recencyHalfLifeDays",
];

/**
 * Validate decrypted weights before they are trusted.
 *
 * Worth being strict: a malformed weight set would not throw, it would silently produce
 * NaN scores that get signed by an attested machine and written on-chain as though they
 * meant something. Failing loudly at the boundary is far better than an authentic
 * signature over garbage.
 */
export function parseWeights(json: string): RankWeights {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new InvalidWeightsError(`not valid JSON (${e})`);
  }
  if (typeof raw !== "object" || raw === null) throw new InvalidWeightsError("not an object");

  const obj = raw as Record<string, unknown>;
  for (const field of REQUIRED_NUMERIC_FIELDS) {
    const v = obj[field];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new InvalidWeightsError(`field "${field}" must be a finite number`);
    }
  }
  if ((obj.priorStrength as number) < 0) throw new InvalidWeightsError("priorStrength must be >= 0");
  if ((obj.returnClampBps as number) <= 0) throw new InvalidWeightsError("returnClampBps must be > 0");
  if ((obj.recencyHalfLifeDays as number) <= 0) {
    throw new InvalidWeightsError("recencyHalfLifeDays must be > 0");
  }

  return obj as unknown as RankWeights;
}

const SECONDS_PER_DAY = 86_400;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Exponential recency decay. A caller who was right two years ago and silent since is
 * not currently a good caller, and a flat average would say otherwise.
 */
function recencyWeight(settledAt: number, now: number, halfLifeDays: number): number {
  const ageDays = Math.max(0, (now - settledAt) / SECONDS_PER_DAY);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export interface RankResult {
  /** Final score, 0..10_000, ready to be written on-chain as basis points. */
  scoreBps: number;
  /** Number of settled calls the score is based on. Public context for the score. */
  sampleSize: number;
  /** How many of those contradicted the caller's own wallet. */
  contradictions: number;
}

/**
 * Score a caller.
 *
 * Deterministic given (calls, weights, now): no randomness, no I/O. `now` is passed in
 * rather than read from the clock so the same inputs always produce the same score,
 * which matters because the result is signed and permanent.
 */
export function rankCaller(calls: SettledCall[], weights: RankWeights, now: number): RankResult {
  const n = calls.length;
  if (n === 0) return { scoreBps: 0, sampleSize: 0, contradictions: 0 };

  const clampBps = weights.returnClampBps;

  let weightSum = 0;
  let weightedReturn = 0;
  let weightedWins = 0;
  let weightedConviction = 0;
  let contradictions = 0;

  for (const call of calls) {
    const w = recencyWeight(call.settledAt, now, weights.recencyHalfLifeDays);
    // A single outlier must not define a record, in either direction.
    const r = clamp(call.pnlBps, -clampBps, clampBps);

    weightSum += w;
    weightedReturn += w * r;
    weightedWins += w * (call.pnlBps > 0 ? 1 : 0);
    weightedConviction += w * (call.confidenceBps / 10_000);
    if (call.contradicted) contradictions++;
  }

  // Guard against total decay: a record old enough that every weight underflows would
  // otherwise divide by zero and produce NaN.
  if (weightSum <= 0) return { scoreBps: 0, sampleSize: n, contradictions };

  const meanReturn = weightedReturn / weightSum;
  const rawHitRate = weightedWins / weightSum;
  const conviction = weightedConviction / weightSum;

  // Bayesian shrinkage toward 0.5. With k = priorStrength pseudo-observations, a caller
  // with one lucky call sits near the middle rather than at the top — which is the whole
  // defence against a leaderboard full of one-hit wonders.
  const k = weights.priorStrength;
  const shrunkHitRate = (weightedWins + 0.5 * k) / (weightSum + k);

  // Dispersion of returns. Steady beats erratic at the same average, because an erratic
  // record is mostly noise and will not repeat.
  //
  // A single call is a special case that must NOT be treated as perfectly consistent.
  // One data point has zero variance by definition, so the naive formula hands it a
  // consistency of 1.0 — and a lone lucky call then outranks a long, genuinely good
  // record. Dispersion is undefined below two observations, so it scores neutral.
  let consistency = 0.5;
  if (n >= 2) {
    let variance = 0;
    for (const call of calls) {
      const w = recencyWeight(call.settledAt, now, weights.recencyHalfLifeDays);
      const r = clamp(call.pnlBps, -clampBps, clampBps);
      variance += w * Math.pow(r - meanReturn, 2);
    }
    const stdDev = Math.sqrt(variance / weightSum);
    consistency = 1 / (1 + stdDev / clampBps);
  }

  // Normalise each term to roughly 0..1 before weighting, so the secret coefficients
  // are comparable to each other and a change to one does not silently rescale the rest.
  const normalisedReturn = clamp((meanReturn + clampBps) / (2 * clampBps), 0, 1);

  const composite =
    weights.hitRate * shrunkHitRate +
    weights.meanReturn * normalisedReturn +
    weights.consistency * consistency +
    weights.recency * clamp(weightSum / Math.max(1, n), 0, 1) +
    weights.conviction * conviction;

  const weightTotal =
    weights.hitRate + weights.meanReturn + weights.consistency + weights.recency + weights.conviction;
  const rawScore = weightTotal > 0 ? composite / weightTotal : 0;

  // Sample-size credibility, applied to the WHOLE composite rather than to hit rate
  // alone. Shrinking only one term leaves the others free to reward a thin record: a
  // single maximal call still scored near the top through mean return and (before the
  // fix above) a spurious perfect consistency. Pulling the entire score toward neutral
  // in proportion to how little evidence there is closes that off generally, rather than
  // patching each term as the hole is discovered in it.
  const credibility = n / (n + weights.priorStrength);
  const normalised = 0.5 + (rawScore - 0.5) * credibility;

  // Contradictions are applied last and multiplicatively. A caller who trades against
  // their own advice is not a slightly worse caller, they are a different category of
  // thing, and an additive penalty would let a good hit rate absorb it.
  const penalty = Math.pow(clamp(weights.contradictionPenalty, 0, 1), contradictions);

  const scoreBps = Math.round(clamp(normalised * penalty, 0, 1) * 10_000);
  return { scoreBps, sampleSize: n, contradictions };
}

/**
 * Weights held in enclave memory. Module-level because the framework serialises handler
 * calls, so there is no concurrent access to guard.
 */
let loadedWeights: RankWeights | null = null;

export function setWeights(w: RankWeights): void {
  loadedWeights = w;
}

export function hasWeights(): boolean {
  return loadedWeights !== null;
}

/**
 * Fetch the loaded weights, or refuse.
 *
 * Deliberately throws rather than falling back to a default set. A built-in default
 * would be compiled into an open-source, reproducibly-built image — i.e. public — and
 * the extension would then quietly produce scores under public weights while still
 * signing them as confidential output. That is worse than not scoring at all.
 */
export function requireWeights(): RankWeights {
  if (!loadedWeights) throw new WeightsNotLoadedError();
  return loadedWeights;
}

/** Clear enclave-held weights. Test-only. */
export function resetWeights(): void {
  loadedWeights = null;
}
