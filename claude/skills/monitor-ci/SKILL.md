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
| Stack CREATE fails with "Validation failed" | `deploy-doctor.py orphans` |
| Stack stuck in DELETE_IN_PROGRESS | `deploy-doctor.py stuck-delete` |
| Stack stuck in UPDATE_ROLLBACK_FAILED | `deploy-doctor.py rollback-fix` |
| "Function not found" on a healthy stack | `deploy-doctor.py phantoms` |
| Deploy checks SKIPPED | Empty commit or ignored-files-only change; rebase on main and push |
| All integration tests fail with same DB error | Environment database is corrupt; nuke and redeploy (see below) |

Known flaky: `Email E2E Test` (the script auto-reruns this one).

## Deploy failures on a PR stage

You have AWS `devlocal` profile access to modify or delete CloudFormation stacks, SSM parameters, SQS queues, and other infra resources. Fix infra problems yourself; do not ask the user unless it requires a code change or is beyond what deploy-doctor and direct AWS access can resolve.

`Deploy / Deploy SST Stage` failing almost never means the PR's code is wrong. `Setup` failing alongside it is not a second failure; it gates the integration test workflow on the deploy and its whole log is `Deploy / Deploy SST Stage completed with conclusion: failure`. Diagnose the deploy, ignore `Setup`.

`deploy-doctor.py` covers six environment failures that cost the most time. All are read-only by default. Hardwired to the `devlocal` AWS profile; no other profile is accepted.

```bash
./deploy-doctor.py drift -s pr-indigo [--repair]
./deploy-doctor.py phantoms -s pr-indigo [--repair]
./deploy-doctor.py stuck-delete -s pr-indigo [--repair]
./deploy-doctor.py rollback-fix -s pr-indigo [--repair]
./deploy-doctor.py orphans -s pr-indigo --stack CoreApiStack [--repair]
./deploy-doctor.py artifact -r <run-id> [--fix]
```

### AWS.SimpleQueueService.NonExistentQueue

Symptom: event source mappings go `CREATE_FAILED` with `The specified queue does not exist`, the owning stacks hit `ROLLBACK_COMPLETE`, and `DEPENDENCY_FAILED` cascades into most other stacks.

Cause: the queues were deleted outside CloudFormation. The state stacks holding them still report `CREATE_COMPLETE`, so `pre-deploy-cleanup` (which only deletes stacks in a *failed* state) never touches them and every rerun repeats the same failure. Rerunning cannot fix this.

`drift --repair` recreates them from the stack templates, reusing the exact names. Queue ARNs derive from names, so existing SNS subscriptions and S3 bucket notification configs, which survive the queue deletion, wire straight back up. It also reapplies the `AWS::SQS::QueuePolicy` documents, which die with the queue and would otherwise leave S3 and SNS unable to send.

Check the whole stage, not just the queues named in the error log. Only the queues with a failing event source mapping show up there; others drift silently until something references them.

After `drift --repair`, stacks that were in `ROLLBACK_COMPLETE` may have been deleted by `pre-deploy-cleanup`. SST then tries to UPDATE them but they no longer exist, failing with `Stack [name] does not exist`. A `--failed` rerun hits the same error. Use a full rerun (`gh run rerun <id>`, not `gh run rerun <id> --failed`) so SST issues a CREATE instead of an UPDATE.

### Orphaned Named Resources (Validation Failed)

Symptom: a stack (typically `CoreApiStack`) fails CREATE with `Validation failed with N error(s)` and immediately rolls back. No resource-level events appear in CloudFormation; no resources are attempted. The template validates fine standalone.

Cause: the stack was previously deleted (manually or by cleanup), but some of its named resources survived. SSM parameters are the most common orphans since they aren't deleted when a `ROLLBACK_COMPLETE` stack is removed. CloudFormation rejects the CREATE because the named resources already exist outside the stack.

`orphans --repair` finds the template (from the failed stack or CDK assets bucket), extracts hardcoded resource names, checks which ones exist in AWS, deletes the orphans, and cleans up the `ROLLBACK_COMPLETE` stack. Covers SSM parameters, Lambda functions, and API Gateway V2 APIs.

Diagnosis shortcut: if the deploy log shows `Validation failed with 2 error(s)` and only 4 stack-level events (CREATE_IN_PROGRESS, CREATE_FAILED, ROLLBACK_IN_PROGRESS, ROLLBACK_COMPLETE), it's almost certainly orphaned resources.

### Stuck Stack Delete (Step Functions Blocking)

Symptom: deploy fails with `stack ... is in DELETE_IN_PROGRESS state and can not be updated`. The stack hangs in DELETE_IN_PROGRESS indefinitely.

Cause: a Step Functions state machine in the stack has running executions. CloudFormation waits for the state machine to delete, but it can't delete while executions are running. This loops forever.

`stuck-delete --repair` finds all DELETE_IN_PROGRESS stacks in the stage, lists Step Functions state machines with running executions, stops all executions, and waits for the stack deletes to complete.

