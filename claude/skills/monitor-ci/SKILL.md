---
name: monitor-ci
description: Monitor PR CI checks, retrigger CircleCI on failure, check for new reviewer comments, and proactively report status. Use when user asks to monitor tests, check CI, or watch PR checks.
allowed-tools: Bash, Read
---

# Monitor CI

Monitor CI checks for a PR on `team-plain/services`. PR number is optional; resolve from current branch if not provided.

## Setup

1. Resolve PR and branch:
   ```bash
   BRANCH=$(git branch --show-current)
   PR=$(unset GH_TOKEN && gh pr list --head "$BRANCH" --json number --jq '.[0].number')
   ```
2. Get current check status: `unset GH_TOKEN && gh pr checks $PR --json name,state`
3. Ignore `Mergify Merge Protections` — it's a merge gate, not a real check.

## Loop

Poll every 5 minutes. Run in foreground — never use `run_in_background`. Stop conditions:

- All checks passed → report success, stop
- Failure detected (no checks pending) → analyze, then act
- 1 hour elapsed → report timeout, stop

If the Bash tool times out mid-sleep, re-run — the loop is idempotent.

Between polls, check for new PR review comments (skip bugbot).

## On Failure

**Never blindly retrigger.** Always analyze first:

1. Fetch failed test names from CircleCI:
   ```bash
   curl -s -H "Circle-Token: $CIRCLECI_TOKEN" \
     "https://circleci.com/api/v2/project/gh/team-plain/services/<JOB_NUMBER>/tests"
   ```
2. Review our diff: `git diff origin/main..HEAD --stat`
3. Check if main already has a fix: `git fetch origin main && git diff origin/main -- <failing-file>`

Then decide:

| Diagnosis | Action |
|-----------|--------|
| Our changes broke it | Fix, commit, push, resume monitoring |
| Fix already on main | Rebase onto main, push, resume monitoring |
| Broken on main too, no fix | Fix the test, commit, push, resume monitoring |
| Flaky / unrelated | Retrigger CircleCI, resume monitoring |

Known flaky: `run-email-e2e-itest-pr`

## Retrigger

```bash
curl -s -X POST "https://circleci.com/api/v2/project/gh/team-plain/services/pipeline" \
  -H "Circle-Token: $CIRCLECI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"branch": "<BRANCH>"}'
```

Max 3 retrigger attempts per flaky test. If it fails 3 times, it's broken — stop and fix.

## Output

```text
## CI Monitor — HH:MM

**PR**: #<number> on <branch>
**Status**: <passed>/<total> checks passed

| Check           | Status |
|-----------------|--------|
| run-itest-pr    | ✅ / ❌ / ⏳ |
| run-utest-pr    | ✅ / ❌ / ⏳ |
| ...             | ...    |
```

Be concise; report status, not raw JSON.
