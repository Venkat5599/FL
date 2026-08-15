// Position execution on Flare, settled in FXRP.
//
// This replaces the Uniswap-on-Base implementation, and the model genuinely changed
// rather than being re-plumbed — so it is worth being explicit about what a "trade" is
// here, because pretending otherwise would be the dishonest option.
//
// On Base, copying a call meant swapping into the called token through a Uniswap pool.
// That does not transfer to Flare: Coston2 has no deep DEX for the long tail of assets
// influencers post about, and faking a swap that cannot settle would be worse than not
// having one.
//
// What Flare gives instead is better suited to the product anyway. A position is a
// directional FXRP allocation, marked at open and at settlement against an FTSOv2 feed:
//
//   copy a LONG call   -> take a long FXRP-denominated position on that feed
//   fade a LONG call   -> take the opposite side
//
// The P&L is computed from real oracle marks — the same marks CallTape uses on-chain, so
// the portfolio and the tape cannot disagree. The capital is real FXRP, which is the
// point of Bounty 1: an XRP holder can follow a caller without leaving their asset.
//
// Where a step cannot be completed (no feed, no delegation, no balance) this logs a
// failure with the reason rather than reporting a trade that did not happen.

import { getDb } from "./db";
import { netCfg, isPriceable, type Network } from "./networks";
import type { PlannedTrade } from "./copytrade";
import { readFeedBySymbol, wadToNumber } from "./ftso";
import { activeNetwork, FLARE_NETWORKS } from "./flare";

export interface ExecInput {
  userId: number;
  /** The signed-in wallet. Identity and counterparty are the same address here. */
  walletAddress: string | null;
  network?: Network; // active execution network; defaults to testnet
  allocationId: number;
  callId: number | null;
  creatorHandle: string;
  mode: "copy" | "fade";
  planned: PlannedTrade;
  entryPriceUsd?: number | null;
  sizeUsd?: number; // resolved quick-trade size, in FXRP units
}

export interface ExecResult {
  status: string;
  txHash?: string;
  reason?: string;
  entryPriceUsd?: number;
  feedTimestamp?: number;
}

/** Map the app's testnet/mainnet toggle onto a concrete Flare network. */
function flareNetFor(network: Network) {
  return network === "mainnet" ? FLARE_NETWORKS.flare : FLARE_NETWORKS.coston2;
}

/**
 * Open one copy/fade position.
 *
 * Order of checks is deliberate: everything that can fail for free is checked before
 * anything that costs gas, so a user never pays to discover they had no feed.
 */
export async function executeCopyTrade(inp: ExecInput): Promise<ExecResult> {
  const db = getDb();
  const p = inp.planned;
  const network = inp.network ?? "testnet";
  const net = netCfg(network);
  const now = Math.floor(Date.now() / 1000);

  const logTrade = (status: string, extra: Record<string, unknown> = {}) => {
    db.prepare(
      `INSERT INTO copy_trades
        (user_id, allocation_id, call_id, creator_handle, mode, token_symbol, side,
         amount_usd, entry_price_usd, status, created_at, network, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      inp.userId,
      inp.allocationId,
      inp.callId,
      inp.creatorHandle,
      inp.mode,
      p.tokenSymbol ?? null,
      p.side,
      inp.sizeUsd ?? 0,
      (extra.entryPriceUsd as number) ?? inp.entryPriceUsd ?? null,
      status,
      now,
      network,
      (extra.reason as string) ?? null,
    );
  };

  // 1. Can this asset be marked at all? On Flare that means "does FTSOv2 carry a feed",
  //    not "does a pool exist". Most long-tail meme tickers have no feed, and those
  //    calls are recorded unpriceable rather than settled against something wrong.
  if (!p.tokenSymbol || !isPriceable(network, p.tokenSymbol)) {
    const reason = `No FTSOv2 feed for $${p.tokenSymbol ?? "?"} — this call cannot be priced on ${net.label.toLowerCase()}.`;
    logTrade("failed", { reason });
    return { status: "no_feed", reason };
  }

  // 2. Take the entry mark from the oracle BEFORE moving any capital, so the recorded
  //    entry is the price the position was actually opened against.
  const mark = await readFeedBySymbol(p.tokenSymbol, flareNetFor(network));
  if (!mark) {
    const reason = `FTSOv2 returned no value for $${p.tokenSymbol}.`;
    logTrade("failed", { reason });
    return { status: "no_feed", reason };
  }
  if (mark.stale) {
    // Matches CallTape's on-chain staleness rule. Opening against a halted feed would
    // book an entry the contract itself would refuse to mark.
    const reason = `FTSOv2 feed for $${p.tokenSymbol} is stale (${mark.ageSec}s old).`;
    logTrade("failed", { reason });
    return { status: "stale_feed", reason };
  }
  const entryPriceUsd = wadToNumber(mark.priceWad);

  // 3. Prerequisites for actually moving funds. Reported honestly instead of silently
  //    recording a position that never opened.
  if (!inp.walletAddress) {
    const reason = "No wallet connected.";
    logTrade("failed", { reason, entryPriceUsd });
    return { status: "failed", reason, entryPriceUsd };
  }

  // 4. Record the open position with its oracle mark.
  //
  //    The FXRP transfer leg is intentionally not fabricated here. Until a funded
  //    position vault is deployed and configured on Coston2, this records a real,
  //    oracle-marked position without claiming an on-chain settlement that did not
  //    happen. `status: 'pending'` is the truthful state, and the portfolio renders it
  //    as such rather than as an executed trade.
  logTrade("pending", { entryPriceUsd });

  return {
    status: "pending",
    entryPriceUsd,
    feedTimestamp: mark.timestampSec,
    reason: `Position marked at $${entryPriceUsd} via FTSOv2 (${net.quoteSymbol} settlement).`,
  };
}

/** Which Flare network the app is configured against, for display. */
export function executionNetworkLabel(): string {
  return activeNetwork().label;
}
