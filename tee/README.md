# TEE Extension Example — Private Key Manager (sign)

An example TEE extension that stores a private key and signs messages with it.

> **Warning**: This repo is for demonstration purposes only. Storing encrypted
> secrets on-chain is not advisable in production — on-chain data is public
> and encryption can be broken over time. A production extension should use
> off-chain channels for secret delivery.

## Layout & deployable surface

This repo contains three implementations of the same extension. All three are
deployable to Coston/Coston2 — pick which one runs in the TEE by setting
`LANGUAGE` in `.env.<chain>`:

| Language   | Directory                    | Dockerfile                                              | Notes                                                            |
| ---------- | ---------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| Go         | [`go/`](go/)                 | [`Dockerfile`](Dockerfile)                              | Bit-for-bit reproducible across machines.                        |
| Python     | [`python/`](python/)         | [`python/Dockerfile`](python/Dockerfile)                | Same-machine reproducible; cross-machine is best-effort.         |
| TypeScript | [`typescript/`](typescript/) | [`typescript/Dockerfile`](typescript/Dockerfile)        | Same-machine reproducible; cross-machine is best-effort.         |

```bash
# .env.coston2
LANGUAGE=python    # or go (default), or typescript
```

`scripts/start-services.sh` maps `LANGUAGE` to the right Dockerfile via
`EXTENSION_DOCKERFILE`, which `docker-compose.yaml` then uses for the
`extension-tee` build. The on-chain registration tooling under `go/tools/`
runs on the developer machine, never inside the TEE, and stays in Go regardless
of the language choice.

The cross-machine reproducibility gap on Python/TS comes from pip wheels and
`node_modules` trees that embed build-host paths and timestamps. The Go path
sidesteps this by compiling to a single static binary. See
[`REPRODUCIBILITY.md`](REPRODUCIBILITY.md) for the full caveats — short version:
if a different machine rebuilds a Python/TS image, the attested code hash may
differ and the TEE will need to be re-registered.

### Running the hackathon-style language tests

| Language   | Test command                                                        |
| ---------- | ------------------------------------------------------------------- |
| Go         | `cd go && go test ./...`                                            |
| Python     | `cd python && python3 -m unittest discover -s tests -p 'test_*.py'` |
| TypeScript | `cd typescript && npm ci && npm test`                               |

## Shared contract

`contracts/InstructionSender.sol` is shared across all implementations. It
declares `OP_TYPE_KEY = bytes32("KEY")`, `OP_COMMAND_UPDATE = bytes32("UPDATE")`
and `OP_COMMAND_SIGN = bytes32("SIGN")` and exposes `updateKey(bytes)` and
`sign(bytes)` entry points that route through the Flare TEE Manager diamond.

## Deploying and Testing

The full testnet flow (Coston/Coston2 with a devops-hosted Confidential Space
VM) is documented in [`testnet-deployment.md`](testnet-deployment.md). The
short version:

```bash
bash ./scripts/use-chain.sh coston2       # or coston
bash ./scripts/full-setup.sh --chain coston2 --test
```

For local development against a Hardhat devnet + locally-built Docker stack:

```bash
bash ./scripts/use-chain.sh local
bash ./scripts/full-setup.sh --test       # defaults to --chain local
```

Each phase can also be run individually:

```bash
./scripts/pre-build.sh         # 1. Deploy contract + register extension → config/extension.env
./scripts/start-services.sh    # 2. Docker compose up (redis + ext-proxy + extension-tee)
./scripts/post-build.sh        # 3. Allow TEE version + register TEE machine on-chain
./scripts/test.sh              # 4. End-to-end UPDATE/SIGN test against the running TEE
./scripts/stop-services.sh     # Tear down
```

To build a hand-off image for a devops-hosted TEE (instead of the local stack),
use `./scripts/build-image.sh` — it builds the `LANGUAGE` from `.env`, verifies
`MODE=0`, and saves a tar. See [`deployment-steps.md`](deployment-steps.md).

### Prerequisites

