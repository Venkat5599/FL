import { getDb } from "../lib/db";
import { classify } from "../lib/classify";
import { priceNow } from "../lib/graph";
import { DEFAULT_EXPIRY } from "../lib/signal-schema";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Benchmark asset. Was WETH-on-Base, by pool address; on Flare the comparison that
// makes sense is the chain's own asset, and FTSOv2 is keyed by SYMBOL, never by address.
const BENCHMARK = "FLR";
// Publish threshold. The classifier is now deterministic rules rather than a model, so
// confidence is evidence-counting with a known scale (see lib/classify.ts) instead of a
// model-specific calibration that shifted between deployments. 0.7 admits an explicit
// directional call with a cashtag; anything vaguer stays AMBIGUOUS.
const CONF_THRESHOLD = Number(process.env.TAPE_CONF_THRESHOLD ?? "0.7");

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
    // Deterministic and local: no network, no rate limit, no per-call cost, and no
    // throttle needed. The previous implementation slept 2.5s between posts purely to
    // stay inside a hosted model's limits.
    const signal = classify(p.content);

    // Shape-compatible with the old model output so the rest of the pipeline is
    // untouched by the port.
    const s = {
      template: signal.template,
      asset_symbol: signal.assetSymbol,
      direction: signal.direction,
      expiry_days: signal.expiryDays,
      confidence: signal.confidence,
    };
    // The classifier often emits the cashtag form ("$PEPE") or extra whitespace; strip
    // to the bare symbol, which is what FTSOv2 keys its feeds on and what we display.
    const symbol = s.asset_symbol ? s.asset_symbol.replace(/^\$/, "").trim().toUpperCase() : null;
    const isSignal = s.template !== "NOT_A_SIGNAL" && s.confidence >= CONF_THRESHOLD && !!symbol;
    const template = isSignal ? s.template : "AMBIGUOUS";
    // `asset_address` stays null on Flare. It held an EVM token address only because the
    // pre-Flare version priced against Uniswap pools, which are keyed by address. FTSOv2
    // is keyed by SYMBOL and most assets a caller names have no Flare contract at all, so
    // storing an Ethereum mainnet address here would be a number that points at nothing
    // this chain can act on. The column is kept for the existing rows that carry one.
    const addr = null;
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
        // Priceability on Flare means "FTSOv2 carries a feed for this symbol", not
        // "we have a Base pool address for it". Opened as `open`; the marks written
        // below decide whether it stays that way or becomes `unpriceable`.
        isSignal ? "open" : "ambiguous"
      );

    // Every call gets an artifact row: the exact input text and the verdict produced
    // from it, so any reader can re-derive the classification themselves.
    db.prepare(
      `INSERT INTO artifacts (call_id,request_json,response_json,chat_id,tee_signature,provider_address,verified)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      r.lastInsertRowid,
      p.content,
      // The artifact is now the deterministic classifier's own output rather than a
      // hosted model's response envelope. It is fully reproducible: re-running the
      // classifier on the same text yields exactly this, which is the property that
      // made the local mirror safe in the first place.
      JSON.stringify(signal),
      // chat_id / tee_signature / provider_address described the 0G inference that
      // produced the verdict. On Flare the authoritative verdict is signed on-chain by a
      // registered TEE machine, so these are null here rather than filled with local
      // values that would imply an attestation that has not happened.
      null,
      null,
      null,
      0
    );

    if (isSignal && symbol) {
      try {
        // Two bugs lived here, and together they made every call unpriceable.
        //
        // First, these lookups passed `addr` — a 0x token address left over from pricing
        // Uniswap pools. FTSOv2 has no concept of a token address; its feeds are keyed by
        // symbol. Every lookup therefore missed, returned null, and the call below forced
        // the call to `unpriceable`. That is why 82 of 85 seeded calls carry no score.
        //
        // Second, they asked for a price AT `p.posted_at`. FTSO is a spot oracle with no
        // history, so any historical timestamp returns null by design. Marks have to be
        // recorded FORWARD, which is what CallTape does on-chain and what this now does
        // off-chain: the mark is taken now, and stored with the time it was actually
        // observed rather than backdated to the post.
        const now = Math.floor(Date.now() / 1000);
        const entry = await priceNow(symbol);
        const benchmark = await priceNow(BENCHMARK);

        const mk = db.prepare(
          "INSERT OR IGNORE INTO marks (call_id,kind,price_usd,source,marked_at) VALUES (?,?,?,?,?)"
        );
        if (entry) {
          // `marked_at: now`, never `p.posted_at`. Backdating an observation we made
          // today to the moment of the post would be inventing history, which is the one
          // thing this product exists not to do.
          mk.run(r.lastInsertRowid, "entry", entry.price, entry.source, now);
          mk.run(r.lastInsertRowid, "live", entry.price, entry.source, now);
        }
        if (benchmark) {
          mk.run(r.lastInsertRowid, "d1", benchmark.price, "flr_entry", now);
          mk.run(r.lastInsertRowid, "d7", benchmark.price, "flr_latest", now);
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
