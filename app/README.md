# TAPE — app

Forensic accountability and copy/fade trading for crypto callers, built on Flare. This is the Next.js application; contracts live in `../contracts`, the confidential-compute extension in `../tee`.

## The problem

Crypto influencers make public trading calls, then quietly delete the ones that go wrong. There is no unified way to see a caller's real track record, and no vetted way to trade with — or against — them.

TAPE reads a caller's public X posts, proves each one existed via the Flare Data Connector, classifies it into a structured trade signal, marks it against FTSOv2 at entry and settlement, and lets a user copy the callers who earn it or fade the ones who don't, settled in FXRP.

## Key features

- **Forensic dossiers** (`/k/[handle]`): every call a caller made, with its entry and settle marks and realised P&L.
- **Deleted-call detection**: flags and re-verifies posts that have disappeared from X after the fact, so a call can't quietly vanish from the record (`/api/report-deleted`, `scripts/recheck-deletions.ts`).
- **Evidence chain** (`/api/verify/[callId]`): reports each link separately — FDC attestation, TEE verdict, FTSO mark — rather than collapsing them into one "verified" badge.
- **On-chain marks** (`/api/mark`): sends a feed id and nothing else; `FeedMarkLog` reads FTSOv2 *inside* the transaction, so neither the server nor the caller picks the number.
- **One-click copy/fade**: copy mirrors a caller's direction, fade inverts it. Every position is signed by the user's own wallet — there is no delegated server-side signer.
- **Quick trade amounts**: a global default position size plus per-creator overrides (`/allocations`).
- **Portfolio analytics**: position history and realised P&L from real oracle marks (`/portfolio`).
- **Leaderboard** (`/leaderboard`): callers ranked by reliability rather than reach.

## How the protocols carry it

| Claim | Guaranteed by |
|---|---|
| "He posted this, then deleted it" | **FDC** — Merkle proof against a signed voting round |
| "This is what it meant as a trade" | **FCC** — classifier running in an attested TEE |
| "This score can't be gamed" | **FCC** — ranking weights never leave the enclave |
| "This is what the price was" | **FTSOv2** — on-chain marks, oracle-timestamped |
| "You can act on it with XRP" | **FAssets / FXRP** |

**Auth** is Sign-In-With-Ethereum (EIP-4361). Connecting a wallet is not signing in: the server issues a nonce, the wallet signs it, and only then is a session cookie minted (`lib/auth.ts`, `lib/siwe.ts`, `lib/useAuth.ts`). Every allocation, portfolio and trade route gates on that session.

## Tech stack

