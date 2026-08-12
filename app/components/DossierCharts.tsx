"use client";

import { useEffect, useId, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  type TooltipContentProps,
} from "recharts";

const EASE = "cubic-bezier(0.16,1,0.3,1)";

// ---- animated stat --------------------------------------------------------
// Renders the TRUE value immediately (a data-integrity product must never show
// a wrong number, even for a frame) and animates only its entrance via CSS,
// which is compositor-driven and correct regardless of rAF throttling.
export function AnimatedNumber({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <span className="tnum num-in">
      {prefix}
      {value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

// ---- per-token performance -------------------------------------------------
export type TokenDatum = { asset: string; avgRetPct: number; count: number; winRate: number };

export function TokenPerfChart({ data, height = 220 }: { data: TokenDatum[]; height?: number }) {
  const uid = useId().replace(/:/g, "");
  if (!data.length) return <EmptyChart label="no scored tokens yet" height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barCategoryGap={10}>
        <defs>
          <pattern id={`gd-${uid}`} patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="var(--gain)" fillOpacity="0.16" />
            <circle cx="2" cy="2" r="0.9" fill="var(--gain)" />
          </pattern>
          <pattern id={`ld-${uid}`} patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="var(--loss)" fillOpacity="0.16" />
            <circle cx="2" cy="2" r="0.9" fill="var(--loss)" />
          </pattern>
        </defs>
        <CartesianGrid stroke="var(--line)" strokeDasharray="2 3" horizontal={false} />
        <XAxis type="number" stroke="var(--line)" tick={{ fill: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`} />
        <YAxis type="category" dataKey="asset" width={54} stroke="var(--line)" tick={{ fill: "var(--ink)", fontFamily: "var(--font-mono)", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: string) => `$${v}`} />
        <Tooltip cursor={{ fill: "var(--bg-2)" }} content={(p) => <TokenTip {...p} />} />
        <Bar dataKey="avgRetPct" isAnimationActive animationDuration={1000} animationEasing={EASE} radius={2}>
          {data.map((d, i) => (
            <Cell key={i} fill={`url(#${d.avgRetPct >= 0 ? "gd" : "ld"}-${uid})`} stroke={d.avgRetPct >= 0 ? "var(--gain)" : "var(--loss)"} strokeWidth={1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TokenTip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as TokenDatum;
  const neg = d.avgRetPct < 0;
  return (
    <div className="panel" style={{ padding: "8px 10px", fontFamily: "var(--font-mono)", fontSize: 11 }}>
      <div className="label" style={{ marginBottom: 4 }}>${d.asset}</div>
      <div className="tnum" style={{ color: neg ? "var(--loss)" : "var(--gain)" }}>{neg ? "" : "+"}{d.avgRetPct}% avg</div>
      <div className="tnum" style={{ color: "var(--muted)" }}>{d.count} call{d.count === 1 ? "" : "s"} · {d.winRate}% win</div>
    </div>
  );
}

// ---- per-call returns timeline (win/loss streak) ---------------------------
export type ReturnDatum = { label: string; retPct: number; asset: string };

export function ReturnsTimeline({ data, height = 220 }: { data: ReturnDatum[]; height?: number }) {
  const uid = useId().replace(/:/g, "");
  if (!data.length) return <EmptyChart label="no settled calls yet" height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <pattern id={`rg-${uid}`} patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="var(--gain)" fillOpacity="0.16" />
            <circle cx="2" cy="2" r="0.9" fill="var(--gain)" />
          </pattern>
          <pattern id={`rl-${uid}`} patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="var(--loss)" fillOpacity="0.16" />
            <circle cx="2" cy="2" r="0.9" fill="var(--loss)" />
          </pattern>
        </defs>
        <CartesianGrid stroke="var(--line)" strokeDasharray="2 3" vertical={false} />
        <XAxis dataKey="label" stroke="var(--line)" tick={{ fill: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 9 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={10} />
        <YAxis stroke="var(--line)" tick={{ fill: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 10 }} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip cursor={{ fill: "var(--bg-2)" }} content={(p) => <ReturnTip {...p} />} />
        <Bar dataKey="retPct" isAnimationActive animationDuration={1000} animationEasing={EASE} radius={2}>
          {data.map((d, i) => (
            <Cell key={i} fill={`url(#${d.retPct >= 0 ? "rg" : "rl"}-${uid})`} stroke={d.retPct >= 0 ? "var(--gain)" : "var(--loss)"} strokeWidth={1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ReturnTip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as ReturnDatum;
  const neg = d.retPct < 0;
  return (
    <div className="panel" style={{ padding: "8px 10px", fontFamily: "var(--font-mono)", fontSize: 11 }}>
      <div className="label" style={{ marginBottom: 4 }}>${d.asset} · {d.label}</div>
      <div className="tnum" style={{ color: neg ? "var(--loss)" : "var(--gain)" }}>{neg ? "" : "+"}{d.retPct}%</div>
    </div>
  );
}

// ---- long / short split (CSS-animated, throttle-safe) ----------------------
export function DirectionSplit({ longPct }: { longPct: number }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(longPct), 60);
    return () => clearTimeout(t);
  }, [longPct]);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span className="label" style={{ color: "var(--gain)" }}>▲ long {longPct}%</span>
        <span className="label" style={{ color: "var(--loss)" }}>{100 - longPct}% short ▼</span>
      </div>
      <div style={{ height: 12, borderRadius: 999, overflow: "hidden", display: "flex", border: "1px solid var(--line)", background: "var(--bg-2)" }}>
        <div style={{ width: `${w}%`, background: "var(--gain)", transition: `width 1s ${EASE}` }} />
        <div style={{ flex: 1, background: "var(--loss)", opacity: 0.9 }} />
      </div>
    </div>
  );
}

// ---- mini: cumulative sparkline (inline SVG) -------------------------------
export function Sparkline({ values, positive, height = 52 }: { values: number[]; positive: boolean; height?: number }) {
  const uid = useId().replace(/:/g, "");
  if (values.length < 2) return <EmptyChart label="not enough scored calls" height={height} />;
  const w = 200;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const y = (v: number) => height - 5 - ((v - min) / span) * (height - 10);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, y(v)] as const);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const color = positive ? "var(--gain)" : "var(--loss)";
  const zeroY = y(0);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <pattern id={`sp-${uid}`} patternUnits="userSpaceOnUse" width="3" height="3">
          <circle cx="1.5" cy="1.5" r="0.6" fill={color} fillOpacity="0.55" />
        </pattern>
      </defs>
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="var(--line)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      <path d={`${d} L${w},${zeroY} L0,${zeroY} Z`} fill={`url(#sp-${uid})`} opacity={0.9} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// ---- mini: horizontal stacked mix bar --------------------------------------
export function SignalMix({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", border: "1px solid var(--line)", background: "var(--bg-2)" }}>
        {shown.map((s) => (
          <div key={s.label} style={{ width: `${(100 * s.value) / total}%`, background: s.color }} title={`${s.label}: ${s.value}`} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10 }}>
        {shown.map((s) => (
          <span key={s.label} className="label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
            {s.label} {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- mini: tiny bar histogram ----------------------------------------------
export function MiniBars({ bars, height = 48 }: { bars: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height }}>
      {bars.map((b, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div
            title={`${b.label}: ${b.value}`}
            style={{ width: "100%", height: `${(b.value / max) * (height - 14)}px`, minHeight: 2, background: "var(--ink)", borderRadius: 2, transition: "height 0.9s var(--ease-out-expo)" }}
          />
          <span className="label" style={{ fontSize: 8 }}>{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyChart({ label, height }: { label: string; height: number }) {
  return (
    <div className="label" style={{ height, display: "grid", placeItems: "center", color: "var(--muted)", border: "1px dashed var(--line)", borderRadius: "var(--radius)" }}>
      {label}
    </div>
  );
}
