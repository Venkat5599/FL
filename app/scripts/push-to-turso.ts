import Database from "libsql";
import { getDb } from "../lib/db";

// One-time: copy the local SQLite database into hosted Turso, so the deployed
// app and the live indexer start from your existing data (245 calls, dossiers,
// etc.) and then append live tweets to the same shared DB.
//
// Prereqs (set in .env or the shell): TURSO_DATABASE_URL, TURSO_AUTH_TOKEN.
// Optional: SOURCE_DB (defaults to ./kollateral.db).
//
// Run: node --env-file=.env --import tsx scripts/push-to-turso.ts
async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) first.");
    process.exit(1);
  }

  // getDb() connects to Turso (env is set) and runs schema.sql + every
  // migration there, so the destination schema matches exactly.
  const dst = getDb();
  const src = new Database(process.env.SOURCE_DB ?? "./kollateral.db");

  const tables = (
    src.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
  ).map((r) => r.name);

  // Columns that actually exist on the destination, per table (so we never
  // insert a column Turso's schema doesn't have).
  const dstCols = (t: string) =>
    new Set((dst.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));

  for (const t of tables) {
    const rows = src.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
    if (!rows.length) {
      console.log(`${t}: 0 rows`);
      continue;
    }
    const cols = Object.keys(rows[0]).filter((c) => dstCols(t).has(c));
    if (!cols.length) {
      console.log(`${t}: no matching columns on destination, skipped`);
      continue;
    }
    const ins = dst.prepare(
      `INSERT OR REPLACE INTO ${t} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    );
    let ok = 0;
    for (const row of rows) {
      try {
        ins.run(...cols.map((c) => row[c] as never));
        ok++;
      } catch (e) {
        console.error(`  ${t} row failed: ${(e as Error).message?.slice(0, 100)}`);
      }
    }
    console.log(`${t}: ${ok}/${rows.length} rows`);
  }

  console.log("done. Point the app at Turso (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN) and it's live.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
