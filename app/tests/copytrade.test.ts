import { describe, it, expect } from "vitest";
import { allocationBudgetUsd, planTrade, type Allocation, type CallSignal } from "../lib/copytrade";

const SIG: CallSignal = { direction: "long", tokenAddress: "0xabc", tokenSymbol: "PEPE" };

describe("allocationBudgetUsd", () => {
  it("fixed USD is the cap value", () => {
    expect(allocationBudgetUsd({ mode: "copy", capType: "fixed_usd", capValue: 10 }, 1000)).toBe(10);
  });
  it("percent is a share of the balance", () => {
    expect(allocationBudgetUsd({ mode: "fade", capType: "percent", capValue: 10 }, 500)).toBe(50);
  });
});

describe("planTrade", () => {
  const fixed10: Allocation = { mode: "copy", capType: "fixed_usd", capValue: 10 };

  it("COPY a long → buy, sized to remaining budget", () => {
    const t = planTrade(SIG, fixed10, 1000)!;
    expect(t.side).toBe("buy");
    expect(t.amountUsd).toBe(10);
    expect(t.tokenSymbol).toBe("PEPE");
  });

  it("FADE a long → sell (inverted direction)", () => {
    const t = planTrade(SIG, { mode: "fade", capType: "fixed_usd", capValue: 10 }, 1000)!;
    expect(t.side).toBe("sell");
  });

  it("respects the cap: no trade when budget already deployed", () => {
    expect(planTrade(SIG, fixed10, 1000, 10)).toBeNull();
  });

  it("percent cap sizes off balance", () => {
    const t = planTrade(SIG, { mode: "copy", capType: "percent", capValue: 20 }, 250)!;
    expect(t.amountUsd).toBe(50); // 20% of 250
  });
});
