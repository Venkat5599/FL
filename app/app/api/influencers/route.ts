import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDossier } from "@/lib/dossier";

// Trending list for the home page: every influencer in the DB with a
// headline P&L % and a scored-call count. Reuses buildDossier per handle
// (same scoring logic as the dossier page) rather than duplicating the
// P&L math in raw SQL — fine at hackathon/demo scale.
export interface InfluencerLatestCall {
  content: string;
  asset: string | null;
  direction: "long" | "short" | null;
  retPct: number | null;
  postedAt: number;
}

export interface InfluencerSummary {
  handle: string;
  display_name: string | null;
  headlinePct: number;
  callCount: number;
  contradictionRate: number;
  latest: InfluencerLatestCall | null;
}

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare("SELECT handle, display_name FROM influencers ORDER BY handle")
    .all() as { handle: string; display_name: string | null }[];

  const result: InfluencerSummary[] = rows.map(({ handle, display_name }) => {
    const dossier = buildDossier(handle);
    const settled = dossier?.stats.settled ?? 0;
    const totalPnl = dossier?.stats.totalPnl ?? 0;
    const callCount = dossier?.calls.filter((c) => c.retPct != null).length ?? 0;
    // Same formula as VerdictBlock: $1,000-per-call return vs actual.
    const headlinePct =
      Math.round((10000 * totalPnl) / (1000 * Math.max(settled, 1))) / 100;
    const contradictionRate = dossier?.insights.contradictionRate ?? 0;

    // Newest non-deleted call, for the social-feed post preview.
    const recent = (dossier?.calls ?? [])
      .filter((c) => !c.deleted_at)
      .sort((a, b) => b.posted_at - a.posted_at)[0];
    const latest: InfluencerLatestCall | null = recent
      ? {
          content: recent.content,
          asset: recent.asset_symbol,
          direction: recent.direction,
          retPct: recent.retPct,
          postedAt: recent.posted_at,
        }
      : null;

    return { handle, display_name, headlinePct, callCount, contradictionRate, latest };
  });

  // "Trending" = most scored calls first, best headline % as tiebreak.
  result.sort((a, b) => b.callCount - a.callCount || b.headlinePct - a.headlinePct);

  return NextResponse.json(result);
}
