/**
 * Deterministic post -> trade signal classification.
 *
 * Ported from the pre-Flare version's LLM classifier (an `emit_trade_signal` tool call
 * against a hosted model) and rewritten as pure, deterministic rules. That rewrite is a
 * requirement, not a preference:
 *
 *   1. FCC registers a TEE machine by its CODE HASH and expects reproducible builds. A
 *      classifier that phones a hosted model makes the enclave's output depend on
 *      something outside the attested image, so "this exact code produced this verdict"
 *      stops being true — the strongest claim the product has.
 *   2. A model call from inside the enclave would ship the post to a third party, which
 *      is a strange thing for a confidential-compute app to do even when the post is
 *      public.
 *   3. Same input must give same output forever, or a call scored today and re-checked
 *      next year would disagree with itself and the tape would be worthless as a record.
 *
 * The trade is real and worth stating: rules are blunter than a language model on
 * sarcasm, irony and implication. The mitigation is that this classifier is deliberately
 * CONSERVATIVE — anything it cannot read confidently becomes NOT_A_SIGNAL rather than a
 * guess. A missed call costs coverage; a hallucinated call corrupts someone's permanent
 * record. Those are not symmetric.
 */

/** The closed template set, unchanged from the original schema. */
export type Template = "DIRECTIONAL" | "TARGET_CALL" | "GEM_SHILL" | "NOT_A_SIGNAL";

export type Direction = "long" | "short";

export interface Signal {
  template: Template;
  assetSymbol: string | null;
  direction: Direction | null;
  /** Stated horizon in days, when the post gives one. Null means unspecified. */
  expiryDays: number | null;
  /** 0..1. Reported to the chain as basis points. */
  confidence: number;
}

/**
 * Tickers that are common English words and would otherwise fire constantly on ordinary
 * prose. Only counted when explicitly cashtagged ($ME, $ALL), never bare.
 */
const AMBIGUOUS_BARE_TICKERS = new Set([
  "ALL", "AND", "ANY", "ARE", "ART", "ASK", "ATH", "BAD", "BIG", "BUY", "CAN", "CEO",
  "DAO", "DAY", "DEX", "DID", "END", "FEE", "FOR", "FUD", "GET", "GM", "GOT", "HAS",
  "HOT", "ICE", "ID", "IT", "JOB", "KEY", "LOW", "ME", "NEW", "NFT", "NOT", "NOW",
  "ONE", "OUT", "OWN", "PAY", "PUT", "RUN", "SEE", "SET", "TOP", "TWO", "USD", "WAY",
  "WEB", "WIN", "YOU",
]);

/** Bullish intent. Ordered longest-first so "not bullish" is matched before "bullish". */
const LONG_PATTERNS: RegExp[] = [
  /\blong(?:ing|ed)?\b/i,
  /\bbullish\b/i,
  /\baccumulat(?:e|ing|ion)\b/i,
  /\bbuy(?:ing)?\s+(?:the\s+)?(?:dip|more)?\b/i,
  /\baped?\s+in\b/i,
  /\bloading\s+up\b/i,
  /\bsend(?:ing)?\s+it\b/i,
  /\bmoon(?:ing|shot)?\b/i,
  /\b(?:next|easy)\s+\d+x\b/i,
  /\bgoing\s+(?:up|higher|parabolic)\b/i,
];

const SHORT_PATTERNS: RegExp[] = [
  /\bshort(?:ing|ed)?\b/i,
  /\bbearish\b/i,
  /\bdump(?:ing)?\b/i,
  /\bsell(?:ing)?\b/i,
  /\bexit(?:ing)?\b/i,
  /\btop\s+is\s+in\b/i,
  /\bgoing\s+(?:down|lower|to\s+zero)\b/i,
  /\brug(?:ged|pull)?\b/i,
];

/**
 * Negation and hedging. A post carrying any of these is not making a clean call, and the
 * conservative reading is to stay out of it entirely rather than to invert the direction
 * (inverting guesses at intent; abstaining does not).
 */
