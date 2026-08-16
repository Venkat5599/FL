import { getDb } from "../lib/db";
import { planTrade, type Allocation, type CallSignal } from "../lib/copytrade";
import { executeCopyTrade } from "../lib/execute";

// Copy/fade automation watcher. For every active allocation, finds the creator's
// signal calls the user hasn't traded yet, plans each trade (copy/fade + cap),
// and executes it. Idempotent: a call already traded for an allocation is
// skipped (one entry per call per allocation). Run once, or loop via `--loop`.
export async function runOnce(): Promise<number> {
  const db = getDb();
  const allocs = db
    .prepare(
      `SELECT a.id AS allocation_id, a.mode, a.cap_type AS capType, a.cap_value AS capValue,
              u.id AS user_id, u.wallet_address, u.delegated, u.balance_usd,
              i.id AS influencer_id, i.handle
       FROM allocations a
       JOIN users u ON u.id = a.user_id
       JOIN influencers i ON i.id = a.influencer_id
       WHERE a.active = 1`
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose joined rows
    .all() as any[];

  let fired = 0;
  for (const a of allocs) {
    // Signal calls from this creator the user hasn't copy-traded yet.
    const calls = db
      .prepare(
        `SELECT c.id, c.asset_address, c.asset_symbol, c.direction
         FROM calls c JOIN posts p ON p.id = c.post_id
         WHERE p.influencer_id = ?
           AND c.asset_address IS NOT NULL AND c.direction IS NOT NULL
           AND c.status IN ('open','settled')
           AND c.id NOT IN (SELECT call_id FROM copy_trades WHERE allocation_id = ? AND call_id IS NOT NULL)`
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose call rows
      .all(a.influencer_id, a.allocation_id) as any[];

    if (!calls.length) continue;

    // Already-deployed budget for this creator (open trades).
    const deployed = (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount_usd),0) AS s FROM copy_trades
           WHERE allocation_id = ? AND status IN ('pending','executed')`
        )
        .get(a.allocation_id) as { s: number }
    ).s;

    const alloc: Allocation = { mode: a.mode, capType: a.capType, capValue: a.capValue };
    let runningDeployed = deployed;

    for (const c of calls) {
      const signal: CallSignal = {
        direction: c.direction,
        tokenAddress: c.asset_address,
        tokenSymbol: c.asset_symbol ?? "?",
      };
      const planned = planTrade(signal, alloc, a.balance_usd ?? 0, runningDeployed);
      if (!planned) continue; // cap reached

      // Advisory only, since delegated server-side signing is gone: this records an
      // oracle-marked position the user can act on, it does not move their funds. Only
      // the user's own wallet can do that, from the browser.
      const res = await executeCopyTrade({
        userId: a.user_id,
        walletAddress: a.wallet_address,
        allocationId: a.allocation_id,
        callId: c.id,
        creatorHandle: a.handle,
        mode: a.mode,
        planned,
      });
      runningDeployed += planned.amountUsd;
      fired++;
      console.log(`${a.handle} #${c.id} ${a.mode} ${planned.side} ${planned.tokenSymbol} $${planned.amountUsd} → ${res.status}${res.reason ? " (" + res.reason + ")" : ""}`);
    }
  }
  return fired;
}

async function main() {
  const loop = process.argv.includes("--loop");
  if (!loop) {
    const n = await runOnce();
    console.log(`watcher: ${n} trade(s) processed`);
    return;
  }
  for (;;) {
    try {
      await runOnce();
    } catch (e) {
      console.log("watcher iteration error:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

if (require.main === module) main();
