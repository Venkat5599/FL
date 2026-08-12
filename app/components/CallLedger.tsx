"use client";

import { useState } from "react";
import { resolveTweetUrl } from "@/lib/xlink";
import type { DossierCall } from "@/lib/dossier";

type Filter = "all" | "deleted" | "ambiguous";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "deleted", label: "Deleted" },
  { key: "ambiguous", label: "Ambiguous" },
];

function fmtPrice(v: number | null) {
  if (v == null) return "—";
  return v < 1 ? v.toPrecision(4) : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function CallLedger({
  calls,
  onSelect,
  handle,
}: {
  calls: DossierCall[];
  onSelect: (call: DossierCall) => void;
  handle: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = calls.filter((c) => {
    if (filter === "deleted") return c.deleted_at != null;
    if (filter === "ambiguous") return c.status === "ambiguous";
    return true;
  });

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="chip"
            style={{
              cursor: "pointer",
              background: "transparent",
              color: filter === f.key ? "var(--ink)" : "var(--faint)",
              borderColor: filter === f.key ? "var(--line-strong)" : "var(--line)",
              transition: "color 0.18s var(--ease-out-quart), border-color 0.18s var(--ease-out-quart)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto panel" style={{ padding: "0 4px" }}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
              <th className="label" style={{ padding: "12px 12px 12px 12px", fontWeight: 400 }}>Post</th>
              <th className="label" style={{ padding: "12px 12px", fontWeight: 400 }}>Asset</th>
              <th className="label" style={{ padding: "12px 12px", fontWeight: 400 }}>Dir</th>
              <th className="label" style={{ padding: "12px 12px", fontWeight: 400 }}>Entry → Latest</th>
              <th className="label" style={{ padding: "12px 12px", fontWeight: 400 }}>Return</th>
              <th className="label" style={{ padding: "12px 12px", fontWeight: 400 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={c.id}
                onClick={() => onSelect(c)}
                className="wl-row"
                style={{ borderBottom: "1px solid var(--line)", cursor: "pointer" }}
              >
                <td className="max-w-xs" style={{ padding: "12px 12px" }}>
                  <a
                    href={resolveTweetUrl(c.url, handle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="link"
                  >
                    {truncate(c.content, 80)}
                  </a>
                </td>
                <td style={{ padding: "12px 12px" }}>
                  <span
                    className="tnum"
                    style={{
                      padding: "2px 8px",
                      borderRadius: "var(--radius)",
                      background: "var(--bg)",
                      border: "1px solid var(--line)",
                      color: "var(--muted)",
                      fontSize: 12,
                    }}
                  >
                    {c.asset_symbol ?? "—"}
                  </span>
                </td>
                <td className="tnum" style={{ padding: "12px 12px", color: "var(--muted)" }}>
                  {c.direction === "long" ? "↑" : c.direction === "short" ? "↓" : "—"}
                </td>
                <td className="tnum whitespace-nowrap" style={{ padding: "12px 12px", color: "var(--muted)" }}>
                  {fmtPrice(c.entry)} → {fmtPrice(c.latest)}
                </td>
                <td
                  className="tnum"
                  style={{
                    padding: "12px 12px",
                    color:
                      c.retPct == null
                        ? "var(--faint)"
                        : c.retPct < 0
                          ? "var(--loss)"
                          : "var(--gain)",
                  }}
                >
                  {c.retPct != null ? `${c.retPct >= 0 ? "+" : ""}${c.retPct}%` : "—"}
                </td>
                <td className="whitespace-nowrap" style={{ padding: "12px 12px" }}>
                  {c.deleted_at != null && <span title="deleted">🗑️ </span>}
                  {c.status === "open" && <span title="open">⏳ </span>}
                  {c.chat_id != null && <span title="TEE artifact" style={{ color: "var(--gain)" }}>✓</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
