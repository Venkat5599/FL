# KOLlateral - submission answers

## Short description (max 100 characters)

The accountability layer for crypto influencers: build a verifiable record, back the real traders.

## Description

Crypto influencers operate with almost no accountability. They post hundreds of "calls" a week, delete the ones that lose, and there is no shared record of whether following them ever made money. KOLlateral fixes both sides of that with one thing: a public, verifiable track record.

For a caller who is actually good, that record is an asset they own. Every explicit call they make in public becomes a structured signal (asset, direction, target, confidence) and gets priced against real DEX history, so their edge shows up as numbers they can point to: what following them returned versus just holding ETH. Losing calls are archived and flagged in red instead of disappearing. Each call is checked against the caller's own on-chain wallet, so "said accumulate, sold four hours later" is a contradiction with a transaction hash attached. And every score is produced by AI inference running inside a verifiable enclave, so the record holds up even against us.

For everyone else, that record is a filter. A leaderboard surfaces the callers who have genuinely earned trust rather than the loudest ones, and each influencer gets a dossier with the equity curve of every call they have made. A browser extension puts that filter where the judging actually happens: open a caller's profile on X and a card drops in with their real P&L, contradiction rate, and TEE-verified call count, right next to the tweets you're trying to evaluate. Once you find someone real, you ride along: copy their calls, or fade the ones who keep getting it wrong, in one click, executed on-chain from a self-custody wallet.

## How it's made

The app is Next.js on the App Router with a dither/halftone theme, and it keeps state in a libSQL database (a local SQLite file in development, hosted Turso in production), so the whole pipeline runs from one process: reading an influencer's public calls, classifying them, pricing them, and executing trades. Because Turso is shared and persistent, the deployed site and a local live indexer read and write the same database.

The AI that reads and judges every call runs on 0G Compute, and that inference is the part we cannot fake. Each post goes to 0G's OpenAI-compatible router with `verify_tee` turned on and a private trust-mode header, so the model executes inside a TDX secure enclave and the router hands back an attestation that this exact inference ran on the stated model, untouched. That is the core claim of the product: a caller's verdict is genuinely the model's output, not a number we typed in, and no one, including us, could edit the reasoning between their tweet and the score. The same verifiable inference powers 0-yap mode, which distills a rambling post down to its bias, a one-line thesis, and the price levels.

The Graph is the live on-chain data all of that scoring reasons over. We query the Uniswap v2 and v3 subgraphs through the gateway (v3 first, v2 as a fallback) for two things the product cannot work without: pricing every call at its exact posted timestamp, so a claim turns into a real return, and pulling a caller's own swap history to run the said-versus-did check. The forensic layer takes each call the AI extracted and matches it against what that wallet actually did on-chain, so a contradiction is grounded in live Subgraph data rather than a static snapshot.

Execution is Uniswap. On Base mainnet we use the hosted Trading API. Base Sepolia is where it got hacky: the Trading API does not index that chain, so we located the deployed WETH/USDC v3 pools on-chain and call SwapRouter02 directly, quoting in USDC and then decoding the ERC-20 Transfer out of the swap receipt so the portfolio records the real fill instead of a nominal number. Wallets and signing are Privy: each user gets an embedded self-custody wallet and delegates a session signer once, after which every Follow or Fade executes server-side with no popup.

There is also a Chrome/MV3 browser extension that carries the record onto X itself. It's a content script, no server of its own, that reads a CORS-open `/api/creator/[handle]` endpoint on the deployed app, same Turso-backed data, and injects a card into any profile page with that creator's P&L, signal and score counts, contradiction rate, and TEE-verified count, styled to match X's Default, Dim, and Lights-out themes.

---

# Prize applications

Code links point at `github.com/RomarioKavin1/kollateral` (app lives under `app/`); push `main` before submitting so the line numbers resolve.

## The Graph - $15,000

**Why we're applicable:** The Graph is KOLlateral's live source of on-chain data. An AI and forensic layer reads the Uniswap v2 and v3 subgraphs to price every influencer call at its exact posted timestamp and to pull each caller's own swap history, then reasons over that live data to score their record and flag said-versus-did contradictions. Nothing is mocked, and without the subgraphs there is no price and no wallet check.

