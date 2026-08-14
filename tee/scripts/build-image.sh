#!/usr/bin/env bash
# build-image.sh — Build the extension-tee Docker image for the hand-off to devops.
#
# Reads the active chain + language straight from .env (set them with
# `./scripts/use-chain.sh <chain> [language]`), so the common case takes no
# arguments — just run `./scripts/build-image.sh`. The LANGUAGE selects which
# Dockerfile is built. CHAIN is informational only: the image is chain-agnostic
# (CHAIN_URL / EXTENSION_ID are injected by the VM operator at deploy time), so
# one built image works for any chain.
#
# The build is reproducible: SOURCE_DATE_EPOCH is pinned to the latest commit
# timestamp, so the same source yields the same codeHash. MODE=0 (production
# attestation) is verified to be baked in — FTDC rejects MODE=1.
#
# Usage:
#   ./scripts/build-image.sh                        # build .env's CHAIN + LANGUAGE, tag v0.1.0, save tar
#   ./scripts/build-image.sh --language typescript  # override the language from .env
#   ./scripts/build-image.sh --version v0.1.1       # set the image tag + tar version
#   ./scripts/build-image.sh --no-save              # build + tag only, skip the tar
#   ./scripts/build-image.sh --no-cache             # force a clean rebuild
#   ./scripts/build-image.sh --help
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[build-image]${NC} $*"; }
die()  { echo -e "${RED}[build-image] ERROR:${NC} $*" >&2; exit 1; }

print_help() {
    cat <<EOF
build-image.sh — build + save the extension-tee image for devops hand-off

With no arguments it reads the active CHAIN + LANGUAGE from .env (set them with
./scripts/use-chain.sh <chain> [language]). The image is chain-agnostic, so
LANGUAGE is what drives the build; CHAIN is shown for confirmation only.

Usage:
  $0 [--language go|python|typescript] [--version <tag>] [--no-save] [--no-cache]
  $0 --help

Options:
  --language, -l   Extension language. Default: LANGUAGE from .env, else go.
  --version,  -v   Image tag + tar version. Default: TEE_VERSION from .env, else v0.1.0.
  --no-save        Build + tag only; skip writing the .tar.
  --no-cache       Pass --no-cache to docker build (clean rebuild).
  --help, -h       Show this help.

Output:
  Image  sign-extension-<language>:<version>
  Tar    sign-extension-<language>-<version>.tar   (unless --no-save)
EOF
}

# --- read the active config from .env (CHAIN / LANGUAGE / TEE_VERSION) ---
if [[ -f "$PROJECT_DIR/.env" ]]; then
    set -a; source "$PROJECT_DIR/.env"; set +a
else
    log "No .env found — using defaults (run ./scripts/use-chain.sh first to pick chain + language)."
fi
CHAIN="${CHAIN:-}"
LANGUAGE="${LANGUAGE:-go}"
VERSION="${TEE_VERSION:-v0.1.0}"
SAVE=true
NO_CACHE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -l|--language) [[ $# -ge 2 ]] || die "--language requires a value"; LANGUAGE="$2"; shift 2 ;;
        --language=*)  LANGUAGE="${1#--language=}"; shift ;;
        -v|--version)  [[ $# -ge 2 ]] || die "--version requires a value"; VERSION="$2"; shift 2 ;;
        --version=*)   VERSION="${1#--version=}"; shift ;;
        --no-save)     SAVE=false; shift ;;
        --no-cache)    NO_CACHE="--no-cache"; shift ;;
        -h|--help)     print_help; exit 0 ;;
        *) die "unknown argument: $1 (see --help)" ;;
    esac
done

case "$LANGUAGE" in
    go)         DOCKERFILE="Dockerfile" ;;
    python)     DOCKERFILE="python/Dockerfile" ;;
    typescript) DOCKERFILE="typescript/Dockerfile" ;;
    *) die "unknown language: $LANGUAGE (valid: go, python, typescript)" ;;
esac

IMAGE="sign-extension-${LANGUAGE}:${VERSION}"
TAR="$PROJECT_DIR/sign-extension-${LANGUAGE}-${VERSION}.tar"

# Reproducible build: pin SOURCE_DATE_EPOCH to the latest commit timestamp.
if [[ -z "${SOURCE_DATE_EPOCH:-}" ]]; then
    SOURCE_DATE_EPOCH="$(git -C "$PROJECT_DIR" log -1 --format=%ct 2>/dev/null || echo 0)"
fi
export SOURCE_DATE_EPOCH

log "Chain (.env):      ${CHAIN:-<unset>} (informational — image is chain-agnostic)"
log "Language (.env):   $LANGUAGE ($DOCKERFILE)"
log "Image:             $IMAGE"
log "SOURCE_DATE_EPOCH: $SOURCE_DATE_EPOCH"

cd "$PROJECT_DIR"
log "Building (context: extensions/sign, tee-node fetched from the network)..."
# shellcheck disable=SC2086
docker build $NO_CACHE -f "$DOCKERFILE" -t "$IMAGE" . || die "docker build failed"

# Verify MODE=0 is baked in (production attestation; MODE=1 is rejected by FTDC).
MODE_LINE="$(docker inspect "$IMAGE" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^MODE=' || true)"
[[ "$MODE_LINE" == "MODE=0" ]] || die "expected MODE=0 baked into the image, found '${MODE_LINE:-<unset>}'. FTDC rejects MODE=1."
log "Verified $MODE_LINE (production attestation)"

if [[ "$SAVE" == "true" ]]; then
    log "Saving image to tar..."
    docker save "$IMAGE" -o "$TAR" || die "docker save failed"
    log "Wrote $TAR"
fi

IMAGE_ID="$(docker inspect "$IMAGE" --format '{{.Id}}')"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Image ready for hand-off${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${CYAN}Image:${NC}     $IMAGE"
echo -e "${CYAN}Image ID:${NC}  $IMAGE_ID"
[[ "$SAVE" == "true" ]] && echo -e "${CYAN}Tar:${NC}       $TAR"
echo ""
echo "Hand off to devops with: the tar (or a registry push), plus EXTENSION_ID,"
echo "INITIAL_OWNER, CHAIN_URL, and PROXY_URL. See deployment-steps.md section 6."
