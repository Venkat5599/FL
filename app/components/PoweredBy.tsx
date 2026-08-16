"use client";

import { useState } from "react";

// Subtle "powered by <protocol>" attribution. Rendered wherever a Flare protocol does
// real work in the product: FDC for the evidence layer, FCC for confidential scoring,
// FTSOv2 for pricing, FAssets/FXRP for settlement.
//
// Typographic rather than logo-based, on purpose. We do not hold Flare's brand SVGs, and
// drawing an approximation of someone else's mark is worse than not showing one — a
// hand-faked logo reads as counterfeit, not as attribution. Protocol names set in the
// house mono are a real treatment and fit the terminal grammar the rest of the UI
// already speaks (see DESIGN.md). If official brand assets are added later, this is the
// single place that changes.
//
// Deliberately understated: small, low-opacity, warming on hover. Inline-styled so it
// never collides with globals.css.

export type Protocol = "fdc" | "fcc" | "ftso" | "fxrp" | "flare";

const PROTOCOLS: Record<Protocol, { name: string; full: string; href: string }> = {
  fdc: {
    name: "FDC",
    full: "Flare Data Connector",
    href: "https://dev.flare.network/fdc/overview",
  },
  fcc: {
    name: "FCC",
    full: "Flare Confidential Compute",
    href: "https://dev.flare.network/fcc/overview",
  },
  ftso: {
    name: "FTSOv2",
    full: "Flare Time Series Oracle",
    href: "https://dev.flare.network/ftso/overview",
  },
  fxrp: {
    name: "FXRP",
    full: "FAssets — XRP on Flare",
    href: "https://dev.flare.network/fxrp/overview",
  },
  flare: {
    name: "FLARE",
    full: "Flare Network",
    href: "https://flare.network",
  },
};

export function PoweredBy({
  protocol,
  sponsor,
  label = "powered by",
  size = 1,
}: {
  protocol?: Protocol;
  /** @deprecated alias kept for older call sites. Prefer `protocol`. */
  sponsor?: Protocol;
  label?: string | null;
  size?: number; // multiplier on the type size
}) {
  const [hover, setHover] = useState(false);
  const p = PROTOCOLS[protocol ?? sponsor ?? "flare"];

  return (
    <a
      href={p.href}
      target="_blank"
      rel="noreferrer noopener"
      title={p.full}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        opacity: hover ? 1 : 0.5,
        transition: "opacity .25s",
        userSelect: "none",
        verticalAlign: "middle",
        textDecoration: "none",
      }}
    >
      {label && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--faint)",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      )}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11 * size,
          letterSpacing: "0.06em",
          // The one place the signal accent earns its keep: it marks the protocol doing
          // the work, and only on hover, so it stays under the 5%-of-surface budget.
          color: hover ? "var(--signal)" : "var(--muted)",
          transition: "color .25s",
          whiteSpace: "nowrap",
        }}
      >
        {p.name}
      </span>
    </a>
  );
}
