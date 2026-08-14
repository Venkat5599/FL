"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useSendTransaction, useSignTypedData } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import type { DossierCall } from "@/lib/dossier";
import { netCfg } from "@/lib/networks";
import { PoweredBy } from "@/components/PoweredBy";

// EIP-712 typed-data shape Uniswap returns as `permitData` (Permit2 PermitSingle).
interface PermitData {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  values: Record<string, unknown>;
}

// Base Sepolia canonical WETH (same address across OP-stack chains).
const WETH_BASE_SEPOLIA = "0x4200000000000000000000000000000000000006";
const DEFAULT_AMOUNT = "1000000000000000"; // 0.001 WETH-equivalent, in wei

// Token address input must be a syntactically valid EVM address — there is
// no reliable symbol -> Base Sepolia address map (lib/tokens.ts only covers
// mainnet), so the operator must supply the testnet address directly.
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

type Mode = "fade" | "follow";

interface QuoteEnvelope {
  step?: "permit" | "swap";
  quote?: {
    permitData?: PermitData;
    quote?: {
      amountIn?: string;
      amountOut?: string;
      route?: unknown;
      priceImpact?: number | string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  swap?: {
    swap?: {
      to?: string;
      data?: `0x${string}`;
      value?: string;
    };
    [key: string]: unknown;
  };
  error?: string;
  status?: number;
  detail?: unknown;
}

interface ApprovalEnvelope {
  step?: "approval";
  approval?: {
    approval?: unknown;
    [key: string]: unknown;
  };
  error?: string;
  status?: number;
  detail?: unknown;
}

// FADE inverts the call's direction; FOLLOW mirrors it. Both then map to a
// buy (WETH -> asset) or sell (asset -> WETH) leg — see task-10 brief.
function resolveSide(direction: "long" | "short" | null, mode: Mode): "long" | "short" {
  const base = direction ?? "long";
  if (mode === "follow") return base;
  return base === "long" ? "short" : "long";
}

function summarizeQuote(env: QuoteEnvelope | null): string | null {
  const q = env?.quote?.quote;
  if (!q) return null;
  const parts: string[] = [];
  if (q.amountIn) parts.push(`in ${q.amountIn}`);
  if (q.amountOut) parts.push(`out ${q.amountOut}`);
  if (q.priceImpact !== undefined) parts.push(`impact ${q.priceImpact}`);
  if (parts.length === 0) return JSON.stringify(q).slice(0, 240);
  return parts.join(" · ");
}

export function FadeTicket({ call }: { call: DossierCall }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { sendTransaction, data: hash, isPending: isSending, error: sendError, reset } =
    useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();
  const [finalizing, setFinalizing] = useState(false);

  const [assetAddress, setAssetAddress] = useState("");
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [mode, setMode] = useState<Mode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<QuoteEnvelope | null>(null);
  const [approvalInfo, setApprovalInfo] = useState<ApprovalEnvelope | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loggedHashRef = useRef<string | null>(null);

  const isValidAddress = ADDRESS_RE.test(assetAddress);
  const side = mode ? resolveSide(call.direction, mode) : null;
  const tokenIn = side === "long" ? WETH_BASE_SEPOLIA : assetAddress;
  const tokenOut = side === "long" ? assetAddress : WETH_BASE_SEPOLIA;

  async function runQuote(currentMode: Mode) {
    if (!isValidAddress) {
      setError("Enter a valid Base Sepolia token address to price the demo swap.");
      return;
    }
    if (!address) {
      setError("Connect a wallet first.");
      return;
    }
    setLoading(true);
    setError(null);
    setApprovalInfo(null);
    try {
      const s = resolveSide(call.direction, currentMode);
      const body = {
        action: "quote" as const,
        tokenIn: s === "long" ? WETH_BASE_SEPOLIA : assetAddress,
        tokenOut: s === "long" ? assetAddress : WETH_BASE_SEPOLIA,
        amount,
        swapper: address,
        chainId: baseSepolia.id,
      };
      // Trading API's check_approval gate — kept non-blocking for the demo
      // (a real wallet flow would block on its result before /quote), but
      // the result is captured and surfaced to the user informationally.
      fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approval",
          walletAddress: address,
          token: body.tokenIn,
          amount,
          chainId: baseSepolia.id,
        }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<ApprovalEnvelope>) : null))
        .then((json) => setApprovalInfo(json))
        .catch(() => {});

      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as QuoteEnvelope;
      if (!res.ok) {
        const detail =
          (json.detail as { errorCode?: string } | undefined)?.errorCode ??
          json.status ??
          "";
        setError(`${json.error ?? "quote_failed"}: ${detail}`);
        setEnvelope(null);
        return;
      }
      setEnvelope(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quote request failed");
    } finally {
      setLoading(false);
    }
  }

  function handlePick(next: Mode) {
    setMode(next);
    loggedHashRef.current = null;
    reset();
    void runQuote(next);
  }

  // Live-refresh the quote every 20s while a mode is selected and the swap
  // hasn't executed yet, so the route shown stays close to the fill price.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (mode && !hash) {
      pollRef.current = setInterval(() => void runQuote(mode), 20_000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hash, amount, assetAddress]);

  useEffect(() => {
    if (!hash || loggedHashRef.current === hash) return;
    loggedHashRef.current = hash;
    fetch("/api/txlog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash, callId: call.id, side: mode }),
    }).catch(() => {});
  }, [hash, call.id, mode]);

  function submitTx(tx: { to?: string; data?: `0x${string}`; value?: string } | undefined) {
    if (!tx?.to || !tx?.data) return;
    sendTransaction({
      to: tx.to as `0x${string}`,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : undefined,
    });
  }

  // Non-permit route: swap calldata is already present, send it directly.
  // Permit route: sign the EIP-712 permitData, exchange the signature for swap
  // calldata via the "swap" action, then send it.
  async function handleExecute() {
    setError(null);
    if (envelope?.step === "swap") {
      submitTx(envelope.swap?.swap);
      return;
    }
    const permitData = envelope?.quote?.permitData;
    const innerQuote = envelope?.quote?.quote;
    if (!permitData || !innerQuote) {
      setError("Missing permit data to sign.");
      return;
    }
    setFinalizing(true);
    try {
      const signature = await signTypedDataAsync({
        domain: permitData.domain,
        types: permitData.types,
        primaryType: "PermitSingle",
        message: permitData.values,
      });
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "swap", quote: innerQuote, signature, permitData }),
      });
      const json = (await res.json()) as QuoteEnvelope;
      if (!res.ok) {
        const detail =
          (json.detail as { errorCode?: string } | undefined)?.errorCode ?? json.status ?? "";
        setError(`${json.error ?? "swap_failed"}: ${detail}`);
        return;
      }
      submitTx(json.swap?.swap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Permit signing failed");
    } finally {
      setFinalizing(false);
    }
  }

  const routeSummary = summarizeQuote(envelope);
  const step = envelope?.step;

  return (
    <div
      className="rounded-lg border px-4 py-3 text-sm"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Fade / Follow · Base Sepolia</span>
        {!isConnected ? (
          <button
            onClick={() => connectors[0] && connect({ connector: connectors[0] })}
            className="text-xs underline link"
          >
            connect wallet
          </button>
        ) : (
          <span className="text-xs font-mono" style={{ color: "var(--faint)" }}>
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--faint)" }}>token address</span>
          <input
            value={assetAddress}
            onChange={(e) => setAssetAddress(e.target.value)}
            placeholder="0x… (token address on Base Sepolia)"
            className="border rounded px-2 py-1 text-xs font-mono"
            style={{ background: "var(--bg-2)", borderColor: "var(--line)", color: "var(--ink)" }}
          />
          {assetAddress === "" && (
            <span className="text-[10px]" style={{ color: "var(--faint)" }}>
              Enter the token&apos;s Base Sepolia address.
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--faint)" }}>amount (wei)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="border rounded px-2 py-1 text-xs font-mono"
            style={{ background: "var(--bg-2)", borderColor: "var(--line)", color: "var(--ink)" }}
          />
        </label>
      </div>

      <div className="flex gap-2 mb-3">
        <button
          onClick={() => handlePick("fade")}
          disabled={loading || !isValidAddress}
          className={`flex-1 rounded px-3 py-2 text-sm font-medium border disabled:opacity-40 disabled:cursor-not-allowed ${
            mode === "fade" ? "" : "border-[color:var(--line)] hover:border-[color:var(--line-strong)]"
          }`}
          style={
            mode === "fade"
              ? {
                  border: "1px solid color-mix(in oklch, var(--loss) 45%, var(--line))",
                  background: "color-mix(in oklch, var(--loss) 8%, var(--surface))",
                  color: "var(--loss)",
                }
              : { color: "var(--ink)" }
          }
        >
          FADE
        </button>
        <button
          onClick={() => handlePick("follow")}
          disabled={loading || !isValidAddress}
          className={`flex-1 rounded px-3 py-2 text-sm font-medium border disabled:opacity-40 disabled:cursor-not-allowed ${
            mode === "follow" ? "" : "border-[color:var(--line)] hover:border-[color:var(--line-strong)]"
          }`}
          style={
            mode === "follow"
              ? {
                  border: "1px solid color-mix(in oklch, var(--gain) 45%, var(--line))",
                  background: "color-mix(in oklch, var(--gain) 8%, var(--surface))",
                  color: "var(--gain)",
                }
              : { color: "var(--ink)" }
          }
        >
          FOLLOW
        </button>
      </div>

      {loading && <div className="text-xs mb-2" style={{ color: "var(--faint)" }}>fetching quote…</div>}
      {error && <div className="text-xs mb-2" style={{ color: "var(--loss)" }}>{error}</div>}
      {approvalInfo?.approval?.approval != null && (
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
          Approval may be required before swap.
        </div>
      )}

      {mode && side && (
        <div className="text-xs mb-2 font-mono" style={{ color: "var(--faint)" }}>
          {side === "long" ? "buy" : "sell"} · in {tokenIn.slice(0, 8)}… → out{" "}
          {tokenOut.slice(0, 8)}…
        </div>
      )}

      {envelope && (
        <div
          className="rounded px-3 py-2 mb-2 border"
          style={{ borderColor: "var(--line)", background: "var(--bg-2)" }}
        >
          <div className="label mb-1">
            {step === "permit" ? "permit required" : "route"}
          </div>
          <div className="text-xs font-mono break-all" style={{ color: "var(--ink)" }}>
            {routeSummary ?? "no route data returned"}
          </div>
        </div>
      )}

      {((step === "swap" && envelope?.swap?.swap?.to) || step === "permit") && !hash && (
        <button
          onClick={() => void handleExecute()}
          disabled={isSending || finalizing}
          className="w-full rounded px-3 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: "var(--ink)", color: "var(--surface)" }}
        >
          {finalizing
            ? "sign permit in wallet…"
            : isSending
              ? "confirm in wallet…"
              : step === "permit"
                ? "Sign Permit & Execute"
                : "Sign & Execute"}
        </button>
      )}

      {sendError && (
        <div className="text-xs mt-2" style={{ color: "var(--loss)" }}>{sendError.message}</div>
      )}

      {hash && (
        <div className="text-xs mt-2 font-mono break-all" style={{ color: "var(--gain)" }}>
          sent:{" "}
          <a
            href={`${netCfg("testnet").explorer}/tx/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            title="view transaction on the block explorer"
            style={{ color: "var(--gain)", borderBottom: "1px solid var(--line-strong)", textDecoration: "none" }}
          >
            {hash} ↗
          </a>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
        <PoweredBy protocol="fxrp" />
      </div>
    </div>
  );
}
