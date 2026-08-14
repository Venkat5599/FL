import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDossier } from "@/lib/dossier";

// Compact per-creator analytics for the browser extension (and any external
// caller). CORS-open so a content script on x.com can read it directly.
// GET /api/creator/[handle]
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(_req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await params;
  const handle = raw.replace(/^@/, "").trim();
  const db = getDb();

  const inf = db
    .prepare("SELECT id, handle, display_name FROM influencers WHERE handle = ? COLLATE NOCASE")
    .get(handle) as { id: number; handle: string; display_name: string | null } | undefined;

  if (!inf) {
    return NextResponse.json({ found: false, handle }, { status: 200, headers: CORS });
  }

  const dossier = buildDossier(inf.handle);
  const settled = dossier?.stats.settled ?? 0;
  const totalPnl = dossier?.stats.totalPnl ?? 0;
  const callCount = dossier?.calls.filter((c) => c.retPct != null).length ?? 0;
  // Same $1,000-per-call return vs actual formula as the leaderboard.
  const headlinePct = Math.round((10000 * totalPnl) / (1000 * Math.max(settled, 1))) / 100;
  const contradictionRate = dossier?.insights.contradictionRate ?? 0;
  const recent = (dossier?.calls ?? []).filter((c) => !c.deleted_at).sort((a, b) => b.posted_at - a.posted_at)[0] ?? null;

  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN c.template != 'AMBIGUOUS' THEN 1 ELSE 0 END) AS signals
       FROM calls c JOIN posts p ON p.id = c.post_id WHERE p.influencer_id = ?`
    )
    .get(inf.id) as { total: number; signals: number | null };
  const verified = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM artifacts a
         JOIN calls c ON c.id = a.call_id JOIN posts p ON p.id = c.post_id
         WHERE p.influencer_id = ? AND a.verified = 1`
      )
      .get(inf.id) as { n: number }
  ).n;

  return NextResponse.json(
    {
      found: true,
      handle: inf.handle,
      displayName: inf.display_name,
      headlinePct,
      callCount,
      signalCount: counts.signals ?? 0,
      totalCalls: counts.total ?? 0,
      contradictionRate,
      verified,
      latest: recent
        ? { content: recent.content, asset: recent.asset_symbol, direction: recent.direction, retPct: recent.retPct }
        : null,
    },
    { headers: CORS },
  );
}
