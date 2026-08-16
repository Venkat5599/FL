"use client";

import { useEffect, useState } from "react";
import { resolveTweetUrl } from "@/lib/xlink";
import type { DossierCall } from "@/lib/dossier";

interface Receipt {
  request_json: string;
  response_json: string;
  chat_id: string | null;
  tee_signature: string | null;
  provider_address: string | null;
  verified: number;
  content_hash: string;
}

interface ReportDeletedResult {
  deleted?: boolean;
  alreadyDeleted?: boolean;
  verified?: boolean;
  error?: string;
}

function fmtDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function truncateHash(hash: string | null | undefined, n: number) {
  if (!hash) return null;
  return hash.length > n ? `${hash.slice(0, n)}…` : hash;
}

function CopyButton({ value }: { value: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!value) return null;

  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="link ml-2"
      style={{ fontSize: 11 }}
      title="Copy to clipboard"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div
      className="flex items-center justify-between py-1.5"
      style={{ borderBottom: "1px solid var(--line)" }}
    >
      <span className="label">{label}</span>
      <span className="flex items-center">
        <span style={{ color: "var(--muted)" }}>{value ?? "—"}</span>
        <CopyButton value={value} />
      </span>
    </div>
  );
}

export function CallDetail({
  call,
  onClose,
  handle,
}: {
  call: DossierCall;
  onClose: () => void;
  handle: string;
}) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [receiptMissing, setReceiptMissing] = useState(false);
  const [reportPending, setReportPending] = useState(false);
  const [reportResult, setReportResult] = useState<ReportDeletedResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Fetch-on-mount. The rule is right in general — a synchronous setState in
    // an effect costs an extra render pass before paint — but the real fix here
    // is to move this to react-query (already a dependency), not to shuffle the
    // setState around. Tracked rather than silently suppressed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReceipt(null);
    setReceiptMissing(false);
    setReportResult(null);
    fetch(`/api/receipt/${call.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<Receipt>;
      })
      .then((data) => {
        if (!cancelled) setReceipt(data);
      })
      .catch(() => {
        if (!cancelled) setReceiptMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [call.id]);

  function reportDeleted() {
    setReportPending(true);
    setReportResult(null);
    fetch("/api/report-deleted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId: call.id }),
    })
      .then((r) => r.json() as Promise<ReportDeletedResult>)
      .then((data) => setReportResult(data))
      .catch((e) => setReportResult({ error: String(e) }))
      .finally(() => setReportPending(false));
  }

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
          <h2 className="label">Call detail</h2>
          <button
            onClick={onClose}
            className="link text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {call.deleted_at != null && (
            <div
              className="px-3 py-2 text-sm"
              style={{
                borderRadius: "var(--radius)",
                border: "1px solid color-mix(in oklch, var(--loss) 45%, var(--line))",
                background: "color-mix(in oklch, var(--loss) 8%, var(--surface))",
                color: "var(--loss)",
              }}
            >
              Post deleted {fmtDate(call.deleted_at)}. Content preserved from archive (hash{" "}
              {truncateHash(receipt?.content_hash, 8) ?? "—"}).
            </div>
          )}

          {/* Tweet-like card */}
          <div
            className="px-4 py-3"
            style={{ borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--surface)" }}
          >
            <p className="whitespace-pre-wrap" style={{ color: "var(--ink)" }}>{call.content}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="label tnum">{fmtDate(call.posted_at)}</span>
              <a
                href={resolveTweetUrl(call.url, handle)}
                target="_blank"
                rel="noopener noreferrer"
                className="link"
                style={{ fontSize: 12 }}
              >
                view original →
              </a>
            </div>
          </div>

          {/* Signal box */}
          <div
            className="px-4 py-3 text-sm"
            style={{ borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--surface)" }}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: "var(--muted)" }}>
              <span>{call.template}</span>
              <span style={{ color: "var(--faint)" }}>·</span>
              <span>{call.asset_symbol ?? "—"}</span>
              <span style={{ color: "var(--faint)" }}>·</span>
              <span>{call.direction ?? "—"}</span>
              <span style={{ color: "var(--faint)" }}>·</span>
              <span className="tnum">{call.expiry_at != null ? fmtDate(call.expiry_at) : "—"}</span>
              <span style={{ color: "var(--faint)" }}>·</span>
              <span className="tnum">{(call.confidence * 100).toFixed(0)}% confidence</span>
            </div>
          </div>

          {/* Receipt strip */}
          <div
            className="px-4 py-3 text-xs"
            style={{ borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--surface)", fontFamily: "var(--font-mono)" }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="label">TEE receipt</span>
              {!receiptMissing && receipt && (
                receipt.verified === 1 ? (
                  <span className="label" style={{ color: "var(--muted)" }}>evidence chain</span>
                ) : (
                  <span className="label">unverified on this provider</span>
                )
              )}
            </div>
            {receiptMissing ? (
              <div className="label">No receipt available for this call.</div>
            ) : (
              <>
                <ReceiptRow
                  label="content hash"
                  value={truncateHash(receipt?.content_hash, 16)}
                />
                <ReceiptRow label="chat id" value={receipt?.chat_id ?? null} />
                <ReceiptRow
                  label="tee signature"
                  value={truncateHash(receipt?.tee_signature, 16)}
                />
                <ReceiptRow label="provider" value={receipt?.provider_address ?? null} />
              </>
            )}
            <a
              href={`/api/receipt/${call.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="link mt-3 inline-block"
            >
              verify →
            </a>
          </div>

          {/* Report deleted */}
          <div
            className="px-4 py-3 text-sm"
            style={{ borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--surface)" }}
          >
            <button
              onClick={reportDeleted}
              disabled={reportPending || call.deleted_at != null}
              className="link"
              style={{ opacity: reportPending || call.deleted_at != null ? 0.55 : 1 }}
            >
              {call.deleted_at != null
                ? "Reported deleted"
                : reportPending
                  ? "Checking…"
                  : "Report deleted"}
            </button>
            {reportResult && (
              <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                {reportResult.error
                  ? `Check failed: ${reportResult.error}`
                  : `deleted: ${String(reportResult.deleted)}${
                      reportResult.alreadyDeleted ? " (already flagged)" : ""
                    }`}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
