---
name: monitor-ci
description: Monitor PR CI checks, retrigger CircleCI on failure, check for new reviewer comments, and proactively report status. Use when user asks to monitor tests, check CI, or watch PR checks.
allowed-tools: Bash, Read
---

# Monitor CI

Monitor CI checks for a PR using a reusable bash script at `~/.claude/skills/monitor-ci/monitor-ci.sh`.

## Critical Rules

- **NEVER use `run_in_background` for ANY command in this skill** — not the monitoring script, not the polling loop, not retrigger checks, NOTHING. Background tasks silently complete without notifying the user, which defeats the entire purpose of monitoring. ALL commands MUST run in foreground so results are immediately visible and reported. If a foreground Bash call times out, re-run it in foreground — never switch to background as a workaround.
- **Always give clear status updates** — Before every step, tell the user what you're doing. After every step, report the outcome. The user should never wonder what's happening.
- **Always ignore `Mergify Merge Protections`** — it's not a real check, just a merge gate (already handled in the script).
- **NEVER blindly retrigger CI.** Always analyze test failures first. The script now exits with failure details instead of auto-retriggering.
- **NEVER rebase automatically.** Only rebase if failure analysis shows the fix is already on main. See step 5.
- **Stop retrying and fix broken tests immediately.** After the FIRST failure, analyze it. If the same tests fail consistently and are clearly broken (not flaky), do NOT retrigger. Stop monitoring and fix the test. The goal is to make checks green, not to retry endlessly.
- **Check main for existing fixes before writing your own.** Before writing a fix for a broken test, ALWAYS run `git log origin/main -- <failing-test-file>` and `git diff origin/main -- <failing-test-file>` to see if someone already fixed it on main. If so, just rebase. This avoids duplicate work and merge conflicts.

## Workflow

### 1. Determine PR number and branch

Tell the user: "Determining PR number and branch..."

```bash
BRANCH=$(git branch --show-current)
PR_NUMBER=$(unset GH_TOKEN && gh pr list --head "$BRANCH" --json number --jq '.[0].number')
```

If a PR number is provided as an argument, use that instead.

Tell the user: "Monitoring PR #<number> on branch <branch>"

### 2. Check current CI status first

**Before doing anything else**, check the current state of CI checks:

Tell the user: "Checking current CI status..."

```bash
unset GH_TOKEN && gh pr checks <PR_NUMBER> --json name,state
```

Based on the result, decide the next action:

