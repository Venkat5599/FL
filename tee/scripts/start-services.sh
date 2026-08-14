#!/usr/bin/env bash
#
# Start extension TEE node and proxy.
#
# By default, starts services via Docker Compose, picking the compose overlay
# from --chain (or env CHAIN, or legacy LOCAL_MODE):
#   --chain local    → docker-compose.yaml only (local devnet)
#   --chain coston   → + docker-compose.coston.yaml
#   --chain coston2  → + docker-compose.coston2.yaml
#
# Pass --local to start services as background Go processes instead of Docker.
#
# Usage:
#   ./scripts/start-services.sh                       # local devnet, docker compose
#   ./scripts/start-services.sh --chain coston        # Coston, docker compose
#   ./scripts/start-services.sh --local               # local devnet, Go processes
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[start-services]${NC} $*"; }
die()  { echo -e "${RED}[start-services] ERROR:${NC} $*" >&2; exit 1; }

USE_LOCAL=false
CHAIN_ARG=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --local) USE_LOCAL=true; shift ;;
        --chain) [[ $# -ge 2 ]] || die "--chain requires a value (local|coston|coston2)"
                 CHAIN_ARG="$2"; shift 2 ;;
        --chain=*) CHAIN_ARG="${1#--chain=}"; shift ;;
        *) die "Unknown argument: $1" ;;
    esac
done

if [[ -f "$PROJECT_DIR/.env" ]]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi

CONFIG_FILE="$PROJECT_DIR/config/extension.env"
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
fi

# Chain precedence: an explicit --chain wins; otherwise use CHAIN from .env
# (set by use-chain.sh); otherwise fall back to the LOCAL_MODE default below.
CHAIN="${CHAIN_ARG:-${CHAIN:-}}"

EXTENSION_ID="${EXTENSION_ID:-}"
PROXY_PRIVATE_KEY="${PROXY_PRIVATE_KEY:-0x983760a4ebf75b2ac3a93531168a0f225d01e5dc6e3568adbd46233ba1fb4fa4}"
LOCAL_MODE="${LOCAL_MODE:-true}"
LANGUAGE="${LANGUAGE:-go}"

if [[ -z "$CHAIN" ]]; then
    if [[ "$LOCAL_MODE" == "true" ]]; then
        CHAIN="local"
    else
        CHAIN="coston2"
    fi
fi
case "$CHAIN" in
    local|coston|coston2) ;;
    *) die "Unknown --chain value: $CHAIN (valid: local, coston, coston2)" ;;
esac

# Map LANGUAGE -> Dockerfile. All three build from this dir (docker-compose.yaml
# pins context: .) and fetch tee-node from the network — no sibling repos.
# docker-compose.yaml reads EXTENSION_DOCKERFILE via interpolation; leaving
# LANGUAGE=go gives the default Go path.
case "$LANGUAGE" in
    go)         export EXTENSION_DOCKERFILE="Dockerfile" ;;
    python)     export EXTENSION_DOCKERFILE="python/Dockerfile" ;;
    typescript) export EXTENSION_DOCKERFILE="typescript/Dockerfile" ;;
    *) die "Unknown LANGUAGE: $LANGUAGE (valid: go, python, typescript)" ;;
esac

[[ -n "$EXTENSION_ID" ]] || die "EXTENSION_ID not set. Run pre-build.sh first or set it manually."

log "Chain:        $CHAIN"
log "Extension ID: $EXTENSION_ID"
log "Local mode:   $LOCAL_MODE"
log "Language:     $LANGUAGE ($EXTENSION_DOCKERFILE)"