**Line of code:**
- Pricing, v3 then v2 fallback: https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/subgraph.ts#L41
- Wallet swap history for the said-versus-did check: https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/subgraph.ts#L114
- Gateway endpoint (by subgraph id): https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/subgraph.ts#L14
- Consumed by the scoring layer: https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/graph.ts#L17

**Ease of use (1-10):** 8

**Additional feedback:** The gateway plus API key plus subgraph-by-id flow was clean and fast to wire up, and the Explorer made finding the right Uniswap subgraph ids easy. The friction was historical pricing: getting a token's price at a specific past timestamp meant querying hourly/daily buckets and choosing the nearest one per subgraph, and reconciling v3 (hourly) with v2 (daily) granularity in our own code. A standardized "price at timestamp" query, or a shared price schema across AMMs, would remove most of that glue.

## Uniswap Foundation - $10,000

**Why we're applicable:** Uniswap is what turns a verdict into a position. The AI scores an influencer's record, and Uniswap is the layer that lets you copy the honest callers or fade the rest in a single tap, so KOLlateral is an execution loop driven by AI signals rather than a scoreboard with a swap bolted on. We integrated it two ways for real coverage: the hosted Trading API (quote then swap) for routing on Base mainnet, and, because that API does not index Base Sepolia, direct `SwapRouter02.exactInputSingle` calls against the live WETH/USDC v3 pools on testnet, with the true output amount decoded from the swap receipt so both paths settle as genuine fills. Paired with Privy delegated signing it behaves like an agent acting on a signal: authorize once, and every Follow or Fade after that executes on-chain with no prompt.

**Line of code:**
- Trading API quote + swap (mainnet): https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/execute.ts#L119
- Trading API behind the manual swap ticket: https://github.com/RomarioKavin1/kollateral/blob/main/app/api/quote/route.ts#L5
- Direct SwapRouter02 exactInputSingle + receipt decode (testnet): https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/onchain-swap.ts#L130

**Ease of use (1-10):** 6

**Additional feedback:** The Trading API is clean where it is supported: one /quote, then /swap, and you have calldata. The blocker was Base Sepolia. The API returns "no route" / ResourceNotFound for pairs whose v3 pools are actually deployed and liquid on-chain (we confirmed WETH/USDC across all fee tiers via the factory), so we had to bypass it and call SwapRouter02 ourselves for testnet. Either index testnet pools or state plainly in the docs that the Trading API is mainnet-only, so teams do not lose hours assuming their request shape is wrong. Surfacing whether a quote is UniswapX versus a plain on-chain route would also help.

## 0G - $15,000

**Why we're applicable:** The AI that classifies every post into a structured trade signal, and the 0-yap distillation, both run on 0G Compute with `verify_tee` enabled, so each inference executes in a TEE and returns an attestation. That verifiable inference is the product's core claim: a caller's score is provably the model's output and was not edited by anyone, including us.

**Line of code:**
- `verify_tee` on classification: https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/zg.ts#L164
- `verify_tee` on the 0-yap distillation: https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/zg.ts#L250
- Private trust-mode header (pins a TEE provider): https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/zg.ts#L33
- Provider attestation from the 0G registry (independent evidence): https://github.com/RomarioKavin1/kollateral/blob/main/app/lib/zg.ts#L109

**Ease of use (1-10):** 6

**Additional feedback:** The OpenAI-compatible router is the best part: existing OpenAI SDK code worked after only a base-URL and key change. Two things cost us time. First, `verify_tee` and the `X-0G-Provider-Trust-Mode: private` header are what actually produce an attested result, but they were hard to find in the docs; we landed on them by trial. Second, the broker SDK's `processResponse` could not verify router-served responses (the router returns a request id, not an EIP-191 signature to recover), so the broker verification path and the router `verify_tee` path diverge and it was unclear which to trust. Clearer docs on `verify_tee` and trust-mode, plus a list of which models are TEE-verifiable and support function calling (some 404, some reject tools), would help a lot.

## Which other partners' technologies did you use?

**Privy** for embedded self-custody wallets and delegated session-signer signing, so a user enables auto-trading once and every Follow/Fade after that executes with no per-trade popup. **Base** (Base mainnet and Base Sepolia) as the execution chain.
