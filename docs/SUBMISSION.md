# TAPE — Flare Summer Signal submission

**The accountability layer for crypto callers, rebuilt so that no part of the record depends on trusting us.**

---

## Project name

**TAPE** — trader slang for the printed record of every trade that actually happened.

## Bounties

Both.

- **Bounty 2 — Confidential Compute Apps.** A caller-ranking engine whose scoring weights never leave the TEE, with public attested inputs and a public signed output.
- **Bounty 1 — Interoperable Asset Products.** Copy/fade positions settled in FXRP, giving XRP holders something to do with the asset beyond holding it.

## Short product description

Crypto influencers post hundreds of calls a week, delete the ones that lose, and leave no shared record of whether following them ever made money. TAPE builds that record and makes it impossible to quietly edit.

A post becomes evidence (FDC attests it), then a judgement (a TEE classifies it under sealed logic), then a price (FTSOv2 marks entry and settlement), then a position you can actually take (FXRP). Losing calls stay on the record in red instead of disappearing.

## Target user

Two, on opposite sides of the same record:

- **People who follow callers.** They currently have no way to tell a good caller from a loud one. TAPE gives them a leaderboard built on settled, priced, on-chain results — and one-click copy or fade in FXRP.
- **Callers who are actually good.** For them the record is an asset they own and can point at, rather than a claim nobody can check.

XRP holders specifically: FAssets is what makes this usable by the largest asset in crypto that has no native smart contracts.

---

## How TAPE uses Flare

Three protocols, each replacing something that used to be a request to trust us. This is the whole reason the port exists.

| Claim being made | Before (Base/ETHGlobal) | Now (Flare) |
|---|---|---|
| "He posted this, at this time" | our scraper, our database | **FDC Web2Json** — Merkle proof against a signed voting round |
| "This is what that post meant" | a hosted LLM's word | **FCC** — deterministic classifier in an attested TEE, sealed ranking weights |
| "This is what the price was" | a subgraph we queried | **FTSOv2** — marks taken on-chain, timestamped by the oracle |
| "You can act on it" | Uniswap on Base | **FAssets / FXRP** |

### FDC — the evidence layer

`PostRegistry.recordPost()` accepts a Web2Json proof, verifies it via `ContractRegistry.getFdcVerification().verifyWeb2Json()`, and stores digests of the post id, author and text.

Two properties that matter:

- **Deletion stops working.** Once attested, the record stands whether or not the post survives.
- **Silent edits stop working.** Re-attesting the same post id with different text emits `ContentDiverged` and *keeps the original authoritative*, because the original is what any existing call was scored against. An edit becomes visible information about the caller rather than a way to rewrite history.

Future-dated posts are rejected (10-minute skew tolerance) so nobody can pre-position a call and choose its entry mark afterwards.

### FCC — the confidential scoring layer

Custom `OPType "SCORE"` with three commands: `WEIGHTS`, `CLASSIFY`, `RANK`.

**The design question this bounty forced us to answer honestly.** FCC attests a *code hash* and expects reproducible builds. So anything compiled into an open-source extension image is public by construction — weights baked into the source are not secret, and claiming otherwise would be marketing.

The resolution is the same pattern the official `fce-sign` example uses for its private key: **the weights are never in the image.** They arrive encrypted to the TEE's public key via `SCORE/WEIGHTS`, are decrypted inside the enclave, and live only in enclave memory. `requireWeights()` throws rather than falling back to a default, because a built-in default would mean producing scores under public weights while still signing them as confidential output.

So the split is:

- **Public and attested:** the inputs (FDC-proved posts, FTSO marks, on-chain P&L).
- **Public and signed:** the output score, written back on-chain by a registered TEE machine.
- **Secret:** the function.

**Why the function needs to be secret at all.** A published ranking gets optimised against rather than satisfied. Callers learn which term dominates and farm it — post a hundred trivial calls, or go quiet after a good week. Goodhart's law is the predictable end state of any public leaderboard with money attached. Hiding the formula costs nothing in accountability, because anyone can still verify the inputs are real and the machine is the registered one.

**Classification is deliberately *not* secret.** It is parsing, not judgement, and there is nothing to gain by hiding how a ticker is extracted. It runs in the enclave for integrity, not confidentiality, and it is fully deterministic — no clock, no network, no randomness — because otherwise "this exact code produced this verdict" would be false.

### FTSOv2 — the pricing layer

`CallTape` takes an entry mark when a call opens and a settle mark at expiry, via `getFeedByIdInWei`.

- Feed ids are **derived**, not hardcoded: `0x01` + UTF-8 of `SYMBOL/USD`, right-padded to 21 bytes. Verified against all seven published ids.
- `getFeedByIdInWei` is used over `getFeedById` specifically to avoid decimal-exponent bugs — entry and settle marks are taken at different times and a feed's `decimals` can change between them.
- Every mark is staleness-checked; a halted feed reverts rather than silently freezing a price that calls keep settling against.

### FAssets / FXRP — the execution layer

FXRP is resolved through `ContractRegistry.getAssetManagerFXRP()` → `fAsset()`, never hardcoded. Positions are sized and settled in integer maths at FXRP's real 6-decimal (XRPL drop) precision.

---

## What existed before, and what is new

The hackathon rules ask for this split explicitly, so here it is without softening.

### Pre-existing (ETHGlobal Lisbon 2026, in `kollateral/`)

