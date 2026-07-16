#!/usr/bin/env bash
# ci-monitor.sh — strict CI monitor for a PR on team-plain/services.
# Companion to the monitor-ci skill (see SKILL.md).
#
# Enforces the fixed monitoring layout and loop:
#   - poll every INTERVAL until all checks pass, a real failure appears, or TIMEOUT
#   - ignore "Mergify Merge Protections" (a merge gate, not a real check)
#   - on failure with nothing else pending:
#       * auto-rerun ONLY known-flaky jobs, max MAX_RERUNS rounds
#       * any non-flaky failure stops the loop for analysis (never blind retrigger)
#   - print the same layout every poll so status is easy to scan
#
# Usage:
#   ci-monitor.sh [-p <PR>] [-i <interval_sec>] [-t <timeout_sec>]
# Defaults: PR resolved from current branch, interval 300s, timeout 3600s.

set -euo pipefail

PR=""
INTERVAL=300
TIMEOUT=3600
MAX_RERUNS=3
KNOWN_FLAKY_REGEX='Email E2E Test'

die() { printf 'error: %s\n' "$1" >&2; exit 1; }

while getopts ":p:i:t:h" opt; do
  case "$opt" in
    p) PR="$OPTARG" ;;
    i) INTERVAL="$OPTARG" ;;
    t) TIMEOUT="$OPTARG" ;;
    h) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    :) die "-$OPTARG needs a value" ;;
    \?) die "unknown flag -$OPTARG" ;;
  esac
done

unset GH_TOKEN || true
command -v gh >/dev/null 2>&1 || die "gh not found"
command -v jq >/dev/null 2>&1 || die "jq not found"

if [ -z "$PR" ]; then
  BRANCH="$(git branch --show-current)"
  PR="$(gh pr list --head "$BRANCH" --json number --jq '.[0].number' 2>/dev/null || true)"
fi
[ -n "$PR" ] || die "no PR found for current branch; pass -p <PR>"

# checks JSON, minus the Mergify gate
checks_json() {
  gh pr checks "$PR" --json name,state,link 2>/dev/null \
    | jq '[.[] | select(.name != "Mergify Merge Protections")]'
}
run_id_from_link() { printf '%s' "$1" | sed -nE 's#.*/actions/runs/([0-9]+).*#\1#p'; }

reruns=0
start="$(date +%s)"

while :; do
  now="$(date +%s)"
  json="$(checks_json)"
  total="$(printf '%s' "$json" | jq 'length')"
  passed="$(printf '%s' "$json" | jq '[.[] | select(.state=="SUCCESS")] | length')"
  pending="$(printf '%s' "$json" | jq '[.[] | select(.state=="PENDING" or .state=="QUEUED" or .state=="IN_PROGRESS")] | length')"
  failed_json="$(printf '%s' "$json" | jq '[.[] | select(.state=="FAILURE" or .state=="ERROR" or .state=="CANCELLED" or .state=="TIMED_OUT")]')"
  failed="$(printf '%s' "$failed_json" | jq 'length')"

  # fixed layout, printed every poll
  printf '\n## CI Monitor — %s\n\n' "$(date +%H:%M)"
  printf '**PR**: #%s\n' "$PR"
  printf '**Status**: %s/%s checks passed\n\n' "$passed" "$total"
  printf '| Check | Status |\n|-------|--------|\n'
  printf '%s' "$json" | jq -r '.[] | "| \(.name) | \(.state) |"'
  printf '\n'

  # all green
  if [ "$total" -gt 0 ] && [ "$failed" -eq 0 ] && [ "$pending" -eq 0 ]; then
    echo "✅ all checks passed"
    exit 0
  fi

  # real failure: nothing else still pending
  if [ "$failed" -gt 0 ] && [ "$pending" -eq 0 ]; then
    nonflaky="$(printf '%s' "$failed_json" | jq --arg re "$KNOWN_FLAKY_REGEX" '[.[] | select(.name | test($re) | not)] | length')"
    if [ "$nonflaky" -gt 0 ]; then
      echo "❌ non-flaky failure(s) — stopping for analysis (never blind retrigger):"
      printf '%s' "$failed_json" | jq -r '.[] | "  - \(.name): \(.link)"'
      exit 1
    fi
    if [ "$reruns" -ge "$MAX_RERUNS" ]; then
      echo "❌ known-flaky failed $reruns times — it is broken, stopping"
      exit 1
    fi
    reruns=$((reruns + 1))
    link="$(printf '%s' "$failed_json" | jq -r '.[0].link')"
    rid="$(run_id_from_link "$link")"
    [ -n "$rid" ] || die "could not parse run id from link: $link"
    echo "flaky failure — rerun $reruns/$MAX_RERUNS of run $rid"
    gh run rerun --failed "$rid"
  fi

  # timeout
  if [ $((now - start)) -ge "$TIMEOUT" ]; then
    echo "⏱ timeout after ${TIMEOUT}s — stopping"
    exit 2
  fi

  sleep "$INTERVAL"
done