const HEDGE_PATTERNS: RegExp[] = [
  /\bnot\s+(?:financial|advice)\b/i,
  /\bnfa\b/i,
  /\bdyor\b/i,
  /\bmight\b/i,
  /\bmaybe\b/i,
  /\bcould\s+go\s+either\b/i,
  /\bif\s+.*\bthen\b/i,
  /\bnot\s+(?:sure|certain)\b/i,
  /\bwhat\s+do\s+you\s+think\b/i,
];

/** Questions are speculation, not calls. */
const QUESTION_PATTERN = /\?\s*$/;

/** Retrospectives describe a past trade, which is not a new call. */
const RETROSPECTIVE_PATTERNS: RegExp[] = [
  /\b(?:called|said)\s+(?:it|this)\b/i,
  /\bi\s+told\s+you\b/i,
  /\bback\s+in\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|\d{4})\b/i,
  /\bwas\s+right\b/i,
];

/** Explicit price target, e.g. "target $4000", "to $0.00003", "tp 2.5". */
const TARGET_PATTERNS: RegExp[] = [
  /\btarget[:\s]+\$?\s*([\d,]+(?:\.\d+)?)/i,
  /\bto\s+\$\s*([\d,]+(?:\.\d+)?)/i,
  /\btp[:\s]+\$?\s*([\d,]+(?:\.\d+)?)/i,
  /\bpt[:\s]+\$?\s*([\d,]+(?:\.\d+)?)/i,
];

/** Stated horizon, e.g. "by month end", "this week", "in 3 days", "next 2 weeks". */
const HORIZON_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => number]> = [
  [/\bin\s+(\d+)\s+days?\b/i, (m) => parseInt(m[1], 10)],
  [/\bnext\s+(\d+)\s+days?\b/i, (m) => parseInt(m[1], 10)],
  [/\bin\s+(\d+)\s+weeks?\b/i, (m) => parseInt(m[1], 10) * 7],
  [/\bnext\s+(\d+)\s+weeks?\b/i, (m) => parseInt(m[1], 10) * 7],
  [/\bin\s+(\d+)\s+months?\b/i, (m) => parseInt(m[1], 10) * 30],
  [/\bthis\s+week\b/i, () => 7],
  [/\bnext\s+week\b/i, () => 14],
  [/\b(?:by\s+)?month\s+end\b/i, () => 30],
  [/\bthis\s+month\b/i, () => 30],
  [/\bby\s+eoy\b/i, () => 365],
  [/\btoday\b/i, () => 1],
  [/\btomorrow\b/i, () => 2],
];

const NOT_A_SIGNAL: Signal = {
  template: "NOT_A_SIGNAL",
  assetSymbol: null,
  direction: null,
  expiryDays: null,
  confidence: 0,
};

/**
 * Strip anything that produces false tickers: URLs (paths contain uppercase runs) and
 * mention handles (@SomeName). Both are extremely common in this corpus.
 */
function stripNoise(text: string): string {
  return text.replace(/https?:\/\/\S+/g, " ").replace(/@\w+/g, " ");
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Extract the asset the post is about.
 *
 * Cashtags win outright — `$XRP` is an unambiguous declaration of subject. A bare
 * uppercase ticker is accepted only when it is not a common English word, since posts
 * are full of shouted words that look exactly like tickers.
 */
export function extractSymbol(text: string): { symbol: string | null; cashtagged: boolean } {
  const cleaned = stripNoise(text);

  const cashtags = [...cleaned.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,9})\b/g)].map((m) => m[1].toUpperCase());
  if (cashtags.length > 0) {
    // Multiple distinct cashtags means the post is a list or a comparison, not a single
    // call. Refusing here is the conservative read; picking the first would invent one.
    const unique = [...new Set(cashtags)];
    return unique.length === 1 ? { symbol: unique[0], cashtagged: true } : { symbol: null, cashtagged: true };
  }

  const bare = [...cleaned.matchAll(/\b([A-Z]{2,10})\b/g)]
    .map((m) => m[1])
    .filter((t) => !AMBIGUOUS_BARE_TICKERS.has(t));
  const uniqueBare = [...new Set(bare)];
  return uniqueBare.length === 1 ? { symbol: uniqueBare[0], cashtagged: false } : { symbol: null, cashtagged: false };
}

