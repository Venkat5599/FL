# KOLlateral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the KOLlateral demo path (dossier + receipts + Said-vs-Did + one real FADE swap) by Sun Jul 26, 8:30 AM WEST.

**Architecture:** Next.js App Router monolith with SQLite. Batch pipeline (XActions JSON → 0G classification → Graph pricing → scoring) writes to DB; the app reads only from DB. Uniswap Trading API used server-side for live marks and the FADE/FOLLOW swap builder.

**Tech Stack:** Next.js 15 + TypeScript, better-sqlite3, zod, vitest, openai SDK (pointed at 0G Router), viem + wagmi (Base Sepolia), Tailwind, recharts.

## Global Constraints

- Deadline gates: pipeline E2E for 1 influencer by **Sat 19:00** · UI demo path by **Sat 24:00** · pre-index + hand-review by **Sun 03:00** · compliance artifacts by **Sun 08:30**.
- Publish threshold: only calls with `confidence >= 0.85` are scored; below → `AMBIGUOUS` bucket (visible, unscored).
- Uniswap quotes: ALWAYS `protocols: ["V2","V3","V4"]` (UniswapX has $300 min). All quote calls server-side (key secrecy). Save every swap tx hash to `docs/TX_HASHES.md`.
- Graph Token API: free tier returns **max 10 rows/query** — every client function paginates. 200 req/min.
- 0G Router: 30 req/min — pipeline throttles to 1 req/2.5s. Both tiers run on 0G.
- UI copy: zero editorial adjectives. Numbers + citations only.
- Env vars in `.env.local`: `ZG_API_KEY`, `PINAX_JWT`, `UNISWAP_API_KEY`, `GRAPH_STUDIO_KEY`, `DB_PATH=./kollateral.db`.
- Scoring: $1,000 notional per call; benchmark = same-notional ETH buy-and-hold; checkpoints 1d/7d/30d + expiry.
- Commits: NO Co-Authored-By trailers.

---

### Task 1: Scaffold + database schema  *(Sat, 45 min)*

**Files:**
- Create: Next.js app via CLI, `src/lib/db.ts`, `src/lib/schema.sql`, `tests/db.test.ts`

**Interfaces:**
- Produces: `getDb(): Database` (better-sqlite3 singleton), tables `influencers, posts, calls, artifacts, marks, wallet_events, contradictions`.

- [ ] **Step 1: Scaffold**

```bash
cd ~/Documents/RandomClaudeSessions/kollateral
npx create-next-app@latest app --ts --tailwind --app --no-src-dir --import-alias "@/*" --use-npm --yes
cd app && npm i better-sqlite3 zod openai viem wagmi @tanstack/react-query recharts && npm i -D vitest @types/better-sqlite3
```

Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write schema** — `lib/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS influencers (
  id INTEGER PRIMARY KEY, handle TEXT UNIQUE NOT NULL, display_name TEXT,
  wallet_address TEXT, avatar_url TEXT, claimed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY, influencer_id INTEGER NOT NULL REFERENCES influencers(id),
  x_post_id TEXT UNIQUE NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL,
  url TEXT NOT NULL, posted_at INTEGER NOT NULL, deleted_at INTEGER, raw_json TEXT);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY, post_id INTEGER UNIQUE NOT NULL REFERENCES posts(id),
  template TEXT NOT NULL CHECK(template IN ('DIRECTIONAL','TARGET_CALL','GEM_SHILL','AMBIGUOUS')),
  asset_symbol TEXT, asset_address TEXT, chain TEXT DEFAULT 'mainnet',
  direction TEXT CHECK(direction IN ('long','short')), expiry_at INTEGER,
  confidence REAL NOT NULL, status TEXT DEFAULT 'open'
    CHECK(status IN ('open','settled','unpriceable','ambiguous')));
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY, call_id INTEGER NOT NULL REFERENCES calls(id),
  request_json TEXT NOT NULL, response_json TEXT NOT NULL,
  chat_id TEXT, tee_signature TEXT, provider_address TEXT, verified INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS marks (
  id INTEGER PRIMARY KEY, call_id INTEGER NOT NULL REFERENCES calls(id),
  kind TEXT NOT NULL CHECK(kind IN ('entry','d1','d7','d30','settle','live')),
  price_usd REAL NOT NULL, source TEXT NOT NULL, marked_at INTEGER NOT NULL,
  UNIQUE(call_id, kind));
CREATE TABLE IF NOT EXISTS wallet_events (
  id INTEGER PRIMARY KEY, influencer_id INTEGER NOT NULL REFERENCES influencers(id),
  tx_hash TEXT NOT NULL, token_address TEXT NOT NULL, side TEXT CHECK(side IN ('buy','sell')),
  usd_value REAL, occurred_at INTEGER NOT NULL, UNIQUE(tx_hash, token_address, side));
CREATE TABLE IF NOT EXISTS contradictions (
  id INTEGER PRIMARY KEY, call_id INTEGER NOT NULL REFERENCES calls(id),
  wallet_event_id INTEGER NOT NULL REFERENCES wallet_events(id), gap_hours REAL);
```

