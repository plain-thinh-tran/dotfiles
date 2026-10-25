# Model Bench Results

Newest first. n is runs per cell; one run is noisy, treat single differences as ties.

## 2026-10-24

CLIs: cursor-agent 2026.10.22-27dcf5f, Claude Code CLI. Seat: Mission Control critical check of Cursor Error Tracking PRs (`src/cursorCheck.ts` in Raumschiff). Same prompt for every seat (`checkPrompt`), each run in an isolated worktree at the PR head with `.mc-check/pr.md` and `.mc-check/diff.patch`, read only (Cursor `--mode ask` cannot run shell, so inputs are files). Bench: `bench/checkSeats.ts` in Raumschiff. PRs one at a time, the 8 seats in parallel. Cases: services #11797 (log level downgrade), #12030 (incident.io paging cap), #11556 (WorkOS 404 as deleted). n=1 per cell.

Grading: a Sonnet verifier per PR listed every distinct claim across the 8 seats and checked it against the code with file:line evidence (TRUE, PARTLY, FALSE), weighted by impact (blocker 4, major 3, minor 2, nit 1, correct root cause call 0.5), and set a reference verdict from evidence only. All three references came out merge (small correct fixes, remaining issues minor or out of scope). Score = 0.7 x (weighted recall of verified claims - 0.1 per false claim) + 0.3 x verdict (exact 1, merge vs fix-first 0.5).

### Critical Check Seat

| Harness | Model | Score | Weighted recall | Verdict | False claims | Time 11797 / 12030 / 11556 |
|---|---|---|---|---|---|---|
| Cursor | claude-opus-5-5-high | 54 | 59% | 0.50 (fix-first on all three) | 1 | 150s / 114s / 106s |
| Claude CLI | opus | 54 | 41% | 0.83 | 0 | 102s / 77s / 77s |
| Cursor | claude-sonnet-5-5-high | 54 | 52% | 0.67 | 1 | 81s / 70s / 74s |
| Cursor | composer-2.5 | 50 | 36% | 0.83 | 0 | 78s / 59s / 70s |
| Cursor | grok-4.7-high | 47 | 41% | 0.67 | 1 | 392s / 330s / 339s |
| Cursor | cursor-grok-4.6-medium | 45 | 36% | 0.67 | 0 | 126s / 134s / 87s |
| Cursor | gpt-5.6-sol-high | 44 | 34% | 0.67 | 0 | 102s / 109s / 94s |
| Cursor | gemini-4-argon-high | 36 | 16% | 0.83 | 0 | 760s / 113s / 211s |

### Findings

