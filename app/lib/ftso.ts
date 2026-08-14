// FTSOv2 price reads.
//
// This replaces the Uniswap-subgraph pricing the pre-Flare version used, and the swap is
// not like-for-like — the honest difference is worth stating up front because it shapes
// every caller of this module.
//
// The subgraph was a HISTORICAL source: "what was this token worth at 14:03 last
// Tuesday?" was one query. FTSO is a SPOT oracle. It answers "what is this worth now",
// roughly every 1.8 seconds, and it keeps no history to look backwards through.
//
// So TAPE cannot reconstruct an entry price after the fact. It has to *record marks
// forward*: CallTape takes an FTSO mark when a call opens and another when it settles,
// and those stored marks become the history. That is strictly more honest than the old
// design — an entry price is now something the chain witnessed and timestamped, not
// something we looked up later and asked you to trust — but it does mean a call must be
// opened before it can be priced. Backfilled demo calls carry seed marks and are
// labelled as such in the UI rather than being passed off as on-chain observations.

import { formatUnits } from "viem";
import { activeNetwork, flareContract, publicClient, type FlareNetwork } from "./flare";
import { feedIdForSymbol, symbolFromFeedId, type FeedId } from "./feeds";

const FTSO_ABI = [
  {
    type: "function",
    name: "getFeedByIdInWei",
    stateMutability: "payable",
    inputs: [{ name: "_feedId", type: "bytes21" }],
    outputs: [
      { name: "_value", type: "uint256" },
      { name: "_timestamp", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "calculateFeeById",
    stateMutability: "view",
    inputs: [{ name: "_feedId", type: "bytes21" }],
    outputs: [{ name: "_fee", type: "uint256" }],
  },
  {
    type: "function",
    name: "getSupportedFeedIds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "_feedIds", type: "bytes21[]" }],
  },
] as const;

/// Mirrors CallTape's `maxFeedAge`. Kept in sync deliberately: if the UI showed a price
/// the contract would refuse to mark against, users would see a number and then watch
/// their transaction revert for no visible reason.
export const MAX_FEED_AGE_SECONDS = 5 * 60;

export interface FeedMark {
  feedId: FeedId;
  symbol: string;
  /// 1e18-scaled, exactly as FTSO returned it. Kept as a bigint through the data layer
  /// so nothing is lost to float rounding before it reaches storage or a comparison.
  priceWad: bigint;
  /// FTSO's own timestamp for the observation — not when we asked.
  timestampSec: number;
  /// Seconds between FTSO's observation and the read. Surfaced rather than hidden so a
  /// stale-but-usable price can be shown with its age attached.
  ageSec: number;
  stale: boolean;
}

export function ftsoAddress(net: FlareNetwork = activeNetwork()) {
  return flareContract("FtsoV2", net);
}

/// Read one feed by symbol. Returns null when the symbol has no feed, which is the
/// common case for the long-tail meme tickers influencers actually post about.
export async function readFeedBySymbol(
  symbol: string,
  net: FlareNetwork = activeNetwork(),
): Promise<FeedMark | null> {
  const feedId = feedIdForSymbol(symbol);
  try {
    return await readFeedById(feedId, net);
  } catch {
    // An unsupported feed reverts. That is an expected outcome for most symbols, not an
    // error worth propagating — callers treat null as "unpriceable" and the pipeline
    // already has a status for exactly that.
    return null;
  }
}

export async function readFeedById(feedId: FeedId, net: FlareNetwork = activeNetwork()): Promise<FeedMark> {
  const client = publicClient(net);
  const address = await ftsoAddress(net);

  const fee = (await client.readContract({
    address,
    abi: FTSO_ABI,
    functionName: "calculateFeeById",
    args: [feedId],
  })) as bigint;

  // `getFeedByIdInWei` is payable and non-view, so it cannot be a plain readContract.
  // Simulating runs it as an eth_call with the fee attached and hands back the return
  // value without broadcasting anything.
  const { result } = await client.simulateContract({
    address,
    abi: FTSO_ABI,
    functionName: "getFeedByIdInWei",
    args: [feedId],
    value: fee,
  });

  const [priceWad, timestamp] = result as unknown as [bigint, bigint];
  const timestampSec = Number(timestamp);
  const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - timestampSec);

  return {
    feedId,
    symbol: symbolFromFeedId(feedId) ?? "",
    priceWad,
    timestampSec,
    ageSec,
    stale: ageSec > MAX_FEED_AGE_SECONDS,
  };
}

/// Every feed FTSOv2 currently serves, as plain symbols.
///
/// Asked of the chain rather than hardcoded: the supported set changes over time, and a
/// stale local list would quietly mark real calls unpriceable (or worse, price them
/// against a feed that has since been retired).
export async function loadSupportedSymbols(net: FlareNetwork = activeNetwork()): Promise<Set<string>> {
  const ids = (await publicClient(net).readContract({
    address: await ftsoAddress(net),
    abi: FTSO_ABI,
    functionName: "getSupportedFeedIds",
  })) as readonly string[];

  const symbols = new Set<string>();
  for (const id of ids) {
    const symbol = symbolFromFeedId(id);
    if (symbol) symbols.add(symbol);
  }
  return symbols;
}

/// Convert a wad price to a JS number for display.
///
/// Display only. Never feed the result back into stored values or P&L: the bigint is the
/// source of truth and this is a lossy view of it.
export function wadToNumber(priceWad: bigint): number {
  return Number(formatUnits(priceWad, 18));
}

/// Format a mark for the terminal UI, at a precision that suits the magnitude — a
/// fixed 2 decimals renders sub-cent assets as "0.00", which is exactly the class of
/// asset the callers in this dataset talk about most.
export function formatPrice(priceWad: bigint): string {
  const n = wadToNumber(priceWad);
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toExponential(4);
}

/// Signed return in basis points, matching CallTape's on-chain `_pnlBps` exactly
/// (integer maths, truncating division) so the UI never disagrees with the chain.
export function pnlBps(direction: "long" | "short", entryWad: bigint, settleWad: bigint): bigint {
  // `BigInt(0)` / `BigInt(10000)` rather than `0n` / `10_000n`: the app's tsconfig
  // targets an older ES level for browser output, where BigInt literals are a syntax
  // error. The constructor form is identical at runtime and compiles everywhere.
  if (entryWad === BigInt(0)) throw new Error("entry price cannot be zero");
  const delta = direction === "long" ? settleWad - entryWad : entryWad - settleWad;
  return (delta * BigInt(10_000)) / entryWad;
}
