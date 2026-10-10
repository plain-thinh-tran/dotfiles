---
name: check-deploy
description: Watch a merged team-plain/services PR through the deploy pipeline into prod-uk, with deterministic checks on the behaviour the PR changed and a Slack ping when it needs Thinh. Use when asked to check, watch or monitor a deploy, or after a PR merges to main.
---

# Check Deploy

Watch one merged PR from merge to a healthy prod-uk. The scripts own the loop and every pass/fail decision; your job is to understand the PR, write checks for the behaviour it changes, and act on what the loop raises.

PR number is required; ask if it is missing. Run from a `team-plain/services` checkout. Scripts live in `~/.claude/skills/check-deploy/scripts/`.

## 1. Understand the PR

```bash
~/.claude/skills/check-deploy/scripts/context.py <pr>
```

It writes the context dir `.context/check-deploy/pr-<N>/` with `pr.md` (title, description, changed files, merge commit), `services.txt` (Datadog service globs derived from `lambdas/`, `services/` and `terraform/services/` paths) and `state.json` (the deploy run carrying the merge commit).

Read `pr.md` and `gh pr diff <pr> -R team-plain/services`. Then:

- Write down, in two or three sentences, what behaviour changes in prod and which runtime paths carry it.
- Extend `services.txt` with the Datadog service of every consumer of the shared code `pr.md` lists (one glob per line, e.g. `slack-webhook-handler*`). Errors in these services count as ours.

Done when every changed runtime path maps to a service in `services.txt` or is infra only.

## 2. Write the checks

One read-only probe per changed behaviour in `<ctx>/checks/NN-name.sh`. A check is deterministic: same prod state, same answer.

- First line `# phase: prod` (runs once prod-uk aliases are promoted) or `# phase: always`.
- Exit 0 for pass, non-zero for fail. The last stdout line is the evidence shown in reports.
- The runner provides `AWS_PROFILE=prod-uk-claude-read-only`, `AWS_REGION`, `PROD_START_MS`, `PROD_DONE_MS`, `CTX`, and `$DD` (`$DD logs-count '<query>' <since-ms>`, `$DD errors <env> <since-ms>`).
- Cover three angles: the resources or config the PR adds exist and are wired; the changed path carries traffic; its failure sinks (DLQs, error metrics, error logs) stay empty. Give traffic checks a warm-up window instead of failing straight after deploy.

Run each check once by hand (`bash <check>` with those variables set) before watching. A check that fails on a typo or a permission is a broken check: fix it now. `examples/pr-11513/` is a worked set (ingest queues wired, DLQs empty, traffic flowing, no Lambda errors).

Done when every behaviour from step 1 has a check and every check runs cleanly by hand (pre-deploy failures are expected).

## 3. Watch

Start `scripts/watch.sh <ctx>` with the Monitor tool (`timeout_ms: 1800000`), and re-arm it on expiry until the script exits. Every 60s it runs `tick.py`, which checks:

- **Pipeline**: the `deploy.yml` run that contains the merge commit (it follows a newer run if this one is cancelled).
- **Datadog Error Tracking**: prod-uk issues first seen since the prod deploy started, or first seen at the deployed commit, split into ours (`services.txt`) and other.
- **Checks**: every script in `checks/`.

A tick prints only when something changed. `ATTENTION` lines appear once per new problem. Exit 10 is done and healthy: prod-uk deployed at least 15 minutes ago, run green, 3 clean ticks in a row. Exit 11 means the deploy run failed.

## 4. Act on ATTENTION

Ping with `~/.claude/skills/ping/scripts/slack-notify.sh "<message>"`. Message shape: `🚨 PR #<N> deploy: <what broke> | <evidence> | <link>`.

| Line | Action |
| --- | --- |
| `ATTENTION pipeline ...` | CI is blocked. Ping at once, then read `gh run view --log-failed --job <id>` and send a follow-up ping saying whether this PR caused it. |
| `ATTENTION error ours ...` | A new error in a service this PR touches. Ping at once with the issue link, then investigate. |
| `ATTENTION error other ...` | Investigate whether this PR's change can produce it: the issue's stack and logs, the deployed diff, prod state through `prod-uk-claude-read-only`. Ping when it links to this PR or you cannot rule that out. |
| `ATTENTION check failed ...` | Investigate the same way. Ping when prod behaviour is wrong. When the check itself is wrong, fix it and say so in the report. |
| `ATTENTION tick crashed ...` | Fix the cause (credentials, a check). Ping if it persists for 3 ticks. |

Investigation stays read-only: `prod-uk-claude-read-only` for AWS, the `datadog` skill for logs, metrics and traces.

## 5. Report

On exit 10 or 11, report:

```text
## Check Deploy: PR #<N> (<healthy | failed | needs attention>)

**Pipeline**: <conclusion> (run <id>)
**Behaviour checked**: <one line per check: PASS/FAIL + evidence>
**Errors**: <new issues since prod deploy, ours / other, or none>
**Pinged**: <each ping sent and why, or none>
```
