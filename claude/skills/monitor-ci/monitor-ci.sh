#!/bin/bash
set -uo pipefail

# Usage: monitor-ci.sh <PR_NUMBER> <BRANCH>
if [ $# -lt 2 ]; then
  echo "Usage: $0 <PR_NUMBER> <BRANCH>"
  exit 1
fi

PR_NUMBER="$1"
BRANCH="$2"
CHECK_INTERVAL=300
MAX_CHECKS=12
IGNORED_CHECKS="Mergify Merge Protections"
COMMENT_IDS_FILE="/tmp/monitor-ci-comments-${PR_NUMBER}.txt"

unset GH_TOKEN 2>/dev/null || true
gh api "repos/team-plain/services/pulls/${PR_NUMBER}/comments" --jq '.[].id' > "$COMMENT_IDS_FILE" 2>/dev/null || touch "$COMMENT_IDS_FILE"

echo "=== CI Monitor started for PR #${PR_NUMBER} on ${BRANCH} ==="

parse_checks() {
  python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    checks = [c for c in data if c['name'] != '$IGNORED_CHECKS']
    total = len(checks)
    passed = sum(1 for c in checks if c['state'] == 'SUCCESS')
    failed = [c['name'] for c in checks if c['state'] == 'FAILURE']
    pending = [c['name'] for c in checks if c['state'] in ('PENDING', 'IN_PROGRESS')]
    print(f'TOTAL={total}')
    print(f'PASSED={passed}')
    print(f'FAILED_COUNT={len(failed)}')
    print(f'PENDING_COUNT={len(pending)}')
    failed_str = '|'.join(failed)
    pending_str = '|'.join(pending[:5])
    print(f\"FAILED_NAMES='{failed_str}'\")
    print(f\"PENDING_NAMES='{pending_str}'\")
    print(f'ALL_PASSED={\"true\" if passed == total and total > 0 else \"false\"}')
except Exception as e:
    print(f'ERROR={e}')
" 2>&1
}

handle_failure() {
  echo ""
  echo "=== FAILURE DETECTED: ${FAILED_NAMES//|/, } ==="
  echo ""

  CHECKS_DETAIL=$(gh pr checks "$PR_NUMBER" --json name,state,link 2>/dev/null)
  FAILED_URLS=$(echo "$CHECKS_DETAIL" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for c in data:
    if c['state'] == 'FAILURE' and c['name'] != '$IGNORED_CHECKS':
        print(c['name'] + '|' + c.get('link', ''))
" 2>/dev/null)

  echo "$FAILED_URLS" | while IFS='|' read -r check_name detail_url; do
    echo "--- Failed check: ${check_name} ---"
    echo "URL: ${detail_url}"

    WORKFLOW_ID=$(echo "$detail_url" | grep -oE 'workflows/[a-f0-9-]+' | head -1 | sed 's|workflows/||')
    if [ -n "$WORKFLOW_ID" ]; then
      echo "CircleCI workflow: ${WORKFLOW_ID}"

      JOBS_JSON=$(curl -s -H "Circle-Token: $CIRCLECI_TOKEN" \
        "https://circleci.com/api/v2/workflow/${WORKFLOW_ID}/job" 2>/dev/null)

      FAILED_JOBS=$(echo "$JOBS_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for j in data.get('items', []):
    if j['status'] == 'failed':
        print(str(j['job_number']) + '|' + j['name'])
" 2>/dev/null)

      echo "$FAILED_JOBS" | while IFS='|' read -r job_number job_name; do
        [ -z "$job_number" ] && continue
        echo ""
        echo "Failed job: ${job_name} (#${job_number})"

        TEST_RESULTS=$(curl -s -H "Circle-Token: $CIRCLECI_TOKEN" \
          "https://circleci.com/api/v2/project/gh/team-plain/services/${job_number}/tests" 2>/dev/null)

        echo "$TEST_RESULTS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
failed = [t for t in data.get('items', []) if t.get('result') == 'failure']
if not failed:
    print('(No structured test results from CircleCI API)')
else:
    for t in failed[:15]:
        name = t.get('name', '?')
        classname = t.get('classname', '')
        message = t.get('message', '')[:500]
        print(f'  FAILED TEST: {classname} > {name}')
        if message:
            print(f'    Message: {message}')
        print()
" 2>/dev/null
      done
    else
      JOB_NUM=$(echo "$detail_url" | grep -oE '/services/[0-9]+' | head -1 | sed 's|/services/||')
      if [ -n "$JOB_NUM" ]; then
        echo "CircleCI job: #${JOB_NUM}"
        TEST_RESULTS=$(curl -s -H "Circle-Token: $CIRCLECI_TOKEN" \
          "https://circleci.com/api/v2/project/gh/team-plain/services/${JOB_NUM}/tests" 2>/dev/null)

        echo "$TEST_RESULTS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
failed = [t for t in data.get('items', []) if t.get('result') == 'failure']
if not failed:
    print('(No structured test results from CircleCI API)')
else:
    for t in failed[:15]:
        name = t.get('name', '?')
        classname = t.get('classname', '')
        message = t.get('message', '')[:500]
        print(f'  FAILED TEST: {classname} > {name}')
        if message:
            print(f'    Message: {message}')
        print()
" 2>/dev/null
      fi
    fi
  done

  echo ""
  echo "=== Exiting for analysis. Review failures above and decide: retrigger, rebase, or fix. ==="
  rm -f "$COMMENT_IDS_FILE"
  exit 2
}

# --- Initial check: see where CI stands right now ---
echo ""
echo "--- Initial status check ($(date +%H:%M:%S)) ---"
CHECKS_JSON=$(gh pr checks "$PR_NUMBER" --json name,state 2>&1)
PARSED=$(echo "$CHECKS_JSON" | parse_checks)
eval "$PARSED" 2>/dev/null

if [ "${TOTAL:-0}" -eq 0 ]; then
  echo "Status: No checks found yet. CI hasn't started."
  echo "Waiting 2 minutes for CI to start..."
  sleep 120
elif [ "${ALL_PASSED:-false}" = "true" ]; then
  echo "Status: All ${TOTAL} checks already passed!"
  echo ""
  echo "=== ALL ${TOTAL} CHECKS PASSED! PR #${PR_NUMBER} is ready for review. ==="
  rm -f "$COMMENT_IDS_FILE"
  exit 0
elif [ "${FAILED_COUNT:-0}" -gt 0 ] && [ "${PENDING_COUNT:-0}" -eq 0 ]; then
  echo "Status: ${PASSED:-?}/${TOTAL:-?} passed, ${FAILED_COUNT:-?} failed, ${PENDING_COUNT:-?} pending"
  echo "All checks completed with failures — skipping to analysis."
  handle_failure
else
  echo "Status: ${PASSED:-?}/${TOTAL:-?} passed, ${FAILED_COUNT:-?} failed, ${PENDING_COUNT:-?} pending"
  [ -n "${FAILED_NAMES:-}" ] && [ "${FAILED_COUNT:-0}" -gt 0 ] && echo "Failed: ${FAILED_NAMES//|/, }"
  [ -n "${PENDING_NAMES:-}" ] && [ "${PENDING_COUNT:-0}" -gt 0 ] && echo "Pending: ${PENDING_NAMES//|/, }"
  echo "Checks still in progress. Starting monitoring loop..."
fi

# --- Monitoring loop ---
for i in $(seq 1 $MAX_CHECKS); do
  echo ""
  echo "--- Check ${i}/${MAX_CHECKS} ($(date +%H:%M:%S)) ---"

  CHECKS_JSON=$(gh pr checks "$PR_NUMBER" --json name,state 2>&1)
  PARSED=$(echo "$CHECKS_JSON" | parse_checks)
  eval "$PARSED" 2>/dev/null

  echo "Status: ${PASSED:-?}/${TOTAL:-?} passed, ${FAILED_COUNT:-?} failed, ${PENDING_COUNT:-?} pending"
  [ -n "${FAILED_NAMES:-}" ] && [ "${FAILED_COUNT:-0}" -gt 0 ] && echo "Failed: ${FAILED_NAMES//|/, }"
  [ -n "${PENDING_NAMES:-}" ] && [ "${PENDING_COUNT:-0}" -gt 0 ] && echo "Pending: ${PENDING_NAMES//|/, }"

  if [ "${ALL_PASSED:-false}" = "true" ]; then
    echo ""
    echo "=== ALL ${TOTAL} CHECKS PASSED! PR #${PR_NUMBER} is ready for review. ==="
    rm -f "$COMMENT_IDS_FILE"
    exit 0
  fi

  # Check for new reviewer comments (every other iteration)
  if [ $((i % 2)) -eq 0 ]; then
    NEW_COMMENTS=$(gh api "repos/team-plain/services/pulls/${PR_NUMBER}/comments" --jq '.[] | {id, path, line, body, user: .user.login}' 2>/dev/null || echo "")
    if [ -n "$NEW_COMMENTS" ]; then
      NEW_IDS=$(echo "$NEW_COMMENTS" | python3 -c "
import sys, json
known = set()
try:
    with open('$COMMENT_IDS_FILE') as f:
        known = set(f.read().strip().split('\n'))
except: pass
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        obj = json.loads(line)
        if str(obj['id']) not in known:
            user = obj.get('user', '?')
            path = obj.get('path', '?')
            line_num = obj.get('line', '?')
            body = obj.get('body', '')[:200]
            if 'BUGBOT_BUG_ID' not in body:
                print(f'NEW_COMMENT: @{user} on {path}:{line_num}: {body}')
    except: pass
" 2>/dev/null)
      if [ -n "$NEW_IDS" ]; then
        echo ""
        echo "$NEW_IDS"
      fi
      gh api "repos/team-plain/services/pulls/${PR_NUMBER}/comments" --jq '.[].id' > "$COMMENT_IDS_FILE" 2>/dev/null
    fi
  fi

  # Handle failures only when all checks have completed
  if [ "${FAILED_COUNT:-0}" -gt 0 ] && [ "${PENDING_COUNT:-0}" -eq 0 ]; then
    handle_failure
  fi

  echo "Next check in $((CHECK_INTERVAL / 60)) minutes..."
  sleep $CHECK_INTERVAL
done

echo ""
echo "=== Monitoring timed out after ${MAX_CHECKS} checks. Last: ${PASSED:-?}/${TOTAL:-?} passed, ${FAILED_COUNT:-?} failed. ==="
rm -f "$COMMENT_IDS_FILE"
exit 1
