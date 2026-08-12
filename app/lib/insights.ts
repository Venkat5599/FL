// Creator analytics computed from a dossier's calls — "as much insight as
// possible" for picking who to copy/fade. Pure and unit-testable; the input
// shape is a subset of DossierCall (kept local to avoid a circular import).

export interface InsightCall {
  asset_symbol: string | null;
  direction: "long" | "short" | null;
  retPct: number | null;
  url: string;
  posted_at: number;
  deleted_at: number | null;
}

export interface TokenPerf {
  asset: string;
  count: number;
  avgRetPct: number;
  winRate: number; // %
}

export interface CreatorInsights {
  totalCalls: number;
  scoredCalls: number;
  bestCall: { asset: string; retPct: number; url: string } | null;
  worstCall: { asset: string; retPct: number; url: string } | null;
  byToken: TokenPerf[]; // per-token performance, most-called first
  longPct: number; // % of directional calls that were long
  contradictionRate: number; // said-vs-did contradictions / scored calls (%)
  callsPerWeek: number;
  topTokens: { asset: string; count: number }[]; // most-called
}

export function computeInsights(calls: InsightCall[], contradictionCount: number): CreatorInsights {
  const scored = calls.filter((c) => c.retPct !== null && c.asset_symbol);
  const totalCalls = calls.length;
  const scoredCalls = scored.length;

  let bestCall: CreatorInsights["bestCall"] = null;
  let worstCall: CreatorInsights["worstCall"] = null;
  for (const c of scored) {
    const entry = { asset: c.asset_symbol as string, retPct: c.retPct as number, url: c.url };
    if (!bestCall || entry.retPct > bestCall.retPct) bestCall = entry;
    if (!worstCall || entry.retPct < worstCall.retPct) worstCall = entry;
  }

  // Per-token performance.
  const tok = new Map<string, number[]>();
  for (const c of scored) {
    const k = (c.asset_symbol as string).toUpperCase();
    (tok.get(k) ?? tok.set(k, []).get(k)!).push(c.retPct as number);
  }
  const byToken: TokenPerf[] = [...tok.entries()]
    .map(([asset, rets]) => ({
      asset,
      count: rets.length,
      avgRetPct: Math.round((rets.reduce((a, b) => a + b, 0) / rets.length) * 100) / 100,
      winRate: Math.round((100 * rets.filter((r) => r > 0).length) / rets.length),
    }))
    .sort((a, b) => b.count - a.count);

  // Directional bias.
  const directional = calls.filter((c) => c.direction);
  const longPct = directional.length
    ? Math.round((100 * directional.filter((c) => c.direction === "long").length) / directional.length)
    : 0;

  const contradictionRate = scoredCalls ? Math.round((100 * contradictionCount) / scoredCalls) : 0;

  // Cadence.
  const times = calls.map((c) => c.posted_at).sort((a, b) => a - b);
  const spanWeeks =
    times.length > 1 ? Math.max(1, (times[times.length - 1] - times[0]) / (7 * 86400)) : 1;
  const callsPerWeek = Math.round((totalCalls / spanWeeks) * 10) / 10;

  // Most-called tokens (any call with a symbol).
  const all = new Map<string, number>();
  for (const c of calls) {
    if (!c.asset_symbol) continue;
    const k = c.asset_symbol.toUpperCase();
    all.set(k, (all.get(k) ?? 0) + 1);
  }
  const topTokens = [...all.entries()]
    .map(([asset, count]) => ({ asset, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalCalls,
    scoredCalls,
    bestCall,
    worstCall,
    byToken,
    longPct,
    contradictionRate,
    callsPerWeek,
    topTokens,
  };
}
