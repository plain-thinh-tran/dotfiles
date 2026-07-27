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
| `Deploy / Deploy SST Stage` failed | Run `deploy-doctor.py`, see below |

Known flaky: `Email E2E Test` (the script auto-reruns this one).

## Deploy failures on a PR stage

`Deploy / Deploy SST Stage` failing almost never means the PR's code is wrong. `Setup` failing alongside it is not a second failure; it gates the integration test workflow on the deploy and its whole log is `Deploy / Deploy SST Stage completed with conclusion: failure`. Diagnose the deploy, ignore `Setup`.

`deploy-doctor.py` covers the two environment failures that cost the most time. Both are read-only by default.

```bash
./deploy-doctor.py drift -s pr-indigo --profile devlocal [--repair]
./deploy-doctor.py artifact -r <run-id> [--fix]
```

### AWS.SimpleQueueService.NonExistentQueue

Symptom: event source mappings go `CREATE_FAILED` with `The specified queue does not exist`, the owning stacks hit `ROLLBACK_COMPLETE`, and `DEPENDENCY_FAILED` cascades into most other stacks.

Cause: the queues were deleted outside CloudFormation. The state stacks holding them still report `CREATE_COMPLETE`, so `pre-deploy-cleanup` (which only deletes stacks in a *failed* state) never touches them and every rerun repeats the same failure. Rerunning cannot fix this.

`drift --repair` recreates them from the stack templates, reusing the exact names. Queue ARNs derive from names, so existing SNS subscriptions and S3 bucket notification configs, which survive the queue deletion, wire straight back up. It also reapplies the `AWS::SQS::QueuePolicy` documents, which die with the queue and would otherwise leave S3 and SNS unable to send.

Check the whole stage, not just the queues named in the error log. Only the queues with a failing event source mapping show up there; others drift silently until something references them.

### Artifact 404

Symptom: the deploy fails in seconds, never reaching CloudFormation, with `Unable to download artifact(s): Failed to GetSignedArtifactURL: ... (404) Not Found: workflow run not found`.

Cause: the artifact was uploaded on an early attempt and later attempts cannot resolve it, while it still lists as present and unexpired. `Check SST build artifact` therefore keeps skipping the build, so the deploy keeps trying to download something it cannot fetch. This loops forever.

`artifact --fix` deletes the artifacts and triggers a **full** rerun. A `--failed` rerun is not enough: it skips the build job again and reproduces the 404.

### Retry discipline

Set a retry budget before starting and say what it is. Two distinct infra failures in a row means the environment needs repair, not another rerun. If the diagnosis genuinely changes (root cause fixed, new unrelated error), it is fine to continue, but say so rather than quietly resetting the count.
