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
- Archived thread ids live in `$MC_HOME/archived.json` (an array of sessionIds, written atomically under a lock). Prune on server start deletes only the run files of archived threads whose runs were all last updated more than 14 days ago (and drops those ids from `archived.json`). Nothing else is ever deleted automatically.
- Never write to Conductor's DB.

## Threads

- One thread per `session.conductorSessionId`, built from all runs with that session. Threads never disappear on their own: a thread stays in the list whatever its runs' status (`mc done` hides nothing). Thinh archives a thread himself (`Thread.archived`); archived threads are hidden unless requested, and then listed below the active ones.
- `agents`: union of all runs' agents deduped by `id`, orchestrator first.
- Within a run, todos are ordered `needs-you` first, then `key-decision`, keeping the original order otherwise.
- Sort: `waiting_on_you` first, then `working`, then by `updatedAt` desc.

### Live state

Computed every 3 seconds and broadcast when changed.

1. Conductor DB, read only: `~/Library/Application Support/com.conductor.app/conductor.db`, open with `new Database(path, { readonly: true })` from `bun:sqlite`. Query `select id, status from sessions where id in (...)`. Values seen: `working`, `waiting`, `idle`, `error`. If the DB cannot be opened, skip it. `MC_CONDUCTOR_DB` overrides the path (used by tests with a copy).
2. Processes: `ps -axo pid=,command=`. A session is alive when some process whose command contains `/claude` (the claude CLI or `claude-rc`) has cwd equal to `session.workspacePath`. Get cwds with one call: `lsof -a -d cwd -p <pid,pid,...> -Fpn`.
3. A wait is pending when a process command contains `mc wait <runId>` (or `mc.ts wait <runId>`) for a run in the thread.

Thread naming comes from the same Conductor DB: `select s.id, s.status, s.title, w.workspace_name, w.user_set_workspace_name, w.pr_title, w.branch from sessions s left join workspaces w on w.local_id = s.workspace_id where s.id in (...)`. `Thread.displayName` is `workspace_name` when `user_set_workspace_name = 1` and it is non empty, else `pr_title` when non empty, else `branch`, else `session.workspaceName`. `Thread.description` is `sessions.title` when non empty, else the newest active run's title. Without the DB both fall back to `session.workspaceName` and the run title.

State, first match wins:
- `error`: DB status `error`
- `working`: DB status `working`
- `waiting_on_you`: a wait is pending, or DB status `waiting`
- `idle`: alive
- `dead`: otherwise

## CLI: `bin/mc` (`#!/usr/bin/env bun`, symlinked to `~/.claude/bin/mc`)

