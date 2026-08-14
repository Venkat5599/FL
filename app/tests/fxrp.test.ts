import { describe, expect, it } from "vitest";
import { EXPECTED_FXRP_DECIMALS, formatFxrp, parseFxrp, sizeByPercent } from "../lib/fxrp";

/**
 * FXRP uses 6 decimals (XRPL drops), not 18. Every test here exists because assuming 18
 * is the easiest way to be wrong by a factor of a trillion when moving someone's money.
 */
describe("FXRP precision", () => {
  it("uses XRPL drop precision, not ether precision", () => {
    expect(EXPECTED_FXRP_DECIMALS).toBe(6);
  });
});

describe("parseFxrp", () => {
  it("parses whole and fractional amounts into base units", () => {
    expect(parseFxrp("1")).toBe(BigInt(1_000_000));
    expect(parseFxrp("0.5")).toBe(BigInt(500_000));
    expect(parseFxrp("12.345678")).toBe(BigInt(12_345_678));
  });

  // Truncating would quietly lose value on every single trade. An error is recoverable;
  // silent dust is not.
  it("refuses more precision than FXRP can represent", () => {
    expect(() => parseFxrp("1.1234567")).toThrow();
  });

  it("rejects anything that is not a plain decimal number", () => {
    for (const bad of ["", "abc", "-1", "1e6", "1.2.3", " 1,000 "]) {
      expect(() => parseFxrp(bad)).toThrow();
    }
  });

  // Round-tripping through a float would lose the low digits on large balances.
  it("survives amounts far beyond float precision", () => {
    const huge = "99999999999.123456";
    expect(formatFxrp(parseFxrp(huge))).toBe(huge);
  });
});

describe("formatFxrp", () => {
  it("renders whole amounts without a decimal point", () => {
    expect(formatFxrp(BigInt(1_000_000))).toBe("1");
    expect(formatFxrp(BigInt(0))).toBe("0");
  });

  it("trims trailing zeros but keeps significant digits", () => {
    expect(formatFxrp(BigInt(1_500_000))).toBe("1.5");
    expect(formatFxrp(BigInt(1_000_001))).toBe("1.000001");
  });

  it("round-trips with parseFxrp", () => {
    for (const v of ["0.000001", "1", "1.5", "1234.5678", "0.1"]) {
      expect(formatFxrp(parseFxrp(v))).toBe(v);
    }
  });
});

describe("sizeByPercent", () => {
  it("takes a percentage of a balance in integer maths", () => {
    const balance = parseFxrp("100");
    expect(sizeByPercent(balance, 10_000)).toBe(balance); // 100%
    expect(sizeByPercent(balance, 5_000)).toBe(parseFxrp("50"));
    expect(sizeByPercent(balance, 100)).toBe(parseFxrp("1"));
    expect(sizeByPercent(balance, 0)).toBe(BigInt(0));
  });

  // Truncation must go down, never up: sizing above the balance produces a transfer that
  // reverts, which costs the user gas for nothing.
  it("never sizes above the balance", () => {
    const balance = BigInt(7); // 7 drops, deliberately awkward
    for (let bps = 0; bps <= 10_000; bps += 137) {
      expect(sizeByPercent(balance, bps)).toBeLessThanOrEqual(balance);
    }
  });

  it("rejects out-of-range or non-integer percentages", () => {
    const balance = parseFxrp("100");
    for (const bad of [-1, 10_001, 1.5, NaN]) {
      expect(() => sizeByPercent(balance, bad)).toThrow();
    }
  });

  it("handles a zero balance without dividing by zero", () => {
    expect(sizeByPercent(BigInt(0), 5_000)).toBe(BigInt(0));
  });
});
