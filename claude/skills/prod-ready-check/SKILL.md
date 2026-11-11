---
name: prod-ready-check
description: Verdict on whether a PR can go out as it is, and if not, why and what must change, with Claude, Codex and Cursor reviewing blind, then debating until all three agree. On someone else's PR it produces a review for the author (fixes and things to check again, with draft inline comments); on Thinh's own PR it checks whether the change would break CI or production. Use when asked if a PR is prod ready, safe to merge, to review a PR, or whether a PR will break CI or prod.
allowed-tools: Bash, Read, Grep, Glob, WebFetch
---

# Prod Ready Check

Up to three reviewers, one report (the risk tier below decides how many): you, Codex and Cursor (models from `mc seats`) review the same PR blind, then debate every finding over up to three rounds, each round answering the others' arguments. A finding is reported only when all three hold it, dropped only when none do, and anything still split after the debate is flagged to the user to decide. Blind first so nobody anchors on the others; debate second so a real finding one side missed can win the others over and a weak one gets withdrawn.

Scope is the code. Never report the PR's current CI status, approvals or process; predicting whether the code will fail CI or production is in scope, and so is a conflict with the base branch (`git merge-tree --write-tree origin/<base> pr-<N>` shows it): a PR that cannot merge cannot go out, so report it as "Rebase needed" with the conflicting files.

## Goal and Modes

The primary goal is the verdict: can this PR go out as it is? When it cannot, say exactly why and what has to change. Everything else serves that answer. Pick the mode from the PR author (`author.login` in `meta.json`) against Thinh's GitHub login (`gh api user --jq .login`):

- **Someone else's PR: review for the author.** Thinh wants to give them a good review: what they must fix and what they should check again. Explain each finding plainly enough that he understands it before he posts anything.
- **Thinh's own PR: will it break CI or prod?** Add a CI lens on top of the usual ones: generated files that must be regenerated (database schema dumps, the table DAG, GraphQL types, webhook snapshots), typecheck of the touched projects with `~/.claude/bin/typecheck-changed`, the unit and local integration tests covering changed code, lint and format. Then the deploy lens: migration safety, event schema compatibility (new fields need `.default()`), infra and IAM, env vars, rollout order. Run these checks in a temporary worktree (`git worktree add --detach /tmp/prc-<N> pr-<N>`, removed afterwards), never by switching the branch of the workspace you were started in; `typecheck-changed` there sees the PR's changes even when the branch is already pushed. Running local checks is fine; nothing touches a shared environment. The output is a fix list for Thinh: no draft comments and no walkthrough, just what breaks, why, and the change that fixes it.

## Risk Tier

Not every PR needs three models. `gather.sh` leaves lock files, built assets, snapshots and generated files out of `diff.patch` (it keeps the whole diff as `diff.full.patch` and lists what it left out in `filtered.md`; open one of those only when a finding depends on it) and sizes what is left into a tier, printed and saved in `tier.txt`: `full` past 20 files, 200 changed lines or any sensitive path (`auth/`, `crypto/`, `permission(s)/`, `migration(s)/`, `*.tf`, an `iam` path segment, `.github/workflows/`), `trivial` up to 20 changed lines, else `lite`. Thinh can override it in the request ("full review"). The tier decides who reviews:

| Tier | Scouts | Peers | Debate | Specialists |
|---|---|---|---|---|
| trivial | none | none | none | none |
| lite | 1 | Codex | 1 round, `PRC_PEERS=codex PRC_MAX_ROUNDS=1` | none |
| full | 2 to 4 | Codex and Cursor | up to 3 rounds | Sonnet specialists in step 5 |

On trivial you review alone: skip steps 2 and 8, and every finding you keep in `claude.json` counts as agreed (write `debate/tally-1.json` yourself with each finding as an item, `status` `agreed` and only a `claude` position). On lite, start only `review.sh <context-dir> codex` and prefix every `debate.sh` call with `PRC_PEERS=codex PRC_MAX_ROUNDS=1`. "Both peers" and "all three" below then mean the reviewers that take part.

## Steps

At the start of each step below, run `~/.claude/bin/mc step "<step, under 6 words>" --agent <claude|codex|cursor|haiku|sonnet>` (the seat doing that step) (for example "Gathering PR #11513", "Debate round 2", "Writing the report") so the user sees progress in Mission Control; run `~/.claude/bin/mc step --clear` after the report.

1. **Gather.** From inside a clone of the PR's repo, run `~/.claude/skills/prod-ready-check/gather.sh <pr-number|pr-url>`. It writes `summary.md`, `diff.patch`, and raw JSON to `.context/prod-ready-check/pr-<N>/` (the context dir) and fetches the PR head to the local ref `pr-<N>`. Done when the summary prints.
   - Read code from `pr-<N>` and `origin/<base>` only. Workspace branches and local `main` are stale.
   - The rtk wrapper compacts `git show` / `git diff` output. Use `rtk proxy git ...` when you need whole files.