- **Next.js 16** (App Router). This project pins a pre-release/breaking-change build; see [Development notes](#development-notes) before editing framework-adjacent code.
- **TypeScript**, **React 19**
- **libSQL / Turso**: a local SQLite file in development, hosted Turso in production, so the deployed site and a local live indexer share one persistent database (`lib/db.ts`, `lib/schema.sql`)
- **wagmi** / **viem** / **ethers**: on-chain reads and transaction encoding
- **recharts**: dossier and portfolio charts
- **Tailwind CSS v4**
- **Vitest**: unit tests (`tests/`)

## Getting started

### Prerequisites

- Node.js 18+ or Bun
- A browser wallet (MetaMask) on Coston2

### Install

```bash
bun install
```

### Environment variables

Create a `.env.local` in this directory. None of the values are checked into the repo; only the names are documented here.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_FLARE_NETWORK` | `coston2` \| `songbird` \| `flare` (defaults to `coston2`) |
| `NEXT_PUBLIC_POST_REGISTRY_ADDRESS` | deployed `PostRegistry` |
| `NEXT_PUBLIC_CALL_TAPE_ADDRESS` | deployed `CallTape` |
| `NEXT_PUBLIC_MARK_LOG_ADDRESS` | deployed `FeedMarkLog` |
| `AUTH_SECRET` | HMAC key for session and nonce cookies. **Required**, minimum 32 chars — the app throws rather than falling back to a default. Generate with `openssl rand -hex 32` |
| `MARK_SIGNER_PRIVATE_KEY` | funded Coston2 key used by `/api/mark` to write an FTSOv2 mark on-chain |
| `FLARE_RPC_URL` | override the default RPC for the active network |
| `DB_PATH` | path to the local SQLite file (defaults to `./tape.db`); used when the Turso vars are unset |
| `TURSO_DATABASE_URL` | hosted Turso URL; when set, app and scripts share this database instead of the local file |
| `TURSO_AUTH_TOKEN` | auth token for the Turso database |
| `X_BEARER_TOKEN` | server-side only, for the read proxy FDC attests. **Never** placed in an FDC request body — see the Security section of the root README |
| `auth_token` | burner X cookie used by `scripts/scrape-x.ts` to pull a caller's timeline |
| `TAPE_CONF_THRESHOLD` | confidence floor for treating a classification as a real signal (default `0.7`) |
| `LIVE_HANDLES` / `LIVE_INTERVAL_MS` / `LIVE_LIMIT` | live indexer configuration (see below) |

### Run the dev server

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

Other scripts: `bun run build`, `bun run start`, `bun run lint`, `bun run test` (Vitest), `bun run build:extension`.

### Seed / demo data

A committed SQLite snapshot at `seed/demo.db` lets the app render real data on clone with no API keys (see `seed/README.md`). Point `DB_PATH` at it, or copy it to this directory as `tape.db`.

### The data pipeline

Each script runs with `node --env-file=.env.local --import tsx scripts/<name>.ts`:

1. **`scrape-x.ts <handle> [limit] [outFile]`** — scrapes a caller's public X timeline (GraphQL, no external deps) into a JSON archive. Needs the `auth_token` cookie.
2. **`import-archive.ts`** — ingests a scraped archive into `posts`, normalising field names across export shapes. Idempotent.
3. **`run-pipeline.ts <handle>`** — classifies every unclassified post into a `call` via the deterministic classifier in `lib/classify.ts`, then takes an FTSOv2 mark for it.
4. **`live-index.ts`** — the three steps above on a loop, for the handles in `LIVE_HANDLES`. Run it alongside `bun run dev` to see fresh calls appear.
5. **`poll.ts`** — re-runs classification and pricing over already-imported posts only; it does not scrape.
6. **`attest-post.ts`** — submits an FDC Web2Json attestation for a post and records it in `PostRegistry`.
7. **`recheck-deletions.ts`** — stamps `deleted_at` on posts confirmed gone from X.
8. **`watch-copy.ts`** — for every active allocation, plans and opens positions for calls the user hasn't traded yet.
9. **`seed-lark.ts`**, **`seed-positions.ts`** — seed the demo dossier and demo positions.
10. **`push-to-turso.ts`** — copies the local database up to hosted Turso.

### How it works

```
a post on X
  └─ FDC Web2Json ──────► proven to exist, at that time, with that text
       └─ FCC (TEE) ─────► classified into a trade signal, under sealed weights
            └─ FTSOv2 ───► marked at entry, marked at settlement
                 └─ FXRP ► you copy it, or fade it
```

### Main pages

- `/` — landing page.
- `/terminal` — live feed of classified calls across tracked callers, with one-click copy/fade.
- `/k/[handle]` — a caller's forensic dossier.
- `/portfolio` — the signed-in user's position history.
- `/allocations` — per-creator copy/fade mode and position-size overrides.
- `/leaderboard` — callers ranked by reliability.
- `/extension` — install guide for the browser extension that puts the record on X itself.

## Development notes

This project pins a Next.js build with deliberately breaking changes from the version most training data assumes. Before making framework-adjacent changes (routing, config, data fetching conventions), read the relevant guide under `node_modules/next/dist/docs/` and heed any deprecation notices, per `AGENTS.md`.

## Scope and honesty notes

- **FTSOv2 is a spot oracle with no history.** It cannot answer "what was this worth when he posted?". Marks are therefore recorded *forward* — `CallTape` takes one at open and one at settle — and every call stores `entryLagSecs`, the gap between publication and its mark, so a late-marked call can be discounted rather than presented as contemporaneous. Backfilled demo calls carry seed marks and are labelled as such.
- **FTSOv2 covers majors only.** The long-tail tickers callers post about have no feed, so those calls are recorded `unpriceable` instead of being priced against the wrong thing.
- **Said-vs-Did is not implemented on Flare.** The pre-Flare version read a caller's own swaps from an indexed DEX; Flare has no equivalent index, so `swapsForWallet` returns an empty array and a caller is reported as having no contradictions rather than being penalised for something the chain cannot evidence (`lib/graph.ts`).
- **Positions are directional FXRP allocations marked against a feed**, not DEX swaps. Coston2 has no deep liquidity for these assets, and faking a fill that cannot settle would be worse than not having one (`lib/execute.ts`).
- **Scraping X and confirming deletions are human-run steps**, not automated background jobs against the platform.