export function extractExpiryDays(text: string): number | null {
  for (const [pattern, toDays] of HORIZON_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      const days = toDays(m);
      // Reject absurd or unparseable horizons rather than storing a nonsense expiry the
      // contract would then refuse (CallTape bounds horizons to 1 hour .. 365 days).
      if (Number.isFinite(days) && days >= 1 && days <= 365) return days;
    }
  }
  return null;
}

export function hasPriceTarget(text: string): boolean {
  return matchesAny(text, TARGET_PATTERNS);
}

/**
 * Classify a post.
 *
 * Pure: same text in, same signal out, forever. No clock, no network, no randomness —
 * which is what lets the enclave's code hash mean something.
 */
export function classify(text: string): Signal {
  if (!text || !text.trim()) return NOT_A_SIGNAL;

  const cleaned = stripNoise(text);

  // Hedged, interrogative or retrospective posts are excluded before anything else. A
  // caller musing "might be time to short?" has not made a call, and recording one
  // against them would be putting words in their mouth permanently.
  if (matchesAny(cleaned, HEDGE_PATTERNS)) return NOT_A_SIGNAL;
  if (QUESTION_PATTERN.test(cleaned.trim())) return NOT_A_SIGNAL;
  if (matchesAny(cleaned, RETROSPECTIVE_PATTERNS)) return NOT_A_SIGNAL;

  const { symbol, cashtagged } = extractSymbol(cleaned);
  if (!symbol) return NOT_A_SIGNAL;

  const isLong = matchesAny(cleaned, LONG_PATTERNS);
  const isShort = matchesAny(cleaned, SHORT_PATTERNS);

  // Both directions present means the post discusses both sides. Not a call.
  if (isLong && isShort) return NOT_A_SIGNAL;

  const expiryDays = extractExpiryDays(cleaned);
  const targeted = hasPriceTarget(cleaned);

  if (isShort) {
    return {
      template: targeted ? "TARGET_CALL" : "DIRECTIONAL",
      assetSymbol: symbol,
      direction: "short",
      expiryDays,
      confidence: scoreConfidence({ cashtagged, explicitDirection: true, targeted, expiryDays }),
    };
  }

  if (isLong) {
    return {
      template: targeted ? "TARGET_CALL" : "DIRECTIONAL",
      assetSymbol: symbol,
      direction: "long",
      expiryDays,
      confidence: scoreConfidence({ cashtagged, explicitDirection: true, targeted, expiryDays }),
    };
  }

  // No explicit direction verb, but a cashtagged asset with a price target reads as a
  // hype call ("$WIF to $5"). Default long, because that is what shilling means — but
  // carry lower confidence to reflect that the direction was inferred, not stated.
  if (cashtagged && targeted) {
    return {
      template: "GEM_SHILL",
      assetSymbol: symbol,
      direction: "long",
      expiryDays,
      confidence: scoreConfidence({ cashtagged, explicitDirection: false, targeted, expiryDays }),
    };
  }

  return NOT_A_SIGNAL;
}

/**
 * Confidence is evidence-counting, not a vibe: each independent signal that the post is
 * a real call adds a fixed amount. Kept transparent and open because it is part of the
 * classifier, not the ranking — there is nothing to gain by hiding it.
 */
function scoreConfidence(opts: {
  cashtagged: boolean;
  explicitDirection: boolean;
  targeted: boolean;
  expiryDays: number | null;
}): number {
  let c = 0.4;
  if (opts.cashtagged) c += 0.2;
  if (opts.explicitDirection) c += 0.25;
  if (opts.targeted) c += 0.1;
  if (opts.expiryDays !== null) c += 0.05;
  return Math.min(1, Math.round(c * 100) / 100);
}

/** Confidence as basis points, which is how CallTape stores it. */
export function confidenceBps(signal: Signal): number {
  return Math.max(0, Math.min(10_000, Math.round(signal.confidence * 10_000)));
}
