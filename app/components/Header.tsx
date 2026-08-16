"use client";

import Link from "next/link";
import { useState } from "react";
import { ConnectWallet } from "@/components/ConnectWallet";
import { useBalance, useReadContracts } from "wagmi";
import { formatEther, formatUnits } from "viem";
import { useNetwork } from "@/components/NetworkProvider";
import { useAuth } from "@/lib/useAuth";
import { NETWORKS, netCfg, type Network } from "@/lib/networks";
import { useLocalStorageValue } from "@/lib/useClientState";

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

// Tokens surfaced in the vault menu per network (native ETH + the assets that
// matter for trading on that chain). address:null = native.
type BalToken = { symbol: string; address: string | null; decimals: number };
// Balances shown in the header, per network.
//
// Coston2 addresses resolved on-chain, not copied from a doc:
//   ContractRegistry -> AssetManagerFXRP -> fAsset()
// FXRP reports 6 decimals (XRPL drops), NOT 18 — assuming 18 here would misread a
// balance by a factor of a trillion. On testnet the FAsset is named FTestXRP.
const BALANCE_TOKENS: Record<Network, BalToken[]> = {
  testnet: [
    { symbol: "C2FLR", address: null, decimals: 18 },
    { symbol: "FXRP", address: "0x0b6A3645c240605887a5532109323A3E12273dc7", decimals: 6 },
  ],
  mainnet: [
    { symbol: "FLR", address: null, decimals: 18 },
    // Resolved at runtime through ContractRegistry.getAssetManagerFXRP() -> fAsset();
    // left null here rather than hardcoding a mainnet address we have not verified.
    { symbol: "FXRP", address: null, decimals: 6 },
  ],
};

// Shared nav + wallet session, mounted once in the root layout. Carries the
// testnet/mainnet toggle, the sign-in action, and the wallet menu: balances plus a
// top-up route.
//
// There is no "enable auto-trading" delegation prompt any more. It used to hand a
// server-side signer authority over the user's wallet so trades could run unattended;
// that made the operator custodial in a product whose whole claim is that you do not
// have to trust the operator. Trades are signed by the user's own wallet or they do not
// happen.
export function Header() {
  const { ready, authenticated, connected, address, signingIn, signIn, disconnect } = useAuth();
  const { network, setNetwork } = useNetwork();

  const [topUpMsg, setTopUpMsg] = useState<string | null>(null);

  function handleTopUp() {
    if (!address) return;
    setTopUpMsg(null);
    // You cannot buy test tokens, so on testnet the useful action is the faucet plus the
    // address to send to — not a fiat funding flow that cannot work here.
    if (network === "testnet") {
      navigator.clipboard?.writeText(address).catch(() => {
        /* clipboard may be blocked; the address is still shown in the menu */
      });
      window.open("https://faucet.flare.network/coston2", "_blank", "noopener,noreferrer");
      setTopUpMsg("address copied — claim C2FLR for gas at faucet.flare.network/coston2, then acquire FXRP");
      return;
    }
    setTopUpMsg("send FLR or FXRP to the address above from your exchange or wallet");
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
        <span className="kol">TA</span>PE
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

        {/* Connected but unsigned is a real, common state — the wallet is available and
            the user simply has not proved it yet. It gets its own affordance rather than
            being lumped in with signed out, which would hide that they are one click
            away. */}
        {(!ready || !connected) && <ConnectWallet />}

        {ready && connected && !authenticated && (
          <button style={btnPrimary} disabled={signingIn} onClick={() => void signIn()}>
            {signingIn ? "check wallet…" : "Sign in"}
          </button>
        )}

        {ready && authenticated && address && (
          <WalletMenu
            address={address}
            network={network}
            onTopUp={handleTopUp}
            onSignOut={() => void disconnect()}
          />
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
              title={n === "mainnet" ? "Live funds — real Base mainnet execution" : "Test funds — Coston2"}
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
function WalletMenu({
  address,
  network,
  onTopUp,
  onSignOut,
}: {
  address: `0x${string}`;
  network: Network;
  onTopUp: () => void;
  onSignOut: () => void;
}) {
  const cfg = netCfg(network);
  const chainId = cfg.chainId;
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
  // Read through useSyncExternalStore rather than a setState-in-effect, so the
  // pin also tracks changes made in another tab. `stored` is the persisted
  // value; `override` holds a pin made in THIS tab, since the storage event
  // only fires for other tabs.
  const stored = useLocalStorageValue("tape.pinnedToken");
  const [override, setOverride] = useState<string | null>(null);
  const pinned = override ?? stored;
  const pin = (sym: string) => {
    setOverride(sym);
    try {
      localStorage.setItem("tape.pinnedToken", sym);
    } catch {
      /* ignore */
    }
  };

  const defaultPin = "FXRP";
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
        <span className="label" style={{ color: "var(--gain)" }}>●</span>
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
            <div className="label" style={{ color: "var(--faint)" }}>wallet · {cfg.chainName}</div>
            <button
              onClick={() => { navigator.clipboard?.writeText(address).catch(() => {}); }}
              title="copy wallet address"
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
            <button onClick={onSignOut} style={{ ...itemBtn, color: "var(--loss)" }}>
              Sign out
            </button>

            <div className="label" style={{ color: "var(--faint)", fontSize: 9, textAlign: "center", marginTop: 2, lineHeight: 1.5 }}>
              positions settle in FXRP on {cfg.chainName} · marked by FTSOv2
            </div>
          </div>
        </>
      )}
    </div>
  );
}
