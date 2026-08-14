import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tweetExists } from "@/scripts/scrape-x";

// On-demand deletion check: a user reports a call's tweet as deleted, and we
// VERIFY it against X before marking it (never trust the report blindly). This
// is cheaper than a cron over every stored tweet — we only check what's flagged.
// POST { callId } → { deleted: boolean, alreadyDeleted?, verified }.
export async function POST(req: Request) {
  try {
    const { callId } = (await req.json()) as { callId?: number };
    if (callId == null) {
      return NextResponse.json({ error: "callId required" }, { status: 400 });
    }
    const db = getDb();
    const row = db
      .prepare(
        `SELECT p.id AS post_id, p.x_post_id, p.deleted_at
         FROM calls c JOIN posts p ON p.id = c.post_id WHERE c.id = ?`
      )
      .get(callId) as { post_id: number; x_post_id: string; deleted_at: number | null } | undefined;

    if (!row) return NextResponse.json({ error: "call not found" }, { status: 404 });
    if (row.deleted_at != null) {
      return NextResponse.json({ deleted: true, alreadyDeleted: true, verified: true });
    }

    // Verify against X: if the tweet still resolves, the report is rejected.
    const exists = await tweetExists(row.x_post_id);
    if (exists) {
      return NextResponse.json({ deleted: false, verified: true });
    }
    const now = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE posts SET deleted_at=? WHERE id=? AND deleted_at IS NULL").run(now, row.post_id);
    return NextResponse.json({ deleted: true, verified: true });
  } catch (e) {
    // Couldn't reach X / auth issue — do NOT mark deleted on an unverifiable check.
    return NextResponse.json(
      { error: "check_failed", detail: String(e).slice(0, 160) },
      { status: 502 }
    );
  }
}
