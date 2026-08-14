#!/usr/bin/env bash
# extension-setup.sh — Extension-specific setup that runs BEFORE Docker Compose.
#
# This hook runs between pre-build (contract deployment) and docker-up (starting
# the TEE). Use it for any setup whose output the extension needs at startup.
#
# Available variables (sourced from .env + config/extension.env):
#   INSTRUCTION_SENDER     — your deployed InstructionSender contract address
#   EXTENSION_ID           — your extension's ID on the TeeExtensionRegistry
#   CHAIN_URL              — chain RPC endpoint
#   ADDRESSES_FILE         — path to deployed-addresses.json
#   DEPLOYMENT_PRIVATE_KEY — funded deployer key
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'; NC='\033[0m'
log() { echo -e "${GREEN}[extension-setup]${NC} $*"; }

# --- Load environment ---
if [[ -f "$PROJECT_DIR/.env" ]]; then
    set -a; source "$PROJECT_DIR/.env"; set +a
fi
if [[ -f "$PROJECT_DIR/config/extension.env" ]]; then
    source "$PROJECT_DIR/config/extension.env"
fi

log "EXTENSION_ID:       ${EXTENSION_ID:-<not set>}"
log "INSTRUCTION_SENDER: ${INSTRUCTION_SENDER:-<not set>}"
log "CHAIN_URL:          ${CHAIN_URL:-<not set>}"

# --- Sign-extension-specific setup ---
# No pre-docker setup needed: the sign extension stores its private key only
# after the first KEY/UPDATE instruction is delivered through the TEE. There
# is no auxiliary contract or seed state to deploy at this point.

log "No extension-specific setup needed (sign extension)."