- [ ] **Step 3: DB accessor** — `lib/db.ts`

```ts
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import path from "path";
let db: Database.Database | null = null;
export function getDb() {
  if (!db) {
    db = new Database(process.env.DB_PATH ?? "./kollateral.db");
    db.pragma("journal_mode = WAL");
    db.exec(readFileSync(path.join(process.cwd(), "lib/schema.sql"), "utf8"));
  }
  return db;
}
```

- [ ] **Step 4: Failing test** — `tests/db.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { getDb } from "../lib/db";
describe("db", () => {
  it("creates tables and enforces unique post ids", () => {
    process.env.DB_PATH = ":memory:";
    const db = getDb();
    db.prepare("INSERT INTO influencers (handle) VALUES ('test')").run();
    const ins = db.prepare(
      "INSERT INTO posts (influencer_id,x_post_id,content,content_hash,url,posted_at) VALUES (1,'p1','c','h','u',1)");
    ins.run();
    expect(() => ins.run()).toThrow(); // UNIQUE violation
  });
});
```

- [ ] **Step 5: Run** `npx vitest run tests/db.test.ts` → PASS. Commit: `git commit -m "feat: scaffold + sqlite schema"`.

---

### Task 2: XActions viability gate + archive importer  *(Sat, 1 h — START THE SCRAPE BEFORE CONTINUING)*

**Files:**
- Create: `scripts/import-archive.ts`, `tests/import.test.ts`

**Interfaces:**
- Consumes: XActions search-scraper JSON export files (array of `{id, text, created_at, url}` — verify actual field names against real export and adapt ONCE here).
- Produces: `importArchive(handle: string, jsonPath: string): {inserted: number, skipped: number}`.

- [ ] **Step 1: VIABILITY GATE (manual).** Burner account logged into x.com; run XActions search scrape `from:CryptoKaleo since:2025-01-01 until:2025-06-30`, export JSON, confirm ≥50 posts. **If this fails after 1 hour → switch to twitterapi.io and rewrite only this importer's field mapping.**

- [ ] **Step 2: Failing test** — `tests/import.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { importArchive } from "../scripts/import-archive";
import { writeFileSync } from "fs";
describe("importArchive", () => {
  it("inserts posts with sha256 content hash, dedupes on re-run", () => {
    process.env.DB_PATH = ":memory:";
    writeFileSync("/tmp/fixture.json", JSON.stringify([
      { id: "111", text: "$PEPE 10x incoming", created_at: "2025-03-01T10:00:00Z",
        url: "https://x.com/kaleo/status/111" }]));
    const r1 = importArchive("CryptoKaleo", "/tmp/fixture.json");
    expect(r1.inserted).toBe(1);
    const r2 = importArchive("CryptoKaleo", "/tmp/fixture.json");
    expect(r2.skipped).toBe(1);
  });
});
```

- [ ] **Step 3: Implement** — `scripts/import-archive.ts`

```ts
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { getDb } from "../lib/db";
export function importArchive(handle: string, jsonPath: string) {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO influencers (handle) VALUES (?)").run(handle);
  const inf = db.prepare("SELECT id FROM influencers WHERE handle=?").get(handle) as {id:number};
  const rows = JSON.parse(readFileSync(jsonPath, "utf8"));
  let inserted = 0, skipped = 0;
  const ins = db.prepare(`INSERT OR IGNORE INTO posts
    (influencer_id,x_post_id,content,content_hash,url,posted_at,raw_json)
    VALUES (?,?,?,?,?,?,?)`);
  for (const r of rows) {
    const hash = createHash("sha256").update(r.text).digest("hex");
    const ts = Math.floor(new Date(r.created_at).getTime() / 1000);
    const res = ins.run(inf.id, String(r.id), r.text, hash, r.url, ts, JSON.stringify(r));
    res.changes ? inserted++ : skipped++;
  }
  return { inserted, skipped };
}
```

- [ ] **Step 4:** Test PASS → commit `feat: archive importer`. **Then immediately kick off the full background scrape of all 15–20 target handles** (list in spec §competitive/demo) so it runs while you build Tasks 3–10.

---

### Task 3: 0G Router classification client  *(Sat, 1.5 h)*

**Files:**
- Create: `lib/zg.ts`, `lib/signal-schema.ts`, `tests/signal.test.ts`

