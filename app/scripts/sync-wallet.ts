import { getDb } from "../lib/db";
import { swapsForWallet } from "../lib/graph";
import { findContradictions } from "../lib/said-did";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CallRow = { id: number; asset_address: string; direction: string; posted_at: number };
type EventRow = { id: number; token_address: string; side: string; occurred_at: number };
type InfluencerRow = { id: number; handle: string; wallet_address: string };

// contradictions has no UNIQUE constraint in lib/schema.sql (schema table
// definitions can't change safely mid-hackathon) — add it here as an index
// so re-running this script doesn't duplicate contradiction rows. Idempotent.
function ensureContradictionsIndex(db: ReturnType<typeof getDb>) {
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_contradictions_call_event ON contradictions(call_id, wallet_event_id)"
  );
}

// Sets influencers.wallet_address and records the human/legal attribution
// note behind it. Wallets are never seeded in code — a human enters them at
// the venue from public Lookonchain/kolscan attribution, via this CLI mode.
async function setWallet(handle: string, address: string, note: string) {
  const db = getDb();
  const influencer = db.prepare("SELECT id FROM influencers WHERE handle = ?").get(handle) as
    | { id: number }
    | undefined;
  if (!influencer) {
    console.log(`no influencer found for handle '${handle}'`);
    return;
  }
  db.prepare("UPDATE influencers SET wallet_address = ? WHERE id = ?").run(address, influencer.id);
  db.prepare(
    `INSERT INTO wallet_attributions (influencer_id, note) VALUES (?, ?)
     ON CONFLICT(influencer_id) DO UPDATE SET note = excluded.note`
  ).run(influencer.id, note);
  console.log(`wallet set for ${handle}: ${address} (attribution: ${note})`);
}

async function syncAll() {
  const db = getDb();
  ensureContradictionsIndex(db);

  const influencers = db
    .prepare("SELECT id, handle, wallet_address FROM influencers WHERE wallet_address IS NOT NULL")
    .all() as InfluencerRow[];

  const insertEvent = db.prepare(
    `INSERT OR IGNORE INTO wallet_events (influencer_id, tx_hash, token_address, side, usd_value, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertContradiction = db.prepare(
    "INSERT OR IGNORE INTO contradictions (call_id, wallet_event_id, gap_hours) VALUES (?, ?, ?)"
  );

  for (const influencer of influencers) {
    const calls = db
      .prepare(
        `SELECT c.id as id, c.asset_address as asset_address, c.direction as direction, p.posted_at as posted_at
         FROM calls c
         JOIN posts p ON p.id = c.post_id
         WHERE p.influencer_id = ? AND c.asset_address IS NOT NULL AND c.status IN ('open', 'settled')`
      )
      .all(influencer.id) as CallRow[];

    for (const call of calls) {
      try {
        const swaps = await swapsForWallet(influencer.wallet_address, call.posted_at, call.posted_at + 24 * 3600);
        for (const s of swaps) {
          insertEvent.run(influencer.id, s.tx_hash, s.token_address, s.side, s.usd_value, s.occurred_at);
        }
        console.log(`${influencer.handle} call ${call.id}: ${swaps.length} swaps fetched`);
      } catch (err) {
        console.log(`swapsForWallet failed for ${influencer.handle} call ${call.id}: ${(err as Error).message}`);
      } finally {
        await sleep(500); // throttle: Pinax 200 req/min is generous, but be polite
      }
    }

    const events = db
      .prepare(
        `SELECT id, token_address, side, occurred_at FROM wallet_events WHERE influencer_id = ?`
      )
      .all(influencer.id) as EventRow[];

    const matches = findContradictions(calls, events);
    for (const m of matches) {
      insertContradiction.run(m.callId, m.eventId, m.gapHours);
    }
    console.log(`${influencer.handle}: ${matches.length} contradiction(s) found across ${calls.length} call(s)`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--set-wallet") {
    const [, handle, address, ...noteParts] = args;
    if (!handle || !address) {
      console.error("usage: sync-wallet.ts --set-wallet <handle> <address> <attribution-note>");
      process.exit(1);
    }
    await setWallet(handle, address, noteParts.join(" "));
    return;
  }
  await syncAll();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
