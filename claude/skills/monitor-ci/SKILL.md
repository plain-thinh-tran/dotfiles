---
name: monitor-ci
description: Monitor PR CI checks, rerun failed GitHub Actions jobs on failure, check for new reviewer comments, and proactively report status. Use when user asks to monitor tests, check CI, or watch PR checks.
allowed-tools: Bash, Read
---

# Monitor CI

Monitor CI for a PR on `team-plain/services`. `ci-monitor.sh` runs the loop; this skill covers analysing a real failure, which the script deliberately leaves to you.

## Script

`ci-monitor.sh` runs the strict loop: prints a fixed layout every poll, ignores the `Mergify Merge Protections` gate, auto-reruns only known-flaky jobs (max 3 rounds), and stops on any non-flaky failure instead of retriggering blindly.

```bash
./ci-monitor.sh [-p <PR>] [-i <interval_sec>] [-t <timeout_sec>]
```

Defaults: PR from current branch, interval 300s, timeout 3600s. Exit codes: `0` all green, `1` real failure or flaky exhausted, `2` timeout.

The script does not read review comments. Between polls, check for new PR review comments (skip bugbot) and surface them.

## When the script stops on a real failure

Never blindly retrigger. Analyse first:

1. Fetch the failing job's logs (run/job id from the check link URL `.../actions/runs/<RUN_ID>/job/<JOB_ID>`):
   ```bash
   unset GH_TOKEN && gh pr checks <PR> --json name,state,link
   unset GH_TOKEN && gh run view --job <JOB_ID> --log-failed
   ```
2. Review our diff: `git diff origin/main..HEAD --stat`
3. Check if main already has a fix: `git fetch origin main && git diff origin/main -- <failing-file>`

Then decide:

| Diagnosis | Action |
|-----------|--------|
| Our changes broke it | Fix, commit, push, resume monitoring |
| Fix already on main | Rebase onto main, push, resume monitoring |
| Broken on main too, no fix | Fix the test, commit, push, resume monitoring |
| Flaky / unrelated | Rerun failed jobs, resume monitoring |

Known flaky: `Email E2E Test` (the script auto-reruns this one).
