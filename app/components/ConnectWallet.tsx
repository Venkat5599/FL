"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useBalance, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { coston2 } from "@/lib/wagmi";
import { FLARE_NETWORKS, addressUrl } from "@/lib/flare";

/**
 * Wallet connection for TAPE.
 *
 * Deliberately an injected-wallet connector rather than a hosted auth service: this app's
 * whole argument is that no part of the record depends on trusting an intermediary, and
 * routing the user's keys through a third party to prove that point would be a strange
 * way to make it. The user's own wallet signs, or nothing signs.
 *
 * Two things this handles that a bare connect button usually does not:
 *
 *  1. WRONG NETWORK. A wallet connected to Ethereum will happily sit there looking
 *     connected while every read returns nothing and every write reverts. That failure is
 *     confusing rather than informative, so a wrong chain is surfaced as its own state
 *     with a one-click fix.
 *  2. HYDRATION. `useAccount` reports disconnected on the server and connected on the
 *     client once the wallet reconnects, which is a genuine mismatch rather than an
 *     extension artifact. The component renders its neutral state until mounted.
 */

const MONO = "var(--font-mono)";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ConnectWallet() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  const { data: balance } = useBalance({ address, chainId: coston2.id, query: { enabled: isConnected } });

  const injectedConnector = connectors.find((c) => c.id === "injected") ?? connectors[0];
  const onCoston2 = chainId === coston2.id;

  // Until mounted, render the same markup the server did. Anything else is a real
  // hydration mismatch, not one worth suppressing.
  if (!mounted) {
    return <Shell label="connect wallet" muted />;
  }

  if (!isConnected) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <Shell
          label={isPending ? "connecting…" : "connect wallet"}
          onClick={() => injectedConnector && connect({ connector: injectedConnector })}
          disabled={isPending}
        />
        {error && (
          <span className="label" style={{ color: "var(--loss)", maxWidth: 220, textAlign: "right" }}>
            {/* The commonest case by far is simply having no wallet installed. Say that,
                rather than surfacing a connector stack trace. */}
            {/no provider|not found|No injected/i.test(error.message)
              ? "no browser wallet detected"
              : error.message.slice(0, 60)}
          </span>
        )}
      </div>
    );
  }

  if (!onCoston2) {
    return (
      <Shell
        label={switching ? "switching…" : "switch to Coston2"}
        onClick={() => switchChain({ chainId: coston2.id })}
        disabled={switching}
        warn
      />
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <a
        href={address ? addressUrl(address, FLARE_NETWORKS.coston2) : "#"}
        target="_blank"
        rel="noopener noreferrer"
        title="view on the Flare explorer"
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: "var(--ink)",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--gain)", flexShrink: 0 }}
        />
        {address ? short(address) : ""}
        {balance && (
          <span style={{ color: "var(--muted)" }}>
            {/* This wagmi version returns raw `value` + `decimals`, not a preformatted
                string — formatting here rather than assuming a helper exists. */}
            · {Number(formatUnits(balance.value, balance.decimals)).toFixed(2)} {balance.symbol}
          </span>
        )}
      </a>
      <button
        onClick={() => disconnect()}
        title="disconnect"
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          background: "transparent",
          border: "1px solid var(--line)",
          color: "var(--faint)",
          padding: "4px 8px",
          cursor: "pointer",
        }}
      >
        exit
      </button>
    </div>
  );
}

function Shell({
  label,
  onClick,
  disabled,
  muted,
  warn,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  muted?: boolean;
  warn?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || !onClick}
      style={{
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "6px 12px",
        background: warn ? "var(--loss)" : "var(--ink)",
        color: "var(--bg)",
        border: "none",
        cursor: disabled || !onClick ? "default" : "pointer",
        opacity: muted ? 0.55 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
