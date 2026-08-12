import { describe, it, expect } from "vitest";
import { callPnl, dossierStats } from "../lib/score";
describe("scoring", () => {
  it("long call math", () => {
    expect(callPnl(2.0, 1.0, "long").retPct).toBe(-50);
    expect(callPnl(2.0, 3.0, "long").pnlUsd).toBe(500);
  });
  it("short call math", () => {
    expect(callPnl(2.0, 1.0, "short").retPct).toBe(50);
  });
  it("dossier aggregates + ETH benchmark", () => {
    const s = dossierStats(
      [{ direction: "long", entry: 1, latest: 0.5, settled: true },
       { direction: "long", entry: 1, latest: 2.0, settled: true }],
      [{ entry: 2000, latest: 3000 }, { entry: 2000, latest: 3000 }]);
    expect(s.totalPnl).toBe(500);      // -500 + 1000
    expect(s.winRate).toBe(50);
    expect(s.benchmarkPnl).toBe(1000); // 2 × $1000 × 50%
  });
});