- **Docker Desktop** (Linux containers) — for the local stack
- **Go 1.25.1+** — for the deploy + registration tools in `go/tools/`
- **Foundry** (`forge`, `cast`, `jq`) — for Solidity compilation and contract bindings
- **Bash** — Git Bash works on Windows
- **No sibling repos needed** — `tee-node` and `tee-proxy` are fetched from the
  public `github.com/flare-foundation` repos at build time (Go modules pinned in
  `go.sum`; the proxy image `git clone`s them). A flat checkout of just this repo
  is enough.
- **A funded private key** for the target chain. Set as `DEPLOYMENT_PRIVATE_KEY`
  in `.env.<chain>` (no `0x` prefix). Fund at
  [`faucet.flare.network`](https://faucet.flare.network/).
- For Coston/Coston2 deploys: a devops contact who'll run the TEE on a real
  GCP Confidential Space VM. See `testnet-deployment.md` for the full handoff.

### Chain selection

`.env` is a per-chain file. `scripts/use-chain.sh <chain> [language]` copies the
active chain's template (`.env.coston` or `.env.coston2`) over `.env`, optionally
setting `LANGUAGE` (`go`|`python`|`typescript`). Use `--list` to see available
chains and languages, or `--help` for usage. All scripts then source `.env`
automatically.

| Chain     | `.env.<chain>`  | Addresses file                          | RPC                                              |
| --------- | --------------- | --------------------------------------- | ------------------------------------------------ |
| local     | `.env.example`  | `e2e/docker/sim_dump/deployed-addresses.json` (auto-detected) | `http://127.0.0.1:8545`                          |
| coston    | `.env.coston`   | `config/coston/deployed-addresses.json` | `https://coston-api.flare.network/ext/C/rpc`     |
| coston2   | `.env.coston2`  | `config/coston2/deployed-addresses.json`| `https://coston2-api.flare.network/ext/C/rpc`    |

### Generated artifacts

`pre-build.sh` writes the new `EXTENSION_ID` and `INSTRUCTION_SENDER` to
`config/extension.env`. Every subsequent script (`start-services`, `post-build`,
`test`) reads this file automatically — no manual `.env` edits required.

## Reproducible builds

The Go `Dockerfile` is bit-for-bit reproducible: same source + same
`SOURCE_DATE_EPOCH` yields an identical image on any host. The Python and
TypeScript Dockerfiles use the same apt snapshot + mtime normalization tricks
and reach same-machine determinism, but cross-machine bit-for-bit is not
guaranteed because of compiled pip wheels and varying `node_modules` trees.
See [`REPRODUCIBILITY.md`](REPRODUCIBILITY.md).

## Troubleshooting

See `testnet-deployment.md` § Troubleshooting for the full catalogue. Common
issues:

- **`connect: connection refused` from ext-proxy** — your indexer DB is
  unreachable. Check your indexer host/creds and network connectivity.
- **`Verification.TeeNotFound`** — `NORMAL_PROXY_URL` is pointed at the wrong
  chain's FTDC proxy.
- **`Verification.ChallengeExpired`** — re-run `post-build.sh`; the patched
  `register-tee` already passes `-command rRap` for fresh attestation.
- **`code hashes do not match`** — `SIMULATED_TEE` and the TEE's `MODE` env
  disagree. Both must point at "real" for testnet (`SIMULATED_TEE=false`,
  `MODE=0`).

## Related docs

| Doc                                            | What it covers                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [`testnet-deployment.md`](testnet-deployment.md) | End-to-end Coston/Coston2 deploy with devops handoff             |
| [`REPRODUCIBILITY.md`](REPRODUCIBILITY.md)       | `SOURCE_DATE_EPOCH` and reproducible image builds                |
| [`go/`](go/)                                    | Go extension binary + deploy/registration tooling                |
| [`python/`](python/)                            | Python extension (deployable; select with `LANGUAGE=python`)     |
| [`typescript/`](typescript/)                    | TypeScript extension (deployable; select with `LANGUAGE=typescript`) |
