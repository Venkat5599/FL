"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { DitherArt } from "@/components/DitherArt";
import { CreatorSearch, type CreatorOption } from "@/components/CreatorSearch";

type Mode = "copy" | "fade";

interface Override {
  id: number;
  handle: string;
  displayName: string | null;
  mode: Mode;
  quickUsd: number;
  active: number;
}

const fieldControl: React.CSSProperties = {
  width: "100%", background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: "var(--radius)",
  color: "var(--ink)", fontFamily: "var(--font-mono)", fontSize: 14, padding: "10px 12px", outline: "none",
};
const btn: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
  border: "1px solid var(--ink)", borderRadius: "var(--radius)", padding: "10px 20px",
  background: "var(--ink)", color: "var(--bg)", cursor: "pointer",
};
const ghost: React.CSSProperties = { ...btn, background: "transparent", color: "var(--muted)", borderColor: "var(--line-strong)" };

export default function AllocationsPage() {
  const { login, getAccessToken } = usePrivy();
  const { ready, authenticated, address, via } = useAuth();

  // Privy's getAccessToken() throws when no provider is mounted, so it is only reachable
  // when Privy owns the session. With a wallet session the address identifies the user
  // (see the DEMO-ONLY note in lib/privy.ts — this is not signed, and is env-gated).
  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (via === "privy") {
      const token = await getAccessToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    }
    return address ? { "x-wallet-address": address } : {};
  }, [via, address, getAccessToken]);

  const [creators, setCreators] = useState<CreatorOption[]>([]);
  const [globalQuick, setGlobalQuick] = useState<number>(1);
  const [globalInput, setGlobalInput] = useState("1");
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [globalMsg, setGlobalMsg] = useState<string | null>(null);

  // override draft
  const [ovHandle, setOvHandle] = useState<string | null>(null);
  const [ovAmount, setOvAmount] = useState("");
  const [ovMode, setOvMode] = useState<Mode>("copy");
  const [ovBusy, setOvBusy] = useState(false);
  const [ovMsg, setOvMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/influencers")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: { handle: string; display_name: string | null }[]) => setCreators(d.map((c) => ({ handle: c.handle, display_name: c.display_name }))))
      .catch(() => setCreators([]));
  }, []);

  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/allocations", { headers: await authHeaders() });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json()) as { globalQuickUsd: number; overrides: Override[] };
      setGlobalQuick(json.globalQuickUsd);
      setGlobalInput(String(json.globalQuickUsd));
      setOverrides(json.overrides ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [authenticated, authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: unknown) {
    const token = await getAccessToken();
    const res = await fetch("/api/allocations", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error((json && json.error) || `${res.status}`);
    return json;
  }

  async function saveGlobal() {
    const v = Number(globalInput);
    if (!(v > 0)) { setGlobalMsg("enter a positive amount"); return; }
    setSavingGlobal(true);
    setGlobalMsg(null);
    try {
      await post({ global: v });
      setGlobalQuick(v);
      setGlobalMsg("saved");
    } catch (e) {
      setGlobalMsg(e instanceof Error ? e.message : "could not save");
    } finally {
      setSavingGlobal(false);
    }
  }

  async function addOverride() {
    const v = Number(ovAmount);
    if (!ovHandle) { setOvMsg("pick a creator"); return; }
    if (!(v > 0)) { setOvMsg("enter a positive amount"); return; }
    setOvBusy(true);
    setOvMsg(null);
    try {
      await post({ handle: ovHandle, quickUsd: v, mode: ovMode });
      setOvHandle(null);
      setOvAmount("");
      await load();
    } catch (e) {
      setOvMsg(e instanceof Error ? e.message : "could not save");
    } finally {
      setOvBusy(false);
    }
  }

  async function removeOverride(handle: string) {
    try {
      await post({ handle, remove: true });
      await load();
    } catch {
      /* ignore */
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6" style={{ padding: "clamp(48px, 10vw, 110px) 24px 100px" }}>
      <div className="label" style={{ marginBottom: 10 }}>// auto-trade sizing · one-click copy/fade</div>
      <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 20 }}>
        <h1 style={{ fontSize: "clamp(32px, 6vw, 56px)" }}>Quick trade amount</h1>
        <p style={{ marginTop: 10, color: "var(--muted)", fontSize: 14, maxWidth: "60ch" }}>
          Every Follow / Fade deploys a fixed size — no per-trade prompts. Set one global amount, then override it for specific creators.
        </p>
      </div>

      {!ready && <div className="label flick" style={{ padding: "40px 0" }}>loading auth…</div>}

      {ready && !authenticated && (
        <div className="panel" style={{ marginTop: 40, padding: "28px 26px", maxWidth: 480 }}>
          <p className="label" style={{ marginBottom: 16 }}>authentication required</p>
          <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>Log in to configure your trade sizing.</p>
          <button style={btn} onClick={() => login()}>Log in</button>
        </div>
      )}

      {ready && authenticated && (
        <>
          {/* ---- global quick trade amount ---- */}
          <section style={{ marginTop: 44 }}>
            <div className="label" style={{ marginBottom: 14 }}>// global quick trade amount</div>
            <div className="panel" style={{ padding: "24px 26px", display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 20, alignItems: "end" }}>
              <div>
                <span className="label" style={{ display: "block", marginBottom: 8 }}>USDC per trade</span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--faint)" }}>$</span>
                  <input className="tnum" type="number" min="0" step="any" value={globalInput} onChange={(e) => setGlobalInput(e.target.value)} style={{ ...fieldControl, fontSize: 26, fontFamily: "var(--font-display)", maxWidth: 220 }} />
                </div>
                <p className="label" style={{ marginTop: 10, color: "var(--faint)" }}>
                  on testnet a buy spends this many USDC; a sell trades the same size in WETH.
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button style={{ ...btn, opacity: savingGlobal ? 0.6 : 1 }} disabled={savingGlobal} onClick={() => void saveGlobal()}>
                  {savingGlobal ? "saving…" : "Save"}
                </button>
                {globalMsg && <span className="label" style={{ color: globalMsg === "saved" ? "var(--gain)" : "var(--loss)" }}>{globalMsg}</span>}
              </div>
            </div>
          </section>

          {/* ---- per-creator overrides ---- */}
          <section style={{ marginTop: 48 }}>
            <div className="label" style={{ marginBottom: 14 }}>// per-creator overrides</div>
            <div className="panel" style={{ padding: "22px 24px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) 130px 120px auto", gap: 12, alignItems: "end" }}>
                <div>
                  <span className="label" style={{ display: "block", marginBottom: 8 }}>Creator</span>
                  {ovHandle ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, ...fieldControl, paddingTop: 8, paddingBottom: 8 }}>
                      <span style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>@{ovHandle}</span>
                      <button onClick={() => setOvHandle(null)} style={{ marginLeft: "auto", background: "none", border: 0, color: "var(--faint)", cursor: "pointer" }}>✕</button>
                    </div>
                  ) : (
                    <CreatorSearch creators={creators} onSelect={(h) => setOvHandle(h)} placeholder="search indexed creators…" />
                  )}
                </div>
                <div>
                  <span className="label" style={{ display: "block", marginBottom: 8 }}>Amount ($)</span>
                  <input className="tnum" type="number" min="0" step="any" value={ovAmount} onChange={(e) => setOvAmount(e.target.value)} placeholder="5" style={fieldControl} />
                </div>
                <div>
                  <span className="label" style={{ display: "block", marginBottom: 8 }}>Default</span>
                  <select value={ovMode} onChange={(e) => setOvMode(e.target.value as Mode)} style={fieldControl}>
                    <option value="copy">copy</option>
                    <option value="fade">fade</option>
                  </select>
                </div>
                <button style={{ ...btn, opacity: ovBusy ? 0.6 : 1 }} disabled={ovBusy} onClick={() => void addOverride()}>
                  {ovBusy ? "…" : "Add"}
                </button>
              </div>
              {ovMsg && <div className="label" style={{ marginTop: 10, color: "var(--loss)" }}>{ovMsg}</div>}
            </div>

            {/* list */}
            <div style={{ marginTop: 20 }}>
              {loading && <div className="label flick" style={{ padding: "20px 0" }}>loading…</div>}
              {error && <div className="label" style={{ padding: "20px 0", color: "var(--loss)" }}>could not load ({error})</div>}
              {!loading && !error && overrides.length === 0 && (
                <div className="label" style={{ padding: "18px 2px", color: "var(--muted)" }}>
                  no overrides — every creator uses the global ${globalQuick.toFixed(2)}.
                </div>
              )}
              {overrides.map((o) => (
                <div key={o.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", gap: 16, alignItems: "center", padding: "14px 2px", borderBottom: "1px solid var(--line)" }}>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600 }}>@{o.handle}</span>
                  <span className="label" style={{ color: o.mode === "fade" ? "var(--loss)" : "var(--gain)" }}>{o.mode} default</span>
                  <span className="tnum" style={{ fontSize: 15 }}>${o.quickUsd.toFixed(2)} <span className="label" style={{ color: "var(--faint)" }}>/ trade</span></span>
                  <button style={{ ...ghost, padding: "6px 12px", justifySelf: "end" }} onClick={() => void removeOverride(o.handle)}>Remove</button>
                </div>
              ))}
            </div>
          </section>

          <section style={{ marginTop: 48 }}>
            <div style={{ position: "relative", background: "var(--dark)", borderRadius: "var(--radius)", overflow: "hidden", height: 120 }}>
              <DitherArt shape="arrows" invert gap={4} className="h-full w-full" />
              <div className="label" style={{ position: "absolute", bottom: 14, left: 16, right: 16, color: "var(--dark-ink)", opacity: 0.75 }}>
                copy the honest, fade the rest · fixed size, routed on-chain
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
