"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DitherArt } from "@/components/DitherArt";
import type { InfluencerSummary } from "@/app/api/influencers/route";

type Sort = "reliable" | "damning" | "twofaced";

const SORTS: { key: Sort; label: string }[] = [
  { key: "damning", label: "Most damning" },
  { key: "reliable", label: "Most reliable" },
  { key: "twofaced", label: "Most two-faced" },
];

// Real X avatar by handle, with a 2-letter monogram fallback. Round, ~40px.
function MiniAvatar({ handle }: { handle: string }) {
  const [ok, setOk] = useState(true);
  const mg = handle.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "??";
  return (
    <span
      style={{
        flexShrink: 0,
        width: 40,
        height: 40,
        borderRadius: 999,
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
        border: "1px solid var(--line-strong)",
        background: "var(--bg-2)",
        color: "var(--ink)",
        fontFamily: "var(--font-pixel), var(--font-mono), monospace",
        fontSize: 13,
      }}
    >
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://unavatar.io/twitter/${handle}`}
          alt=""
          width={40}
          height={40}
          onError={() => setOk(false)}
          style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(0.25)" }}
        />
      ) : (
        mg
      )}
    </span>
  );
}

function sortFeed(feed: InfluencerSummary[], sort: Sort): InfluencerSummary[] {
  const rows = [...feed];
  switch (sort) {
    case "reliable":
      // best headline P&L first
      return rows.sort((a, b) => b.headlinePct - a.headlinePct);
    case "damning":
      // worst headline P&L first (the accountability default)
      return rows.sort((a, b) => a.headlinePct - b.headlinePct);
    case "twofaced":
      // most self-contradicting wallet first
      return rows.sort((a, b) => b.contradictionRate - a.contradictionRate);
  }
}

export default function LeaderboardPage() {
  const [feed, setFeed] = useState<InfluencerSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>("damning");

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

  const ranked = feed ? sortFeed(feed, sort) : [];

  return (
    <main className="mx-auto max-w-5xl px-6" style={{ padding: "clamp(48px, 10vw, 110px) 24px 100px" }}>
      {/* header */}
      <div className="label" style={{ marginBottom: 10 }}>// leaderboard</div>
      <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 22 }}>
        <h1 style={{ fontSize: "clamp(32px, 6vw, 56px)" }}>The record, ranked.</h1>
        <p style={{ marginTop: 10, color: "var(--muted)", fontSize: 14, maxWidth: "60ch" }}>
          Every indexed creator, scored on what their calls actually returned a follower. No spin, just the ledger.
        </p>
      </div>

      {/* dark dither accent band */}
      <div
        style={{
          position: "relative",
          height: 120,
          marginTop: 28,
          background: "var(--dark)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        <DitherArt shape="arrows" invert gap={4} className="h-full w-full" />
        <div
          className="label"
          style={{ position: "absolute", bottom: 14, left: 16, right: 16, color: "var(--dark-ink)", opacity: 0.75 }}
        >
          headline p&amp;l = a $1,000-per-call return vs holding eth
        </div>
      </div>

      {/* sort toggle */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 32 }}>
        {SORTS.map((s) => {
          const active = s.key === sort;
          return (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              style={{
                fontFamily: "var(--font-mono), monospace",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                border: `1px solid ${active ? "var(--ink)" : "var(--line)"}`,
                borderRadius: 999,
                padding: "6px 14px",
                background: active ? "var(--ink)" : "transparent",
                color: active ? "var(--bg)" : "var(--muted)",
                cursor: "pointer",
                transition: "color 0.18s, border-color 0.18s, background 0.18s",
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* loading / empty */}
      {loading && (
        <div className="label flick" style={{ padding: "48px 0" }}>
          reading the ledger…
        </div>
      )}
      {!loading && feed && feed.length === 0 && (
        <div className="label" style={{ padding: "48px 0", color: "var(--muted)" }}>
          no creators indexed yet.
        </div>
      )}

      {/* ranked list */}
      {!loading && ranked.length > 0 && (
        <div style={{ marginTop: 28 }}>
          {ranked.map((c, i) => {
            const rank = i + 1;
            const top = rank <= 3;
            const isFirst = rank === 1;
            const neg = c.headlinePct < 0;
            const name = c.display_name || `@${c.handle}`;
            return (
              <Link
                key={c.handle}
                href={`/k/${c.handle}`}
                className="wl-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto auto minmax(0,1fr) auto",
                  alignItems: "center",
                  gap: 16,
                  padding: "16px 6px",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                {/* rank */}
                <span
                  className="tnum"
                  style={{
                    fontFamily: "var(--font-mono), monospace",
                    fontSize: top ? 18 : 14,
                    fontWeight: top ? 700 : 500,
                    minWidth: 26,
                    color: isFirst ? "var(--signal)" : top ? "var(--ink)" : "var(--faint)",
                  }}
                >
                  {String(rank).padStart(2, "0")}
                </span>

                {/* avatar */}
                <MiniAvatar handle={c.handle} />

                {/* identity + stats */}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 16,
                      fontWeight: 600,
                      color: "var(--ink)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {name}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 3 }}>
                    <span className="label">@{c.handle}</span>
                    <span className="label">
                      {c.callCount} scored call{c.callCount === 1 ? "" : "s"}
                    </span>
                    <span
                      className="label"
                      title="Share of calls the creator's own wallet traded against"
                      style={{ color: c.contradictionRate > 0 ? "var(--loss)" : "var(--faint)" }}
                    >
                      wallet contradicts {c.contradictionRate}%
                    </span>
                  </div>
                </div>

                {/* headline p&l */}
                <div style={{ textAlign: "right" }}>
                  <div
                    className="tnum"
                    style={{
                      fontFamily: "var(--font-mono), monospace",
                      fontSize: 22,
                      fontWeight: 600,
                      color: neg ? "var(--loss)" : "var(--gain)",
                    }}
                  >
                    {neg ? "" : "+"}
                    {c.headlinePct}%
                  </div>
                  <div className="label" style={{ marginTop: 2 }}>
                    headline p&amp;l
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
