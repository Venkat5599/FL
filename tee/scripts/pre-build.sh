#!/usr/bin/env bash
# pre-build.sh — Deploy InstructionSender contract and register extension on-chain.
#
# Inputs (env vars):
#   ADDRESSES_FILE  — path to deployed-addresses.json (auto-detected if unset)
#   CHAIN_URL       — chain RPC URL (default: http://127.0.0.1:8545)
#   DEPLOYMENT_PRIVATE_KEY — funded private key (default: Hardhat account)
#
# Outputs:
#   config/extension.env — EXTENSION_ID and INSTRUCTION_SENDER
#   config/deploy.log    — stderr from Go deploy commands
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[pre-build]${NC} $*"; }
step() { echo -e "\n${CYAN}=== Step $1: $2 ===${NC}"; }
die()  { echo -e "${RED}[pre-build] ERROR:${NC} $*" >&2; exit 1; }

# --- Load .env from project root (if present) ---
if [[ -f "$PROJECT_DIR/.env" ]]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi

ADDRESSES_FILE="${ADDRESSES_FILE:-}"
if [[ -n "$ADDRESSES_FILE" && "$ADDRESSES_FILE" != /* ]]; then
    ADDRESSES_FILE="$PROJECT_DIR/$ADDRESSES_FILE"
fi
CHAIN_URL="${CHAIN_URL:-http://127.0.0.1:8545}"
CONFIG_OUTPUT="$PROJECT_DIR/config/extension.env"
LOG_FILE="$PROJECT_DIR/config/deploy.log"

# Auto-detect addresses file
if [[ -z "$ADDRESSES_FILE" ]]; then
    LOCAL_MODE="${LOCAL_MODE:-true}"
    CHAIN="${CHAIN:-}"
    if [[ -z "$CHAIN" ]]; then
        [[ "$LOCAL_MODE" == "true" ]] && CHAIN="local" || CHAIN="coston2"
    fi
    case "$CHAIN" in
        coston)  candidate="$PROJECT_DIR/config/coston/deployed-addresses.json" ;;
        coston2) candidate="$PROJECT_DIR/config/coston2/deployed-addresses.json" ;;
        *)       candidate="" ;;
    esac
    if [[ -n "$candidate" && -f "$candidate" ]]; then
        ADDRESSES_FILE="$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"
    fi

    if [[ -z "$ADDRESSES_FILE" ]]; then
        for candidate in \
            "$PROJECT_DIR/../../e2e/docker/sim_dump/deployed-addresses.json" \
            "$PROJECT_DIR/../docker/sim_dump/deployed-addresses.json" \
            "$PROJECT_DIR/../../docker/sim_dump/deployed-addresses.json" \
            "$PROJECT_DIR/../../../docker/sim_dump/deployed-addresses.json"; do
            if [[ -f "$candidate" ]]; then
                ADDRESSES_FILE="$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"
                break
            fi
        done
    fi

    [[ -n "$ADDRESSES_FILE" ]] || die "Cannot find deployed-addresses.json. Set ADDRESSES_FILE."
fi

[[ -f "$ADDRESSES_FILE" ]] || die "Addresses file not found: $ADDRESSES_FILE"
ADDRESSES_FILE="$(cd "$(dirname "$ADDRESSES_FILE")" && pwd)/$(basename "$ADDRESSES_FILE")"

log "Chain URL:      $CHAIN_URL"
log "Addresses file: $ADDRESSES_FILE"

# --- Guard: refuse to clobber an existing extension config ---
# pre-build.sh mints a NEW extension and a NEW InstructionSender on every run
# and overwrites $CONFIG_OUTPUT. On a shared TEE proxy (the normal Coston/Coston2
# path) the TEE record is permanently bound to whichever extension it was first
# registered against, so a re-run orphans the existing TEE from the new
# InstructionSender (test.sh then reverts with MachineManager.TooMany).
FORCE=0
for arg in "$@"; do
    [[ "$arg" == "--force" ]] && FORCE=1
done
if [[ "${PRE_BUILD_FORCE:-0}" == "1" ]]; then
    FORCE=1
fi
if [[ -f "$CONFIG_OUTPUT" ]] && grep -q "^EXTENSION_ID=" "$CONFIG_OUTPUT" 2>/dev/null && [[ "$FORCE" != "1" ]]; then
    # A valid extension.env already exists. Re-minting here would orphan any TEE
    # already registered against the existing extension (post-build.sh would skip
    # ToProduction and test.sh would revert with MachineManager.TooMany). So the
    # idempotent default is to REUSE the existing extension and skip the mint —
    # full-setup.sh continues to the next phases. Use --force to re-mint.
    log "$CONFIG_OUTPUT already exists — reusing it (skipping mint)."
    sed -n 's/^/    /p' "$CONFIG_OUTPUT"
    echo ""
    echo "  Re-minting would orphan any TEE already registered against this extension."
    echo "  To force a fresh extension + InstructionSender (e.g. after a diamond redeploy"
    echo "  wiped registrations):"
    echo "    PRE_BUILD_FORCE=1 ./scripts/pre-build.sh    # or: ./scripts/pre-build.sh --force"
    echo "  To recover an orphaned setup, see cmd/check-tee-state (from go/tools)."
    exit 0
fi

# --- Step 0: Generate Go bindings from Solidity contract ---
# MUST run before any `go run`/`go build` below: the binding output
# (go/tools/pkg/contracts/sign/autogen.go) is .gitignored and is imported
# transitively by deploy-contract, register-extension, etc. Running the
# pre-flight compile before this step fails on a fresh clone with
# `undefined: sign.InstructionSender`.
step 0 "Generate Go bindings"
"$SCRIPT_DIR/generate-bindings.sh" || die "Binding generation failed"

# --- Step 1: Pre-flight check ---
step 1 "Pre-flight check"
cd "$PROJECT_DIR/go/tools"
if ! go run ./cmd/deploy-contract -a "$ADDRESSES_FILE" -c "$CHAIN_URL" --preflight-only 2>&1; then
    die "Pre-flight check failed — fix the issues above before deploying"
fi

# --- Step 2: Deploy InstructionSender ---
step 2 "Deploy InstructionSender contract"
cd "$PROJECT_DIR/go/tools"
mkdir -p "$(dirname "$LOG_FILE")"
: > "$LOG_FILE"
INSTRUCTION_SENDER=$(go run ./cmd/deploy-contract -a "$ADDRESSES_FILE" -c "$CHAIN_URL" 2>"$LOG_FILE" | tail -1) || {
    echo -e "${RED}Deploy failed. Logs:${NC}" >&2
    cat "$LOG_FILE" >&2
    die "Deploy failed — see output above"
}

[[ "$INSTRUCTION_SENDER" =~ ^0x[0-9a-fA-F]{40}$ ]] || {
    echo -e "${RED}deploy-contract output was not a valid address. Logs:${NC}" >&2
    cat "$LOG_FILE" >&2
    die "deploy-contract returned invalid address: '$INSTRUCTION_SENDER' (expected 0x + 40 hex chars)"
}

log "InstructionSender deployed at: $INSTRUCTION_SENDER"

# --- Step 3: Register extension ---
step 3 "Register extension on-chain"
EXTENSION_ID=$(go run ./cmd/register-extension -a "$ADDRESSES_FILE" -c "$CHAIN_URL" --instructionSender "$INSTRUCTION_SENDER" 2>>"$LOG_FILE" | tail -1) || {
    echo -e "${RED}Registration failed. Logs:${NC}" >&2
    cat "$LOG_FILE" >&2
    die "Registration failed — see output above"
}

[[ "$EXTENSION_ID" =~ ^0x[0-9a-fA-F]{64}$ ]] || {
    echo -e "${RED}register-extension output was not a valid ID. Logs:${NC}" >&2
    cat "$LOG_FILE" >&2
    die "register-extension returned invalid ID: '$EXTENSION_ID' (expected 0x + 64 hex chars)"
}

log "Extension ID: $EXTENSION_ID"

# --- Step 4: Write config ---
step 4 "Write config"
mkdir -p "$(dirname "$CONFIG_OUTPUT")"
cat > "$CONFIG_OUTPUT" <<EOF
# Auto-generated by pre-build.sh — do not edit manually
EXTENSION_ID=$EXTENSION_ID
INSTRUCTION_SENDER=$INSTRUCTION_SENDER
EOF

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Pre-build complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo "  EXTENSION_ID         $EXTENSION_ID"
echo "  INSTRUCTION_SENDER   $INSTRUCTION_SENDER"
echo "  Config file          $CONFIG_OUTPUT"
echo "  Deploy log           $LOG_FILE"
