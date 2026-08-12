import { describe, it, expect } from "vitest";
import { computeInsights, type InsightCall } from "../lib/insights";

const wk = 7 * 86400;
const calls: InsightCall[] = [
  { asset_symbol: "PEPE", direction: "long", retPct: 50, url: "u1", posted_at: 0, deleted_at: null },
  { asset_symbol: "PEPE", direction: "long", retPct: -10, url: "u2", posted_at: wk, deleted_at: null },
  { asset_symbol: "SHIB", direction: "long", retPct: -80, url: "u3", posted_at: 2 * wk, deleted_at: null },
  { asset_symbol: "ETH", direction: "short", retPct: null, url: "u4", posted_at: 2 * wk, deleted_at: null }, // unscored
];

describe("computeInsights", () => {
  const ins = computeInsights(calls, 1); // 1 contradiction

  it("counts total vs scored calls", () => {
    expect(ins.totalCalls).toBe(4);
    expect(ins.scoredCalls).toBe(3);
  });

  it("finds best and worst call", () => {
    expect(ins.bestCall).toEqual({ asset: "PEPE", retPct: 50, url: "u1" });
    expect(ins.worstCall).toEqual({ asset: "SHIB", retPct: -80, url: "u3" });
  });

  it("computes per-token performance, most-called first", () => {
    expect(ins.byToken[0]).toEqual({ asset: "PEPE", count: 2, avgRetPct: 20, winRate: 50 });
    expect(ins.byToken.find((t) => t.asset === "SHIB")).toEqual({
      asset: "SHIB", count: 1, avgRetPct: -80, winRate: 0,
    });
  });

  it("directional bias + contradiction rate", () => {
    expect(ins.longPct).toBe(75); // 3 of 4 directional are long
    expect(ins.contradictionRate).toBe(33); // 1 / 3 scored
  });

  it("cadence over the spanned weeks", () => {
    expect(ins.callsPerWeek).toBe(2); // 4 calls over 2 weeks
  });
});
