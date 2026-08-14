import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Terminal feed: N most recent calls across all influencers, newest first.
// Polled client-side to give a live-feeling ticker without websockets. Each
// row carries the creator identity (avatar + name), the original tweet, the
// AI's structured inference, and a summary of the 0G TEE proof so the feed can
// render a Twitter-style card with a verifiable-inference badge inline.
// High enough to surface every indexed call across all tracked creators (the
// terminal filters to signals client-side, and its stat counts are derived
// from what the feed returns — a low cap here starves both). Ordered
// newest-first, so this is a "most recent N" window, not a hard total.
const LIMIT = 500;

interface FeedRow {
  call_id: number;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  content: string;
  url: string;
  template: string;
  asset_symbol: string | null;
  direction: "long" | "short" | null;
  expiry_at: number | null;
  confidence: number;
  status: string;
  posted_at: number;
  deleted_at: number | null;
  latest_price: number | null;
  response_json: string | null;
  artifact_provider: string | null;
  chat_id: string | null;
  verified: number | null;
  tee_signature: string | null;
  yap_bias: string | null;
  yap_thesis: string | null;
  yap_levels: string | null;
  yap_tee: number | null;
}

export interface FeedYap {
  bias: "long" | "short" | "neutral";
  thesis: string;
  levels: string[];
  teeVerified: boolean | null;
}

export interface FeedAiProof {
  model: string | null;
  provider: string | null;
  chatId: string | null;
  requestId: string | null;
  verified: boolean;
  hasSignature: boolean;
  aiTemplate: string | null;
  aiConfidence: number | null;
  costA0gi: string | null;
}

export interface FeedCall {
  call_id: number;
  handle: string;
  display_name: string | null;
  avatar_url: string;
  content: string;
  url: string;
  template: string;
  asset_symbol: string | null;
  direction: "long" | "short" | null;
  expiry_at: number | null;
  confidence: number;
  status: string;
  posted_at: number;
  deleted_at: number | null;
  latest_price: number | null;
  ai: FeedAiProof | null;
  yap: FeedYap | null; // 0G-distilled pure signal (0-yap mode); null until distilled
}

// Parse the 0G Compute response envelope for the model, the AI's tool-call
// classification, and the on-chain trace (provider + request id + cost).
function parseAi(row: FeedRow): FeedAiProof | null {
  if (!row.response_json && !row.artifact_provider) return null;
  let model: string | null = null;
  let aiTemplate: string | null = null;
  let aiConfidence: number | null = null;
  let requestId: string | null = null;
  let provider: string | null = row.artifact_provider;
  let costA0gi: string | null = null;
  try {
    const r = JSON.parse(row.response_json ?? "{}");
    model = r.model ?? null;
    const args = r?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (args) {
      const parsed = JSON.parse(args);
      aiTemplate = parsed.template ?? null;
      aiConfidence = typeof parsed.confidence === "number" ? parsed.confidence : null;
    }
    const trace = r.x_0g_trace;
    if (trace) {
      provider = provider ?? trace.provider ?? null;
      requestId = trace.request_id ?? null;
      if (trace.billing?.total_cost) costA0gi = String(trace.billing.total_cost);
    }
  } catch {
    /* malformed artifact: still expose provider/verified below */
  }
  // Only a real EIP-191 signature (0x + 65 bytes) counts. The testnet TeeTLS
  // provider stores a routing-proof placeholder, not a verifiable signature, so
  // we must not present it as "TEE-signed".
  const hasSignature = /^0x[0-9a-fA-F]{130}$/.test(row.tee_signature ?? "");

  return {
    model,
    provider,
    chatId: row.chat_id,
    requestId,
    verified: row.verified === 1,
    hasSignature,
    aiTemplate,
    aiConfidence,
    costA0gi,
  };
}

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id as call_id, i.handle as handle, i.display_name as display_name, i.avatar_url as avatar_url,
              p.content as content, p.url as url,
              c.template as template, c.asset_symbol as asset_symbol, c.direction as direction,
              c.expiry_at as expiry_at, c.confidence as confidence, c.status as status,
              p.posted_at as posted_at, p.deleted_at as deleted_at,
              (SELECT m.price_usd FROM marks m
                WHERE m.call_id = c.id AND m.kind = 'live'
                ORDER BY m.marked_at DESC LIMIT 1) as latest_price,
              a.response_json as response_json, a.provider_address as artifact_provider,
              a.chat_id as chat_id, a.verified as verified, a.tee_signature as tee_signature,
              y.bias as yap_bias, y.thesis as yap_thesis, y.levels_json as yap_levels, y.tee_verified as yap_tee
       FROM calls c
       JOIN posts p ON p.id = c.post_id
       JOIN influencers i ON i.id = p.influencer_id
       LEFT JOIN artifacts a ON a.call_id = c.id
       LEFT JOIN yap_signals y ON y.call_id = c.id
       ORDER BY p.posted_at DESC
       LIMIT ?`
    )
    .all(LIMIT) as FeedRow[];

  const calls: FeedCall[] = rows.map((row) => ({
    call_id: row.call_id,
    handle: row.handle,
    display_name: row.display_name,
    // real X avatar by handle (unavatar proxies Twitter/X); client falls back
    // to a monogram on load error. A stored avatar_url wins when present.
    avatar_url: row.avatar_url || `https://unavatar.io/twitter/${row.handle}`,
    content: row.content,
    url: row.url,
    template: row.template,
    asset_symbol: row.asset_symbol,
    direction: row.direction,
    expiry_at: row.expiry_at,
    confidence: row.confidence,
    status: row.status,
    posted_at: row.posted_at,
    deleted_at: row.deleted_at,
    latest_price: row.latest_price,
    ai: parseAi(row),
    yap: row.yap_thesis
      ? {
          bias: row.yap_bias === "long" || row.yap_bias === "short" ? row.yap_bias : "neutral",
          thesis: row.yap_thesis,
          levels: parseLevels(row.yap_levels),
          teeVerified: row.yap_tee === null ? null : row.yap_tee === 1,
        }
      : null,
  }));

  return NextResponse.json({ calls });
}

function parseLevels(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
