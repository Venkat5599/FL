/**
 * Ingests REAL posts from REAL crypto callers on X, and classifies them.
 *
 * This is the honest counterpart to `seed-demo-creators.ts`. Nothing here is
 * invented: every post is fetched from X, stored with the text and timestamp X
 * returned, and turned into a call by the same deterministic classifier the TEE
 * runs (`lib/classify.ts`). The handles are public figures who publish publicly.
 *
 * WHAT THIS DOES NOT DO — and why that matters.
 *
 * It does not backfill entry prices. FTSOv2 is a spot oracle with no history, so
 * there is no honest way to reconstruct what an asset was worth when a post went
 * out months ago. TAPE's design records marks FORWARD (see the comment at the top
 * of lib/ftso.ts), which means a freshly-ingested historical call has a verdict
 * about what it *meant* but no P&L yet. That is the correct, if less impressive,
 * answer. Fabricating an entry price for a named real person would manufacture
 * exactly the kind of unfalsifiable track record this product exists to expose.
 *
 * Pipeline per handle:
 *   twitter-cli user-posts  →  importArchive()  →  runPipeline()
 *                (real)          (posts table)     (deterministic classify → calls)
 *
 * REQUIREMENTS
 *   - twitter-cli v0.8.5+ on PATH, authenticated (`twitter user-posts x -n 1`)
 *   - No X API bearer token needed. This path does not touch api.x.com, so it is
 *     unaffected by the credit balance on the developer account.
 *
 * USAGE
 *   bunx tsx scripts/ingest-real-creators.ts                  # all handles, 30 posts each
 *   bunx tsx scripts/ingest-real-creators.ts 50               # 50 posts each
 *   bunx tsx scripts/ingest-real-creators.ts 30 --limit 20    # first 20 handles only
 *   bunx tsx scripts/ingest-real-creators.ts 30 --only a,b,c  # specific handles
 *   bunx tsx scripts/ingest-real-creators.ts 30 --refresh     # re-fetch handles already ingested
 *   bunx tsx scripts/ingest-real-creators.ts --purge-demo     # drop all demo_* rows, then exit
 *
 * Resumable by default: a handle that already has posts is skipped unless
 * --refresh is passed. Post inserts are INSERT OR IGNORE on a unique x_post_id,
 * so re-running only ever adds genuinely new posts.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { getDb } from "../lib/db";
import { importArchive } from "./import-archive";
import { runPipeline } from "./run-pipeline";

/**
 * Public crypto callers on X. All accounts that post market calls publicly.
 *
 * This list is the one editorial decision in the file: who counts as a "caller"
 * worth keeping a tape on. Everything downstream is mechanical.
 */
const HANDLES = [
  // majors / macro
  "CryptoCapo_", "CryptoTony__", "CryptoMichNL", "LarkDavis", "blknoiz06",
  "AltcoinGordon", "CryptoKaleo", "IncomeSharks", "CryptoCred", "PeterLBrandt",
  "rektcapital", "CryptoDonAlt", "TheCryptoLark", "CryptoGodJohn", "MacroScope17",
  "CryptoWendyO", "TheCryptoDog", "cryptomanran", "davthewave", "TheMoonCarl",
  // trading desks / TA
  "CryptoBullet1", "CryptoNTez", "ColdBloodShill", "CryptoAnglio", "SmartContracter",
  "CryptoISO", "TraderMagus", "CryptoTaeng", "CryptoNekoZ", "TraderKoz",
  "CryptoShadowOff", "AltcoinSherpa", "CryptoJelleNL", "MoonOverlord", "Pentosh1",
  "CredibleCrypto", "TraderSZ", "CryptoGainz1", "ChartsBTC", "TraderXO",
  // on-chain / research
  "0xQuit", "cygaar_dev", "MustStopMurad", "ZssBecker", "notthreadguy",
  "0xSisyphus", "hasufl", "adamscochran", "RyanSAdams", "TrustlessState",
  "sassal0x", "iamDCinvestor", "DegenSpartan", "cobie", "loomdart",
  "GiganticRebirth", "AlgodTrading", "DonAlt", "HsakaTrades", "CryptoKing",
  // altcoin / narrative
  "Ashcryptoreal", "CryptoBusy", "MilkRoadDaily", "TheCryptoBasic", "WatcherGuru",
  "CryptoTank1", "CryptoRover", "CryptoTea_", "CryptoElite_", "AltcoinDailyio",
  "CryptoWizardd", "ItsAllRisky", "CryptoYoddha", "MartyParty", "CryptoAmsterdam",
  "TheCryptoLeak", "CryptoZeus100x", "cryptoshinken", "CryptoNobler", "Trader_XO",
  // defi / infra
  "0xfoobar", "bantg", "DefiIgnas", "TheDeFiEdge", "Route2FI",
  "0xngmi", "DefiLlama", "korpi87", "thedefiedge", "0xJeff",
  "Arthur_0x", "santiagoroel", "zhusu", "KyleLDavies", "CryptoHayes",
  // xrp / flare adjacent
  "XRPcryptowolf", "digitalassetbuy", "JackTheRippler", "XRPNewsToday", "Ripple_Insider",
  "FlareNetworks", "hugoflare", "XRPLLabs", "WrathofKahneman", "SentosumosaBank",
  // longer tail
  "CryptoMichNL2", "TheFlowHorse", "CanteringClark", "ByzGeneral", "Bluntz_Capital",
  "CryptoCharles__", "salsatekila", "CryptoTony_", "Crypto_Chase", "TraderMercury",
  "gainzy222", "MacroCRG", "CryptoKaduna", "im_manert", "eliz883",
];

