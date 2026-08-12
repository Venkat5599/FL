"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import type { InfluencerSummary } from "@/app/api/influencers/route";

type Mode = "copy" | "fade";
type Positions = Record<string, Mode | undefined>;

function timeAgo(unixSec: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - unixSec));
  const d = Math.floor(s / 86400);
  if (d >= 1) return `${d}d`;
  const h = Math.floor(s / 3600);
  if (h >= 1) return `${h}h`;
  const m = Math.floor(s / 60);
  return `${m}m`;
}

function monogram(handle: string): string {
  return handle.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "??";
}

export function CreatorFeed() {
  const router = useRouter();
  const { ready, authenticated, login, getAccessToken } = usePrivy();

  const [feed, setFeed] = useState<InfluencerSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<Positions>({});
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/influencers")
      .then((r) => (r.ok ? (r.json() as Promise<InfluencerSummary[]>) : []))
      .then((data) => !cancelled && setFeed(data))
      .catch(() => !cancelled && setFeed([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Reflect the signed-in user's existing allocations as active follow/fade state.
  const loadPositions = useCallback(async () => {
    if (!authenticated) return;
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/allocations", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return;
      const json = await res.json();
      const rows: { handle: string; mode: Mode; active?: number | boolean }[] = Array.isArray(json)
        ? json
        : json?.allocations ?? [];
      const next: Positions = {};
      for (const r of rows) if (r.active !== 0 && r.active !== false) next[r.handle] = r.mode;
      setPositions(next);
    } catch {
      /* non-fatal: feed still works without prior state */
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);

  async function act(handle: string, mode: Mode) {
    if (!ready) return;
    if (!authenticated) {
      setNote("log in to follow or fade");
      login();
      return;
    }
    setPending(handle + mode);
    setNote(null);
    const already = positions[handle] === mode;
    // Optimistic: toggle off if same mode clicked, else set to this mode.
    setPositions((p) => ({ ...p, [handle]: already ? undefined : mode }));
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ handle, mode, capType: "fixed_usd", capValue: 100 }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
    } catch {
      // revert on failure
      setPositions((p) => ({ ...p, [handle]: already ? mode : positions[handle] }));
      setNote("could not save, try again");
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      {note && (
        <div className="label" style={{ marginBottom: 14, color: "var(--signal)" }}>
          {note}
        </div>
      )}

      {loading && <div className="label flick" style={{ padding: "40px 0" }}>reading the ledger…</div>}

      {!loading && feed && feed.length === 0 && (
        <div className="label" style={{ padding: "40px 0", color: "var(--muted)" }}>no creators indexed yet.</div>
      )}

      <div style={{ display: "grid", gap: 16 }}>
        {!loading &&
          feed?.map((c, i) => {
            const neg = c.headlinePct < 0;
            const pos = positions[c.handle];
            const dir = c.latest?.direction;
            return (
              <article
                key={c.handle}
                className="post rise"
                style={{ animationDelay: `${Math.min(i, 8) * 55}ms` }}
              >
                {/* header */}
                <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button
                    onClick={() => router.push(`/k/${c.handle}`)}
                    aria-label={`Open ${c.handle} dossier`}
                    className="avatar pixel"
                  >
                    {monogram(c.handle)}
                  </button>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <button onClick={() => router.push(`/k/${c.handle}`)} className="handle-link">
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600 }}>@{c.handle}</span>
                      {c.display_name && <span className="label" style={{ marginLeft: 8 }}>{c.display_name}</span>}
                    </button>
                    <div className="label" style={{ marginTop: 3 }}>
                      {c.callCount} scored call{c.callCount === 1 ? "" : "s"}
                      {c.latest ? ` · ${timeAgo(c.latest.postedAt)} ago` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="tnum" style={{ fontFamily: "var(--font-mono)", fontSize: 18, color: neg ? "var(--loss)" : "var(--gain)" }}>
                      {neg ? "" : "+"}
                      {c.headlinePct}%
                    </div>
                    <div className="label">headline p&l</div>
                  </div>
                </header>

                {/* the call, as a post */}
                {c.latest && (
                  <button onClick={() => router.push(`/k/${c.handle}`)} className="post-body">
                    {c.latest.asset && (
                      <span className="asset-tag">
                        ${c.latest.asset}
                        {dir && <span style={{ color: "var(--faint)", marginLeft: 6 }}>{dir === "long" ? "▲ long" : "▼ short"}</span>}
                      </span>
                    )}
                    <p style={{ marginTop: c.latest.asset ? 10 : 0, color: "var(--ink)", fontSize: 15, lineHeight: 1.55 }}>
                      &ldquo;{c.latest.content}&rdquo;
                    </p>
                    {c.latest.retPct != null && (
                      <div className="tnum" style={{ marginTop: 10, fontSize: 13, color: c.latest.retPct < 0 ? "var(--loss)" : "var(--gain)" }}>
                        settled {c.latest.retPct < 0 ? "" : "+"}
                        {c.latest.retPct}%
                      </div>
                    )}
                  </button>
                )}

                {/* footer: integrity chip + actions */}
                <footer style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span className="chip" title="Share of calls the creator's own wallet traded against">
                    wallet contradicts {c.contradictionRate}%
                  </span>
                  <div className="votes" style={{ marginLeft: "auto" }}>
                    <button
                      onClick={() => act(c.handle, "copy")}
                      disabled={pending === c.handle + "copy"}
                      className={`vote up ${pos === "copy" ? "up-on" : ""}`}
                      title="Copy this creator"
                    >
                      <span className="arrow">▲</span> {pos === "copy" ? "following" : "follow"}
                    </button>
                    <button
                      onClick={() => act(c.handle, "fade")}
                      disabled={pending === c.handle + "fade"}
                      className={`vote down ${pos === "fade" ? "down-on" : ""}`}
                      title="Trade against this creator"
                    >
                      <span className="arrow">▼</span> {pos === "fade" ? "fading" : "fade"}
                    </button>
                  </div>
                </footer>
              </article>
            );
          })}
      </div>
    </div>
  );
}
