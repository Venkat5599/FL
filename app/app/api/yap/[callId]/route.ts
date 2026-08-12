import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { distillSignal } from "@/lib/zg";

// 0-YAP: return the 0G-distilled pure trade signal for a call. Served from the
// yap_signals cache when present; otherwise runs the distillation through the
// 0G router (verify_tee) once and caches it. GET /api/yap/[callId]
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

  let pure;
  try {
    pure = await distillSignal(call.content);
  } catch (e) {
    return NextResponse.json({ error: "distill_failed", detail: (e as Error).message?.slice(0, 160) }, { status: 502 });
  }
  if (!pure) return NextResponse.json({ error: "no_signal" }, { status: 200 });

  db.prepare(
    "INSERT OR REPLACE INTO yap_signals (call_id, bias, thesis, levels_json, tee_verified, created_at) VALUES (?,?,?,?,?,?)"
  ).run(id, pure.bias, pure.thesis, JSON.stringify(pure.levels), pure.teeVerified === null ? null : pure.teeVerified ? 1 : 0, Math.floor(Date.now() / 1000));

  return NextResponse.json({ ...pure, cached: false });
}

function safeParse(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