2. **Scout, then launch peers.**
   - Scouts skip the files `filtered.md` lists.
   - Scout first, so all three reviewers start from the same map (`~/.claude/bin/mc step "Scouting the PR" --agent haiku`). Send 2 to 4 scouts in parallel (Agent tool, `model` set to `SCOUT_MODEL` from `~/.claude/bin/mc seats --env`, default `"haiku"`, and `effort` set to `SCOUT_EFFORT` when it is not empty; `review.sh` reads the Codex and Cursor seats itself), splitting the changed files between them. Each returns file:line evidence only, no opinions: callers and consumers of changed exports, tests that cover the changed code, the sibling or old implementation it replaces, readers of changed schemas, env vars and outputs. Scouts read code only with `git show pr-<N>:<path>` and `git show origin/<base>:<path>`. Merge their answers into `<context-dir>/scout.md`, one section per changed file. Done when every changed file has an entry, or "no consumers found" with the search used. The peers get `scout.md` as leads, and `prc-to-mc.ts` lists Haiku as a seat when the file exists.
   - Then start `~/.claude/skills/prod-ready-check/review.sh <context-dir> codex` and `review.sh <context-dir> cursor`, each with `run_in_background`. Codex runs `codex exec` read-only on the Codex seat from `mc seats` (`gpt-6.1-sol` at high effort; override with `CODEX_MODEL` and `CODEX_EFFORT`); Cursor runs `cursor-agent` in read-only ask mode on the Cursor seat from `mc seats` (`gpt-5.6-sol-high-fast`; override with `CURSOR_MODEL`, needs `CURSOR_API_KEY`). Both time out after `PEER_TIMEOUT` (900s). Each writes `<peer>.json` in [`findings.schema.json`](findings.schema.json) shape. Leave their `.json` and `.log` files unopened until step 8.
3. **Bigger picture.** From "Author PRs Touching the Same Area" and "PRs Sharing a Ticket", name the series this PR belongs to. Read the merged precedents with `gh pr diff <n>` for the pattern this PR copies, including follow-up fix PRs. Read the open siblings for files they share with it. Done when you can state the series, what must merge or deploy before this PR, and which open siblings it collides with. Sibling PRs in other repos (gather.sh searches the whole org for the ticket ids) often hold the other half of the change: save their diffs with `gh pr diff <n> -R <repo> > <context-dir>/external/<repo>-<n>.patch` so the peers can read them too, and tell them it is there.
4. **Parity.** Start from `scout.md` and verify every claim in it yourself; scouts give leads, not conclusions. For every changed file, find what it replaces or what consumes it: the old implementation being moved, the sibling path, callers of changed exports, other stacks importing its outputs, readers of changed schemas and env vars. Compare old and new behaviour attribute by attribute. A parity claim ("the new path behaves like its sibling") needs the sibling's full guard chain traced, including gates that live elsewhere (an enable flag that requires `isDomainConfigured`, say); without that, a real gap gets cleared as parity. Done when every changed file is either parity checked or carries a finding.
5. **Lenses.** On the full tier, first send three specialists in parallel (Agent tool, `model: "sonnet"`, `~/.claude/bin/mc step "Specialist review" --agent sonnet`), each with the context dir, `scout.md`, the shared "Never report" paragraph of `lenses.md` and only its own lenses: Security (only what is exploitable: who attacks, the input they control, what they get; no hardening ideas), Deploy and contract (Deploy, Contract, Rollback, Operability) and Data and regression (Data, Silent regression, Blast radius). Each returns findings with file:line evidence, in `findings.schema.json` shape. You are their coordinator: verify each against the code yourself, drop the wrong ones, merge the ones with one root cause into your own findings, and still apply every lens below. Codex and Cursor stay generalists, so the debate keeps three independent views. Then apply every lens in [`lenses.md`](lenses.md), including dead code and design, then hold every finding against [`taste.md`](taste.md) when it exists: those rules come from findings Thinh dropped, so leave out a finding a rule covers, within the exception the file states. Done when each lens has a finding or a one line clearance.
6. **Verify.** Every finding that rests on an external fact (cloud API constraint, provider behaviour, generated names, live state) gets a source: a read-only live query (AWS read-only profile, `gh api`, Datadog), library source in `node_modules`, or a vendor doc or upstream source fetched with WebFetch or `curl`. Every dead-code finding names the repo wide search that proves nothing reaches it. A finding you cannot settle keeps confidence `low` and records the command that would settle it.
   - This skill is read only. Never create, change or delete anything in any environment on your own. When a breaking or regression finding could be confirmed by reproducing it on dev-uk with plain:live, propose it instead: what you would run, what it would prove, which throwaway artifacts it creates (a `createWorkspace` workspace, Postmark domains) and how they get deleted. List these proposals in the report under "Want me to validate?" and run one only after Thinh says yes to that specific proposal. When he does: merge the PR onto current `origin/main` locally first (dev-uk's schema moves past the PR's merge base), use your own `PLAIN_LIVE_SESSION` tag, export credentials with `eval $(aws configure export-credentials --profile dev-uk --format env)` and `AWS_REGION=eu-west-2`, for UI paths run a second support app from a worktree on :3001 with its own `NEXT_PUBLIC_PLAIN_TEST_METADATA` tag, never touch a shared workspace, delete every artifact you created, and record what you saw in the finding's verification.
