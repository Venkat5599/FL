/**
 * Seeds DEMO creators so the leaderboard, terminal and dossier views have a
 * realistic population to work against.
 *
 * PROVENANCE — READ THIS BEFORE REUSING THE DATA.
 *
 * Everything below is SYNTHETIC and procedurally generated. The handles are
 * invented, the posts were never published by anyone, and the prices are derived
 * from a seeded PRNG to produce a plausible spread of outcomes. Unlike
 * `seed-lark.ts` — whose wallet and sells are real on-chain data with a cited
 * public attribution — nothing here is evidence of anything. Attributing invented
 * calls to a real trader and rendering them as a track record is precisely the
 * harm TAPE exists to expose, so every demo row carries a name nobody can be
 * confused for.
 *
 * Handles are prefixed `demo_` so they are trivially greppable and removable:
 *
 *   DELETE FROM marks WHERE call_id IN (
 *     SELECT c.id FROM calls c JOIN posts p ON p.id = c.post_id
 *     JOIN influencers i ON i.id = p.influencer_id WHERE i.handle LIKE 'demo\_%' ESCAPE '\');
 *   DELETE FROM calls WHERE post_id IN (
 *     SELECT p.id FROM posts p JOIN influencers i ON i.id = p.influencer_id
 *     WHERE i.handle LIKE 'demo\_%' ESCAPE '\');
 *   DELETE FROM posts WHERE influencer_id IN (
 *     SELECT id FROM influencers WHERE handle LIKE 'demo\_%' ESCAPE '\');
 *   DELETE FROM influencers WHERE handle LIKE 'demo\_%' ESCAPE '\';
 *
 * Mark shape mirrors the existing settled rows exactly, so the leaderboard's
 * headline maths needs no special-casing:
 *   entry → the asset at post time        live → the asset now
 *   d1    → ETH at post time (benchmark)  d7   → ETH now (benchmark)
 *
 * Generation is deterministic: the PRNG is seeded from the handle, so re-running
 * produces byte-identical rows and every insert is `INSERT OR IGNORE`. Running it
 * twice changes nothing.
 *
 * Usage:
 *   bunx tsx scripts/seed-demo-creators.ts          # default 100 creators
 *   bunx tsx scripts/seed-demo-creators.ts 250      # any count
 */
import { createHash } from "crypto";
import { getDb } from "../lib/db";

const DAY = 86_400;

/** ETH "now", matching the value the existing seeded rows settle against. */
const ETH_NOW = 1869.7826583544513;

/**
 * Spot prices "now" for every symbol FTSOv2 is confirmed to carry (see
 * lib/networks.ts CONFIRMED_FEED_SYMBOLS). Calls on these resolve to a real
 * priced status; anything else is deliberately left `unpriceable`.
 */
const PRICEABLE: Record<string, number> = {
  BTC: 68910.2,
  ETH: ETH_NOW,
  XRP: 1.00064,
  FLR: 0.0187,
  DOGE: 0.1104,
  ADA: 0.4402,
  ALGO: 0.1338,
};
const PRICEABLE_SYMBOLS = Object.keys(PRICEABLE);

/** Long-tail tickers with no oracle feed — these become `unpriceable`, honestly. */
const MEME_SYMBOLS = [
  "SQUIDINU", "WOJAKAI", "PEPE2", "BONKJR", "MOONRAT", "GIGACHAD",
  "FLOKIX", "SAFEDOGE", "ELONMARS", "APEZILLA", "CHADCOIN", "RUGPULL",
];

// ---------------------------------------------------------------------------
// Deterministic PRNG. Seeded per handle so the generated tape is stable across
// runs — a leaderboard that reshuffles every seed would make it impossible to
// tell a real regression from noise.
// ---------------------------------------------------------------------------

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
const between = (rng: Rng, lo: number, hi: number): number => lo + rng() * (hi - lo);
const intBetween = (rng: Rng, lo: number, hi: number): number => Math.floor(between(rng, lo, hi + 1));

/** Box-Muller, so returns cluster around the mean instead of spreading flat. */
function gaussian(rng: Rng, mean: number, stdev: number): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Handle + copy vocabulary
// ---------------------------------------------------------------------------

