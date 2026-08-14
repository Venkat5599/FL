import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyUser } from "@/lib/privy";

interface TradeRow {
  creator_handle: string;
  mode: "copy" | "fade";
  token_symbol: string | null;
  token_address: string | null;
  side: string | null;
  amount_usd: number | null;
  entry_price_usd: number | null;
  tx_hash: string | null;
  status: string | null;
  yield_usd: number | null;
  network: string | null;
  in_amount: number | null;
  in_symbol: string | null;
  out_amount: number | null;
  out_symbol: string | null;
  reason: string | null;
  created_at: number | null;
}

const isExecuted = (t: TradeRow) => t.status === "executed" || t.status === "sent" || !!t.tx_hash;

// The FXRP that actually moved on an executed trade: a buy spends FXRP (input),
// a sell receives FXRP (output). Failed trades moved nothing.
function usdcLeg(t: TradeRow): number {
  if (!isExecuted(t)) return 0;
  if (t.in_symbol === "FXRP" && t.in_amount != null) return t.in_amount;
  if (t.out_symbol === "FXRP" && t.out_amount != null) return t.out_amount;
  return 0;
}

// GET → the signed-in user's copy/fade trade history + rich analytics. All
// capital figures count EXECUTED trades only and use the real on-chain amounts.
export async function GET(req: Request) {
  const user = await verifyUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const trades = db
    .prepare(
      `SELECT creator_handle, mode, token_symbol, token_address, side,
              amount_usd, entry_price_usd, tx_hash, status, yield_usd, network,
              in_amount, in_symbol, out_amount, out_symbol, reason, created_at
       FROM copy_trades WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(user.userId) as TradeRow[];

  const n = trades.length;
  const executedTrades = trades.filter(isExecuted);
  const executed = executedTrades.length;
  const failed = trades.filter((t) => t.status === "failed").length;
  const pending = trades.filter((t) => t.status === "pending").length;
  const copies = trades.filter((t) => t.mode === "copy").length;
  const fades = trades.filter((t) => t.mode === "fade").length;
  // Real FXRP deployed across executed trades only (not the nominal cap).
  const deployedUsdc = executedTrades.reduce((s, t) => s + usdcLeg(t), 0);
  const totalPnlUsd = executedTrades.reduce((s, t) => s + (t.yield_usd ?? 0), 0);

  // "Settled" = a real, non-zero realized P&L was recorded (there is no
  // settlement/pricing job yet, so treat 0 as still-open, not a $0 result).
  const settled = executedTrades.filter((t) => t.yield_usd != null && t.yield_usd !== 0);
  const wins = settled.filter((t) => (t.yield_usd ?? 0) > 0).length;
  const losses = settled.filter((t) => (t.yield_usd ?? 0) < 0).length;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : null;
  const yields = settled.map((t) => t.yield_usd ?? 0);
  const bestUsd = yields.length ? Math.max(...yields) : null;
  const worstUsd = yields.length ? Math.min(...yields) : null;

  // Per-creator breakdown: executed trades, real FXRP deployed, net P&L.
  const byCreatorMap = new Map<string, { handle: string; trades: number; executed: number; pnlUsd: number; deployedUsdc: number; copies: number; fades: number }>();
  for (const t of trades) {
    const e = byCreatorMap.get(t.creator_handle) ?? { handle: t.creator_handle, trades: 0, executed: 0, pnlUsd: 0, deployedUsdc: 0, copies: 0, fades: 0 };
    e.trades++;
    if (isExecuted(t)) {
      e.executed++;
      e.pnlUsd += t.yield_usd ?? 0;
      e.deployedUsdc += usdcLeg(t);
    }
    if (t.mode === "fade") e.fades++;
    else e.copies++;
    byCreatorMap.set(t.creator_handle, e);
  }
  const byCreator = [...byCreatorMap.values()]
    .map((c) => ({ ...c, pnlUsd: round(c.pnlUsd), deployedUsdc: round(c.deployedUsdc) }))
    .sort((a, b) => b.deployedUsdc - a.deployedUsdc || b.executed - a.executed);

  return NextResponse.json({
    summary: {
      totalTrades: n,
      executed,
      failed,
      pending,
      copies,
      fades,
      deployedUsdc: round(deployedUsdc),
      totalPnlUsd: round(totalPnlUsd),
      winRate,
      wins,
      losses,
      settledCount: settled.length,
      bestUsd: bestUsd == null ? null : round(bestUsd),
      worstUsd: worstUsd == null ? null : round(worstUsd),
    },
    byCreator,
    trades,
  });
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}
