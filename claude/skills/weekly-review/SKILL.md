---
name: weekly-review
description: Write Thinh's weekly PR review newsletter for the 7 days ending today (or a given YYYY-MM-DD), push it to the self-learning repo and open it in the browser. Use when Thinh says "weekly review", "/weekly-review", "review my week" or asks for this week's newsletter.
argument-hint: "[YYYY-MM-DD] [redo]"
allowed-tools: Bash, Read, Write, Grep, Glob
---

# Weekly Review

The newsletter lives in `/Users/thinhtran/workspace/self-learning/weekly-reviews`. A collector pulls the week's data, you write one review JSON, and a codegen validates it and renders the site. Everything below runs from that repo, no matter where this skill is invoked.

```bash
REPO=/Users/thinhtran/workspace/self-learning
```

## Inputs

- End date: the `YYYY-MM-DD` argument if given, else today in UTC (`date -u +%F`). The window is the 7 days ending on it
- `redo`: only if given, an existing review for that week may be replaced

## Steps

1. **Sync.** `git -C "$REPO" checkout main`. If the only change in the tree is `weekly-reviews/guidelines/decisions.json` (his Agree and Ignore clicks), commit it as `Record review decisions` first. Then `git -C "$REPO" pull --rebase`. Stop and report if anything else is dirty or the pull fails
2. **Check for an existing issue.** If `$REPO/weekly-reviews/json/<end>.json` exists and `redo` was not given, tell Thinh it exists, run `$REPO/weekly-reviews/review.sh <end>` to open it, and stop. With `redo`, delete that JSON and pass `--refresh` in step 3
3. **Collect.** `$REPO/weekly-reviews/review.sh <end> [--refresh]`. It collects `data/<end>.json` (a few minutes) and exits 2 because the review does not exist yet. Any other failure: stop and report the output
4. **Write the review.** You are the advisor; cheaper models do the busy work (see Delegation). Read and obey `$REPO/weekly-reviews/PROMPT.md` in full, then `$REPO/weekly-reviews/guidelines/README.md`. Start the workers, then read the guideline file for each section right before you finalise it, ticking its checklist against the merged draft. Grade last week's actions yourself, applying his decisions from `guidelines/decisions.json` as `guidelines/decisions.md` says. Write only `$REPO/weekly-reviews/json/<end>.json`
5. **Build and open.** `$REPO/weekly-reviews/review.sh <end>`. Fix the JSON and rerun until it prints `✓ generated`. It starts the local server if needed and opens `http://localhost:4173/<end>.html`, where the Agree and Ignore buttons work
6. **Push.** Commit only the two files for this week and push to main:

   ```bash
   cd "$REPO"
   git add weekly-reviews/data/<end>.json weekly-reviews/json/<end>.json weekly-reviews/guidelines/decisions.json
   git commit -m "Weekly review: issue <n> (<start> to <end>)"
   git push origin main
   ```

   The repo has no `package.json` or OpenTofu, so the pnpm and tofu pre-push checks do not apply. `site/` is gitignored and must never be committed. If the push is rejected, `git pull --rebase` and push again; never force push

## Delegation

Opus 5.5 (you) is the advisor: decide what needs verifying, judge every worker output against the guideline checklists, and own the final JSON. Workers fetch and draft; they never write `json/<end>.json`. Start them in one message so they run in parallel, and put their output under `$REPO/weekly-reviews/.work/<end>/` (gitignored).

| Worker | How | Job |
|---|---|---|
| Grok 4.6 | `$REPO/weekly-reviews/grok.sh <end>` (Bash, background) | Blind first draft of `verdict`, `shoutouts`, `improved`, `lacked` into `.work/<end>/draft.grok.json`. Read only, no GitHub, so every claim it makes is a lead |
| Sonnet | Agent, `model: "sonnet"` | Classify every `reviewing.comments` entry as `impactful` or `discussion` by the evidence rule in `guidelines/reviewing.md` (it runs the `gh api` thread and commit checks), and draft `workedOn` from `authored`. Returns JSON fragments with the evidence per entry |
| Haiku | Agent, `model: "haiku"`, one per claim | Evidence pulls you name exactly: `gh pr diff`, review threads, commits after a comment, Linear state, a Datadog query. Returns raw facts and links, no judgement |

Then, as advisor:

- Send a Haiku pull for every causal claim in Grok's `lacked` and for every Shoutout you keep. A claim becomes `verified` only on evidence you read in a worker's return; drop or rewrite what does not hold
- Spot check at least two of Sonnet's `impactful` calls against their threads before accepting the classification
- Follow Through, Next Week's Checklist and Corrections are yours alone. Do not delegate grading
- If `grok.sh` fails or `cursor-agent` is missing, draft those four sections yourself and say so in the report

## Rules

- Never edit `codegen/`, `collect/`, `guidelines/` (including `decisions.json`, which only his clicks write), `PROMPT.md` or a previous week's JSON. Wrong claims from last week go in `corrections`
- The repo is private and holds internal Plain data. Never publish `site/` anywhere (no GitHub Pages, no gists, no uploads)

## Report

End with: the issue number and week, the verdict headline, the follow through grades for last week's actions, the top 3 of each Team Ranking board with his rank, which workers ran (and any that failed), the commit hash pushed, and the path of the opened page.
