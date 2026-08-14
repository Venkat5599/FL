import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyUser, resolveEmbeddedWallet } from "@/lib/privy";
import { planTrade, type CallSignal } from "@/lib/copytrade";
import { executeCopyTrade } from "@/lib/execute";
import { isNetwork, netCfg, isPriceable, type Network } from "@/lib/networks";

const DEFAULT_QUICK_USD = 1;

// One-click copy/fade for a single call. Ensures the per-creator allocation
// exists, then (if the wallet is delegated for auto-trading) executes the trade
// server-side with no popups. If the wallet isn't delegated it returns
// needsDelegation:true so the UI can fall back to the one-tap signed flow.
// POST /api/trade/[callId] { mode: "copy" | "fade" }
export async function POST(req: Request, { params }: { params: Promise<{ callId: string }> }) {
  const user = await verifyUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { callId } = await params;
  const body = (await req.json().catch(() => ({}))) as { mode?: "copy" | "fade"; network?: string };
  const mode = body.mode === "fade" ? "fade" : "copy";
  const network: Network = isNetwork(body.network) ? body.network : "testnet";
  const net = netCfg(network);

  const db = getDb();
  const call = db
    .prepare(
      `SELECT c.id, c.asset_symbol, c.asset_address, c.direction, i.id AS influencer_id, i.handle,
              (SELECT m.price_usd FROM marks m WHERE m.call_id = c.id AND m.kind = 'live'
                ORDER BY m.marked_at DESC LIMIT 1) AS latest_price
       FROM calls c JOIN posts p ON p.id = c.post_id JOIN influencers i ON i.id = p.influencer_id
       WHERE c.id = ?`
    )
    .get(callId) as
    | { id: number; asset_symbol: string | null; asset_address: string | null; direction: string | null; influencer_id: number; handle: string; latest_price: number | null }
    | undefined;

  if (!call) return NextResponse.json({ error: "call not found" }, { status: 404 });
  if (!call.asset_symbol) {
    return NextResponse.json({ status: "no_pool", network, reason: "This call has no tradeable asset." });
  }

  // No-pool gate: resolve the asset to a tradeable address on the ACTIVE
  // network up front. On Flare the binding constraint is not "is there a pool"
  // but "does FTSOv2 carry a feed for this asset" — positions are settled in
  // FXRP and marked against an oracle, not swapped through a DEX. Tell the user
  // the instant they click rather than failing downstream.
  if (!isPriceable(network, call.asset_symbol)) {
    return NextResponse.json({
      status: "no_feed",
      network,
      asset: call.asset_symbol,
      reason: `No FTSOv2 feed for $${call.asset_symbol} on ${net.label.toLowerCase()} — this call cannot be priced.`,
    });
  }

  // Resolve delegation + wallet from Privy, and mirror it onto our user row.
  const w = await resolveEmbeddedWallet(user.privyId);
  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE users SET wallet_address=COALESCE(?, wallet_address), delegated=? WHERE id=?").run(
    w.address,
    w.delegated ? 1 : 0,
    user.userId,
  );

  // Resolve the effective quick-trade amount (USDC): a per-creator override
  // wins over the user's global amount, which falls back to the default.
  const existing = db
    .prepare("SELECT id, cap_value FROM allocations WHERE user_id=? AND influencer_id=? AND active=1")
    .get(user.userId, call.influencer_id) as { id: number; cap_value: number } | undefined;
  const userRow = db.prepare("SELECT quick_trade_usd FROM users WHERE id=?").get(user.userId) as { quick_trade_usd: number | null } | undefined;
  const globalQuick = userRow?.quick_trade_usd ?? DEFAULT_QUICK_USD;
  const sizeUsd = existing?.cap_value ?? globalQuick;

  // Ensure a (per-creator) allocation row exists for the trade log / watcher.
  // Preserve any existing override amount; only seed a new one at the global size.
  db.prepare(
    `INSERT INTO allocations (user_id, influencer_id, mode, cap_type, cap_value, active, created_at)
     VALUES (?,?,?,?,?,1,?)
     ON CONFLICT(user_id, influencer_id)
     DO UPDATE SET mode=excluded.mode, active=1`
  ).run(user.userId, call.influencer_id, mode, "fixed_usd", globalQuick, now);
  const alloc = existing ?? (db
    .prepare("SELECT id FROM allocations WHERE user_id=? AND influencer_id=?")
    .get(user.userId, call.influencer_id) as { id: number });

  const balance = (db.prepare("SELECT balance_usd FROM users WHERE id=?").get(user.userId) as { balance_usd: number }).balance_usd ?? 0;

  const signal: CallSignal = {
    direction: call.direction === "short" ? "short" : "long",
    // No pool address on Flare: the position is FXRP-denominated and marked
    // against the FTSOv2 feed for this symbol.
    tokenAddress: null,
    tokenSymbol: call.asset_symbol,
  };
  const planned = planTrade(signal, { mode, capType: "fixed_usd", capValue: sizeUsd }, balance);
  if (!planned) {
    return NextResponse.json({ status: "skipped", reason: "allocation cap already deployed", mode });
  }

  // Not delegated → tell the client to run the one-tap signed flow instead.
  if (!w.delegated || !w.walletId) {
    return NextResponse.json({
      status: "needs_delegation",
      needsDelegation: true,
      mode,
      network,
      side: planned.side,
      asset: planned.tokenSymbol,
      reason: "Auto-trading is off. Enable it once for zero-click, or sign this trade.",
    });
  }

  const res = await executeCopyTrade({
    userId: user.userId,
    privyWalletId: w.walletId,
    walletAddress: w.address,
    delegated: true,
    network,
    allocationId: alloc.id,
    callId: call.id,
    creatorHandle: call.handle,
    mode,
    planned,
    sizeUsd, // the resolved quick-trade amount (USDC)
    entryPriceUsd: call.latest_price ?? undefined, // for converting the sell leg to WETH
  });

  return NextResponse.json({ ...res, mode, network, side: planned.side, asset: planned.tokenSymbol });
}