**Interfaces:**
- Produces: `classifyPost(text: string, postedAt: number): Promise<Classification>` where `Classification = { signal: Signal | null, raw: unknown, chatId: string | null, teeSignature: string | null }`; `Signal = { template, asset_symbol, direction, expiry_days, confidence }` (zod-validated).

- [ ] **Step 1: Schema** — `lib/signal-schema.ts`

```ts
import { z } from "zod";
export const SignalSchema = z.object({
  template: z.enum(["DIRECTIONAL", "TARGET_CALL", "GEM_SHILL", "NOT_A_SIGNAL"]),
  asset_symbol: z.string().nullable(),
  direction: z.enum(["long", "short"]).nullable(),
  expiry_days: z.number().nullable(),
  confidence: z.number().min(0).max(1),
});
export type Signal = z.infer<typeof SignalSchema>;
export const DEFAULT_EXPIRY: Record<string, number> = { DIRECTIONAL: 7, TARGET_CALL: 30, GEM_SHILL: 30 };
```

- [ ] **Step 2: Failing test (validation logic only — no network in tests)** — `tests/signal.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseToolCall } from "../lib/zg";
describe("parseToolCall", () => {
  it("extracts and validates the emit_trade_signal tool call", () => {
    const completion = { choices: [{ message: { tool_calls: [{ function: {
      name: "emit_trade_signal",
      arguments: JSON.stringify({ template: "GEM_SHILL", asset_symbol: "PEPE",
        direction: "long", expiry_days: null, confidence: 0.93 }) } }] } }] };
    const s = parseToolCall(completion)!;
    expect(s.template).toBe("GEM_SHILL");
    expect(s.confidence).toBeGreaterThan(0.85);
  });
  it("returns null on garbage", () => {
    expect(parseToolCall({ choices: [{ message: {} }] })).toBeNull();
  });
});
```

- [ ] **Step 3: Implement** — `lib/zg.ts`

```ts
import OpenAI from "openai";
import { SignalSchema, Signal } from "./signal-schema";
const client = new OpenAI({ baseURL: "https://router-api.0g.ai/v1", apiKey: process.env.ZG_API_KEY! });
const TOOL = { type: "function" as const, function: {
  name: "emit_trade_signal",
  description: "Classify a crypto post as a trade signal using the closed template set.",
  parameters: { type: "object", properties: {
    template: { enum: ["DIRECTIONAL","TARGET_CALL","GEM_SHILL","NOT_A_SIGNAL"] },
    asset_symbol: { type: ["string","null"] }, direction: { enum: ["long","short",null] },
    expiry_days: { type: ["number","null"] }, confidence: { type: "number" } },
    required: ["template","confidence"] } } };
const SYSTEM = `You classify crypto X posts. Only EXPLICIT directional/target/shill calls are signals.
Sarcasm, memes, questions, retrospectives => NOT_A_SIGNAL. Be conservative: when unsure, NOT_A_SIGNAL with low confidence.`;

export function parseToolCall(completion: any): Signal | null {
  const tc = completion?.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc || tc.function?.name !== "emit_trade_signal") return null;
  const parsed = SignalSchema.safeParse(JSON.parse(tc.function.arguments));
  return parsed.success ? parsed.data : null;
}

export async function classifyPost(text: string, model = "deepseek-ai/DeepSeek-V3.1", retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const res = await client.chat.completions.create({
      model, tools: [TOOL], tool_choice: { type: "function", function: { name: "emit_trade_signal" } },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text }],
    });
    const signal = parseToolCall(res);
    if (signal) return { signal, raw: res,
      chatId: (res as any).id ?? null,
      teeSignature: (res as any).headers?.["zg-res-key"] ?? null }; // verify header plumbing vs SDK; adapt once here
  }
  return { signal: null, raw: null, chatId: null, teeSignature: null };
}
```

- [ ] **Step 4:** Tests PASS → commit `feat: 0G classification client`.
- [ ] **Step 5: LIVE GATE (manual, once):** `npx tsx -e "import('./lib/zg').then(m=>m.classifyPost('$PEPE 10x incoming, not selling').then(console.log))"` — confirm a real classification returns. If Router/testnet flaky → pin `openai/gpt-oss-20b` for tier-1 AND tier-2, ask 0G booth. Record chatId/signature availability; if signature header not surfaced by SDK, capture via raw `fetch` in `classifyPost` (swap implementation, same interface).

---

### Task 4: Graph pricing client (Token API + pagination)  *(Sat, 1.5 h)*

**Files:**
- Create: `lib/graph.ts`, `tests/graph.test.ts`

**Interfaces:**
- Produces: `priceAt(tokenAddress: string, tsSec: number): Promise<{price: number, source: string} | null>`, `resolvePool(tokenAddress): Promise<string|null>`, `swapsForWallet(wallet: string, startSec: number, endSec: number): Promise<WalletSwap[]>` where `WalletSwap = {tx_hash, token_address, side, usd_value, occurred_at}`.

