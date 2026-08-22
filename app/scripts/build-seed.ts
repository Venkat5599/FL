/**
 * Rebuilds seed/demo.db from the live local tape.db.
 *
 * This is how data actually reaches production. There is no hosted database
 * configured (`vercel env ls production` shows no TURSO_DATABASE_URL), so
 * lib/db.ts falls back to copying seed/demo.db into /tmp on each cold start,
 * and next.config.ts traces that file into every route's function bundle.
 * .vercelignore exists specifically to keep it uploadable despite .gitignore's
 * broad `*.db` rule.
 *
 * Consequence: the deployed site shows whatever was in seed/demo.db at deploy
 * time. Ingesting creators locally changes nothing in production until this
 * script runs and a deploy follows.
 *
 * WAL matters here. tape.db is opened with journal_mode=WAL, so recent writes
 * may live in tape.db-wal rather than the main file. Copying the file alone
 * would silently ship a database missing the newest rows — the failure would
 * look like "the ingest didn't work" rather than "the copy was incomplete".
 * So the source is checkpointed first, and the destination is VACUUMed to
 * compact free pages before it gets bundled into every serverless function.
 *
 * Usage: bunx tsx scripts/build-seed.ts
 */
import Database from "libsql";
import { copyFileSync, existsSync, rmSync, statSync } from "fs";
import path from "path";

const SRC = process.env.DB_PATH ?? "./tape.db";
const DEST = "seed/demo.db";

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function main() {
  if (!existsSync(SRC)) {
    console.error(`source database not found: ${SRC}`);
    process.exit(1);
  }

  // 1. Fold the WAL back into the main file so a plain copy is complete.
  const src = new Database(SRC);
  src.pragma("wal_checkpoint(TRUNCATE)");
  const counts = {
    influencers: (src.prepare("SELECT COUNT(*) c FROM influencers").get() as { c: number }).c,
    posts: (src.prepare("SELECT COUNT(*) c FROM posts").get() as { c: number }).c,
    calls: (src.prepare("SELECT COUNT(*) c FROM calls").get() as { c: number }).c,
    marks: (src.prepare("SELECT COUNT(*) c FROM marks").get() as { c: number }).c,
  };
  src.close();

  // 2. Copy, clearing any stale sidecars first so the destination cannot be
  //    read with a WAL that belongs to a previous build.
  for (const sidecar of [`${DEST}-wal`, `${DEST}-shm`]) {
    if (existsSync(sidecar)) rmSync(sidecar);
  }
  copyFileSync(SRC, DEST);

  // 3. Compact. The seed ships inside every route's function bundle, so pages
  //    freed by deletes (the demo purge freed a lot) are worth reclaiming.
  const dest = new Database(path.resolve(DEST));
  dest.pragma("journal_mode = DELETE"); // no WAL sidecars in the shipped artifact
  dest.exec("VACUUM");
  dest.close();
  for (const sidecar of [`${DEST}-wal`, `${DEST}-shm`]) {
    if (existsSync(sidecar)) rmSync(sidecar);
  }

  console.log(`seed rebuilt: ${DEST} (${mb(statSync(DEST).size)}, from ${mb(statSync(SRC).size)})`);
  console.log(
    `  influencers ${counts.influencers} · posts ${counts.posts} · calls ${counts.calls} · marks ${counts.marks}`
  );
  console.log("\nnext: vercel deploy --prod");
}

main();
