# KOLlateral

**The accountability layer for crypto influencers: build a verifiable record, back the real traders.**

Live app: **https://kollateral.vercel.app** · Browser extension: **https://github.com/RomarioKavin1/kollateral-extension**

Built for ETHGlobal Lisbon 2026 (0G, The Graph, Uniswap Foundation).

---

## What it is

Crypto influencers post hundreds of "calls" a week, delete the ones that lose, and leave no shared record of whether following them ever made money. KOLlateral fixes both sides of that with one thing: a public, verifiable track record.

For a caller who is actually good, the record is an asset they own. Every explicit call becomes a structured signal (asset, direction, target, confidence), gets priced against real DEX history, and shows up as numbers they can point to. Losing calls are archived and flagged in red instead of disappearing, and each call is checked against the caller's own on-chain wallet, so "said accumulate, sold four hours later" becomes a contradiction with a transaction hash attached.

For everyone else, the record is a filter. A leaderboard surfaces the callers who earned trust rather than the loudest ones, each influencer gets a dossier with the equity curve of every call, and a browser extension drops that record onto X itself. Once you find someone real, you copy their calls or fade the ones who keep getting it wrong, in one click, executed on-chain from a self-custody wallet.

Every score is produced by AI inference running inside a verifiable TEE, so the record holds up even against us.

## How it flows

```
read a caller's public X calls
  -> classify each into a structured trade signal   (0G Compute, TEE-verified inference)
  -> price and backtest it against on-chain history  (The Graph: Uniswap v2/v3 subgraphs)
  -> score into a dossier + flag said-vs-did wallet contradictions
  -> user copies or fades a call
  -> execute the swap on Base                         (Uniswap, via Privy delegated signing)
```

---

## Sponsor integrations, with the exact contracts and code

