"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePrivy, useSigners, useWallets } from "@privy-io/react-auth";
import { useNetwork } from "@/components/NetworkProvider";
import { DitherArt } from "@/components/DitherArt";
import { CallTweet } from "@/components/CallTweet";
import { CreatorSearch } from "@/components/CreatorSearch";
import type { FeedCall } from "@/app/api/feed/route";
import type { InfluencerSummary } from "@/app/api/influencers/route";

type Filter = "all" | "signals" | "conviction";

function MiniAvatar({ handle }: { handle: string }) {
  const [ok, setOk] = useState(true);
  const mg = handle.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "??";
  return (
    <span className="mini-avatar pixel">
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://unavatar.io/twitter/${handle}`} alt="" width={34} height={34} onError={() => setOk(false)} />
      ) : (
        mg
      )}
    </span>
  );
}


const POLL_MS = 10_000;

export default function TerminalPage() {
  // Guard auth-dependent UI until after mount so the first client render matches
  // the server (authenticated is false on the server, avoiding a hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { addSigners } = useSigners();
  const { network } = useNetwork();
  const signerId = process.env.NEXT_PUBLIC_PRIVY_AUTH_ID_2;
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const canTrade = mounted && ready && authenticated;
  const [calls, setCalls] = useState<FeedCall[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("signals");
  const [yapMode, setYapMode] = useState(false);
  const [query, setQuery] = useState("");
  const [creators, setCreators] = useState<InfluencerSummary[] | null>(null);
  const [trade, setTrade] = useState<Record<number, { pending?: boolean; ok?: boolean; msg: string; txHash?: string; network?: string }>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/feed")
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.json() as Promise<{ calls: FeedCall[] }>;
        })
        .then((data) => {
          if (!cancelled) {
            setCalls(data.calls);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    load();
    timerRef.current = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // creators for the "who to fade or follow" rail
  useEffect(() => {
    let cancelled = false;
    fetch("/api/influencers")
      .then((r) => (r.ok ? (r.json() as Promise<InfluencerSummary[]>) : []))
      .then((d) => !cancelled && setCreators(d))
      .catch(() => !cancelled && setCreators([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(() => {
    let all = calls ?? [];
    if (filter === "signals") all = all.filter((c) => c.template !== "AMBIGUOUS");
    else if (filter === "conviction") all = all.filter((c) => c.confidence >= 0.7);
    const q = query.trim().toLowerCase();
    if (q) {
      all = all.filter(
        (c) =>
          c.handle.toLowerCase().includes(q) ||
          (c.display_name?.toLowerCase().includes(q) ?? false) ||
          (c.asset_symbol?.toLowerCase().includes(q) ?? false) ||
          c.content.toLowerCase().includes(q),
      );
    }
    return all;
  }, [calls, filter, query]);

  // trending tickers, aggregated from the live feed
  const trending = useMemo(() => {
    const map = new Map<string, { count: number; long: number; short: number }>();
    for (const c of calls ?? []) {
      if (!c.asset_symbol) continue;
      const e = map.get(c.asset_symbol) ?? { count: 0, long: 0, short: 0 };
      e.count++;
      if (c.direction === "long") e.long++;
      else if (c.direction === "short") e.short++;
      map.set(c.asset_symbol, e);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 6);
  }, [calls]);

  const stats = useMemo(() => {
    const all = calls ?? [];
    const verified = all.filter((c) => c.ai?.verified).length;
    const signals = all.filter((c) => c.template !== "AMBIGUOUS").length;
    return { total: all.length, verified, signals };
  }, [calls]);

  // One-click copy (follow) / fade. Fully automated: if the wallet isn't yet
  // delegated for auto-trading, we run the one-time delegation consent inline
  // and then execute — no manual swap form, ever.
  async function doTrade(callId: number, mode: "copy" | "fade", retried = false) {
    if (!ready) return;
    if (!authenticated) {
      login();
      return;
    }
    setTrade((s) => ({ ...s, [callId]: { pending: true, msg: mode === "fade" ? "fading…" : "copying…" } }));
    try {
      const token = await getAccessToken();
      const r = await fetch(`/api/trade/${callId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ mode, network }),
      });
      const d = (await r.json()) as { status?: string; txHash?: string; reason?: string; needsDelegation?: boolean };
      if (d.status === "no_pool") {
        // No tradeable pool on the active network — say so immediately, no form.
        setTrade((s) => ({ ...s, [callId]: { msg: d.reason || "no pool available on this network" } }));
      } else if (d.needsDelegation) {
        // Not delegated yet → run the one-time "enable auto-trading" consent,
        // then retry the trade automatically. No token-address form.
        if (retried || !embeddedWallet || !signerId) {
          setTrade((s) => ({ ...s, [callId]: { msg: "enable auto-trading (top bar) to trade" } }));
          return;
        }
        setTrade((s) => ({ ...s, [callId]: { pending: true, msg: "enabling auto-trading…" } }));
        try {
          await addSigners({ address: embeddedWallet.address, signers: [{ signerId }] });
        } catch {
          setTrade((s) => ({ ...s, [callId]: { msg: "auto-trading not enabled — trade cancelled" } }));
          return;
        }
        await doTrade(callId, mode, true);
      } else if (d.status === "executed" || d.status === "sent" || d.txHash) {
        setTrade((s) => ({ ...s, [callId]: { ok: true, msg: `${mode === "fade" ? "faded" : "copied"} ✓`, txHash: d.txHash, network } }));
      } else {
        setTrade((s) => ({ ...s, [callId]: { msg: d.reason || d.status || "could not place trade" } }));
      }
    } catch {
      setTrade((s) => ({ ...s, [callId]: { msg: "trade request failed" } }));
    }
  }

  return (
    <main className="mx-auto px-6" style={{ maxWidth: 1240, padding: "clamp(40px, 8vw, 96px) 24px 100px" }}>
      {/* ---- TOP: X/Twitter-style creator search ---- */}
      <div style={{ maxWidth: 680, margin: "0 auto clamp(28px, 5vw, 44px)" }}>
        <div className="label" style={{ textAlign: "center", marginBottom: 10, color: "var(--muted)" }}>
          // search the terminal
        </div>
        <CreatorSearch
          creators={(creators ?? []).map((c) => ({ handle: c.handle, display_name: c.display_name }))}
          onSelect={(h) => setQuery(`@${h}`)}
          placeholder="Search creators — @handle or name"
        />
      </div>

      <div className="term-grid">
        {/* ---- LEFT RAIL ---- */}
        <aside className="term-left">
          <div className="term-sticky">
            <div className="label" style={{ marginBottom: 8 }}>// live feed</div>
            <h1 style={{ fontSize: 30, lineHeight: 1, marginBottom: 14 }}>Terminal</h1>
            <div className="label" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", marginBottom: 20 }}>
              <span className="flick" style={{ color: "var(--signal)", fontSize: 14, lineHeight: 1 }}>●</span>
              live · polls every 10s
            </div>

            <div className="label" style={{ marginBottom: 8 }}>search feed</div>
            <div className="term-search" style={{ marginBottom: 20 }}>
              <span aria-hidden style={{ color: "var(--faint)" }}>⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="handle, $ticker, text"
                aria-label="Search the feed"
              />
              {query && (
                <button aria-label="clear search" onClick={() => setQuery("")} style={{ background: "none", border: 0, color: "var(--faint)", cursor: "pointer", fontSize: 12 }}>✕</button>
              )}
            </div>

            <div className="label" style={{ marginBottom: 8 }}>filter</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
              {([
                ["all", `All calls`],
                ["signals", `Signals only`],
                ["conviction", `High conviction`],
              ] as [Filter, string][]).map(([key, lbl]) => (
                <button key={key} className={`filter-pill ${filter === key ? "filter-on" : ""}`} onClick={() => setFilter(key)}>
                  {lbl}
                </button>
              ))}
            </div>

            <div className="side-card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ position: "relative", height: 84, background: "var(--dark)" }}>
                <DitherArt shape="arrows" invert gap={4} className="h-full w-full" />
              </div>
              <div style={{ padding: "12px 14px" }}>
                <div className="label" style={{ color: "var(--muted)" }}>signal integrity</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12 }} className="tnum">
                  <span className="label">indexed</span><span>{stats.total}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 12 }} className="tnum">
                  <span className="label">tee-verified</span><span style={{ color: "var(--gain)" }}>{stats.verified}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 12 }} className="tnum">
                  <span className="label">real signals</span><span>{stats.signals}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ---- CENTER FEED ---- */}
        <div className="term-center">
          <div className="term-feed-head" style={{ flexWrap: "wrap", rowGap: 12 }}>
            <button
              onClick={() => setYapMode((v) => !v)}
              title="0-yap: strip the noise, show only the enclave-distilled trade logic"
              aria-pressed={yapMode}
              style={{
                display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", alignSelf: "center",
                border: `1.5px solid ${yapMode ? "var(--ink)" : "var(--line-strong)"}`,
                borderRadius: 999,
                padding: "5px 16px 5px 5px",
                background: yapMode ? "var(--ink)" : "var(--surface)",
                color: yapMode ? "var(--bg)" : "var(--ink)",
                boxShadow: yapMode ? "0 0 0 3px color-mix(in oklch, var(--signal) 28%, transparent)" : "none",
                transition: "background 0.18s, border-color 0.18s, box-shadow 0.18s",
              }}
            >
              <span
                style={{
                  display: "grid", placeItems: "center", flexShrink: 0,
                  width: 28, height: 28, borderRadius: "50%",
                  background: yapMode ? "var(--bg)" : "var(--dark)",
                }}
              >
                <span
                  aria-label="Flare Confidential Compute"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: "0.06em",
                    opacity: yapMode ? 1 : 0.9,
                  }}
                >
                  FCC
                </span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 13, letterSpacing: "0.02em" }}>
                  0-YAP
                  {yapMode && <span className="flick" style={{ color: "var(--signal)", fontSize: 10 }}>●</span>}
                </span>
                <span
                  className="label"
                  style={{
                    fontSize: 9,
                    color: yapMode ? "color-mix(in oklch, var(--bg) 65%, transparent)" : "var(--muted)",
                  }}
                >
                  {yapMode ? "noise off · distilled in-enclave" : "distilled in-enclave — strip the noise"}
                </span>
              </span>
            </button>
            <span className="tnum" style={{ alignSelf: "center" }}>{shown.length} {filter === "all" ? "calls" : filter === "signals" ? "signals" : "high-conviction calls"}</span>
            {!canTrade && <span className="label" style={{ color: "var(--muted)", alignSelf: "center" }}>log in to fade or follow</span>}
          </div>

          {loading && <div className="label flick" style={{ padding: "48px 0" }}>reading the feed…</div>}
          {!loading && error && (
            <div className="label" style={{ padding: "48px 0", color: "var(--loss)" }}>could not load feed ({error})</div>
          )}
          {!loading && !error && shown.length === 0 && (
            <div className="label" style={{ padding: "48px 0", color: "var(--muted)" }}>nothing matches this filter.</div>
          )}

          {!loading && !error && shown.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {shown.map((c, i) => (
                <div key={c.call_id} className="rise" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                  <CallTweet
                    call={c}
                    connected={canTrade}
                    yapMode={yapMode}
                    tradeStatus={trade[c.call_id]}
                    onFade={() => doTrade(c.call_id, "fade")}
                    onFollow={() => doTrade(c.call_id, "copy")}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- RIGHT SIDEBAR ---- */}
        <aside className="term-right">
          <div className="term-sticky">
            {/* who to fade or follow */}
            <div className="side-card">
              <div className="label" style={{ marginBottom: 12 }}>who to fade or follow</div>
              {(creators ?? []).slice(0, 5).map((c) => {
                const neg = c.headlinePct < 0;
                return (
                  <Link key={c.handle} href={`/k/${c.handle}`} className="wtf-row">
                    <MiniAvatar handle={c.handle} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.display_name || c.handle}
                      </span>
                      <span className="label">@{c.handle}</span>
                    </span>
                    <span className="tnum" style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: neg ? "var(--loss)" : "var(--gain)" }}>
                      {neg ? "" : "+"}{c.headlinePct}%
                    </span>
                  </Link>
                );
              })}
              {creators && creators.length === 0 && <div className="label" style={{ color: "var(--muted)" }}>no creators yet.</div>}
              {!creators && <div className="label flick">loading…</div>}
            </div>

            {/* trending tickers */}
            <div className="side-card" style={{ marginTop: 14 }}>
              <div className="label" style={{ marginBottom: 12 }}>trending tickers</div>
              {trending.length === 0 && <div className="label" style={{ color: "var(--muted)" }}>no tickers yet.</div>}
              {trending.map(([sym, e], i) => {
                const bias = e.long === e.short ? "mixed" : e.long > e.short ? "long" : "short";
                const biasColor = bias === "long" ? "var(--gain)" : bias === "short" ? "var(--loss)" : "var(--faint)";
                return (
                  <div key={sym} className="trend-row">
                    <span className="label" style={{ width: 18, color: "var(--faint)" }}>{i + 1}</span>
                    <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink)" }}>${sym}</span>
                    <span className="label" style={{ color: biasColor }}>{bias}</span>
                    <span className="label tnum" style={{ width: 42, textAlign: "right" }}>{e.count} call{e.count === 1 ? "" : "s"}</span>
                  </div>
                );
              })}
            </div>

            <div className="label" style={{ marginTop: 16, color: "var(--faint)", lineHeight: 1.6 }}>
              every call is scored against real DEX prices and cross-checked against the caller&apos;s own wallet.
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
