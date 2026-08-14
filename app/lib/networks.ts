// Network model for the FADE/FOLLOW execution layer, now Flare-native.
//
// The UI toggles between "testnet" and "mainnet" (deliberately not surfacing the chain
// brand in the toggle itself); each maps to a Flare network. Every execution path and
// the balance/vault display read the active network from here.
//
// Ported from the Base/Uniswap version. The shape of `NetworkCfg` is unchanged on
// purpose so the components and execution paths that consume it did not have to be
// rewritten in the same change — but every value behind it is different, and the
// settlement asset is now FXRP rather than WETH/USDC.

import { FLARE_NETWORKS } from "./flare";

export type Network = "testnet" | "mainnet";

export interface NetworkCfg {
  key: Network;
  label: string; // shown in the header toggle (network-agnostic: Testnet/Mainnet)
  chainName: string; // the actual chain, surfaced in detail views
  chainId: number;
  caip2: `eip155:${number}`;
  explorer: string; // base tx/address explorer (no trailing slash)
  rpcUrl: string;
  nativeSymbol: string;
  live: boolean; // true = real funds move on this network
  /// The asset a position is denominated in. On Flare this is FXRP for both networks:
  /// the entire point of the product here is that an XRP holder can follow a caller, so
  /// there is no reason to settle in anything else.
  quoteSymbol: string;
  /// FXRP carries XRPL precision — 6 decimals (drops), NOT 18. Assuming 18 is the
  /// easiest way to be wrong by a factor of a trillion when sizing a position.
  quoteDecimals: number;
  /// Base units of FXRP deployed per position at demo sizing (1 FXRP = 1_000_000 drops).
  quoteTradeAmount: string;
}

export const NETWORKS: Record<Network, NetworkCfg> = {
  testnet: {
    key: "testnet",
    label: "Testnet",
    chainName: FLARE_NETWORKS.coston2.label,
    chainId: FLARE_NETWORKS.coston2.chainId,
    caip2: `eip155:${FLARE_NETWORKS.coston2.chainId}`,
    explorer: FLARE_NETWORKS.coston2.explorer,
    rpcUrl: FLARE_NETWORKS.coston2.rpcUrl,
    nativeSymbol: FLARE_NETWORKS.coston2.nativeSymbol,
    live: false,
    quoteSymbol: "FXRP",
    quoteDecimals: 6,
    quoteTradeAmount: "1000000", // 1 FXRP per position
  },
  mainnet: {
    key: "mainnet",
    label: "Mainnet",
    chainName: FLARE_NETWORKS.flare.label,
    chainId: FLARE_NETWORKS.flare.chainId,
    caip2: `eip155:${FLARE_NETWORKS.flare.chainId}`,
    explorer: FLARE_NETWORKS.flare.explorer,
    rpcUrl: FLARE_NETWORKS.flare.rpcUrl,
    nativeSymbol: FLARE_NETWORKS.flare.nativeSymbol,
    live: true,
    quoteSymbol: "FXRP",
    quoteDecimals: 6,
    quoteTradeAmount: "1000000",
  },
};

export function isNetwork(v: unknown): v is Network {
  return v === "testnet" || v === "mainnet";
}

export function netCfg(network: Network): NetworkCfg {
  return NETWORKS[network] ?? NETWORKS.testnet;
}

/**
 * Which call assets can actually be priced on Flare.
 *
 * This deliberately answers a different question from the Base version. There, the
 * constraint was "does a Uniswap pool exist for this token". Here the constraint is
 * "does FTSOv2 carry a feed for this symbol" — because on Flare a call is settled
 * against an oracle mark, not against a pool.
 *
 * The list below is a conservative floor of feeds confirmed in Flare's published table.
 * It is NOT authoritative: FTSOv2 carries many more, and the set changes. Anything
 * needing completeness should call `loadSupportedSymbols()` in lib/ftso.ts, which asks
 * the chain. A hardcoded list here would go stale and start marking real calls
 * unpriceable, so this exists only to answer instantly in the UI before the chain
 * responds.
 */
const CONFIRMED_FEED_SYMBOLS = new Set(["FLR", "XRP", "BTC", "ETH", "DOGE", "ADA", "ALGO"]);

/**
 * Whether a call's asset can be marked on this network.
 *
 * Long-tail meme tickers — which is most of what influencers post about — have no FTSO
 * feed and resolve to false. That is correct and deliberate: those calls are recorded as
 * `unpriceable` rather than silently priced against the wrong thing. The existing schema
 * already carries that status.
 */
export function isPriceable(_network: Network, symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return CONFIRMED_FEED_SYMBOLS.has(symbol.trim().toUpperCase());
}

/** Back-compat alias for callers ported from the pool-based model. */
export const isTradeable = isPriceable;
