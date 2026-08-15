import { NextResponse } from "next/server";
import { SESSION_COOKIE, cookieOptions, verifyUser } from "@/lib/auth";

/**
 * Who am I? GET /api/auth/session
 *
 * The client cannot read the session cookie (it is httpOnly, which is the point), so it
 * asks. Returns `{ address: null }` rather than 401 for a signed-out visitor: not being
 * signed in is a normal state for this endpoint, and making it an error means every
 * caller has to special-case a failure that is not one.
 */
export async function GET(req: Request) {
  const user = verifyUser(req);
  return NextResponse.json(
    { address: user?.address ?? null, userId: user?.userId ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Sign out. DELETE /api/auth/session
 *
 * Clears the cookie server-side. The wallet stays connected — disconnecting it is the
 * user's business and happens in the wallet, not here.
 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return res;
}
