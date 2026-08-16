#!/usr/bin/env bash
# Deterministically watch a condition, then send a Slack DM when it resolves.
# No LLM in the loop: it polls a shell command and matches its output.
#
# Launch in the background so it outlives the current turn:
#   nohup CHECK_CMD='...' SUCCESS_PATTERN='...' SUCCESS_MESSAGE='...' \
#     ~/.claude/skills/ping/scripts/slack-watch.sh >/tmp/ping-watch.log 2>&1 &
#
# Config via environment:
#   CHECK_CMD        (required)  shell command run each poll; its stdout+stderr is matched
#   SUCCESS_PATTERN  (required unless USE_EXIT_CODE=1)  grep -E pattern meaning "done ok"
#   FAIL_PATTERN     (optional)  grep -E pattern meaning "done, failed"
#   USE_EXIT_CODE    (optional)  "1" => success when CHECK_CMD exits 0 (patterns ignored)
#   POLL_INTERVAL    (optional)  seconds between checks (default 60)
#   MAX_MINUTES      (optional)  give up after this many minutes (default 60)
#   SUCCESS_MESSAGE  (required)  DM text on success
#   FAIL_MESSAGE     (optional)  DM text on failure
#   TIMEOUT_MESSAGE  (optional)  DM text on timeout
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTIFY="$HERE/slack-notify.sh"

CHECK_CMD="${CHECK_CMD:-}"
SUCCESS_PATTERN="${SUCCESS_PATTERN:-}"
FAIL_PATTERN="${FAIL_PATTERN:-}"
USE_EXIT_CODE="${USE_EXIT_CODE:-0}"
POLL_INTERVAL="${POLL_INTERVAL:-60}"
MAX_MINUTES="${MAX_MINUTES:-60}"
SUCCESS_MESSAGE="${SUCCESS_MESSAGE:-Condition met.}"
FAIL_MESSAGE="${FAIL_MESSAGE:-Watched condition failed.}"
TIMEOUT_MESSAGE="${TIMEOUT_MESSAGE:-Still not resolved after ${MAX_MINUTES}min — check manually.}"

if [ -z "$CHECK_CMD" ]; then
  echo "slack-watch: CHECK_CMD is required" >&2
  exit 2
fi
if [ "$USE_EXIT_CODE" != "1" ] && [ -z "$SUCCESS_PATTERN" ]; then
  echo "slack-watch: SUCCESS_PATTERN required unless USE_EXIT_CODE=1" >&2
  exit 2
fi

DEADLINE=$(( $(date +%s) + MAX_MINUTES * 60 ))

while :; do
  OUT="$(bash -c "$CHECK_CMD" 2>&1)"
  RC=$?

  if [ "$USE_EXIT_CODE" = "1" ]; then
    if [ "$RC" -eq 0 ]; then "$NOTIFY" "$SUCCESS_MESSAGE"; exit 0; fi
  else
    if printf '%s' "$OUT" | grep -Eq "$SUCCESS_PATTERN"; then "$NOTIFY" "$SUCCESS_MESSAGE"; exit 0; fi
    if [ -n "$FAIL_PATTERN" ] && printf '%s' "$OUT" | grep -Eq "$FAIL_PATTERN"; then "$NOTIFY" "$FAIL_MESSAGE"; exit 0; fi
  fi

  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    "$NOTIFY" "$TIMEOUT_MESSAGE"
    exit 0
  fi

  sleep "$POLL_INTERVAL"
done
