// Public data-layer API for the app, backed entirely by The Graph's Uniswap v3
// subgraph (see lib/subgraph.ts). Signatures are unchanged from the earlier
// Pinax-backed version so the pipeline, dossier, and wallet sync are untouched.
import { subgraphPriceAt, subgraphSwapsForWallet } from "./subgraph";

export type WalletSwap = {
  tx_hash: string;
  token_address: string;
  side: "buy" | "sell";
  usd_value: number;
  occurred_at: number;
};

// USD price of an EVM token at a past timestamp, composed across the Uniswap v3
// (hourly) and v2 (daily) subgraphs. Returns the price and which one served it.
export async function priceAt(token: string, tsSec: number): Promise<{ price: number; source: string } | null> {
  return subgraphPriceAt(token, tsSec);
}

// A wallet's token sells in a window (each swap labelled a "sell" of the token
// it sold), for cross-referencing against LONG calls in Said-vs-Did.
export async function swapsForWallet(wallet: string, startSec: number, endSec: number): Promise<WalletSwap[]> {
  const sells = await subgraphSwapsForWallet(wallet, startSec, endSec);
  return sells.map((s) => ({
    tx_hash: s.tx_hash,
    token_address: s.token_address,
    side: "sell" as const,
    usd_value: s.usd_value,
    occurred_at: s.occurred_at,
  }));
}