- [ ] **Step 1: Failing test (pure selection logic)** — `tests/graph.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { pickCandleClose, paginate } from "../lib/graph";
describe("pricing", () => {
  it("picks the candle covering the timestamp", () => {
    const candles = [
      { datetime: "2025-03-01T09:00:00Z", close: 1.0 },
      { datetime: "2025-03-01T10:00:00Z", close: 2.0 },
      { datetime: "2025-03-01T11:00:00Z", close: 3.0 }];
    const ts = Math.floor(new Date("2025-03-01T10:30:00Z").getTime() / 1000);
    expect(pickCandleClose(candles, ts)).toBe(2.0);
  });
});
```

- [ ] **Step 2: Implement** — `lib/graph.ts`

```ts
const BASE = "https://api.pinax.network/v1";
const H = { Authorization: `Bearer ${process.env.PINAX_JWT}` };

export async function paginate(url: string, cap = 20): Promise<any[]> {
  let out: any[] = [], page = 1;
  while (page <= cap) {
    const r = await fetch(`${url}&page=${page}`, { headers: H });
    if (!r.ok) break;
    const j = await r.json();
    const rows = j.data ?? [];
    out = out.concat(rows);
    if (rows.length < 10) break; // free tier: 10/page
    page++;
  }
  return out;
}
export function pickCandleClose(candles: {datetime:string, close:number}[], tsSec: number) {
  let best: number | null = null;
  for (const c of candles) {
    const ct = Math.floor(new Date(c.datetime).getTime() / 1000);
    if (ct <= tsSec) best = c.close; else break;
  }
  return best;
}
export async function resolvePool(token: string): Promise<string | null> {
  const rows = await paginate(`${BASE}/evm/pools?network=mainnet&token=${token}&sort_by=tvl&order=desc`, 1);
  return rows[0]?.pool ?? null;
}
export async function priceAt(token: string, tsSec: number) {
  const pool = await resolvePool(token);
  if (!pool) return null;
  const start = new Date((tsSec - 6 * 3600) * 1000).toISOString();
  const end = new Date((tsSec + 3600) * 1000).toISOString();
  const candles = await paginate(
    `${BASE}/evm/pools/ohlc?network=mainnet&pool=${pool}&interval=1h&start_time=${start}&end_time=${end}`);
  const price = pickCandleClose(candles, tsSec);
  return price != null ? { price, source: "pinax_ohlc" } : null; // TODO-fallback lives in Task 11 (subgraph)
}
export async function swapsForWallet(wallet: string, startSec: number, endSec: number) {
  const rows = await paginate(`${BASE}/evm/swaps?network=mainnet&transaction_from=${wallet}` +
    `&start_time=${new Date(startSec*1000).toISOString()}&end_time=${new Date(endSec*1000).toISOString()}`);
  return rows.map((r: any) => ({
    tx_hash: r.transaction_id, token_address: r.input_contract, side: "sell" as const,
    usd_value: r.input_value_usd ?? r.input_value, occurred_at: Math.floor(new Date(r.datetime).getTime()/1000) }));
}
```

- [ ] **Step 3:** Tests PASS → commit `feat: graph pricing + wallet swaps client`.
- [ ] **Step 4: LIVE GATE (manual):** price PEPE (`0x6982508145454ce325ddbe47a25d4ec3d2311933`) at a March-2025 timestamp. **This answers the OHLC-depth question** — if empty, the subgraph fallback (Task 11) gets promoted into tonight. Also pull one known KOL wallet's swaps ≥6 months back to test lookback cap. Note both answers in `docs/FINDINGS.md`.

---

### Task 5: Scoring engine  *(Sat, 1 h — pure functions, fully tested)*

**Files:**
- Create: `lib/score.ts`, `tests/score.test.ts`

**Interfaces:**
- Produces: `callPnl(entry, mark, direction, notional?) → {pnlUsd, retPct}`, `dossierStats(calls: ScoredCall[], ethSeries: {entry:number, latest:number}[]) → {totalPnl, winRate, benchmarkPnl, settled, open}` where `ScoredCall = {direction, entry, latest, settled}`.

- [ ] **Step 1: Failing tests** — `tests/score.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { callPnl, dossierStats } from "../lib/score";
describe("scoring", () => {
  it("long call math", () => {
    expect(callPnl(2.0, 1.0, "long").retPct).toBe(-50);
    expect(callPnl(2.0, 3.0, "long").pnlUsd).toBe(500);
  });
  it("short call math", () => {
    expect(callPnl(2.0, 1.0, "short").retPct).toBe(50);
  });
  it("dossier aggregates + ETH benchmark", () => {
    const s = dossierStats(
      [{ direction: "long", entry: 1, latest: 0.5, settled: true },
       { direction: "long", entry: 1, latest: 2.0, settled: true }],
      [{ entry: 2000, latest: 3000 }, { entry: 2000, latest: 3000 }]);
    expect(s.totalPnl).toBe(500);      // -500 + 1000
    expect(s.winRate).toBe(50);
    expect(s.benchmarkPnl).toBe(1000); // 2 × $1000 × 50%
  });
});
```