The product concept, the Next.js app shell, the dither/1-bit design system, the database schema, the dossier and leaderboard UI, the browser extension, and the seed dataset. Roughly the full front end and the product thinking.

### Newly built during this program

Everything touching Flare — all of it written from scratch:

| Component | What it is |
|---|---|
| `contracts/src/PostRegistry.sol` | FDC Web2Json evidence layer |
| `contracts/src/CallTape.sol` | Call lifecycle, FTSO marks, settlement, P&L |
| `contracts/src/TapeInstructionSender.sol` | FCC entry point |
| `tee/typescript/src/app/classify.ts` | Deterministic classifier (replaces the LLM call) |
| `tee/typescript/src/app/scoring.ts` | Sealed-weight ranking engine |
| `tee/typescript/src/app/handlers.ts` | TEE instruction handlers |
| `app/lib/{flare,feeds,ftso,fxrp}.ts` | Flare chain access, feed encoding, pricing, FXRP |
| `app/app/api/x-post/[id]/route.ts` | Credential-isolating read proxy |
| `app/scripts/attest-post.ts` | End-to-end FDC attestation pipeline |

**197 tests, all passing** — 49 Solidity (Foundry, incl. fuzz), 70 TEE extension, 78 app.

The app suite shrank during the port: ten tests covering the 0G, The Graph and Uniswap modules were removed along with the modules themselves, since those code paths no longer exist.

### Ported / replaced

- 0G Compute TEE inference → Flare Confidential Compute
- The Graph subgraphs → FTSOv2
- Uniswap on Base → FAssets / FXRP
- Our own scraper as source of truth → FDC Web2Json

---

## Two design problems we found and fixed

Worth surfacing because both were real, and both were caught by tests rather than by reading.

**1. The enclave could be fed substituted text.** The TEE needs post *text* to classify, but the chain stores only a hash. A relayer could hand the enclave different text and receive a genuine, TEE-signed verdict about a post nobody ever made. Fixed: `requestClassify` re-hashes the supplied text against the FDC-proved `contentHash` before dispatching. Fuzz-tested — no string other than the attested one is accepted.

**2. A single lucky call topped the leaderboard.** The ranking test asserted that a sustained good record must outrank one lucky call. It failed: 8691 vs 8263. Cause — a one-call record has *zero dispersion*, so it scored a perfect `consistency` of 1.0. One data point looks maximally consistent because variance is undefined, not because the caller is reliable. Fixed on both sides: consistency is neutral below two observations, and sample-size credibility now shrinks the whole composite toward neutral rather than one term.

A third, structural: `requestRank` reads the caller's record **from `CallTape` storage**, never from calldata. The requester chooses *who* is ranked, never *what* is counted — otherwise anyone could submit a flattering subset of their own history and get it signed.

---

## Status — what is proven and what is not

Stated plainly, because overclaiming here is worse than an incomplete submission.

**Working and tested:**
- All contracts compile clean (zero warnings) and pass 49 tests including fuzz.
- The TEE extension logic passes 70 tests, including the confidentiality boundary (refuses to rank without provisioned weights; `/state` never leaks them).
- Feed-id derivation verified against Flare's published table; registry name-hashes pinned against Foundry-computed golden values.

**Built but not yet executed end-to-end on Coston2:**
- FDC attestation round-trip and FCC machine registration. Both are blocked on **Coston2 indexer database credentials, which Flare support issues** — the FCC deploy path cannot run without them. The extension is built against `SIMULATED_TEE=true` in the meantime.
- Contract deployment, pending testnet funding.

**Known limitation, stated rather than hidden:** the X bearer token cannot go in the FDC request, because `requestBody` — headers included — is committed on-chain permanently. So a thin read proxy holds the credential server-side and FDC attests *that* endpoint. This reintroduces one trusted hop. The proxy is deliberately minimal (fixed upstream, numeric-id-only input, no interpretation, four fields out), but it is not a trustless path and we are not going to describe it as one. The alternative — publishing the credential on-chain forever — is strictly worse.

**Also honest:** FTSO is a spot oracle with no history, so TAPE cannot reconstruct an entry price after the fact. It records marks *forward*. That is stronger than the old design (the chain witnessed and timestamped the entry rather than us looking it up later), but it means backfilled demo calls carry seed marks and are labelled as such in the UI. Every call also stores `entryLagSecs` — the gap between publication and the mark — so a late mark is visible rather than implied to be contemporaneous.

## Deployment

Coston2 (chain 114). Addresses will be listed here once the funding and credential blockers clear.

## Roadmap

1. **Complete the Coston2 deployment** — indexer credentials, TEE machine registration, first live attestation.
2. **Said-vs-Did on Flare.** The wallet-contradiction check (said accumulate, sold four hours later) is scaffolded in the ranking engine but reports `contradicted: false` until an on-chain source exists — a caller is never penalised for something the chain cannot evidence.
3. **Flare Smart Accounts.** Trigger a copy-trade from an XRPL payment memo, so an XRP holder needs no EVM wallet at all.
4. **Firelight / Upshift vaults** for idle FXRP between positions.
5. **Public leaderboard** with periodic `RANK` refresh.

## Links

- Repo: https://github.com/Venkat5599/FL/tree/flare-port (the `flare-port` branch — `main` still holds the pre-existing GigaBags project, which is exactly the "what existed before" comparison this submission refers to)
- Pre-existing project (for the "what existed before" comparison): `kollateral/` in this workspace, live at `gigabags.vercel.app`
