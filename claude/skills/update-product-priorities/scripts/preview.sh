#!/usr/bin/env bash
# preview.sh — build the priorities board and run the dev server for screenshotting.
#
# Usage:
#   preview.sh start   # npm install, npm run build, start vite, wait until it answers
#   preview.sh stop    # stop the dev server started by `start`
#
# `start` leaves vite running in the background so the chrome-devtools MCP can
# drive http://localhost:5173/. Always pair it with `stop`.

set -euo pipefail

PORT=5173
URL="http://localhost:${PORT}/"
PID_FILE="/tmp/product-priorities-dev.pid"
LOG_FILE="/tmp/product-priorities-dev.log"

die() { printf 'error: %s\n' "$1" >&2; exit 1; }

start() {
  [ -f package.json ] || die "run this from the product-priorities repo root"

  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "dev server already running (pid $(cat "$PID_FILE")) at $URL"
    return 0
  fi

  echo "npm install"
  npm install

  echo "npm run build"
  npm run build

  echo "starting vite"
  npm run dev >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"

  for _ in $(seq 1 60); do
    if curl -sfo /dev/null "$URL"; then
      echo "ready: $URL"
      return 0
    fi
    sleep 0.5
  done

  stop
  die "dev server did not come up within 30s; see $LOG_FILE"
}

stop() {
  local killed=0 pid pids

  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
      killed=1
    fi
    rm -f "$PID_FILE"
  fi

  # vite outlives the npm wrapper, so clear whatever still holds the port
  pids="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 0.5
    pids="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
    killed=1
  fi

  if [ "$killed" = 1 ]; then
    echo "stopped dev server"
  else
    echo "no dev server to stop"
  fi
}

case "${1:-}" in
  start) start ;;
  stop)  stop ;;
  *) die "usage: preview.sh start|stop" ;;
esac
