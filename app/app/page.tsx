"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { InteractiveDither } from "@/components/InteractiveDither";
import { DitherArt } from "@/components/DitherArt";
import { PoweredBy } from "@/components/PoweredBy";

const EVIDENCE = [
  {
    n: "01",
    k: "BACKTEST",
    t: "Every call, priced.",
    shape: "signal" as const,
    d: "We read their public calls and mark each one against FTSOv2 on-chain. $1,000 per call, versus just holding FLR. The verdict is arithmetic.",
  },
  {
    n: "02",
    k: "SAID / DID",
    t: "Their wallet betrays them.",
    shape: "loop" as const,
    d: "We cross-reference each call against the caller's own on-chain wallet. Said accumulate, sold four hours later. Cited to the transaction.",
  },
  {
    n: "03",
    k: "FADE",
    t: "Trade against the noise.",
    shape: "arrows" as const,
    d: "Copy the honest, fade the rest. Auto-executed from a self-custody vault, capped per creator. The most reliable alpha is the other side of a bad call.",
  },
];

// The four Flare protocols the product actually runs on.
type Sponsor = "fdc" | "fcc" | "ftso" | "fxrp";

// Hovering a sponsor logo takes over the hero (heading + line + eyebrow) with
// why that layer is load-bearing for the product, not decoration. Concrete,
// no jargon. The DEFAULT is what shows when nothing is hovered.
interface HeroCopy {
  heading: string;
  eyebrow: string;
  body: string;
}
const DEFAULT: HeroCopy = {
  heading: "THE MARKET REMEMBERS.",
  eyebrow: "// built on",
  body:
    "Forensic accountability for crypto influencers. Backtest their calls, catch their wallets in the act, and fade the noise, automatically.",
};
const SPONSOR_COPY: Record<Sponsor, HeroCopy> = {
  fdc: {
    heading: "DELETING IT WON'T HELP.",
    eyebrow: "// why attested evidence",
    body:
      "Every call is proven to exist by the Flare Data Connector before it is scored — a Merkle proof against a round Flare's data providers signed. Delete the post and the record stands. Edit it and the edit shows. The evidence stops depending on us having screenshotted it.",
  },
  fcc: {
    heading: "A SCORE YOU CAN'T FARM.",
    eyebrow: "// why confidential compute",
    body:
      "The ranking runs inside a hardware enclave whose weights are never published — because a leaderboard whose formula is public gets optimised against instead of satisfied. Inputs are public and attested, the verdict is public and signed, the function is secret.",
  },
  ftso: {
    heading: "PRICED BY THE CHAIN.",
    eyebrow: "// why an oracle, not an API",
    body:
      "Entry and settlement marks come from FTSOv2, read on-chain and stamped with the oracle's own timestamp. Nobody — us included — picks the price a call is judged against, and a stale feed is refused rather than quietly used.",
  },
  fxrp: {
    heading: "PUT XRP TO WORK.",
    eyebrow: "// why FAssets",
    body:
      "A verdict you cannot act on is just an opinion. FXRP brings XRP — the largest asset with no native smart contracts — onto Flare as a real ERC-20, so following a proven caller is a position you actually hold, and always redeemable back to XRP.",
  },
};

// Types `text` in character by character whenever it changes (on hover), with a
// blinking caret. The first render shows it whole — the type-in is a hover
// reaction, not a page-load effect.
function Typewriter({ text, speed = 34 }: { text: string; speed?: number }) {
  const [shown, setShown] = useState(text);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      setShown(text);
      return;
    }
    setShown("");
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed]);
  return (
    <>
      {shown}
      <span className="tw-caret" aria-hidden />
    </>
  );
}

