import { getDb } from "../lib/db";
import { classifyPost } from "../lib/zg";
import { priceAt } from "../lib/graph";
import { DEFAULT_EXPIRY } from "../lib/signal-schema";
import { TOKENS } from "../lib/tokens"; // symbol->address map seeded for the demo set

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
// Publish threshold is env-tunable because model confidence calibration varies:
// the mainnet DeepSeek model reaches 0.9+, the smaller testnet model caps ~0.8.
const CONF_THRESHOLD = Number(process.env.ZG_CONF_THRESHOLD ?? "0.85");

export async function runPipeline(handle: string) {
  const db = getDb();
  const posts = db
    .prepare(
      `SELECT p.* FROM posts p JOIN influencers i ON i.id=p.influencer_id
       WHERE i.handle=? AND p.id NOT IN (SELECT post_id FROM calls)`
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw sqlite rows, shape matches lib/schema.sql posts table
    .all(handle) as any[];

  for (const p of posts) {
    let c;
    try {
      c = await classifyPost(p.content, p.posted_at);
    } catch (err) {
      // One post's classification failure (0G rate limit, balance, network)
      // must not abort the batch; skip it (no call row → retried next run).
      console.log(`classify failed for post ${p.x_post_id}: ${(err as Error).message}`);
      await sleep(2500);
      continue;
    }
    await sleep(2500); // throttle 0G classification calls

    if (!c.signal) continue;
    const s = c.signal;
    // Models often emit the cashtag form ("$PEPE") or extra whitespace; strip to
    // the bare symbol for both the TOKENS lookup and what we store/display.
    const symbol = s.asset_symbol ? s.asset_symbol.replace(/^\$/, "").trim().toUpperCase() : null;
    const isSignal = s.template !== "NOT_A_SIGNAL" && s.confidence >= CONF_THRESHOLD && !!symbol;
    const template = isSignal ? s.template : "AMBIGUOUS";
    const addr = symbol ? TOKENS[symbol] ?? null : null;
    const expiry = p.posted_at + (s.expiry_days ?? DEFAULT_EXPIRY[s.template] ?? 30) * 86400;
    const now = Math.floor(Date.now() / 1000);

    const r = db
      .prepare(
        `INSERT INTO calls (post_id,template,asset_symbol,asset_address,direction,expiry_at,confidence,status)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        p.id,
        template,
        symbol,
        addr,
        s.direction ?? "long",
        expiry,
        s.confidence,
        isSignal ? (addr ? (expiry <= now ? "settled" : "open") : "unpriceable") : "ambiguous"
      );

    // The 0G router performs on-chain TEE signature verification at inference
    // time (we request it with verify_tee:true) and returns the result in
    // x_0g_trace.tee_verified. Store it directly — an honest 0/1. TeeTLS models
    // return null (transport-attested, nothing to verify) and stay 0.
    db.prepare(
      `INSERT INTO artifacts (call_id,request_json,response_json,chat_id,tee_signature,provider_address,verified)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      r.lastInsertRowid,
      p.content,
      JSON.stringify(c.raw ?? {}),
      c.chatId,
      c.teeSignature,
      c.providerAddress,
      c.teeVerified ? 1 : 0
    );

    if (isSignal && addr) {
      try {
        const entry = await priceAt(addr, p.posted_at);
        const latest = await priceAt(addr, Math.floor(Date.now() / 1000) - 3600);
        const ethE = await priceAt(WETH, p.posted_at);
        const ethL = await priceAt(WETH, Math.floor(Date.now() / 1000) - 3600);

        const mk = db.prepare(
          "INSERT OR IGNORE INTO marks (call_id,kind,price_usd,source,marked_at) VALUES (?,?,?,?,?)"
        );
        if (entry) mk.run(r.lastInsertRowid, "entry", entry.price, entry.source, p.posted_at);
        if (latest) mk.run(r.lastInsertRowid, "live", latest.price, latest.source, (Date.now() / 1000) | 0);
        // ETH benchmark stored under d1/d7 kinds, disambiguated by source — Task 7 reads by source
        if (ethE && ethL) {
          mk.run(r.lastInsertRowid, "d1", ethE.price, "eth_entry", p.posted_at);
          mk.run(r.lastInsertRowid, "d7", ethL.price, "eth_latest", (Date.now() / 1000) | 0);
        }
        if (!entry) db.prepare("UPDATE calls SET status='unpriceable' WHERE id=?").run(r.lastInsertRowid);
      } catch (err) {
        console.log(`pricing failed for call ${r.lastInsertRowid}: ${(err as Error).message}`);
        db.prepare("UPDATE calls SET status='unpriceable' WHERE id=?").run(r.lastInsertRowid);
        continue;
      }
    }

    console.log(`${p.x_post_id}: ${template} ${s.asset_symbol ?? ""} conf=${s.confidence}`);
  }
}

// CLI shim: `tsx scripts/run-pipeline.ts [handle]` runs the pipeline once for
// a single handle. scripts/poll.ts imports runPipeline directly to loop it
// over multiple tracked handles instead of shelling out to this file.
function main() {
  runPipeline(process.argv[2] ?? "CryptoKaleo").catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

if (require.main === module) main();
