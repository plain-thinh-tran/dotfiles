---
name: create-pr
description: Create a pull request with rebase, Linear issue link, and concise description.
allowed-tools: Bash, Read, Grep, Glob
---

# Create PR

`create-pr.sh` owns the mechanics. This skill covers the judgment around it: when to split, how to title, and what to do after the PR is up.

## Script

`create-pr.sh` requires a Linear id, renames the branch to `<LINEAR_ID>/<slug>` (slug from the description only, so `-l PE-521 -t "Fix: mute weekday only cron monitors"` → `PE-521/mute-weekday-only-cron-monitors`), commits all changes, runs the pre-push checks (typecheck + `format:fix` on JS/TS repos; typecheck goes through `~/.claude/bin/typecheck-changed`), rebases on the base, pushes, and opens a draft PR whose body starts with a `> Fixes [LINEAR_ID](url)` blockquote followed by an HTML comment containing GitHub callout templates (plus an Error Tracking skeleton with `-e`, see below) (NOTE, TIP, IMPORTANT, WARNING, CAUTION) for you to fill out. It injects the Linear id into the title (`Refactor: x` → `Refactor(PE-484): x`) and does nothing if a PR already exists for the branch.

```bash
./create-pr.sh -l PE-192 -t "<Category>: <title>" [-m "<commit msg>"] [-b <base>] [-e <error tracking url>]
```

Prerequisite: create the Linear ticket first (team Platform, assigned to me) — the script will not run without a valid id.

## Error Tracking Issues

Before running the script, fetch the Linear issue (Linear MCP `get_issue`). It is an Error Tracking issue when the description contains a `https://app.datadoghq.eu/error-tracking/issue/<id>` link. These are created by Datadog and usually sit in the "Error Tracking Issues" milestone.

For those, pass the link with `-e`. The script then adds it to the `> Fixes` line and scaffolds a body with a summary, `## Why`, and `## Evidence`, each carrying an HTML comment placeholder. Once the PR is up, replace the placeholders with `gh pr edit <number> --body-file <file>`:

- Summary: what changed, in one or two sentences. Add an ASCII diagram of the affected path (before vs after, or read vs write) only when it clarifies the fix.
- Why: the root cause. What triggers the error, which caller or data hits it, and why it happens (legacy rows, new caller, race).
- Evidence: fill the error tracking line (error type and message, service, event count and window, whether it still happens) from the Datadog issue. Add the error payload or stack trace in a code block, and the query, logs, or screenshot that proves the root cause.

Adapt to the fix: drop the diagram or any evidence that adds nothing, add sections when the change needs them (rollout, backfill, follow ups). Delete leftover placeholder comments. Reference: [team-plain/services#11040](https://github.com/team-plain/services/pull/11040).

## Before running

- One logical change per PR. If you can't summarize it in one title, split it.
- Don't mix unrelated changes (formatting, refactors, feature work → separate PRs).
- Smaller is better. If it touches 20+ files with different concerns, break it up.

## Title format

Format: `<Category>(<LINEAR_ID>): <description>`, under 70 characters. Pass `-t "<Category>: <description>"`; the script adds the `(<LINEAR_ID>)`.

| Category | When to use |
|----------|-------------|
| `Fix:` | Bug fixes, broken behavior |
| `Feature:` | New functionality |
| `Refactor:` | Code restructuring, no behavior change |
| `Chore:` | Dependencies, config, CI, tooling |
| `Docs:` | Documentation only |
| `Perf:` | Performance improvements |
| `Test:` | Adding or updating tests only |

Example: `-t "Fix: correlationId propagation for DLQ debugging"` with `-l PE-192` → `Fix(PE-192): correlationId propagation for DLQ debugging`

## After the PR is up

### Cursor Bugbot

Bugbot analyzes the diff and may leave review comments. Check them:

```bash
unset GH_TOKEN && gh api repos/<owner>/<repo>/pulls/<number>/comments
```

For each finding: evaluate against the code, fix if valid (commit + push), then reply and resolve. Reply format, factual, no "good catch":

```
Fixed in <short-sha>. <One sentence explaining the fix.>
```

If the finding is not valid, reply explaining why and resolve.

### CI failures

Use the `monitor-ci` skill. If `Deploy / Deploy SST Stage` fails, reach for its `deploy-doctor.py` before rerunning anything: PR-stage deploys usually fail on environment drift, not on the PR's code.
