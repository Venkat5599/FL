import { getDb } from "./db";
import { NOTIONAL, callPnl, dossierStats } from "./score";
import { computeInsights, type CreatorInsights } from "./insights";

interface CallRow {
  post_id: number;
  content: string;
  url: string;
  posted_at: number;
  deleted_at: number | null;
  call_id: number;
  template: string;
  asset_symbol: string | null;
  direction: "long" | "short" | null;
  expiry_at: number | null;
  confidence: number;
  status: string;
  chat_id: string | null;
}

interface MarkRow {
  call_id: number;
  kind: string;
  price_usd: number;
  source: string;
}

export interface DossierCall {
  id: number;
  content: string;
  url: string;
  posted_at: number;
  template: string;
  asset_symbol: string | null;
  direction: "long" | "short" | null;
  expiry_at: number | null;
  confidence: number;
  entry: number | null;
  latest: number | null;
  retPct: number | null;
  pnlUsd: number | null;
  // Extra field beyond the brief's minimal shape: cumulative-eth-per-call
  // needed for the equity curve (Step 4). Additive, doesn't break consumers
  // relying only on the documented fields.
  ethPnlUsd: number | null;
  status: string;
  deleted_at: number | null;
  chat_id: string | null;
}

export interface SaidVsDidCase {
  call: { content: string; url: string; posted_at: number; asset_symbol: string | null };
  event: { tx_hash: string; usd_value: number; occurred_at: number };
  gapHours: number;
}

export interface SaidVsDid {
  wallet: string | null;
  attribution: string | null;
  cases: SaidVsDidCase[];
  // Extra field beyond the brief's minimal shape: total wallet_events on file
  // for this influencer, so the empty state can cite "N wallet events checked"
  // instead of a bare "no contradictions" (numbers/citations only, no adjectives).
  walletEventsChecked: number;
}

export interface Integrity {
  deletedTotal: number;
  deletedScored: number;
  deletedAvgRetPct: number;
  deletedHiddenLoss: number;
}

export interface Dossier {
  handle: string;
  stats: ReturnType<typeof dossierStats>;
  integrity: Integrity;
  insights: CreatorInsights;
  calls: DossierCall[];
  saidVsDid: SaidVsDid;
}

