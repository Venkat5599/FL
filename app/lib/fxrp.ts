// FXRP — the settlement asset for copy and fade positions.
//
// This replaces the Uniswap-on-Base execution leg the pre-Flare version used, and the
// reason for the swap is the product, not the plumbing.
//
// XRP is one of the largest assets in crypto and has almost nothing to do in DeFi,
// because the XRP Ledger has no smart contracts. FAssets is Flare's answer: an
// over-collateralised, FDC-verified bridge that turns real XRP into FXRP, an ordinary
// ERC-20 on Flare that is always redeemable back to XRP. That makes a track-record
// product genuinely useful to XRP holders for the first time — "I follow this caller
// with my XRP" is a sentence that could not previously be said.
//
// A deliberate scope boundary. Acquiring FXRP (an XRPL payment to an agent, then a mint)
// is a cross-chain flow that belongs in the FAssets minting dApps and the Coston2
// faucet, not re-implemented here. This module assumes the user already holds FXRP and
// concerns itself only with what TAPE actually does with it: read the balance, size a
// position, and settle it. Pretending to own the whole mint flow would be a worse
// product and a much larger surface to get wrong.

import { erc20Abi, parseAbi, type Address, type Hex, type WalletClient } from "viem";

import { activeNetwork, flareContract, publicClient, type FlareNetwork } from "./flare";

const ASSET_MANAGER_ABI = parseAbi([
  "function fAsset() external view returns (address)",
]);

const FASSET_META_ABI = parseAbi([
  "function assetName() external view returns (string)",
  "function assetSymbol() external view returns (string)",
  "function assetManager() external view returns (address)",
]);

/**
 * FXRP carries the XRPL's precision — 6 decimals (drops), not 18.
 *
 * Called out loudly because assuming 18 is the single easiest way to be wrong by a
 * factor of a trillion when sizing a position. Read from the token rather than trusted,
 * but the constant documents the expectation so a mismatch is obvious.
 */
export const EXPECTED_FXRP_DECIMALS = 6;

export interface FxrpToken {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  assetManager: Address;
}

let cached: { key: string; token: FxrpToken } | null = null;

/**
 * Resolve the FXRP token through the contract registry.
 *
 * Two hops on purpose — registry -> AssetManagerFXRP -> fAsset() — because the FXRP
 * token address is not itself a registry entry, and hardcoding it would break the moment
 * FAssets redeploys on a testnet (which happens).
 */
export async function fxrpToken(net: FlareNetwork = activeNetwork()): Promise<FxrpToken> {
  if (cached?.key === net.key) return cached.token;

  const client = publicClient(net);
  const assetManager = await flareContract("AssetManagerFXRP", net);

  const address = (await client.readContract({
    address: assetManager,
    abi: ASSET_MANAGER_ABI,
    functionName: "fAsset",
  })) as Address;

  const [symbol, name, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }) as Promise<string>,
    client.readContract({ address, abi: erc20Abi, functionName: "name" }) as Promise<string>,
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
  ]);

  const token: FxrpToken = { address, symbol, name, decimals, assetManager };
  cached = { key: net.key, token };
  return token;
}

/** FXRP metadata as the FAsset itself reports it. */
export async function fxrpMetadata(net: FlareNetwork = activeNetwork()) {
  const token = await fxrpToken(net);
  const client = publicClient(net);
  const [assetName, assetSymbol] = await Promise.all([
    client.readContract({ address: token.address, abi: FASSET_META_ABI, functionName: "assetName" }),
    client.readContract({ address: token.address, abi: FASSET_META_ABI, functionName: "assetSymbol" }),
  ]);
  return { ...token, underlyingName: assetName as string, underlyingSymbol: assetSymbol as string };
}

export async function fxrpBalance(owner: Address, net: FlareNetwork = activeNetwork()): Promise<bigint> {
  const token = await fxrpToken(net);
  return (await publicClient(net).readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  })) as bigint;
}

export class InsufficientFxrpError extends Error {
  constructor(needed: bigint, held: bigint) {
    super(`insufficient FXRP: need ${needed}, hold ${held}`);
    this.name = "InsufficientFxrpError";
  }
}

/**
 * Move FXRP to settle a position.
 *
 * Balance is checked before sending rather than letting the transfer revert. A revert
 * costs the user gas and surfaces as an opaque failure; an explicit check costs one
 * `eth_call` and can say exactly what is short.
 */
export async function transferFxrp(
  wallet: WalletClient,
  to: Address,
  amount: bigint,
  net: FlareNetwork = activeNetwork(),
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account");

  const token = await fxrpToken(net);
  const held = await fxrpBalance(account.address, net);
  if (held < amount) throw new InsufficientFxrpError(amount, held);

  return wallet.writeContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
    chain: wallet.chain,
    account,
  });
}

/**
 * Size a position from a percentage of the user's FXRP balance.
 *
 * Integer maths throughout — no floats anywhere near a balance. A rounding error here is
 * not cosmetic, it is either a failed transfer or dust left behind on every trade.
 */
export function sizeByPercent(balance: bigint, percentBps: number): bigint {
  if (!Number.isInteger(percentBps) || percentBps < 0 || percentBps > 10_000) {
    throw new Error(`percentBps must be an integer in 0..10000, got ${percentBps}`);
  }
  return (balance * BigInt(percentBps)) / BigInt(10_000);
}

/** Format a raw FXRP amount for display, at the token's real precision. */
export function formatFxrp(amount: bigint, decimals = EXPECTED_FXRP_DECIMALS): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = amount / base;
  const frac = amount % base;
  if (frac === BigInt(0)) return whole.toString();
  return `${whole}.${frac.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

/** Parse a human FXRP amount into base units, without going through a float. */
export function parseFxrp(value: string, decimals = EXPECTED_FXRP_DECIMALS): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`invalid FXRP amount: ${value}`);

  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    // Silently truncating would quietly lose value on every trade. Refuse instead.
    throw new Error(`FXRP supports at most ${decimals} decimal places, got ${frac.length}`);
  }
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

/** Reset the memoised token lookup. Test-only. */
export function __resetFxrpCache(): void {
  cached = null;
}
