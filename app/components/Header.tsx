"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePrivy, useWallets, useSigners, useFundWallet } from "@privy-io/react-auth";
import { base, baseSepolia } from "viem/chains";
import { useBalance, useReadContracts } from "wagmi";
import { formatEther, formatUnits } from "viem";
import { useNetwork } from "@/components/NetworkProvider";
import { NETWORKS, netCfg, type Network } from "@/lib/networks";

// Minimal ERC-20 read ABI (token balances for the vault menu).
const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const viemChain = (n: Network) => (n === "mainnet" ? base : baseSepolia);

// Tokens surfaced in the vault menu per network (native ETH + the assets that
// matter for trading on that chain). address:null = native.
type BalToken = { symbol: string; address: string | null; decimals: number };
const BALANCE_TOKENS: Record<Network, BalToken[]> = {
  testnet: [
    { symbol: "ETH", address: null, decimals: 18 },
    { symbol: "USDC", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6 },
    { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  ],
  mainnet: [
    { symbol: "ETH", address: null, decimals: 18 },
    { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
    { symbol: "DEGEN", address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", decimals: 18 },
  ],
};

// Shared nav + Privy auth state, mounted once in the root layout. Carries the
// testnet/mainnet toggle, the embedded-wallet "enable auto-trading" delegation
// prompt, and (once auto-trading is on) the self-custody vault: token balances
// available to trade plus a top-up action.
export function Header() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  // This app uses Privy TEE wallets, so delegation is granted to a server-side
  // session signer (our registered authorization key quorum) rather than
  // on-device delegation.
  const { addSigners, removeSigners } = useSigners();
  const { fundWallet } = useFundWallet();
  const { network, setNetwork } = useNetwork();
  const signerId = process.env.NEXT_PUBLIC_PRIVY_AUTH_ID_2;

  const [delegating, setDelegating] = useState(false);
  const [delegateError, setDelegateError] = useState<string | null>(null);
  const [delegated, setDelegated] = useState(false);
  const [topUpMsg, setTopUpMsg] = useState<string | null>(null);

  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const walletAccount = user?.linkedAccounts.find(
    (a) => a.type === "wallet" && a.address === embeddedWallet?.address,
  ) as { delegated?: boolean } | undefined;
  const isDelegated = delegated || walletAccount?.delegated === true;

  async function handleDelegate() {
    if (!embeddedWallet) return;
    if (!signerId) {
      setDelegateError("Session signer id not configured (NEXT_PUBLIC_PRIVY_AUTH_ID_2)");
      return;
    }
    setDelegating(true);
    setDelegateError(null);
    try {
      await addSigners({ address: embeddedWallet.address, signers: [{ signerId }] });
      setDelegated(true);
    } catch (err) {
      setDelegateError(err instanceof Error ? err.message : "Delegation failed");
    } finally {
      setDelegating(false);
    }
  }

  // Revoke the session signer — the backend can no longer auto-sign for this
  // wallet. Fully user-controlled: they can turn auto-trading off anytime.
  async function handleRevoke() {
    if (!embeddedWallet) return;
    setDelegating(true);
    setDelegateError(null);
    try {
      await removeSigners({ address: embeddedWallet.address });
      setDelegated(false);
    } catch (err) {
      setDelegateError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setDelegating(false);
    }
  }

  async function handleTopUp() {
    if (!embeddedWallet) return;
    setTopUpMsg(null);
    // Testnet: you can't *buy* test tokens, so fiat funding doesn't apply.
    // Copy the vault address and point the user at the faucets instead.
    if (network === "testnet") {
      try {
        await navigator.clipboard.writeText(embeddedWallet.address);
      } catch {
        /* clipboard may be blocked; the address is still shown in the header */
      }
      window.open("https://faucet.circle.com/", "_blank", "noopener,noreferrer");
      setTopUpMsg("vault address copied — get testnet USDC (+ Base Sepolia ETH for gas) from the faucet, then send to the vault");
      return;
    }
    // Mainnet: Privy's fiat/transfer funding. Guard the promise so a disabled
    // funding config surfaces a message instead of crashing the app.
    try {
      await fundWallet({ address: embeddedWallet.address, options: { chain: viemChain(network) } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setTopUpMsg(
        /not enabled/i.test(msg)
          ? "card/exchange funding isn't enabled for this app — send funds to the vault address directly"
          : "could not start the funding flow — send funds to the vault address directly",
      );
    }
  }

  const btn: React.CSSProperties = {
    fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
    border: "1px solid var(--line-strong)", borderRadius: "var(--radius)", padding: "6px 12px",
    background: "transparent", color: "var(--muted)", cursor: "pointer",
    transition: "color .2s, border-color .2s, background .2s",
  };
  const btnPrimary: React.CSSProperties = { ...btn, background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" };

  return (
    <header
      style={{
        position: "sticky", top: 0, zIndex: 50,
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16,
        padding: "10px 24px",
        borderBottom: "1px solid var(--line)",
        background: "color-mix(in oklch, var(--bg) 80%, transparent)",
        backdropFilter: "blur(8px)",
      }}
    >
      <Link href="/" className="pixel" style={{ fontSize: 22, letterSpacing: "0.03em", color: "var(--ink)", marginRight: 8 }}>
        <span className="kol">KOL</span>LATERAL
      </Link>
      <nav style={{ display: "flex", gap: 20 }}>
        {[["/terminal", "Terminal"], ["/leaderboard", "Leaderboard"], ["/allocations", "Allocations"], ["/portfolio", "Portfolio"]].map(([href, label]) => (
          <Link key={href} href={href} className="link label" style={{ fontSize: 11 }}>
            {label}
          </Link>
        ))}
      </nav>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <NetworkToggle network={network} onChange={setNetwork} />

        {!ready && <span className="label flick">auth…</span>}

        {ready && !authenticated && (
          <button style={btnPrimary} onClick={() => login()}>Log in</button>
        )}

        {ready && authenticated && (
          <>
            {embeddedWallet ? (
              <VaultMenu
                address={embeddedWallet.address as `0x${string}`}
                network={network}
                isDelegated={isDelegated}
                busy={delegating}
                onEnable={() => void handleDelegate()}
                onDisable={() => void handleRevoke()}
                onTopUp={() => void handleTopUp()}
                onLogout={() => void logout()}
              />
            ) : (
              <button style={btn} onClick={() => void logout()}>Log out</button>
            )}
            {delegateError && <span className="label" style={{ color: "var(--loss)" }}>{delegateError.slice(0, 40)}</span>}
          </>
        )}
      </div>

      {topUpMsg && (
        <div style={{ flexBasis: "100%", marginTop: 2 }}>
          <span
            className="label"
            onClick={() => setTopUpMsg(null)}
            title="dismiss"
            style={{ color: "var(--muted)", cursor: "pointer" }}
          >
            ⓘ {topUpMsg} · dismiss
          </span>
        </div>
      )}
    </header>
  );
}

// Segmented testnet/mainnet control. Mainnet is flagged as live-funds so the
// switch to real money is never silent.
function NetworkToggle({ network, onChange }: { network: Network; onChange: (n: Network) => void }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <div style={{ display: "inline-flex", border: "1px solid var(--line-strong)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        {(["testnet", "mainnet"] as Network[]).map((n) => {
          const on = network === n;
          return (
            <button
              key={n}
              onClick={() => onChange(n)}
              title={n === "mainnet" ? "Live funds — real Base mainnet execution" : "Test funds — Base Sepolia"}
              style={{
                fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
                padding: "5px 11px", border: 0, cursor: "pointer",
                background: on ? (n === "mainnet" ? "var(--loss)" : "var(--ink)") : "transparent",
                color: on ? "var(--bg)" : "var(--muted)",
                transition: "background .2s, color .2s",
              }}
            >
              {NETWORKS[n].label}
            </button>
          );
        })}
      </div>
      {network === "mainnet" && (
        <span className="label" style={{ color: "var(--loss)", fontSize: 10 }}>● live funds</span>
      )}
    </div>
  );
}

// Self-custody vault + account menu. Collapsed: a pill showing one pinned token
// balance. Expanded: the vault address (copyable), every tracked token balance
// with a pin control, plus top-up, enable/disable auto-trading, and log out.
function VaultMenu({
  address,
  network,
  isDelegated,
  busy,
  onEnable,
  onDisable,
  onTopUp,
  onLogout,
}: {
  address: `0x${string}`;
  network: Network;
  isDelegated: boolean;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onTopUp: () => void;
  onLogout: () => void;
}) {
  const cfg = netCfg(network);
  const chainId = cfg.chainId as 84532 | 8453;
  const tokens = BALANCE_TOKENS[network];
  const erc20 = tokens.filter((t) => t.address);

  const nativeQ = useBalance({ address, chainId, query: { refetchInterval: 15000 } });
  const balQ = useReadContracts({
    contracts: erc20.map((t) => ({
      address: t.address as `0x${string}`,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf" as const,
      args: [address] as const,
      chainId,
    })),
    query: { refetchInterval: 15000 },
  });

  const rows = tokens.map((t) => {
    let bal = 0;
    if (!t.address) {
      bal = nativeQ.data ? Number(formatEther(nativeQ.data.value)) : 0;
    } else {
      const i = erc20.findIndex((e) => e.symbol === t.symbol);
      const raw = balQ.data?.[i]?.result as bigint | undefined;
      bal = raw != null ? Number(formatUnits(raw, t.decimals)) : 0;
    }
    return { ...t, bal };
  });

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPinned(localStorage.getItem("tape.pinnedToken"));
    } catch {
      /* ignore */
    }
  }, []);
  const pin = (sym: string) => {
    setPinned(sym);
    try {
      localStorage.setItem("tape.pinnedToken", sym);
    } catch {
      /* ignore */
    }
  };

  const defaultPin = network === "testnet" ? "USDC" : "ETH";
  const pinnedRow = rows.find((r) => r.symbol === (pinned ?? defaultPin)) ?? rows[0];
  const fmt = (n: number) => (n >= 1 ? n.toFixed(2) : n.toFixed(4));

  const itemBtn: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%",
    fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase",
    border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "8px 10px",
    background: "transparent", color: "var(--muted)", cursor: "pointer",
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          border: "1px solid var(--line-strong)", borderRadius: "var(--radius)",
          padding: "5px 10px", background: "transparent", cursor: "pointer",
        }}
      >
        <span className="label" style={{ color: isDelegated ? "var(--gain)" : "var(--faint)" }}>●</span>
        <span className="label tnum" style={{ fontSize: 11, color: "var(--ink)" }}>
          {fmt(pinnedRow.bal)} {pinnedRow.symbol}
        </span>
        <span className="label" style={{ color: "var(--faint)", fontSize: 9 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div
            style={{
              position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 61,
              width: 268, background: "var(--bg)", border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius)", padding: 12, display: "flex", flexDirection: "column", gap: 8,
              boxShadow: "0 12px 32px color-mix(in oklch, var(--ink) 12%, transparent)",
            }}
          >
            {/* vault address */}
            <div className="label" style={{ color: "var(--faint)" }}>vault · {cfg.chainName}</div>
            <button
              onClick={() => { navigator.clipboard?.writeText(address).catch(() => {}); }}
              title="copy vault address"
              style={{ ...itemBtn, justifyContent: "space-between", textTransform: "none", letterSpacing: 0, color: "var(--ink)" }}
            >
              <span className="tnum" style={{ fontSize: 11 }}>{address.slice(0, 10)}…{address.slice(-8)}</span>
              <span className="label" style={{ color: "var(--faint)" }}>copy ⧉</span>
            </button>

            {/* balances with pin */}
            <div className="label" style={{ color: "var(--faint)", marginTop: 2 }}>balances · ★ pins to the bar</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {rows.map((r) => {
                const isPin = pinnedRow.symbol === r.symbol;
                return (
                  <div key={r.symbol} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px" }}>
                    <button
                      onClick={() => pin(r.symbol)}
                      title={isPin ? "pinned" : "pin to the top bar"}
                      style={{ background: "none", border: 0, cursor: "pointer", color: isPin ? "var(--gain)" : "var(--faint)", fontSize: 13, lineHeight: 1, padding: 0 }}
                    >
                      {isPin ? "★" : "☆"}
                    </button>
                    <span className="label" style={{ flex: 1, color: "var(--ink)" }}>{r.symbol}</span>
                    <span className="tnum" style={{ fontSize: 12, color: r.bal > 0 ? "var(--ink)" : "var(--faint)" }}>{fmt(r.bal)}</span>
                  </div>
                );
              })}
            </div>

            <div style={{ height: 1, background: "var(--line)", margin: "2px 0" }} />

            <button onClick={onTopUp} style={{ ...itemBtn, background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" }}>
              Top up
            </button>
            {isDelegated ? (
              <button onClick={onDisable} disabled={busy} style={itemBtn}>
                {busy ? "disabling…" : "Disable auto-trading"}
              </button>
            ) : (
              <button onClick={onEnable} disabled={busy} style={itemBtn}>
                {busy ? "enabling…" : "Enable auto-trading"}
              </button>
            )}
            <button onClick={onLogout} style={{ ...itemBtn, color: "var(--loss)" }}>
              Log out
            </button>

            <div className="label" style={{ color: "var(--faint)", fontSize: 9, textAlign: "center", marginTop: 2, lineHeight: 1.5 }}>
              trades settle on {cfg.chainName} · inference verified on 0G mainnet
            </div>
          </div>
        </>
      )}
    </div>
  );
}
