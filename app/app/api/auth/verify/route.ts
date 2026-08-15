import { NextResponse } from "next/server";
import {
  NONCE_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  SiweVerificationError,
  cookieOptions,
  readCookie,
  sessionCookieFor,
  upsertUserByWallet,
  verifySiwe,
} from "@/lib/auth";

/**
 * Exchange a signed SIWE message for a session. POST /api/auth/verify
 *
 * Body: { message, signature }
 *
 * On success the nonce cookie is cleared in the same response that sets the session, so
 * a nonce can never be spent twice even if the same signature is replayed a second
 * later.
 *
 * Failures are reported with their reason but always as 401. Distinguishing "bad
 * signature" from "expired nonce" with different status codes gives a prober a free
 * oracle for very little user benefit — the message text is enough for a real user to
 * know to press the button again.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    signature?: string;
  };

  if (typeof body.message !== "string" || typeof body.signature !== "string") {
    return NextResponse.json({ error: "message and signature are required" }, { status: 400 });
  }

  let address: string;
  try {
    address = await verifySiwe(
      body.message,
      body.signature as `0x${string}`,
      readCookie(req, NONCE_COOKIE),
    );
  } catch (e) {
    const reason = e instanceof SiweVerificationError ? e.message : "sign-in failed";
    return NextResponse.json({ error: reason }, { status: 401 });
  }

  const user = upsertUserByWallet(address);

  const res = NextResponse.json({ address, userId: user.userId });
  res.cookies.set(SESSION_COOKIE, sessionCookieFor(address), cookieOptions(SESSION_MAX_AGE));
  res.cookies.set(NONCE_COOKIE, "", cookieOptions(0));
  return res;
}
