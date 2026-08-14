import { createHash } from "crypto";
import { readFileSync } from "fs";
import { getDb } from "../lib/db";

// XActions and other X scrapers export tweets under varying field names
// (id_str vs id vs tweet_id, full_text vs text vs content, etc.), and may wrap
// the array in {tweets:[...]}, {data:[...]}, or {results:[...]}. Normalizing
// here means ingestion works against whatever shape the real export uses
// without editing this file per-tool.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-shaped scraper JSON
function firstString(r: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = r?.[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

// Accepts ISO strings, unix seconds, or unix milliseconds → unix seconds.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-shaped scraper JSON
function parseCreatedAt(r: any): number | null {
  const raw = r?.created_at ?? r?.createdAt ?? r?.date ?? r?.time ?? r?.timestamp;
  if (raw == null) return null;
  if (typeof raw === "number") {
    // Heuristic: >1e12 is already milliseconds, otherwise seconds.
    const ms = raw > 1e12 ? raw : raw * 1000;
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-shaped scraper JSON
function normalizeRow(r: any, handle: string): { id: string; text: string; url: string; ts: number } | null {
  const id = firstString(r, ["id_str", "id", "tweet_id", "tweetId", "rest_id", "conversation_id_str"]);
  const text = firstString(r, ["full_text", "text", "content", "tweet", "body"]);
  const ts = parseCreatedAt(r);
  if (!id || !text || ts == null) return null;
  const url =
    firstString(r, ["url", "link", "tweetUrl", "tweet_url", "permalink"]) ??
    `https://x.com/${handle}/status/${id}`;
  return { id, text, url, ts };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-shaped scraper JSON
function extractRows(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed;
  return parsed?.tweets ?? parsed?.data ?? parsed?.results ?? parsed?.statuses ?? [];
}

export function importArchive(handle: string, jsonPath: string) {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO influencers (handle) VALUES (?)").run(handle);
  const inf = db.prepare("SELECT id FROM influencers WHERE handle=?").get(handle) as { id: number };
  const rows = extractRows(JSON.parse(readFileSync(jsonPath, "utf8")));
  let inserted = 0, skipped = 0, malformed = 0;
  const ins = db.prepare(`INSERT OR IGNORE INTO posts
    (influencer_id,x_post_id,content,content_hash,url,posted_at,raw_json)
    VALUES (?,?,?,?,?,?,?)`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-shaped scraper JSON
  const importRows = db.transaction((rows: any[]) => {
    for (const r of rows) {
      const n = normalizeRow(r, handle);
      if (!n) {
        malformed++;
        continue;
      }
      const hash = createHash("sha256").update(n.text).digest("hex");
      const res = ins.run(inf.id, n.id, n.text, hash, n.url, n.ts, JSON.stringify(r));
      if (res.changes) inserted++;
      else skipped++;
    }
  });
  importRows(rows);
  return { inserted, skipped, malformed };
}

// CLI shim: `tsx scripts/import-archive.ts <handle> <jsonPath>` ingests a
// scraped archive into the posts table (creating the influencer if needed).
if (require.main === module) {
  const handle = process.argv[2];
  const jsonPath = process.argv[3];
  if (!handle || !jsonPath) {
    console.error("usage: tsx scripts/import-archive.ts <handle> <jsonPath>");
    process.exit(1);
  }
  const r = importArchive(handle, jsonPath);
  console.log(`@${handle}: imported ${r.inserted} new, skipped ${r.skipped}, malformed ${r.malformed}`);
}