const PREFIXES = [
  "chain", "block", "alpha", "delta", "signal", "tape", "candle", "liquid",
  "orbit", "vector", "quant", "hedge", "onchain", "degen", "macro", "cycle",
  "oracle", "ledger", "vault", "basis", "carry", "gamma", "theta", "vol",
  "north", "iron", "silver", "obsidian", "amber", "cobalt", "ember", "flint",
];
const SUFFIXES = [
  "smith", "desk", "labs", "capital", "trades", "notes", "watch", "edge",
  "flow", "works", "council", "society", "collective", "research", "partners",
  "signals", "tape", "report", "journal", "review", "index", "terminal",
];
const DISPLAY_TAIL = [
  "Capital", "Research", "Desk", "Labs", "Partners", "Signals", "Trading",
  "Advisors", "Group", "Collective", "Analytics", "Markets",
];

/** Copy templates by conviction band. Kept terse and non-specific on purpose. */
const BULL_COPY = [
  "$SYM long. Structure held the retest and I am sized accordingly.",
  "$SYM reclaiming the range high on real volume. Long, invalidation below the prior low.",
  "$SYM long here. Marking the entry publicly so it can be checked later.",
  "Adding to $SYM. Thesis is unchanged from last quarter and the tape agrees.",
  "$SYM long, measured size. This is a position, not a lottery ticket.",
  "Opening $SYM long. Stop is mechanical, no discretion on the exit.",
];
const BEAR_COPY = [
  "$SYM short into weekly resistance. Momentum fading, funding stretched.",
  "$SYM short. The bid thinned out and nobody seems to have noticed yet.",
  "Tactical $SYM short. Expecting a retrace into the gap before continuation.",
  "$SYM short here. Happy to be wrong quickly and small.",
  "Fading $SYM. The move ran out of participation two days ago.",
];
const SHILL_COPY = [
  "$SYM is going to change everything this cycle. Generational wealth incoming. Screenshot this.",
  "$SYM about to melt faces. Accumulating aggressively. Do not fade this one.",
  "$SYM is the most undervalued asset in the entire market. Loading before the rest of you wake up.",
  "Nobody is talking about $SYM yet. That changes in about two weeks. Position accordingly.",
  "$SYM just deployed. Getting in early before CT finds it. Contract renounced, LP locked.",
];
const TARGET_COPY = [
  "$SYM to $TGT by end of quarter. The fundamentals have never been stronger.",
  "Calling it now: $SYM hits $TGT this cycle. Remember who told you.",
  "$SYM $TGT target. I will be posting this chart again when it fills.",
];
const NOISE_COPY = [
  "gm to everyone except the fudders",
  "anyone else feel like we're early",
  "No position. Waiting for the weekly close before doing anything.",
  "The market does not owe you an explanation.",
  "Patience is a position.",
  "Zoom out.",
  "Most of you will not survive this chop and that is fine.",
  "Reminder that leverage is a tax on impatience.",
];

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

type Template = "DIRECTIONAL" | "TARGET_CALL" | "GEM_SHILL" | "AMBIGUOUS";
type Status = "open" | "settled" | "unpriceable" | "ambiguous";

interface GeneratedCall {
  text: string;
  sym: string | null;
  direction: "long" | "short" | null;
  template: Template;
  status: Status;
  confidence: number;
  postedAt: number;
  expiryAt: number;
  entry?: number;
  now?: number;
  ethEntry?: number;
}

interface GeneratedCreator {
  handle: string;
  displayName: string;
  calls: GeneratedCall[];
}

/** Build a unique handle/display pair from an index, avoiding collisions. */
function makeIdentity(rng: Rng, index: number, taken: Set<string>) {
  let handle = "";
  for (let attempt = 0; attempt < 64; attempt++) {
    const p = pick(rng, PREFIXES);
    const s = pick(rng, SUFFIXES);
    const candidate = attempt === 0 ? `demo_${p}${s}` : `demo_${p}${s}${index}`;
    if (!taken.has(candidate)) {
      handle = candidate;
      break;
    }
  }
  if (!handle) handle = `demo_creator${index}`;
  taken.add(handle);

  const core = handle.slice(5);
  const display = `${core.charAt(0).toUpperCase()}${core.slice(1)} ${pick(rng, DISPLAY_TAIL)} (demo)`;
  return { handle, display };
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Price precision that suits the magnitude — sub-cent assets need more places. */
function priceDp(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 1) return 4;
  return 6;
}

