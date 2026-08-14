import { describe, expect, it } from "vitest";
import { classify, confidenceBps, extractExpiryDays, extractSymbol } from "../app/classify.js";

/**
 * The governing principle for these tests: a missed call costs coverage, a hallucinated
 * call corrupts someone's permanent public record. Those are not symmetric, so the
 * classifier is tested hardest on what it must REFUSE to classify.
 */
describe("classify — real calls", () => {
  it("reads an explicit long with a target as a TARGET_CALL", () => {
    const s = classify("Longing $ETH here, target $4000 by month end");
    expect(s.template).toBe("TARGET_CALL");
    expect(s.assetSymbol).toBe("ETH");
    expect(s.direction).toBe("long");
    expect(s.expiryDays).toBe(30);
  });

  it("reads an explicit short as DIRECTIONAL", () => {
    const s = classify("shorting $SOL into this pump");
    expect(s.template).toBe("DIRECTIONAL");
    expect(s.assetSymbol).toBe("SOL");
    expect(s.direction).toBe("short");
  });

  it("reads a cashtagged hype post with a target as a GEM_SHILL", () => {
    const s = classify("$WIF to $5, this is the one");
    expect(s.template).toBe("GEM_SHILL");
    expect(s.assetSymbol).toBe("WIF");
    expect(s.direction).toBe("long");
  });

  it("treats accumulation language as long", () => {
    expect(classify("accumulating $XRP down here").direction).toBe("long");
  });

  it("treats 'top is in' as short", () => {
    expect(classify("$BTC top is in").direction).toBe("short");
  });
});

describe("classify — must refuse", () => {
  it("refuses hedged posts", () => {
    // "might" is doing the work: this is musing, not a call.
    expect(classify("$ETH might run here, NFA").template).toBe("NOT_A_SIGNAL");
    expect(classify("longing $ETH, dyor").template).toBe("NOT_A_SIGNAL");
  });

  it("refuses questions", () => {
    expect(classify("is it time to long $ETH?").template).toBe("NOT_A_SIGNAL");
  });

  it("refuses retrospectives", () => {
    // Claiming credit for a past call is not a new call, and scoring it would let a
    // caller farm their record by re-posting old wins.
    expect(classify("I called $SOL at 20, told you").template).toBe("NOT_A_SIGNAL");
    expect(classify("was right about $BTC back in 2023").template).toBe("NOT_A_SIGNAL");
  });

  it("refuses posts naming several assets", () => {
    // A list is not a call on any one of them; picking the first would invent intent.
    expect(classify("watching $ETH $SOL $XRP closely, longing soon").template).toBe("NOT_A_SIGNAL");
  });

  it("refuses posts that argue both directions", () => {
    expect(classify("could be longing $ETH or shorting it").template).toBe("NOT_A_SIGNAL");
  });

  it("refuses ordinary chatter with no asset", () => {
    expect(classify("gm frens, beautiful day").template).toBe("NOT_A_SIGNAL");
    expect(classify("").template).toBe("NOT_A_SIGNAL");
  });

  it("refuses a bare asset with no directional language", () => {
    expect(classify("$ETH").template).toBe("NOT_A_SIGNAL");
  });
});

describe("extractSymbol — false-positive resistance", () => {
  it("ignores uppercase English words that look like tickers", () => {
    // Without the ambiguous-word filter, this post is a "BUY" call on nothing.
    expect(extractSymbol("BUY THE DIP NOW").symbol).toBeNull();
  });

  it("ignores tickers inside URLs", () => {
    expect(extractSymbol("see https://example.com/ETH/analysis").symbol).toBeNull();
  });

  it("ignores @mentions", () => {
    expect(extractSymbol("thanks @ETHDaily for the chart").symbol).toBeNull();
  });

  it("accepts an ambiguous word only when cashtagged", () => {
    expect(extractSymbol("$ME is undervalued").symbol).toBe("ME");
    expect(extractSymbol("ME is undervalued").symbol).toBeNull();
  });

  it("treats repeated cashtags of one asset as a single subject", () => {
    expect(extractSymbol("$XRP $XRP $XRP").symbol).toBe("XRP");
  });
});

describe("extractExpiryDays", () => {
  it("parses stated horizons", () => {
    expect(extractExpiryDays("in 3 days")).toBe(3);
    expect(extractExpiryDays("next 2 weeks")).toBe(14);
    expect(extractExpiryDays("this week")).toBe(7);
    expect(extractExpiryDays("by month end")).toBe(30);
  });

  it("returns null when no horizon is stated", () => {
    expect(extractExpiryDays("longing here")).toBeNull();
  });

  // CallTape bounds horizons to 1 hour .. 365 days, so anything outside that would be
  // rejected on-chain. Better to report "unspecified" than to store a value the
  // contract will refuse.
  it("rejects horizons the contract would not accept", () => {
    expect(extractExpiryDays("in 9999 days")).toBeNull();
  });
});

describe("determinism", () => {
  // This is the property that makes the enclave's attested code hash meaningful. If the
  // classifier could drift, "this exact code produced this verdict" would be false.
  it("gives identical output for identical input, repeatedly", () => {
    const text = "Longing $ETH here, target $4000 by month end";
    const first = classify(text);
    for (let i = 0; i < 50; i++) {
      expect(classify(text)).toEqual(first);
    }
  });
});

describe("confidence", () => {
  it("rewards independent evidence that the post is a real call", () => {
    const vague = classify("$WIF to $5");
    const explicit = classify("Longing $ETH here, target $4000 by month end");
    expect(explicit.confidence).toBeGreaterThan(vague.confidence);
  });

  it("never exceeds the range CallTape accepts", () => {
    const s = classify("Longing $ETH here, target $4000 in 3 days");
    expect(confidenceBps(s)).toBeGreaterThanOrEqual(0);
    expect(confidenceBps(s)).toBeLessThanOrEqual(10_000);
  });

  it("reports zero confidence for a non-signal", () => {
    expect(confidenceBps(classify("gm"))).toBe(0);
  });
});