- `mc serve`: start the server in the foreground. `mc open`: start the server if it is not answering (the same detached start as `mc push`, logging to `$MC_HOME/server.log`), wait until it answers, then run `open http://localhost:<port>` (port from `PORT`, default 4747).
- `mc push <file|->`: create or update a run from agent JSON. Input has `runId`, `skill`, `title`, optional `summary` (one sentence on what the thread is about, shown on the Overview; the newest run with a summary wins), `agents`, `todos` (todo fields: `id`, `kind`, `category`, `title`, `question`, `recommendation`, `options`, `positions`, `tradeoffs`, `caveats`, `evidence`, `links`, `diffs`; missing arrays (including `diffs`, a list of `{ path, patch }` unified diff hunks) default to `[]`, missing `recommendation` to `null`). Optional `session`; when absent fill from env: `conductorSessionId` = `CONDUCTOR_SESSION_ID`, `workspacePath` = `CONDUCTOR_WORKSPACE_PATH` (fallback cwd), `workspaceName` = basename of path, `repo` = basename of parent dir, `branch` = `git -C <path> branch --show-current`, `pr` = null. Merge rule for an existing run: agent fields overwrite; for todos with an existing id keep `state`, `answer`, `submittedAt`, `pickedUpAt`, `resolution`; new todos start `open`; todos missing from input are kept. Sets `updatedAt`, `status: 'active'`. Prints the run file path.
  - Pre-answered key decisions: a new todo with `category: 'key-decision'` and a `recommendation.optionId` starts as `answered` with `answer { optionId: recommendation.optionId, text: '', deferred: false, answeredAt: now, preset: true }`. The UI shows the violet council icon, the user can change the answer (saving clears `preset`), and it counts toward Submit like any answer. `mc wait` and prompt lines append ` (council pick)` after the chosen label for preset answers.
  - Autostart: after writing, if `GET http://127.0.0.1:${PORT||4747}/api/threads` does not answer within 500ms, spawn `bun <repo>/src/server.ts` detached (stdio appended to `$MC_HOME/server.log`, `.unref()`), passing `MC_HOME` and `PORT` through, so the server survives the agent being killed.
  - Notifications: when the push added todo ids that did not exist before and start `open`, run `osascript -e 'display notification "<n> new todos: <run title>" with title "Mission Control" subtitle "<workspaceName>"'` and, if `~/.claude/skills/ping/scripts/slack-notify.sh` exists and `ROCKY_OAUTH_TOKEN` is set, `slack-notify.sh "Mission Control: <n> new todos in <workspaceName> (<run title>) http://localhost:<port>"`. Both are fire and forget and never fail the push. Both are skipped when `MC_NO_NOTIFY=1`. The osascript notification is also skipped when the app reported itself focused within the last 30s (`GET /api/presence`, asked with a 500ms timeout; no server or no answer counts as not focused). The Slack ping is unaffected.
- `mc wait <runId> [--timeout <minutes>, default 240]`: blocks until the run has todos with `state: 'submitted'`. Watch the file (`fs.watch` plus a 1s poll fallback). If such todos already exist, return immediately. On release: set those todos to `picked_up` with `pickedUpAt` (a question todo, see below, goes back to `open` instead), write, then print to stdout and exit 0:
  ```
  MISSION CONTROL DECISIONS <runId>
  - D1 <title>: <chosen option label | "answered">. Note: <text or "none">
  - D4 <title>: QUESTION from Thinh: <text>. Reply with mc reply <runId> D4 "<answer>"; the decision stays open.
  ...
  Still open: D3, D4   (or "Still open: none")
  Next: act on the decisions, run `mc resolve <runId> <todoId> "<what you did>"` for each, then `mc wait <runId>` again if anything is still open.
  ```
  On timeout print `TIMEOUT <runId>` and exit 2.
- `mc reply <runId> <todoId> "<text>" [--question "<new question text>"]`: append `{ from: 'agent', text, at }` to the todo's `conversation` (the todo stays open); `--question` also replaces the todo's `question`.
- `mc resolve <runId> <todoId> [text]`: state `done`, `resolution` = text, `doneAt` = now (`Todo.doneAt` is optional; older todos without it are never counted as done today).
- `mc done <runId>`: run `status: 'done'`.
- `mc prompt <sessionId>`: print the copy prompt for a thread (same text as the UI button).
- `mc step "<text>" [--agent <agentId>] [--session <id>]`: record the agent's current step in `$MC_HOME/steps/<sessionId>.json` as `{ current: { text, at, agent } | null, history: [{ text, at, agent }] }` (atomic, under a lock; the last 30 history entries are kept and the new step is appended to them; session from `CONDUCTOR_SESSION_ID` unless `--session` is given; the old `{ text, at }` shape reads as the current step with no agent). `mc step --clear` clears `current` only. `Thread.step` is `current` and `Thread.steps` is the history; the server watches the steps directory like the runs directory. A step without an agent belongs to the thread's orchestrator.
- `mc avatars`: download any missing avatar icons into `$MC_HOME/avatars/` (see Avatars).

## HTTP API

