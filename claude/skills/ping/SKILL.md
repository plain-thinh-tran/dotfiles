---
name: ping
description: Spawn a background Claude session with Remote Control that watches a condition and pings your phone when done. Use when the user says "ping", "ping me when", "notify me when", "alert me when done", or wants a phone notification for a long-running task.
user-invocable: true
allowed-tools: Bash
---

# Watch and Ping

Spawn a lightweight background Claude agent with Remote Control enabled. The agent monitors a condition and sends a mobile push notification (via PushNotification + Remote Control) when the condition resolves.

**User's request:** $ARGUMENTS

## How it works

`claude --bg --remote-control` starts a background agent with Remote Control active. Remote Control enables PushNotification to push to the user's phone. The agent polls a condition, and when it resolves, calls PushNotification.

## Your job

1. **Clean up old watchers from THIS workspace only.** Run this BEFORE spawning:

   ```bash
   mkdir -p ~/.claude/watchers
   WORKSPACE_KEY=$(echo "$PWD" | md5 | cut -c1-8)
   WATCHER_FILE=~/.claude/watchers/${WORKSPACE_KEY}.txt

   CLEANED=0
   if [ -f "$WATCHER_FILE" ]; then
     while IFS= read -r sid; do
       claude stop "$sid" 2>/dev/null && CLEANED=$((CLEANED+1))
     done < "$WATCHER_FILE"
     rm -f "$WATCHER_FILE"
   fi
   ```

   Tracking is scoped by workspace directory hash, so watchers spawned from different Conductor workspaces don't interfere with each other.

2. **Parse the request** from `$ARGUMENTS` and conversation context. Identify:
   - **What to watch** (deployment, CI, a process, plan review, a custom condition)
   - **Success/failure criteria** (what "done" means)
   - **Custom ping message** (if user specified one, otherwise generate a clear one)

   **Auto-detect plan mode:** If the session is currently in plan mode, or the request mentions "plan", "review", or the context suggests a plan is being prepared, automatically use the **Plan ready for review** pattern below. The ExitPlanMode hook handles the signaling — no sentinel file needs to be created manually.

3. **Build the monitoring prompt.** The prompt must be FULLY SELF-CONTAINED — the bg agent has no conversation history, no skills, no CLAUDE.md. Include:
   - Exact shell commands to check the condition
   - Polling interval (default 60s, adjust for context)
   - Clear success/failure definitions
   - Maximum watch time (default 60 minutes)
   - The PushNotification message to send

4. **Launch the bg agent and track it:**

   ```bash
   OUTPUT=$(claude --bg \
     --remote-control "watch-<descriptive-slug>" \
     --model sonnet \
     --dangerously-skip-permissions \
     --allowedTools "Bash,Read,PushNotification" \
     -- "<the-prompt>" 2>&1)
   echo "$OUTPUT"

   # Extract and track session ID for future cleanup (same WATCHER_FILE from step 1)
   SESSION_ID=$(echo "$OUTPUT" | grep -o 'backgrounded · [a-f0-9]*' | awk '{print $NF}')
   if [ -n "$SESSION_ID" ]; then
     echo "$SESSION_ID" >> "$WATCHER_FILE"
   fi
   ```

   - `--model sonnet` — monitoring is simple work, save cost
   - `--dangerously-skip-permissions` — agent runs unattended, can't prompt for approval
   - `--allowedTools` — restrict to only what's needed for safety
   - `--remote-control` — enables phone push via PushNotification
   - `--` before prompt — REQUIRED because `--allowedTools` is variadic and eats the positional prompt without it

5. **Report back** with the session ID and management commands.

## Prompt template

Use this structure for the bg agent prompt. Adapt the specifics to the request.