# ============================================================
# Docker Compose mode (default)
# ============================================================
if [[ "$USE_LOCAL" == "false" ]]; then
    log "Starting services with Docker Compose..."

    # Dockerfile expects SOURCE_DATE_EPOCH for reproducible builds.
    if [[ -z "${SOURCE_DATE_EPOCH:-}" ]]; then
        if SOURCE_DATE_EPOCH=$(git -C "$PROJECT_DIR" log -1 --format=%ct 2>/dev/null) && [[ -n "$SOURCE_DATE_EPOCH" ]]; then
            export SOURCE_DATE_EPOCH
        else
            export SOURCE_DATE_EPOCH=0
        fi
    fi
    log "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH"

    # --- Build tee-proxy image locally if no remote registry is configured ---
    # Uses the self-contained proxy/Dockerfile, which clones tee-proxy + tee-node
    # from GitHub at build time — no on-disk sibling repos required. Override the
    # cloned refs with TEE_PROXY_VERSION / TEE_NODE_VERSION if needed.
    if [[ -z "${REGISTRY:-}" ]]; then
        if ! docker image inspect local/tee-proxy >/dev/null 2>&1; then
            PROXY_DOCKERFILE="$PROJECT_DIR/proxy/Dockerfile"
            [[ -f "$PROXY_DOCKERFILE" ]] || die "Image local/tee-proxy not found and proxy Dockerfile missing at $PROXY_DOCKERFILE.\n  Either set REGISTRY in .env to pull from a remote registry, or restore proxy/Dockerfile."
            log "Building local/tee-proxy image from $PROXY_DOCKERFILE (self-cloning, no siblings)..."
            docker build -f "$PROXY_DOCKERFILE" -t local/tee-proxy "$PROJECT_DIR/proxy" || die "Failed to build tee-proxy image"
            log "local/tee-proxy image built successfully"
        else
            log "local/tee-proxy image already exists (use 'docker rmi local/tee-proxy' to force rebuild)"
        fi
    fi

    COMPOSE_FILES=("-f" "$PROJECT_DIR/docker-compose.yaml")

    case "$CHAIN" in
        local) ;;
        coston)
            log "Coston mode — attaching docker-compose.coston.yaml"
            COMPOSE_FILES+=("-f" "$PROJECT_DIR/docker-compose.coston.yaml")
            ;;
        coston2)
            log "Coston2 mode — attaching docker-compose.coston2.yaml"
            COMPOSE_FILES+=("-f" "$PROJECT_DIR/docker-compose.coston2.yaml")
            ;;
    esac

    # --force-recreate is required, not just convenient: the proxy fetches the
    # node's TEE info (incl. extensionId) ONCE at startup and serves it from
    # /info thereafter. A plain `up -d` recreates extension-tee when its config
    # changes but leaves the already-running ext-proxy untouched, so the proxy
    # keeps serving a stale extensionId after you re-run pre-build.sh — which
    # surfaces as the "EXTENSION_ID not found in proxy /info response" warning
    # below. Recreating ext-proxy forces it to re-fetch the current TEE info.
    docker compose "${COMPOSE_FILES[@]}" up -d --build --force-recreate || die "docker compose up failed"

    E2E="$SCRIPT_DIR/e2e.sh"
    EXT_PROXY_URL="${EXT_PROXY_URL:-http://localhost:6674}"
    log "Waiting for extension proxy at $EXT_PROXY_URL/info ..."
    "$E2E" wait-for-url "$EXT_PROXY_URL/info" 120

    log "Validating EXTENSION_ID against proxy..."
    PROXY_INFO=$(curl -sf "$EXT_PROXY_URL/info" 2>/dev/null || true)
    if [[ -n "$PROXY_INFO" ]]; then
        if ! echo "$PROXY_INFO" | grep -q "$EXTENSION_ID" 2>/dev/null; then
            echo -e "${RED}WARNING: EXTENSION_ID $EXTENSION_ID not found in proxy /info response${NC}" >&2
            echo -e "${RED}The proxy may be filtering for a different extension. Check config.${NC}" >&2
        fi
    fi

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN} Services started (Docker Compose)${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${CYAN}Mode${NC}"
    case "$CHAIN" in
        local)   echo "  Local devnet" ;;
        coston)  echo "  Coston testnet (chain_id=16)" ;;
        coston2) echo "  Coston2 testnet (chain_id=114)" ;;
    esac
    echo ""
    echo -e "${CYAN}Services${NC}"
    echo "  redis, ext-proxy, extension-tee"
    echo "  Proxy URL: $EXT_PROXY_URL"
    echo ""
    echo -e "${CYAN}Commands${NC}"
    echo "  Logs:    docker compose ${COMPOSE_FILES[*]} logs -f"
    echo "  Stop:    ./scripts/stop-services.sh --chain $CHAIN"
    exit 0
