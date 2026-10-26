---
name: check-code-quality
description: Review a PR for code smells and light refactors only (reuse of existing helpers, repetition, dead code, structure, repo conventions), never logic, with Claude, Codex and Grok reviewing blind and then debating, and apply the agreed fixes on request. Use when asked to check code quality, find code smells, or suggest refactors for a PR.
---

# Check Code Quality

Three reviewers, one list of cleanups: you, Codex and Grok review the same PR blind against [`lenses.md`](lenses.md), then debate every finding for up to three rounds. A finding is reported only when all three hold it. Scope is maintainability; whether the PR is correct or safe to ship is prod-ready-check's job.

This skill reuses prod-ready-check's scripts. Below, `PRC=~/.claude/skills/prod-ready-check`, `CCQ=~/.claude/skills/check-code-quality`, and the context dir is `<repo>/.context/check-code-quality/pr-<N>`.

## Steps

1. **Gather.** From a clone of the PR's repo, run `$PRC/gather.sh <pr-number|pr-url> -o <context-dir>`. It writes `summary.md`, `diff.patch` and `meta.json`, and fetches the PR head to the ref `pr-<N>`. Read code only from `pr-<N>` and `origin/<base>`; workspace branches are stale. Done when the summary prints.
2. **Scout.** Send two Haiku scouts in parallel (Agent tool, `model: "haiku"`, `subagent_type: "Explore"`), splitting the changed files between them. Each returns file:line evidence only, read with `git show`:
   - existing helpers, components, hooks and constants the changed code duplicates or could reuse, with every occurrence;
   - shared repo precedents for the same shape (a key factory, a shared menu, a drag wrapper);
   - callers of every export the PR adds;
   - the base version of each changed file.

   Merge the answers into `<context-dir>/scout.md`, one section per changed file. Done when every changed file has an entry, or "none found" with the search used.
3. **Launch peers.** Start `$CCQ/review.sh <context-dir> codex` and `$CCQ/review.sh <context-dir> grok`, each with `run_in_background`. Leave their output unopened until step 5.
4. **Own review.** Verify every scout lead yourself, then apply every lens in `lenses.md` to every changed file. Write `<context-dir>/claude.json` in the shape of `$PRC/findings.schema.json`. Use severity `refactor` or `dead-code` only. Done when the file exists and every lens has a finding or a `checked_fine` line.
5. **Debate.** Run the debate exactly as `$PRC/SKILL.md` step 8 describes, using `$PRC/debate.sh` with `LENSES_FILE=$CCQ/lenses.md` exported on every call. If a peer fails, show its log tail and ask whether to rerun.

   Withdraw your own item when the others show it rests on no named helper, precedent or rule; that is taste. Hold it when the code backs it, and answer their argument with file:line. Done when the final tally exists and every contested item is in `<context-dir>/not-agreed.md` with all three stances.
6. **Report** in the format below, then stop and wait for Thinh. Merge items that share a root cause into one, and say who found each.

## Report

```
Verdict: Clean | <n> cleanups worth doing | Needs your call, <one sentence on the split>
Reviewers: Claude + Codex <model> + Grok <model>, <r> rounds, <n> agreed, <d> dropped, <m> contested (<context-dir>/not-agreed.md)

## Needs Your Call
1. <title> (`path:line`). For: <who, why>. Against: <who, why>.

## Refactor
1. <title> (`path:line`). <what is duplicated or tangled>. Change: <existing helper or precedent, and a sketch>. Found by <who>.

## Dead Code
1. <title> (`path:line`), unreached because <search>. Remove: <what>.

Dropped: <one line per dropped item and why>.
```

Each title is one plain sentence that names the effect ("The role menu rebuilds a shared menu by hand"), not the symbol. Drop empty sections.

## Applying Fixes

Run this only when Thinh names the findings to apply ("do the refactors"). Contested items stay untouched unless he picks them.

1. **Split the work.** Group the chosen findings by the files they touch. Give each group with real edits to its own Sonnet worker (Agent tool, `model: "sonnet"`, `run_in_background`), so groups with disjoint files run in parallel. Do the mechanical few-line edits yourself, such as a trimmed query plus its generated types.
2. **Write the packet.** Each worker gets:
   - the finding and the exact target code;
   - the current state it must verify first;
   - the files in scope, and the files other workers own;
   - the repo rules from `AGENTS.md` (no comments, no `any`, explicit checks over truthy ones, no `void` operator, imports at the top);
   - the checks to run: Biome on its files and Vitest on the touched directories;
   - the stop conditions: the code differs from the packet, a check fails after one retry, or the fix needs an out of scope file. In each case the worker stops and reports.

   Workers leave git alone: no commit, push, stash or branch switch.
3. **Verify.** Treat each worker report as a lead. Read every diff yourself, and remove anything the packet did not ask for, such as an export nothing uses. Rerun Biome and the tests over every touched directory. When codegen cannot run, hand edit the generated lines to match the source change and say so.
4. **Ship.**
   - **Thinh's own PR:** commit, run the pre-push checklist (`~/.claude/bin/typecheck-changed`, `pnpm run format:fix`, and `pnpm run tofu:fmt` where defined), then push to the PR branch.
   - **Someone else's PR:** draft one inline comment per finding instead of pushing, and post only after Thinh approves the text.

   Done when every applied finding is listed with its commit, or with its posted comment.