```
You are a background monitoring agent. Your ONLY job: watch a condition, send a phone notification when it resolves, then stop.

CONDITION: <what to watch>
CHECK COMMAND: <exact shell command(s) to run>
SUCCESS: <what output/state means done-success>
FAILURE: <what output/state means done-failure>
POLL INTERVAL: <N> seconds
MAX DURATION: <M> minutes
PING MESSAGE ON SUCCESS: <message, under 200 chars>
PING MESSAGE ON FAILURE: <message, under 200 chars>

RULES:
- Run the check command, evaluate the result, sleep, repeat.
- When success or failure is detected, call the PushNotification tool with the appropriate message and status "proactive". Then STOP.
- If the check command itself errors 3 times in a row, send a PushNotification about the monitoring error and stop.
- After MAX DURATION with no resolution, send: "<thing> still running after <M>min — check manually"
- No commentary, no analysis, no extra output. Just poll and ping.
- IMPORTANT: Use the PushNotification tool (not echo/print). The message arg must be under 200 chars.
```

## Common patterns

### Prod deployment (team-plain/services)

Check command:
```bash
unset GH_TOKEN && gh run list --workflow=deploy.yml --limit=3 -R team-plain/services --json status,conclusion,headBranch,databaseId --jq '.[] | select(.headBranch=="main") | {status,conclusion,databaseId}' | head -1
```
- Success: `conclusion` is `"success"` and `status` is `"completed"`
- Failure: `conclusion` is `"failure"` and `status` is `"completed"`
- Still running: `status` is `"in_progress"` or `"queued"`
- Poll: 60s
- Max: 60min

### PR CI checks

Resolve PR from branch or number, then:
```bash
unset GH_TOKEN && gh pr checks <PR> -R team-plain/services --json name,state --jq '[.[] | select(.name != "Mergify Merge Protections")] | {total: length, passed: [.[] | select(.state == "SUCCESS")] | length, failed: [.[] | select(.state == "FAILURE")] | length, pending: [.[] | select(.state == "PENDING")] | length}'
```
- Success: `failed == 0` and `pending == 0`
- Failure: `failed > 0` and `pending == 0`
- Poll: 120s
- Max: 90min

### Plan ready for review

When the user says "ping me when the plan is ready", "notify me when plan is done", or invokes /watch-and-ping during or before plan mode. A PostToolUse hook on ExitPlanMode touches a workspace-scoped sentinel file automatically.

Check command:
```bash
WORKSPACE_KEY=$(echo "<absolute-workspace-pwd>" | md5 | cut -c1-8)
test -f ~/.claude/watchers/${WORKSPACE_KEY}-plan-ready && echo DONE || echo WAITING
```
- Success: output contains `DONE`
- On success, **clean up the sentinel**: `rm -f ~/.claude/watchers/${WORKSPACE_KEY}-plan-ready`
- Poll: 15s (plans typically ready within minutes)
- Max: 30min
- Ping message: "Plan ready for review! Check Conductor."

**How it works:** The ExitPlanMode PostToolUse hook in `~/.claude/settings.json` touches `~/.claude/watchers/<workspace-key>-plan-ready` when any agent finishes a plan. The watcher detects this file and pings.

**Important:** Replace `<absolute-workspace-pwd>` with the actual `$PWD` of the workspace that will produce the plan (the directory where the planning agent is running), NOT the watcher's own `$PWD`.

### Generic "wait for command to succeed"

User provides the command. Agent runs it, checks exit code.
- Success: exit code 0
- Failure: exit code non-zero after all retries
- Poll: user-specified or 30s

## Cleanup behavior

Tracking is scoped per workspace: `~/.claude/watchers/<md5-of-cwd>.txt`. Each workspace only cleans up its own watchers — a watcher spawned from `san-jose-v1` won't be stopped by an invocation from `dubai-v1`.

If the user wants MULTIPLE concurrent watchers from the same workspace, skip cleanup and warn that they'll accumulate until next invocation.

## Output to user

After launching, report:

```
Watcher spawned: <session-id>
Monitoring: <what>
RC session: <name>
Cleaned up: <N> old watcher(s) (or "none")

Manage:
  claude logs <id>     — check progress
  claude stop <id>     — cancel
  claude attach <id>   — take over interactively
```