7. **Commit.** Write your findings to `<context-dir>/claude.json` in `findings.schema.json` shape. Done when the file exists; it is your sealed answer.
8. **Debate.** Wait for both peer tasks. A peer that fails or times out drops out: never rerun it and never ask. Continue with the reviewers left by prefixing every later `debate.sh` call with `PRC_PEERS=<peer still in>` (for example `PRC_PEERS=codex`), and the same applies when a peer fails a debate round (tally that round without it). If both peers drop out, finish as the trivial tier. Name every dropped peer and why in the Reviewers line. Then:
   1. Run `debate.sh items <context-dir>`. It numbers every finding into `debate/items.json`: `C*` yours, `X*` Codex's, `U*` Cursor's.
   2. For round `n` (1 to 3): start `debate.sh round <context-dir> <n> codex` and `debate.sh round <context-dir> <n> cursor`, each with `run_in_background`. While they run, write your own positions to `debate/round-<n>.claude.json` in [`debate.schema.json`](debate.schema.json) shape, without opening either peer's `round-<n>` file. Round 1 covers every item; later rounds cover only the `contested` items of the previous tally.
      - From round 2, read both peers' latest reason and evidence on each contested item and answer their argument in your `reason`: what convinced you, or exactly why it fails against the code. The goal is to convince, not to vote.
      - On the peers' items: `agree`, `revise` (real, different severity or fix), or `disagree`, after checking the code yourself. On your own: `agree` to maintain, `revise`, or `withdraw` when an argument or your re-check shows it wrong. Never concede to end the debate, and never hold a position the code contradicts.
      - Two items with the same root cause take the same stance; name the other id in `reason`.
   3. When both peer rounds finish, run `debate.sh tally <context-dir> <n>`. Items are `agreed` (all three agree or revise), `dropped` (none do), or `contested`. Stop when nothing is contested or after round 3.
   - Done when the final tally exists. Write every item that ended `contested` to `<context-dir>/not-agreed.md` with all three sides' last stance, reason and evidence.
9. **Pattern sweep.** For each agreed finding that comes from a code shape the series repeats, check the open siblings from step 3 for the same shape and list the affected PR numbers.
10. **Report** in the format below. First re-fetch the PR head (`gather.sh` again): authors push fixes mid-review, so mark findings a newer commit already fixes as fixed and say what changed since the last pass. Findings sections come from `agreed` items in the final tally only; `contested` items go under Needs Your Call. Merge items that share a root cause (reasons that name another id as the same root cause). For each agreed item, compare its `revisedFixes` in the tally with the original fix: when they conflict in substance (not just a refinement), report it as "agreed, fix disputed" with who wants which fix. Posting comments to the PR is outward facing: ask first.

Model choices for the peer seats come from the benchmark in `~/.claude/skills/model-bench/results.md`; rerun `/model-bench` when a new model ships.

## Report

```
Verdict: Ready | Ready after fixes | Not ready, <one sentence why> | Needs your call, <one sentence on the split>
Reviewers: <tier> tier, Claude + Codex <model> + Cursor <model> (only the ones that took part; "<peer> dropped out: <reason>" for any that failed), <r> debate rounds, <n> agreed, <d> dropped, <m> contested (see <context-dir>/not-agreed.md)

## Needs Your Call   no consensus after the debate
1. <id> <what> (`path:line`). Holds: <who, why>. Rejects: <who, why>. Settle by: <command or check>

## Want me to validate?   read only proposals, nothing runs until you say yes
1. <finding> on dev-uk: <what I would run>, proves <what>, creates <throwaway artifacts>, cleanup <how>

## Breaking
1. <what> (`path:line`). <concrete failure>. Fix: <fix>. Source: <url, source file, or command output>

## Regression
## Worth Knowing        non-blocking: behaviour changes, rollback hazards
## Dead Code            <code> (`path:line`), unreached because <search result>. Remove: <what>
## Refactor             <code> (`path:line`), <existing helper or repo pattern>. Change: <sketch>
## Bigger Picture       only siblings sharing an agreed finding
```

Every item is something the user must change or check. The verdict follows from agreed findings, except that a contested item any reviewer rates breaking or regression makes it `Needs your call` unless agreed findings already make it `Not ready`. When severities differ, report the one the evidence supports and show both labels. Drop empty sections. Lead with the verdict.
