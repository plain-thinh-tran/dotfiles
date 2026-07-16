---
name: create-pr
description: Create a pull request with rebase, Linear issue link, and concise description.
allowed-tools: Bash, Read, Grep, Glob
---

# Create PR

`create-pr.sh` owns the mechanics. This skill covers the judgment around it: when to split, how to title, and what to do after the PR is up.

## Script

`create-pr.sh` requires a Linear id, renames the branch to `<LINEAR_ID>-<slug>`, commits all changes, runs the pre-push checks (`pnpm typecheck` + `format:fix` on JS/TS repos), rebases on the base, pushes, and opens a draft PR whose body is only the Linear link. It injects the Linear id into the title (`Refactor: x` → `Refactor(PE-484): x`) and does nothing if a PR already exists for the branch.

```bash
./create-pr.sh -l PE-192 -t "<Category>: <title>" [-m "<commit msg>"] [-b <base>]
```

Prerequisite: create the Linear ticket first (team Platform, assigned to me) — the script will not run without a valid id.

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

### Inline reviewer comments

Add inline comments on non-obvious, important changes to help the reviewer.

Comment on: design decisions where alternatives existed, tricky logic, a shared pattern across files (explain once, reference elsewhere), IAM/infra justification, graceful fallbacks. Do NOT comment on imports, formatting, obvious renames, or anything a reviewer gets in 5 seconds.

Voice: broadcast register. Match `~/.claude/skills/draft-msg/voice-profile.md` — clean grammar, no hedging, no filler. No titles; jump into the explanation. Defend the decision (why this approach), 2-4 sentences. If several files share a pattern, explain it once and write "Same pattern as above".

```bash
unset GH_TOKEN && gh api repos/<owner>/<repo>/pulls/<number>/comments \
  -f commit_id="<sha>" -f path="<file>" -f side="RIGHT" -F line=<line> -f body="<comment>"
```

For multi-line comments add `-F start_line=<start> -f start_side="RIGHT"`.
