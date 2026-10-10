# Mission Control

Local web app for deciding what multi agent skill runs (`/avengers`, `/prod-ready-check`) need from Thinh, and sending the decisions back to the Conductor session that asked. Conductor stays the place where work happens; this app is where decisions happen.

## Stack

- Bun 1.4 (`/opt/homebrew/bin/bun`), `Bun.serve` with HTML imports (`import index from '../web/index.html'`), React 19 + react-dom, TypeScript, plain CSS. No other runtime deps.
- Port 4747 on 127.0.0.1. Live updates over SSE.
- Shared types in `src/types.ts`; do not change their shape without updating this spec.

## Data

- `MC_HOME` env, default `~/.mission-control`. Run files at `$MC_HOME/runs/<runId>.json`, shape `Run` from `src/types.ts`.
- All writes are atomic: write `<file>.tmp-<pid>` then `rename`.
- Every read-modify-write of a run file (server and CLI) runs inside `withRunLock(runId, fn)` in `src/store.ts`: create `<run>.lock` with `openSync(path, 'wx')`, retry every 25ms for up to 5s, break a lock whose mtime is older than 10s, always remove it in `finally`.
- Agents never write run files directly; they go through the `mc` CLI. The app writes only answer, state, submission fields.
- Prune on server start: delete runs with `status: 'done'` and `updatedAt` older than 14 days.
- Never write to Conductor's DB.

## Threads

- One thread per `session.conductorSessionId`, built from all runs with that session. A thread is hidden when all its runs are `done` (unless the "Show done" toggle is on).
- `agents`: union of all runs' agents deduped by `id`, orchestrator first.
- Within a run, todos are ordered `needs-you` first, then `key-decision`, keeping the original order otherwise.
- Sort: `waiting_on_you` first, then `working`, then by `updatedAt` desc.

### Live state

Computed every 3 seconds and broadcast when changed.

1. Conductor DB, read only: `~/Library/Application Support/com.conductor.app/conductor.db`, open with `new Database(path, { readonly: true })` from `bun:sqlite`. Query `select id, status from sessions where id in (...)`. Values seen: `working`, `waiting`, `idle`, `error`. If the DB cannot be opened, skip it.
2. Processes: `ps -axo pid=,command=`. A session is alive when some process whose command contains `/claude` (the claude CLI or `claude-rc`) has cwd equal to `session.workspacePath`. Get cwds with one call: `lsof -a -d cwd -p <pid,pid,...> -Fpn`.
3. A wait is pending when a process command contains `mc wait <runId>` (or `mc.ts wait <runId>`) for a run in the thread.

State, first match wins:
- `error`: DB status `error`
- `working`: DB status `working`
- `waiting_on_you`: a wait is pending, or DB status `waiting`
- `idle`: alive
- `dead`: otherwise

## CLI: `bin/mc` (`#!/usr/bin/env bun`, symlinked to `~/.claude/bin/mc`)

- `mc serve`: start the server.
- `mc push <file|->`: create or update a run from agent JSON. Input has `runId`, `skill`, `title`, `agents`, `todos` (todo fields: `id`, `kind`, `category`, `title`, `question`, `recommendation`, `options`, `positions`, `tradeoffs`, `caveats`, `evidence`, `links`; missing arrays default to `[]`, missing `recommendation` to `null`). Optional `session`; when absent fill from env: `conductorSessionId` = `CONDUCTOR_SESSION_ID`, `workspacePath` = `CONDUCTOR_WORKSPACE_PATH` (fallback cwd), `workspaceName` = basename of path, `repo` = basename of parent dir, `branch` = `git -C <path> branch --show-current`, `pr` = null. Merge rule for an existing run: agent fields overwrite; for todos with an existing id keep `state`, `answer`, `submittedAt`, `pickedUpAt`, `resolution`; new todos start `open`; todos missing from input are kept. Sets `updatedAt`, `status: 'active'`. Prints the run file path.
  - Pre-answered key decisions: a new todo with `category: 'key-decision'` and a `recommendation.optionId` starts as `answered` with `answer { optionId: recommendation.optionId, text: '', deferred: false, answeredAt: now, preset: true }`. The UI shows a violet "Council pick" tag, the user can change the answer (saving clears `preset`), and it counts toward Submit like any answer. `mc wait` and prompt lines append ` (council pick)` after the chosen label for preset answers.
  - Autostart: after writing, if `GET http://127.0.0.1:${PORT||4747}/api/threads` does not answer within 500ms, spawn `bun <repo>/src/server.ts` detached (stdio appended to `$MC_HOME/server.log`, `.unref()`), passing `MC_HOME` and `PORT` through, so the server survives the agent being killed.
  - Notifications: when the push added todo ids that did not exist before and start `open`, run `osascript -e 'display notification "<n> new todos: <run title>" with title "Mission Control" subtitle "<workspaceName>"'` and, if `~/.claude/skills/ping/scripts/slack-notify.sh` exists and `ROCKY_OAUTH_TOKEN` is set, `slack-notify.sh "Mission Control: <n> new todos in <workspaceName> (<run title>) http://localhost:<port>"`. Both are fire and forget and never fail the push. Both are skipped when `MC_NO_NOTIFY=1`.
