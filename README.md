<p align="center">
  <img src="https://img.shields.io/badge/📼-TAPE-C8FF00?style=for-the-badge&labelColor=0a0f12" alt="TAPE" />
</p>

<h1 align="center">TAPE</h1>

<p align="center">
  <strong>The market remembers — a verifiable track record for crypto callers, built on Flare</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/🟢_LIVE-Coston2-00FF88?style=for-the-badge" alt="Live" />
  <img src="https://img.shields.io/badge/Bounty-Interop_+_Confidential_Compute-E62058?style=for-the-badge" alt="Bounties" />
  <img src="https://img.shields.io/badge/Hackathon-Flare_Summer_Signal-E62058?style=for-the-badge" alt="Hackathon" />
  <img src="https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Solidity-0.8.27-363636?style=for-the-badge&logo=solidity" alt="Solidity" />
  <img src="https://img.shields.io/badge/Tests-200_passing-00FF88?style=for-the-badge" alt="Tests" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT" />
</p>

<p align="center">
  <a href="https://tape-flare.vercel.app">🌐 Live App</a> &nbsp;|&nbsp;
  <a href="https://github.com/Venkat5599/FL">💻 GitHub</a> &nbsp;|&nbsp;
  <a href="https://coston2-explorer.flare.network/address/0x7b4b536Ac15bE7E5F43276ea71CCC1e1Be6124b4">🔎 Contracts</a> &nbsp;|&nbsp;
  <a href="https://x.com/Archuser__">🐦 Twitter</a> &nbsp;|&nbsp;
  <a href="https://linkedin.com/in/venkata-ramana-komari-402058316">👤 LinkedIn</a>
</p>

---

## Project Overview

**Problem Statement:** Crypto influencers post hundreds of trade calls a week, quietly delete the ones that lose, and present whatever survives as a track record. Every such record was assembled by the person it flatters — the screenshot, the price, and the score all come from someone with a reason to show you that number. There is no shared, checkable record of whether following anyone ever made money.

**Solution:** TAPE builds the record they cannot edit. A post is proven to exist by the Flare Data Connector, classified inside a hardware enclave whose ranking weights are never published, priced by FTSOv2 on-chain, and made actionable in FXRP. Deleting a post no longer erases it; editing one surfaces the edit; losing calls stay on the record in red.

**Blockchain Relevance:** FDC Web2Json attestation (Merkle proofs verified on-chain), Flare Confidential Compute (TEE-sealed scoring), FTSOv2 block-latency oracle feeds, FAssets/FXRP settlement, and four Solidity contracts deployed to Coston2.

---

## Technical Architecture

```
a post on X
  └─ FDC Web2Json ──────► proven to exist, at that time, with that text
       └─ FCC (TEE) ─────► classified into a trade signal, under sealed weights
            └─ FTSOv2 ───► marked at entry, marked at settlement
                 └─ FXRP ► you copy it, or fade it
```

```
[Browser — Next.js 16]
     │  wagmi + injected wallet (Coston2)
     │  viem → Flare RPC
     ▼
[Coston2 — chain 114]
     ├── PostRegistry ─────────── verifies FDC Web2Json Merkle proofs
     ├── CallTape ─────────────── FTSO entry/settle marks, P&L, settlement
     ├── TapeInstructionSender ── FCC entry point (SCORE / CLASSIFY / RANK / WEIGHTS)
     └── FeedMarkLog ──────────── records FTSOv2 marks forward, permissionlessly
              │
              └── [TEE extension — TypeScript, Confidential Space]
                       deterministic classifier + sealed-weight ranker
```

**Why each protocol is load-bearing:**

| Claim | Guaranteed by |
|---|---|
| "He posted this, then deleted it" | **FDC** — Merkle proof against a signed voting round |
| "This is what it meant as a trade" | **FCC** — deterministic classifier in an attested TEE |
| "This score can't be gamed" | **FCC** — ranking weights never leave the enclave |
| "This is what the price was" | **FTSOv2** — on-chain marks, oracle-timestamped |
| "You can act on it with XRP" | **FAssets / FXRP** |

**The confidential-compute idea in one line:** inputs public and attested, output public and signed, **function secret** — because a leaderboard with a public formula gets optimised against rather than satisfied.