function generateCreator(index: number, taken: Set<string>, nowSec: number): GeneratedCreator {
  // Seed from the index first so identity is stable, then reseed from the
  // resulting handle so a creator's tape depends only on who they are.
  const idRng = mulberry32(hashSeed(`identity:${index}`));
  const { handle, display } = makeIdentity(idRng, index, taken);
  const rng = mulberry32(hashSeed(handle));

  // Skill is the creator's mean per-call return. Deliberately centred slightly
  // negative: most callers underperform, which is the product's whole thesis.
  const skill = gaussian(rng, -0.03, 0.16);
  // How much of their output is noise rather than an actual call.
  const noiseRate = between(rng, 0.05, 0.4);
  // How much of their output is unpriceable meme shilling.
  const memeRate = between(rng, 0.0, 0.35);
  const callCount = intBetween(rng, 3, 14);

  const calls: GeneratedCall[] = [];

  for (let i = 0; i < callCount; i++) {
    // Spread posts over the last ~15 months.
    const postedAt = nowSec - Math.floor(between(rng, 3 * DAY, 450 * DAY));
    const expiryDays = pick(rng, [7, 14, 21, 30, 30, 45, 60, 90]);
    const expiryAt = postedAt + expiryDays * DAY;
    const roll = rng();

    // --- noise post: no asset, no marks -------------------------------------
    if (roll < noiseRate) {
      calls.push({
        text: pick(rng, NOISE_COPY),
        sym: null,
        direction: null,
        template: "AMBIGUOUS",
        status: "ambiguous",
        confidence: round(between(rng, 0.02, 0.18), 2),
        postedAt,
        expiryAt,
      });
      continue;
    }

    // --- meme shill: has a ticker, but no oracle feed to price it -----------
    if (roll < noiseRate + memeRate) {
      const sym = pick(rng, MEME_SYMBOLS);
      calls.push({
        text: pick(rng, SHILL_COPY).replace("$SYM", `$${sym}`),
        sym: null, // no feed, so nothing to price against
        direction: "long",
        template: "GEM_SHILL",
        status: "unpriceable",
        confidence: round(between(rng, 0.78, 0.97), 2),
        postedAt,
        expiryAt,
      });
      continue;
    }

    // --- real, priceable call ----------------------------------------------
    const sym = pick(rng, PRICEABLE_SYMBOLS);
    const spotNow = PRICEABLE[sym];
    const direction: "long" | "short" = rng() < 0.72 ? "long" : "short";

    // The call's realised return, drawn around the creator's skill.
    const ret = gaussian(rng, skill, 0.28);
    // Back out the entry price that produces exactly that return.
    // long:  ret = (now - entry) / entry      → entry = now / (1 + ret)
    // short: ret = (entry - now) / entry      → entry = now / (1 - ret)
    const denom = direction === "long" ? 1 + ret : 1 - ret;
    // Guard against a degenerate draw inverting or exploding the price.
    const safeDenom = Math.abs(denom) < 0.25 ? (denom < 0 ? -0.25 : 0.25) : denom;
    const entry = spotNow / safeDenom;

    // Benchmark leg: ETH at post time, drawn independently so "vs holding ETH"
    // is a real comparison rather than a constant offset.
    const ethEntry = ETH_NOW / (1 + gaussian(rng, 0.04, 0.22));

    const isTarget = rng() < 0.18;
    const isShill = !isTarget && rng() < 0.12;
    let template: Template = "DIRECTIONAL";
    let text: string;

    if (isTarget) {
      template = "TARGET_CALL";
      const tgt = round(entry * between(rng, 1.6, 3.2), priceDp(entry));
      text = pick(rng, TARGET_COPY).replace("$SYM", `$${sym}`).replace("$TGT", String(tgt));
    } else if (isShill) {
      template = "GEM_SHILL";
      text = pick(rng, SHILL_COPY).replace("$SYM", `$${sym}`);
    } else {
      text = pick(rng, direction === "long" ? BULL_COPY : BEAR_COPY).replace("$SYM", `$${sym}`);
    }

    const settled = expiryAt <= nowSec;
    calls.push({
      text,
      sym,
      direction,
      template,
      status: settled ? "settled" : "open",
      confidence: round(
        template === "GEM_SHILL" ? between(rng, 0.75, 0.96) : between(rng, 0.45, 0.9),
        2
      ),
      postedAt,
      expiryAt,
      entry: round(entry, priceDp(entry)),
      now: spotNow,
      ethEntry: round(ethEntry, 2),
    });
  }

  return { handle, displayName: display, calls };
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

function main() {
  const requested = Number(process.argv[2] ?? 100);
  if (!Number.isFinite(requested) || requested < 1) {
    console.error("usage: bunx tsx scripts/seed-demo-creators.ts [count]");
    process.exit(1);
  }

  const db = getDb();
  const nowSec = Math.floor(Date.now() / 1000);

  const insInfluencer = db.prepare(
    "INSERT OR IGNORE INTO influencers (handle, display_name) VALUES (?,?)"
  );
  const getInfluencer = db.prepare("SELECT id FROM influencers WHERE handle=?");
  const insPost = db.prepare(
    `INSERT OR IGNORE INTO posts (influencer_id,x_post_id,content,content_hash,url,posted_at)
     VALUES (?,?,?,?,?,?)`
  );
  const getPost = db.prepare("SELECT id FROM posts WHERE x_post_id=?");
  const insCall = db.prepare(
    `INSERT OR IGNORE INTO calls
       (post_id,template,asset_symbol,direction,expiry_at,confidence,status)
     VALUES (?,?,?,?,?,?,?)`
  );
  const getCall = db.prepare("SELECT id FROM calls WHERE post_id=?");
  const insMark = db.prepare(
    `INSERT OR IGNORE INTO marks (call_id,kind,price_usd,source,marked_at)
     VALUES (?,?,?,?,?)`
  );

  // Seed the taken-set from the DB so re-running never collides with the
  // creators an earlier run (or the earlier hand-written version) inserted.
  const taken = new Set<string>(
    (db.prepare("SELECT handle FROM influencers").all() as { handle: string }[]).map((r) => r.handle)
  );

  let creators = 0;
  let posts = 0;
  let calls = 0;
  let marks = 0;

  const seed = db.transaction(() => {
    for (let i = 0; i < requested; i++) {
      const c = generateCreator(i, taken, nowSec);

      if (insInfluencer.run(c.handle, c.displayName).changes) creators++;
      const inf = getInfluencer.get(c.handle) as { id: number };

      for (const call of c.calls) {
        // Deterministic id so re-running is idempotent rather than duplicating.
        const xPostId = `${c.handle}_${call.sym ?? "none"}_${call.postedAt}`;
        const hash = createHash("sha256").update(call.text).digest("hex");
        const url = `https://x.com/${c.handle}/status/${xPostId}`;

        if (insPost.run(inf.id, xPostId, call.text, hash, url, call.postedAt).changes) posts++;
        const post = getPost.get(xPostId) as { id: number };

        if (
          insCall.run(
            post.id,
            call.template,
            call.sym,
            call.direction,
            call.expiryAt,
            call.confidence,
            call.status
          ).changes
        ) {
          calls++;
        }
        const row = getCall.get(post.id) as { id: number };

        // Unpriced rows (ambiguous / unpriceable) carry no marks — that is the
        // honest representation, and the UI already has a state for it.
        if (call.entry == null || call.now == null || call.ethEntry == null) continue;

        const markedAt = Math.min(call.expiryAt, nowSec);
        const legs: Array<[string, number, string, number]> = [
          ["entry", call.entry, "ftso_v2", call.postedAt],
          ["live", call.now, "ftso_v2", markedAt],
          ["d1", call.ethEntry, "eth_entry", call.postedAt],
          ["d7", ETH_NOW, "eth_latest", markedAt],
        ];
        for (const [kind, price, source, at] of legs) {
          if (insMark.run(row.id, kind, price, source, at).changes) marks++;
        }
      }
    }
  });

  seed();

  console.log(
    `seeded ${creators} creators, ${posts} posts, ${calls} calls, ${marks} marks (all synthetic)`
  );
}

main();