- [ ] **Step 2: Implement** — `lib/score.ts`

```ts
export const NOTIONAL = 1000;
export function callPnl(entry: number, mark: number, direction: "long"|"short", notional = NOTIONAL) {
  const raw = (mark - entry) / entry;
  const ret = direction === "long" ? raw : -raw;
  return { pnlUsd: Math.round(notional * ret), retPct: Math.round(ret * 10000) / 100 };
}
export function dossierStats(calls: {direction:"long"|"short";entry:number;latest:number;settled:boolean}[],
                             eth: {entry:number;latest:number}[]) {
  let totalPnl = 0, wins = 0, settled = 0, open = 0, benchmarkPnl = 0;
  calls.forEach((c, i) => {
    const { pnlUsd } = callPnl(c.entry, c.latest, c.direction);
    totalPnl += pnlUsd;
    c.settled ? (settled++, pnlUsd > 0 && wins++) : open++;
    const e = eth[i];
    if (e) benchmarkPnl += Math.round(NOTIONAL * (e.latest - e.entry) / e.entry);
  });
  return { totalPnl, winRate: settled ? Math.round(100 * wins / settled) : 0, benchmarkPnl, settled, open };
}
```

- [ ] **Step 3:** PASS → commit `feat: scoring engine`.

---

### Task 6: Pipeline runner (posts → calls → marks)  *(Sat, 1 h; run against archive as it lands)*

**Files:**
- Create: `scripts/run-pipeline.ts`

**Interfaces:**
- Consumes: `classifyPost` (Task 3), `priceAt` (Task 4), DB (Task 1).
- Produces: CLI `npx tsx scripts/run-pipeline.ts <handle>` — classifies unprocessed posts (throttled 2.5s), writes `calls` + `artifacts`, prices `entry` + latest checkpoint marks, ETH entry marks (WETH `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`).

- [ ] **Step 1: Implement** — `scripts/run-pipeline.ts`

```ts
import { getDb } from "../lib/db";
import { classifyPost } from "../lib/zg";
import { priceAt } from "../lib/graph";
import { DEFAULT_EXPIRY } from "../lib/signal-schema";
import { TOKENS } from "../lib/tokens"; // symbol->address map you seed for the demo set
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

async function main(handle: string) {
  const db = getDb();
  const posts = db.prepare(`SELECT p.* FROM posts p JOIN influencers i ON i.id=p.influencer_id
    WHERE i.handle=? AND p.id NOT IN (SELECT post_id FROM calls)`).all(handle) as any[];
  for (const p of posts) {
    const c = await classifyPost(p.content); await sleep(2500);
    if (!c.signal) continue;
    const s = c.signal;
    const isSignal = s.template !== "NOT_A_SIGNAL" && s.confidence >= 0.85 && s.asset_symbol;
    const template = isSignal ? s.template : "AMBIGUOUS";
    const addr = s.asset_symbol ? TOKENS[s.asset_symbol.toUpperCase()] ?? null : null;
    const expiry = p.posted_at + (s.expiry_days ?? DEFAULT_EXPIRY[s.template] ?? 30) * 86400;
    const r = db.prepare(`INSERT INTO calls (post_id,template,asset_symbol,asset_address,direction,expiry_at,confidence,status)
      VALUES (?,?,?,?,?,?,?,?)`).run(p.id, template, s.asset_symbol, addr, s.direction ?? "long",
      expiry, s.confidence, isSignal ? (addr ? "open" : "unpriceable") : "ambiguous");
    db.prepare(`INSERT INTO artifacts (call_id,request_json,response_json,chat_id,tee_signature)
      VALUES (?,?,?,?,?)`).run(r.lastInsertRowid, p.content, JSON.stringify(c.raw ?? {}), c.chatId, c.teeSignature);
    if (isSignal && addr) {
      const entry = await priceAt(addr, p.posted_at);
      const latest = await priceAt(addr, Math.floor(Date.now() / 1000) - 3600);
      const ethE = await priceAt(WETH, p.posted_at);
      const ethL = await priceAt(WETH, Math.floor(Date.now() / 1000) - 3600);
      const mk = db.prepare("INSERT OR IGNORE INTO marks (call_id,kind,price_usd,source,marked_at) VALUES (?,?,?,?,?)");
      if (entry) mk.run(r.lastInsertRowid, "entry", entry.price, entry.source, p.posted_at);
      if (latest) mk.run(r.lastInsertRowid, "live", latest.price, latest.source, Date.now()/1000|0);
      if (ethE && ethL) { mk.run(r.lastInsertRowid, "d1", ethE.price, "eth_entry", p.posted_at);
                          mk.run(r.lastInsertRowid, "d7", ethL.price, "eth_latest", Date.now()/1000|0); } // eth benchmark stored as paired marks
      if (!entry) db.prepare("UPDATE calls SET status='unpriceable' WHERE id=?").run(r.lastInsertRowid);
    }
    console.log(`${p.x_post_id}: ${template} ${s.asset_symbol ?? ""} conf=${s.confidence}`);
  }
}
main(process.argv[2] ?? "CryptoKaleo");
```

