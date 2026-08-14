# Reproducible Builds

The sign extension produces reproducible Docker images. Given the same source
code, the **Go** image is bit-for-bit identical regardless of when or where it
is built. The **Python** and **TypeScript** images aim for the same property
and apply the same reproducibility levers (apt snapshot pinning,
`SOURCE_DATE_EPOCH`, mtime normalization), but they reach only *same-machine*
determinism — see [Cross-machine gaps for Python and TypeScript](#cross-machine-gaps-for-python-and-typescript)
below.

## How it works

- `SOURCE_DATE_EPOCH` is set to the commit timestamp and passed as a build arg
  to clamp all timestamps
- Go binary is built with `-trimpath -ldflags="-buildid= -s -w"` and
  `-buildvcs=false` to strip non-deterministic metadata; `CGO_ENABLED=0`
  produces a static binary so link-time libc variance cannot leak in
- Base image digest is pinned in the Dockerfile
- Debian package versions are pinned via apt's native snapshot support
  (Debian 13+): `Snapshot: true` in the sources file plus
  `apt-get install --snapshot <SOURCE_DATE_EPOCH>` redirects every fetch to
  [snapshot.debian.org](https://snapshot.debian.org) at the exact instant of
  the commit, so the same `SOURCE_DATE_EPOCH` always yields the same package
  bytes. Adapted from
  [reproducible-containers/repro-sources-list.sh](https://github.com/reproducible-containers/repro-sources-list.sh/blob/master/alternative/Dockerfile.debian-13)
- CI uses BuildKit's [`rewrite-timestamp=true`](https://github.com/moby/buildkit/pull/4057)
  exporter option to normalize layer timestamps

## Build context

The build context is the sign extension directory itself (`extensions/sign/`) —
no parent `tee/` directory and no on-disk sibling repos. `go/go.mod` has no
`replace` directive: it pins `tee-node v0.0.20` and the build fetches it from
the network (verified against `go/go.sum`). The Go `Dockerfile` copies only
`go/` and builds `./cmd/docker`.

The Python and TypeScript Dockerfiles build from the same `extensions/sign/`
context. Instead of copying a local `tee-node`, they `git clone` it from
GitHub at build time (pinned via the `TEE_NODE_VERSION` build arg, default
`v0.0.20`) to compile the `./cmd/extension` server binary, then copy in just
their own `python/` or `typescript/` source. `scripts/start-services.sh` selects
the per-language Dockerfile via `EXTENSION_DOCKERFILE`.

## Cross-machine gaps for Python and TypeScript

The Go image compiles to a single static binary in a distroless layer. Nothing
between the source and the final bytes can leak host state. Python and
TypeScript don't have that luxury:

- **Python**: pip installs precompiled wheels for `pycryptodome` and `coincurve`
  whose `.so` files embed build-host paths in `RECORD` metadata and (on some
  wheel formats) embedded compiler timestamps. Forcing `--no-binary :all:`
  pushes the compile into the build but moves the determinism problem to the
  C toolchain.
- **TypeScript**: `npm ci` installs the exact tree the lockfile declares, but
  `node_modules` directories accumulate per-file metadata (mtimes, install
  scripts' side effects) that vary by npm version even on the same lockfile.
  We `find -exec touch` after install to normalize mtimes, but content hashes
  for some packages can still diverge if a transitive postinstall hook ran on
  one host but not another.

In practice: on the *same* host, rebuilding the Python or TypeScript image
from the same commit produces the same image ID. On a *different* host, the
image ID may differ even with identical `SOURCE_DATE_EPOCH`. This matters for
Confidential Space attestation — the `codeHash` registered on-chain in
`post-build.sh` corresponds to whichever host built the image devops is
running. If devops rebuilds on their own infra, the codeHash will change and
the TEE has to be re-registered.

The pragmatic mitigations are:

1. Always build the testnet image on a *single* dedicated machine (or CI
   runner) and hand the image off to devops by registry pull, not rebuild.
2. If you must allow rebuilds, plan for `post-build.sh` to run after every
   rebuild so the new codeHash is whitelisted.
3. Pin the Python/TS Dockerfile runtime images by sha256 digest before cutting
   a release — both files currently use the tag form (`debian:trixie-slim`,
   `node:22-trixie`) with a `NOTE: pin this with a sha256 digest before
   cutting a testnet release` marker.

## Verifying a remote image

The default Docker builder does not properly support `rewrite-timestamp`
([moby/buildkit#4230](https://github.com/moby/buildkit/issues/4230)). You need
a BuildKit builder using the `docker-container` driver.

Create the builder (one-time setup):

```sh
docker buildx create --driver=docker-container --name=moby-buildkit --driver-opt image=moby/buildkit --bootstrap
```

Clone just the sign extension — no sibling repos needed (`tee-node` is fetched
from GitHub during the build):

```sh
git clone <sign-extension repo> sign && cd sign
```

Then, from the repo root:

```sh
TAG=$(git describe --tags --abbrev=0)
git checkout "$TAG"

docker buildx build --builder moby-buildkit --platform linux/amd64 --no-cache \
  --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
  --output "type=docker,rewrite-timestamp=true" \
  -t local/sign-extension:verify --load -f Dockerfile .

docker pull --platform linux/amd64 <registry>/sign-extension:"$TAG"

docker inspect --format='{{.Id}}' local/sign-extension:verify
docker inspect --format='{{.Id}}' <registry>/sign-extension:"$TAG"
```

Both IDs should be identical.

## Upstream references

- [moby/buildkit#3180](https://github.com/moby/buildkit/issues/3180) -
  `rewrite-timestamp` only clamps timestamps *down* to `SOURCE_DATE_EPOCH`,
  older timestamps are left unchanged. The Dockerfile works around this with
  an explicit `find + touch` to normalize all timestamps before COPY.
- [moby/buildkit#4057](https://github.com/moby/buildkit/pull/4057) - PR that
  added `rewrite-timestamp` support to BuildKit exporters
- [moby/buildkit#4230](https://github.com/moby/buildkit/issues/4230) - open
  issue tracking `rewrite-timestamp` incompatibility with the default Docker
  builder and `--load` (`unpack` conflict)
