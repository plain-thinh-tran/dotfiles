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
REPO="$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo 'team-plain/services')"

pr_head_sha() {
  gh pr view "$PR" --json headRefOid --jq '.headRefOid' 2>/dev/null
}

checks_json() {
  gh pr checks "$PR" --json name,state,link 2>/dev/null \
    | jq '[.[] | select(.name != "Mergify Merge Protections")]'
}

# Check if a failed job belongs to the current HEAD commit.
# Returns 0 (true) if stale, 1 (false) if current.
is_stale_check() {
  local link="$1" head_sha="$2"
  local run_id
  run_id="$(printf '%s' "$link" | sed -nE 's#.*/actions/runs/([0-9]+).*#\1#p')"
  [ -n "$run_id" ] || return 1
  local run_sha
  run_sha="$(gh api "repos/${REPO}/actions/runs/${run_id}" --jq '.head_sha' 2>/dev/null || true)"
  [ -n "$run_sha" ] && [ "$run_sha" != "$head_sha" ]
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
    deploy_skipped="$(printf '%s' "$json" | jq '[.[] | select((.name | test("Deploy.*SST|Deploy plain")) and .state=="SKIPPED")] | length')"
    if [ "$deploy_skipped" -gt 0 ]; then
      echo "⚠️  deploy checks were SKIPPED (not run). Integration tests ran against a non-existent or stale environment."
      echo ""
      echo "Common cause: empty commit or only-ignored-files change while a GitHub deployment record exists."
      echo "Fix: push a commit with real file changes (e.g. rebase on main) to trigger a full deploy."
      exit 1
    fi
    echo "✅ all checks passed"
    exit 0
  fi

  # real failure: nothing else still pending
  if [ "$failed" -gt 0 ] && [ "$pending" -eq 0 ]; then
    # Filter out stale failures from old commits
    head_sha="$(pr_head_sha)"
    if [ -n "$head_sha" ]; then
      current_failed_json="$(printf '%s' "$failed_json" | jq -c '.[]' | while IFS= read -r item; do
        link="$(printf '%s' "$item" | jq -r '.link')"
        if ! is_stale_check "$link" "$head_sha"; then
          printf '%s\n' "$item"
        else
          name="$(printf '%s' "$item" | jq -r '.name')"
          echo "⏭ skipping stale failure: $name (from older commit)" >&2
        fi
      done | jq -s '.')"
      failed_json="$current_failed_json"
      failed="$(printf '%s' "$failed_json" | jq 'length')"
    fi

    # Re-check: if all failures were stale, keep polling
    if [ "$failed" -eq 0 ]; then
      echo "ℹ all failures were from older commits — waiting for current run"
      if [ $((now - start)) -ge "$TIMEOUT" ]; then
        echo "⏱ timeout after ${TIMEOUT}s — stopping"
        exit 2
      fi
      sleep "$INTERVAL"
      continue
    fi

    nonflaky="$(printf '%s' "$failed_json" | jq --arg re "$KNOWN_FLAKY_REGEX" '[.[] | select(.name | test($re) | not)] | length')"
    if [ "$nonflaky" -gt 0 ]; then
      echo "❌ non-flaky failure(s) — stopping for analysis (never blind retrigger):"
      printf '%s' "$failed_json" | jq -r '.[] | "  - \(.name): \(.link)"'

      deploy_link="$(printf '%s' "$failed_json" | jq -r '.[] | select(.name | test("Deploy.*SST")) | .link' | head -1)"
      if [ -n "$deploy_link" ]; then
        deploy_job_id="$(printf '%s' "$deploy_link" | sed -nE 's#.*/job/([0-9]+).*#\1#p')"
        if [ -n "$deploy_job_id" ]; then
          deploy_log="$(gh run view --job "$deploy_job_id" --log-failed 2>/dev/null || true)"
          if [ -n "$deploy_log" ]; then
            echo ""
            echo "🔍 Deploy failure diagnosis:"
            if printf '%s' "$deploy_log" | grep -q "NonExistentQueue"; then
              echo "  → SQS queue drift detected (queues deleted outside CloudFormation)"
              echo "  → Fix: deploy-doctor.py drift -s <stage> --profile devlocal --repair"
            fi
            if printf '%s' "$deploy_log" | grep -q "GetSignedArtifactURL"; then
              echo "  → Stale build artifact (404 on download)"
              echo "  → Fix: deploy-doctor.py artifact -r <run-id> --fix"
            fi
            if printf '%s' "$deploy_log" | grep -q "DELETE_IN_PROGRESS state and can not be updated"; then
              echo "  → Stack stuck in DELETE_IN_PROGRESS (likely Step Functions executions blocking delete)"
              echo "  → Fix: stop all running executions on the state machine, then rerun deploy"
            fi
            if printf '%s' "$deploy_log" | grep -qE "Function not found:.*Lambda"; then
              echo "  → Phantom Lambda resource (CFN thinks it exists but Lambda API says no)"
              echo "  → Fix: deploy-doctor.py phantoms -s <stage> --profile devlocal --repair"
            fi
            if printf '%s' "$deploy_log" | grep -q "UPDATE_ROLLBACK_FAILED"; then
              echo "  → Stack stuck in UPDATE_ROLLBACK_FAILED"
              echo "  → Fix: aws cloudformation continue-update-rollback --resources-to-skip <logical-ids> (use full CDK IDs with hash suffixes)"
            fi
          fi
        fi
      fi

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
