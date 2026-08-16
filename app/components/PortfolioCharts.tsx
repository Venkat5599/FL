"use client";

import { useId } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotItemDotProps,
  type TooltipContentProps,
} from "recharts";

// Portfolio-page charts, matching the dither / 1-bit forensic system already
// established in DitheredChart.tsx (halftone area fills) and DossierCharts.tsx
// (pattern-filled bars, dashed-border empty states). Every chart here is built
// to look intentional at 0, 1, or a handful of data points — this is a fresh
// account's page, not a mature dossier.

const EASE = "cubic-bezier(0.16,1,0.3,1)";

function EmptyChart({ label, height }: { label: string; height: number }) {
  return (
    <div
      className="label"
      style={{ height, display: "grid", placeItems: "center", color: "var(--muted)", border: "1px dashed var(--line)", borderRadius: "var(--radius)", textAlign: "center", padding: "0 20px" }}
    >
      {label}
    </div>
  );
}

// ---- cumulative USDC deployed over time ------------------------------------
export type DeployPoint = { label: string; amount: number };

export function DeployedOverTimeChart({ points, height = 220 }: { points: DeployPoint[]; height?: number }) {
  const uid = useId().replace(/[:]/g, "");
  const fineId = `dep-fine-${uid}`;
  const coarseId = `dep-coarse-${uid}`;
  const topFadeId = `dep-fade-top-${uid}`;
  const bottomFadeId = `dep-fade-bottom-${uid}`;

  if (points.length === 0) {
    return <EmptyChart label="no capital deployed yet · executed trades will chart here" height={height} />;
  }

  // Always ground the line at a "start" origin so even a single fill reads as
  // a deliberate step up from zero, not a lonely dot on a blank axis.
  // Built with reduce rather than a `let` accumulated inside .map(). Reassigning
  // an outer variable during render is what react-hooks/immutability flags, and
  // it is flagging something real: under concurrent rendering a render can be
  // started, abandoned and restarted, and a mutable outer binding does not reset
  // with it. Carrying the running total inside the accumulator makes the whole
  // computation a pure function of `points`.
  const series = points.reduce<{ label: string; cumulative: number }[]>(
    (acc, p) => {
      const running = acc[acc.length - 1].cumulative + p.amount;
      return [...acc, { label: p.label, cumulative: Math.round(running * 100) / 100 }];
    },
    [{ label: "start", cumulative: 0 }],
  );
  const sparse = points.length < 3;

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={series} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <pattern id={fineId} patternUnits="userSpaceOnUse" width="3" height="3">
              <circle cx="1.5" cy="1.5" r="0.55" fill="var(--ink)" fillOpacity={0.85} />
            </pattern>
            <pattern id={coarseId} patternUnits="userSpaceOnUse" width="7" height="7">
              <circle cx="3.5" cy="3.5" r="0.9" fill="var(--ink)" fillOpacity={0.7} />
            </pattern>
            <linearGradient id={topFadeId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
              <stop offset="75%" stopColor="#fff" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={bottomFadeId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0" />
              <stop offset="60%" stopColor="#fff" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0.55" />
            </linearGradient>
            <mask id={`dep-mask-top-${uid}`}>
              <rect width="100%" height="100%" fill={`url(#${topFadeId})`} />
            </mask>
            <mask id={`dep-mask-bottom-${uid}`}>
              <rect width="100%" height="100%" fill={`url(#${bottomFadeId})`} />
            </mask>
          </defs>

          <CartesianGrid stroke="var(--line)" strokeDasharray="2 3" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="var(--line)"
            tick={{ fill: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
            minTickGap={24}
          />
          <YAxis
            stroke="var(--line)"
            tick={{ fill: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={54}
            tickFormatter={(v: number) => `$${v.toLocaleString()}`}
          />
          <Tooltip content={DepositTooltip} cursor={{ stroke: "var(--line-strong)", strokeDasharray: "2 2" }} />

          <Area
            type="stepAfter"
            dataKey="cumulative"
            stroke="none"
            fill={`url(#${fineId})`}
            mask={`url(#dep-mask-top-${uid})`}
            isAnimationActive
            animationDuration={1000}
            animationEasing={EASE}
            dot={false}
            legendType="none"
          />
          <Area
            type="stepAfter"
            dataKey="cumulative"
            stroke="none"
            fill={`url(#${coarseId})`}
            mask={`url(#dep-mask-bottom-${uid})`}
            isAnimationActive
            animationDuration={1000}
            animationEasing={EASE}
            dot={false}
            legendType="none"
          />
          <Line
            type="stepAfter"
            dataKey="cumulative"
            name="Deployed"
            stroke="var(--ink)"
            strokeWidth={2}
            dot={(props: DotItemDotProps) =>
              props.index === series.length - 1 ? (
                <EndpointDot key={`endpoint-${props.index}`} cx={props.cx} cy={props.cy} color="var(--ink)" />
              ) : (
                <g key={`dot-${props.index}`} />
              )
            }
            activeDot={{ r: 4, stroke: "var(--bg)", strokeWidth: 1.5, fill: "var(--ink)" }}
            isAnimationActive
            animationDuration={1000}
            animationEasing={EASE}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {sparse && (
        <div className="label" style={{ marginTop: 8, color: "var(--faint)", textAlign: "center" }}>
          {points.length === 1 ? "one execution so far · trend fills in with more fills" : "early history · trend fills in with more fills"}
        </div>
      )}
    </div>
  );
}

function EndpointDot({ cx, cy, color }: { cx?: number; cy?: number; color: string }) {
  if (cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill={color} opacity={0.14} />
      <circle cx={cx} cy={cy} r={3} fill={color} stroke="var(--bg)" strokeWidth={1.5} />
    </g>
  );
}

function DepositTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const v = Number(payload[0]?.value ?? 0);
  return (
    <div className="panel" style={{ padding: "8px 10px", fontFamily: "var(--font-mono)", fontSize: 11 }}>
      <div className="label" style={{ marginBottom: 4 }}>{label}</div>
      <div className="tnum">${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} deployed</div>
    </div>
  );
}

// ---- per-creator deployed / P&L horizontal bars -----------------------------
export type CreatorDatum = { handle: string; deployedUsdc: number; pnlUsd: number; executed: number };

export function CreatorDeployedChart({ data, height }: { data: CreatorDatum[]; height?: number }) {
  const uid = useId().replace(/[:]/g, "");
  if (!data.length) return <EmptyChart label="no creator activity yet" height={height ?? 160} />;
  const h = height ?? Math.max(120, data.length * 44);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, bottom: 0, left: 8 }} barCategoryGap={14}>
        <defs>
          <pattern id={`cg-${uid}`} patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="var(--gain)" fillOpacity="0.16" />
            <circle cx="2" cy="2" r="0.9" fill="var(--gain)" />
          </pattern>
          <pattern id={`cl-${uid}`} patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="var(--loss)" fillOpacity="0.16" />
            <circle cx="2" cy="2" r="0.9" fill="var(--loss)" />
          </pattern>
          <pattern id={`cn-${uid}`} patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="var(--ink)" fillOpacity="0.1" />
            <circle cx="2" cy="2" r="0.9" fill="var(--ink)" fillOpacity="0.6" />
          </pattern>
        </defs>
        <CartesianGrid stroke="var(--line)" strokeDasharray="2 3" horizontal={false} />
        <XAxis
          type="number"
          stroke="var(--line)"
          tick={{ fill: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: "var(--line)" }}
          tickFormatter={(v: number) => `$${v}`}
        />
        <YAxis
          type="category"
          dataKey="handle"
          width={92}
          stroke="var(--line)"
          tick={{ fill: "var(--ink)", fontFamily: "var(--font-mono)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => `@${v}`}
        />
        <Tooltip cursor={{ fill: "var(--bg-2)" }} content={(p) => <CreatorTip {...p} />} />
        <Bar dataKey="deployedUsdc" isAnimationActive animationDuration={900} animationEasing={EASE} radius={2}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={`url(#${d.pnlUsd > 0 ? "cg" : d.pnlUsd < 0 ? "cl" : "cn"}-${uid})`}
              stroke={d.pnlUsd > 0 ? "var(--gain)" : d.pnlUsd < 0 ? "var(--loss)" : "var(--line-strong)"}
              strokeWidth={1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function CreatorTip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as CreatorDatum;
  const neg = d.pnlUsd < 0;
  return (
    <div className="panel" style={{ padding: "8px 10px", fontFamily: "var(--font-mono)", fontSize: 11 }}>
      <div className="label" style={{ marginBottom: 4 }}>@{d.handle}</div>
      <div className="tnum">${d.deployedUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} deployed</div>
      <div className="tnum" style={{ color: d.pnlUsd === 0 ? "var(--muted)" : neg ? "var(--loss)" : "var(--gain)" }}>
        {d.pnlUsd >= 0 ? "+" : "−"}${Math.abs(d.pnlUsd).toFixed(2)} p&amp;l · {d.executed} executed
      </div>
    </div>
  );
}

// ---- copy vs fade donut ------------------------------------------------------
export function CopyFadeDonut({ copies, fades, size = 168 }: { copies: number; fades: number; size?: number }) {
  const uid = useId().replace(/[:]/g, "");
  const total = copies + fades;
  if (total === 0) return <EmptyChart label="no signals followed yet" height={size} />;

  const data = [
    { key: "copy", label: "Copy", value: copies, color: "var(--gain)", pattern: `cf-copy-${uid}` },
    { key: "fade", label: "Fade", value: fades, color: "var(--loss)", pattern: `cf-fade-${uid}` },
  ].filter((d) => d.value > 0);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              <pattern id={`cf-copy-${uid}`} patternUnits="userSpaceOnUse" width="4" height="4">
                <rect width="4" height="4" fill="var(--gain)" fillOpacity="0.22" />
                <circle cx="2" cy="2" r="1" fill="var(--gain)" />
              </pattern>
              <pattern id={`cf-fade-${uid}`} patternUnits="userSpaceOnUse" width="4" height="4">
                <rect width="4" height="4" fill="var(--loss)" fillOpacity="0.22" />
                <circle cx="2" cy="2" r="1" fill="var(--loss)" />
              </pattern>
            </defs>
            <Tooltip content={(p) => <DonutTip {...p} total={total} />} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="94%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={data.length > 1 ? 3 : 0}
              stroke="var(--bg)"
              strokeWidth={2}
              isAnimationActive
              animationDuration={900}
              animationEasing={EASE}
            >
              {data.map((d) => (
                <Cell key={d.key} fill={`url(#${d.pattern})`} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", textAlign: "center" }}>
          <div>
            <div className="tnum" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 22, lineHeight: 1 }}>{total}</div>
            <div className="label" style={{ marginTop: 4 }}>signals</div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <LegendRow color="var(--gain)" label="copy" value={copies} pct={Math.round((copies / total) * 100)} />
        <LegendRow color="var(--loss)" label="fade" value={fades} pct={Math.round((fades / total) * 100)} />
      </div>
    </div>
  );
}

function LegendRow({ color, label, value, pct }: { color: string; label: string; value: number; pct: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span className="label" style={{ color: "var(--ink)" }}>{label}</span>
      <span className="tnum" style={{ fontSize: 13 }}>{value}</span>
      <span className="label" style={{ color: "var(--faint)" }}>{pct}%</span>
    </div>
  );
}

function DonutTip({ active, payload, total }: TooltipContentProps & { total: number }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as { label: string; value: number; color: string };
  return (
    <div className="panel" style={{ padding: "8px 10px", fontFamily: "var(--font-mono)", fontSize: 11 }}>
      <div className="tnum" style={{ color: d.color }}>{d.label}: {d.value} ({Math.round((d.value / total) * 100)}%)</div>
    </div>
  );
}

// ---- trade status breakdown ---------------------------------------------------
export function TradeStatusChart({ executed, pending, failed, height = 168 }: { executed: number; pending: number; failed: number; height?: number }) {
  const uid = useId().replace(/[:]/g, "");
  const total = executed + pending + failed;
  if (total === 0) return <EmptyChart label="no trades yet" height={height} />;

  const data = [
    { label: "EXECUTED", value: executed, kind: "e" },
    { label: "PENDING", value: pending, kind: "p" },
    { label: "FAILED", value: failed, kind: "f" },
  ];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
        <defs>
          <pattern id={`ts-e-${uid}`} patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="var(--gain)" fillOpacity="0.18" />
            <circle cx="2" cy="2" r="0.9" fill="var(--gain)" />
          </pattern>
          <pattern id={`ts-p-${uid}`} patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="var(--muted)" fillOpacity="0.14" />
            <circle cx="2" cy="2" r="0.9" fill="var(--muted)" />
          </pattern>
          <pattern id={`ts-f-${uid}`} patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="var(--loss)" fillOpacity="0.18" />
            <circle cx="2" cy="2" r="0.9" fill="var(--loss)" />
          </pattern>
        </defs>
        <CartesianGrid stroke="var(--line)" strokeDasharray="2 3" vertical={false} />
        <XAxis
          dataKey="label"
          stroke="var(--line)"
          tick={{ fill: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: "var(--line)" }}
        />
        <YAxis
          stroke="var(--line)"
          tick={{ fill: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={30}
          allowDecimals={false}
        />
        <Tooltip cursor={{ fill: "var(--bg-2)" }} content={(p) => <StatusTip {...p} />} />
        <Bar dataKey="value" isAnimationActive animationDuration={900} animationEasing={EASE} radius={2} maxBarSize={64}>
          {data.map((d) => (
            <Cell
              key={d.kind}
              fill={`url(#ts-${d.kind}-${uid})`}
              stroke={d.kind === "e" ? "var(--gain)" : d.kind === "f" ? "var(--loss)" : "var(--line-strong)"}
              strokeWidth={1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function StatusTip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as { label: string; value: number };
  return (
    <div className="panel" style={{ padding: "8px 10px", fontFamily: "var(--font-mono)", fontSize: 11 }}>
      <div className="label" style={{ marginBottom: 4 }}>{d.label}</div>
      <div className="tnum">{d.value} trade{d.value === 1 ? "" : "s"}</div>
    </div>
  );
}