// Marks semantics (Task 6): per call, kind 'entry' = token entry price,
// kind 'live' = latest token price. The ETH benchmark reuses kind 'd1'/'d7'
// but must be disambiguated by source ('eth_entry'/'eth_latest'), not kind.
export function buildDossier(handle: string): Dossier | null {
  const db = getDb();

  const influencer = db
    .prepare("SELECT id, handle, wallet_address FROM influencers WHERE handle = ?")
    .get(handle) as { id: number; handle: string; wallet_address: string | null } | undefined;
  if (!influencer) return null;

  const callRows = db
    .prepare(
      `SELECT p.id as post_id, p.content, p.url, p.posted_at, p.deleted_at,
              c.id as call_id, c.template, c.asset_symbol, c.direction, c.expiry_at, c.confidence, c.status,
              MAX(a.chat_id) as chat_id
       FROM posts p
       JOIN calls c ON c.post_id = p.id
       LEFT JOIN artifacts a ON a.call_id = c.id
       WHERE p.influencer_id = ?
       GROUP BY c.id
       ORDER BY p.posted_at ASC`
    )
    .all(influencer.id) as CallRow[];

  const markRows = db
    .prepare(
      `SELECT m.call_id, m.kind, m.price_usd, m.source
       FROM marks m
       JOIN calls c ON c.id = m.call_id
       JOIN posts p ON p.id = c.post_id
       WHERE p.influencer_id = ?`
    )
    .all(influencer.id) as MarkRow[];

  const marksByCall = new Map<
    number,
    { entry?: number; live?: number; ethEntry?: number; ethLatest?: number }
  >();
  for (const m of markRows) {
    const rec = marksByCall.get(m.call_id) ?? {};
    if (m.kind === "entry") rec.entry = m.price_usd;
    else if (m.kind === "live") rec.live = m.price_usd;
    else if (m.source === "eth_entry") rec.ethEntry = m.price_usd;
    else if (m.source === "eth_latest") rec.ethLatest = m.price_usd;
    marksByCall.set(m.call_id, rec);
  }

  const scorableCalls: {
    direction: "long" | "short";
    entry: number;
    latest: number;
    settled: boolean;
  }[] = [];
  const ethPairs: ({ entry: number; latest: number } | undefined)[] = [];

  // Integrity accounting: deleting a call never removes it from the P&L (you
  // can't delete your way out), and here we ALSO tally deletions explicitly so
  // the dossier can show "deleted N calls, avg X%, $Y of losses hidden".
  let deletedTotal = 0; // any deleted call (scored or not)
  let deletedScored = 0; // deleted calls that carry a P&L
  let deletedRetSum = 0; // sum of retPct over deleted+scored (for the average)
  let deletedHiddenLoss = 0; // sum of NEGATIVE pnl among deleted+scored (losses hidden)

  const calls: DossierCall[] = callRows.map((r) => {
    const marks = marksByCall.get(r.call_id);
    const scoreable =
      (r.status === "open" || r.status === "settled") &&
      marks?.entry != null &&
      marks?.live != null &&
      r.direction != null;

    let retPct: number | null = null;
    let pnlUsd: number | null = null;
    let ethPnlUsd: number | null = null;

    if (r.deleted_at != null) deletedTotal++;

    if (scoreable) {
      const entry = marks!.entry!;
      const live = marks!.live!;
      const direction = r.direction!;
      const scored = callPnl(entry, live, direction);
      retPct = scored.retPct;
      pnlUsd = scored.pnlUsd;

      scorableCalls.push({ direction, entry, latest: live, settled: r.status === "settled" });

      if (r.deleted_at != null) {
        deletedScored++;
        deletedRetSum += scored.retPct;
        if (scored.pnlUsd < 0) deletedHiddenLoss += scored.pnlUsd;
      }

      if (marks!.ethEntry != null && marks!.ethLatest != null) {
        const ethEntry = marks!.ethEntry;
        const ethLatest = marks!.ethLatest;
        ethPnlUsd = Math.round((NOTIONAL * (ethLatest - ethEntry)) / ethEntry);
        ethPairs.push({ entry: ethEntry, latest: ethLatest });
      } else {
        ethPairs.push(undefined);
      }
    }

    return {
      id: r.call_id,
      content: r.content,
      url: r.url,
      posted_at: r.posted_at,
      template: r.template,
      asset_symbol: r.asset_symbol,
      direction: r.direction,
      expiry_at: r.expiry_at,
      confidence: r.confidence,
      entry: marks?.entry ?? null,
      latest: marks?.live ?? null,
      retPct,
      pnlUsd,
      ethPnlUsd,
      status: r.status,
      deleted_at: r.deleted_at,
      chat_id: r.chat_id,
    };
  });

  // dossierStats pairs `calls[i]` with `eth[i]` positionally; `ethPairs` is
  // built in lockstep with `scorableCalls` above, with `undefined` holes
  // where a call has no priced ETH benchmark (dossierStats already guards
  // on `if (e)` before using an entry).
  const stats = dossierStats(scorableCalls, ethPairs as { entry: number; latest: number }[]);

  const saidVsDid = buildSaidVsDid(db, influencer.id, influencer.wallet_address);

  const integrity = {
    deletedTotal,
    deletedScored,
    deletedAvgRetPct: deletedScored ? Math.round((deletedRetSum / deletedScored) * 100) / 100 : 0,
    deletedHiddenLoss, // negative USD they deleted after the fact
  };

  const insights = computeInsights(
    calls.map((c) => ({
      asset_symbol: c.asset_symbol,
      direction: c.direction,
      retPct: c.retPct,
      url: c.url,
      posted_at: c.posted_at,
      deleted_at: c.deleted_at,
    })),
    // distinct CALLS contradicted (a call can match several wallet sells)
    new Set(saidVsDid.cases.map((c) => c.call.url)).size
  );

  return { handle: influencer.handle, stats, integrity, insights, calls, saidVsDid };
}

interface ContradictionRow {
  content: string;
  url: string;
  posted_at: number;
  asset_symbol: string | null;
  tx_hash: string;
  usd_value: number;
  occurred_at: number;
  gap_hours: number;
}

function buildSaidVsDid(
  db: ReturnType<typeof getDb>,
  influencerId: number,
  wallet: string | null
): SaidVsDid {
  const attributionRow = db
    .prepare("SELECT note FROM wallet_attributions WHERE influencer_id = ?")
    .get(influencerId) as { note: string } | undefined;

  const walletEventsChecked = (
    db
      .prepare("SELECT COUNT(*) as n FROM wallet_events WHERE influencer_id = ?")
      .get(influencerId) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT p.content, p.url, p.posted_at, c.asset_symbol,
              we.tx_hash, we.usd_value, we.occurred_at,
              ct.gap_hours
       FROM contradictions ct
       JOIN calls c ON c.id = ct.call_id
       JOIN posts p ON p.id = c.post_id
       JOIN wallet_events we ON we.id = ct.wallet_event_id
       WHERE p.influencer_id = ?
       ORDER BY p.posted_at ASC`
    )
    .all(influencerId) as ContradictionRow[];

  const cases: SaidVsDidCase[] = rows.map((r) => ({
    call: {
      content: r.content,
      url: r.url,
      posted_at: r.posted_at,
      asset_symbol: r.asset_symbol,
    },
    event: {
      tx_hash: r.tx_hash,
      usd_value: r.usd_value,
      occurred_at: r.occurred_at,
    },
    gapHours: r.gap_hours,
  }));

  return {
    wallet,
    attribution: attributionRow?.note ?? null,
    cases,
    walletEventsChecked,
  };
}
