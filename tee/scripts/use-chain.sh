#!/usr/bin/env bash
# use-chain.sh — Swap the active .env for a given chain, optionally as a local /
# simulated-TEE variant, optionally setting the extension language.
#
# Usage:
#   ./scripts/use-chain.sh [local] <chain> [go|python|typescript]
#   ./scripts/use-chain.sh --list
#   ./scripts/use-chain.sh --help
#
# Reads a template from the project root and copies it to .env:
#   <chain>          → .env.<chain>          (deployed)
#   local <chain>    → .env.local.<chain>    (simulated TEE, ngrok proxy)
# A trailing language sets the LANGUAGE= line.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LANGUAGES="go python typescript"

usage() { echo "usage: $0 [local] <chain> [go|python|typescript] | --list | --help" >&2; }

print_help() {
    cat <<EOF
use-chain.sh — activate a chain's .env (optionally local/simulated, optionally a language)

Usage:
  $0 [local] <chain> [language]   Copy .env.<chain> → .env; apply local overlay / set LANGUAGE
  $0 --list                       List available chains and languages
  $0 --help, -h                   Show this help

Arguments:
  local        Optional leading keyword. Uses the .env.local.<chain> template
               (simulated TEE + local ext-proxy) instead of .env.<chain>.
  <chain>      A chain with a matching template (see --list).
  [language]   Optional: go | python | typescript. Rewrites LANGUAGE= in .env.

Examples:
  $0 coston2 go              Deployed Coston2, build the Go image
  $0 coston typescript       Deployed Coston, build the TypeScript image
  $0 local coston2 go        Local/simulated Coston2 (ngrok proxy), Go image
  $0 local coston python     Local/simulated Coston (ngrok proxy), Python image
EOF
}

list_options() {
    local f name found=0
    echo "Deployed chains (.env.<chain> in $PROJECT_DIR):"
    for f in "$PROJECT_DIR"/.env.*; do
        [[ -e "$f" ]] || continue
        name="${f##*/.env.}"
        [[ "$name" == "example" ]] && continue
        [[ "$name" == local.* ]] && continue
        echo "  - $name"
        found=1
    done
    [[ "$found" -eq 1 ]] || echo "  (none found — create one by copying .env.example)"
    echo ""
    echo "Local / simulated variants (.env.local.<chain>):"
    found=0
    for f in "$PROJECT_DIR"/.env.local.*; do
        [[ -e "$f" ]] || continue
        name="${f##*/.env.local.}"
        echo "  - local $name"
        found=1
    done
    [[ "$found" -eq 1 ]] || echo "  (none found)"
    echo ""
    echo "Available languages:"
    local l
    for l in $LANGUAGES; do
        if [[ "$l" == "go" ]]; then
            echo "  - $l (default)"
        else
            echo "  - $l"
        fi
    done
}

# set_var KEY VALUE FILE — replace an existing KEY= line, or append one.
set_var() {
    local key="$1" val="$2" file="$3" tmp
    if grep -qE "^${key}=" "$file"; then
        tmp="$(mktemp)"
        sed -E "s|^${key}=.*|${key}=${val}|" "$file" > "$tmp" && mv "$tmp" "$file"
    else
        printf '%s=%s\n' "$key" "$val" >> "$file"
    fi
}

# --- arg parsing ---
[[ $# -ge 1 ]] || { usage; exit 1; }

case "$1" in
    -h|--help) print_help; exit 0 ;;
    --list)    list_options; exit 0 ;;
    -*)        echo "unknown flag: $1" >&2; usage; exit 1 ;;
esac

LOCAL=false
if [[ "$1" == "local" ]]; then
    LOCAL=true
    shift
    [[ $# -ge 1 ]] || { echo "local mode needs a chain, e.g. '$0 local coston2 go'" >&2; usage; exit 1; }
fi

[[ $# -le 2 ]] || { usage; exit 1; }
CHAIN="$1"
LANGUAGE="${2:-}"

if [[ "$LOCAL" == true ]]; then
    SRC="$PROJECT_DIR/.env.local.$CHAIN"
else
    SRC="$PROJECT_DIR/.env.$CHAIN"
fi
DST="$PROJECT_DIR/.env"

[[ -f "$SRC" ]] || { echo "no such file: $SRC" >&2; echo "run '$0 --list' to see available templates" >&2; exit 1; }

cp "$SRC" "$DST"
echo "[use-chain] copied ${SRC##*/} → .env"

if [[ -n "$LANGUAGE" ]]; then
    case " $LANGUAGES " in
        *" $LANGUAGE "*) ;;
        *) echo "unknown language: $LANGUAGE (valid: $LANGUAGES)" >&2; exit 1 ;;
    esac
    set_var LANGUAGE "$LANGUAGE" "$DST"
fi

echo "[use-chain] mode=$([[ "$LOCAL" == true ]] && echo 'local (simulated TEE)' || echo 'deployed')"
echo "[use-chain] EXT_PROXY_URL=$(grep -E '^EXT_PROXY_URL=' "$DST" | head -1 | cut -d= -f2-)"
echo "[use-chain] CHAIN_URL=$(grep -E '^CHAIN_URL=' "$DST" | head -1 | cut -d= -f2-)"
echo "[use-chain] SIMULATED_TEE=$(grep -E '^SIMULATED_TEE=' "$DST" | head -1 | cut -d= -f2-)"
echo "[use-chain] LANGUAGE=$(grep -E '^LANGUAGE=' "$DST" | head -1 | cut -d= -f2-)"
