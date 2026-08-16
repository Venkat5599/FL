# TAPE — Flare Summer Signal submission

## Short description (max 100 characters)

The market remembers — a verifiable track record for crypto callers, built on Flare.

## Description

Crypto influencers operate with almost no accountability. They post hundreds of calls a week, delete the ones that lose, and present whatever survives as a track record. Every such record was assembled by the person it flatters — the screenshot, the price, and the score all come from someone with a reason to show you that number. There is no shared, checkable record of whether following anyone ever made money.

TAPE builds the record they cannot edit. A post is proven to exist by the Flare Data Connector, classified into a structured trade signal inside a confidential-compute enclave whose ranking weights are never published, marked at entry and settlement by FTSOv2, and made actionable in FXRP. Deleting a post no longer erases it; editing one surfaces the edit; losing calls stay on the record in red.

For a caller who is genuinely good, that record is an asset they own and can point at. For everyone else it is a filter: a leaderboard that surfaces the callers who earned trust rather than the loudest ones, a dossier per caller, and a browser extension that drops the record onto X itself. Once you find someone real, you copy their calls or fade the ones who keep getting it wrong — signed from your own wallet, settled in FXRP.

## How it's made

The app is Next.js 16 on the App Router with a dither / 1-bit forensic theme, keeping state in libSQL (a local SQLite file in development, hosted Turso in production) so the deployed site and a local live indexer share one persistent database.

Four Solidity contracts are deployed to Coston2. `PostRegistry` verifies an FDC Web2Json Merkle proof on-chain and stores post, author and content digests; re-attesting with different text emits `ContentDiverged` and keeps the original authoritative, so an edit is visible instead of silently rewriting the text a call was scored against. `CallTape` binds a proved post to a TEE verdict, takes an FTSOv2 mark at open and another at settle, and computes P&L — settlement is permissionless, so a losing result cannot be withheld. `TapeInstructionSender` is the FCC entry point. `FeedMarkLog` records FTSOv2 marks forward, permissionlessly.

The confidential-compute idea is the part worth defending: **inputs public and attested, verdict public and signed, function secret.** The ranking weights live inside the enclave and are never published, because a leaderboard with a public formula gets optimised against rather than satisfied. That is a real reason to need a TEE rather than a smart contract.

Pricing is FTSOv2, read through the `FlareContractRegistry` rather than any hardcoded protocol address. The honest consequence, stated plainly because it shapes the whole product: FTSO is a spot oracle with no history, so TAPE cannot reconstruct an entry price after the fact. Marks are recorded *forward*, and every call stores `entryLagSecs` — the gap between publication and its mark — so a late-marked call can be discounted rather than passed off as contemporaneous.

Execution settles in FXRP resolved through `ContractRegistry.getAssetManagerFXRP()`. A position is a directional FXRP allocation marked against a feed, not a DEX swap: Coston2 has no deep liquidity for the long tail of assets callers name, and faking a fill that cannot settle would be worse than not having one. Authentication is Sign-In-With-Ethereum — the server issues a nonce, the wallet signs it, and only then is a session minted. There is no delegated server-side signer; anything that spends a user's capital is signed by that user's own wallet.

## What pre-existed, and what was built for this hackathon

The rules welcome ported projects provided the two are separated. Stated bluntly:

**Pre-existing** (ETHGlobal Lisbon 2026, in `kollateral/`, kept untouched as the exhibit): the product thesis; the Next.js app shell, routing and dither design system; the libSQL schema; the X scraper and archive importer; the dossier, scoring and leaderboard logic; the browser extension shell.