Also create `lib/tokens.ts`: `export const TOKENS: Record<string,string> = { PEPE: "0x6982…", WIF: null-as-solana-skip, ETH: WETH, ... }` — seed ~20 liquid EVM tokens the demo set actually shilled; unknown symbols → unpriceable (honest bucket).

- [ ] **Step 2: E2E GATE (Sat 19:00):** run against one archived handle; expect calls + marks rows. Hand-check 5 classifications against source posts. Commit `feat: pipeline runner`.

---

### Task 7: Dossier API + page (verdict block, curve, ledger)  *(Sat, 2.5 h)*

**Files:**
- Create: `app/api/dossier/[handle]/route.ts`, `app/k/[handle]/page.tsx`, `components/VerdictBlock.tsx`, `components/CallLedger.tsx`

**Interfaces:**
- Produces: `GET /api/dossier/:handle` → `{handle, stats (Task 5 shape), calls: [{id, content, url, posted_at, template, asset_symbol, direction, confidence, entry, latest, retPct, pnlUsd, status, deleted_at, chat_id}]}`; page `/k/:handle` renders it.

- [ ] **Step 1: API route** — assemble from DB with one JOIN query, compute per-call `callPnl`, aggregate with `dossierStats` (ETH pairs from the eth marks). Return JSON. (Write it directly; the logic is Task 5 functions + SQL.)
- [ ] **Step 2: Verdict block** — `components/VerdictBlock.tsx`

```tsx
export function VerdictBlock({ stats }: { stats: {totalPnl:number;benchmarkPnl:number;winRate:number;settled:number} }) {
  return (
    <div className="py-10">
      <div className={`text-7xl font-bold tabular-nums ${stats.totalPnl < 0 ? "text-red-500" : "text-green-500"}`}>
        {stats.totalPnl >= 0 ? "+" : ""}{(100 * stats.totalPnl / (1000 * Math.max(stats.settled,1))).toFixed(1)}%
      </div>
      <p className="mt-3 text-lg text-neutral-400">
        $1,000 into every call → ${(1000 * stats.settled + stats.totalPnl).toLocaleString()}.
        Holding ETH instead → ${(1000 * stats.settled + stats.benchmarkPnl).toLocaleString()}.
      </p>
      <p className="text-sm text-neutral-500 mt-1">{stats.settled} settled calls · {stats.winRate}% win rate</p>
    </div>);
}
```

- [ ] **Step 3: Ledger table** — rows: truncated content (links to post URL), asset chip, direction arrow, entry→latest, colored `retPct`, badges (🗑️ if `deleted_at`, ⏳ open, ✓ if `chat_id`). Filter buttons: All / Deleted / Ambiguous. Row click → Task 8 slide-over.
- [ ] **Step 4: Page + curve** — `/k/[handle]/page.tsx` fetches API, renders VerdictBlock, recharts LineChart (cumulative call P&L vs cumulative ETH benchmark by call date), CallLedger.
- [ ] **Step 5:** `npm run dev`, load `/k/CryptoKaleo` with real pipeline data. Screenshot-check the verdict sentence. Commit `feat: dossier page`.

---

### Task 8: Call detail slide-over + receipt strip  *(Sat, 1 h)*

**Files:**
- Create: `components/CallDetail.tsx`, `app/api/receipt/[callId]/route.ts`

**Interfaces:**
- Produces: slide-over with archived post render, parsed-signal box, receipt strip (`content_hash` prefix, `chat_id`, `tee_signature` prefix, provider); `GET /api/receipt/:callId` returns full artifact JSON (the "verify" link target).

- [ ] **Step 1:** Receipt API route: `SELECT * FROM artifacts WHERE call_id=?` → return `{request_json, response_json, chat_id, tee_signature, provider_address, content_hash}` (join posts for hash).
- [ ] **Step 2:** `CallDetail.tsx`: fixed right panel (w-[480px]); post text styled as tweet card with timestamp + original URL; signal box (`template · asset · direction · expiry · confidence`); monospace receipt strip with copy buttons; link `→ /api/receipt/{id}`. If `deleted_at`: red banner "Post deleted {date}. Content preserved from archive (hash {8-char})."
- [ ] **Step 3:** Verify in browser on a deleted-call row. Commit `feat: call detail + receipts`.