export default function HomePage() {
  const [hovered, setHovered] = useState<Sponsor | null>(null);
  const active = hovered ? SPONSOR_COPY[hovered] : DEFAULT;
  const swapKey = hovered ?? "default"; // re-key so the swap animation replays

  return (
    <main>
      {/* ---- HERO ---- */}
      <section
        className="relative overflow-hidden"
        style={{
          minHeight: "min(92vh, 900px)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <InteractiveDither className="absolute inset-0 h-full w-full" />
        {/* light legibility scrim: keep the left readable, let the grain breathe */}
        <div
          className="absolute inset-0"
          style={{
            pointerEvents: "none",
            background:
              "linear-gradient(90deg, color-mix(in oklch, var(--bg) 82%, transparent) 0%, color-mix(in oklch, var(--bg) 42%, transparent) 34%, transparent 68%), linear-gradient(0deg, var(--bg), transparent 26%), linear-gradient(180deg, color-mix(in oklch, var(--bg) 45%, transparent), transparent 14%)",
          }}
        />
        <div
          className="relative z-10 mx-auto flex h-full max-w-6xl flex-col justify-center px-6"
          style={{ minHeight: "min(92vh, 900px)" }}
        >
          <div
            className="pixel rise"
            style={{
              animationDelay: "0ms",
              fontSize: 18,
              letterSpacing: "0.06em",
              color: "var(--ink)",
            }}
          >
            <span className="kol">TA</span>PE
            <span className="flick" style={{ color: "var(--ink)" }}>
              _
            </span>
          </div>

          <h1
            className="rise"
            style={{
              animationDelay: "80ms",
              fontSize: "clamp(44px, 9vw, 116px)",
              margin: "18px 0 0",
              lineHeight: 0.94,
              minHeight: "1.88em", // reserve 2 lines so a shorter heading doesn't shift the page
              maxWidth: "16ch",
            }}
          >
            <Typewriter text={active.heading} />
          </h1>

          <p
            className="rise"
            style={{
              animationDelay: "180ms",
              maxWidth: "54ch",
              marginTop: 22,
              minHeight: "5.4em", // reserve space so hover copy never shifts the logos
              color: hovered ? "var(--ink)" : "var(--muted)",
              fontSize: 15,
              lineHeight: 1.6,
              transition: "color 0.2s var(--ease-out-quart)",
            }}
          >
            <span key={swapKey} className="hero-swap">{active.body}</span>
          </p>

          <Link
            href="/extension"
            className="rise hero-ext"
            style={{
              animationDelay: "250ms",
              marginTop: 22,
              width: "fit-content",
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              padding: "7px 13px 7px 11px",
              border: "1px solid var(--line-strong)",
              borderRadius: 999,
              fontFamily: "var(--font-mono, ui-monospace)",
              fontSize: 12,
              letterSpacing: "0.01em",
              color: "var(--muted)",
              textDecoration: "none",
            }}
          >
            <span aria-hidden style={{ color: "var(--signal)", fontSize: 13 }}>◇</span>
            <span>browser extension · receipts on every X profile</span>
            <span aria-hidden style={{ color: "var(--faint)" }}>↗</span>
          </Link>

          <div
            className="rise"
            style={{ animationDelay: "360ms", marginTop: 30 }}
          >
            <div
              className="label"
              style={{ marginBottom: 14, color: hovered ? "var(--ink)" : "var(--faint)", transition: "color 0.2s" }}
            >
              <span key={swapKey} className="hero-swap">{active.eyebrow}</span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 40,
                flexWrap: "wrap",
              }}
            >
              {([
                ["fdc", "FDC"],
                ["fcc", "FCC"],
                ["ftso", "FTSOv2"],
                ["fxrp", "FXRP"],
              ] as const).map(([key, label]) => (
                <span
                  key={key}
                  className="sponsor-word"
                  title={label}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 15,
                    letterSpacing: "0.08em",
                    cursor: "pointer",
                    color: hovered === key ? "var(--ink)" : "var(--faint)",
                    transition: "color .2s",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div
          className="label"
          style={{
            position: "absolute",
            bottom: 20,
            left: 0,
            right: 0,
            textAlign: "center",
            zIndex: 10,
          }}
        >
          ↓ scroll to the evidence
        </div>
      </section>

      {/* ---- EVIDENCE ---- */}
      <section
        className="mx-auto max-w-6xl px-6"
        style={{ padding: "clamp(64px, 12vw, 140px) 24px" }}
      >
        <div className="label" style={{ marginBottom: 10 }}>
          {"// how the ledger works"}
        </div>
        <h2 style={{ fontSize: "clamp(28px, 5vw, 52px)", maxWidth: "18ch" }}>
          Damning by evidence, never by opinion.
        </h2>
        <div
          style={{
            marginTop: 56,
            display: "grid",
            gap: 1,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            background: "var(--line)",
            border: "1px solid var(--line)",
          }}
        >
          {EVIDENCE.map((e) => (
            <div
              key={e.n}
              className="scan"
              style={{ background: "var(--bg)", padding: "28px 26px 34px" }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <span
                  className="pixel"
                  style={{ fontSize: 22, color: "var(--faint)" }}
                >
                  {e.n}
                </span>
                <span className="label">{e.k}</span>
              </div>
              <div
                style={{
                  marginTop: 20,
                  height: 150,
                  background: "var(--dark)",
                  borderRadius: "var(--radius)",
                  overflow: "hidden",
                }}
              >
                <DitherArt
                  shape={e.shape}
                  invert
                  gap={4}
                  className="h-full w-full"
                />
              </div>
              <h3 style={{ fontSize: 22, marginTop: 22 }}>{e.t}</h3>
              <p
                style={{
                  marginTop: 12,
                  color: "var(--muted)",
                  fontSize: 13.5,
                  lineHeight: 1.7,
                }}
              >
                {e.d}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- WHAT IT'S FOR (value-prop bento) ---- */}
      <section
        className="mx-auto max-w-6xl px-6"
        style={{ padding: "0 24px clamp(72px, 12vw, 140px)" }}
      >
        <div className="label" style={{ marginBottom: 10 }}>
          {"// why it exists"}
        </div>
        <h2 style={{ fontSize: "clamp(28px, 5vw, 52px)", maxWidth: "20ch" }}>
          The problems finfluencers count on you forgetting.
        </h2>

        <div className="bento" style={{ marginTop: 56 }}>
          {/* 01 — feature cell: immutable archive of deleted calls */}
          <div className="bento-cell bento-lg scan">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <span
                className="pixel"
                style={{ fontSize: 22, color: "var(--faint)" }}
              >
                01
              </span>
              <span className="label">immutable archive</span>
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 180,
                marginTop: 22,
                background: "var(--dark)",
                borderRadius: "var(--radius)",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/deleted-calls.gif"
                alt="A deleted call being flagged and kept on the permanent record"
                style={{
                  width: 240,
                  height: 240,
                  maxWidth: "80%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            </div>
            <h3 style={{ fontSize: 26, marginTop: 24 }}>
              Deleted calls don&apos;t disappear.
            </h3>
            <p
              style={{
                marginTop: 12,
                color: "var(--muted)",
                fontSize: 14,
                lineHeight: 1.7,
                maxWidth: "46ch",
              }}
            >
              Finfluencers quietly delete their losing signals to dodge
              accountability. We archive every call immutably and flag the
              deletions in red — the loss they tried to erase stays on the
              permanent record.
            </p>
            <div className="bento-flag">
              <span
                className="db-mark"
                style={{ textDecoration: "line-through" }}
              >
                DELETED
              </span>
              <span className="label" style={{ color: "var(--loss)" }}>
                stays on the record
              </span>
            </div>
          </div>

          {/* 02 — unified performance truth */}
          <div className="bento-cell bento-sm scan">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <span
                className="pixel"
                style={{ fontSize: 22, color: "var(--faint)" }}
              >
                02
              </span>
              <span className="label">unified pnl</span>
            </div>
            <h3 style={{ fontSize: 21, marginTop: 20 }}>
              One score for real performance.
            </h3>
            <p
              style={{
                marginTop: 12,
                color: "var(--muted)",
                fontSize: 13.5,
                lineHeight: 1.7,
              }}
            >
              Nowhere tracks whether a caller&apos;s signals actually make
              money. One unified portfolio scores every influencer&apos;s real
              performance — said-vs-did, PnL over time.
            </p>
            <div style={{ marginTop: "auto", paddingTop: 18 }}>
              <PoweredBy protocol="ftso" />
            </div>
          </div>

          {/* 03 — verifiable registry */}
          <div className="bento-cell bento-sm scan">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <span
                className="pixel"
                style={{ fontSize: 22, color: "var(--faint)" }}
              >
                03
              </span>
              <span className="label">verified registry</span>
            </div>
            <h3 style={{ fontSize: 21, marginTop: 20 }}>
              A registry you can actually trust.
            </h3>
            <p
              style={{
                marginTop: 12,
                color: "var(--muted)",
                fontSize: 13.5,
                lineHeight: 1.7,
              }}
            >
              No vetted list of who&apos;s worth following. A scored, verifiable
              leaderboard — with the evidence chain behind every score, link by link.
            </p>
            <div style={{ marginTop: "auto", paddingTop: 18 }}>
              <PoweredBy protocol="fcc" />
            </div>
          </div>

          {/* 04 — full-width banner: a new way to trade */}
          <div className="bento-cell bento-wide scan" style={{ padding: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "stretch",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  flex: "1 1 340px",
                  padding: "28px 26px 30px",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  }}
                >
                  <span
                    className="pixel"
                    style={{ fontSize: 22, color: "var(--faint)" }}
                  >
                    04
                  </span>
                  <span className="label">copy / fade</span>
                </div>
                <h3 style={{ fontSize: 24, marginTop: 20 }}>
                  A new way to trade the noise.
                </h3>
                <p
                  style={{
                    marginTop: 12,
                    color: "var(--muted)",
                    fontSize: 14,
                    lineHeight: 1.7,
                    maxWidth: "54ch",
                  }}
                >
                  Trade{" "}
                  <em style={{ fontStyle: "normal", color: "var(--gain)" }}>
                    with
                  </em>{" "}
                  or{" "}
                  <em style={{ fontStyle: "normal", color: "var(--loss)" }}>
                    against
                  </em>{" "}
                  finfluencers: one-click copy the honest, fade the rest —
                  auto-executed from a self-custody vault, capped per creator.
                </p>
                <div style={{ marginTop: "auto", paddingTop: 18 }}>
                  <PoweredBy protocol="fxrp" />
                </div>
              </div>
              <div
                style={{
                  flex: "1 1 300px",
                  minHeight: 220,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "end",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/trade-noise.gif"
                  alt="Signal noise resolving into copy and fade trades"
                  style={{
                    height: "100%",
                    width: "auto",
                    maxWidth: "100%",
                    objectFit: "contain",
                    display: "block",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- extension CTA ---- */}
      <section className="mx-auto max-w-6xl px-6" style={{ padding: "0 24px clamp(48px, 8vw, 90px)" }}>
        <Link
          href="/extension"
          className="scan"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            padding: "18px 22px",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            textDecoration: "none",
            color: "var(--ink)",
          }}
        >
          <span className="label" style={{ color: "var(--ink)" }}>
            ◇ install the browser extension · receipts on every X profile you visit
          </span>
          <span className="label" style={{ color: "var(--faint)" }}>
            get it ↗
          </span>
        </Link>
      </section>

      <footer
        className="mx-auto max-w-6xl px-6"
        style={{
          padding: "28px 24px 48px",
          borderTop: "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <span className="pixel" style={{ color: "var(--faint)" }}>
          <span className="kol">TA</span>PE
        </span>
        <span className="label">
          the market remembers · numbers and citations, zero adjectives
        </span>
      </footer>
    </main>
  );
}