fi

# ============================================================
# Local Go process mode (--local)
# ============================================================
log "Starting services as local Go processes (--local)..."

E2E="$SCRIPT_DIR/e2e.sh"
PID_DIR="$PROJECT_DIR/out/pids"
LOG_DIR="$PROJECT_DIR/out/logs"

BIN_DIR="$PROJECT_DIR/out/bin"
mkdir -p "$BIN_DIR"
log "Building Go binaries..."
cd "$PROJECT_DIR/go/tools"
go build -o "$BIN_DIR/start-tee" ./cmd/start-tee
go build -o "$BIN_DIR/start-proxy" ./cmd/start-proxy

log "Starting extension TEE node..."
EXTENSION_ID="$EXTENSION_ID" "$E2E" start ext-tee "$PID_DIR/ext-tee.pid" "$LOG_DIR/ext-tee.log" \
    "$BIN_DIR/start-tee" -extensionID "$EXTENSION_ID"

log "Waiting for extension TEE to initialize..."
sleep 5

log "Starting Redis via Docker Compose..."
docker compose -f "$PROJECT_DIR/docker-compose.yaml" up -d redis
log "Waiting for Redis on :6382..."
retries=0
while ! docker compose -f "$PROJECT_DIR/docker-compose.yaml" exec -T redis redis-cli ping > /dev/null 2>&1; do
    retries=$((retries + 1))
    if [ $retries -ge 15 ]; then
        die "Redis container failed to become healthy"
    fi
    sleep 1
done
log "Redis on :6382 ready"

log "Starting extension proxy..."
PROXY_PRIVATE_KEY="$PROXY_PRIVATE_KEY" "$E2E" start ext-proxy "$PID_DIR/ext-proxy.pid" "$LOG_DIR/ext-proxy.log" \
    "$BIN_DIR/start-proxy"

cd "$PROJECT_DIR"

if [[ "${EXT_PROXY_URL:-}" != *"localhost"* && "${EXT_PROXY_URL:-}" != *"127.0.0.1"* && -n "${EXT_PROXY_URL:-}" ]]; then
    log "NOTE: EXT_PROXY_URL=$EXT_PROXY_URL (not localhost) — health check targets localhost:6664 anyway"
fi
log "Waiting for extension proxy..."
"$E2E" wait-for-url "http://localhost:6664/info" 60

EXT_TEE_PID=$(cat "$PID_DIR/ext-tee.pid" 2>/dev/null || echo "?")
EXT_PROXY_PID=$(cat "$PID_DIR/ext-proxy.pid" 2>/dev/null || echo "?")

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Services started (local Go processes)${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}Processes${NC}"
echo "  Extension Redis  Docker container (port 6382)"
echo "  Extension TEE    PID $EXT_TEE_PID"
echo "  Extension Proxy  PID $EXT_PROXY_PID"
echo "  Proxy URL        http://localhost:6664"
echo ""
echo -e "${CYAN}Logs${NC}"
echo "  Redis log        docker compose logs redis"
echo "  TEE log          $LOG_DIR/ext-tee.log"
echo "  Proxy log        $LOG_DIR/ext-proxy.log"
echo ""
echo -e "${CYAN}Commands${NC}"
echo "  Status:  $SCRIPT_DIR/e2e.sh status $PID_DIR"
echo "  Stop:    $SCRIPT_DIR/stop-services.sh --local"
