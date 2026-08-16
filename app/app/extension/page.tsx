import Link from "next/link";

// The extension ships inside this repo, under app/extension — it is built for TAPE,
// not a fork of anything.
const REPO_URL = "https://github.com/Venkat5599/FL/tree/main/app/extension";

const STEPS = [
  {
    n: "01",
    t: "Clone or download",
    d: (
      <>
        Get the extension from{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink)", borderBottom: "1px solid var(--line-strong)", textDecoration: "none" }}>
          the GitHub repo ↗
        </a>{" "}
        then clone it, or download the ZIP above and unpack it. The ZIP has manifest.json
        at its root, which is what &ldquo;Load unpacked&rdquo; expects.
      </>
    ),
  },
  {
    n: "02",
    t: "Open chrome://extensions",
    d: "Works in any Chromium browser (Chrome, Brave, Edge). Paste chrome://extensions into the address bar.",
  },
  {
    n: "03",
    t: "Enable Developer mode",
    d: "Flip the toggle in the top right of the extensions page.",
  },
  {
    n: "04",
    t: "Load unpacked",
    d: "Click Load unpacked and select the folder you cloned or unpacked, the one containing manifest.json.",
  },
  {
    n: "05",
    t: "Open any X profile",
    d: "Visit a profile page, e.g. x.com/CryptoTony__. The TAPE record card appears just below the Follow button within a second or two.",
  },
];

const btnPrimary: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
  border: "1px solid var(--ink)", borderRadius: "var(--radius)", padding: "12px 26px",
  background: "var(--ink)", color: "var(--bg)", cursor: "pointer", textDecoration: "none",
  display: "inline-block",
};
const btnGhost: React.CSSProperties = {
  ...btnPrimary, background: "transparent", color: "var(--muted)", borderColor: "var(--line-strong)",
};

export default function ExtensionPage() {
  return (
    <main className="mx-auto max-w-6xl px-6" style={{ padding: "clamp(48px, 10vw, 110px) 24px 100px" }}>
      <div className="label" style={{ marginBottom: 10 }}>{"// receipts, right where the calls get made"}</div>
      <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 20 }}>
        <h1 style={{ fontSize: "clamp(32px, 6vw, 56px)", maxWidth: "16ch" }}>The browser extension.</h1>
        <p style={{ marginTop: 14, color: "var(--muted)", fontSize: 15, lineHeight: 1.7, maxWidth: "62ch" }}>
          TAPE&apos;s record, on every X profile, no tab-switching. It injects a compact card
          just below the Follow button: headline P&amp;L%, signal and scored-call counts, contradiction
          rate, how many of their posts were deleted and survived anyway, the latest call, and a
          link straight to the full dossier.
        </p>
        <div style={{ marginTop: 26, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" style={btnPrimary}>
            View on GitHub ↗
          </a>
          <a href="/tape-extension.zip" download="tape-extension.zip" style={btnGhost}>
            Download ZIP
          </a>
        </div>
      </div>

      {/* ---- preview ---- */}
      <section style={{ marginTop: 52 }}>
        <div className="label" style={{ marginBottom: 16 }}>{"// what it looks like on a profile"}</div>
        <div
          className="panel"
          style={{
            padding: 10,
            background: "var(--dark)",
            display: "flex",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/extension-preview.png"
            alt="TAPE record card injected onto an X profile page, showing P&L, signals, contradiction rate, and deleted-post count"
            style={{
              maxWidth: "100%",
              width: "100%",
              height: "auto",
              display: "block",
              borderRadius: "var(--radius)",
              border: "1px solid var(--line-strong)",
            }}
          />
        </div>
      </section>

      {/* ---- install steps ---- */}
      <section style={{ marginTop: 56 }}>
        <div className="label" style={{ marginBottom: 16 }}>{"// install it · no build step, ~60 seconds"}</div>
        <div style={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", background: "var(--line)", border: "1px solid var(--line)" }}>
          {STEPS.map((s) => (
            <div key={s.n} className="scan" style={{ background: "var(--bg)", padding: "22px 22px 26px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span className="pixel" style={{ fontSize: 20, color: "var(--faint)" }}>{s.n}</span>
              </div>
              <h3 style={{ fontSize: 16, marginTop: 14 }}>{s.t}</h3>
              <p style={{ marginTop: 10, color: "var(--muted)", fontSize: 13, lineHeight: 1.65 }}>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- config note ---- */}
      <section style={{ marginTop: 48 }}>
        <div className="panel" style={{ padding: "22px 24px", display: "grid", gap: 14 }}>
          <div className="label">{"// good to know"}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
            It looks for a TAPE API on{" "}
            <span className="tnum" style={{ color: "var(--ink)" }}>localhost:3000</span>{" "}
            first, then falls back to{" "}
            <span className="tnum" style={{ color: "var(--ink)" }}>tape-flare.vercel.app</span>, so the
            same build works whether you are developing locally or just using it. No setup, no keys.
            Only creators already indexed by TAPE show data; unindexed profiles simply won&apos;t get
            a card.
          </p>
          <p style={{ color: "var(--muted)", fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
            Plain vanilla JS/CSS, loaded as a Manifest V3 content script, nothing to compile, no
            npm install. Reload the extension from{" "}
            <span className="tnum" style={{ color: "var(--ink)" }}>chrome://extensions</span>{" "}
            after editing any file.
          </p>
        </div>
      </section>

      <section style={{ marginTop: 48 }}>
        <div style={{ position: "relative", background: "var(--dark)", borderRadius: "var(--radius)", overflow: "hidden", padding: "28px 26px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div className="label" style={{ color: "var(--dark-ink)", opacity: 0.85 }}>
            the market remembers · now it follows you onto X
          </div>
          <Link href="/leaderboard" className="label" style={{ color: "var(--dark-ink)", textDecoration: "none", borderBottom: "1px solid color-mix(in oklch, var(--dark-ink) 50%, transparent)" }}>
            browse the leaderboard ↗
          </Link>
        </div>
      </section>
    </main>
  );
}
