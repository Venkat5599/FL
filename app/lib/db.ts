// libsql is a drop-in, better-sqlite3-compatible driver, so every caller's
// synchronous `.prepare().get()/.all()/.run()` code is unchanged. It connects
// to a local SQLite file in dev, or to hosted Turso when TURSO_DATABASE_URL is
// set. Turso is what closes the loop: the deployed app and the local live
// indexer read/write one shared, persistent database.
import Database from "libsql";
import { readFileSync, existsSync, copyFileSync } from "fs";
import path from "path";

// Local-file fallback (no Turso configured). In dev this is ./tape.db;
// on Vercel without Turso it's a per-instance /tmp copy of the committed seed
// (serverless FS is read-only except /tmp).
function localDbPath(): string {
  const envPath = process.env.DB_PATH;

  if (process.env.VERCEL && !(envPath && envPath.startsWith("/tmp"))) {
    const runtimePath = "/tmp/tape.db";
    if (!existsSync(runtimePath)) {
      const seedPath = envPath ?? path.join(process.cwd(), "seed/demo.db");
      copyFileSync(seedPath, runtimePath);
    }
    return runtimePath;
  }

  return envPath ?? "./tape.db";
}

let db: InstanceType<typeof Database> | null = null;
export function getDb() {
  if (!db) {
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    if (tursoUrl) {
      // libsql's typed Options omits authToken although the driver supports it.
      const opts = { authToken: process.env.TURSO_AUTH_TOKEN } as unknown as ConstructorParameters<typeof Database>[1];
      db = new Database(tursoUrl, opts);
    } else {
      db = new Database(localDbPath());
      // WAL is a local-file pragma; Turso manages journaling itself.
      try {
        db.pragma("journal_mode = WAL");
      } catch {
        /* not applicable */
      }
    }
    db.exec(readFileSync(path.join(process.cwd(), "lib/schema.sql"), "utf8"));
    // Task 9 (Said-vs-Did): small side table for the human/legal attribution
    // note behind a linked wallet. Kept out of schema.sql per the hackathon
    // rule against touching existing table definitions mid-event; created
    // here (idempotent) so every getDb() caller — app and scripts/sync-wallet.ts
    // alike — can rely on it existing, even before any wallet has been set.
    db.exec(
      "CREATE TABLE IF NOT EXISTS wallet_attributions (influencer_id INTEGER PRIMARY KEY, note TEXT)"
    );
    // 0-yap mode cache: the distilled pure signal per call, so the
    // distillation runs once and is reused (idempotent side table).
    db.exec(
      "CREATE TABLE IF NOT EXISTS yap_signals (call_id INTEGER PRIMARY KEY REFERENCES calls(id), bias TEXT, thesis TEXT, levels_json TEXT, tee_verified INTEGER, created_at INTEGER)"
    );
    // Extra copy_trades columns for an honest portfolio: which chain it ran on
    // (for the explorer link), the REAL amounts swapped (input token in/out,
    // not the nominal allocation cap), and the failure reason. Added
    // idempotently — SQLite throws if a column already exists (harmless).
    for (const col of [
      "network TEXT DEFAULT 'testnet'",
      "in_amount REAL",
      "in_symbol TEXT",
      "out_amount REAL",
      "out_symbol TEXT",
      "reason TEXT",
    ]) {
      try {
        db.exec(`ALTER TABLE copy_trades ADD COLUMN ${col}`);
      } catch {
        /* column already present */
      }
    }
    // Global "quick trade amount" (USDC) per user — the default size each
    // one-click copy/fade deploys, overridable per creator via allocations.
    try {
      db.exec("ALTER TABLE users ADD COLUMN quick_trade_usd REAL DEFAULT 1");
    } catch {
      /* column already present */
    }
  }
  return db;
}
