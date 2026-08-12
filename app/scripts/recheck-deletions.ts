import { readFileSync } from "fs";
import { getDb } from "../lib/db";

// Full flow (per Task 11 brief): for every post with deleted_at IS NULL, do
// an XActions status check (batched, 3s delay) and flip deleted_at when the
// post 404s. XActions is browser/human-driven in this environment (no
// headless X session here), so that half can't run unattended. What CAN run
// unattended and be tested is the DB side: given a list of post ids a human
// determined are deleted (via XActions, browser step), stamp deleted_at on
// them. A human runs the XActions check separately, writes the resulting
// x_post_ids (one per line) to a file, and passes that file to this CLI.
export function markDeleted(xPostIds: string[]): number {
  if (xPostIds.length === 0) return 0;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(
    "UPDATE posts SET deleted_at=? WHERE x_post_id=? AND deleted_at IS NULL"
  );
  const run = db.transaction((ids: string[]) => {
    let changed = 0;
    for (const id of ids) changed += stmt.run(now, id).changes;
    return changed;
  });
  return run(xPostIds);
}

// Still-undeleted posts, for a human running the XActions check to know what
// to check against. Not otherwise used by the CLI path below, but exported
// for reuse/testing.
export function undeletedPostIds(): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT x_post_id FROM posts WHERE deleted_at IS NULL")
    .all() as { x_post_id: string }[];
  return rows.map((r) => r.x_post_id);
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: recheck-deletions.ts <deleted-ids-file>  (newline-delimited x_post_ids)");
    process.exit(1);
  }
  const ids = readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const n = markDeleted(ids);
  console.log(`marked ${n} post(s) deleted (of ${ids.length} id(s) in file)`);
}

if (require.main === module) main();