- `mc wait <runId> [--timeout <minutes>, default 240]`: blocks until the run has todos with `state: 'submitted'`. Watch the file (`fs.watch` plus a 1s poll fallback). If such todos already exist, return immediately. On release: set those todos to `picked_up` with `pickedUpAt`, write, then print to stdout and exit 0:
  ```
  MISSION CONTROL DECISIONS <runId>
  - D1 <title>: <chosen option label | "deferred" | "answered">. Note: <text or "none">
  ...
  Still open: D3, D4   (or "Still open: none")
  Next: act on the decisions, run `mc resolve <runId> <todoId> "<what you did>"` for each, then `mc wait <runId>` again if anything is still open.
  ```
  On timeout print `TIMEOUT <runId>` and exit 2.
- `mc resolve <runId> <todoId> [text]`: state `done`, `resolution` = text.
- `mc done <runId>`: run `status: 'done'`.
- `mc prompt <sessionId>`: print the copy prompt for a thread (same text as the UI button).

## HTTP API

- `GET /` the app.
- `GET /api/threads?done=0|1` → `Thread[]`.
- `GET /api/events` SSE; event `threads` with the full `Thread[]` JSON on every change (run dir change via `fs.watch`, or live state change). Send a comment ping every 15s.
- `POST /api/runs/:runId/todos/:todoId/answer` body `{ optionId: string|null, text: string, deferred: boolean }` → state `answered`, sets `answer` with `answeredAt`. Rejected (409) when state is `submitted`, `picked_up` or `done`.
- `POST /api/runs/:runId/todos/:todoId/dismiss` → `dismissed`. `POST .../reopen` → `open`, `answer: null` (only from `answered` or `dismissed`).
- `POST /api/focus-conductor` → runs `open -a Conductor`, returns `{ ok }`.
- `POST /api/threads/:sessionId/submit` → for every run in the thread, todos in `answered` become `submitted` with `submittedAt`; append a submission `{ id, at, todoIds }` to each touched run. Returns `{ submitted: number }`.
- `GET /api/threads/:sessionId/prompt` → `{ text }`. Text: for each run with answered or submitted todos, a header `Mission Control decisions for <title> (run <runId>)`, the same bullet lines as `mc wait`, and `Still open: ...`.

## UI

Three panes, full height, Linear-like neutral light theme, system font, 13px base.

### Left: threads (280px)

- Header "Mission Control" and a "Show done" toggle.
- Row: live dot, workspace name (bold) with `repo · branch` muted under it, run titles (one line each, truncated), avatar stack of all agents at 24px (orchestrator first, overlapping 6px), open count badge, and a blue "N ready" pill when N todos are answered but not submitted.
- Live dot: `working` green pulsing, `waiting_on_you` amber, `idle` grey, `dead` hollow grey ring, `error` red. Tooltip with the state name.
- Empty state: "No sessions need you."

### Right: todos of the selected thread (360px)