/**
 * Pacing. X rate-limits this session hard: at 1.2s between handles roughly a
 * third of requests came back 429, and twitter-cli's own three internal retries
 * were not enough to ride it out. The limit is per-window, so the fix is to go
 * slower between handles and to back off for a long time when one is actually
 * hit rather than burning through the remaining handles into a closed window.
 */
const SLEEP_MS = 5_000;
/** How long to wait after a 429 before retrying the same handle. */
const RATE_LIMIT_BACKOFF_MS = 90_000;
/** How many times to retry one handle through rate limiting before moving on. */
const RATE_LIMIT_RETRIES = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Raised when twitter-cli reports `ok:false` with a rate_limited code. */
class RateLimited extends Error {
  constructor() {
    super("rate limited by X");
    this.name = "RateLimited";
  }
}

interface Outcome {
  handle: string;
  fetched: number;
  imported: number;
  skipped: number;
  malformed: number;
  error?: string;
}

/**
 * Pull a user's recent posts via twitter-cli.
 *
 * `--json` writes the same envelope the CLI prints as YAML: `{ ok, data: [...] }`.
 * importArchive's extractRows already understands `.data`, and its field
 * normalisation already covers twitter-cli's `id` / `text` / `createdAt`, so no
 * shape translation is needed here.
 */
function fetchPosts(handle: string, count: number, dir: string): { file: string; n: number } {
  const raw = execFileSync("twitter", ["user-posts", handle, "-n", String(count), "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // twitter-cli emits a ClientTransaction warning on stderr that is not fatal.
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });

  // Defensive: strip anything before the JSON envelope in case a warning leaks
  // into stdout on some versions.
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("no JSON in twitter-cli output");
  const parsed = JSON.parse(raw.slice(start));

  if (parsed?.ok === false) {
    // The error field is an object ({code, message}), not a string — stringifying
    // it naively yields "[object Object]" and hides the one code worth branching on.
    const err = parsed?.error;
    const code = typeof err === "object" ? err?.code : undefined;
    if (code === "rate_limited") throw new RateLimited();
    const msg = typeof err === "object" ? (err?.message ?? code ?? "unknown") : String(err ?? "unknown");
    throw new Error(msg);
  }
  const rows = parsed?.data ?? [];
  if (!Array.isArray(rows)) throw new Error("unexpected twitter-cli payload shape");

  // Drop retweets: a retweet is somebody else's call, and attributing it to this
  // account would be exactly the misattribution the product is against.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw CLI payload
  const own = rows.filter((r: any) => !r?.isRetweet);

  const file = path.join(dir, `${handle}.json`);
  writeFileSync(file, JSON.stringify({ data: own }), "utf8");
  return { file, n: own.length };
}

