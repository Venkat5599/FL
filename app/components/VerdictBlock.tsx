export function VerdictBlock({ stats }: { stats: {totalPnl:number;benchmarkPnl:number;winRate:number;settled:number} }) {
  const neg = stats.totalPnl < 0;
  return (
    <div style={{ padding: "32px 0 28px" }}>
      <div className="label" style={{ marginBottom: 12 }}>// the verdict</div>
      <div
        className="tnum"
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "clamp(52px, 12vw, 92px)",
          lineHeight: 0.95,
          letterSpacing: "-0.02em",
          color: neg ? "var(--loss)" : "var(--gain)",
        }}
      >
        {stats.totalPnl >= 0 ? "+" : ""}{(100 * stats.totalPnl / (1000 * Math.max(stats.settled,1))).toFixed(1)}%
      </div>
      <p className="tnum" style={{ marginTop: 16, fontSize: 15, color: "var(--muted)", maxWidth: "60ch", lineHeight: 1.7 }}>
        $1,000 into every call → ${(1000 * stats.settled + stats.totalPnl).toLocaleString()}.
        Holding ETH instead → ${(1000 * stats.settled + stats.benchmarkPnl).toLocaleString()}.
      </p>
      <p className="label tnum" style={{ marginTop: 8 }}>{stats.settled} settled calls · {stats.winRate}% win rate</p>
    </div>);
}