- `GET /` the app.
- `GET /api/threads?archived=0|1` → `Thread[]` (`archived=1` includes archived threads, sorted after the active ones).
- `POST /api/threads/:sessionId/archive` and `/unarchive` → add or remove the session id in `archived.json`, broadcast, return `{ ok }`.
- `GET /api/events?archived=0|1` SSE; event `threads` with the full `Thread[]` JSON on every change (run dir change via `fs.watch`, or live state change). Send a comment ping every 15s.
- `POST /api/runs/:runId/todos/:todoId/answer` body `{ optionId: string|null, text: string, deferred: boolean, question?: boolean }` → state `answered`, sets `answer` with `answeredAt` (and `question: true` for an "Ask the agent" answer). Rejected (409) when state is `submitted`, `picked_up` or `done`.
- `POST /api/runs/:runId/todos/:todoId/dismiss` → `dismissed` (kept for compatibility; nothing in the UI calls it, and stored `dismissed` todos render read only). `POST .../reopen` → `open`, `answer: null` (only from `answered` or `dismissed`).
- `GET /api/presence` → `{ focused }`, true when the client reported focus within the last 30s. `POST /api/presence` body `{ focused: boolean }` records it.
- `GET /avatars/:id.png` → a downloaded avatar icon (see Avatars).
- `POST /api/focus-conductor` → runs `open -a Conductor`, returns `{ ok }` (no UI uses it).
- `POST /api/threads/:sessionId/submit` → for every run in the thread, todos in `answered` become `submitted` with `submittedAt`; append a submission `{ id, at, todoIds }` to each touched run. Returns `{ submitted: number }`. Returns `{ submitted, submissionIds }`.
- `POST /api/threads/:sessionId/unsubmit` body `{ submissionId }` → moves that submission's todos that are still `submitted` back to `answered` (clearing `submittedAt`) and removes the submission; todos already `picked_up` stay. Returns `{ reverted, pickedUp }`.
- `GET /api/threads/:sessionId/prompt` → `{ text }`. Text: for each run with answered or submitted todos, a header `Mission Control decisions for <title> (run <runId>)`, the same bullet lines as `mc wait`, and `Still open: ...`.

## UI

Three panes, full height, dark theme only (no toggle), palette "graphite amber" (all values are CSS variables in `:root` of `web/styles.css`): window `#1c1d21` shared by both sidebars, the middle pane a raised card `#26272c` with a `#35363c` border; rows `#2e2f35` / border `#3c3d44` / hover `#35363d`; input `#202126`. Text `#ececef`, soft `#cfd0d6`, muted `#9a9ba4`, dim `#80818b`. Accents: primary amber `#f0a43a` (hover `#f7b75a`, text on amber `#1a1206`), violet `#a78bfa` for council picks, green `#4cc276`, blue `#6b9bff`, red `#f85149`. Accent tints use the `--<color>-rgb` triplets so a palette change is one block of variables. System sans at 13px; monospace for branch, repo, todo ids, kbd hints, skill chip, evidence refs and timestamps. Scrollbars are hidden everywhere (scrolling still works). The detail content is capped at 1200px and positions sit in three equal columns.

### Left: threads (280px)

