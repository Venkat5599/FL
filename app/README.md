# GigaBags

Forensic accountability and copy/fade trading for crypto influencers ("finfluencers"). Built for ETHGlobal Lisbon 2026 (0G, Uniswap, The Graph tracks).

## The problem

Crypto influencers make public trading calls, then quietly delete the ones that go wrong. There is no unified way to see a caller's real track record, no way to check whether their own wallet actually did what they told followers to do, and no vetted way to trade with (or against) them.

GigaBags reads an influencer's public X/Twitter calls, classifies each one into a structured trade signal via verifiable AI inference on 0G Compute, prices and backtests it against real on-chain market data from The Graph, cross-references the influencer's own wallet for "said vs. did" contradictions, and lets a user copy the honest ones or fade the rest with one-click on-chain trades on Base.

## Key features

- **Forensic dossiers** (`/k/[handle]`): every call an influencer made, backtested against holding ETH over the same window, priced from Uniswap v2/v3 subgraph data on The Graph.
- **Said-vs-Did contradictions**: matches an influencer's public calls against their own on-chain wallet swaps (via the Uniswap v3 subgraph) to surface cases where they told followers to buy while they themselves sold.
- **Deleted-call detection**: flags and re-verifies posts that have disappeared from X after the fact, so a call can't quietly vanish from the record (`/api/report-deleted`, `scripts/recheck-deletions.ts`).
- **TEE-verified inference**: every classification runs on 0G Compute with `verify_tee: true`, pinned to a TEE-backed ("private") provider. Results are independently checkable via on-chain provider attestation and EIP-191 signature recovery (`/api/verify/[callId]`, `lib/verify.ts`).
- **0-yap mode**: an 0G-distilled "pure signal" view that strips an influencer's storytelling, hype, and self-promotion down to bias, one-line thesis, and price levels, served from a cache and backed by the same verifiable inference path.
- **One-click copy/fade trading**: copy mirrors a creator's direction, fade inverts it, executed on-chain from a Privy self-custody embedded wallet with no wallet popups once delegated.
- **Quick trade amounts**: a global default trade size plus per-creator overrides via allocations (fixed USD or percent-of-balance caps).
- **Portfolio analytics**: trade history, P&L, and network/chain context per executed trade (`/portfolio`).
- **Leaderboard** (`/leaderboard`): influencers ranked by reliability, "most damning" contradictions, and two-faced (said-vs-did) behavior.

## Sponsor integrations

**0G Compute**: All post classification and 0-yap distillation runs as verifiable inference against the 0G router (`lib/zg.ts`), pinned to a TEE-backed provider (`X-0G-Provider-Trust-Mode: private`) with `verify_tee: true` on every call. The router performs on-chain TEE signature verification and returns the result inline; `lib/verify.ts` additionally does an independent, cost-free re-check by reading the provider's on-chain attestation record and recovering the EIP-191 signature itself, so the "verified" badge isn't just GigaBags's word. Runs on 0G mainnet.

**The Graph**: Pricing and wallet forensics are built entirely on The Graph's decentralized network (`lib/subgraph.ts`), composing the Uniswap v3 subgraph (hourly USD-native prices, preferred) with the Uniswap v2 subgraph as a fallback for tokens with only v2 liquidity. The same v3 subgraph's `swaps` data powers Said-vs-Did: querying an influencer's wallet for its own on-chain sells to compare against what they publicly called.

**Uniswap**: Execution layer. On Base Sepolia (testnet) the hosted Uniswap Trading API does not index the chain, so trades go directly on-chain against the deployed SwapRouter02 contract via the WETH/USDC v3 pool (`lib/onchain-swap.ts`). On Base mainnet, execution goes through the hosted Uniswap Trading API (`lib/execute.ts`, `/api/quote`).

**Privy**: Self-custody embedded wallets with delegated signing, so a user's copy/fade trades can execute server-side with no wallet popup once delegated (`lib/privy.ts`).

**Base**: The execution chain: Base Sepolia for testnet trades, Base mainnet for live trades (`lib/networks.ts`).

## Tech stack

