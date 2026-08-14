#!/usr/bin/env bash
#
# Helper that manages background Go processes for local development.
# Used by start-services.sh --local / stop-services.sh --local.
#
# Usage:
#   e2e.sh start <name> <pidfile> <logfile> <command...>
#   e2e.sh stop <pidfile>
#   e2e.sh stop-all <piddir>
#   e2e.sh status <piddir>
#   e2e.sh wait-for-url <url> <timeout_seconds>
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[e2e]${NC} $*"; }
warn() { echo -e "${YELLOW}[e2e]${NC} $*"; }
err() { echo -e "${RED}[e2e]${NC} $*" >&2; }

cmd_start() {
    local name="$1"
    local pidfile="$2"
    local logfile="$3"
    shift 3
    local cmd=("$@")

    mkdir -p "$(dirname "$pidfile")" "$(dirname "$logfile")"

    if [ -f "$pidfile" ]; then
        local old_pid
        old_pid=$(cat "$pidfile")
        if kill -0 "$old_pid" 2>/dev/null; then
            warn "$name is already running (PID $old_pid)"
            return 0
        fi
        rm -f "$pidfile"
    fi

    log "Starting $name → ${cmd[*]}"
    log "  log: $logfile"

    "${cmd[@]}" > "$logfile" 2>&1 &
    local pid=$!

    echo "$pid" > "$pidfile"
    log "$name started (PID $pid)"
}

cmd_stop() {
    local pidfile="$1"
    local name
    name=$(basename "$pidfile" .pid)

    if [ ! -f "$pidfile" ]; then
        warn "$name: no PID file found"
        return 0
    fi

    local pid
    pid=$(cat "$pidfile")

    if ! kill -0 "$pid" 2>/dev/null; then
        warn "$name (PID $pid): not running, cleaning up PID file"
        rm -f "$pidfile"
        return 0
    fi

    log "Stopping $name (PID $pid)..."
    _kill_tree "$pid"

    local waited=0
    while kill -0 "$pid" 2>/dev/null && [ $waited -lt 5 ]; do
        sleep 1
        waited=$((waited + 1))
    done

    if kill -0 "$pid" 2>/dev/null; then
        warn "$name did not stop gracefully, forcing..."
        _kill_tree "$pid" 9
    fi

    rm -f "$pidfile"
    log "$name stopped"
}

_kill_tree() {
    local pid="$1"
    local sig="${2:-15}"

    local children
    children=$(pgrep -P "$pid" 2>/dev/null) || true
    for child in $children; do
        _kill_tree "$child" "$sig"
    done

    kill -"$sig" "$pid" 2>/dev/null || true
}

cmd_stop_all() {
    local piddir="$1"
    if [ ! -d "$piddir" ]; then
        warn "No PID directory found at $piddir"
        return 0
    fi
    local found=0
    for pidfile in "$piddir"/*.pid; do
        [ -f "$pidfile" ] || continue
        found=1
        cmd_stop "$pidfile"
    done
    if [ $found -eq 0 ]; then
        log "No services running"
    fi
}

cmd_status() {
    local piddir="$1"
    if [ ! -d "$piddir" ]; then
        echo "No PID directory found at $piddir"
        return 0
    fi
    local found=0
    for pidfile in "$piddir"/*.pid; do
        [ -f "$pidfile" ] || continue
        found=1
        local name pid status
        name=$(basename "$pidfile" .pid)
        pid=$(cat "$pidfile")
        if kill -0 "$pid" 2>/dev/null; then
            status="${GREEN}RUNNING${NC} (PID $pid)"
        else
            status="${RED}STOPPED${NC} (stale PID $pid)"
        fi
        echo -e "  $name: $status"
    done
    if [ $found -eq 0 ]; then
        echo "  No services tracked"
    fi
}

cmd_wait_for_url() {
    local url="$1"
    local timeout="${2:-120}"
    local waited=0

    log "Waiting for $url (timeout: ${timeout}s)..."
    while [ $waited -lt "$timeout" ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            log "$url is ready (${waited}s)"
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
    done

    err "Timed out waiting for $url after ${timeout}s"
    return 1
}

case "${1:-help}" in
    start) shift; cmd_start "$@" ;;
    stop) shift; cmd_stop "$@" ;;
    stop-all) shift; cmd_stop_all "$@" ;;
    status) shift; cmd_status "$@" ;;
    wait-for-url) shift; cmd_wait_for_url "$@" ;;
    help|*)
        echo "Usage: e2e.sh <command> [args...]"
        echo ""
        echo "Commands:"
        echo "  start <name> <pidfile> <logfile> <command...>  Start a process in background"
        echo "  stop <pidfile>                                  Stop a process by PID file"
        echo "  stop-all <piddir>                               Stop all processes in PID dir"
        echo "  status <piddir>                                 Show status of all processes"
        echo "  wait-for-url <url> [timeout]                    Wait for URL to respond (default 120s)"
        ;;
esac