1. Opus 5.5 through Cursor found the most verified issues (59% weighted recall) and is the most critical: fix-first on all three PRs the verifier would merge. That bias is what this seat is for; read its problems, not only its verdict.
2. The same Opus through the Claude CLI flipped its verdict on #11797 between two runs (fix-first on the first live run, merge here), so verdicts are noisy at n=1; recall is the steadier signal.
3. Sonnet 5.5 through Cursor is the fast runner up (52% recall, 75s average) if Opus through Cursor becomes slow or rate limited.
4. Gemini 4 Argon, on the Watch list for its leaderboard score, is the weakest here: shallow (2 claims on #12030, 0 problems on #11556) and slow (760s on #11797). Grok 4.7 high is 3x slower than the Claude seats without more recall.
5. Composer 2.5 is the fastest (69s) and never wrong, but misses about two thirds of what Opus finds.

### Defaults Changed

- New seat, default `cursor:claude-opus-5-5-high` (`DEFAULT_SEAT` in `src/cursorCheck.ts` in Raumschiff, `MC_CHECK_SEAT` overrides). Was Claude CLI Opus before this bench; moved to Cursor for budget at equal score and higher recall.

### Open

- n=1 per cell and one verifier per PR; rerun with more Error Tracking PRs before moving the seat again. A PR the verifier rejects would test whether the merge-leaning seats (Gemini, Composer) miss real blockers.

## 2026-10-08

CLIs: codex-cli 0.161.0, cursor-agent 2026.10.01-e373342. Review prompt: `prompts/review.md` + prod-ready-check `lenses.md`, effort high unless the id says otherwise. Cursor runs went 10 at a time, so their times include queueing.

### Review Seat

A1 is the real prod bug; B is planted bugs B1 to B4 ("merged" means two bugs reported as one finding).

| Harness | Model | A1 | B | Time A / B | Notes |
|---|---|---|---|---|---|
| Claude Agent | opus | caught (n=2) | 4/4 | 341s / 229s | caught A1 with both prompt variants |
| Claude Agent | sonnet | caught (n=2) | 3/4 (missed B2) | 262s / 58s | caught A1 with both prompt variants |
| Claude Agent | fable | missed | 4/4 | 286s / 259s | |
| Claude Agent | haiku | missed (0 findings) | 2/4 | 100s / 130s | not a reviewer |
| Codex CLI | gpt-5.6-sol | missed | 3/4 (missed B4) | 278s / 266s | |
| Codex CLI | gpt-6-sol | missed | 4/4 | 233s / 214s | read the SLA builder, trusted its comment and the PR claim, called the all null filter "a no-op through parsing and SQL generation", never opened `buildFilters` |
| Codex CLI | gpt-6.1-sol | missed | 3/4 (B1 only as dead code) | 241s / 368s | |
| Codex CLI | gpt-6-astra | missed | 4/4 (B1 labelled refactor) | 185s / 261s | |
| Cursor | gpt-5.6-sol-high | caught (n=2) | not run | 667s, 676s / | same model the Codex CLI missed with; caught with both prompts |
| Cursor | grok-4.7-high | caught (n=2) | 4/4 (n=2) | 599s / 596s, rerun 858s / 757s | default before this run |
| Cursor | grok-4.7-xhigh | caught | 4/4 (merged) | 722s / 754s | no gain over high |
| Cursor | grok-4.7-high-fast | caught | 4/4 | 671s / 470s | not faster here |
| Cursor | grok-4.7-medium | caught | 4/4 (merged) | 667s / 361s | |
| Cursor | cursor-grok-4.6-high | caught | 4/4 | 834s / 329s | |
| Cursor | cursor-grok-4.6-medium | caught (n=2) | 4/4, rerun 3/4 (merged) | 486s / 282s, rerun 592s / 369s | new default |
| Cursor | composer-2.5 | missed | 4/4 | 270s / 232s | ran `pnpm install` as a build worker against the packet (see Build Seat) |
| Cursor | composer-2.5-fast | missed | 4/4 | 311s / 211s | |
| Cursor | muse-spark-1.3-high | missed | 4/4 (merged) | 108s / 215s | fastest |
| Cursor | glm-5.2-max | missed | 4/4 | 456s / 698s | |
| Cursor | gemini-3.1-pro | missed | 4/4 | 1600s / 554s | |
| Cursor | gemini-3.8-flash-high | missed | 4/4 | 1481s / 1020s | slowest |
| Cursor | kimi-k3-max | failed | failed | | `resource_exhausted` from Cursor both times |

### Build Seat

P1 = fix A1 in two builders (4 return sites) plus a test; P2 = fix B1 to B4 to match the real PR.

| Harness | Model | P1 | P2 | Time P1 / P2 | Notes |
|---|---|---|---|---|---|
| Claude Agent | sonnet | 4/4 sites, hidden test passes | correct | 143s / 33s | 50k / 53k tokens |
| Claude Agent | haiku | 3/4 sites (missed the `||` fallback the packet names) | correct, unformatted line | 182s / 74s | 110k / 92k tokens |
| Codex CLI | gpt-6-luna medium | 4/4, hidden test passes | correct | 57s / 62s | cheapest and fastest |
| Cursor | composer-2.5 | 4/4, hidden test passes | correct | killed at 335s / 152s | ran `pnpm install` through a symlinked node_modules and rewrote the real services checkout's shims; setup now gives each worker its own install |

### Scout Seat

Case B call site mapping (17 + 16 sites, email/companyId per site).

| Model | Accuracy | Time | Tokens | Tool calls |
|---|---|---|---|---|
| haiku | 17/17, 16/16, all attributes match sonnet | 148s | 116k | 47 |
| sonnet | 17/17, 16/16 | 48s | 63k | 13 |

### Findings

1. The Codex CLI harness is the weak reviewer seat, not the GPT models. Four Codex models missed A1 through `codex exec`; GPT-5.6 Sol caught it twice through Cursor. Codex trusted a code comment and the PR description and stopped one hop before the SQL joiner. Not yet tested: Codex with a prompt that says to follow data to the final SQL or output (Codex credits ran out).
2. A1 was caught only by Claude Opus and Sonnet, every Grok tested, and GPT-5.6 Sol under Cursor. Composer, Muse, GLM, Fable, Haiku and the Codex CLI all missed it. Planted bugs (B) were easy for almost everyone, so B separates little; A1 style bugs (cross file, misleading comment) are the real test.
3. Grok 4.6 medium matches Grok 4.7 high on A1 (2/2 each) and averaged about 40% faster over two head to head rounds (A 539s vs 729s, B 326s vs 677s). It merged B4 into B2 once; 4.7 high reported B4 separately both times. The Cursor seat is the slowest seat and sets how long prod-ready-check and the council take, so speed wins.
4. Haiku scouts are as accurate as Sonnet for mechanical lookups but 3x slower. Haiku is a poor reviewer and skipped a spelled out packet item as a builder.
5. GPT-6 Luna is a strong cheap builder for fully specced packets. Avengers workers run through the Agent tool, so using it means routing packets through `codex exec`; not adopted.

### Defaults Changed

- Codex seat: `gpt-5.6-sol` → `gpt-6-sol` in prod-ready-check (avengers already used it). Best Codex score on B; no Codex model caught A1, so newer Codex ids did not earn a switch.
- Cursor seat: `grok-4.7-high` → `cursor-grok-4.6-medium` in prod-ready-check and avengers.
- Avengers scouts: Sonnet → Haiku.
- Unchanged: Opus chair and fresh Opus seats, Sonnet build workers.

### Open

- Rerun the Codex CLI on case A with a prompt line that says not to trust code comments or the PR description and to follow every changed input to the final SQL or output it produces. If Codex then catches A1, add the line to prod-ready-check's `review.sh` and avengers' `council.sh`.
- Rerun Codex `gpt-6.1-sol` and `gpt-6-astra` at `xhigh`.

### Watch

- Gemini 4 Argon: Intelligence 53 on Artificial Analysis at $1.99, ahead of GPT-6.1 Sol and Grok 4.7; not offered by Codex or Cursor yet.
- Claude Fable 5.1 shows as `NO ZDR` in Cursor; never use it in a Cursor seat.
