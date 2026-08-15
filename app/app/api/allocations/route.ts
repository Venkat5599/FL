import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyUser } from "@/lib/auth";

const DEFAULT_QUICK_USD = 1;

// GET → the user's global quick-trade amount + every per-creator override.
export async function GET(req: Request) {
  const user = verifyUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();

  const row = db.prepare("SELECT quick_trade_usd FROM users WHERE id=?").get(user.userId) as { quick_trade_usd: number | null } | undefined;
  const globalQuickUsd = row?.quick_trade_usd ?? DEFAULT_QUICK_USD;

  const overrides = db
    .prepare(
      `SELECT a.id, i.handle, i.display_name AS displayName, a.mode, a.cap_value AS quickUsd, a.active
       FROM allocations a JOIN influencers i ON i.id = a.influencer_id
       WHERE a.user_id = ? AND a.active = 1 ORDER BY a.created_at DESC`
    )
    .all(user.userId);

  return NextResponse.json({ globalQuickUsd, overrides });
}

interface AllocBody {
  global?: number; // set the global quick-trade amount
  handle?: string; // set / remove a per-creator override
  quickUsd?: number;
  mode?: "copy" | "fade";
  remove?: boolean;
}

// POST → set the global amount OR upsert / remove a per-creator override.
export async function POST(req: Request) {
  const user = verifyUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as AllocBody;
  const db = getDb();

  // 1) Global quick-trade amount.
  if (typeof b.global === "number") {
    if (!(b.global > 0) || b.global > 1_000_000) {
      return NextResponse.json({ error: "global must be a positive USD amount" }, { status: 400 });
    }
    db.prepare("UPDATE users SET quick_trade_usd=? WHERE id=?").run(Math.round(b.global * 100) / 100, user.userId);
    return NextResponse.json({ ok: true, globalQuickUsd: Math.round(b.global * 100) / 100 });
  }

  // 2) Per-creator override (create / update / remove).
  if (!b.handle) return NextResponse.json({ error: "handle required" }, { status: 400 });
  const handle = b.handle.trim().replace(/^@/, "");
  const inf = db.prepare("SELECT id FROM influencers WHERE handle=?").get(handle) as { id: number } | undefined;
  if (!inf) return NextResponse.json({ error: "unknown creator" }, { status: 404 });

  if (b.remove) {
    db.prepare("UPDATE allocations SET active=0 WHERE user_id=? AND influencer_id=?").run(user.userId, inf.id);
    return NextResponse.json({ ok: true, removed: handle });
  }

  if (typeof b.quickUsd !== "number" || !(b.quickUsd > 0)) {
    return NextResponse.json({ error: "quickUsd must be a positive USD amount" }, { status: 400 });
  }
  const mode = b.mode === "fade" ? "fade" : "copy";
  const amt = Math.round(b.quickUsd * 100) / 100;

  db.prepare(
    `INSERT INTO allocations (user_id, influencer_id, mode, cap_type, cap_value, active, created_at)
     VALUES (?,?,?,?,?,1,?)
     ON CONFLICT(user_id, influencer_id)
     DO UPDATE SET mode=excluded.mode, cap_value=excluded.cap_value, active=1`
  ).run(user.userId, inf.id, mode, "fixed_usd", amt, Math.floor(Date.now() / 1000));

  return NextResponse.json({ ok: true, handle, quickUsd: amt, mode });
}