Every integration below runs against live infrastructure. Nothing is mocked. Code links point at [`github.com/RomarioKavin1/kollateral`](https://github.com/RomarioKavin1/kollateral); the Next.js app lives under `app/`.

### Uniswap (execution)

Uniswap is what turns a verdict into a position. We integrated it two ways so both networks settle as genuine fills.

| What | Address / endpoint | Network |
|---|---|---|
| SwapRouter02 (direct `exactInputSingle`) | [`0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`](https://sepolia.basescan.org/address/0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4) | Base Sepolia |
| WETH (swap leg) | `0x4200000000000000000000000000000000000006` | Base (both) |
| USDC (quote asset, testnet WETH/USDC pool) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Base Sepolia |
| USDC (Base mainnet) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Base mainnet |
| Hosted Trading API | `https://trade-api.gateway.uniswap.org/v1` | Base mainnet |

- **Direct SwapRouter02 path (testnet).** The hosted Trading API does not index Base Sepolia, so we located the deployed WETH/USDC v3 pool on-chain and call `SwapRouter02.exactInputSingle` ourselves, then decode the ERC-20 `Transfer` out of the receipt to record the real output amount.
  - Router address: [`app/lib/onchain-swap.ts#L22`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/onchain-swap.ts#L22)
  - `exactInputSingle` call: [`app/lib/onchain-swap.ts#L130`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/onchain-swap.ts#L130)
  - Receipt decode for the true fill: [`app/lib/onchain-swap.ts#L146`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/onchain-swap.ts#L146)
- **Hosted Trading API path (mainnet).** Quote, then swap.
  - Quote + swap: [`app/lib/execute.ts#L119`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/execute.ts#L119)
  - Server-side quote route (keeps the API key off the client): [`app/api/quote/route.ts#L5`](https://github.com/RomarioKavin1/kollateral/blob/main/app/api/quote/route.ts#L5)

Full write-up and honest developer notes: [`FEEDBACK.md`](./FEEDBACK.md).

### The Graph (live on-chain data)

The Graph is the live data every score reasons over. We query the Uniswap v3 subgraph first and fall back to v2, for two things the product cannot work without: pricing each call at its exact posted timestamp, and pulling a caller's own swap history to run the said-vs-did check.

- Gateway endpoint (subgraph by id): [`app/lib/subgraph.ts#L14`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/subgraph.ts#L14)
- v3 price at timestamp: [`app/lib/subgraph.ts#L41`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/subgraph.ts#L41)
- v2 fallback price: [`app/lib/subgraph.ts#L56`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/subgraph.ts#L56)
- Wallet swap history for said-vs-did: [`app/lib/subgraph.ts`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/subgraph.ts)

### 0G Compute (verifiable inference)

The AI that reads and judges every call runs on 0G Compute, and that inference is the part we cannot fake. Each post goes to 0G's OpenAI-compatible router with `verify_tee` on and a private trust-mode header, so the model runs inside a TDX enclave and the router returns an attestation that this exact inference ran, untouched. `lib/verify.ts` does an independent, cost-free re-check by reading the provider's on-chain attestation and recovering the EIP-191 signature, so the "verified" badge is not just our word.

- `verify_tee` on classification: [`app/lib/zg.ts#L164`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/zg.ts#L164)
- `verify_tee` on 0-yap distillation: [`app/lib/zg.ts#L250`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/zg.ts#L250)
- Private trust-mode header: [`app/lib/zg.ts#L33`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/zg.ts#L33)
- Independent attestation re-check: [`app/lib/verify.ts`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/verify.ts)

### Privy and Base

- **Privy** gives each user an embedded self-custody wallet and a delegated session signer, so once auto-trading is enabled, every Follow or Fade executes server-side with no popup: [`app/lib/privy.ts`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/privy.ts).
- **Base** is the execution chain: Base Sepolia for testnet, Base mainnet for live trades: [`app/lib/networks.ts`](https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/networks.ts).

---

## The browser extension

A separate repo carries the record onto X itself: **[github.com/RomarioKavin1/kollateral-extension](https://github.com/RomarioKavin1/kollateral-extension)**.

It is a Manifest V3 content script with no backend of its own. It reads a CORS-open `/api/creator/[handle]` endpoint on the deployed app (the same Turso-backed data) and injects a card into any X profile with that creator's headline P&L, signal and scored-call counts, contradiction rate, TEE-verified count, and a link to the full dossier. The card styles itself to match X's Default, Dim, and Lights-out themes.

Install guide, screenshots, and a one-click download live at [kollateral.vercel.app/extension](https://kollateral.vercel.app/extension). No build step: clone, open `chrome://extensions`, enable Developer mode, Load unpacked.

---

## Repository layout

```
kollateral/
├── app/                    Next.js 16 App Router application (see app/README.md for full dev docs)
│   ├── app/                routes + API handlers
│   ├── lib/                integrations: zg.ts (0G), subgraph.ts (Graph), onchain-swap.ts + execute.ts (Uniswap), privy.ts, networks.ts, db.ts
│   ├── scripts/            the indexing pipeline (read calls, classify, price, sync wallets, watch copy/fade)
│   ├── seed/               committed SQLite snapshot so the app renders real data on clone
│   └── docs/SUBMISSION.md  ETHGlobal submission answers and per-prize applications
├── FEEDBACK.md             Uniswap developer feedback (canonical, linked from the Uniswap form)
└── README.md
```

The extension ships from its own repository so it can be installed independently.

## Run it locally

```bash
cd app
npm install
npm run dev        # http://localhost:3000
```

The committed `app/seed/demo.db` lets the app render real dossiers, contradictions, and a live-scraped caller on clone, with no API keys. Full environment variables, the data pipeline, and per-page docs are in **[`app/README.md`](./app/README.md)**.

## Data and honesty notes

- On testnet, trades hit the real Base Sepolia WETH/USDC Uniswap v3 pool. Only `$ETH`/`$WETH` and `$USDC` calls have a pool to trade against there, so other tokens report "no pool available on this network" the instant you click, instead of faking a fill.
- On mainnet, execution routes through the hosted Uniswap Trading API against Base-native tokens with real liquidity.
- 0G inference runs on the 0G mainnet router and is independently verifiable. TEE-backed providers return a per-response signature that `lib/verify.ts` checks against the provider's on-chain-attested signer. Providers that expose no per-response signature are reported as "verification unavailable" rather than shown as verified.
- Scraping X and confirming deletions are human-run steps, not automated background jobs against the platform.

## Tech stack

Next.js 16 (App Router, a pre-release build with breaking changes, see `app/AGENTS.md`), TypeScript, React 19, libSQL (a local SQLite file in development, hosted Turso in production), viem and wagmi for on-chain reads and encoding, Privy for wallets and delegated signing, the 0G Compute SDK and the OpenAI SDK pointed at the 0G router, Tailwind CSS v4. Deployed on Vercel.
