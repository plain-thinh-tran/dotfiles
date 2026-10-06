---
name: prod-ready-check
description: Verdict on whether a PR is safe to merge to production, hunting breaking changes and regressions and placing it among the author's related PRs. Use when asked if a PR is prod ready, safe to merge, or has breaking changes or regressions.
allowed-tools: Bash, Read, Grep, Glob, WebFetch
---

# Prod Ready Check

Every finding names a concrete failure in deploy, production traffic, data, or rollback. Style, naming, and taste stay out of the report.

## Steps

1. **Gather.** From inside a clone of the PR's repo, run `~/.claude/skills/prod-ready-check/gather.sh <pr-number|pr-url>`. It writes `summary.md` plus raw JSON and `diff.patch` to `.context/prod-ready-check/pr-<N>/` and fetches the PR head to the local ref `pr-<N>`. Done when the summary prints.
   - Read code from `pr-<N>` and `origin/<base>` only. Workspace branches and local `main` are stale.
   - The rtk wrapper compacts `git show` / `git diff` output. Use `rtk proxy git ...` when you need whole files.
2. **Bigger picture.** From "Author PRs Touching the Same Area" and "PRs Sharing a Ticket", name the series this PR belongs to. Read the merged precedents with `gh pr diff <n>` for the pattern this PR copies, and the open siblings for files they share with it (merge order, conflicts, numbered files like migrations). Done when you can state in two sentences: the series, what must merge or deploy before this PR, and which open siblings it collides with.
3. **Parity.** For every changed file, find what it replaces or what consumes it: the old implementation being moved, the sibling path, callers of changed exports, readers of changed schemas, outputs, and env vars. Compare old and new behaviour attribute by attribute. Done when every changed file is either parity checked or carries a finding.
4. **Lenses.** Apply every lens below to the diff. Done when each lens has a finding or a one line clearance.
5. **Verify.** Every finding that rests on an external fact (cloud API constraint, provider behaviour, generated names, live state) gets a source: a read-only live query (AWS read-only profile, `gh api`) or a vendor doc fetched with WebFetch. Cite it in the report. A finding you cannot settle goes under Unverified with the exact command that would settle it.
6. **Pattern sweep.** When a finding comes from a code shape the series repeats, check the open siblings from step 2 for the same shape and list the affected PR numbers.
7. **Report** in the format below. Posting comments to the PR is outward facing: ask first.

## Lenses

- **Deploy**: does the pipeline fail? Ordering across systems (OpenTofu vs SST, migrations vs code), state imports matching live ids and names, ForceNew attributes on imported resources, `prevent_destroy` collisions, missing env vars, permissions, secrets.
- **Contract**: routes, paths, methods, headers, auth and IP policy, event and stored schema fields without `.default()`, removed outputs or exports still consumed.
- **Data**: deletes, shortened retention, missing DeletionPolicy Retain, irreversible migrations.
- **Silent regression**: behaviour the old path had that the new one drops (redeploy triggers, validation, logging, metrics, alarms, tracing, warming).
- **Operability**: routine future edits that will apply and do nothing (config not in a redeploy trigger, duplicated values that will drift).
- **Rollback**: what breaks if prod rolls back to the commit before this PR. Call out one way doors.
- **Blast radius**: edits to shared constants, utils, and lists that change behaviour for other callers.
- **Gate**: failing or pending CI, unresolved review threads, changes requested, base drift on changed files.

## Report

```
Verdict: Ready | Ready after fixes | Not ready, <one sentence why>

## Breaking
1. <what> (`path:line`). <concrete failure>. Fix: <fix>. Source: <url or command output>

## Regression
## Worth Knowing        non-blocking: behaviour changes, rollback hazards, dead code
## Checked and Fine     one line per parity check that passed
## Unverified           finding + the command that settles it
## Bigger Picture       series, prerequisites, siblings sharing a finding
```

Drop empty sections. Lead with the verdict.
