#!/usr/bin/env bash
# Usage: watch.sh <ctx-dir> [interval-seconds]
# Runs tick.py every interval. Prints a tick only when it differs from the last one
# or carries ATTENTION/DONE lines, so each printed line is worth reading.
set -uo pipefail
CTX="$1"
INTERVAL="${2:-60}"
DIR="$(cd "$(dirname "$0")" && pwd)"
prev=""
while true; do
  out="$(python3 "$DIR/tick.py" "$CTX" 2>&1)"
  rc=$?
  body="$(printf '%s\n' "$out" | sed '1s/^TICK [0-9:]* /TICK /')"
  if [[ "$body" != "$prev" ]] || grep -qE '^(ATTENTION|DONE)' <<<"$out"; then
    printf '%s\n' "$out"
  fi
  prev="$body"
  if [[ $rc -eq 10 || $rc -eq 11 ]]; then
    exit "$rc"
  fi
  if [[ $rc -ne 0 ]]; then
    echo "ATTENTION tick crashed (exit $rc): $(tail -1 <<<"$out")"
  fi
  sleep "$INTERVAL"
done
