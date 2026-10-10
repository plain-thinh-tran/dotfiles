---
name: prod-ready-check
description: Verdict on whether a PR's code is safe to merge to production, hunting breaking changes, regressions, dead code and design improvements with Claude, Codex and Grok reviewing blind, then debating until all three agree, reporting only unanimous findings and flagging the rest. Use when asked if a PR is prod ready, safe to merge, or has breaking changes, regressions or dead code.
allowed-tools: Bash, Read, Grep, Glob, WebFetch
---

# Prod Ready Check

Three reviewers, one report: you, Codex (Sol) and Grok 4.6 review the same PR blind, then debate every finding over up to three rounds, each round answering the others' arguments. A finding is reported only when all three hold it, dropped only when none do, and anything still split after the debate is flagged to the user to decide. Blind first so nobody anchors on the others; debate second so a real finding one side missed can win the others over and a weak one gets withdrawn.

Scope is the code. Never report CI results, merge status, approvals, or PR process.

## Steps

1. **Gather.** From inside a clone of the PR's repo, run `~/.claude/skills/prod-ready-check/gather.sh <pr-number|pr-url>`. It writes `summary.md`, `diff.patch`, and raw JSON to `.context/prod-ready-check/pr-<N>/` (the context dir) and fetches the PR head to the local ref `pr-<N>`. Done when the summary prints.
   - Read code from `pr-<N>` and `origin/<base>` only. Workspace branches and local `main` are stale.
   - The rtk wrapper compacts `git show` / `git diff` output. Use `rtk proxy git ...` when you need whole files.
2. **Launch peers.** Start `~/.claude/skills/prod-ready-check/review.sh <context-dir> codex` and `review.sh <context-dir> grok`, each with `run_in_background`. Codex runs `codex exec` read-only on `gpt-6-sol` (override with `CODEX_MODEL`); Grok runs `cursor-agent` in read-only ask mode on `cursor-grok-4.6-medium` (override with `GROK_MODEL`, needs `CURSOR_API_KEY`). Each writes `<peer>.json` in [`findings.schema.json`](findings.schema.json) shape. Leave their `.json` and `.log` files unopened until step 8.
3. **Bigger picture.** From "Author PRs Touching the Same Area" and "PRs Sharing a Ticket", name the series this PR belongs to. Read the merged precedents with `gh pr diff <n>` for the pattern this PR copies, including follow-up fix PRs. Read the open siblings for files they share with it. Done when you can state the series, what must merge or deploy before this PR, and which open siblings it collides with.
4. **Parity.** For every changed file, find what it replaces or what consumes it: the old implementation being moved, the sibling path, callers of changed exports, other stacks importing its outputs, readers of changed schemas and env vars. Compare old and new behaviour attribute by attribute. Done when every changed file is either parity checked or carries a finding.
5. **Lenses.** Apply every lens in [`lenses.md`](lenses.md), including dead code and design. Done when each lens has a finding or a one line clearance.
6. **Verify.** Every finding that rests on an external fact (cloud API constraint, provider behaviour, generated names, live state) gets a source: a read-only live query (AWS read-only profile, `gh api`, Datadog), library source in `node_modules`, or a vendor doc or upstream source fetched with WebFetch or `curl`. Every dead-code finding names the repo wide search that proves nothing reaches it. A finding you cannot settle keeps confidence `low` and records the command that would settle it.
7. **Commit.** Write your findings to `<context-dir>/claude.json` in `findings.schema.json` shape. Done when the file exists; it is your sealed answer.
8. **Debate.** Wait for both peer tasks (on failure, show the `<peer>.log` tail and ask whether to rerun or stop). Then:
   1. Run `debate.sh items <context-dir>`. It numbers every finding into `debate/items.json`: `C*` yours, `X*` Codex's, `G*` Grok's.
   2. For round `n` (1 to 3): start `debate.sh round <context-dir> <n> codex` and `debate.sh round <context-dir> <n> grok`, each with `run_in_background`. While they run, write your own positions to `debate/round-<n>.claude.json` in [`debate.schema.json`](debate.schema.json) shape, without opening either peer's `round-<n>` file. Round 1 covers every item; later rounds cover only the `contested` items of the previous tally.
      - From round 2, read both peers' latest reason and evidence on each contested item and answer their argument in your `reason`: what convinced you, or exactly why it fails against the code. The goal is to convince, not to vote.
      - On the peers' items: `agree`, `revise` (real, different severity or fix), or `disagree`, after checking the code yourself. On your own: `agree` to maintain, `revise`, or `withdraw` when an argument or your re-check shows it wrong. Never concede to end the debate, and never hold a position the code contradicts.
      - Two items with the same root cause take the same stance; name the other id in `reason`.
   3. When both peer rounds finish, run `debate.sh tally <context-dir> <n>`. Items are `agreed` (all three agree or revise), `dropped` (none do), or `contested`. Stop when nothing is contested or after round 3.
   - Done when the final tally exists. Write every item that ended `contested` to `<context-dir>/not-agreed.md` with all three sides' last stance, reason and evidence.
9. **Pattern sweep.** For each agreed finding that comes from a code shape the series repeats, check the open siblings from step 3 for the same shape and list the affected PR numbers.
10. **Report** in the format below. Findings sections come from `agreed` items in the final tally only; `contested` items go under Needs Your Call. Merge items that share a root cause. Posting comments to the PR is outward facing: ask first.
11. **Mission Control.** When the final tally has contested items or agreed breaking or regression findings, run `bun ~/dotfiles/mission-control/bin/prc-to-mc.ts <context-dir> | ~/.claude/bin/mc push -` (run id `prc-<repo>-<pr>`), then start `~/.claude/bin/mc wait <runId>` with `run_in_background` and end the turn after the report. When the wait prints decisions:
    - Fold each into the report: "fix in this PR" moves the item to its severity section, "follow up separately" moves it to Worth Knowing marked follow up, "drop" removes it. Restate the verdict only if it changed.
    - Run `~/.claude/bin/mc resolve <runId> <id> "<what changed in the report>"` for each decision.
    - Wait again while anything is still open; when nothing is, run `~/.claude/bin/mc done <runId>`. On `TIMEOUT`, start the wait once more.

Model choices for the peer seats come from the benchmark in `~/.claude/skills/model-bench/results.md`; rerun `/model-bench` when a new model ships.

## Report

```
Verdict: Ready | Ready after fixes | Not ready, <one sentence why> | Needs your call, <one sentence on the split>
Reviewers: Claude + Codex <model> + Grok <model>, <r> debate rounds, <n> agreed, <d> dropped, <m> contested (see <context-dir>/not-agreed.md)

## Needs Your Call   no consensus after the debate
1. <id> <what> (`path:line`). Holds: <who, why>. Rejects: <who, why>. Settle by: <command or check>

## Breaking
1. <what> (`path:line`). <concrete failure>. Fix: <fix>. Source: <url, source file, or command output>

## Regression
## Worth Knowing        non-blocking: behaviour changes, rollback hazards
## Dead Code            <code> (`path:line`), unreached because <search result>. Remove: <what>
## Refactor             <code> (`path:line`), <existing helper or repo pattern>. Change: <sketch>
## Bigger Picture       only siblings sharing an agreed finding
```

Every item is something the user must change or check. The verdict follows from agreed findings, except that a contested item any reviewer rates breaking or regression makes it `Needs your call` unless agreed findings already make it `Not ready`. When severities differ, report the one the evidence supports and show both labels. Drop empty sections. Lead with the verdict.
