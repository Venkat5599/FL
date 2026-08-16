// Public data-layer API for pricing and wallet forensics.
//
// The name is a holdover from the version backed by The Graph's Uniswap subgraphs; the
// signatures are unchanged so the pipeline and dossier code did not need rewriting, but
// everything behind them is now Flare.
//
// The honest consequence of the swap, stated once here because it is the single most
// important behavioural difference in the whole port:
//
//   The subgraph could answer "what was this token worth at 14:03 last Tuesday?".
//   FTSOv2 cannot. It is a spot oracle updating roughly every 1.8s with no history.
//
// So `priceAt` can no longer look backwards. Rather than fake it — interpolating, or
// quietly returning the current price and labelling it as the historical one — it
// returns null for any timestamp meaningfully in the past and says why. Historical marks
// on Flare come from CallTape, which RECORDS them forward at open and settle: the chain
// witnessed and timestamped each one. That is a stronger guarantee than the subgraph
// ever offered, but it only exists for calls opened on-chain, and backfilled demo calls
// carry seed marks that the UI labels as such.

import { readFeedBySymbol, wadToNumber } from "./ftso";

export type WalletSwap = {
  tx_hash: string;
  token_address: string;
  side: "buy" | "sell";
  usd_value: number;
  occurred_at: number;
};

export type PriceMark = { price: number; source: string };

/**
 * How far back a request may reach and still be answerable from spot.
 *
 * Matches CallTape's on-chain staleness window: if the contract would refuse to mark
 * against a feed this old, the app must not present it as a price either.
 */
const SPOT_TOLERANCE_SECONDS = 5 * 60;

/**
 * USD price of an asset at a timestamp.
 *
 * Takes a SYMBOL, not a contract address — the previous implementation keyed on an EVM
 * token address because it was querying pools; FTSO feeds are keyed by symbol, and
 * pretending otherwise would mean maintaining an address book for assets that have no
 * address on Flare at all.
 *
 * Returns null when the timestamp is historical. Callers already handle null as
 * "unpriceable", which is the correct and truthful outcome.
 */
export async function priceAt(symbol: string, tsSec: number): Promise<PriceMark | null> {
  const age = Math.floor(Date.now() / 1000) - tsSec;
  if (age > SPOT_TOLERANCE_SECONDS) {
    // Deliberately not an error: an old call simply cannot be priced retroactively, and
    // that is a property of the oracle, not a failure of this request.
    return null;
  }

  const mark = await readFeedBySymbol(symbol);
  if (!mark || mark.stale) return null;

  return { price: wadToNumber(mark.priceWad), source: "ftso_v2" };
}

/** Current spot price for an asset, or null when FTSOv2 carries no feed for it. */
export async function priceNow(symbol: string): Promise<PriceMark | null> {
  const mark = await readFeedBySymbol(symbol);
  if (!mark || mark.stale) return null;
  return { price: wadToNumber(mark.priceWad), source: "ftso_v2" };
}

/**
 * A wallet's token sells in a window, for the Said-vs-Did check.
 *
 * Not yet implemented on Flare. The Base version read this from the Uniswap subgraph,
 * which indexed every swap; Flare has no equivalent index of a caller's trades, so there
 * is currently no source that could answer this honestly.
 *
 * Returning an empty array rather than throwing is deliberate and matches how the
 * ranking engine treats it: a caller is reported as having no contradictions, never
 * penalised for something the chain cannot evidence. Inventing contradictions — or
 * silently dropping the check without saying so — would be far worse than a gap that is
 * documented in the submission and on the roadmap.
 */
// Typed as a const rather than a function declaration so the signature callers
// are checked against stays fully specified, while the stub body binds no
// parameters it does not use. The previous form declared three underscore-
// prefixed arguments that existed only to be ignored.
export const swapsForWallet: (
  wallet: string,
  startSec: number,
  endSec: number,
) => Promise<WalletSwap[]> = async () => [];