---

### Task 9: Said-vs-Did (wallet sync + matcher + tab)  *(Sat, 2 h — NEVER CUT)*

**Files:**
- Create: `scripts/sync-wallet.ts`, `lib/said-did.ts`, `tests/said-did.test.ts`, `components/SaidVsDid.tsx`

**Interfaces:**
- Produces: `findContradictions(calls, events, windowHours=24) → {callId, eventId, gapHours}[]`; dual-timeline component on dossier tab 2.

- [ ] **Step 1: Failing test** — `tests/said-did.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { findContradictions } from "../lib/said-did";
describe("said vs did", () => {
  it("flags a sell of the shilled token within window", () => {
    const calls = [{ id: 1, asset_address: "0xA", direction: "long", posted_at: 1000 }];
    const events = [{ id: 9, token_address: "0xA", side: "sell", occurred_at: 1000 + 4*3600 }];
    const out = findContradictions(calls as any, events as any);
    expect(out).toEqual([{ callId: 1, eventId: 9, gapHours: 4 }]);
  });
  it("ignores sells outside window or other tokens", () => {
    const calls = [{ id: 1, asset_address: "0xA", direction: "long", posted_at: 1000 }];
    expect(findContradictions(calls as any,
      [{ id: 2, token_address: "0xB", side: "sell", occurred_at: 2000 }] as any)).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement** — `lib/said-did.ts`

```ts
type Call = { id: number; asset_address: string | null; direction: string; posted_at: number };
type Ev = { id: number; token_address: string; side: string; occurred_at: number };
export function findContradictions(calls: Call[], events: Ev[], windowHours = 24) {
  const out: { callId: number; eventId: number; gapHours: number }[] = [];
  for (const c of calls) {
    if (c.direction !== "long" || !c.asset_address) continue;
    for (const e of events) {
      if (e.side !== "sell" || e.token_address.toLowerCase() !== c.asset_address.toLowerCase()) continue;
      const gap = (e.occurred_at - c.posted_at) / 3600;
      if (gap >= 0 && gap <= windowHours) out.push({ callId: c.id, eventId: e.id, gapHours: Math.round(gap * 10) / 10 });
    }
  }
  return out;
}
```

- [ ] **Step 3:** `scripts/sync-wallet.ts`: for each influencer with `wallet_address` (seed 2–3 publicly-attributed ones: Machi Big Brother etc., attribution source in a code comment), call `swapsForWallet` over each call's window, upsert `wallet_events`, run matcher, insert `contradictions`. Run it; confirm ≥1 real contradiction OR pick a wallet/token pair known to have one (research from Lookonchain posts).
- [ ] **Step 4:** `SaidVsDid.tsx`: two rails on shared time axis (posts left, swaps right), red connector for each contradiction row, case card on click: post text + tx hash link (etherscan) + gap ("sold 4.2h after this post"). Attribution disclaimer line at top.
- [ ] **Step 5:** Tests PASS, tab renders with a real case → commit `feat: said-vs-did`. **This is the demo's scandal beat — if no real contradiction found by Sun 01:00, present the mechanism live on any wallet + calls honestly ("no contradiction in window — that's the system working").**

---

### Task 10: Uniswap FADE/FOLLOW (quote proxy + swap on Base Sepolia)  *(Sat night, 2 h)*

**Files:**
- Create: `app/api/quote/route.ts`, `components/FadeTicket.tsx`, `lib/wagmi.ts`, `docs/FEEDBACK.md` (start it now), `docs/TX_HASHES.md`

**Interfaces:**
- Produces: `POST /api/quote {tokenIn, tokenOut, amount, swapper, chainId}` → Uniswap quote+swap calldata; `FadeTicket` renders on ledger rows + terminal cards; every executed swap hash appended to `docs/TX_HASHES.md`.

- [ ] **Step 1: Quote proxy** — `app/api/quote/route.ts`

```ts
const BASE = "https://trade-api.gateway.uniswap.org/v1";
const H = { "x-api-key": process.env.UNISWAP_API_KEY!, "Content-Type": "application/json", Accept: "application/json" };
export async function POST(req: Request) {
  const b = await req.json();
  const quote = await fetch(`${BASE}/quote`, { method: "POST", headers: H, body: JSON.stringify({
    type: "EXACT_INPUT", tokenIn: b.tokenIn, tokenOut: b.tokenOut,
    tokenInChainId: b.chainId, tokenOutChainId: b.chainId, amount: b.amount,
    swapper: b.swapper, autoSlippage: "DEFAULT", protocols: ["V2","V3","V4"] }) }).then(r => r.json());
  if (quote.permitData) return Response.json({ step: "permit", quote });
  const swap = await fetch(`${BASE}/swap`, { method: "POST", headers: H,
    body: JSON.stringify({ quote: quote.quote }) }).then(r => r.json());
  return Response.json({ step: "swap", quote, swap });
}
```

- [ ] **Step 2:** `lib/wagmi.ts`: wagmi config, Base Sepolia (84532) + injected connector. Wrap app in providers.
- [ ] **Step 3:** `FadeTicket.tsx`: takes a call; FADE = invert direction (long call → sell token for WETH / short → buy). Shows live quote (refetch 20s), route string, "Sign & Execute" → `sendTransaction(swap.swap)`; on receipt, POST hash to a tiny `/api/txlog` that appends to `docs/TX_HASHES.md`. Handle `check_approval` first call (same proxy pattern, endpoint `/check_approval`).
- [ ] **Step 4: LIVE GATE:** one real swap on Base Sepolia (test wallet, faucet ETH). Hash lands in TX_HASHES.md. Write first FEEDBACK.md entries (rough edges hit). Commit `feat: fade/follow swap flow`.

---

### Task 11: Fallbacks + live loops  *(Sun 00:00–02:00 — promote/demote per Task 4 findings)*

**Files:**
- Create: `lib/subgraph.ts` (only if OHLC depth failed), `scripts/poll.ts`, `scripts/recheck-deletions.ts`

- [ ] **Step 1 (conditional):** `lib/subgraph.ts`: Uniswap v3 subgraph (`5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV` via `gateway.thegraph.com/api/${GRAPH_STUDIO_KEY}/subgraphs/id/…`) — query `tokenHourDatas(where:{token:$id, periodStartUnix_lte:$ts}, orderBy: periodStartUnix, orderDirection: desc, first:1){ priceUSD }`; wire as fallback inside `priceAt` when OHLC returns null. This composition = Graph Composable track; note it in README.
- [ ] **Step 2:** `scripts/poll.ts`: loop every 90s — run XActions search for tracked handles `since:{lastSeen}`, import via `importArchive`, run pipeline for new posts, console-log new calls (Terminal feed reads DB via `/api/feed` route polling 5s — add trivial route + feed page section on the dossier or a `/terminal` page with FadeTicket on cards).
- [ ] **Step 3:** `scripts/recheck-deletions.ts`: for posts with `deleted_at IS NULL`, XActions status check (batched, 3s delay); 404 → `UPDATE posts SET deleted_at=strftime('%s','now')`. Run once over full archive tonight (populates 🗑️ badges), then loop hourly.
- [ ] **Step 4:** Commit `feat: live loops + subgraph fallback`.

---

### Task 12: Pre-index, hand-review, share cards  *(Sun 01:00–03:00)*

- [ ] **Step 1:** Run full pipeline over all archived handles (throttled ≈ 25 posts/min through 0G — budget accordingly; prioritize: 1 famous loser, 1 famous winner (board credibility), the Said-vs-Did wallet subject, 2 volume shillers).
- [ ] **Step 2:** Hand-review EVERY published call on demo accounts (`SELECT` dump → eyeball vs source posts). Reclassify embarrassments to `ambiguous` manually (this is editorial QA, not data tampering — the artifact stays).
- [ ] **Step 3 (if time):** `app/api/og/[handle]/route.tsx` — Next.js ImageResponse OG card: handle, verdict %, "vs ETH" line, QR (skip QR if slow — URL text fine). Commit.

---

### Task 13: Compliance pack + submission  *(Sun 06:00–08:30 — HARD STOP)*

- [ ] **Step 1:** Finish `docs/FEEDBACK.md` (Uniswap: honest integration notes). Submit Uniswap Developer Feedback Form. README: architecture diagram, which code = which sponsor integration (file paths), TX hashes link, methodology section (verbatim from spec), attribution disclaimer.
- [ ] **Step 2:** Record demo video ≤ 3 min (0G requirement) following spec demo script §personas. Upload.
- [ ] **Step 3:** Push public repo. ETHGlobal submission: select Uniswap + 0G + Graph (AI Use Case AND Composable) tracks; 0G form needs Telegram + X contacts. Submit by **08:30**, not 08:59.

---

## Task-4-findings decision table

| Finding | Action |
|---|---|
| OHLC depth reaches 2025 | Task 11 Step 1 skipped; Composable via Token API MCP instead (ask booth) or drop Composable |
| OHLC shallow | Build subgraph fallback tonight (promoted into Task 6's pricing path) |
| Wallet lookback < needed | Said-vs-Did windows limited to recent calls — pick a recent contradiction case |
