// Server-side session auth for TAPE, built on a wallet signature.
//
// This replaces the Privy JWT path and the DEMO-ONLY `x-wallet-address` header that sat
// beside it. That header was never authentication — anyone could send any address and
// read that user's rows — and it survived only because it was fenced behind an env var.
// It is gone. The server now believes exactly one thing: a signature, produced by the
// wallet it claims to come from, over a nonce this server issued minutes ago.
//
// The flow, and why each piece exists:
//
//   1. GET  /api/auth/nonce   issues a random nonce and puts it in an httpOnly cookie,
//                             signed so it cannot be forged or extended.
//   2. Browser builds the EIP-4361 message with that nonce and has the wallet sign it.
//   3. POST /api/auth/verify  rebuilds the message, checks the signature against the
//                             claimed address, and swaps the nonce for a session cookie.
//
// The nonce lives in a cookie rather than a server-side store on purpose: this app runs
// serverless, where an in-memory Map is per-instance and would reject a perfectly valid
// login whenever the verify request landed on a different lambda than the nonce request.
// A signed cookie is stateless, so it works on one box or fifty.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyMessage } from "viem";

import { getDb } from "./db";
import { buildSiweMessage, parseSiweMessage } from "./siwe";

export const SESSION_COOKIE = "tape_session";
export const NONCE_COOKIE = "tape_nonce";

/// Sessions last a week; a nonce lasts long enough to read a wallet prompt and no longer.
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;
const NONCE_TTL_SEC = 10 * 60;

/**
 * The key everything is signed with.
 *
 * Throws rather than falling back to a constant. A hardcoded development default is the
 * classic way a forgeable session token reaches production: it works everywhere, so
 * nobody notices it was never replaced, and anyone who has read the source can mint a
 * session for any address.
 */
function secret(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "AUTH_SECRET is missing or too short (need >= 32 chars). Generate one with: openssl rand -hex 32",
    );
  }
  return Buffer.from(s, "utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Compare MACs without leaking where they diverge. */
function macEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Wrap a value with an expiry and a MAC: `<value>.<expiresAt>.<mac>`.
 *
 * The expiry is inside the signed payload, so a client that edits it invalidates the MAC
 * rather than extending its own session.
 */
function seal(value: string, ttlSec: number): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSec;
  const body = `${value}.${expiresAt}`;
  return `${body}.${sign(body)}`;
}

function unseal(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [value, expiresAt, mac] = parts;

  if (!macEquals(mac, sign(`${value}.${expiresAt}`))) return null;
  if (Number(expiresAt) < Math.floor(Date.now() / 1000)) return null;

  return value;
}

export function issueNonce(): { nonce: string; cookieValue: string } {
  const nonce = randomBytes(16).toString("hex");
  return { nonce, cookieValue: seal(nonce, NONCE_TTL_SEC) };
}

export function sessionCookieFor(address: string): string {
  return seal(address.toLowerCase(), SESSION_TTL_SEC);
}

/// Cookie attributes shared by both cookies. `sameSite: lax` still covers the top-level
/// navigation case while blocking the cross-site POST a CSRF attempt would need.
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export const SESSION_MAX_AGE = SESSION_TTL_SEC;
export const NONCE_MAX_AGE = NONCE_TTL_SEC;

export interface AppUser {
  /** Our DB id. */
  userId: number;
  /** Lowercased checksum-insensitive wallet address — the identity itself. */
  address: string;
}

export class SiweVerificationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SiweVerificationError";
  }
}

/**
 * Check a signed SIWE message against the nonce this server issued.
 *
 * Every check here is load-bearing, so none of them are folded together:
 *  - the message must parse (a malformed one cannot be reasoned about at all)
 *  - its nonce must equal the sealed one from the cookie (blocks replay of an old
 *    signature, and blocks a signature harvested from another site)
 *  - the re-derived message must match the one presented (blocks a signature over
 *    different text than the fields claim)
 *  - the signature must verify against the claimed address (the actual proof)
 */
export async function verifySiwe(
  message: string,
  signature: `0x${string}`,
  nonceCookie: string | undefined,
): Promise<string> {
  const fields = parseSiweMessage(message);
  if (!fields) throw new SiweVerificationError("malformed sign-in message");

  const expectedNonce = unseal(nonceCookie);
  if (!expectedNonce) throw new SiweVerificationError("sign-in request expired — try again");
  if (fields.nonce !== expectedNonce) throw new SiweVerificationError("nonce mismatch");

  // Rebuild from the parsed fields and require an exact match. Without this a caller
  // could append text after the signed portion and have it treated as part of the
  // message the user approved.
  if (buildSiweMessage(fields) !== message) {
    throw new SiweVerificationError("message does not match its own fields");
  }

  const valid = await verifyMessage({ address: fields.address, message, signature });
  if (!valid) throw new SiweVerificationError("signature does not match the claimed address");

  return fields.address.toLowerCase();
}

/**
 * Read the session cookie and resolve the user, creating their row on first sign-in.
 *
 * Returns null when unauthenticated. Every allocation / portfolio / trade route gates
 * on this.
 */
export function verifyUser(req: Request): AppUser | null {
  const address = unseal(readCookie(req, SESSION_COOKIE));
  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) return null;
  return upsertUserByWallet(address);
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

/**
 * Find or create the app user row for a wallet address.
 *
 * `privy_user_id` is retained as the column name because it is `UNIQUE NOT NULL` in the
 * committed schema and in every seeded demo database — renaming it would orphan those
 * rows for no functional gain. It now holds `wallet:<address>` and is simply the subject
 * identifier. The comment exists so the next reader does not conclude Privy is still
 * wired up somewhere.
 */
export function upsertUserByWallet(address: string): AppUser {
  const db = getDb();
  const subject = `wallet:${address}`;

  const existing = db.prepare("SELECT id FROM users WHERE privy_user_id = ?").get(subject) as
    | { id: number }
    | undefined;
  if (existing) return { userId: existing.id, address };

  const now = Math.floor(Date.now() / 1000);
  const res = db
    .prepare("INSERT INTO users (privy_user_id, wallet_address, delegated, created_at) VALUES (?,?,?,?)")
    .run(subject, address, 0, now);

  return { userId: Number(res.lastInsertRowid), address };
}
