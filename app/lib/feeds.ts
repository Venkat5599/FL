// FTSOv2 feed identifiers.
//
// A feed id is not an opaque handle — it is a structured bytes21 value that can be
// derived from the feed name, which is why this module computes ids instead of shipping
// a lookup table that would drift out of date:
//
//   byte 0        category  (0x01 = crypto)
//   bytes 1..n    the feed name in UTF-8, e.g. "XRP/USD"
//   bytes n+1..20 zero padding to 21 bytes
//
// Derivation reproduces every id published in Flare's feed table exactly (verified
// against FLR/USD, XRP/USD, BTC/USD, ETH/USD, DOGE/USD, ADA/USD and ALGO/USD — see
// tests/feeds.test.ts), so the encoder is checked against real data rather than trusted.

/// Feed category prefixes. Only crypto is used today; the others are listed because the
/// byte is meaningless without knowing what else it could be.
export const FEED_CATEGORY = {
  crypto: 0x01,
  forex: 0x02,
  commodity: 0x03,
  stock: 0x04,
} as const;

export type FeedCategory = keyof typeof FEED_CATEGORY;

const FEED_ID_BYTES = 21;

/// A bytes21 FTSOv2 feed id, as a 0x-prefixed 42-hex-character string.
export type FeedId = `0x${string}`;

export class FeedNameTooLongError extends Error {
  constructor(name: string) {
    super(`Feed name "${name}" does not fit in ${FEED_ID_BYTES - 1} bytes`);
    this.name = "FeedNameTooLongError";
  }
}

/// Encode a feed name (e.g. "XRP/USD") into its bytes21 id.
///
/// Pure and dependency-free so it can be unit-tested without a chain, and so that a
/// wrong id is caught by a test rather than by a silent zero price in production.
export function encodeFeedId(name: string, category: FeedCategory = "crypto"): FeedId {
  const body = new TextEncoder().encode(name);
  if (body.length > FEED_ID_BYTES - 1) throw new FeedNameTooLongError(name);

  const bytes = new Uint8Array(FEED_ID_BYTES); // zero-filled, which is the padding
  bytes[0] = FEED_CATEGORY[category];
  bytes.set(body, 1);

  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `0x${hex}`;
}

/// The feed name a call's asset symbol prices against.
///
/// Every FTSOv2 crypto feed quotes in USD, so this is always `SYMBOL/USD`. Symbols are
/// uppercased because the classifier emits bare tickers whose case is not guaranteed.
export function feedNameForSymbol(symbol: string): string {
  return `${symbol.trim().toUpperCase()}/USD`;
}

/// Resolve an asset symbol straight to a feed id, without checking it exists.
///
/// Deliberately separate from `resolveFeed` below: this is the pure encoding step, and
/// existence is a question only the chain can answer.
export function feedIdForSymbol(symbol: string): FeedId {
  return encodeFeedId(feedNameForSymbol(symbol));
}

/// Feeds confirmed present in Flare's published feed table.
///
/// This is a convenience floor, NOT the authority. FTSOv2 carries far more feeds than
/// these, and the set changes over time, so anything relying on completeness must call
/// `getSupportedFeedIds()` on-chain (see lib/ftso.ts `loadSupportedSymbols`). Hardcoding
/// a full list here would guarantee it goes stale and start mispricing calls silently.
export const KNOWN_FEED_SYMBOLS: readonly string[] = ["FLR", "XRP", "BTC", "ETH", "DOGE", "ADA", "ALGO"] as const;

/// Decode a feed id back to its name. Used to turn the chain's `getSupportedFeedIds()`
/// response into a symbol set the app can match calls against.
export function decodeFeedId(feedId: string): { category: number; name: string } | null {
  const hex = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
  if (hex.length !== FEED_ID_BYTES * 2 || !/^[0-9a-fA-F]+$/.test(hex)) return null;

  const bytes = new Uint8Array(FEED_ID_BYTES);
  for (let i = 0; i < FEED_ID_BYTES; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);

  // Trailing zeros are padding, not content, so trim them before decoding — otherwise
  // every name comes back with a tail of NUL characters that never compares equal.
  let end = bytes.length;
  while (end > 1 && bytes[end - 1] === 0) end--;

  return { category: bytes[0], name: new TextDecoder().decode(bytes.slice(1, end)) };
}

/// The symbol a feed id prices, or null if it is not a `SYMBOL/USD` crypto feed.
export function symbolFromFeedId(feedId: string): string | null {
  const decoded = decodeFeedId(feedId);
  if (!decoded || decoded.category !== FEED_CATEGORY.crypto) return null;
  const [symbol, quote] = decoded.name.split("/");
  if (!symbol || quote !== "USD") return null;
  return symbol;
}