### UPDATE_ROLLBACK_FAILED (Rollback Fix)

Symptom: deploy fails with a stack stuck in `UPDATE_ROLLBACK_FAILED`. CloudFormation tried to roll back an update but the rollback itself failed because the resources it tried to restore no longer exist.

Cause: phantom resources (deleted outside CloudFormation). The rollback tries to update them back to their previous state, but they're gone.

`rollback-fix --repair` reads the failing logical resource IDs from stack events (with full CDK hash suffixes), calls `continue-update-rollback --resources-to-skip` to skip the phantom resources, and waits for the stack to reach UPDATE_ROLLBACK_COMPLETE. No need to manually find CDK hash suffixes; the script reads them from CloudFormation events.

### Phantom Lambda Resources (Function Not Found)

Symptom: a stack fails with `Function not found: arn:aws:lambda:...:function:pr-<stage>-services-<Name>`. The stack that owns the Lambda shows `CREATE_COMPLETE` but the Lambda was deleted outside CloudFormation.

Cause: severe environment drift where CloudFormation's state is completely wrong. The owning stack looks healthy so `pre-deploy-cleanup` never touches it, and SST skips it because it thinks nothing changed. Other stacks that reference the Lambda (permissions, integrations, event source mappings) fail on CREATE.

`phantoms --repair` scans all healthy stacks for Lambda functions, checks each against the Lambda API, empties any S3 buckets in affected stacks (non-empty buckets block CFN delete), and deletes the stacks. SST recreates them on the next deploy.

Unlike `drift` (which recreates resources in place), phantom Lambdas can't be recreated outside CFN (they need code bundles, IAM roles, environment variables). The only fix is deleting the stale stack.

### Artifact 404

Symptom: the deploy fails in seconds, never reaching CloudFormation, with `Unable to download artifact(s): Failed to GetSignedArtifactURL: ... (404) Not Found: workflow run not found`.

Cause: the artifact was uploaded on an early attempt and later attempts cannot resolve it, while it still lists as present and unexpired. `Check SST build artifact` therefore keeps skipping the build, so the deploy keeps trying to download something it cannot fetch. This loops forever.

`artifact --fix` deletes the artifacts and triggers a **full** rerun. A `--failed` rerun is not enough: it skips the build job again and reproduces the 404.

### Corrupt Environment (Nuke and Redeploy)

Symptom: all integration test shards fail with the same database-level error (e.g. `customer_already_exists_with_external_id`), or multiple deploy-doctor subcommands are needed in sequence, or stacks have cascading phantom resources. The environment is too far gone for incremental repair.

Always prefer cleaning up yourself using the `devlocal` AWS profile over triggering `pr-cleanup-manual.yml`. You have more control, can parallelize deletions, handle dependency ordering, empty S3 buckets, stop Step Functions executions, and resolve issues the workflow can't (it runs sequentially and fails on the first blocker).

Nuke procedure (local, preferred):

1. List all stacks: `aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE ROLLBACK_COMPLETE DELETE_FAILED --profile devlocal --region eu-west-2 --query 'StackSummaries[?starts_with(StackName,\`pr-<stage>\`)].StackName'`
2. Stop any Step Functions executions blocking deletes (list-executions, stop-execution in parallel with xargs -P)
3. Empty S3 buckets in stacks that have them (`aws s3 rm s3://<bucket> --recursive`)
4. Delete ROLLBACK_COMPLETE and DELETE_FAILED stacks first
5. Delete remaining stacks (respect dependency order: child stacks before parents with cross-stack exports)
6. For stacks in UPDATE_ROLLBACK_FAILED: `aws cloudformation continue-update-rollback --resources-to-skip <logical-ids>` (use full CDK logical IDs with hash suffixes)
7. Verify zero stacks remain
8. Push a commit with real file changes (not empty) to trigger a full deploy on the clean environment

Key gotchas:
- Step Functions state machines with running executions block CloudFormation delete indefinitely
- S3 buckets must be emptied before stack delete
- `continue-update-rollback --resources-to-skip` needs full CDK logical IDs (e.g. `MSTeamsWebhookHandlerMessageGrouper0867310A`), not bare names
- Empty commits don't trigger deploy (evaluate step sees no file changes + existing GitHub deployment record and skips)
- After nuking, push a rebase on main or a real file change, not an empty commit

Fallback (if SSO token expires or local access is unavailable):

```bash
unset GH_TOKEN && gh workflow run pr-cleanup-manual.yml \
  -f github-username=$(gh api user --jq '.login') \
  -f stage-name=pr-<stage>
```

This is slower (sequential, can't handle all blockers) but works without local AWS credentials.

### Retry discipline

Set a retry budget before starting and say what it is. Two distinct infra failures in a row means the environment needs repair, not another rerun. If the diagnosis genuinely changes (root cause fixed, new unrelated error), it is fine to continue, but say so rather than quietly resetting the count.
