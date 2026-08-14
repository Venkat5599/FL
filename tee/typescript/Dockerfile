# Sign extension — TypeScript implementation, deployable on Coston/Coston2.
#
# Build context is the sign extension dir (extensions/sign/). tee-node is cloned
# from the published GitHub repo during the build, so no on-disk sibling
# checkout is required. To build directly:
#   docker build -f typescript/Dockerfile -t sign-typescript .
#
# Reproducibility: this image aims for *same-machine* determinism via apt
# snapshot pinning, SOURCE_DATE_EPOCH propagation, npm ci against the
# committed lockfile, and mtime normalization. node_modules trees vary
# across npm versions, so full cross-machine bit-for-bit parity with the Go
# image is not guaranteed — see REPRODUCIBILITY.md for the honest caveats.

# --- Stage 1: build tee-node ./server from cloned tee-node source ---
# Same digest-pinned golang image as the Go Dockerfile, so the server binary
# bytes are identical regardless of which language extension uses it.
FROM golang:1.25.1-trixie@sha256:ff83f3762390c2cccb53618ccc18af23e556aff9b1db4428637e9f63287c8171 AS node-builder

ARG SOURCE_DATE_EPOCH
ENV SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH

WORKDIR /build

# tee-node is cloned from the published GitHub repo at build time — no on-disk
# sibling checkout required. Override the ref with the TEE_NODE_VERSION build arg.
ARG TEE_NODE_VERSION=v0.0.21
RUN git clone --depth 1 --branch ${TEE_NODE_VERSION} https://github.com/flare-foundation/tee-node.git ./tee-node

WORKDIR /build/tee-node

RUN go mod download
RUN go mod verify

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOFLAGS="-buildvcs=false" \
    go build -trimpath -ldflags="-buildid= -s -w" -o /app/server ./cmd/extension

# --- Stage 2: build the TypeScript extension ---
# node:22 on debian:trixie matches the apt snapshot toolchain. Pin by digest
# before cutting a testnet release — see REPRODUCIBILITY.md.
FROM node:22-trixie AS ext-builder

WORKDIR /ext

# npm ci installs the exact tree the lockfile declares; package-lock.json is
# the reproducibility anchor here.
COPY --chmod=644 --chown=0:0 typescript/package.json typescript/package-lock.json ./
RUN npm ci

COPY --chmod=644 --chown=0:0 typescript/ ./
RUN npm run build

# Prune devDependencies so the runtime image only carries what main.js needs.
RUN npm prune --omit=dev

# --- Stage 3: runtime with node ---
# NOTE: pin this with a sha256 digest before cutting a testnet release.
FROM debian:trixie-slim AS runtime

ARG SOURCE_DATE_EPOCH
ENV SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH

WORKDIR /app

# Redirect apt at snapshot.debian.org keyed on SOURCE_DATE_EPOCH so the
# nodejs / ca-certificates install resolves to the same package set on every
# rebuild. Adapted from https://github.com/reproducible-containers/repro-sources-list.sh/blob/master/alternative/Dockerfile.debian-13
RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  : "${SOURCE_DATE_EPOCH:=$(stat --format=%Y /etc/apt/sources.list.d/debian.sources)}" && \
  snapshot="$(/bin/bash -euc "printf \"%(%Y%m%dT%H%M%SZ)T\n\" \"${SOURCE_DATE_EPOCH}\"")" && \
  sed -i -e '/Types: deb/ a\Snapshot: true' /etc/apt/sources.list.d/debian.sources && \
  rm -f /etc/apt/apt.conf.d/docker-clean && \
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' >/etc/apt/apt.conf.d/keep-cache && \
  apt-get install --update --snapshot "${snapshot}" -o Acquire::Check-Valid-Until=false -o Acquire::https::Verify-Peer=false -y ca-certificates && \
  apt-get install --snapshot "${snapshot}" -y ca-certificates nodejs && \
  rm -rf /var/log/* /var/cache/ldconfig/aux-cache

# Copy the tee-node server binary, certificate bundle, and the compiled
# TypeScript extension with its production node_modules.
COPY --chmod=755 --chown=0:0 --from=node-builder /app/server /app/server
COPY --chmod=644 --chown=0:0 --from=node-builder /build/tee-node/assets/google_confidential_space_root.crt /app/assets/google_confidential_space_root.crt
COPY --chmod=644 --chown=0:0 --from=ext-builder /ext/dist /app/extension/dist
COPY --chmod=644 --chown=0:0 --from=ext-builder /ext/node_modules /app/extension/node_modules
COPY --chmod=644 --chown=0:0 --from=ext-builder /ext/package.json /app/extension/package.json

# Normalize mtimes across everything in /app so layer hashes are stable.
RUN find /app -exec touch -h -d @${SOURCE_DATE_EPOCH} {} +

# Production mode by default; docker-compose.yaml overrides to MODE=1 for local dev.
# Ports match the Go image so docker-compose.yaml's port mappings work uniformly.
ENV MODE=0 CONFIG_PORT=5501 SIGN_PORT=7701 EXTENSION_PORT=7702

# Match tee-node: run as root inside the workload — the TEE isolation boundary
# handles confidentiality.
USER 0:0

# Confidential Space launch policy: allow the operator to override these env
# vars at workload launch. Must match the Go image's set.
LABEL "tee.launch_policy.allow_env_override"="LOG_LEVEL,PROXY_URL,INITIAL_OWNER,EXTENSION_ID,CHAIN_URL,MODE,CONFIG_PORT,SIGN_PORT,EXTENSION_PORT"

EXPOSE 5501 7701 7702

# Two-process layout: tee-node ./server handles config/sign endpoints and
# proxies user actions to the extension on EXTENSION_PORT. If either dies, the
# container exits so the orchestrator can restart it.
# /bin/bash, not /bin/sh: dash (Debian's /bin/sh) does not implement `wait -n`,
# which we need to exit as soon as either child process dies.
CMD ["/bin/bash", "-c", "/app/server & SERVER_PID=$!; node /app/extension/dist/main.js & EXT_PID=$!; wait -n $SERVER_PID $EXT_PID; kill -TERM $SERVER_PID $EXT_PID 2>/dev/null; exit 1"]
