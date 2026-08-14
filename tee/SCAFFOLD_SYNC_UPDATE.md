# Sign Extension — Sync to Latest FCC Changes

This document describes the update that brings the **sign** extension in line with
the latest `tee-node`, `tee-proxy`, `go-flare-common`, and FCC smart-contract
changes. The changes were ported from the `extension-scaffold` repo (its
`develop` branch vs `main`), which had already been updated.

- **Branch:** `scaffold-sync/governance-update`
- **Commit:** `c88ad14` — *Update sign extension for TEE governance and contract API changes*
- **Scope:** 25 tracked files (21 modified, 4 new) + 1 local (gitignored) proxy config.

The headline change is **TEE governance**: registration now binds a machine to a
governance signer-set/threshold via a `governanceHash`, and the tooling registers
that governance on-chain. Most of the remaining changes are forced by the
dependency bump (API signatures changed) or are contract-interface renames.

---

## 1. Why this update is needed

The sign repo was pinned to the same dependency baseline as `extension-scaffold`
`main`:

| Module | Old | New |
| --- | --- | --- |
| `github.com/ethereum/go-ethereum` | `v1.16.7` | `v1.17.2` |
| `github.com/flare-foundation/go-flare-common` | `v1.2.1-0.20260424152410-876c09e65794` | `v1.2.2-0.20260623111601-c573c79c0924` |
| `github.com/flare-foundation/tee-node` | `v0.0.20` | `v0.0.21-0.20260619120252-31fc839ae6d2` |
| `github.com/flare-foundation/tee-proxy` (tools only) | `v0.0.17` | `v0.0.18` |

The new `go-flare-common` / `tee-node` / on-chain contracts introduce the TEE
governance model and change several API signatures. Without the corresponding
code changes, the tooling either won't compile or will fail on-chain (e.g.
`register-tee` reverts with `InvalidGovernanceHash`).

### tee-proxy must go to v0.0.18

