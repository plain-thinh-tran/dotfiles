---
name: update-product-priorities
description: >-
  Update weekly team priority snapshots in the product-priorities repo
  (data/{team}/YYYY-MM-DD.json), cross-check against Linear, fix due-date
  formatting, and ship the change as a PR. Use when asked to update, add,
  ship, or reprioritize items on a team's priorities board.
---

# Update Product Priorities

## Repo model (read this first)

- One JSON file per team per week: `data/{team}/YYYY-MM-DD.json`.
- `items[]` order = priority order (index 0 = top).
- Status: `planned` | `in_progress` | `shipped` | `canceled`.
- The board always compares **two adjacent snapshot dates** for a team (left = earlier, right = later).
- `src/lib/loadSnapshots.ts` glob-imports all JSON at build time — no runtime fetch, must rebuild to see changes.

## Visibility rules (don't relearn these by trial and error)

| Situation | Left (earlier) | Right (later) | Connector |
|---|---|---|---|
| Carry-over | shown | shown | yes |
| Shipped this week | shown | hidden | no |
| Canceled | shown | hidden | no |
| New item | hidden | shown | no |

Shipped/canceled items are hidden from the **right** column of whichever file they're marked in — they don't disappear from the array, they just stop rendering on the "current" side.

## dueDate: format and gotcha

- Free text, shown top-right on the card. Convention observed across teams: `Fri 17th July` (weekday + ordinal day + full month). Use `TBC` when there's no date yet. Prefix shipped items with `shipped `, e.g. `shipped Tue 14th July`.
- **Red highlight is a raw string comparison** between the same `id` across the two compared weeks (see `compareSnapshots.ts`). If you reformat a date string without changing the actual calendar day (e.g. `"17 Jul"` → `"Fri 17th July"`) in only ONE of the two files being compared, you get a **false red flag**. When reformatting a date, update it in every file where that same date currently appears, not just the latest one.

## Workflow

1. Read the team's most recent snapshot file to see current state.
2. Cross-check against Linear (`list_projects` filtered by team) to catch anything in progress/planned that's missing from the board, and to source accurate target dates. Don't blindly dump the whole backlog — only projects with real momentum (a lead, active status) tend to be tracked here.
3. Decide: are you updating the *existing* latest file, or adding a *new* dated snapshot (next week)?
   - Only add a new date if it's genuinely "this week" moving forward. Adding a snapshot with a new date for one team only breaks the week navigator for other teams still on the older date (empty column) — flag this to the user, don't silently do it for all teams unless asked.
   - When ripping forward into a new snapshot, shipped items stay in the array with the same shipped status/date (don't re-hide or delete them).
4. When marking something shipped: set `status: shipped` in that week's file, keep it in its original array position (don't move to bottom — that's not the actual repo convention, despite what the README implies).
5. Build and start the preview (`npm install`, `npm run build`, then vite in the background; blocks until the port answers):

   ```bash
   ~/.claude/skills/update-product-priorities/scripts/preview.sh start
   ```

6. Screenshot the board with the chrome-devtools MCP: `new_page` → `navigate_page` to `http://localhost:5173/` → select the affected team and week → `take_screenshot` saved to `/tmp/priorities.png`. If the tool returns base64 instead of writing a file, decode it to that path.
7. Stop the preview: `~/.claude/skills/update-product-priorities/scripts/preview.sh stop`.
8. Create the Linear ticket (team Platform, assigned to me) if one doesn't exist yet, then ship:

   ```bash
   ~/.claude/skills/update-product-priorities/scripts/ship-pr.sh \
     -l PE-123 \
     -t "Chore: update <team> priorities <YYYY-MM-DD>" \
     -s /tmp/priorities.png
   ```

   `ship-pr.sh` calls the create-pr skill's `create-pr.sh` (branch rename, commit, pre-push checks, rebase, push, draft PR), then publishes the screenshot and appends it to the PR body. Omit `-s` to skip the screenshot. It prints the PR URL.
9. Leave unrelated pre-existing dirty files (e.g. a stray `package-lock.json` diff) out of your commit.

## Scripts

Both live in `scripts/` next to this file.

| Script | Does |
|---|---|
| `preview.sh start\|stop` | `npm install` + `npm run build`, runs vite on :5173 in the background, waits for readiness; `stop` kills it. PID in `/tmp/product-priorities-dev.pid`, logs in `/tmp/product-priorities-dev.log`. |
| `ship-pr.sh -l ID -t TITLE [-s SHOT] [-b BASE]` | Wraps `create-pr.sh`, then hosts the screenshot and embeds it in the PR body. |

Screenshot hosting: GitHub has no API for attaching an image to a PR body, so `ship-pr.sh` pushes the PNG to a side branch (`pr-assets`, created from the base on first use, never merged) and references its raw URL. The PR diff stays clean. Re-running replaces the screenshot section instead of stacking duplicates.

## Design note: shipped items on the left column

Default app behavior shows an item's *own* status from the earlier file on the left (so if it was `in_progress` last week and ships this week, left just shows `in_progress`). If asked to surface "shipped" on the left column too, the fix is in `src/lib/compareSnapshots.ts`: when building `leftItems`, check if the matched item in the `to` snapshot has `status === 'shipped'`, and if so render the left card with that shipped status/dueDate instead of the item's own. This is a deliberate deviation from the out-of-the-box repo behavior — mention it if handing off, since the README says not to touch `compareSnapshots.ts` without a real reason.

## Reference

- Example PR: https://github.com/team-plain/services/pull/9216

## Verification

Use the chrome-devtools MCP (step 6 above) for visual verification. If the MCP server is unavailable in the current workspace, fall back to reasoning about `compareSnapshots.ts`/`status.ts` logic directly against the JSON, and ask the user for a screenshot instead of skipping verification.
