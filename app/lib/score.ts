export const NOTIONAL = 1000;
export function callPnl(entry: number, mark: number, direction: "long"|"short", notional = NOTIONAL) {
  const raw = (mark - entry) / entry;
  const ret = direction === "long" ? raw : -raw;
  return { pnlUsd: Math.round(notional * ret), retPct: Math.round(ret * 10000) / 100 };
}
export function dossierStats(calls: {direction:"long"|"short";entry:number;latest:number;settled:boolean}[],
                             eth: {entry:number;latest:number}[]) {
  let totalPnl = 0, wins = 0, settled = 0, open = 0, benchmarkPnl = 0;
  calls.forEach((c, i) => {
    const { pnlUsd } = callPnl(c.entry, c.latest, c.direction);
    totalPnl += pnlUsd;
    c.settled ? (settled++, pnlUsd > 0 && wins++) : open++;
    const e = eth[i];
    if (e) benchmarkPnl += Math.round(NOTIONAL * (e.latest - e.entry) / e.entry);
  });
  return { totalPnl, winRate: settled ? Math.round(100 * wins / settled) : 0, benchmarkPnl, settled, open };
}
