import { writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { scrapeTweets } from "./scrape-x";
import { importArchive } from "./import-archive";
import { runPipeline } from "./run-pipeline";
import { getDb } from "../lib/db";

// Live indexer: fetch new tweets for the tracked handles on an interval, import
// only the new ones, and run the classify + price pipeline over them. This is
// the piece poll.ts leaves out (poll.ts only re-classifies already-imported
// posts). Run it locally alongside `npm run dev` so the terminal shows fresh
// calls within a poll cycle.
//
// Run: node --env-file=.env --import tsx scripts/live-index.ts
// Config (env): LIVE_HANDLES=a,b,c  LIVE_INTERVAL_MS=150000  LIVE_LIMIT=20
//
// Keep the interval gentle (a couple minutes) and the handle list small so X
// does not rate-limit the burner auth_token.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TRACKED: string[] = (process.env.LIVE_HANDLES?.split(",").map((s) => s.trim()).filter(Boolean)) ?? [
  "CryptoTony__",
  "MerlijnTrader",
  "0xNonceSense",
];
const INTERVAL_MS = Number(process.env.LIVE_INTERVAL_MS ?? 150_000);
const LIMIT = Number(process.env.LIVE_LIMIT ?? 20);

function countCalls(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM calls").get() as { n: number }).n;
}

async function indexOne(handle: string) {
  const tweets = await scrapeTweets(handle, LIMIT);
  const tmp = path.join(tmpdir(), `kollateral-live-${handle}-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(tweets));
  const imp = importArchive(handle, tmp); // idempotent: INSERT OR IGNORE on tweet id
  const before = countCalls();
  await runPipeline(handle); // classifies + prices only posts with no call row yet
  const after = countCalls();
  console.log(
    `[live] @${handle}: fetched ${tweets.length}, imported ${imp.inserted} new, +${after - before} call(s)`,
  );
}

async function tick() {
  for (const handle of TRACKED) {
    try {
      await indexOne(handle);
    } catch (err) {
      console.error(`[live] @${handle} failed: ${(err as Error).message}`);
    }
  }
}

async function main() {
  console.log(`[live] indexing ${TRACKED.length} handle(s) every ${INTERVAL_MS / 1000}s: ${TRACKED.join(", ")}`);
  for (;;) {
    await tick().catch((err) => console.error(`[live] iteration failed: ${(err as Error).message}`));
    await sleep(INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