**Newly built for Flare:**
- All four Solidity contracts (`PostRegistry`, `CallTape`, `TapeInstructionSender`, `FeedMarkLog`) and their tests — none existed before.
- The FCC TEE extension: deterministic classifier plus sealed-weight ranking engine (`tee/typescript`).
- The entire Flare data layer: `lib/flare.ts` (registry resolution), `lib/ftso.ts` (FTSOv2 marks), `lib/feeds.ts` (feed-id derivation), `lib/fxrp.ts` (FAssets settlement).
- FDC Web2Json attestation end-to-end, including the read proxy and `scripts/attest-post.ts`.
- SIWE wallet authentication, replacing the previous vendor-wallet path entirely.
- Rewritten execution (`lib/execute.ts`) from DEX swaps to oracle-marked FXRP positions.

**Removed rather than ported:** the previous inference vendor, subgraph pricing, DEX execution and embedded-wallet provider. Each was replaced by a Flare protocol, not wrapped.

## Deployed contracts (Coston2, chain 114)

| Contract | Address |
|---|---|
| `PostRegistry` | `0x7b4b536Ac15bE7E5F43276ea71CCC1e1Be6124b4` |
| `CallTape` | `0xC0309C5dE3f46a20A0f084dF8635d927FD1e22e5` |
| `TapeInstructionSender` | `0x657f0fAfe5AfD5C2cdEa18840bc25fF4eDa35Fe9` |
| `FeedMarkLog` | `0x0b5fC92e207FDeF5B33A2767FBd9C9186B01184A` |

**A transaction anyone can verify.** Pressing *mark XRP/USD on-chain* sends a feed id and nothing else — the contract reads FTSOv2 *inside* the transaction, so neither the server nor the person clicking picks the number:

`0xdcd7dc9458b801d2bf6ede58d8f8cf22dbd051dcaa879294a95c05077cbf8ab0`

```
block  34062847
mark   XRP/USD  $1.00064
feed   0x015852502f55534400000000000000000000000000   (derived, not hardcoded)
oracle ts 1786731563   →   written at 1786731573   (+10s)
```

## Bounties targeted

**Confidential Compute Apps.** The scoring weights never leave the enclave. `requestRank` reads a caller's record from `CallTape` storage rather than accepting it as calldata, so the requester chooses *who* is ranked, never *what* counts — a caller cannot submit a flattering subset of their own history and have it signed.

**Interoperable Asset Products.** Copy and fade positions settle in real FXRP, giving XRP holders something to do with the asset: follow a caller whose record is verifiable, without leaving XRP.

## Security

Three issues found and fixed during the build, each caught by a test:

1. **The enclave could be fed substituted text.** The TEE needs post text, but the chain stores only a hash — a relayer could obtain a genuine TEE-signed verdict about a post nobody made. `requestClassify` now re-hashes against the FDC-proved `contentHash`. Fuzz-tested.
2. **A single lucky call topped the leaderboard** (8691 vs 8263 against a sustained 40-call record) because one data point has zero dispersion and so scored perfect consistency. Consistency is now neutral below two observations, and credibility shrinks the whole composite.
3. **`requestRank` accepted the record as calldata.** It now reads from `CallTape` storage.

**On the X API token:** FDC commits the entire Web2Json `requestBody` — headers included — on-chain, permanently and publicly. A bearer token placed there would be published forever. The token therefore sits behind a minimal read proxy (`app/api/x-post/[id]/route.ts`) and FDC attests *that* endpoint. This is one trusted hop, stated plainly rather than described as trustless.

## Known gaps, stated rather than hidden

- **FCC machine registration is pending** Coston2 indexer credentials from Flare; the extension is built and tested against a simulated TEE meanwhile.
- **Said-vs-Did is not implemented on Flare.** The pre-Flare version read a caller's own swaps from an indexed DEX. Flare has no equivalent index, so `swapsForWallet` returns empty and a caller is reported as having no contradictions rather than being penalised for something the chain cannot evidence.
- **FTSOv2 covers majors only.** Long-tail tickers are recorded `unpriceable` instead of being priced against the wrong thing.
- **Backfilled demo calls carry seed marks**, labelled as such in the UI. Only calls opened on-chain carry a real FTSO observation.
