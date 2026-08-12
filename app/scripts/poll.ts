import { runPipeline } from "./run-pipeline";
import { getDb } from "../lib/db";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Handles this poll loop keeps re-processing. Scraping fresh posts for a
// handle (via XActions, browser-driven) is a separate, human-run step —
// see the note below. Edit this list by hand as tracked influencers change.
const TRACKED: string[] = [
  "CryptoKaleo",
  "0xNonceSense",
  "formanite602",
  "MerlijnTrader",
  "Crypto__Haris",
];

const POLL_INTERVAL_MS = 90_000;

// Division of labor: this script does NOT scrape X/Twitter. Pulling new
// posts into the archive JSON and running scripts/import-archive.ts against
// it is a human-run browser step (XActions can't run headless/unattended in
// this environment). What this loop DOES do is re-run the classification +
// pricing pipeline over whatever's already been imported into the DB —
// scripts/run-pipeline.ts's SQL only selects posts with no row in `calls`
// yet, so re-running it here is cheap/idempotent and only produces new calls
// for posts a human has imported since the last pass.
async function pollOnce() {
  for (const handle of TRACKED) {
    try {
      const before = countCalls();
      await runPipeline(handle);
      const after = countCalls();
      console.log(`[poll] ${handle}: ${after - before} new call(s)`);
    } catch (err) {
      console.error(`[poll] ${handle} failed: ${(err as Error).message}`);
    }
  }
}

function countCalls(): number {
  const row = getDb().prepare("SELECT COUNT(*) as n FROM calls").get() as { n: number };
  return row.n;
}

async function main() {
  console.log(`[poll] starting, tracking ${TRACKED.length} handle(s) every ${POLL_INTERVAL_MS / 1000}s`);
  for (;;) {
    try {
      await pollOnce();
    } catch (err) {
      // Belt-and-suspenders: pollOnce already catches per-handle, but guard
      // the whole iteration so one bad iteration never kills the loop.
      console.error(`[poll] iteration failed: ${(err as Error).message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
