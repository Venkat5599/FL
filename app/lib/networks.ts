// Network model for the FADE/FOLLOW execution layer. The UI toggles between
// "testnet" and "mainnet" (deliberately not surfacing the chain brand); each
// maps to a Base OP-stack chain. Every execution path (quote, sign, send) and
// the balance/vault display read the active network from here.

export type Network = "testnet" | "mainnet";

export interface NetworkCfg {
  key: Network;
  label: string; // shown in the header toggle (network-agnostic: Testnet/Mainnet)
  chainName: string; // the actual chain, surfaced in detail views (Base Sepolia / Base)
  chainId: number;
  caip2: `eip155:${number}`;
  explorer: string; // base tx/address explorer (no trailing slash)
  weth: string; // canonical wrapped-native
  nativeSymbol: string;
  live: boolean; // true = real funds move on this network
  // The asset a directional trade is denominated in: a "buy" spends quoteAsset
  // for the call's token, a "sell" swaps the token back to quoteAsset. On
  // testnet this is USDC because the only liquid Base Sepolia pool is WETH/USDC
  // (so an $ETH long = buy WETH with USDC). On mainnet it's WETH.
  quoteAsset: string;
  quoteDecimals: number;
  // Wei/units of quoteAsset to spend on a "buy" leg (demo sizing).
  quoteTradeAmount: string;
  // Units of the call's token to sell on a "sell" leg (demo sizing, 18-dec).
  tokenTradeAmount: string;
}

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export const NETWORKS: Record<Network, NetworkCfg> = {
  testnet: {
    key: "testnet",
    label: "Testnet",
    chainName: "Base Sepolia",
    chainId: 84532,
    caip2: "eip155:84532",
    explorer: "https://sepolia.basescan.org",
    weth: "0x4200000000000000000000000000000000000006",
    nativeSymbol: "ETH",
    live: false,
    quoteAsset: USDC_BASE_SEPOLIA, // WETH/USDC is the only liquid Base Sepolia pool
    quoteDecimals: 6,
    quoteTradeAmount: "1000000", // 1 USDC (6-dec) per buy leg
    tokenTradeAmount: "300000000000000", // 0.0003 WETH per sell leg
  },
  mainnet: {
    key: "mainnet",
    label: "Mainnet",
    chainName: "Base",
    chainId: 8453,
    caip2: "eip155:8453",
    explorer: "https://basescan.org",
    weth: "0x4200000000000000000000000000000000000006",
    nativeSymbol: "ETH",
    live: true,
    quoteAsset: "0x4200000000000000000000000000000000000006", // WETH (Trading API path)
    quoteDecimals: 18,
    quoteTradeAmount: "1000000000000000", // 0.001 WETH
    tokenTradeAmount: "1000000000000000",
  },
};

export function isNetwork(v: unknown): v is Network {
  return v === "testnet" || v === "mainnet";
}

export function netCfg(network: Network): NetworkCfg {
  return NETWORKS[network] ?? NETWORKS.testnet;
}

// Per-network symbol -> token address maps. Only tokens that actually have a
// tradeable pool on that chain are listed; anything absent is reported as
// "no pool available on <network>" the instant the user clicks, instead of
// dropping into a manual swap form for an asset that can't settle here.
//
// These are Base-chain addresses, NOT the Ethereum-mainnet addresses in
// lib/tokens.ts (which are for USD pricing only). Most influencer call assets
// (ENA, PEPE, SPX, ...) are Ethereum/Solana native and have no Base pool, so
// they intentionally resolve to "no pool" here.
const WETH = "0x4200000000000000000000000000000000000006";

export const NETWORK_TOKENS: Record<Network, Record<string, string>> = {
  // Base Sepolia: only the wrapped-native and Circle's testnet USDC have any
  // routable liquidity via the Uniswap testnet deployment.
  testnet: {
    WETH,
    ETH: WETH,
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
  // Base mainnet: liquid, Base-native majors with real Uniswap pools.
  mainnet: {
    WETH,
    ETH: WETH,
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    CBBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    DEGEN: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    BRETT: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
    VIRTUAL: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
    TOSHI: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
  },
};

// Resolve a call's asset symbol to a tradeable address on the active network,
// or null when there is no pool for it there.
export function resolveToken(network: Network, symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  return NETWORK_TOKENS[network]?.[symbol.trim().toUpperCase()] ?? null;
}

export function isTradeable(network: Network, symbol: string | null | undefined): boolean {
  return resolveToken(network, symbol) !== null;
}
