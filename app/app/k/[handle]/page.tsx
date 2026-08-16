"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { VerdictBlock } from "@/components/VerdictBlock";
import { CallLedger } from "@/components/CallLedger";
import { CallDetail } from "@/components/CallDetail";
import { SaidVsDid } from "@/components/SaidVsDid";
import { EquityCurveChart } from "@/components/DitheredChart";
import { DitherArt } from "@/components/DitherArt";
import { AnimatedNumber, TokenPerfChart, ReturnsTimeline, DirectionSplit, Sparkline, SignalMix, MiniBars } from "@/components/DossierCharts";
import { PoweredBy } from "@/components/PoweredBy";
import { xProfileUrl } from "@/lib/xlink";
import type { Dossier, DossierCall } from "@/lib/dossier";

type Tab = "calls" | "said-vs-did";

function HeaderAvatar({ handle }: { handle: string }) {
  const [ok, setOk] = useState(true);
  const mg = handle.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "??";
  return (
    <span className="dossier-avatar pixel">
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://unavatar.io/twitter/${handle}`} alt="" width={72} height={72} onError={() => setOk(false)} />
      ) : (
        mg
      )}
    </span>
  );
}

function StatCard({ label, children, accent }: { label: string; children: ReactNode; accent?: string }) {
  return (
    <div style={{ background: "var(--surface)", padding: "14px 16px" }}>
      <div className="label">{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, marginTop: 6, color: accent ?? "var(--ink)" }}>
        {children}
      </div>
    </div>
  );
}

const TABS: { key: Tab; label: string }[] = [
  { key: "calls", label: "Calls" },
  { key: "said-vs-did", label: "Said vs. Did" },
];