**Core tech stack:**
- **Blockchain platform:** Flare (Coston2 testnet, chain 114)
- **Smart contract language:** Solidity 0.8.27 (Foundry)
- **Confidential compute:** Flare Confidential Compute extension, TypeScript
- **Frontend framework:** Next.js 16 + React 19
- **Other components:** viem, wagmi, `@flarenetwork/flare-periphery-contracts`, libsql

---

## Smart Contracts

**Contract directory:** `contracts/src/`

**Deployed on Coston2 (chain 114):**

| Contract | Address |
|---|---|
| `PostRegistry` | [`0x7b4b536Ac15bE7E5F43276ea71CCC1e1Be6124b4`](https://coston2-explorer.flare.network/address/0x7b4b536Ac15bE7E5F43276ea71CCC1e1Be6124b4) |
| `CallTape` | [`0xC0309C5dE3f46a20A0f084dF8635d927FD1e22e5`](https://coston2-explorer.flare.network/address/0xC0309C5dE3f46a20A0f084dF8635d927FD1e22e5) |
| `TapeInstructionSender` | [`0x657f0fAfe5AfD5C2cdEa18840bc25fF4eDa35Fe9`](https://coston2-explorer.flare.network/address/0x657f0fAfe5AfD5C2cdEa18840bc25fF4eDa35Fe9) |
| `FeedMarkLog` | [`0x0b5fC92e207FDeF5B33A2767FBd9C9186B01184A`](https://coston2-explorer.flare.network/address/0x0b5fC92e207FDeF5B33A2767FBd9C9186B01184A) |

**Key functions:**

| Function | Description |
|---|---|
| `PostRegistry.recordPost(proof)` | Verifies an FDC Web2Json Merkle proof on-chain, then stores post/author/content digests. Re-attesting with different text emits `ContentDiverged` and keeps the original authoritative |
| `CallTape.openCall(postId, feedId, direction, confidence, horizon)` | Takes an FTSOv2 entry mark and opens a call. Restricted to the TEE instruction sender |
| `CallTape.settle(callId)` | Permissionless — anyone may settle a matured call, so a losing result cannot be withheld |
| `CallTape.settledCallsOfAuthor(authorHash, offset, limit)` | Assembles a caller's record from chain state, so a ranking request cannot supply a flattering subset |
| `TapeInstructionSender.requestClassify(postId, text)` | Re-hashes the text against the FDC-proved `contentHash` before dispatching to the enclave |
| `TapeInstructionSender.updateWeights(encrypted)` | Delivers ranking weights encrypted to the TEE's key; never stored in plaintext anywhere |
| `FeedMarkLog.recordMark(feedId, tag)` | Reads FTSOv2 inside the transaction and writes the oracle's own price + timestamp permanently |

**Deployment:**

```bash
cd contracts
export PRIVATE_KEY=0x...              # funded from faucet.flare.network/coston2
export TEE_EXTENSION_REGISTRY=0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE
export TEE_MACHINE_REGISTRY=0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE
forge script script/Deploy.s.sol:Deploy --rpc-url coston2 --broadcast
```

> `FlareTeeManager` is a diamond proxy serving **both** the ExtensionManager and MachineManager facets, so both registry addresses are the same contract. The `deployed-addresses.json` manifest lists the facets separately, which sends you to the wrong addresses.

---

## Installation & Setup

**Requirements:**
- Node.js 18+ / Bun
- Foundry (`forge`, `cast`)
- A browser wallet (MetaMask) on Coston2

**Steps:**

1. Clone the repository
```bash
git clone https://github.com/Venkat5599/FL
cd FL
```

2. Contracts — build and test
```bash
cd contracts
bun install
forge build
forge test          # 52 passing, including fuzz
```

3. TEE extension — build and test
```bash
cd tee/typescript
bun install
bunx vitest run     # 70 passing
```

4. App — configure and run
```bash
cd app
bun install
cp .env.example .env.local     # add contract addresses + RPC
bun run dev
# open http://localhost:3000
```

**Environment variables:**

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_FLARE_NETWORK` | `coston2` \| `songbird` \| `flare` |
| `NEXT_PUBLIC_POST_REGISTRY_ADDRESS` | deployed PostRegistry |
| `NEXT_PUBLIC_CALL_TAPE_ADDRESS` | deployed CallTape |
| `NEXT_PUBLIC_MARK_LOG_ADDRESS` | deployed FeedMarkLog |
| `X_BEARER_TOKEN` | server-side only — never placed in an FDC request (see Security) |
| `VERIFIER_URL_TESTNET` / `VERIFIER_API_KEY_TESTNET` | FDC verifier |
| `COSTON2_DA_LAYER_URL` | FDC Data Availability layer |

---

## Demo

**Live app:** https://tape-flare.vercel.app

**A transaction you can verify right now.** Pressing *mark XRP/USD on-chain* in the terminal sends a feed ID and nothing else — the contract reads FTSOv2 *inside* the transaction, so neither the server nor the person clicking picks the number:

[`0xdcd7dc9458b801d2bf6ede58d8f8cf22dbd051dcaa879294a95c05077cbf8ab0`](https://coston2-explorer.flare.network/tx/0xdcd7dc9458b801d2bf6ede58d8f8cf22dbd051dcaa879294a95c05077cbf8ab0)

```
block  34062847
mark   XRP/USD  $1.00064
feed   0x015852502f55534400000000000000000000000000   (derived, not hardcoded)
oracle ts 1786731563   →   written at 1786731573   (+10s)
```

**Test assets (Coston2):**

| Asset | Address / source |
|---|---|
| C2FLR (gas) | faucet.flare.network/coston2 — 100 per 24h |
| FXRP (`FTestXRP`, 6 decimals) | `0x0b6A3645c240605887a5532109323A3E12273dc7` |

> FXRP **reverts on transfer-to-self** (`0xdad89dca`) — an FAssets restriction not visible from the ERC-20 surface.

---

## Security

Three issues found and fixed during the build, each caught by a test:

1. **The enclave could be fed substituted text.** The TEE needs post text, but the chain stores only a hash — a relayer could obtain a genuine TEE-signed verdict about a post nobody made. `requestClassify` now re-hashes against the FDC-proved `contentHash`. Fuzz-tested.
2. **A single lucky call topped the leaderboard** (8691 vs 8263 against a sustained 40-call record). One data point has zero dispersion and so scored perfect consistency. Consistency is now neutral below two observations, and credibility shrinks the whole composite.
3. **`requestRank` accepted the record as calldata**, so anyone could submit a flattering subset of their own history and have it signed. It now reads from `CallTape` storage: the requester chooses *who* is ranked, never *what* counts.

**On the X API token:** FDC commits the entire Web2Json `requestBody` — headers included — on-chain, permanently and publicly. A bearer token placed there would be published forever. The token therefore sits behind a minimal read proxy (`app/app/api/x-post/[id]/route.ts`) and FDC attests *that* endpoint. This is one trusted hop, stated plainly rather than described as trustless.

---

## Roadmap

**Completed:**
- Four Solidity contracts deployed on Coston2
- FDC Web2Json evidence layer with divergence detection on edits
- FCC extension — deterministic classifier + sealed-weight ranking engine
- FTSOv2 pricing with derived feed IDs, staleness guards, and on-chain marks
- FXRP settlement resolved through `ContractRegistry.getAssetManagerFXRP()`
- Wallet connection with wrong-network detection and one-click chain switch
- Evidence-chain verification endpoint reporting each link separately
- 200 tests passing — 52 Solidity (incl. fuzz), 70 TEE, 78 app

**Next phase:**
- FCC machine registration (pending Coston2 indexer credentials from Flare)
- Said-versus-Did wallet forensics — catching a caller trading against their own advice
- Flare Smart Accounts — follow a caller from an XRPL payment memo, no EVM wallet
- Firelight / Upshift ERC-4626 vaults for idle FXRP between positions
- Sign-In-With-Ethereum to replace the demo wallet-header auth path
- Public leaderboard with periodic on-chain `RANK` refresh

---

## Prior work

TAPE is a port of **GigaBags** (ETHGlobal Lisbon 2026 — 0G Compute, The Graph, Uniswap on Base). The front end, design system and product thinking carry over; **every Flare integration is new** — four contracts, the confidential-compute extension, the FDC pipeline, the FTSO layer, and FXRP settlement. The old 0G, Graph and Uniswap modules were **deleted, not left dormant**. Diff `main` against the parent commits to see the split.

---

## Team

**Team name:** TAPE

**Members & roles:**
- Venkata Ramana Komari — Solo builder (contracts, TEE extension, frontend, deployment)

**Contact:** komarivenkataramana4@gmail.com

---

## License

MIT