- **Next.js 16** (App Router). This project pins a pre-release/breaking-change build of Next.js; see [Development notes](#development-notes) before editing framework-adjacent code.
- **TypeScript**, **React 19**
- **libSQL / Turso**: a local SQLite file in development, hosted Turso in production, so the deployed site and a local live indexer share one persistent database (`lib/db.ts`, `lib/schema.sql`)
- **wagmi** / **viem** / **ethers**: on-chain reads and transaction encoding
- **Privy** (`@privy-io/react-auth`, `@privy-io/server-auth`): embedded wallets and delegated signing
- **@0gfoundation/0g-compute-ts-sdk** + **openai** SDK (pointed at the 0G router): verifiable AI inference
- **recharts**: dossier and portfolio charts
- **Tailwind CSS v4**
- **Vitest**: unit tests (`tests/`)

## Getting started

### Prerequisites

- Node.js (a version compatible with Next.js 16 / React 19)
- npm

### Install

```bash
npm install
```

### Environment variables

Create a `.env` file in the project root. None of the values below are checked into the repo; only the names are documented here.

| Variable | Purpose |
|---|---|
| `DB_PATH` | Path to the local SQLite database file (defaults to `./gigabags.db`); used when the Turso vars are unset |
| `TURSO_DATABASE_URL` | Hosted Turso database URL; when set, the app and scripts read/write this shared database instead of the local file |
| `TURSO_AUTH_TOKEN` | Auth token for the Turso database |
| `ZG_API_KEY` | API key for the 0G Compute router |
| `ZG_BASE_URL` | 0G router base URL (defaults to the mainnet router) |
| `ZG_MODEL` | Model id used for classification/distillation (defaults to DeepSeek-V3.1) |
| `ZG_CONF_THRESHOLD` | Confidence threshold for treating a classification as a real signal |
| `ZG_RPC` | 0G chain RPC URL used for independent TEE signature verification |
| `NEXT_PUBLIC_ZG_EXPLORER` | 0G explorer base URL used for client-side links |
| `GRAPH_STUDIO_KEY` | The Graph gateway API key, used to query the Uniswap v2/v3 subgraphs |
| `UNISWAP_API_KEY` | Uniswap Trading API key, used for Base mainnet quotes/swaps |
| `BASE_SEPOLIA_RPC` | Base Sepolia RPC URL for direct on-chain swap execution |
| `PRIVY_APP_ID` / `NEXT_PUBLIC_PRIVY_APP_ID` | Privy application id (server and client) |
| `PRIVY_APP_SECRET` | Privy server-side application secret |
| `PRIVY_AUTH_KEY` / `PRIVY_AUTH_KEY_2` | Privy authorization private key(s) used for delegated server-side wallet signing |
| `NEXT_PUBLIC_PRIVY_AUTH_ID_2` | Privy authorization key id used by the client to authorize delegation |

### Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Other scripts: `npm run build`, `npm run start`, `npm run lint`, `npm run test` (Vitest).

### Seed / demo data

A committed SQLite snapshot at `seed/demo.db` lets the app render real data on clone with no API keys, built from live sources (see `seed/README.md`): a currently active caller scraped and classified live, plus a Said-vs-Did centerpiece built from a real, publicly attributed wallet and its real on-chain sells. Point `DB_PATH` at `seed/demo.db` (or copy it to the project root as `gigabags.db`) to run against it.

### The data pipeline

Data flows through a small set of scripts, each run with `node --env-file=.env --import tsx scripts/<name>.ts`:

1. **`scripts/scrape-x.ts <handle> [limit] [outFile]`**: scrapes an influencer's public X timeline (GraphQL, no external deps) and writes it to a JSON archive file.
2. **`scripts/import-archive.ts`**: ingests a scraped/exported JSON archive into the `posts` table, normalizing field names across different scraper export shapes.
3. **`scripts/run-pipeline.ts`**: classifies every unclassified post via 0G Compute (`lib/zg.ts`) into a trade `call`, then prices it against on-chain data.
4. **`scripts/distill-yap.ts`**: pre-warms the 0-yap cache by distilling every non-ambiguous call through 0G once, so the terminal's 0-yap toggle is instant.
5. **`scripts/sync-wallet.ts`**: fetches an influencer's real on-chain wallet swaps (via The Graph) and runs Said-vs-Did contradiction detection against their calls.
6. **`scripts/poll.ts`**: a loop that re-runs the classification/pricing pipeline over whatever has already been imported for a tracked handle list (does not itself scrape; scraping is a separate, human-run step).
7. **`scripts/recheck-deletions.ts`**: given a list of X post ids a human has confirmed are deleted, stamps `deleted_at` on those posts.
8. **`scripts/watch-copy.ts`**: the copy/fade automation watcher: for every active allocation, plans and executes new trades for calls the user hasn't traded yet.
9. **`scripts/seed-lark.ts`**: seeds the curated-real Said-vs-Did demo case (see `seed/README.md`).

## How it works

```
scrape X (public calls)
  -> classify via 0G Compute (TEE-verified inference)
  -> price / backtest via The Graph (Uniswap v2/v3 subgraphs)
  -> score into a dossier + detect said-vs-did wallet contradictions
  -> user copies/fades a call -> execute on-chain (Base, via Privy delegated signing)
```

### Main pages

- `/`: landing page.
- `/terminal`: live feed of classified calls across tracked influencers, with one-click copy/fade.
- `/k/[handle]`: an influencer's forensic dossier: backtested calls, said-vs-did contradictions, 0-yap view.
- `/portfolio`: a user's executed copy/fade trade history.
- `/allocations`: per-creator copy/fade mode and trade-size overrides.
- `/leaderboard`: influencers ranked by reliability and contradiction severity.

## Development notes

This project pins a Next.js build with deliberately breaking changes from the version most training data assumes. Before making framework-adjacent changes (routing, config, data fetching conventions), read the relevant guide under `node_modules/next/dist/docs/` and heed any deprecation notices, per `AGENTS.md`.

## Scope and honesty notes

- On testnet, trades execute directly against the Base Sepolia WETH/USDC Uniswap v3 pool. Only `$ETH`/`$WETH` (and `$USDC`) calls have a real pool to trade against on testnet; other tokens correctly report "no pool available" instead of silently failing or faking a fill.
- On mainnet, execution routes through the hosted Uniswap Trading API against Base-native tokens with real liquidity.
- 0G inference runs on the 0G mainnet router by default and is independently verifiable: TEE-backed (TeeML) providers return a per-response signature that `lib/verify.ts` checks against the provider's on-chain-attested signer. TeeTLS-only providers (e.g. free testnet models) expose no per-response signature, so verification honestly reports "unavailable" rather than fabricating a result.
