---
name: model-bench
description: Benchmark AI models for the seats that /avengers and /prod-ready-check fill (reviewer, scout, build worker), refresh the Codex and Cursor CLIs, spot new models, and update those skills' model defaults from the evidence. Use when a new model ships, when asked which model to use for a seat, whether a cheaper or faster model would do, or to rerun the model benchmark.
---

# Model Bench

A fixed benchmark over real Plain code, so a model choice rests on what a model did on our code, not on a leaderboard alone. Results live in [`results.md`](results.md); read it first, it may already answer the question.

## Seats

| Seat | Used by | Default lives in |
|---|---|---|
| Codex reviewer | prod-ready-check, avengers council | `prod-ready-check/peers.sh`, `avengers/council.sh` (`CODEX_MODEL`) |
| Cursor reviewer | prod-ready-check, avengers council | `prod-ready-check/peers.sh` (`GROK_MODEL`), `avengers/council.sh` (`CURSOR_MODEL`) |
| Claude reviewer | prod-ready-check (main session), avengers fresh Opus seat | `avengers/SKILL.md` |
| Scout | avengers step 1 | `avengers/SKILL.md` |
| Build worker | avengers step 4 | `avengers/SKILL.md` |

Keep three different model families in the reviewer seats. The benchmark exists because one family alone misses bugs another catches (see `results.md`).

## Fixtures

- Case A ([`cases/A.json`](cases/A.json)): services PR #11391 at its own commit. Real prod bug A1: `getThreads` always sends an all null `serviceLevelAgreements` object, `buildBaseFilterSql` renders an empty fragment and the joined SQL has `AND AND` (fixed in #11414). Catching it means following a GraphQL only diff into `packages/aggregates/src/thread/threadDbFilterUtils.ts`. The PR description wrongly claims the all null object is a no-op.
- Case B ([`cases/B.json`](cases/B.json)): services PR #11378 with [`cases/B.plant.patch`](cases/B.plant.patch) applied. Planted bugs:
  - B1 `getTenantsByExternalId` swallows a failed chunk (`warn` + `continue`), so real tenants look absent.
  - B2 `importCustomers` builds the batch map from `recordsWithTenantStubs`, which never have external ids, so the map is always empty.
  - B3 `upsertCustomer` fast path drops `importedByJobDefinitionId`, so a re-import by a new job never restamps the customer (importer `onUpdate` is `{}`, so this hits every re-import).
  - B4 `importCustomer` defaults a missing map to empty, so single customer callers (importThreads, importThreadMessage, importAllCustomersAndUsersInRecords) never link tenants.
- Packets [`packets/P1.md`](packets/P1.md) (fix A1 plus a test, graded by the real fix's hidden test) and [`packets/P2.md`](packets/P2.md) (fix B1 to B4, graded against the real PR code).
- Scout task: on case B, list every non-test call site of `customerAggregate.upsertCustomer(` (16) and `tenantAggregate.getTenantsFromIdentifiers(` (17), with whether each `onUpdate` can set email or companyId (only `slackAggregate.ts:3192` sets companyId and `upsertCustomerMutation.ts:27` sets email). Grade against `git grep`.

## Steps

1. **Refresh.** Run `~/.claude/skills/model-bench/refresh.sh`. It upgrades Codex (`brew upgrade --cask codex`) and Cursor (`cursor-agent update`), prints the Codex models and every id that is new since the last `--save`. A model that fails with an unknown id usually needs a newer CLI; rerun this first.
2. **Shortlist.** Check https://artificialanalysis.ai/models/releases/comparisons (side by side, up to five releases: `/models/releases/comparisons/<a>-vs-<b>`, slugs like `claude-sonnet-5-5`, `gpt-6-1-sol`, `grok-4-7`) and https://artificialanalysis.ai/leaderboards/models for intelligence, price and speed. Shortlist models that can run in a seat (listed by `refresh.sh` or offered by the Agent tool) and either beat the current default on the leaderboard or cost or run clearly less. A model no CLI offers goes under Watch in `results.md`.
3. **Setup.** `setup.sh <workdir>` with a workdir under the current repo's `.context/` (for example `.context/model-bench/<date>`). Needs a services clone at `$SERVICES_DIR` (default `~/workspace/services`); it only reads from it.
4. **Review seats.** For each shortlisted model and each case: `review.sh <workdir> <A|B> <codex|cursor> <model> [effort]` with `run_in_background`, in parallel. For Claude models, `review.sh <workdir> <case> claude <haiku|sonnet|opus|fable>` prints a prompt file; launch it with the Agent tool (`subagent_type: general-purpose`, that `model`, in the background) and record tokens, tool uses and duration from the completion notice. Always rerun the current default for each seat beside the candidates so the comparison is same day.
5. **Build seats.** `build.sh <workdir> <P1|P2> <codex|cursor|claude> <model>`; Claude models again print a packet file for the Agent tool. Each worker gets its own copy with its own offline install.
6. **Grade.** `grade.sh <workdir> review <A|B>` lists each run's findings; mark A1 and B1 to B4 caught or missed by reading titles and, when unsure, the finding body. A finding counts only if it names the failure, not just the code. `grade.sh <workdir> build <P1|P2>` reports files touched, leftover empty fragments, own suite and hidden test (P1) and the residual diff against the real PR (P2); judge whether residual differences are equivalent.
7. **Record.** Add a dated section to `results.md` with the tables and findings, keeping older sections, and copy each run's `.json` and `.time.json` into `runs/<date>/<case>/`. Note n per cell; one run per cell is noisy.
8. **Update defaults** only when a candidate beats the default on both cases or matches it clearly cheaper or faster. Change every place the seat table lists, in the same commit as the `results.md` update, and say what moved and why.

## Rules

- Reviewers get the same prompt (`prompts/review.md` plus prod-ready-check's `lenses.md`). Changing the prompt between models voids the comparison; changing it for everyone is a new benchmark run.
- Runs are read only against isolated copies, never the real services checkout. Build workers must not install dependencies.
- Codex and Cursor bill per run. A full sweep is about 2 runs per model; Codex quota can run out mid sweep (`Your workspace is out of credits`), which also breaks the real skills until refilled. Shortlist before running.
- `NO ZDR` in a Cursor model name means no zero data retention. Never put such a model in a seat that sees customer code.