- Header: workspace name and live state, the workspace path (monospace, truncated from the left) with a "Copy path" button and a "Focus Conductor" button (POST `/api/focus-conductor`).
- Grouped by run: run title, skill chip, agent avatars of that run.
- Todo row: state icon (open hollow circle, answered filled blue dot, submitted clock, picked_up arrow, done green check, dismissed muted strike), kind chip (Decision / Question / Approval), category tag ("Needs you" amber, "Key decision" violet), violet "Council pick" tag when the answer is a preset, title, todo id muted. When the todo is `answered`, a muted second line `→ <chosen option label | Deferred | note excerpt>`, truncated to one line.
- After accept, save, defer or dismiss succeeds, the next todo in the current filter whose state is `open` is selected (wrapping around); if none, the selection stays.
- Filter tabs: Open (open + answered), Sent (submitted + picked_up), Done (done + dismissed), All. Default Open.
- Footer, sticky: primary button "Submit N to <workspaceName>", disabled when N = 0 answered todos. When the thread is `dead`, the primary becomes "Copy prompt" (copies `/api/threads/:id/prompt` text) and Submit stays as secondary. Always show a small "Copy prompt" link.

### Middle: todo detail

Order:
1. Title, id, kind chip, category tag, run title and skill.
2. Question (pre-wrapped text). When the first paragraph (up to the first blank line) matches `/^[\w-]+ at \S+/` it renders as a muted monospace location line and the rest as normal text.
3. Recommendation card, visually prominent: orchestrator avatar (crowned), "Recommended by <name>", summary (clamped to 4 lines with a "Show more" / "Show less" link when it overflows), and the recommended option label. Button "Accept recommendation" (answers with its `optionId` and empty text).
4. Options as selectable cards (radio). Each card shows label, description, and mini avatars of the agents whose position has that `optionId`.
5. Positions: one card per agent, side by side (wrap), each with avatar, name, model, pill, summary, reason (clamped to 3 lines with the same link), evidence refs. The pill reads "Option <n>" (1-based index of its `optionId`, matching the kbd numbers; the stance is the tooltip), green when it matches the recommendation and grey otherwise; a position without a matching option shows its stance text in grey. When there are at least two positions and all share one `optionId`, the section collapses to one line "All <n> picked option <k>" with the avatar stack and a "Show reasoning" toggle that expands the cards.
6. Tradeoffs and caveats as two lists (omit empty).
7. Evidence list: `ref` monospace plus note. Click copies the ref.
8. Answer box, a sticky footer of the middle pane that stays visible while the detail scrolls: note textarea, "Accept recommendation" on the left when a recommendation exists and the todo is editable (duplicate of the card button), buttons Save answer, Defer, Dismiss. A "Council pick" tag also shows in the detail header. Approval todos show Approve / Reject as the options when `options` is empty. After submit the box is read only and shows the answer and `submittedAt` / `pickedUpAt` / `resolution`.

### Keyboard

`j` / `k` next / previous todo, `1`-`9` pick option, `a` accept recommendation, `s` save, `d` defer, `Cmd+Enter` submit thread, `[` / `]` previous / next thread. Ignore keys while typing in the textarea except `Cmd+Enter`.

## Avatars

`web/Avatar.tsx`, inline SVG, cute round faces (two dot eyes, small smile, blush), deterministic from the agent. Tooltip: `name · model · role`.

- Orchestrator role, any model: 1.3x size, gold ring, small crown on top, soft glow. Must stand out in every stack.
- Claude Opus: coral `#D97757`.
- Claude Sonnet: blue `#4F7CFF`, small hard hat (worker).
- Claude Haiku: teal `#14B8A6`, leaf sprout on top (scout).
- Codex: green `#10A37F`, rounded square head, antenna.
- Cursor / Grok: violet `#7C3AED`, cat ears.
- Anything else: color from a hash of the id, initials.

## Skill integration (later)

Skills call `mc push` with their needs-you and key decision items, start `mc wait <runId>` as a background Bash task, and on release act, `mc resolve` each todo, and wait again while anything is open. Finish with `mc done`.
