"use client";

import { useState } from "react";

/**
 * "Mark on-chain" — writes an FTSOv2 price observation to Coston2 and shows the receipt.
 *
 * The point of putting this in the UI is that it is the one claim in the product a viewer
 * can check for themselves in ten seconds: click, then open the explorer link and see a
 * transaction that was not there before, carrying a price this page never sent.
 *
 * The price is read from the oracle INSIDE the transaction. This component posts a symbol
 * and nothing else — no price, no timestamp — so what lands on-chain cannot have been
 * chosen here.
 */

type MarkResult = {
  ok: true;
  txHash: string;
  explorer: string;
  blockNumber: number;
  gasUsed: string;
  network: { name: string; chainId: number };
  mark: {
    markId: number;
    symbol: string;
    feedId: string;
    priceUsd: number;
    feedTimestamp: number;
    recordedAt: number;
    recorder: string;
  };
  contract: string;
};

const MONO = "var(--font-mono)";

export function MarkOnChain({ symbol = "XRP" }: { symbol?: string }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [result, setResult] = useState<MarkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, tag: `tape:${symbol}` }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.detail ?? json.error ?? "mark failed");
        setState("error");
        return;
      }
      setResult(json as MarkResult);
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  }

  // Freshness: the gap between the oracle observing the price and the chain writing it
  // down. Shown because a mark is only as good as how recent it was when recorded, and
  // hiding the lag would be the easy flattering choice.
  const lag = result ? result.mark.recordedAt - result.mark.feedTimestamp : null;

  return (
    <div style={{ border: "1px solid var(--line)", padding: 18, marginTop: 20 }}>
      <div className="label" style={{ marginBottom: 6 }}>
        {"// write a price to the chain"}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.65, marginBottom: 14 }}>
        FTSOv2 keeps no history, so TAPE records marks forward. This reads {symbol}/USD from
        the oracle <em>inside</em> the transaction and writes it to Coston2 permanently. The
        price is not sent from this page — nobody here picks the number.
      </div>

      <button
        onClick={send}
        disabled={state === "sending"}
        style={{
          fontFamily: MONO,
          fontSize: 12,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          padding: "10px 16px",
          background: state === "done" ? "transparent" : "var(--ink)",
          color: state === "done" ? "var(--ink)" : "var(--bg)",
          border: "1px solid var(--ink)",
          cursor: state === "sending" ? "wait" : "pointer",
        }}
      >
        {state === "sending"
          ? "signing + broadcasting…"
          : state === "done"
            ? "mark again"
            : `mark ${symbol}/USD on-chain`}
      </button>

      {state === "error" && (
        <div className="label" style={{ marginTop: 12, color: "var(--loss)" }}>
          {error}
        </div>
      )}

      {state === "done" && result && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <Row k="price" v={`$${result.mark.priceUsd}`} />
          <Row k="feed id" v={result.mark.feedId} />
          <Row k="oracle time" v={String(result.mark.feedTimestamp)} />
          <Row k="written at" v={`${result.mark.recordedAt}${lag !== null ? `  (+${lag}s)` : ""}`} />
          <Row k="block" v={String(result.blockNumber)} />
          <Row k="gas used" v={result.gasUsed} />
          <Row k="network" v={`${result.network.name} · ${result.network.chainId}`} />
          <a
            href={result.explorer}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              marginTop: 12,
              fontFamily: MONO,
              fontSize: 12,
              color: "var(--ink)",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            view this transaction on the Flare explorer ↗
          </a>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "3px 0", alignItems: "baseline" }}>
      <span
        className="label"
        style={{ minWidth: 96, color: "var(--faint)", flexShrink: 0 }}
      >
        {k}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 12,
          color: "var(--ink)",
          wordBreak: "break-all",
        }}
      >
        {v}
      </span>
    </div>
  );
}
