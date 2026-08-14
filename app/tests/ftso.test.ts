import { describe, expect, it } from "vitest";
import { formatPrice, MAX_FEED_AGE_SECONDS, pnlBps, wadToNumber } from "../lib/ftso";

const wad = (n: string) => BigInt(Math.round(parseFloat(n) * 1e6)) * 10n ** 12n;

describe("pnlBps", () => {
  // These mirror the assertions in contracts/test/CallTape.t.sol. The UI and the chain
  // must agree to the basis point: a dossier that shows +10% next to a settlement event
  // that recorded +9.99% reads as a bug even when the chain is right.
  it("matches the on-chain result for a +10% long", () => {
    expect(pnlBps("long", wad("2.41"), wad("2.651"))).toBe(1000n);
  });

  it("matches the on-chain result for a -10% short", () => {
    expect(pnlBps("short", wad("2.41"), wad("2.169"))).toBe(1000n);
  });

  it("inverts sign between long and short", () => {
    const entry = wad("2.00");
    const settle = wad("2.50");
    expect(pnlBps("long", entry, settle)).toBe(2500n);
    expect(pnlBps("short", entry, settle)).toBe(-2500n);
  });

  it("returns zero when the price is unchanged", () => {
    expect(pnlBps("long", wad("1.23"), wad("1.23"))).toBe(0n);
    expect(pnlBps("short", wad("1.23"), wad("1.23"))).toBe(0n);
  });

  // Solidity truncates toward zero on integer division. JS BigInt does too, which is
  // precisely why this uses BigInt rather than floats — a float would round and drift
  // away from the chain by a basis point on exactly the awkward cases.
  it("truncates toward zero exactly as Solidity does", () => {
    // 1 wei gain on a 3 wei entry: 1 * 10000 / 3 = 3333 (truncated, not 3333.33).
    expect(pnlBps("long", 3n, 4n)).toBe(3333n);
    // And on the loss side, truncation goes toward zero, not toward -infinity.
    expect(pnlBps("long", 3n, 2n)).toBe(-3333n);
  });

  it("refuses a zero entry price instead of dividing by zero", () => {
    expect(() => pnlBps("long", 0n, wad("1"))).toThrow();
  });
});

describe("wadToNumber", () => {
  it("converts 1e18-scaled values", () => {
    expect(wadToNumber(10n ** 18n)).toBe(1);
    expect(wadToNumber(wad("2.41"))).toBeCloseTo(2.41, 10);
  });
});

describe("formatPrice", () => {
  // The callers in this dataset mostly talk about sub-cent assets, so a fixed 2-decimal
  // format would render the interesting cases as "0.00".
  it("keeps sub-cent assets legible", () => {
    expect(formatPrice(wad("0.00042"))).toBe("0.000420");
    expect(formatPrice(wad("0.00042"))).not.toBe("0.00");
  });

  it("scales precision down as magnitude grows", () => {
    expect(formatPrice(wad("2.41"))).toBe("2.4100");
    expect(formatPrice(wad("64000"))).toContain("64,000");
  });

  it("falls back to exponential for very small values", () => {
    expect(formatPrice(1n)).toContain("e-");
  });

  it("renders zero plainly", () => {
    expect(formatPrice(0n)).toBe("0");
  });
});

describe("staleness threshold", () => {
  // Must equal CallTape.maxFeedAge's default. If the UI accepted a price the contract
  // rejects, users would see a number and then watch the transaction revert for no
  // visible reason.
  it("matches the contract default of 5 minutes", () => {
    expect(MAX_FEED_AGE_SECONDS).toBe(300);
  });
});
