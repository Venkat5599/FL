"use client";

import { useId } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotItemDotProps,
  type TooltipContentProps,
} from "recharts";

// Mirrors --ease-out-expo from globals.css (recharts can't read CSS custom
// properties for animation timing, so the curve is duplicated here).
const EASE_OUT_EXPO = "cubic-bezier(0.16,1,0.3,1)";

export type EquityPoint = {
  date: string;
  call: number;
  eth: number;
};

/**
 * Equity curve for a caller's track record, styled to the dither / 1-bit
 * forensic system: a crisp winning line over a halftone-dithered fill that
 * dissolves toward the baseline, grid + axes in mono, tooltip as a .panel.
 */
export function EquityCurveChart({
  data,
  positive,
  height = 280,
}: {
  data: EquityPoint[];
  positive: boolean;
  height?: number;
}) {
  const uid = useId().replace(/[:]/g, "");
  const lineColor = positive ? "var(--gain)" : "var(--loss)";
  const fineId = `dither-fine-${uid}`;
  const coarseId = `dither-coarse-${uid}`;
  const topFadeId = `dither-fade-top-${uid}`;
  const bottomFadeId = `dither-fade-bottom-${uid}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
        <defs>
          {/* fine halftone dots — dominant near the line. Series-color dots read
              dark on the paper bg; opacity trimmed so the field stays a quiet
              texture under the crisp line rather than a loud color wash. */}
          <pattern id={fineId} patternUnits="userSpaceOnUse" width="3" height="3">
            <circle cx="1.5" cy="1.5" r="0.55" fill={lineColor} fillOpacity={0.85} />
          </pattern>
          {/* coarse halftone dots — dominant near the baseline */}
          <pattern id={coarseId} patternUnits="userSpaceOnUse" width="7" height="7">
            <circle cx="3.5" cy="3.5" r="0.9" fill={lineColor} fillOpacity={0.7} />
          </pattern>
          {/* opacity gradients that fade the two dot layers in opposite
              directions, so the fill reads as a dither field that thins out
              toward zero rather than a flat texture */}
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
          <mask id={`mask-top-${uid}`}>
            <rect width="100%" height="100%" fill={`url(#${topFadeId})`} />
          </mask>
          <mask id={`mask-bottom-${uid}`}>
            <rect width="100%" height="100%" fill={`url(#${bottomFadeId})`} />
          </mask>
        </defs>

        <CartesianGrid stroke="var(--line)" strokeDasharray="2 3" vertical={false} />
        <XAxis
          dataKey="date"
          stroke="var(--line)"
          tick={{ fill: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: "var(--line)" }}
          minTickGap={32}
        />
        <YAxis
          stroke="var(--line)"
          tick={{ fill: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => `$${v.toLocaleString()}`}
        />
        <Tooltip content={DitherTooltip} cursor={{ stroke: "var(--line-strong)", strokeDasharray: "2 2" }} />

        {/* dithered fill — two halftone layers under the crisp line, no stroke */}
        <Area
          type="monotone"
          dataKey="call"
          stroke="none"
          fill={`url(#${fineId})`}
          mask={`url(#mask-top-${uid})`}
          isAnimationActive
          animationDuration={1200}
          animationEasing={EASE_OUT_EXPO}
          activeDot={false}
          dot={false}
          legendType="none"
        />
        <Area
          type="monotone"
          dataKey="call"
          stroke="none"
          fill={`url(#${coarseId})`}
          mask={`url(#mask-bottom-${uid})`}
          isAnimationActive
          animationDuration={1200}
          animationEasing={EASE_OUT_EXPO}
          activeDot={false}
          dot={false}
          legendType="none"
        />

        {/* ETH benchmark — neutral, drawn first so the call line sits on top */}
        <Line
          type="monotone"
          dataKey="eth"
          name="ETH"
          stroke="var(--muted)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          dot={false}
          activeDot={{ r: 3, stroke: "var(--bg)", strokeWidth: 1, fill: "var(--muted)" }}
          isAnimationActive
          animationDuration={1200}
          animationEasing={EASE_OUT_EXPO}
        />

        {/* crisp winning line + emphasized endpoint */}
        <Line
          type="monotone"
          dataKey="call"
          name="Calls"
          stroke={lineColor}
          strokeWidth={2}
          dot={(props: DotItemDotProps) =>
            props.index === data.length - 1 ? (
              <EndpointDot key={`endpoint-${props.index}`} cx={props.cx} cy={props.cy} color={lineColor} />
            ) : (
              <g key={`dot-${props.index}`} />
            )
          }
          activeDot={{ r: 4, stroke: "var(--bg)", strokeWidth: 1.5, fill: lineColor }}
          isAnimationActive
          animationDuration={1200}
          animationEasing={EASE_OUT_EXPO}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function EndpointDot({ cx, cy, color }: { cx?: number; cy?: number; color: string }) {
  if (cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill={color} opacity={0.16} />
      <circle cx={cx} cy={cy} r={3} fill={color} stroke="var(--bg)" strokeWidth={1.5} />
    </g>
  );
}

function DitherTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="panel"
      style={{
        padding: "8px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div className="label" style={{ marginBottom: 4 }}>
        {label}
      </div>
      {payload.map((entry) => {
        const value = Number(entry.value ?? 0);
        const cls = entry.dataKey === "call" ? (value < 0 ? "loss" : "gain") : undefined;
        return (
          <div
            key={entry.dataKey as string}
            className="tnum"
            style={{
              color: entry.dataKey === "call" ? undefined : "var(--muted)",
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <span className={cls}>{entry.name}</span>
            <span className={cls}>
              {value >= 0 ? "+" : ""}
              {Math.round(value).toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
