"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { DitherArt } from "@/components/DitherArt";
import { PoweredBy } from "@/components/PoweredBy";
import { DeployedOverTimeChart, CreatorDeployedChart, CopyFadeDonut, TradeStatusChart, type DeployPoint } from "@/components/PortfolioCharts";
import { netCfg, isNetwork } from "@/lib/networks";

interface PortfolioTrade {
  creator_handle: string;
  mode: "copy" | "fade" | string;
  token_symbol: string | null;
  side: string | null;
  amount_usd: number | null;
  entry_price_usd: number | null;
  tx_hash: string | null;
  status: string | null;
  yield_usd: number | null;
  network: string | null;
  in_amount: number | null;
  in_symbol: string | null;
  out_amount: number | null;
  out_symbol: string | null;
  reason: string | null;
  created_at: string | number | null;
}

interface CreatorRow {
  handle: string;
  trades: number;
  executed: number;
  pnlUsd: number;
  deployedUsdc: number;
  copies: number;
  fades: number;
}

interface PortfolioResponse {
  summary: {
    totalTrades: number;
    executed: number;
    failed: number;
    pending: number;
    copies: number;
    fades: number;
    deployedUsdc: number;
    totalPnlUsd: number;
    winRate: number | null;
    wins: number;
    losses: number;
    settledCount: number;
    bestUsd: number | null;
    worstUsd: number | null;
  };
  byCreator: CreatorRow[];
  trades: PortfolioTrade[];
}

