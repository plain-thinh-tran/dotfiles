# Model Bench Results

Newest first. n is runs per cell; one run is noisy, treat single differences as ties.

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
