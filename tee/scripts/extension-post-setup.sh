#!/usr/bin/env bash
# extension-post-setup.sh — Extension-specific setup that runs AFTER post-build.
#
# This hook runs once the TEE node is live and registered on-chain in the
# TeeMachineRegistry. Use it for setup that requires the TEE's on-chain
# identity to already exist.
#
# Available variables (sourced from .env + config/extension.env):
#   INSTRUCTION_SENDER     — your deployed InstructionSender contract address
#   EXTENSION_ID           — your extension's ID on the TeeExtensionRegistry
#   CHAIN_URL              — chain RPC endpoint
#   ADDRESSES_FILE         — path to deployed-addresses.json
#   DEPLOYMENT_PRIVATE_KEY — funded deployer/admin key
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'; NC='\033[0m'
log() { echo -e "${GREEN}[extension-post-setup]${NC} $*"; }

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

# --- Sign-extension-specific post-registration setup ---
# The sign extension doesn't require on-chain knowledge of the TEE address.
# Signatures returned by the TEE are returned to callers via the proxy's
# action-result flow, not verified on-chain.

log "No extension-specific post-setup needed (sign extension)."
