CREATE TABLE IF NOT EXISTS influencers (
  id INTEGER PRIMARY KEY, handle TEXT UNIQUE NOT NULL, display_name TEXT,
  wallet_address TEXT, avatar_url TEXT, claimed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY, influencer_id INTEGER NOT NULL REFERENCES influencers(id),
  x_post_id TEXT UNIQUE NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL,
  url TEXT NOT NULL, posted_at INTEGER NOT NULL, deleted_at INTEGER, raw_json TEXT);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY, post_id INTEGER UNIQUE NOT NULL REFERENCES posts(id),
  template TEXT NOT NULL CHECK(template IN ('DIRECTIONAL','TARGET_CALL','GEM_SHILL','AMBIGUOUS')),
  asset_symbol TEXT, asset_address TEXT, chain TEXT DEFAULT 'mainnet',
  direction TEXT CHECK(direction IN ('long','short')), expiry_at INTEGER,
  confidence REAL NOT NULL, status TEXT DEFAULT 'open'
    CHECK(status IN ('open','settled','unpriceable','ambiguous')));
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY, call_id INTEGER NOT NULL REFERENCES calls(id),
  request_json TEXT NOT NULL, response_json TEXT NOT NULL,
  chat_id TEXT, tee_signature TEXT, provider_address TEXT, verified INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS marks (
  id INTEGER PRIMARY KEY, call_id INTEGER NOT NULL REFERENCES calls(id),
  kind TEXT NOT NULL CHECK(kind IN ('entry','d1','d7','d30','settle','live')),
  price_usd REAL NOT NULL, source TEXT NOT NULL, marked_at INTEGER NOT NULL,
  UNIQUE(call_id, kind));
CREATE TABLE IF NOT EXISTS wallet_events (
  id INTEGER PRIMARY KEY, influencer_id INTEGER NOT NULL REFERENCES influencers(id),
  tx_hash TEXT NOT NULL, token_address TEXT NOT NULL, side TEXT CHECK(side IN ('buy','sell')),
  usd_value REAL, occurred_at INTEGER NOT NULL, UNIQUE(tx_hash, token_address, side));
CREATE TABLE IF NOT EXISTS contradictions (
  id INTEGER PRIMARY KEY, call_id INTEGER NOT NULL REFERENCES calls(id),
  wallet_event_id INTEGER NOT NULL REFERENCES wallet_events(id), gap_hours REAL);

-- ---- Copy/Fade platform -------------------------------------------------
-- App users, keyed by the wallet that signed in (SIWE). balance_usd is the
-- balance we track for percent-based allocations; real funds stay in the user wallet.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, privy_user_id TEXT UNIQUE NOT NULL,
  wallet_address TEXT, delegated INTEGER DEFAULT 0, balance_usd REAL DEFAULT 0,
  created_at INTEGER NOT NULL);
-- Per-creator allocation: copy or fade, capped by a fixed USD amount or a
-- percentage of the user's balance. One row per (user, creator).
CREATE TABLE IF NOT EXISTS allocations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  influencer_id INTEGER NOT NULL REFERENCES influencers(id),
  mode TEXT NOT NULL CHECK(mode IN ('copy','fade')),
  cap_type TEXT NOT NULL CHECK(cap_type IN ('fixed_usd','percent')),
  cap_value REAL NOT NULL,
  active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, influencer_id));
-- One executed (or attempted) copy/fade trade, for the portfolio history.
CREATE TABLE IF NOT EXISTS copy_trades (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  allocation_id INTEGER NOT NULL REFERENCES allocations(id),
  call_id INTEGER REFERENCES calls(id),
  creator_handle TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('copy','fade')),
  token_symbol TEXT, token_address TEXT,
  side TEXT NOT NULL CHECK(side IN ('buy','sell')),
  amount_usd REAL NOT NULL,
  entry_price_usd REAL,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','executed','failed','settled')),
  yield_usd REAL DEFAULT 0,
  created_at INTEGER NOT NULL);
