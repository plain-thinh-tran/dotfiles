---
name: prod-ready-check
description: Verdict on whether a PR is safe to merge to production, hunting breaking changes and regressions with Claude and Codex reviewing independently and reporting only what both find. Use when asked if a PR is prod ready, safe to merge, or has breaking changes or regressions.
allowed-tools: Bash, Read, Grep, Glob, WebFetch
---

# Prod Ready Check

Two reviewers, one report: you and a blind Codex (Sol) pass review the same PR independently, and the report carries only findings both reached. Agreement is the filter; independence is what makes it worth anything, so neither reviewer sees the other's findings before committing its own.

## Steps

1. **Gather.** From inside a clone of the PR's repo, run `~/.claude/skills/prod-ready-check/gather.sh <pr-number|pr-url>`. It writes `summary.md`, `diff.patch`, and raw JSON to `.context/prod-ready-check/pr-<N>/` (the context dir) and fetches the PR head to the local ref `pr-<N>`. Done when the summary prints.
   - Read code from `pr-<N>` and `origin/<base>` only. Workspace branches and local `main` are stale.
   - The rtk wrapper compacts `git show` / `git diff` output. Use `rtk proxy git ...` when you need whole files.
2. **Launch Codex.** Run `~/.claude/skills/prod-ready-check/codex-review.sh <context-dir>` with `run_in_background`. It runs `codex exec` read-only on `gpt-5.6-sol` (override with `CODEX_MODEL`) and writes `codex.json` in [`findings.schema.json`](findings.schema.json) shape. Leave `codex.json` and `codex.log` unopened until step 8.
3. **Bigger picture.** From "Author PRs Touching the Same Area" and "PRs Sharing a Ticket", name the series this PR belongs to. Read the merged precedents with `gh pr diff <n>` for the pattern this PR copies, including follow-up fix PRs and failed deploy runs after them (`gh run list --workflow deploy.yml --commit <sha>`). Read the open siblings for files they share with it. Done when you can state in two sentences: the series, what must merge or deploy before this PR, and which open siblings it collides with.
4. **Parity.** For every changed file, find what it replaces or what consumes it: the old implementation being moved, the sibling path, callers of changed exports, other stacks importing its outputs, readers of changed schemas and env vars. Compare old and new behaviour attribute by attribute. Done when every changed file is either parity checked or carries a finding.
5. **Lenses.** Apply every lens in [`lenses.md`](lenses.md). Done when each lens has a finding or a one line clearance.
6. **Verify.** Every finding that rests on an external fact (cloud API constraint, provider behaviour, generated names, live state) gets a source: a read-only live query (AWS read-only profile, `gh api`), library source in `node_modules`, or a vendor doc or upstream source fetched with WebFetch or `curl`. A finding you cannot settle keeps confidence `low` and records the command that would settle it.
7. **Commit.** Write your findings to `<context-dir>/claude.json` in `findings.schema.json` shape. Done when the file exists; it is your sealed answer.
8. **Reconcile.** Wait for the Codex task, then read `codex.json` (on failure, `codex.log`). Pair findings by root cause: same defect through the same mechanism, wording and exact line may differ. A pair is agreed; everything else is one-sided. When the two severities differ, report the one your evidence supports and show both labels. Write one-sided findings from both sides to `<context-dir>/one-sided.md` with their evidence. Done when every finding from both files is either paired or in `one-sided.md`.
   - Codex failed or produced no `codex.json`: stop, show the `codex.log` tail, and ask whether to rerun or report your findings marked single-model.
9. **Pattern sweep.** For each agreed finding that comes from a code shape the series repeats, check the open siblings from step 3 for the same shape and list the affected PR numbers.
10. **Report** in the format below, built from agreed findings only. Posting comments to the PR is outward facing: ask first.

## Report

```
Verdict: Ready | Ready after fixes | Not ready, <one sentence why>
Reviewers: Claude + Codex <model>, <n> agreed, <m> one-sided (see <context-dir>/one-sided.md)

## Breaking
1. <what> (`path:line`). <concrete failure>. Fix: <fix>. Source: <url, source file, or command output>

## Regression
## Worth Knowing        non-blocking: behaviour changes, rollback hazards, dead code
## Checked and Fine     parity checks both reviewers list as passing
## Bigger Picture       series, prerequisites, siblings sharing an agreed finding
```

The verdict follows from agreed findings only. Drop empty sections. Lead with the verdict.
