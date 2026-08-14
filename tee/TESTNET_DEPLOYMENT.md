<div align="center">

# 🛡️ Testnet Deployment Guide

**Deploy the `sign` extension to Flare Coston / Coston2 on a real GCP Confidential Space TEE.**
Image hand-off to devops, on-chain registration, and the FTDC availability check — end to end.

![Networks](https://img.shields.io/badge/networks-Coston%20%2F%20Coston2-E62058?style=flat-square)
![TEE](https://img.shields.io/badge/TEE-GCP%20Confidential%20Space-4285F4?style=flat-square&logo=googlecloud&logoColor=white)
![Go](https://img.shields.io/badge/Go-1.25.1%2B-00ADD8?style=flat-square&logo=go&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-required-2496ED?style=flat-square&logo=docker&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows%20%2F%20Linux-0078D4?style=flat-square)

</div>

> [!NOTE]
> `README.md` covers the local-devnet flow, and [`deployment-steps.md`](deployment-steps.md)
> is the concise linear recipe. **This document is the deep reference** — proxy
> config internals, devops `/info` verification, the full troubleshooting
> catalogue, and lifecycle/decommissioning.
>
> **Status:** Coston end-to-end verified 2026-05-14. Coston2 end-to-end verified 2026-05-18 on the re-cut diamond (commit `bdb7c80`); Python (slim) re-verified 2026-05-27.

## 📑 Contents

- [🗺️ First-time deployment checklist](#%EF%B8%8F-first-time-deployment-checklist)
- [📋 Prerequisites](#-prerequisites)
- [⚙️ Configuration files](#%EF%B8%8F-configuration-files)
- [📦 Building the Docker image for devops](#-building-the-docker-image-for-devops)
- [🤝 Devops responsibilities](#-devops-responsibilities)
- [🚀 Deployment flow](#-deployment-flow)
- [🐛 Troubleshooting](#-troubleshooting)
- [🔄 Re-deployment after image updates](#-re-deployment-after-image-updates)
- [🧹 Lifecycle & decommissioning](#-lifecycle--decommissioning)
- [📚 Reference: working configuration](#-reference-working-configuration)
- [🔗 Related docs](#-related-docs)

## 🗺️ First-time deployment checklist

**The shape of a deployment, in plain English:** you build a reproducible Docker image of the extension locally and hand it to devops, who runs it on a GCP Confidential Space VM. While that's spinning up, you register the extension on-chain (Phase 1, `pre-build.sh`) — this mints an `EXTENSION_ID` that devops then injects into the running container. Once devops's proxy is reporting your `EXTENSION_ID` and a real GCP-measured `codeHash`, you do the second on-chain registration (Phase 3, `post-build.sh`) — whitelisting that codeHash and registering the TEE machine with FTDC. A successful `test.sh` round-trip confirms the whole pipeline.

The table below is the linear path from zero to that working state. Each step links to its own detail section.

| #   | Step                                                                                                                                                                                                     | Where                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Generate a deployer private key + derive `INITIAL_OWNER`                                                                                                                                                 | [Deployer key](#deployer-key--funded-testnet-accounts)              |
| 2   | Fund the address on the target chain from the faucet                                                                                                                                                     | [Faucet table](#deployer-key--funded-testnet-accounts)              |
| 3   | Clone the sign extension repo — no sibling repos needed (`tee-node` / `tee-proxy` are fetched from GitHub at build time)                                                                                 | [Get the repo](#get-the-repo)                                       |
| 4   | Bootstrap `.env.<chain>` (and `extension_proxy.<chain>.docker.toml` for Coston2) from the templates                                                                                                      | [Configuration files](#%EF%B8%8F-configuration-files)               |
| 5   | Activate the target chain + language: `bash ./scripts/use-chain.sh coston2 [language]`                                                                                                                   | [Configuration files](#%EF%B8%8F-configuration-files)               |
| 6   | Build the image and verify `MODE=0` is baked in: `bash ./scripts/build-image.sh`                                                                                                                         | [Building the Docker image](#-building-the-docker-image-for-devops) |
| 7   | Hand off image + config values to devops (**Aljaž Konečnik**)                                                                                                                                            | [Devops handoff checklist](#-devops-handoff-checklist)              |
| 8   | Wait for devops's `/info` to come up, then verify it (see step below)                                                                                                                                    | [Verifying devops's /info](#verifying-devopss-info)                 |
| 9   | Run `bash ./scripts/pre-build.sh` — deploys `InstructionSender`, registers extension, emits `EXTENSION_ID` + `INSTRUCTION_SENDER`                                                                        | [Deployment flow](#-deployment-flow)                                |
| 10  | Send the new `EXTENSION_ID` to devops; they restart the container with that env value (no image rebuild needed). Keep `INSTRUCTION_SENDER` in your local `config/extension.env` — devops doesn't need it | [Devops handoff checklist](#-devops-handoff-checklist)              |
| 11  | Re-curl `/info` and confirm `env_override.EXTENSION_ID` now matches your pre-build output                                                                                                                | [Verifying devops's /info](#verifying-devopss-info)                 |
| 12  | Run `bash ./scripts/post-build.sh` — whitelists codeHash, registers TEE machine, FTDC availability check                                                                                                 | [Deployment flow](#-deployment-flow)                                |
| 13  | Run `bash ./scripts/test.sh` — end-to-end `UPDATE` / `SIGN`                                                                                                                                              | [Deployment flow](#-deployment-flow)                                |

> [!TIP]
> Steps 9–12 are the loop you re-run whenever the FlareTeeManager diamond gets re-cut or the TEE image changes. The earlier steps are one-time per developer machine.

## 📋 Prerequisites

### Local machine

| Tool                                 | Why                                           | Check                              |
| ------------------------------------ | --------------------------------------------- | ---------------------------------- |
| 🐳 Docker Desktop (Linux containers) | Builds + runs images                          | `docker info` returns daemon info  |
| 🐹 Go 1.25.1+                        | Runs on-chain registration tools via `go run` | `go version`                       |
| 🐚 Bash                              | Executes the deployment scripts               | Git Bash on Windows is fine        |
| 🔨 Foundry (`forge`, `jq`)           | Solidity compilation in `pre-build.sh`        | `forge --version` / `jq --version` |

### Network access

> [!IMPORTANT]
> **Your indexer DB** must be reachable. Without it, `ext-proxy` panics with `connect: connection refused`.
> Run your own indexer or connect to a public one (talk to a Flare team member for access).

Verify before each run (replace with your indexer host):

```powershell
Test-NetConnection <your-indexer-host> -Port 3306
```

`TcpTestSucceeded: True` means you're good.

### Deployer key + funded testnet accounts

You generate the deployer key yourself — there's no shared team key. Any Ethereum key tool works (Foundry `cast`, `openssl`, MetaMask export, etc.).

Generate a fresh private key:

```bash
# With Foundry
cast wallet new

# Or just raw 32 random bytes
openssl rand -hex 32
```

Derive the matching address — this becomes your `INITIAL_OWNER`:

```bash
cast wallet address --private-key 0x<your-private-key>
```

Fund the derived address on each chain you'll deploy to. Use the chain-specific URL, or the picker:

| Chain           | Faucet URL                             |
| --------------- | -------------------------------------- |
| Coston (CFLR)   | `https://faucet.flare.network/coston`  |
| Coston2 (C2FLR) | `https://faucet.flare.network/coston2` |
| Network picker  | `https://faucet.flare.network/`        |

The same private key can serve both chains if both addresses are funded.

> [!NOTE]
> Set this key as `DEPLOYMENT_PRIVATE_KEY` in `.env.<chain>` (without the `0x` prefix), and the derived address as `INITIAL_OWNER`. See [Configuration files](#%EF%B8%8F-configuration-files) for the full env layout.

### Get the repo

Clone the sign extension. **No sibling repos are needed** — `tee-node` and
`tee-proxy` are fetched from the public `github.com/flare-foundation` repos at
build time (the Go modules are pinned by hash in `go.sum`; the proxy image
`git clone`s them). A flat checkout of just this repo is enough:

```text
<workspace>/
└── extensions/
    └── sign/
```

> [!NOTE]
> The fixes that used to require manual patches are now built in: `go/go.mod`
> and `go/tools/go.mod` carry no `replace` directives (deps come from the
> network), `proxy/Dockerfile` is self-contained, `post-build.sh` already
> passes `-command rRap` for fresh attestation, and every `Dockerfile` bakes
> `MODE=0`. No post-clone patching is required.

#### `register-tee` command letters

`post-build.sh` invokes `register-tee -command rRap`. The letters mean:

| Letter | Meaning                                            |
| ------ | -------------------------------------------------- |
| `r`    | pre-register                                       |
| `R`    | `RequestTeeAttestation` (fresh on-chain challenge) |
| `a`    | availability check                                 |
| `p`    | to-production                                      |

`R` (capital) is the load-bearing bit — it issues a fresh challenge on every
run, so re-runs (image changes, diamond cuts, retries) don't revert with
`Verification.ChallengeExpired`. Don't drop it.

## ⚙️ Configuration files

Keep canonical env files, never edit `.env` by hand:

| File           | Purpose                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `.env.example` | Reference template with every variable + comments — start here on a fresh clone |
| `.env.coston`  | Coston (chain_id 16) settings                                                   |
| `.env.coston2` | Coston2 (chain_id 114) settings                                                 |
| `.env`         | Whichever chain is currently active (overwritten by `use-chain.sh`)             |

Switch active chain with:

```powershell
bash ./scripts/use-chain.sh coston2     # or: coston
```

This copies `.env.<chain>` over `.env` and prints the active `EXT_PROXY_URL` / `CHAIN_URL`. All scripts (`pre-build.sh`, `start-services.sh`, `post-build.sh`, `test.sh`, `full-setup.sh`) auto-load `.env`.

> [!WARNING]
> `pre-build.sh` writes `config/extension.env` with the active chain's `EXTENSION_ID` and `INSTRUCTION_SENDER`. Every re-run overwrites this file — back it up if you still need the previous chain's values:
>
> ```powershell
> Copy-Item config/extension.env config/extension.env.coston.bak
> ```

### Key `.env` variables that differ by chain

Set these in the corresponding `.env.coston` / `.env.coston2` file (whichever you'll activate via `use-chain.sh`):

| Variable           | Coston                                                           | Coston2                                       |
| ------------------ | ---------------------------------------------------------------- | --------------------------------------------- |
| `CHAIN`            | `coston`                                                         | `coston2`                                     |
| `CHAIN_URL`        | `https://coston-api.flare.network/ext/C/rpc`                     | `https://coston2-api.flare.network/ext/C/rpc` |
| `ADDRESSES_FILE`   | `./config/coston/deployed-addresses.json`                        | `./config/coston2/deployed-addresses.json`    |
| `NORMAL_PROXY_URL` | `https://tee-proxy-coston-1.flare.rocks`                         | `https://tee-proxy-coston2-1.flare.rocks`     |
| `EXT_PROXY_URL`    | devops-provided (e.g. `https://tee-proxy-coston-pm.flare.rocks`) | devops-provided                               |

### Key `.env` variables that are the same on both chains

These also go in `.env.coston` / `.env.coston2`:

| Variable                 | Value                       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOCAL_MODE`             | `false`                     | Selects testnet vs local devnet defaults in scripts.                                                                                                                                                                                                                                                                                                                                                                  |
| `SIMULATED_TEE`          | `false`                     | Must be `false` on testnets. Tells `register-tee` to read the real codeHash from the proxy's `/info`. FTDC rejects simulated TEEs.                                                                                                                                                                                                                                                                                    |
| `DEPLOYMENT_PRIVATE_KEY` | `0x…` (hex, no `0x` prefix) | Funded private key used by every deploy + register call. Must hold C2FLR on the target chain.                                                                                                                                                                                                                                                                                                                         |
| `INITIAL_OWNER`          | `0x…` (40-hex)              | Address derived from `DEPLOYMENT_PRIVATE_KEY`. Becomes the extension owner.                                                                                                                                                                                                                                                                                                                                           |
| `PROXY_PRIVATE_KEY`      | `0x…` (hex)                 | Funded key used **only by the local `ext-proxy`** (via `docker-compose.yaml` and `start-services.sh`). On the standard testnet flow where devops hosts the TEE + proxy, you can leave this as the default — devops's proxy uses devops's own key. Only matters if you bring up the local proxy for debugging, in which case it must be funded on the target chain. Can be the same value as `DEPLOYMENT_PRIVATE_KEY`. |
| `REGISTRY`               | unset → `local`             | Docker image registry. Leave commented to use the locally-built `local/tee-proxy` image; set to a remote registry (e.g. a GCP Artifact Registry or GitHub Container Registry path) to pull instead.                                                                                                                                                                                                                  |

### Script-level overrides (not in `.env`)

Most users never set these — they have sane defaults — but they exist for advanced flows:

| Var                   | Default                                | Purpose                                                                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXT_PROXY_HOST_URL`  | same as `EXT_PROXY_URL`                | Override when the host-internal URL (used by `register-tee` for the `-h` flag) differs from the externally-visible URL — e.g. an internal cluster DNS vs the public HTTPS endpoint.                                                                                                                |
| `TEE_VERSION`         | `v0.1.0`                               | Version string written by `AddTeeVersion`. The contract enforces uniqueness per extension: re-using the same `TEE_VERSION` for a different `codeHash` reverts with `VersionAlreadyExists`. Team convention for bumping isn't formalized yet — when in doubt, mirror the image tag (e.g. `v0.1.1`). |
| `WAIT_TIMEOUT`        | `120` (seconds)                        | How long `post-build.sh` waits for the extension + normal proxies to respond `200 OK` on `/info`.                                                                                                                                                                                                  |
| `EXTENSION_OWNER_KEY` | falls back to `DEPLOYMENT_PRIVATE_KEY` | Private key override for `AddTeeVersion`. Use when the extension owner is a different account from the deployer.                                                                                                                                                                                   |

### Docker Compose env / build args

These only matter when you're running the stack locally with `docker compose` — devops's hosted deploy doesn't read them.

| Var                       | Default                             | Purpose                                                                                             |
| ------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `MODE`                    | `1` (compose), `0` (baked in image) | Attestation backend — see [MODE / SIMULATED_TEE](#mode--simulated_tee--the-attestation-pair) below. |
| `LOG_LEVEL`               | `INFO`                              | `extension-tee` log verbosity.                                                                      |
| `SOURCE_DATE_EPOCH`       | current commit timestamp            | Build arg for reproducible image builds — same source tree + same epoch = same `codeHash`.          |
| `REDIS_BIND`              | `127.0.0.1:6382`                    | Host bind for the Redis container.                                                                  |
| `EXT_PROXY_INTERNAL_BIND` | `0.0.0.0:6673`                      | Host bind for the proxy's internal port.                                                            |
| `EXT_PROXY_EXTERNAL_BIND` | `0.0.0.0:6674`                      | Host bind for the proxy's external port.                                                            |
| `COMPOSE_NETWORK`         | `docker_default`                    | External Docker network the services join.                                                          |

### Ports baked into the TEE image

Baked into the Dockerfile (line 67) and rarely changed:

| Var              | Value  | Purpose                                   |
| ---------------- | ------ | ----------------------------------------- |
| `CONFIG_PORT`    | `5501` | Config endpoint inside the TEE container. |
| `SIGN_PORT`      | `7701` | Signature endpoint.                       |
| `EXTENSION_PORT` | `7702` | Extension RPC endpoint.                   |

### Proxy config files

The `ext-proxy` container needs a chain-specific TOML (Redis address, chain_id, indexer DB creds, contract addresses). All live in `config/proxy/`:

| File                                          | Chain        | Where it runs       | Notes                                                                                                                 |
| --------------------------------------------- | ------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `extension_proxy.toml`                        | local devnet | proxy as Go process | Non-Docker; `redis_port = "localhost:…"`.                                                                             |
| `extension_proxy.docker.toml`                 | local devnet | proxy in Docker     | Uses `redis` service name.                                                                                            |
| `extension_proxy.coston.docker.toml`          | Coston       | proxy in Docker     | Committed with real values (chain_id 16, `FlareSystemsManager` / `Relay` / `VoterRegistry`, indexer DB host + creds). |
| `extension_proxy.coston2.docker.toml.example` | Coston2      | proxy in Docker     | **Template** — copy to `.docker.toml` and fill in.                                                                    |
| `extension_proxy.coston2.toml.example`        | Coston2      | proxy as Go process | **Template** — copy to `.toml` and fill in.                                                                           |

#### Annotated example — `extension_proxy.coston.docker.toml`

```toml
# Redis bind. `redis:6379` is the Docker service name (resolved via Compose DNS).
# For the non-Docker `extension_proxy.toml`, use `localhost:6382` (or whatever
# REDIS_BIND points at on the host).
redis_port = "redis:6379"

# Name of the env var holding the proxy's signing key. Read by `tee-proxy` at
# startup; the actual key value is injected via docker-compose (see PROXY_PRIVATE_KEY).
private_key_variable = "PROXY_PRIVATE_KEY"

# Offset into the on-chain signing policy when bootstrapping. 0 = start from the
# current policy.
initial_signing_policy_offset = 0

# How often the proxy re-pulls the active signing policy from chain.
signing_policy_fetch_interval = "20s"

# EVM chain ID. Coston = 16, Coston2 = 114.
chain_id = 16

# Flare indexer DB. The proxy queries this to find TEE-related events and
# instruction responses. Run your own indexer or connect to a public one
# (talk to a Flare team member for access).
[db]
host = "<your-indexer-host>"
port = 3306
database = "indexer"
username = "<your-username>"
password = "<your-password>"
log_queries = false

# Flare system contract addresses the proxy reads from. Chain-specific —
# pulled from the same `deployed-addresses.json` that the extension uses.
[addresses]
flare_systems_manager = "0x85680Dd93755Fe5d0789773fd0896cEE51F9e358"   # signing policies, voter info
relay                 = "0x051f214D346Cfd97B107BECb87E2B35D1b4287E9"   # FTDC proof submission / reads
voter_registry        = "0x42F4526BFC6f892DB515a832a52eFc9edFADf6c0"   # voter membership verification

# Ports the proxy listens on inside the container.
[ports]
internal = "6663"   # TEE-facing — `extension-tee` calls this over the Docker network
external = "6664"   # Public-facing — devops routes HTTPS to this port

# Pacing for the proxy's `/info` cycle. Rarely changed.
[info_timing]
cycle_internal            = "10s"
cycle_queue_response_wait = "2s"

# FTDC voting parameters. Rarely changed.
[voting]
proposal_expiration = "12s"
max_pending_request = 10000
```

The Coston2 variant is structurally identical — only `chain_id`, the `[addresses]` block, and the host portion of the `redis_port` may differ.

Bootstrap the Coston2 configs from the templates before first use:

```bash
cp config/proxy/extension_proxy.coston2.docker.toml.example config/proxy/extension_proxy.coston2.docker.toml
cp config/proxy/extension_proxy.coston2.toml.example         config/proxy/extension_proxy.coston2.toml
```

The chain-specific TOML is mounted into `ext-proxy` by a Compose overlay:

| Overlay                       | Mounts                                | Sets                                                                  |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `docker-compose.coston.yaml`  | `extension_proxy.coston.docker.toml`  | `CHAIN_URL` (Coston RPC), `COMPOSE_NETWORK=sign-coston`               |
| `docker-compose.coston2.yaml` | `extension_proxy.coston2.docker.toml` | `CHAIN_URL` (Coston2 RPC)                                             |

Run a chain-pinned local stack with:

```powershell
docker compose -f docker-compose.yaml -f docker-compose.coston.yaml up -d
# or coston2
```

> [!NOTE]
> These files only matter when you run the **local** `ext-proxy`. On the standard testnet flow with devops hosting the TEE + proxy, you don't touch them — devops maintains the equivalent config inside their own proxy container.

### MODE / SIMULATED_TEE — the attestation pair

`MODE` and `SIMULATED_TEE` must agree or you'll see `code hashes do not match`. For testnet, both must point at "real": **`MODE=0` + `SIMULATED_TEE=false`**.

| Variable        | Where             | `0` / `false` (testnet)                               | `1` / `true` (local dev)                    |
| --------------- | ----------------- | ----------------------------------------------------- | ------------------------------------------- |
| `MODE`          | TEE binary env    | Real GCP Confidential Space JWT                       | Hardcoded simulated attestation             |
| `SIMULATED_TEE` | `.env` (scripts)  | `register-tee` reads real codeHash from proxy `/info` | `register-tee` uses hardcoded test codeHash |

The Dockerfile bakes `MODE=0`; `docker-compose.yaml` overrides to `MODE=1` for local devnet only.

## 📦 Building the Docker image for devops

Devops runs the extension on a GCP Confidential Space VM. They need the image.

`build-image.sh` builds the image for the language in your `.env` (set by
`use-chain.sh`), pins `SOURCE_DATE_EPOCH` for a reproducible `codeHash`, verifies
`MODE=0` is baked in, and saves a tar for the hand-off:

```bash
bash ./scripts/build-image.sh                 # build .env's LANGUAGE, tag v0.1.0, save tar
bash ./scripts/build-image.sh -l typescript   # override the language
bash ./scripts/build-image.sh -v v0.1.1       # set the version/tag
```

It writes `sign-extension-<language>-<version>.tar` and prints the image ID.

> [!NOTE]
> **Picking the language.** All three implementations (Go, Python, TypeScript)
> are deployable and build from this dir with `tee-node` fetched from GitHub —
> no siblings. Cross-machine bit-for-bit reproducibility is guaranteed only on
> the Go path; building Python/TS on a different machine than devops may produce
> a different `codeHash` — see [`REPRODUCIBILITY.md`](REPRODUCIBILITY.md). The
> pragmatic mitigation is to hand devops the exact tar (or a registry push),
> not have them rebuild.

<details>
<summary>Equivalent manual commands</summary>

```bash
export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
docker build -f typescript/Dockerfile -t sign-extension-ts:v0.1.0 .   # or Dockerfile / python/Dockerfile
docker save sign-extension-ts:v0.1.0 -o sign-extension-ts-v0.1.0.tar
docker inspect sign-extension-ts:v0.1.0 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep MODE  # expect MODE=0
```
</details>

> [!NOTE]
> **Why `SOURCE_DATE_EPOCH` matters.** With the build pinned to the commit timestamp, the same source tree always produces the same `codeHash`. That means as long as the code hasn't changed, a rebuild produces the same on-chain whitelist entry — you don't need to re-run `allow-tee-version`. If a rebuild's `codeHash` differs unexpectedly, the build wasn't reproducible (uncommitted changes, different base-image digest, or wrong `SOURCE_DATE_EPOCH`).

> [!TIP]
> Send the tar to devops, or — preferred for prod — push to a registry their VMs can pull from (GCP Artifact Registry, GitLab Container Registry, etc.):
>
> ```bash
> docker tag sign-extension-typescript:v0.1.0 <registry>/<repo>:v0.1.0
> docker push <registry>/<repo>:v0.1.0
> ```

## 🤝 Devops responsibilities

> [!NOTE]
> Devops contact for deploying this extension: **Aljaž Konečnik**.

Devops deploys the image on a **GCP Confidential Space VM** with:

| Setting               | Value                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `MODE`                | `0` (already baked in)                                                                                                          |
| `EXTENSION_ID`        | the value you'll generate in `pre-build` — passed as a container env var (no image rebuild needed; see env_override note below) |
| `INITIAL_OWNER`       | your deployer address                                                                                                           |
| `CHAIN_URL`           | the right chain's RPC                                                                                                           |
| `PROXY_URL`           | the proxy reachable from the TEE                                                                                                |
| `ext-proxy` container | runs with the right `extension_proxy.<chain>.docker.toml` (Coston/Coston2 indexer DB credentials, contract addresses, chain_id) |
| Public HTTPS URL      | routed to port `6664` of the proxy — devops gives you this URL                                                                  |

> [!IMPORTANT]
> **`EXTENSION_ID` is a container env_override, not a baked-in value.** The Dockerfile carries `LABEL "tee.launch_policy.allow_env_override"="LOG_LEVEL,PROXY_URL,INITIAL_OWNER,EXTENSION_ID,CHAIN_URL,MODE,CONFIG_PORT,SIGN_PORT,EXTENSION_PORT"`. Any var in that list can be set at workload launch on the Confidential Space VM. **Changing `EXTENSION_ID` does not require a new image** — devops just restarts the container with the new value. Vars outside this list are pinned by the attestation and require a rebuild + re-whitelist to change.

When devops is up, their `/info` should look like:

```json
{
  "machineData": {
    "platform": "0x4743505f414d445f534556…", // GCP_AMD_SEV (NOT TEST_PLATFORM)
    "codeHash": "0x<real-image-measured-hash>", // NOT 0x194844cf…
    "extensionId": "0x…<your extension id>",
    "initialOwner": "0x<your deployer>"
  },
  "attestation": "<long base64 GCP JWT>" // NOT "magic_pass"
}
```

> [!CAUTION]
> If any of those still show the simulated values, the TEE is running in `MODE=1` and won't pass FTDC.

### 📤 Devops handoff checklist

When you hand a new deployment off to devops, send them this exact set of artifacts. Anything missing turns into a back-and-forth.

| Artifact                            | Source                                             | Example                                                                                  |
| ----------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Image (tar **or** registry URL+tag) | output of `build-image.sh` / `docker push`         | `sign-extension-typescript-v0.1.0.tar` or `<registry>/<repo>:v0.1.0`                |
| `EXTENSION_ID`                      | `config/extension.env` after `pre-build.sh`        | `0x00…001d`                                                                              |
| `INITIAL_OWNER`                     | derived from your `DEPLOYMENT_PRIVATE_KEY`         | `0xaAb2B5619F7c11C72947913B584b8BFec5654Df5`                                             |
| `CHAIN_URL`                         | from `.env.<chain>`                                | `https://coston2-api.flare.network/ext/C/rpc`                                            |
| Chain-specific proxy TOML           | `config/proxy/extension_proxy.<chain>.docker.toml` | mount into `ext-proxy` at `/app/config/config.toml`                                      |
| Required port routing               | public HTTPS → port `6664` of the proxy container  | devops returns the public URL                                                            |
| Required image env                  | `MODE=0` (baked), plus the overrides above         | devops sets `EXTENSION_ID`, `INITIAL_OWNER`, `CHAIN_URL`, `PROXY_URL` at workload launch |

> [!NOTE]
> **`INSTRUCTION_SENDER` is _not_ on this list.** It's the on-chain contract address users call to send instructions; devops's TEE binary never reads it (not in the launch_policy LABEL). Keep it in your local `config/extension.env` for `test.sh` and your own contract interactions.

Devops returns:

- The public proxy URL (set this as `EXT_PROXY_URL` in `.env.<chain>`)
- Confirmation that `/info` is up and matches expectations (use the check below)

### Verifying devops's `/info`

Before running `post-build.sh`, curl the proxy `/info` and check four fields. If any of these is wrong, post-build will fail in a less obvious way — catch it here.

```powershell
curl -s $env:EXT_PROXY_URL/info | jq '{
  platform:        .machineData.platform,
  codeHash:        .machineData.codeHash,
  extensionId:     .machineData.extensionId,
  initialOwner:    .machineData.initialOwner,
  envOverride:     (.attestation | "<JWT — decode separately if needed>")
}'
```

Expected values:

| Field          | Expected                                                                             | If it's wrong                                                         |
| -------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `platform`     | `0x4743505f414d445f534556…` (i.e. `GCP_AMD_SEV` ASCII-hex)                           | TEE running in `MODE=1` — ask devops to redeploy with `MODE=0`.       |
| `codeHash`     | matches the codeHash you'd get by inspecting your built image; **not** `0x194844cf…` | Image is the simulated/test build. Rebuild with `MODE=0`.             |
| `extensionId`  | matches your `config/extension.env` `EXTENSION_ID`                                   | Devops hasn't restarted the container with the new value (Step 11).   |
| `initialOwner` | matches your derived `INITIAL_OWNER`                                                 | Devops set the wrong owner — they need to restart with the right env. |

To verify the JWT's `env_override` block (which is what the Confidential Space VM actually saw at launch), decode the `attestation` field's payload:

```bash
curl -s "$EXT_PROXY_URL/info" \
  | jq -r .attestation \
  | cut -d. -f2 \
  | base64 -d 2>/dev/null \
  | jq '.submods.container.env_override'
```

This should print the env vars devops actually passed at workload launch — `EXTENSION_ID`, `INITIAL_OWNER`, `PROXY_URL`, etc. Use it to confirm Step 11 took effect.

## 🚀 Deployment flow

### Scripts at a glance

| Script                            | What it does                                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use-chain.sh <chain> [language]` | Copies `.env.<chain>` over `.env`; optionally sets `LANGUAGE`. `--list` / `--help` available.                                                                                                                        |
| `build-image.sh`                  | Builds the `LANGUAGE` image (from `.env`), verifies `MODE=0`, saves `sign-extension-<language>-<version>.tar` for the devops hand-off.                                                                               |
| `pre-build.sh`                    | Compiles Solidity, deploys `InstructionSender`, registers the extension, writes `config/extension.env`.                                                                                                              |
| `start-services.sh`               | Brings up local Docker stack (`redis` + `ext-proxy` + `extension-tee`). Not needed for testnet — devops hosts the TEE.                                                                                               |
| `stop-services.sh`                | Tears down the local Docker stack.                                                                                                                                                                                   |
| `post-build.sh`                   | `allow-tee-version` + `register-tee` against the chosen proxy.                                                                                                                                                       |
| `test.sh`                         | End-to-end test (`UPDATE`, `SIGN`).                                                                                                                                                                                  |
| `full-setup.sh`                   | Runs `pre-build` → `start-services` → `post-build` → optionally `test` in one shot. Also fires `extension-setup.sh` (Phase 1.5) and `extension-post-setup.sh` (Phase 3.5) if those scripts exist and are executable. |

> [!CAUTION]
> **Diamond-cut redeploys wipe extension registrations.** When the Flare team redeploys the `FlareTeeManager` diamond on a chain (see e.g. commit `bdb7c80 Updated coston2 deployment with new diamond-cut addresses`), all previously-registered extensions disappear from the registry. You must re-run `pre-build.sh` to register the extension on the new diamond — and **`Register()` auto-mints the next available ID**, which won't match the ID devops's container is currently using. Send only the new `EXTENSION_ID` to devops so they can restart the container with the updated env (no image rebuild needed — `EXTENSION_ID` is in the launch_policy override list). `INSTRUCTION_SENDER` stays in your local `config/extension.env` — devops doesn't need it. Only after the container restart does `post-build.sh` succeed.

Once devops has the proxy live and your `.env.<chain>` is configured, choose one of:

### Option A — one-shot (recommended)

```powershell
bash ./scripts/use-chain.sh coston    # or coston2
bash ./scripts/full-setup.sh --chain coston --test
```

Phases:

| #   | Phase                               | What it does                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Pre-build**                       | Compiles Solidity, deploys a fresh `InstructionSender`, registers a new extension, writes `config/extension.env` with `EXTENSION_ID` and `INSTRUCTION_SENDER`.                                                                                                                                       |
| 1.5 | **Extension setup** (optional)      | Runs `scripts/extension-setup.sh` if present and executable — hook for extension-specific config (key types, allowed owners, etc.).                                                                                                                                                                  |
| 2   | **Start-services**                  | _Skipped_ in this scenario because the actual TEE runs on devops's VM. Phase will still run a local `docker compose up` for `redis`/`ext-proxy`/`extension-tee`, but for testnet you can ignore those and rely on devops's hosted proxy. (To skip entirely, run phases individually — see Option B.) |
| 3   | **Post-build**                      | `allow-tee-version` whitelists the real codeHash from the hosted proxy's `/info`; `register-tee -command rRap` pre-registers the new TEE on-chain, requests fresh attestation, runs FTDC availability check, moves the TEE to production.                                                            |
| 3.5 | **Extension post-setup** (optional) | Runs `scripts/extension-post-setup.sh` if present and executable — hook for post-registration config (initial state, proxy keys, etc.).                                                                                                                                                              |
| 4   | **Test**                            | Sends an `UPDATE` (store an encrypted key) then `SIGN` instruction and verifies the recovered signer matches.                                                                                                                                                                                        |

### Option B — phase-by-phase (clearer for testnet)

```powershell
bash ./scripts/use-chain.sh coston

# Phase 1: deploy contract + register extension on chain
bash ./scripts/pre-build.sh

# Phase 2 SKIPPED — devops hosts the TEE; you only need EXT_PROXY_URL pointing at it (ask devops to send it to you)

# Phase 3: whitelist codeHash + register TEE machine + FTDC availability check
bash ./scripts/post-build.sh

# Phase 4: end-to-end test
bash ./scripts/test.sh
```

### Expected output

<details>
<summary><strong>✅ Successful <code>post-build</code></strong></summary>

```text
[post-build] Extension proxy: https://tee-proxy-coston-pm.flare.rocks
[post-build] Normal proxy:    https://tee-proxy-coston-1.flare.rocks
[post-build] Extension proxy is ready
[post-build] Normal proxy is ready

=== Step 1: Allow TEE version ===
... Code hash:    0x0c5964c3…       (real GCP-measured)
... Platform:     0x4743505f…       (GCP_AMD_SEV)

=== Step 2: Register TEE machine ===
... (pre)registration of TEE … succeeded
... tee attestation requested, instructionId: …
... availability check sent, instructionId: …
... availability check proof obtained
... Registered TEE node with id 0x…
```

The "availability check proof obtained" line is the FTDC quorum confirming your TEE. Typical latency: **5–10 seconds** with a real GCP attestation.

</details>

<details>
<summary><strong>✅ Successful <code>test.sh</code></strong></summary>

```text
Step 3: Sending updateKey instruction on-chain...
  updateKey succeeded (status=1)
Step 5: Sending sign instruction on-chain...
  Recovered signer: 0x96216849c49358B10257cb55b28eA603c874b05E
  Expected signer:  0x96216849c49358B10257cb55b28eA603c874b05E
All tests passed.
```

</details>

## 🐛 Troubleshooting

Expand the entry that matches your error.

<details>
<summary><strong><code>connect: connection refused</code> (ext-proxy)</strong></summary>

Your indexer DB is unreachable. Check your connection, then:

```powershell
docker compose restart ext-proxy
```

</details>

<details>
<summary><strong><code>json: cannot unmarshal hex string without 0x prefix into ... TeeInfoResponse.attestation of type hexutil.Bytes</code></strong></summary>

Stale `local/tee-proxy` image built before the `tee-node` `Attestation` field changed from `hexutil.Bytes` to `string`. Force a rebuild — `start-services.sh` rebuilds it from the self-contained `proxy/Dockerfile` (which clones a current `tee-proxy` + `tee-node` from GitHub):

```bash
docker compose down
docker rmi local/tee-proxy
bash ./scripts/start-services.sh --chain coston
```

</details>

<details>
<summary><strong><code>Verification.TeeNotFound</code></strong></summary>

`NORMAL_PROXY_URL` is pointed at the wrong chain's FTDC proxy.

| Chain   | Correct host                      |
| ------- | --------------------------------- |
| Coston  | `tee-proxy-coston-1.flare.rocks`  |
| Coston2 | `tee-proxy-coston2-1.flare.rocks` |

Fix `.env.<chain>` and re-run.

</details>

<details>
<summary><strong><code>Verification.ChallengeExpired</code></strong></summary>

TEE machine is already registered on-chain but `register-tee` skipped attestation refresh. Confirm `post-build.sh` was patched to pass `-command rRap`. If running `register-tee` manually, include that flag.

</details>

<details>
<summary><strong><code>register-tee</code> fails at <code>ToProduction</code> with <code>execution reverted</code> after a successful availability check</strong></summary>

**This is now guarded.** `ToProduction` in `fccutils/registration.go` first reads the on-chain TEE status and, if it's already `PRODUCTION`, logs `already in production, skipping` and returns instead of reverting — so re-running `post-build.sh` is safe. You'll only hit the raw `execution reverted` from `toProduction(...)` on an older build without the guard.

**Why it happens:** the contract's state machine is one-way (`REGISTERED → PRODUCTION`), so re-calling `toProduction(...)` on a TEE already in production reverts.

**Confirm it's benign:** run `bash ./scripts/test.sh`. If the `UPDATE` / `SIGN` round-trip passes (recovered signer matches the expected signer), the deployment is healthy.

If `test.sh` also fails, see *Want a clean re-registration of the TEE machine* below — deleting `config/register-tee.state` and re-running `post-build.sh` is the next move.

</details>

<details>
<summary><strong><code>TeeExtensionRegistry.AddTeeVersion failed: execution reverted</code></strong></summary>

`allow-tee-version` is trying to whitelist a codeHash for an extension that either doesn't exist on the active diamond or isn't owned by the caller.

**Most common cause:** the `FlareTeeManager` diamond was redeployed (see the diamond-cut callout in [Deployment flow](#-deployment-flow)) and your extension hasn't been re-registered on it. Verify by querying `getExtensionOwner(<id>)`:

```powershell
# Example for Coston2 — replace <ID> with your extension ID in 64-hex form
curl -s -X POST $env:CHAIN_URL `
  -H "Content-Type: application/json" `
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"<FlareTeeManager>","data":"0x5e46e380<ID>"},"latest"]}'
```

If it returns `0x000…000`, the extension isn't registered. Run `pre-build.sh` to mint a fresh one, send the new `EXTENSION_ID` + `INSTRUCTION_SENDER` to devops, then re-run `post-build.sh`.

Other cause: `EXTENSION_OWNER_KEY` (or `DEPLOYMENT_PRIVATE_KEY` if not overridden) doesn't match the extension's owner address. Check the owner with the same `getExtensionOwner` call.

</details>

<details>
<summary><strong>Want a clean re-registration of the TEE machine</strong></summary>

`register-tee` caches state at `config/register-tee.state` (path is set by `post-build.sh:142`). If you need to force every step to run from scratch — e.g. after rotating the TEE keypair — delete it:

```powershell
Remove-Item config/register-tee.state -ErrorAction SilentlyContinue
```

Then re-run `post-build.sh`. The `-command rRap` flag will pre-register, request a fresh attestation, run the availability check, and promote to production.

</details>

<details>
<summary><strong><code>code hashes do not match: 0x194844cf…, 0x&lt;other&gt;</code></strong></summary>

`SIMULATED_TEE=true` is set but the proxy reports a real GCP attestation hash (or vice versa). Set `SIMULATED_TEE=false` in `.env` when running against a real Confidential Space TEE.

</details>

<details>
<summary><strong><code>404</code> / <code>'not found': response not in storage</code> from FTDC normal proxy</strong></summary>

The FTDC normal-proxy hasn't recorded your availability-check instruction. Most common causes:

1. **Simulated TEE** — Flare's Coston/Coston2 FTDC rejects `TEST_PLATFORM` / hardcoded simulated codeHash. Deploy on a real Confidential Space VM.
2. **Flare-side event-listener stuck** — the FTDC normal proxy is alive (`/info` responds) but its chain indexer fell behind. Wait and retry, or contact Flare ops.

</details>

<details>
<summary><strong>Stale <code>extensionId</code> in proxy <code>/info</code></strong></summary>

The proxy is reporting an older `extensionId` than the one `pre-build.sh` just minted. The fix differs by flow:

**Testnet (devops-hosted TEE + proxy).** Devops hasn't restarted their container with the new `EXTENSION_ID` env override yet. Send them the new value from `config/extension.env` and ask them to restart the container — see Step 11 in the [first-time deployment checklist](#%EF%B8%8F-first-time-deployment-checklist). Running `stop-services.sh` / `full-setup.sh` locally does **not** help: those touch only your local Docker stack, not devops's hosted containers.

**Local devnet.** Local `extension-tee` was restarted with a new `EXTENSION_ID` but the local `ext-proxy` is still serving cached info. Full reset:

```powershell
bash ./scripts/stop-services.sh --chain coston
bash ./scripts/full-setup.sh --chain coston --test
```

</details>

<details>
<summary><strong><code>Error loading .env file</code> warning from Go tools</strong></summary>

Cosmetic. The Go tools also look for an `.env` in the current working directory (e.g. `tools/`), which doesn't exist. The bash scripts already loaded the real `.env` from project root before invoking them, so env vars are passed in correctly. Ignore.

</details>

## 🔄 Re-deployment after image updates

Whenever the extension code or Dockerfile changes:

1. Bump version, build, hand off the new tar/registry image to devops.
2. Devops re-deploys their Confidential Space VM with the new image — the **codeHash will change**.
3. On your side, switch to the right chain and re-run `post-build.sh`:
   - `allow-tee-version` whitelists the new codeHash (must be the extension owner).
   - `register-tee` re-registers the TEE machine.
4. Re-run `test.sh` to verify.

> [!NOTE]
> If devops keeps the **same** TEE keypair across redeploys, the pre-registration step is skipped (the address is already known). If they generate a new keypair, `register-tee` performs full pre-registration again.

## 🧹 Lifecycle & decommissioning

Extension IDs are **permanent** — once `Register()` mints an ID, the diamond has no `removeExtension` / `retireExtension` primitive. What you _can_ do, all callable from the extension owner:

| Operation               | Call                                                                                       | Effect                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Transfer ownership      | `proposeNewOwner(extensionId, newOwner)` → recipient calls `confirmOwnership(extensionId)` | 2-step transfer to a new owner                                                  |
| Retire a specific build | `disableCodeHashPlatform(extensionId, codeHash, platform)`                                 | Subsequent attestations matching that `(codeHash, platform)` pair are rejected  |
| Re-point contracts      | `setExtensionContracts(...)`                                                               | Re-target the extension to a redeployed `InstructionSender` / state verifier    |

See the `ExtensionManager` ABI in `tools/pkg/contracts/` for the full surface. No script wrappers exist in the scaffold yet — invoke with `cast send` or a one-off Go tool.

## 📚 Reference: working configuration

Last updated **2026-05-27**:

|                 | Coston                                       | Coston2                                                                     |
| --------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| Status          | ✅ Verified working 2026-05-14               | ✅ Verified working 2026-05-27 (Go + Python slim, diamond-cut `bdb7c80`)    |
| Chain ID        | 16                                           | 114                                                                         |
| `tee-node` ref  | v0.0.20 (Go module + image clone)            | v0.0.20                                                                     |
| `tee-proxy` ref | v0.0.17 (Go module) · `main` (proxy image)   | same                                                                        |
| Image tag       | `sign-extension-<language>:v0.1.0`           | same                                                                        |
| `MODE`          | `0`                                          | `0`                                                                         |
| `SIMULATED_TEE` | `false`                                      | `false`                                                                     |
| FlareTeeManager | `0xb7DeFeCfe34f378652Ca5DceB2bF1c01604DEA09` | `0x004224fa1BF1Acd3D233f011FB03b8dd5fA5d41F` (diamond-cut commit `bdb7c80`) |

## 🔗 Related docs

| Doc                                            | What it covers                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [`README.md`](README.md)                       | Layout, language selection, local devnet flow, scripts overview  |
| [`deployment-steps.md`](deployment-steps.md)   | The concise linear deploy recipe (step-by-step)                  |
| [`REPRODUCIBILITY.md`](REPRODUCIBILITY.md)     | `SOURCE_DATE_EPOCH`, build context, and reproducible image builds |
| [`python/`](python/) · [`typescript/`](typescript/) | Per-language extension source + framework notes             |

<div align="center">

[← Back to README](README.md)

</div>