export default function DossierPage() {
  const params = useParams<{ handle: string }>();
  const handle = params.handle;

  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DossierCall | null>(null);
  const [tab, setTab] = useState<Tab>("calls");

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    fetch(`/api/dossier/${handle}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<Dossier>;
      })
      .then((d) => {
        if (!cancelled) setDossier(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const curve = useMemo(() => {
    if (!dossier) return [];
    const sorted = [...dossier.calls].sort((a, b) => a.posted_at - b.posted_at);
    let cumCall = 0;
    let cumEth = 0;
    return sorted
      .filter((c) => c.pnlUsd != null)
      .map((c) => {
        cumCall += c.pnlUsd ?? 0;
        cumEth += c.ethPnlUsd ?? 0;
        return {
          date: new Date(c.posted_at * 1000).toLocaleDateString(),
          call: cumCall,
          eth: cumEth,
        };
      });
  }, [dossier]);

  const tokenData = useMemo(
    () => (dossier?.insights.byToken ?? []).slice(0, 6).map((t) => ({ asset: t.asset, avgRetPct: t.avgRetPct, count: t.count, winRate: t.winRate })),
    [dossier],
  );

  const returnsData = useMemo(() => {
    if (!dossier) return [];
    return [...dossier.calls]
      .filter((c) => c.retPct != null && !c.deleted_at)
      .sort((a, b) => a.posted_at - b.posted_at)
      .map((c) => ({
        label: new Date(c.posted_at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        retPct: Math.round(c.retPct as number),
        asset: c.asset_symbol ?? "—",
      }));
  }, [dossier]);

  const sparkValues = useMemo(() => curve.map((p) => p.call), [curve]);

  const templateSeg = useMemo(() => {
    const c: Record<string, number> = { DIRECTIONAL: 0, TARGET_CALL: 0, GEM_SHILL: 0, AMBIGUOUS: 0 };
    for (const call of dossier?.calls ?? []) if (call.template in c) c[call.template]++;
    return [
      { label: "directional", value: c.DIRECTIONAL, color: "var(--gain)" },
      { label: "target", value: c.TARGET_CALL, color: "var(--signal)" },
      { label: "gem shill", value: c.GEM_SHILL, color: "var(--loss)" },
      { label: "ambiguous", value: c.AMBIGUOUS, color: "var(--faint)" },
    ];
  }, [dossier]);

  const confBars = useMemo(() => {
    const b = [0, 0, 0, 0];
    for (const call of dossier?.calls ?? []) {
      const c = call.confidence;
      if (c < 0.3) b[0]++;
      else if (c < 0.6) b[1]++;
      else if (c < 0.8) b[2]++;
      else b[3]++;
    }
    return [
      { label: "lo", value: b[0] },
      { label: "·", value: b[1] },
      { label: "·", value: b[2] },
      { label: "hi", value: b[3] },
    ];
  }, [dossier]);

  function handleSelect(call: DossierCall) {
    setSelected(call);
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto" style={{ padding: "clamp(48px, 10vw, 110px) 24px 100px" }}>
        <div className="label flick">reading the ledger for @{handle}…</div>
      </div>
    );
  }
  if (error || !dossier) {
    return (
      <div className="max-w-4xl mx-auto" style={{ padding: "clamp(48px, 10vw, 110px) 24px 100px" }}>
        <div className="label" style={{ color: "var(--muted)" }}>no dossier on file for @{handle}.</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto" style={{ padding: "clamp(48px, 10vw, 110px) 24px 100px" }}>
      {/* ---- case file header (the first impression) ---- */}
      <header style={{ borderBottom: "1px solid var(--line)", paddingBottom: 28, marginBottom: 24, display: "flex", alignItems: "flex-start", gap: 22, flexWrap: "wrap" }}>
        <HeaderAvatar handle={dossier.handle} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="label">{"// dossier"}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(30px, 5.5vw, 52px)", margin: 0, lineHeight: 1 }}>
              <span style={{ color: "var(--faint)" }}>@</span>
              {dossier.handle}
            </h1>
            {(() => {
              const s = dossier.stats;
              const hp = Math.round((10000 * s.totalPnl) / (1000 * Math.max(s.settled, 1))) / 100;
              const neg = hp < 0;
              return (
                <span
                  className="tnum"
                  style={{
                    fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700,
                    color: neg ? "var(--loss)" : "var(--gain)",
                    border: `1px solid color-mix(in oklch, ${neg ? "var(--loss)" : "var(--gain)"} 45%, var(--line))`,
                    background: `color-mix(in oklch, ${neg ? "var(--loss)" : "var(--gain)"} 9%, var(--surface))`,
                    borderRadius: 999, padding: "5px 12px",
                  }}
                >
                  {neg ? "" : "+"}{hp}% track record
                </span>
              );
            })()}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <span className="chip tnum">{dossier.insights.scoredCalls}/{dossier.insights.totalCalls} scored</span>
            <span className="chip tnum">{dossier.stats.winRate}% win</span>
            <span className="chip tnum" style={{ color: dossier.insights.contradictionRate > 0 ? "var(--loss)" : undefined, borderColor: dossier.insights.contradictionRate > 0 ? "color-mix(in oklch, var(--loss) 40%, var(--line))" : undefined }}>
              {dossier.insights.contradictionRate}% wallet-contradicts
            </span>
            <span className="chip tnum">{dossier.insights.callsPerWeek}/wk</span>
          </div>
          <a
            href={xProfileUrl(dossier.handle)}
            target="_blank"
            rel="noopener noreferrer"
            className="label link"
            style={{ display: "inline-block", marginTop: 14 }}
          >
            view on x ↗
          </a>
        </div>
      </header>

      {/* thesis band — dither accent tying the dossier to the product line */}
      <div
        style={{
          position: "relative",
          height: 88,
          background: "var(--dark)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
          marginBottom: 32,
        }}
      >
        <DitherArt shape="signal" invert gap={4} className="h-full w-full" />
        {/* left scrim so the caption stays legible over the grain */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, var(--dark) 0%, color-mix(in oklch, var(--dark) 55%, transparent) 26%, transparent 44%)", pointerEvents: "none" }} />
        <div
          className="label"
          style={{
            position: "absolute",
            top: "50%",
            left: 16,
            transform: "translateY(-50%)",
            color: "var(--dark-ink)",
            opacity: 0.9,
          }}
        >
          separating signal from the noise
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, alignItems: "stretch", marginBottom: 24 }}>
        <VerdictBlock stats={dossier.stats} />
        <div className="panel rise" style={{ padding: 16, display: "grid", gap: 16, alignContent: "center" }}>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>{"// cumulative p&amp;l per call"}</div>
            <Sparkline values={sparkValues} positive={dossier.stats.totalPnl >= 0} />
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>{"// signal mix"}</div>
            <SignalMix segments={templateSeg} />
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>{"// confidence spread"}</div>
            <MiniBars bars={confBars} />
          </div>
        </div>
      </div>

      {dossier.integrity.deletedTotal > 0 && (
        <p
          className="tnum"
          style={{
            fontSize: 13,
            color: "var(--loss)",
            border: "1px solid color-mix(in oklch, var(--loss) 45%, var(--line))",
            background: "color-mix(in oklch, var(--loss) 8%, var(--surface))",
            borderRadius: "var(--radius)",
            padding: "10px 14px",
            marginBottom: 32,
          }}
        >
          Deleted {dossier.integrity.deletedTotal} call
          {dossier.integrity.deletedTotal === 1 ? "" : "s"} · avg{" "}
          {dossier.integrity.deletedAvgRetPct >= 0 ? "+" : ""}
          {dossier.integrity.deletedAvgRetPct}% · $
          {Math.abs(dossier.integrity.deletedHiddenLoss).toLocaleString()} hidden
        </p>
      )}

      {/* ---- animated stat strip ---- */}
      <div
        style={{
          marginBottom: 18,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
          gap: 1,
          background: "var(--line)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        <StatCard label="Win rate"><AnimatedNumber value={dossier.stats.winRate} suffix="%" /></StatCard>
        <StatCard label="Settled"><AnimatedNumber value={dossier.stats.settled} /></StatCard>
        <StatCard label="Scored / total">
          <AnimatedNumber value={dossier.insights.scoredCalls} />
          <span style={{ color: "var(--faint)" }}>/</span>
          <AnimatedNumber value={dossier.insights.totalCalls} />
        </StatCard>
        <StatCard label="Wallet contradicts" accent={dossier.insights.contradictionRate > 0 ? "var(--loss)" : "var(--ink)"}>
          <AnimatedNumber value={dossier.insights.contradictionRate} suffix="%" />
        </StatCard>
        <StatCard label="Cadence">
          <AnimatedNumber value={dossier.insights.callsPerWeek} decimals={1} />
          <span style={{ fontSize: 13, color: "var(--muted)" }}>/wk</span>
        </StatCard>
        {dossier.integrity.deletedTotal > 0 && (
          <StatCard label="Hidden loss" accent="var(--loss)">
            <AnimatedNumber value={Math.abs(dossier.integrity.deletedHiddenLoss)} prefix="$" />
          </StatCard>
        )}
      </div>

      {/* ---- analytics dashboard ---- */}
      {dossier.insights.scoredCalls > 0 && (
        <div style={{ marginBottom: 40 }}>
          {curve.length > 0 && (
            <div className="panel rise" style={{ padding: "18px 18px 8px", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
                <div className="label" style={{ marginBottom: 0 }}>{"// equity curve · $1,000 per call vs holding FLR"}</div>
                <PoweredBy protocol="ftso" label="pricing via" />
              </div>
              <EquityCurveChart data={curve} positive={dossier.stats.totalPnl >= 0} />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            <div className="panel rise" style={{ padding: 18 }}>
              <div className="label" style={{ marginBottom: 12 }}>{"// per-token performance (avg %)"}</div>
              <TokenPerfChart data={tokenData} />
            </div>
            <div className="panel rise" style={{ padding: 18 }}>
              <div className="label" style={{ marginBottom: 12 }}>{"// per-call outcomes"}</div>
              <ReturnsTimeline data={returnsData} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginTop: 16 }}>
            <div className="panel rise" style={{ padding: 18 }}>
              <div className="label" style={{ marginBottom: 14 }}>{"// direction bias"}</div>
              <DirectionSplit longPct={dossier.insights.longPct} />
              {dossier.insights.bestCall && (
                <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                  <span className="label">best / worst</span>
                  <span className="tnum" style={{ fontSize: 13 }}>
                    <span style={{ color: "var(--gain)" }}>{dossier.insights.bestCall.asset} +{dossier.insights.bestCall.retPct}%</span>
                    <span style={{ color: "var(--faint)" }}> / </span>
                    <span style={{ color: "var(--loss)" }}>{dossier.insights.worstCall!.asset} {dossier.insights.worstCall!.retPct}%</span>
                  </span>
                </div>
              )}
            </div>
            <div className="panel rise" style={{ padding: 0, overflow: "hidden", position: "relative", minHeight: 172, display: "flex" }}>
              <div style={{ position: "absolute", inset: 0, background: "var(--dark)" }}>
                <DitherArt shape="loop" invert gap={5} className="h-full w-full" />
              </div>
              <div style={{ position: "relative", padding: 18, color: "var(--dark-ink)", alignSelf: "flex-end" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 34, lineHeight: 1 }}>
                  <AnimatedNumber value={dossier.insights.contradictionRate} suffix="%" />
                </div>
                <div className="label" style={{ color: "var(--dark-ink)", opacity: 0.8, marginTop: 6 }}>
                  of calls their own wallet traded against
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 4, marginBottom: 28, borderBottom: "1px solid var(--line)" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="label"
            style={{
              padding: "10px 14px",
              marginBottom: -1,
              cursor: "pointer",
              background: "transparent",
              border: 0,
              borderBottom: `2px solid ${tab === t.key ? "var(--ink)" : "transparent"}`,
              color: tab === t.key ? "var(--ink)" : "var(--faint)",
              transition: "color 0.18s var(--ease-out-quart)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "calls" && (
        <>
          <CallLedger calls={dossier.calls} onSelect={handleSelect} handle={dossier.handle} />

          {selected && <CallDetail call={selected} onClose={() => setSelected(null)} handle={dossier.handle} />}
        </>
      )}

      {tab === "said-vs-did" && <SaidVsDid data={dossier.saidVsDid} handle={dossier.handle} />}
    </div>
  );
}