function purgeDemo() {
  const db = getDb();
  const like = "demo\\_%";
  const before = db.prepare("SELECT COUNT(*) c FROM influencers").get() as { c: number };

  // Four tables reference calls (artifacts, marks, contradictions, copy_trades)
  // and four reference influencers (posts, wallet_events, allocations,
  // wallet_attributions). Deleting out of order trips SQLITE_CONSTRAINT_FOREIGNKEY,
  // so children go first, then calls, then posts, then influencers.
  const callChildren = ["artifacts", "marks", "contradictions", "copy_trades"];
  const influencerChildren = ["wallet_events", "allocations", "wallet_attributions"];

  db.exec("BEGIN");
  for (const t of callChildren) {
    db.prepare(
      `DELETE FROM ${t} WHERE call_id IN (
         SELECT c.id FROM calls c JOIN posts p ON p.id=c.post_id
         JOIN influencers i ON i.id=p.influencer_id WHERE i.handle LIKE ? ESCAPE '\\')`
    ).run(like);
  }
  db.prepare(
    `DELETE FROM calls WHERE post_id IN (
       SELECT p.id FROM posts p JOIN influencers i ON i.id=p.influencer_id
       WHERE i.handle LIKE ? ESCAPE '\\')`
  ).run(like);
  db.prepare(
    `DELETE FROM posts WHERE influencer_id IN (
       SELECT id FROM influencers WHERE handle LIKE ? ESCAPE '\\')`
  ).run(like);
  for (const t of influencerChildren) {
    db.prepare(
      `DELETE FROM ${t} WHERE influencer_id IN (
         SELECT id FROM influencers WHERE handle LIKE ? ESCAPE '\\')`
    ).run(like);
  }
  db.prepare(`DELETE FROM influencers WHERE handle LIKE ? ESCAPE '\\'`).run(like);
  db.exec("COMMIT");
  const after = db.prepare("SELECT COUNT(*) c FROM influencers").get() as { c: number };
  console.log(`purged demo creators: ${before.c} → ${after.c} influencers`);
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--purge-demo")) {
    purgeDemo();
    return;
  }

  const perHandle = Number(argv.find((a) => /^\d+$/.test(a)) ?? 30);
  const refresh = argv.includes("--refresh");

  const onlyIdx = argv.indexOf("--only");
  const limitIdx = argv.indexOf("--limit");
  let handles = onlyIdx >= 0 ? argv[onlyIdx + 1].split(",").map((s) => s.trim()) : [...HANDLES];
  if (limitIdx >= 0) handles = handles.slice(0, Number(argv[limitIdx + 1]));

  const db = getDb();
  const hasPosts = db.prepare(
    `SELECT COUNT(*) c FROM posts p JOIN influencers i ON i.id=p.influencer_id WHERE i.handle=?`
  );

  const dir = mkdtempSync(path.join(tmpdir(), "tape-ingest-"));
  const outcomes: Outcome[] = [];

  console.log(`ingesting ${handles.length} handles, ${perHandle} posts each\n`);

  try {
    for (const [i, handle] of handles.entries()) {
      const prefix = `[${String(i + 1).padStart(3)}/${handles.length}] @${handle}`;

      if (!refresh) {
        const existing = hasPosts.get(handle) as { c: number };
        if (existing.c > 0) {
          console.log(`${prefix} — skip (${existing.c} posts already)`);
          continue;
        }
      }

      // Retry loop exists only for rate limiting. Any other failure (suspended
      // account, renamed handle, private) is permanent and retrying just burns
      // quota that a later handle needs.
      for (let attempt = 0; ; attempt++) {
        try {
          const { file, n } = fetchPosts(handle, perHandle, dir);
          const r = importArchive(handle, file);
          await runPipeline(handle);
          outcomes.push({ handle, fetched: n, imported: r.inserted, skipped: r.skipped, malformed: r.malformed });
          console.log(`${prefix} — ${n} fetched, ${r.inserted} new, ${r.skipped} dup, ${r.malformed} malformed`);
          break;
        } catch (e) {
          const limited = e instanceof RateLimited;
          if (limited && attempt < RATE_LIMIT_RETRIES) {
            console.log(
              `${prefix} — rate limited, waiting ${RATE_LIMIT_BACKOFF_MS / 1000}s (attempt ${attempt + 1}/${RATE_LIMIT_RETRIES})`
            );
            await sleep(RATE_LIMIT_BACKOFF_MS);
            continue;
          }
          const msg = limited ? "rate limited (gave up)" : e instanceof Error ? e.message.split("\n")[0] : String(e);
          outcomes.push({ handle, fetched: 0, imported: 0, skipped: 0, malformed: 0, error: msg });
          console.log(`${prefix} — FAILED: ${msg}`);
          break;
        }
      }

      // Be a polite client. twitter-cli rides a session cookie, and hammering it
      // is the fastest way to get that session rate-limited.
      await sleep(SLEEP_MS);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const ok = outcomes.filter((o) => !o.error);
  const failed = outcomes.filter((o) => o.error);
  const imported = ok.reduce((a, o) => a + o.imported, 0);

  console.log(
    `\ndone — ${ok.length} handles ingested, ${imported} new posts, ${failed.length} failed`
  );
  if (failed.length) {
    console.log("failures:");
    for (const f of failed) console.log(`  @${f.handle}: ${f.error}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