`tee-proxy v0.0.17` does **not** compile against the new `go-flare-common`
(`policy.NewSigningPolicy` now returns 2 values; `fdc.HashMessage`'s signature
changed). The sign tools import `tee-proxy/pkg/config` and `pkg/init`, which
transitively pull in `pkg/policy` and `pkg/instruction/meta`, so the whole module
must build. `v0.0.18` (the tag on tee-proxy's `develop` HEAD) pins the compatible
`go-flare-common`/`tee-node` line and resolves this.

---

## 2. TEE governance (the headline change)

Every TEE machine now registers under a **governance** — a set of signer
addresses and a threshold that authorize governance actions for the extension.
Two parties must agree on this set, or `register-tee` reverts with
`InvalidGovernanceHash`:

- the **TEE node**, which signs its machine data with a `governanceHash` derived
  from `(signers, threshold)`, and
- the **on-chain registry**, where the governance is registered (via the new
  `ExtensionGovernance` facet).

To keep them consistent, both read the **same env vars**:

```bash
GOVERNANCE_SIGNERS="0xAbc...,0xDef..."   # comma-separated 0x addresses
GOVERNANCE_THRESHOLD=2
```

If unset, both default to **the deployer (`INITIAL_OWNER`) as the sole signer,
threshold 1** — fine for development.

### What was added

| File | Change |
| --- | --- |
| `go/tools/cmd/set-governance/main.go` | **New** CLI. Reads `GOVERNANCE_SIGNERS` / `GOVERNANCE_THRESHOLD` (defaulting to deployer/threshold-1), resolves the extension id from the proxy `/info`, and registers the governance on-chain. |
| `go/tools/pkg/fccutils/governance.go` | **New** `SetTeeGovernance(...)`. Computes the desired `governanceHash` via `tee-node`'s `types.GovernanceHash(signers, threshold)`, skips if the on-chain hash already matches (idempotent), else calls `ExtensionGovernance.SetNewTeeGovernance`. |
| `go/tools/pkg/support/support.go` | Adds the `TeeExtensionGovernance` binding (`extensiongovernance.NewExtensionGovernance(diamond, client)`) to `Support`. |
| `go/tools/pkg/fccutils/registration.go` | `PreRegistration` now sends `GovernanceHash: teeInfo.MachineData.GovernanceHash` in the machine data — `register()` verifies the TEE signature over `keccak(abi.encode(machineData))` including this field, so a zero value fails with `InvalidTeePublicKeyOrSignature`. |
| `scripts/post-build.sh` | Inserts **Step 2: Set TEE governance** (`go run ./cmd/set-governance ...`) between "Allow TEE version" and "Register TEE machine" (register renumbered to Step 3). |
| `docker-compose.yaml` | Passes `GOVERNANCE_SIGNERS` / `GOVERNANCE_THRESHOLD` to the node container (defaulting to `INITIAL_OWNER` / `1`). |
| `.env.example` | Documents `GOVERNANCE_SIGNERS` / `GOVERNANCE_THRESHOLD`. |

Because `post-build` (`set-governance`) and the node container read the same env
vars, the on-chain governance and the node's signed `governanceHash` always agree.

---

## 3. Contract API changes

### `extensionsCounter()` → `nextPublicExtensionId()`

The registry no longer exposes a plain counter. Public extension IDs are now
assigned from `FIRST_PUBLIC_EXTENSION_ID` (`0x10000` = 65536) upward; IDs below
that are reserved for system extensions.

| File | Change |
| --- | --- |
| `contracts/interfaces/ITeeExtensionRegistry.sol` | `extensionsCounter()` → `nextPublicExtensionId()`. |
| `contracts/InstructionSender.sol` | Adds `FIRST_PUBLIC_EXTENSION_ID = 0x10000`; `setExtensionId()` now loops `for (i = FIRST_PUBLIC_EXTENSION_ID; i < nextPublicExtensionId(); ++i)` instead of `0 .. extensionsCounter()`. |
| `go/tools/cmd/audit-deploy/main.go` | `er.ExtensionsCounter` → `er.NextPublicExtensionId` (+ label). |
| `go/tools/pkg/validate/checks.go` | Check R1 renamed "extensions counter" → "next public extension id"; calls `NextPublicExtensionId`. |
| `skills/create-extension/references/ITeeExtensionRegistry.sol` | Doc reference updated to match. |

### `AddTeeVersion` — version is now `bytes32`, no `governanceHash`

The on-chain `addTeeVersion` dropped its trailing `governanceHash` argument
(governance moved to the `ExtensionGovernance` facet) and now takes the version
as a `bytes32` rather than a string.

| File | Change |
| --- | --- |
| `go/tools/pkg/fccutils/registration.go` | `AddTeeVersion(...)` loses the `governanceHash` param; adds a `stringToBytes32` helper and calls `AddTeeVersion(opts, extensionId, versionBytes, codeHash, [][32]byte{platform})`. |
| `go/tools/cmd/allow-tee-version/main.go` | Drops the `common.Hash{}` argument (and the now-unused `common` import). |
| `go/tools/cmd/audit-deploy/main.go` | `replayAddTeeVersion` packs `addTeeVersion` with a `bytes32` version and no `governanceHash`; adds a local `stringToBytes32`. |

### Regenerating bindings

`contracts/InstructionSender.sol` changed, so the Go bindings were regenerated:

```bash
./scripts/generate-bindings.sh   # forge build + abigen
```

The generated artifacts (`go/tools/pkg/contracts/sign/autogen.go`, `.abi`, `.bin`)
are **gitignored** — only the `go:generate` directive (`sign.go`) is tracked, so
regeneration doesn't show up in `git status`. The ABI is unchanged (only the
embedded bytecode differs, because `setExtensionId`'s internals changed).

---

## 4. Signature & verification changes (forced by the bump)

| File | Change | Why |
| --- | --- | --- |
| `go/tools/pkg/fccutils/registration.go` | `encoding.TransformSignatureRSVtoVRS` now returns `([]byte, error)` — the error is checked. | Signature changed in `go-flare-common`. |
| `go/tools/pkg/fccutils/tee_calls.go` | `TeeProxyId` recovers the proxy address over a **domain-separated, chain-ID-bound** payload: `csigning.NewPayload(csigning.ProxyTeeInfo, teeInfo.TeeInfo.ChainID, infoHash).Hash()`. | The proxy now signs the TEE info over this payload (tee-proxy `external.go`). Recovering over the raw hash yields a garbage `proxyId` and the on-chain availability check is rejected with "proxy signer does not match". (`GetTeeProxyID` wraps `TeeProxyId`, so it inherits the fix.) |
| `go/tools/pkg/fccutils/registration.go` | On re-runs where the machine is already registered, request a **fresh attestation** instead of skipping. | The original attestation challenge is one-shot and may have expired; without a fresh one the availability check reverts with `ChallengeExpired`. |

---

## 5. FTDC policy-consistency pre-flight check (new)

A new guard fails fast with a clear message when the FTDC proxy's signing policy
is out of sync with the on-chain reward epoch — instead of a confusing 404 "no
round" after a wasted on-chain tx and ~30s of polling.

| File | Change |
| --- | --- |
| `go/tools/pkg/fccutils/policy_consistency.go` | **New** `CheckFTDCProxyPolicyConsistency(s, ftdcProxyURL)`. Compares `FlareSystemsManager.getCurrentRewardEpochId()` with the proxy's `TeeInfo.LastSigningPolicyID`. Tolerates the proxy being one epoch ahead (the ~2h rollover window). Returns `ErrPolicyOutOfSync` only on a confirmed mismatch; logs and returns `nil` if either lookup fails (never turns a transient into a blocked registration). |
| `go/tools/pkg/fccutils/policy_consistency_test.go` | **New** unit tests for `policyInSync` and the error message. |
| `go/tools/pkg/fccutils/registration.go` | Calls the check in `RegisterNode` right before `RequestFTDCAvailabilityCheck`. `register-tee` already passes the FTDC/external proxy URL (`-ep`) through. |

---

## 6. Config & infrastructure

### Chain-id binding

The new `tee-node` binds every signature to `CHAIN_ID`, which must match the
proxy's `chain_id` and the actual chain — otherwise signature verification fails.

| File | Change |
| --- | --- |
| `docker-compose.yaml` | Adds `CHAIN_ID=${CHAIN_ID:-114}` to the node container. **Note:** defaults to Coston2 (114), *not* the scaffold's `31337` — the sign repo has no local-Hardhat flow (its base config targets Coston2, and scripts only know coston=16 / coston2=114). |
| `docker-compose.coston.yaml` | Adds `CHAIN_ID=${CHAIN_ID:-16}`. |
| `docker-compose.coston2.yaml` | Adds `CHAIN_ID=${CHAIN_ID:-114}`. |

### Proxy signing-policy offset

Bumps `initial_signing_policy_offset` from `0` to `2` for Coston2 (start two
epochs back to keep the proxy in sync — pairs with the new policy-consistency
check).

| File | Change |
| --- | --- |
| `config/proxy/extension_proxy.coston2.docker.toml.example` | offset `0` → `2`. |
| `config/proxy/extension_proxy.coston2.toml.example` | offset `0` → `2`. |
| `config/proxy/extension_proxy.coston2.docker.toml` | offset `0` → `2` *(local, gitignored)*. |

### Coston deployed addresses

The Coston FCC diamond was redeployed. `config/coston/deployed-addresses.json`
was synced to the current deployment (81 → 93 entries):

- `FlareTeeManager`: `0xb7DeFe…DEA09` → `0xc4885998f5D792ed88C5Af7a3AaCBe333f017658`
- `Fdc2Hub`: `0x47f3c84c…17bd7` → `0x064C7B68B0e2BC87e7bE34e89741485Fcb48FA2F`
- `FlareSystemsManager`: unchanged (`0x85680Dd9…9e358`)
- Stale entries dropped (`SystemStateVerifierFacet` removed in the redeploy,
  `TeePayments_F_XRP` renamed to `TeePayments`); new facets added
  (`ExtensionGovernanceFacet`, `MachinePathManagerFacet`, etc.).

The sign tooling only reads `FlareSystemsManager`, `Fdc2Hub`, and
`FlareTeeManager`; the rest are informational.

---

## 7. Coston proxy config (local, gitignored)

The `config/proxy/extension_proxy.<chain>.docker.toml` files hold DB credentials
and are **gitignored** — created locally from the templates/docs, not committed.
`extension_proxy.coston.docker.toml` had never been created, so running the
Coston flow failed with:

```
error mounting ".../extension_proxy.coston.docker.toml" ... cannot create
subdirectories ... not a directory: Are you trying to mount a directory onto a
file (or vice-versa)?
```

Root cause: with the file missing, Docker auto-created an empty **directory** at
that path and then couldn't mount a directory onto the `/app/config/config.toml`
file. Fix: remove the stray directory and create the real file (values from
`TESTNET_DEPLOYMENT.md`):

```toml
initial_signing_policy_offset = 2
chain_id = 16

[db]
host = "<your-indexer-host>"   # Coston indexer
port = 3306
database = "indexer"
username = "<your-username>"
# ...

[addresses]
flare_systems_manager = "0x85680Dd93755Fe5d0789773fd0896cEE51F9e358"
relay                 = "0x051f214D346Cfd97B107BECb87E2B35D1b4287E9"
voter_registry        = "0x42F4526BFC6f892DB515a832a52eFc9edFADf6c0"
```

> **Coston needs indexer access.** If the indexer is unreachable,
> `ext-proxy` panics with `connect: connection refused`.

---

## 8. Build & verify

```bash
# Dependencies
(cd go && go mod tidy)
(cd go/tools && go mod tidy)

# Contracts + bindings
./scripts/generate-bindings.sh

# Build / vet / test both modules
(cd go && go build ./... && go vet ./...)
(cd go/tools && go build ./... && go vet ./... && go test ./...)
```

All of the above pass. (`go mod verify` reports two benign warnings unrelated to
this change: the local `replace sign-extension => ../` has no ziphash, and a
pre-existing `fastssz` module-cache blemish. Clean `go build` already validates
the `go.sum` hashes.)

---

## 9. Complete file list

**New (tracked):**
- `go/tools/cmd/set-governance/main.go`
- `go/tools/pkg/fccutils/governance.go`
- `go/tools/pkg/fccutils/policy_consistency.go`
- `go/tools/pkg/fccutils/policy_consistency_test.go`

**Modified (tracked):**
- `go/go.mod`, `go/go.sum`, `go/tools/go.mod`, `go/tools/go.sum`
- `go/tools/pkg/fccutils/registration.go`
- `go/tools/pkg/fccutils/tee_calls.go`
- `go/tools/pkg/support/support.go`
- `go/tools/pkg/validate/checks.go`
- `go/tools/cmd/allow-tee-version/main.go`
- `go/tools/cmd/audit-deploy/main.go`
- `contracts/InstructionSender.sol`
- `contracts/interfaces/ITeeExtensionRegistry.sol`
- `skills/create-extension/references/ITeeExtensionRegistry.sol`
- `scripts/post-build.sh`
- `docker-compose.yaml`, `docker-compose.coston.yaml`, `docker-compose.coston2.yaml`
- `.env.example`
- `config/coston/deployed-addresses.json`
- `config/proxy/extension_proxy.coston2.docker.toml.example`
- `config/proxy/extension_proxy.coston2.toml.example`

**Local, gitignored (not committed):**
- `config/proxy/extension_proxy.coston.docker.toml` *(new)*
- `config/proxy/extension_proxy.coston2.docker.toml` *(offset 0 → 2)*
- `go/tools/pkg/contracts/sign/autogen.go`, `.abi`, `.bin` *(regenerated)*

---

## 10. Follow-ups / notes

- **`register-extension`'s `-governanceHash` flag is now dead.** It predates this
  update (the sign repo already ignored it in `SetupExtension`); governance is set
  by `set-governance`. Left as-is to keep scope tight — safe to remove later.
- **Skipped scaffold niceties:** the scaffold's `full-setup.sh` chain
  auto-activation and `start-services.sh` self-contained tee-proxy build were not
  ported — the sign repo already handles those differently, and they're unrelated
  to the governance/API update.
- **`initial_signing_policy_offset` on Coston** was set to `2` for consistency
  with the Coston2 fix (the `TESTNET_DEPLOYMENT.md` reference shows `0`); the
  policy-consistency check will surface any sync issue if it matters.
