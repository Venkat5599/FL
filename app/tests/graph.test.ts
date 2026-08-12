import { describe, it, expect } from "vitest";
import { parseSwapSell, type RawSwap } from "../lib/subgraph";

describe("parseSwapSell (Uniswap v3 swap → sold token)", () => {
  const base = { timestamp: "1740830400", amountUSD: "1000", transaction: { id: "0xabc" } };

  it("identifies the token with the positive amount as sold (token1 sell)", () => {
    // amount0 negative (received), amount1 positive (sold WETH)
    const s: RawSwap = {
      ...base, amount0: "-1276.3", amount1: "0.5",
      token0: { id: "0xAAA" }, token1: { id: "0xWETH" },
    };
    const r = parseSwapSell(s)!;
    expect(r.token_address).toBe("0xweth");
    expect(r.usd_value).toBe(1000);
    expect(r.occurred_at).toBe(1740830400);
  });

  it("identifies a token0 sell", () => {
    const s: RawSwap = {
      ...base, amount0: "5000", amount1: "-0.3",
      token0: { id: "0xPEPE" }, token1: { id: "0xWETH" },
    };
    expect(parseSwapSell(s)!.token_address).toBe("0xpepe");
  });
});
