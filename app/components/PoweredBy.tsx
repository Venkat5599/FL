"use client";

import { useState } from "react";

// Subtle "powered by <sponsor>" attribution. Rendered wherever a sponsor's
// tech does real work in the product (0G for verifiable inference, The Graph
// for pricing/forensics, Uniswap for execution). Deliberately understated:
// small, low-opacity, grayscale, warming to full color on hover. Inline-styled
// so it never collides with globals.css.

export type Sponsor = "0g" | "graph" | "uniswap";

const LOGOS: Record<Sponsor, { src: string; alt: string; h: number }> = {
  "0g": { src: "/logos/0g.png", alt: "0G", h: 13 },
  graph: { src: "/logos/the-graph.svg", alt: "The Graph", h: 15 },
  uniswap: { src: "/logos/uniswap.png", alt: "Uniswap", h: 15 },
};

export function PoweredBy({
  sponsor,
  label = "powered by",
  size = 1,
}: {
  sponsor: Sponsor;
  label?: string | null;
  size?: number; // multiplier on the logo height
}) {
  const [hover, setHover] = useState(false);
  const l = LOGOS[sponsor];
  return (
    <span
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={l.src}
        alt={l.alt}
        height={l.h * size}
        style={{
          height: l.h * size,
          width: "auto",
          filter: hover ? "grayscale(0)" : "grayscale(1)",
          transition: "filter .25s",
        }}
      />
    </span>
  );
}
