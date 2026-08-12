"use client";

import { useState } from "react";
import { resolveTweetUrl } from "@/lib/xlink";
import type { SaidVsDid as SaidVsDidData, SaidVsDidCase } from "@/lib/dossier";

function fmtDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fmtUsd(v: number) {
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function CaseCard({ c, onClose, handle }: { c: SaidVsDidCase; onClose: () => void; handle: string }) {
  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{ background: "color-mix(in oklch, var(--bg) 70%, transparent)" }}
        aria-hidden="true"
      />
      <div
        className="fixed top-0 right-0 h-full w-[480px] z-50 overflow-y-auto"
        style={{ background: "var(--bg-2)", borderLeft: "1px solid var(--line-strong)" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--line)" }}
        >
          <h2 className="label">Said vs. Did</h2>
          <button
            onClick={onClose}
            className="link text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div
            className="px-4 py-3"
            style={{ borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--surface)" }}
          >
            <p className="whitespace-pre-wrap" style={{ color: "var(--ink)" }}>{c.call.content}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="label tnum">{fmtDate(c.call.posted_at)}</span>
              <a
                href={resolveTweetUrl(c.call.url, handle)}
                target="_blank"
                rel="noopener noreferrer"
                className="link"
                style={{ fontSize: 12 }}
              >
                view original →
              </a>
            </div>
          </div>

          <div
            className="px-4 py-3 text-sm tnum"
            style={{
              borderRadius: "var(--radius)",
              border: "1px solid color-mix(in oklch, var(--loss) 45%, var(--line))",
              background: "color-mix(in oklch, var(--loss) 8%, var(--surface))",
              color: "var(--loss)",
            }}
          >
            sold {c.gapHours}h after this post
          </div>

          <div
            className="px-4 py-3 text-sm space-y-2"
            style={{ borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--surface)" }}
          >
            <div className="flex items-center justify-between">
              <span className="label">amount</span>
              <span className="tnum" style={{ color: "var(--ink)" }}>{fmtUsd(c.event.usd_value)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="label">occurred</span>
              <span className="tnum" style={{ color: "var(--ink)" }}>{fmtDate(c.event.occurred_at)}</span>
            </div>
            <a
              href={`https://etherscan.io/tx/${c.event.tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="link mt-2 inline-block"
            >
              view tx on etherscan →
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

export function SaidVsDid({ data, handle }: { data: SaidVsDidData; handle: string }) {
  const [selected, setSelected] = useState<SaidVsDidCase | null>(null);

  if (!data.wallet) {
    return <div className="label py-10" style={{ color: "var(--muted)" }}>No linked wallet.</div>;
  }

  return (
    <div className="py-6">
      <p className="label" style={{ marginBottom: 24, color: "var(--faint)", letterSpacing: "0.04em", textTransform: "none", fontSize: 12 }}>
        Wallet linked via public attribution: {data.attribution ?? "—"}. Not our attribution.
      </p>

      {data.cases.length === 0 ? (
        <div className="label" style={{ color: "var(--muted)" }}>
          No contradictions in window. {data.walletEventsChecked} wallet events checked.
        </div>
      ) : (
        <div className="panel" style={{ overflow: "hidden" }}>
          <div
            className="grid grid-cols-[1fr_auto_1fr] px-4 py-3"
            style={{ borderBottom: "1px solid var(--line)" }}
          >
            <span className="label">Post</span>
            <span className="label text-center px-4">gap</span>
            <span className="label text-right">Wallet event</span>
          </div>
          {data.cases.map((c, i) => (
            <button
              key={i}
              onClick={() => setSelected(c)}
              className="wl-row w-full grid grid-cols-[1fr_auto_1fr] items-center px-4 py-3 text-sm text-left"
              style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)", background: "transparent" }}
            >
              <span className="pr-3" style={{ color: "var(--muted)" }}>
                <span className="label tnum mr-2">
                  {fmtDate(c.call.posted_at)}
                </span>
                {truncate(c.call.content, 60)}
                {c.call.asset_symbol && (
                  <span
                    className="tnum ml-2 align-middle"
                    style={{
                      padding: "1px 6px",
                      borderRadius: "var(--radius)",
                      background: "var(--bg)",
                      border: "1px solid var(--line)",
                      color: "var(--muted)",
                      fontSize: 10,
                    }}
                  >
                    {c.call.asset_symbol}
                  </span>
                )}
              </span>
              <span className="px-4 text-center whitespace-nowrap">
                <span className="inline-block h-px w-6 align-middle" style={{ background: "var(--loss)" }} />
                <span className="tnum mx-1 align-middle" style={{ color: "var(--loss)", fontSize: 12 }}>
                  {c.gapHours}h
                </span>
                <span className="inline-block h-px w-6 align-middle" style={{ background: "var(--loss)" }} />
              </span>
              <span className="tnum pl-3 text-right" style={{ color: "var(--muted)" }}>
                sold {fmtUsd(c.event.usd_value)}
                <span className="label ml-2">{fmtDate(c.event.occurred_at)}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && <CaseCard c={selected} onClose={() => setSelected(null)} handle={handle} />}
    </div>
  );
}
