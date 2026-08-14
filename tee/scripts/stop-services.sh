#!/usr/bin/env bash
#
# Stop extension services.
#
# By default, stops Docker Compose services, picking the compose overlay from
# --chain (or env CHAIN, or legacy LOCAL_MODE).
#
# Pass --local to stop background Go processes instead.
#
# Usage:
#   ./scripts/stop-services.sh                       # local devnet, docker compose
#   ./scripts/stop-services.sh --chain coston        # Coston, docker compose
#   ./scripts/stop-services.sh --local               # background Go processes
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
log()  { echo -e "${GREEN}[stop-services]${NC} $*"; }
die()  { echo -e "${RED}[stop-services] ERROR:${NC} $*" >&2; exit 1; }

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

# Chain precedence: an explicit --chain wins; otherwise use CHAIN from .env
# (set by use-chain.sh); otherwise fall back to the LOCAL_MODE default below.
CHAIN="${CHAIN_ARG:-${CHAIN:-}}"

LOCAL_MODE="${LOCAL_MODE:-true}"

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

if [[ "$USE_LOCAL" == "true" ]]; then
    E2E="$SCRIPT_DIR/e2e.sh"
    PID_DIR="$PROJECT_DIR/out/pids"

    log "Stopping background Go processes..."
    "$E2E" stop-all "$PID_DIR"
    log "Done."
else
    COMPOSE_FILES=("-f" "$PROJECT_DIR/docker-compose.yaml")
    case "$CHAIN" in
        local) ;;
        coston)  COMPOSE_FILES+=("-f" "$PROJECT_DIR/docker-compose.coston.yaml") ;;
        coston2) COMPOSE_FILES+=("-f" "$PROJECT_DIR/docker-compose.coston2.yaml") ;;
    esac

    export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-0}"

    log "Stopping Docker Compose services (chain: $CHAIN)..."
    docker compose "${COMPOSE_FILES[@]}" down
    log "Done."
fi