function fmtDate(value: string | number | null) {
  if (value == null) return "—";
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}
function fmtUsd(v: number | null) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;
}
function fmtTok(v: number) {
  if (v >= 1) return v.toFixed(2);
  if (v === 0) return "0";
  return v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
function txUrl(hash: string, network: string | null) {
  const cfg = netCfg(isNetwork(network) ? network : "testnet");
  return `${cfg.explorer}/tx/${hash}`;
}
function toMs(value: string | number | null): number {
  if (value == null) return 0;
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
function fmtShortDate(value: string | number | null) {
  if (value == null) return "—";
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// The USDC that actually moved on an executed trade — mirrors the API's usdcLeg
// so the chart's cumulative curve matches the "USDC deployed" stat exactly.
function usdcLeg(t: PortfolioTrade): number {
  if (t.in_symbol === "USDC" && t.in_amount != null) return t.in_amount;
  if (t.out_symbol === "USDC" && t.out_amount != null) return t.out_amount;
  return 0;
}

const th: React.CSSProperties = { textAlign: "left", padding: "10px 14px", borderBottom: "1px solid var(--line-strong)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 14px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const btnPrimary: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
  border: "1px solid var(--ink)", borderRadius: "var(--radius)", padding: "10px 22px",
  background: "var(--ink)", color: "var(--bg)", cursor: "pointer",
};

function StatCell({ label, children, big, accent }: { label: string; children: React.ReactNode; big?: boolean; accent?: string }) {
  return (
    <div style={{ background: "var(--bg)", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="label" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="tnum" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: big ? 34 : 24, lineHeight: 1, color: accent ?? "var(--ink)" }}>
        {children}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const executed = status === "executed" || status === "sent";
  const failed = status === "failed";
  const color = executed ? "var(--gain)" : failed ? "var(--loss)" : "var(--muted)";
  return <span className="label" style={{ color }}>{executed ? "● executed" : failed ? "● failed" : `● ${status ?? "—"}`}</span>;
}

export default function PortfolioPage() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/portfolio", { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (!res.ok) throw new Error(`${res.status}`);
      setData((await res.json()) as PortfolioResponse);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const s = data?.summary;
  const pnlPositive = (s?.totalPnlUsd ?? 0) >= 0;
  const maxDeployed = Math.max(0.0001, ...(data?.byCreator.map((c) => c.deployedUsdc) ?? [1]));
  const copyPct = s && s.copies + s.fades > 0 ? Math.round((s.copies / (s.copies + s.fades)) * 100) : 0;

  const deployPoints: DeployPoint[] = (data?.trades ?? [])
    .filter((t) => t.status === "executed" || t.status === "sent" || !!t.tx_hash)
    .slice()
    .sort((a, b) => toMs(a.created_at) - toMs(b.created_at))
    .map((t) => ({ label: fmtShortDate(t.created_at), amount: usdcLeg(t) }));

  return (
    <main className="mx-auto max-w-6xl px-6" style={{ padding: "clamp(48px, 10vw, 110px) 24px 100px" }}>
      <div className="label" style={{ marginBottom: 10 }}>// copy/fade performance · settled on Base · priced via The Graph</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "1px solid var(--line)", paddingBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: "clamp(32px, 6vw, 56px)" }}>Portfolio</h1>
        {ready && authenticated && (
          <button className="label" onClick={() => void load()} style={{ border: "1px solid var(--line-strong)", borderRadius: "var(--radius)", padding: "7px 14px", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>
            ↻ refresh
          </button>
        )}
      </div>

      {!ready && <div className="label flick" style={{ padding: "40px 0" }}>loading auth…</div>}

      {ready && !authenticated && (
        <div className="panel" style={{ marginTop: 40, padding: "28px 26px", maxWidth: 480 }}>
          <p className="label" style={{ marginBottom: 16 }}>authentication required</p>
          <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>Log in to see your copy/fade trade history and performance.</p>
          <button style={btnPrimary} onClick={() => login()}>Log in</button>
        </div>
      )}

      {ready && authenticated && (
        <>
          {loading && !data && <div className="label flick" style={{ padding: "40px 0" }}>loading portfolio…</div>}
          {!loading && error && <div className="label" style={{ padding: "40px 0", color: "var(--loss)" }}>could not load portfolio ({error})</div>}

          {data && s && (
            <>
              {/* ---- analytics (6 cells → clean 3-wide grid, collapses on mobile) ---- */}
              <div style={{ marginTop: 36, display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", background: "var(--line)", border: "1px solid var(--line)" }}>
                <StatCell label="net P&L" big accent={pnlPositive ? "var(--gain)" : "var(--loss)"}>
                  {fmtUsd(s.totalPnlUsd)}
                </StatCell>
                <StatCell label="win rate">
                  {s.winRate == null ? "—" : `${Math.round(s.winRate * 100)}%`}
                  <span className="label" style={{ display: "block", marginTop: 6, color: "var(--faint)", fontFamily: "var(--font-mono)", fontWeight: 400, fontSize: 10 }}>
                    {s.settledCount === 0 ? "no settled trades yet" : `${s.wins}W · ${s.losses}L of ${s.settledCount}`}
                  </span>
                </StatCell>
                <StatCell label="USDC deployed">
                  {s.deployedUsdc.toFixed(2)}
                  <span className="label" style={{ display: "block", marginTop: 6, color: "var(--faint)", fontFamily: "var(--font-mono)", fontWeight: 400, fontSize: 10 }}>
                    real on-chain · executed only
                  </span>
                </StatCell>
                <StatCell label="trades executed">
                  {s.executed}
                  <span className="label" style={{ display: "block", marginTop: 6, color: "var(--faint)", fontFamily: "var(--font-mono)", fontWeight: 400, fontSize: 10 }}>
                    of {s.totalTrades}{s.failed ? ` · ${s.failed} failed` : ""}{s.pending ? ` · ${s.pending} pending` : ""}
                  </span>
                </StatCell>
                <StatCell label="copy / fade">
                  <span style={{ color: "var(--gain)" }}>{s.copies}</span>
                  <span style={{ color: "var(--faint)" }}> / </span>
                  <span style={{ color: "var(--loss)" }}>{s.fades}</span>
                  <div style={{ marginTop: 10, height: 5, borderRadius: 3, overflow: "hidden", background: "var(--loss)", display: "flex" }}>
                    <div style={{ width: `${copyPct}%`, background: "var(--gain)" }} />
                  </div>
                </StatCell>
                <StatCell label="best / worst" accent={undefined}>
                  <span style={{ color: "var(--gain)", fontSize: 20 }}>{s.bestUsd == null ? "—" : fmtUsd(s.bestUsd)}</span>
                  <span className="label" style={{ display: "block", marginTop: 6, color: "var(--loss)", fontFamily: "var(--font-mono)", fontWeight: 400, fontSize: 12 }}>
                    {s.worstUsd == null ? "—" : fmtUsd(s.worstUsd)}
                  </span>
                </StatCell>
              </div>

              {/* ---- capital deployed over time ---- */}
              <section style={{ marginTop: 52 }}>
                <div className="label" style={{ marginBottom: 16 }}>// capital deployed over time</div>
                <div className="panel rise" style={{ padding: "20px 20px 12px" }}>
                  <DeployedOverTimeChart points={deployPoints} />
                </div>
              </section>

              {/* ---- signal mix + trade status ---- */}
              <section style={{ marginTop: 40 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
                  <div className="panel rise" style={{ padding: 20 }}>
                    <div className="label" style={{ marginBottom: 16 }}>// copy vs fade</div>
                    <CopyFadeDonut copies={s.copies} fades={s.fades} />
                  </div>
                  <div className="panel rise" style={{ padding: 20 }}>
                    <div className="label" style={{ marginBottom: 16 }}>// trade status</div>
                    <TradeStatusChart executed={s.executed} pending={s.pending} failed={s.failed} />
                  </div>
                </div>
              </section>

              {/* ---- by creator ---- */}
              {data.byCreator.length > 0 && (
                <section style={{ marginTop: 52 }}>
                  <div className="label" style={{ marginBottom: 16 }}>// performance by creator</div>
                  <div className="panel rise" style={{ padding: "18px 20px 8px", marginBottom: 20 }}>
                    <CreatorDeployedChart data={data.byCreator} />
                  </div>
                  <div style={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", background: "var(--line)", border: "1px solid var(--line)" }}>
                    {data.byCreator.map((c) => {
                      const cp = c.pnlUsd >= 0;
                      return (
                        <div key={c.handle} style={{ background: "var(--bg)", padding: "18px 20px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14 }}>@{c.handle}</span>
                            <span className="tnum" style={{ color: cp ? "var(--gain)" : "var(--loss)", fontSize: 14 }}>{fmtUsd(c.pnlUsd)}</span>
                          </div>
                          <div className="label" style={{ marginTop: 6, color: "var(--muted)" }}>
                            {c.executed}/{c.trades} executed · {c.copies} copy · {c.fades} fade
                          </div>
                          <div style={{ marginTop: 12, height: 6, borderRadius: 3, background: "var(--line)", overflow: "hidden" }}>
                            <div style={{ width: `${Math.round((c.deployedUsdc / maxDeployed) * 100)}%`, height: "100%", background: "var(--ink)" }} />
                          </div>
                          <div className="label tnum" style={{ marginTop: 6, color: "var(--faint)", fontSize: 10 }}>{c.deployedUsdc.toFixed(2)} USDC deployed</div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ---- ledger ---- */}
              <section style={{ marginTop: 52 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div className="label">// ledger · every fill</div>
                  <PoweredBy sponsor="uniswap" label="executed via" size={0.85} />
                </div>

                {data.trades.length === 0 ? (
                  <div style={{ position: "relative", width: "100%", height: 200, background: "var(--dark)", borderRadius: "var(--radius)", overflow: "hidden" }}>
                    <div style={{ position: "absolute", inset: 0 }}>
                      <DitherArt shape="field" invert gap={4} className="h-full w-full" />
                    </div>
                    <div className="label" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--dark-ink)", opacity: 0.85, textAlign: "center", padding: 20 }}>
                      no trades yet · enable auto-trading and follow a call to start
                    </div>
                  </div>
                ) : (
                  <div className="panel" style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                      <thead>
                        <tr className="label">
                          <th style={th}>Creator</th>
                          <th style={th}>Signal</th>
                          <th style={th}>Trade (in → out)</th>
                          <th style={{ ...th, textAlign: "right" }}>P&L</th>
                          <th style={th}>Status</th>
                          <th style={th}>Chain</th>
                          <th style={th}>Tx</th>
                          <th style={th}>When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.trades.map((t, i) => {
                          const exec = t.status === "executed" || t.status === "sent" || !!t.tx_hash;
                          const realized = t.yield_usd != null && t.yield_usd !== 0;
                          const yp = (t.yield_usd ?? 0) >= 0;
                          return (
                            <tr key={t.tx_hash ?? i}>
                              <td style={td}><span style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>@{t.creator_handle}</span></td>
                              <td style={td}>
                                <span className="label" style={{ color: t.mode === "fade" ? "var(--loss)" : "var(--gain)" }}>{t.mode}</span>
                                <span className="label" style={{ color: "var(--muted)", marginLeft: 6 }}>{t.token_symbol ? `$${t.token_symbol}` : ""} {t.side ?? ""}</span>
                              </td>
                              <td style={td}>
                                {exec && t.in_amount != null ? (
                                  <span className="tnum" style={{ fontSize: 12 }}>
                                    {fmtTok(t.in_amount)} {t.in_symbol}
                                    <span style={{ color: "var(--faint)" }}> → </span>
                                    {t.out_amount != null ? `${fmtTok(t.out_amount)} ${t.out_symbol}` : "…"}
                                  </span>
                                ) : (
                                  <span className="label" style={{ color: "var(--muted)", whiteSpace: "normal", display: "inline-block", maxWidth: 320 }}>
                                    {t.reason ? `no fill · ${t.reason}` : exec ? "executed" : "no fill"}
                                  </span>
                                )}
                              </td>
                              <td className={`tnum ${realized ? (yp ? "gain" : "loss") : ""}`} style={{ ...td, textAlign: "right", color: realized ? undefined : "var(--faint)" }}>{!exec ? "—" : realized ? fmtUsd(t.yield_usd) : "open"}</td>
                              <td style={td}><StatusPill status={t.status} /></td>
                              <td style={td}><span className="label" style={{ color: "var(--faint)", textTransform: "uppercase" }}>{isNetwork(t.network) ? netCfg(t.network).chainName : "—"}</span></td>
                              <td className="tnum" style={td}>
                                {t.tx_hash ? (
                                  <a href={txUrl(t.tx_hash, t.network)} target="_blank" rel="noopener noreferrer" className="link" style={{ color: "var(--ink)", textDecoration: "none", borderBottom: "1px solid var(--line-strong)" }} title="view on explorer">
                                    {t.tx_hash.slice(0, 6)}…{t.tx_hash.slice(-4)} ↗
                                  </a>
                                ) : (
                                  <span style={{ color: "var(--faint)" }}>—</span>
                                )}
                              </td>
                              <td className="label" style={td}>{fmtDate(t.created_at)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
