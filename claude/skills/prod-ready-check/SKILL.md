---
name: prod-ready-check
description: Verdict on whether a PR's code is safe to merge to production, hunting breaking changes, regressions, dead code and design improvements with Claude and Codex reviewing blind, then debating until they agree, reporting only consensus findings. Use when asked if a PR is prod ready, safe to merge, or has breaking changes, regressions or dead code.
allowed-tools: Bash, Read, Grep, Glob, WebFetch
---

# Prod Ready Check

Two reviewers, one report: you and Codex (Sol) review the same PR blind, then debate each other's findings over up to three rounds. The report carries only findings both still hold after the debate. Blind first so neither anchors on the other; debate second so a real finding one side missed can win the other over and a weak one gets withdrawn.

Scope is the code. Never report CI results, merge status, approvals, or PR process.

## Steps

1. **Gather.** From inside a clone of the PR's repo, run `~/.claude/skills/prod-ready-check/gather.sh <pr-number|pr-url>`. It writes `summary.md`, `diff.patch`, and raw JSON to `.context/prod-ready-check/pr-<N>/` (the context dir) and fetches the PR head to the local ref `pr-<N>`. Done when the summary prints.
   - Read code from `pr-<N>` and `origin/<base>` only. Workspace branches and local `main` are stale.
   - The rtk wrapper compacts `git show` / `git diff` output. Use `rtk proxy git ...` when you need whole files.
2. **Launch Codex.** Run `~/.claude/skills/prod-ready-check/codex-review.sh <context-dir>` with `run_in_background`. It runs `codex exec` read-only on `gpt-5.6-sol` (override with `CODEX_MODEL`) and writes `codex.json` in [`findings.schema.json`](findings.schema.json) shape. Leave `codex.json` and `codex.log` unopened until step 8.
3. **Bigger picture.** From "Author PRs Touching the Same Area" and "PRs Sharing a Ticket", name the series this PR belongs to. Read the merged precedents with `gh pr diff <n>` for the pattern this PR copies, including follow-up fix PRs. Read the open siblings for files they share with it. Done when you can state the series, what must merge or deploy before this PR, and which open siblings it collides with.
4. **Parity.** For every changed file, find what it replaces or what consumes it: the old implementation being moved, the sibling path, callers of changed exports, other stacks importing its outputs, readers of changed schemas and env vars. Compare old and new behaviour attribute by attribute. Done when every changed file is either parity checked or carries a finding.
5. **Lenses.** Apply every lens in [`lenses.md`](lenses.md), including dead code and design. Done when each lens has a finding or a one line clearance.
6. **Verify.** Every finding that rests on an external fact (cloud API constraint, provider behaviour, generated names, live state) gets a source: a read-only live query (AWS read-only profile, `gh api`, Datadog), library source in `node_modules`, or a vendor doc or upstream source fetched with WebFetch or `curl`. Every dead-code finding names the repo wide search that proves nothing reaches it. A finding you cannot settle keeps confidence `low` and records the command that would settle it.
7. **Commit.** Write your findings to `<context-dir>/claude.json` in `findings.schema.json` shape. Done when the file exists; it is your sealed answer.
8. **Debate.** Wait for the Codex task (on failure, show the `codex.log` tail and ask whether to rerun or stop). Then:
   1. Run `debate.sh items <context-dir>`. It numbers every finding into `debate/items.json`: `C*` yours, `X*` Codex's.
   2. For round `n` (1 to 3): start `debate.sh codex <context-dir> <n>` with `run_in_background`. While it runs, write your own positions to `debate/round-<n>.claude.json` in [`debate.schema.json`](debate.schema.json) shape, without opening `round-<n>.codex.json`. Round 1 covers every item; later rounds cover only the `contested` items of the previous tally.
      - On Codex's items: `agree`, `revise` (real, different severity or fix), or `disagree`, after checking the code yourself. On your own: `agree` to maintain, `revise`, or `withdraw` when Codex's argument or your re-check shows it wrong. Never concede to end the debate, and never hold a position the code contradicts.
      - Two items with the same root cause take the same stance; name the other id in `reason`.
      - If every contested item is yours and you withdraw them all, nothing is left for Codex to answer: write `{"positions":[]}` to `round-<n>.codex.json` instead of running it.
   3. When the Codex round finishes, run `debate.sh tally <context-dir> <n>`. Items are `agreed` (owner maintains, other side agrees or revises), `dropped` (owner withdraws), or `contested`. Stop when nothing is contested or after round 3.
   - Done when the final tally exists. Write every item that ended `contested` or `dropped` to `<context-dir>/not-agreed.md` with both sides' last reason and evidence.
9. **Pattern sweep.** For each agreed finding that comes from a code shape the series repeats, check the open siblings from step 3 for the same shape and list the affected PR numbers.
10. **Report** in the format below, built from `agreed` items in the final tally only. Merge items that share a root cause. Posting comments to the PR is outward facing: ask first.

## Report

```
Verdict: Ready | Ready after fixes | Not ready, <one sentence why>
Reviewers: Claude + Codex <model>, <r> debate rounds, <n> agreed, <m> not agreed (see <context-dir>/not-agreed.md)

## Breaking
1. <what> (`path:line`). <concrete failure>. Fix: <fix>. Source: <url, source file, or command output>

## Regression
## Worth Knowing        non-blocking: behaviour changes, rollback hazards
## Dead Code            <code> (`path:line`), unreached because <search result>. Remove: <what>
## Refactor             <code> (`path:line`), <existing helper or repo pattern>. Change: <sketch>
## Bigger Picture       only siblings sharing an agreed finding
```

Every item is something the user must change or check. The verdict follows from agreed findings only. When severities differ, report the one the evidence supports and show both labels. Drop empty sections. Lead with the verdict.
