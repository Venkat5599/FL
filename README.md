# TAPE

**A public, verifiable record of what crypto callers actually said — and whether following them made money.**

Built for [Flare Summer Signal](https://flare.network). Targets both bounties: **Confidential Compute** and **Interoperable Assets**.

---

## The problem

Influencers post hundreds of calls a week, delete the ones that lose, and leave no shared record. Every "track record" you have ever been shown was assembled by the person it flatters.

## What TAPE does

Turns a post into a permanent, priced, checkable result — with no step that asks you to trust us:

```
a post on X
  └─ FDC Web2Json ──────► proven to exist, at that time, with that text
       └─ FCC (TEE) ─────► classified into a trade signal, under sealed weights
            └─ FTSOv2 ───► marked at entry, marked at settlement
                 └─ FXRP ► you copy it, or fade it
```

Losing calls stay on the record, in red. Deleted posts stay on the record. Edited posts show the edit.

## Why each protocol is load-bearing

| Claim | Who guarantees it |
|---|---|
| "He posted this, then deleted it" | **FDC** — Merkle proof against a signed voting round |
| "This is what it meant as a trade" | **FCC** — deterministic classifier in an attested TEE |
| "This is the score, and you can't game it" | **FCC** — ranking weights never leave the enclave |
| "This is what the price was" | **FTSOv2** — on-chain marks, oracle-timestamped |
| "You can act on it with XRP" | **FAssets / FXRP** |

**The confidential-compute idea in one line:** inputs public and attested, output public and signed, *function secret* — because a published ranking function gets farmed rather than satisfied.

The weights are not compiled into the image. FCC attests a code hash and expects reproducible builds, so anything in an open-source image is public by construction. They arrive encrypted after attestation and live only in enclave memory, and the extension **refuses to rank** without them rather than falling back to a public default.

## Layout

```
contracts/   Foundry — PostRegistry, CallTape, TapeInstructionSender   (49 tests)
tee/         Flare Confidential Compute extension, TypeScript          (70 tests)
app/         Next.js 16 + React 19 front end and Flare libs            (78 tests)
docs/        SUBMISSION.md
```

## Quick start

```bash
# Contracts
cd contracts && bun install && forge build && forge test

# TEE extension
cd tee/typescript && bun install && bunx vitest run

# App
cd app && bun install && bun run dev
```

### Deploy to Coston2

```bash
cd contracts
export PRIVATE_KEY=...            # funded with C2FLR from faucet.flare.network/coston2
export TEE_EXTENSION_REGISTRY=... # from the FCC scaffold's deployed-addresses.json
export TEE_MACHINE_REGISTRY=...
forge script script/Deploy.s.sol:Deploy --rpc-url coston2 --broadcast
```

### Attest a post

```bash
cd app
bun scripts/attest-post.ts <x-post-id>
```

Requires `X_BEARER_TOKEN` (server-side only — see below), `VERIFIER_URL_TESTNET`, `VERIFIER_API_KEY_TESTNET`, `COSTON2_DA_LAYER_URL`, `POST_REGISTRY_ADDRESS`, `ATTESTER_PRIVATE_KEY`, `TAPE_PROXY_BASE_URL`.

## A security note we want read, not buried

FDC commits the **entire** Web2Json `requestBody` on-chain — url, headers, everything — permanently and publicly. An API bearer token placed in `headers` would be published forever.

So the token never travels with the attestation. It sits behind a minimal read proxy (`app/app/api/x-post/[id]/route.ts`) and FDC attests *that* endpoint. This is one trusted hop and we say so in the submission rather than describing the path as trustless. The proxy is deliberately incapable of much: fixed upstream host, numeric-id-only input, no interpretation, four fields out.

## Live on Coston2

| Contract | Address |
|---|---|
| `PostRegistry` | `0x7b4b536Ac15bE7E5F43276ea71CCC1e1Be6124b4` |
| `CallTape` | `0xC0309C5dE3f46a20A0f084dF8635d927FD1e22e5` |
| `TapeInstructionSender` | `0x657f0fAfe5AfD5C2cdEa18840bc25fF4eDa35Fe9` |

App: https://app-f6zaxplae-venkat5599s-projects.vercel.app

The FTSOv2 integration is proven live — the XRP/USD feed id this repo derives returns a
real price from the deployed oracle. See [`docs/SUBMISSION.md`](docs/SUBMISSION.md) for
the verification transcript and for what remains unproven.

## Status

200 tests passing. Contracts compile clean with zero warnings. No 0G, The Graph or Uniswap code remains — those modules and their tests were deleted, not left dormant.

Not yet run end-to-end on Coston2: FCC machine registration requires **Coston2 indexer credentials issued by Flare support**, and deployment requires testnet funding. Both are external blockers, both are noted in [`docs/SUBMISSION.md`](docs/SUBMISSION.md) alongside everything else that is built-but-unproven.

## Prior work

TAPE is a port of **GigaBags** (ETHGlobal Lisbon 2026 — 0G, The Graph, Uniswap). The front end, design system and product thinking carry over; every Flare integration is new. The full split is in [`docs/SUBMISSION.md`](docs/SUBMISSION.md).
