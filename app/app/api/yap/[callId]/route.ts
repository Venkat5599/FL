import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { classify } from "@/lib/classify";

/**
 * 0-YAP — strip a post down to its trade logic. GET /api/yap/[callId]
 *
 * Ported from the 0G implementation, and the port made this materially better rather
 * than merely different.
 *
 * Before: a hosted LLM call per post, costing money and latency, returning prose that
 * could differ between two runs on the same text. Now: the same deterministic classifier
 * the TEE runs (lib/classify.ts mirrors the enclave source, enforced by
 * tests/classify-parity.test.ts). Same input, same output, forever, with no network hop.
 *
 * The cache remains, but its role has changed. It is no longer avoiding an expensive
 * external call — classification is now microseconds — it is preserving the verdict that
 * was shown at a point in time, so a rendered dossier and the tape agree.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const id = Number(callId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad call id" }, { status: 400 });

  const db = getDb();

  const cached = db
    .prepare("SELECT bias, thesis, levels_json, tee_verified FROM yap_signals WHERE call_id = ?")
    .get(id) as { bias: string; thesis: string; levels_json: string; tee_verified: number | null } | undefined;
  if (cached) {
    return NextResponse.json({
      bias: cached.bias,
      thesis: cached.thesis,
      levels: safeParse(cached.levels_json),
      teeVerified: cached.tee_verified === null ? null : cached.tee_verified === 1,
      cached: true,
    });
  }

  const call = db
    .prepare("SELECT p.content FROM calls c JOIN posts p ON p.id = c.post_id WHERE c.id = ?")
    .get(id) as { content: string } | undefined;
  if (!call) return NextResponse.json({ error: "call not found" }, { status: 404 });

  const signal = classify(call.content);
  if (signal.template === "NOT_A_SIGNAL") {
    return NextResponse.json({ error: "no_signal" }, { status: 200 });
  }

  const bias = signal.direction ?? "neutral";
  const thesis = buildThesis(signal.assetSymbol, signal.direction, signal.expiryDays);
  const levels = extractLevels(call.content);

  db.prepare(
    "INSERT OR REPLACE INTO yap_signals (call_id, bias, thesis, levels_json, tee_verified, created_at) VALUES (?,?,?,?,?,?)",
  ).run(
    id,
    bias,
    thesis,
    JSON.stringify(levels),
    // null, not false: this is the local preview, not the enclave's signed verdict.
    // Claiming `false` would read as "the TEE checked and rejected it", which is a
    // different and much stronger statement than "the TEE has not been asked yet".
    null,
    Math.floor(Date.now() / 1000),
  );

  return NextResponse.json({ bias, thesis, levels, teeVerified: null, cached: false });
}

/**
 * One line of trade logic, assembled from the structured signal rather than generated.
 *
 * Deliberately mechanical. The old version asked a model for "a one-line thesis" and got
 * something readable but unfalsifiable; this says only what the classifier actually
 * determined, so there is nothing in the output that is not backed by a parsed field.
 */
function buildThesis(symbol: string | null, direction: string | null, expiryDays: number | null): string {
  if (!symbol || !direction) return "No tradeable signal — commentary only.";
  const horizon = expiryDays ? ` over ${expiryDays}d` : "";
  return `${direction === "long" ? "Long" : "Short"} ${symbol}${horizon}.`;
}

/** Price levels stated in the post, as written. Extraction only — nothing inferred. */
function extractLevels(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)) {
    const level = `$${m[1]}`;
    if (!out.includes(level)) out.push(level);
    if (out.length >= 5) break;
  }
  return out;
}

function safeParse(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