- Header "Mission Control".
- Bottom dock, Scape style: a rounded bar (12px radius, 8px inset from the pane edges, 44px high, faint violet tint `rgba(163,113,247,.08)` with a 1px `rgba(163,113,247,.18)` border). On the left, 16px line icon buttons (muted, brighter on hover): an archive icon that toggles "Show archived" / "Hide archived" (amber when active, tooltip with the current action) and an info icon linking to the Freepik attribution (tooltip "Icons by Freepik", opens in a new tab). On the right, the orchestrator avatar (28px, tooltip "Avengers") with a small status dot at its bottom right: green when any thread is `working` or `waiting_on_you`, grey otherwise.
- Avengers team pane: clicking the dock avatar toggles a panel that slides over the thread list (same width, the dock stays visible). Escape, the close button or clicking the avatar again closes it. Title "Avengers". One row per avatar kind in `src/avatars.ts` order, compact enough that all 7 fit without scrolling at 800px window height: 36px avatar, role name in bold (Orchestrator, Opus, Sonnet, Haiku, Codex, Grok, Other) and a one line muted description. No model or spec line and no marker pill. Participation is shown only by opacity: kinds that took part in the selected thread are at full opacity, the others at 45%. When a participating agent's name differs from the role name (e.g. "Codex Sol", "Opus 5.5"), it shows as faint text right aligned on the role line. Models live only here: the detail pane shows no model strings (avatar tooltips are `<name> · <role>`). Below the roster, faint text "Icons by Freepik". Status board: agents that took part in the selected thread get their own row, in thread order, at full opacity: avatar, "Role · model label" in bold, then one line: "Now: <text>" in amber when that agent owns the current step and the thread is working, else "<its last step text> · 4m ago" muted, else nothing. On the right a strip of that agent's last 6 steps as 4x12px bars (green past, amber current, grey empty slots). Kinds that did not take part keep the dimmed roster rows below.
- Row: live dot, display name (bold, one line, truncated), then on the right the "N ready" pill and the open count badge. Second line: description, muted, one line truncated. No avatars and no repo line in the row; the row tooltip reads `repo · branch · workspaceName`.
- Live dot: `working` green with a soft pulsing glow, `waiting_on_you` amber with a glow, `idle` faint grey, `dead` hollow faint ring, `error` red. Tooltip with the state name. In a thread row, `working` is shown instead as a 3 bar green equalizer (3px bars, 2px gap, 12px tall, staggered). While `working` and a step exists, the description line shows the step instead, typed in once per new step text (about 30ms per character, an amber caret that blinks only while typing and then disappears, no loop). The Overview header shows "Now: <step>" muted next to the live state while working.
- Archive: an archive icon button appears on row hover (the open count and ready pill hide while it shows) and `e` archives the selected thread (or unarchives it when archived). With "Show archived" on, archived threads appear below an "Archived" label, dimmed, with an unarchive button on hover.
- New decisions: the client remembers, per thread, the todos it has already seen (`localStorage` `mc-seen:<sessionId>`; the first sighting of a thread is the baseline, and a selected thread's todos always count as seen). A non selected thread with unseen open todos shows a small amber "N new" pill until it is opened, and its row glows softly once (about 1.5s fade, no loop) when new ones arrive. The client reports presence to `POST /api/presence` `{ focused }` on focus, blur and visibility changes and every 20s while visible.
- Empty state: "No sessions need you."

### Right: todos of the selected thread (360px)

- No header block. The Open / Sent / Done / All tabs are the first thing at the top. There is no per-run header; when the thread has more than one run, each todo shows its run title as a faint 11px line under the title.
- When an action (answer, submit, undo) moves a todo out of the active tab's list, its row slides right and fades (about 250ms) before leaving and the destination tab label briefly brightens (about 600ms).
- The list has two groups, separated by space rather than color:
  - "Needs you · N" (category `needs-you`) at the top under a small muted label. Row: state icon (open hollow circle, answered filled blue dot, submitted clock, picked_up arrow, done green check, dismissed muted strike), title, faint mono id on the right, and when `answered` a muted second line `→ <chosen option label | Agent decides | note excerpt>`.
  - "Council picks · N" (category `key-decision`) directly below Needs you with a 20px gap, collapsed by default into one row: violet council icon, label and chevron. Expanded, its rows are compact single lines in a muted violet tint: the council icon (instead of the state icon) when the answer is a preset, otherwise the normal state icon, then title and faint id. Expanded state is remembered per thread in `localStorage` (`mc-council-open:<sessionId>`). Keyboard `j` / `k` skips council rows while they are collapsed.
- The council icon is a 14px inline SVG of three overlapping circles in violet `#a371f7`. It also shows next to the title in the detail pane when the answer is a council pick, with the tooltip "Council pick, override before Submit".
- After accept, save or ask succeeds, the next visible todo in the current filter whose state is `open` is selected (wrapping around); if none, the selection stays.
- When the active tab has nothing, the pane shows "All caught up" with a small muted line "Nothing needs you in this session", centered near the top. An amber 46px ring (an enso) draws in once above the text over about 1.6s and holds.
- Filter tabs: Open (open + answered), In progress (submitted + picked_up), All. Default Open. The tabs are a segmented control with a thumb that slides behind the active tab (transform transition, about 200ms).
- Footer, sticky, never truncating its button label. Thread alive: one primary button "Submit N" (N answered todos, no thread name), disabled with the label "Nothing to submit" when N = 0, and below it a small "Copy prompt" link (copies `/api/threads/:id/prompt` text). Thread `dead`: one primary button "Copy prompt" only, plus one faint line "Session ended · paste into Conductor"; no Submit button and no link. After a successful Submit, the Submit button is replaced for 2.5s by a confirmation (a green check that draws in once, circle then tick, "Sent to <thread displayName>" in bold and the muted line "The agent is waking up"), which fades out before the normal footer returns. No toast. With `prefers-reduced-motion` the final check shows without drawing.

### Middle: Overview and Decision

Two tabs at the top left of the middle pane: "Overview" and "Decision". Selecting a thread opens Overview; clicking a todo (or `j` / `k`) switches to Decision; Overview is one click (or `o`) away. When no todo is available Overview is shown, never an empty "Select a todo." state. Decision only reacts to answer keys while it is the visible tab.

Overview is analytics, quiet and glanceable, CSS only (no chart library), one screen at 1920x1000 without scrolling:
- Header: thread display name, description, live state (dot plus Working / Waiting on you / Idle / Session ended / Error) and "updated 12m ago".
- Stat tiles (big number, small label): Needs you (open), Ready to submit (answered), Waiting for agent (submitted), Agent working on it (picked_up), Done, Council picks (key-decision count). Zero tiles are muted; clicking a tile filters the right pane to the matching tab (Open, Open, Sent, Sent, Done, All). The numbers count up from their previous value (0 on first render) over about 400ms with an ease-out (`requestAnimationFrame`; no animation under `prefers-reduced-motion`). The Done tile also shows a small green "+N today" at its bottom right when N > 0, N being todos whose `doneAt` is today in local time.
- Decisions: one thin stacked bar with legend: decided by you (answered with an answer, not preset), council picks kept (preset), deferred, dismissed, still open (the deferred and dismissed legend entries only show when their count is above 0; both only come from stored data). Then "Council agreed on X of Y decisions" (unanimous = every position with an `optionId` has the same one, at least two positions) and "Avg time to decide: 14m" (answeredAt minus run createdAt over answered, non preset todos; omitted when none).
- Agents: avatar row of everyone who took part in any run, role name under each, and a "Working now" pill when the thread is working.
- Runs: a small legend above the list (needs you, answered, council pick, sent, done), then one compact row per run: skill chip, title, one 14px rounded block per todo (wrapping when needed), `done/total`, active/done, relative updatedAt. Block colors: open is transparent with a 1.5px amber outline, answered by Thinh amber, answered as a council pick (preset) violet, submitted or picked_up blue, done green, dismissed the row border grey. Each block has the tooltip `<id> · <title> · <state>` and clicking it opens that todo in the Decision view (switching the right pane tab when the todo is not in the current one).

### Decision (todo detail)

Order:
1. Faint mono id, title (with the council icon when the answer is a council pick), then the run title and skill chip. No kind or category chips. Directly under the run title line, a lifecycle bar: five 6px segments with 4px gaps and labels under them (Open, Answered, Sent, Picked up, Done). Segments before the current stage are green, the current one amber with a slow pulse, later ones the row border color; the current label is amber and bold. Done shows all five green with no pulse; dismissed shows all muted with the single muted label "Dismissed". The pulse is off under `prefers-reduced-motion`.
2. Question (pre-wrapped text). When the first paragraph (up to the first blank line) matches `/^[\w-]+ at \S+/` it renders as a muted monospace location line and the rest as normal text.
3. No recommendation card: the recommended option carries the "Recommended" pill, the orchestrator's reasoning is its position card, and "Accept recommendation" lives in the sticky answer bar only.
4. Options as selectable cards (radio). Each card shows label, description, and mini avatars of the agents whose position has that `optionId`.
5. Positions: one card per agent, side by side (wrap), each with avatar, name, pill (no model line), summary, reason (clamped to 3 lines with the same link), evidence refs. The pill reads "Option <n>" (1-based index of its `optionId`, matching the kbd numbers; the stance is the tooltip), green when it matches the recommendation and grey otherwise; a position without a matching option shows its stance text in grey. When there are at least two positions and all share one `optionId`, the section collapses to one line "All <n> picked option <k>" with the avatar stack and a "Show reasoning" toggle that expands the cards.
6. Change, only when the todo has `diffs`: one unified diff block per entry. Header with the path (monospace) and +N / −N counts, hunk headers in blue, line numbers, green and red line backgrounds, static. Diffs longer than 40 rows collapse with a "Show all N lines" toggle.
7. Tradeoffs and caveats as two lists (omit empty).
8. Evidence list: `ref` monospace plus note. Click copies the ref.
9. Answer box, a sticky footer of the middle pane that stays visible while the detail scrolls: note textarea, "Accept recommendation" on the left when a recommendation exists and the todo is editable (duplicate of the card button), buttons Save answer and Ask the agent. There are no Dismiss or Defer actions; a stored `dismissed` todo shows a read only "Dismissed" line. "Ask the agent" is enabled only when the note has text: it answers the todo with `answer { optionId: null, text, deferred: false, answeredAt, question: true }`, counts toward Submit like any answer, and on pickup (`mc wait`) the text is appended to the todo's `conversation` as a Thinh message, the answer is cleared and the todo goes back to `open` (it is not listed under "Still open" in that block). While a conversation exists it shows right under the question as a compact thread: Thinh's lines right aligned in a subtle amber tint, agent lines left with the orchestrator avatar, timestamps faint. A todo row shows a small chat icon with the message count when the last message is from the agent (an unread reply). Approval todos show Approve / Reject as the options when `options` is empty. After submit the box is read only and shows the answer and `submittedAt` / `pickedUpAt` / `resolution`. Save answer and Accept recommendation show "Saving" with a small spinner while the request is in flight, then "✓ Saved" on green for about 1.2s, then return to normal; the auto-advance to the next open todo happens after the Saved state.
10. History, below Positions and the tradeoffs / caveats lists: a timeline rail of the events that exist, in time order. Raised (run createdAt, "Raised by <recommendation author or orchestrator>"), Council result ("Council agreed" when every position shares one option, else "Council split X to Y" counting the top two options), "You answered: <label>" or "Council pick kept" for a preset, "You asked" and "Agent replied" for each conversation message, Deferred and Dismissed (stored data only), Sent, Agent picked it up, and Done with the resolution text. Times are HH:mm, with the date added when not today. Past events have green rings; the latest is a filled amber dot.

### Keyboard

`o` overview, `e` archive / unarchive the selected thread, `j` / `k` next / previous todo, `1`-`9` pick option, `a` accept recommendation, `s` save, `Cmd+Enter` submit thread, `[` / `]` previous / next thread. Ignore keys while typing in the textarea except `Cmd+Enter`. `Cmd+K` / `Ctrl+K` opens the command palette.

## Avatars

`web/Avatar.tsx` shows Magnific (Freepik) character icons, 256px PNGs, inside a round frame (`object-fit: contain` with about 12% padding). The kind to icon mapping lives in one place, `src/avatars.ts`, shared by server, CLI and web. Tooltip: `<name> · <role>`.

- Orchestrator role (any model): 4019167. It gets no special treatment: same size and frame as every other avatar.
- Claude Opus (not orchestrator): 2503200. Claude Sonnet: 7024072. Claude Haiku: 6750978.
- Codex: 9238490. Cursor / Grok: 4402889. Anything else: 7023993.
- Frame background is a subtle tint of the harness color: claude `rgba(217,119,87,.18)`, codex `rgba(16,163,127,.18)`, cursor / grok `#0b0b0d` with a 1px `#3a3a42` ring, else `#232328`.
- Stacked avatars overlap by 6px and carry a 2px ring in the surrounding surface color.
- Fallback: when an icon fails to load, the avatar renders an original drawn SVG face for that kind instead (the drawings stay in `web/Avatar.tsx`).

Licensing: Magnific's free license forbids redistributing the files and this repo is public, so the PNGs are never committed and never live inside the repo (`*.png` is gitignored). They are downloaded at runtime to `$MC_HOME/avatars/<id>.png` from `https://cdn-icons-png.magnific.com/256/<floor(id/1000)>/<id>.png`: by `mc avatars` (downloads any missing ones) and by the server on start (fire and forget, never blocks startup). `GET /avatars/<id>.png` serves them with a long cache header, 404 when missing; only ids from the mapping are served. Attribution is required, so the left pane dock carries an info icon button and the team pane a faint "Icons by Freepik" line, the button linking to `https://www.magnific.com/icons/character`.

## Skill integration (later)

Skills call `mc push` with their needs-you and key decision items, start `mc wait <runId>` as a background Bash task, and on release act, `mc resolve` each todo, and wait again while anything is open. Finish with `mc done`.

## Decided (2026-10-10, via Mission Control run mc-native-1)

- Shell: wrap the existing UI in Electrobun (native window, tray, notifications), reusing the Bun server and React UI as is. Keep the plain localhost URL working.
- Timing: only after a week of real `/avengers` and `/prod-ready-check` runs through Mission Control, not before.
- Menu bar item: yes, it is the main reason to go native. It shows Mission Control sessions that are working and idle sessions waiting on Thinh's input (the thread live states `working` and `waiting_on_you`), not just a todo count. Clicking it opens the app on that thread.

## Undo snackbar and command palette

- Undo snackbar: after Submit, a snackbar appears at the bottom center of the window for 5s, with a draining amber ring, text ("2 answers sent to <displayName>") and an UNDO button. One at a time; the newest replaces the previous one. Undo on Submit calls `unsubmit`; when the todos were already picked up the snackbar says "Already picked up by the agent" instead. The right pane footer check after Submit stays.
- Command palette (`Cmd+K` / `Ctrl+K`): a centered palette with an input and a filtered list; arrow keys and Enter select, Escape closes. Items: actions on the current context (Accept recommendation when the current todo is editable in the Decision view; "Submit N to <thread>" when N > 0; Overview; Archive / Unarchive thread; Show / Hide archived; Copy prompt), then "Go to <thread>" for every thread, then every todo of the selected thread. Matching is case insensitive substring over title and subtitle, best matches first (title prefix, title substring, subtitle), at most 12 shown, with each item's shortcut on the right where one exists.
- All motion respects `prefers-reduced-motion`.

## prc-to-mc

`bin/prc-to-mc.ts <prod-ready-check context dir> [summary]` prints a push input for a prod-ready-check run. When the context dir has a `diff.patch`, each todo gets `diffs` from `extractDiffs` (`src/diffs.ts`, pure, covered by `src/diffs.test.ts` with `bun test`): for every `path` or `path:line` in the item's `location` it takes that file's hunks from the patch, only the hunk containing the line when a line is given, else all hunks, at most 3 per file.