| Current State | Action |
|---|---|
| **All checks passed** (all SUCCESS, ignoring Mergify) | Tell the user "All CI checks already passing!" and you're done |
| **Some checks failed, none pending** | Skip straight to failure analysis (step 5) — no need to wait |
| **Checks are pending/in-progress** | Proceed to step 3 (monitor loop) |
| **No checks at all** | Proceed to step 3 (monitor loop, CI hasn't started yet) |

Report the status to the user before proceeding.

### 3. Run the monitoring script

Tell the user: "Starting CI monitoring loop (checks every 5 minutes, up to 1 hour)..."

```bash
bash ~/.claude/skills/monitor-ci/monitor-ci.sh <PR_NUMBER> <BRANCH>
```

Use a **timeout of 600000ms** (10 minutes) for the Bash tool. The script handles its own internal sleep/timing.

**IMPORTANT**: Since the script sleeps internally and the Bash tool timeout may be shorter than the full loop, you may need to **re-run the script** when it times out mid-sleep. The script is idempotent — it picks up from the current CI state each time. Tell the user "Script timed out, re-running to continue monitoring..." when this happens.

### 4. Interpret exit codes

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | All checks passed | Tell user: "All CI checks passed! PR is ready for review." |
| 1 | Timed out (still pending) | Tell user: "Still waiting on checks, re-running monitor..." and re-run |
| 2 | Failure detected with details | Tell user: "CI failures detected, analyzing..." then proceed to step 5 |

### 5. Analyze failures (exit code 2)

Tell the user: "Analyzing test failures against our PR diff..."

The script prints failed test names and error messages from CircleCI. You MUST analyze them before deciding what to do:

1. **Read the test failure output** from the script
2. **Review our PR diff** (`git diff origin/main..HEAD --stat` and read relevant files if needed)
3. **Check if main already has a fix** for the failing tests:
   ```bash
   git fetch origin main
   git log origin/main -- <failing-test-file>
   git diff origin/main -- <failing-test-file>
   ```
   If main already has the fix, just rebase — do NOT write a duplicate fix.
4. **Determine the cause and tell the user your conclusion, then take the appropriate action:**

   - **Our changes caused it**: Tell user "Failure is related to our changes — investigating..." → fix, commit, push, re-run the script
   - **Broken test, fix already on main**: Tell user "Failure is fixed on main already — rebasing..." → `git fetch origin main && git rebase origin/main && git push --force-with-lease`, then re-run the script
   - **Broken test, NOT fixed on main**: Tell user "Test is broken on main too — fixing..." → fix the test, commit, push, re-run the script. Do NOT retrigger — the test will just fail again.
   - **Truly flaky / unrelated**: Tell user "Failure is unrelated to our changes (<reason>) — retriggering CI..." → retrigger CircleCI and re-run the script
   - **Known flaky**: `run-email-e2e-itest-pr` is a known flaky test → tell user and retrigger

5. **To retrigger CircleCI** (only after confirming the failure is truly flaky/unrelated):
```bash
curl -s -X POST "https://circleci.com/api/v2/project/gh/team-plain/services/pipeline" \
  -H "Circle-Token: $CIRCLECI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"branch": "<BRANCH>"}'
```

6. **After retriggering, use the fast retry loop** instead of re-running the full monitoring script. Check CircleCI job timing to estimate how long to wait — the itest job typically takes ~12 minutes (setup ~1min, deploy wait ~8min, test run ~2.5min). Use a **2-minute poll interval** to detect results quickly instead of the script's default 5-minute interval:

```bash
BRANCH="<BRANCH>"
PR=<PR_NUMBER>
MAX_ATTEMPTS=3
ATTEMPT=1

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
  echo "=== Attempt $ATTEMPT/$MAX_ATTEMPTS ==="
  for i in $(seq 1 10); do
    sleep 120
    ITEST_STATE=$(unset GH_TOKEN && gh pr checks $PR --json name,state --jq '.[] | select(.name=="ci/circleci: run-itest-pr") | .state')
    PASSED=$(unset GH_TOKEN && gh pr checks $PR --json name,state --jq '[.[] | select(.name != "Mergify Merge Protections") | select(.state == "SUCCESS")] | length')
    TOTAL=$(unset GH_TOKEN && gh pr checks $PR --json name,state --jq '[.[] | select(.name != "Mergify Merge Protections")] | length')
    echo "  Poll $i: $PASSED/$TOTAL passed | itest=$ITEST_STATE"
    [ "$ITEST_STATE" = "SUCCESS" ] && echo "=== ALL CHECKS PASSED ===" && exit 0
    [ "$ITEST_STATE" = "FAILURE" ] && break
  done
  ATTEMPT=$((ATTEMPT + 1))
  if [ $ATTEMPT -le $MAX_ATTEMPTS ]; then
    echo "  Retriggering (attempt $ATTEMPT)..."
    curl -s -X POST "https://circleci.com/api/v2/project/gh/team-plain/services/pipeline" \
      -H "Circle-Token: $CIRCLECI_TOKEN" -H "Content-Type: application/json" \
      -d "{\\"branch\\": \\"$BRANCH\\"}"
  fi
done
echo "=== FAILED after $MAX_ATTEMPTS attempts ==="
```

Use a **timeout of 600000ms** for this loop. To check test duration beforehand:
```bash
curl -s -H "Circle-Token: $CIRCLECI_TOKEN" "https://circleci.com/api/v2/project/gh/team-plain/services/<JOB_NUMBER>/tests" | \
  python3 -c "import json,sys; [print(f\"{t['name']}: {t['run_time']}s\") for t in json.load(sys.stdin).get('items',[]) if t.get('result')=='failure']"
```

7. **Max retriggers for flaky tests**: Up to 3 attempts total. If the same test fails 3 times, it's not flaky — it's broken. Stop retriggering and fix it or report to the user.

## What the script does

- Does an initial status check, then monitors every 5 minutes (up to 12 checks = ~1 hour)
- If all checks already passed or already failed on initial check, exits immediately (no waiting)
- Filters out `Mergify Merge Protections` from all counts
- Detects new PR review comments (skipping bugbot) and reports them
- On failure: fetches CircleCI test results (failed test names + error messages) and exits for agent analysis
- Does NOT auto-retrigger — the agent must analyze first
