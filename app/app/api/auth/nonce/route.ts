import { NextResponse } from "next/server";
import { NONCE_MAX_AGE, NONCE_COOKIE, cookieOptions, issueNonce } from "@/lib/auth";

/**
 * Issue a single-use nonce for a sign-in attempt. GET /api/auth/nonce
 *
 * The nonce goes back two ways: in the body, so the browser can put it in the message it
 * asks the wallet to sign, and in an httpOnly cookie, sealed with the server's key, so
 * the verify step can tell whether it issued that nonce itself. The client never gets to
 * choose it — a caller-supplied nonce would let someone replay a signature they captured
 * elsewhere.
 *
 * `no-store` because a cached nonce is a reused nonce.
 */
export async function GET() {
  const { nonce, cookieValue } = issueNonce();

  const res = NextResponse.json({ nonce }, { headers: { "cache-control": "no-store" } });
  res.cookies.set(NONCE_COOKIE, cookieValue, cookieOptions(NONCE_MAX_AGE));
  return res;
}
