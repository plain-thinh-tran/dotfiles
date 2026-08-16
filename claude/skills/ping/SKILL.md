---
name: ping
description: Send a Slack DM notification via the Rocky bot token, either immediately or when a variable condition resolves. Use when the user says "ping", "ping me when", "notify me when", "alert me when done", or wants a Slack DM for a long-running task.
user-invocable: true
allowed-tools: Bash
---

# Ping (Slack DM)

Notify the user with a direct Slack message using the Rocky bot token. Two modes:

1. **Immediate** — send one DM right now.
2. **Conditional** — watch a variable condition in the background and DM when it resolves ("ping me when the deployment is done").

**User's request:** $ARGUMENTS

## Prerequisite

The bot token must be in the `ROCKY_OAUTH_TOKEN` environment variable (a Slack `xoxb-...` bot token). The scripts read it directly; the token is never hardcoded. Target defaults to Slack user `U0AQCM5FQ7K`, overridable with `SLACK_PING_USER_ID`.

If `ROCKY_OAUTH_TOKEN` is unset, the script exits with a clear error — tell the user to export it in their shell profile.

## The scripts (deterministic, no LLM in the loop)

- `scripts/slack-notify.sh "message"` — sends one DM. Exits 0 on success, non-zero with the Slack error on failure.
- `scripts/slack-watch.sh` — polls a shell command and calls `slack-notify.sh` when the condition resolves. Config is all via environment variables (see its header).

The model's only job is to translate a *variable* condition into a concrete `CHECK_CMD` + match rule, then launch the watcher. Everything after that is deterministic shell.

## Mode 1 — immediate ping

```bash
~/.claude/skills/ping/scripts/slack-notify.sh "your message here"
```

Use this whenever the user just wants to be told something now.

## Mode 2 — conditional ping

1. **Parse the request** into:
   - **CHECK_CMD** — a shell command whose output (or exit code) reveals the condition.
   - **Match rule** — either a `SUCCESS_PATTERN` (grep -E over the command output) and optional `FAIL_PATTERN`, or `USE_EXIT_CODE=1` (success = the command exits 0).
   - **SUCCESS_MESSAGE** / optional **FAIL_MESSAGE** — the DM text.
   - **POLL_INTERVAL** (default 60s) and **MAX_MINUTES** (default 60).

2. **Launch it in the background** so it survives the turn:

   ```bash
   nohup env \
     CHECK_CMD='<command>' \
     SUCCESS_PATTERN='<pattern>' \
     FAIL_PATTERN='<pattern-or-omit>' \
     SUCCESS_MESSAGE='<done message>' \
     FAIL_MESSAGE='<failed message>' \
     POLL_INTERVAL=60 \
     MAX_MINUTES=60 \
     ~/.claude/skills/ping/scripts/slack-watch.sh \
     >/tmp/ping-watch-$$.log 2>&1 &
   echo "watcher PID $!  (log: /tmp/ping-watch-$$.log)"
   ```

3. **Report** the PID and log path so the user can `kill <pid>` or `tail` it.

## Match rule: which to use

- **USE_EXIT_CODE=1** — "wait until this command succeeds" (e.g. a healthcheck `curl -fsS`, a `test -f`, a script that returns 0 when done). Simplest when the command already signals via exit code.
- **SUCCESS_PATTERN / FAIL_PATTERN** — when the command always exits 0 but its *output* carries the status (e.g. a CI JSON blob with `"conclusion":"success"`). This is the common case for polling APIs.

## Common patterns

### Prod deployment (team-plain/services)

```bash
CHECK_CMD='unset GH_TOKEN && gh run list --workflow=deploy.yml --limit=3 -R team-plain/services --json status,conclusion,headBranch --jq ".[] | select(.headBranch==\"main\") | \"\(.status) \(.conclusion)\"" | head -1'
SUCCESS_PATTERN='completed success'
FAIL_PATTERN='completed failure'
SUCCESS_MESSAGE='✅ Prod deploy done (main).'
FAIL_MESSAGE='❌ Prod deploy FAILED (main) — check the run.'
POLL_INTERVAL=60
MAX_MINUTES=60
```

### PR CI checks

```bash
CHECK_CMD='unset GH_TOKEN && gh pr checks <PR> -R team-plain/services --json state --jq "[.[] | select(.name != \"Mergify Merge Protections\")] | \"pending=\([.[]|select(.state==\"PENDING\")]|length) failed=\([.[]|select(.state==\"FAILURE\")]|length)\""'
SUCCESS_PATTERN='pending=0 failed=0'
FAIL_PATTERN='failed=[1-9]'
SUCCESS_MESSAGE='✅ PR <PR> checks all green.'
FAIL_MESSAGE='❌ PR <PR> has failing checks.'
POLL_INTERVAL=120
MAX_MINUTES=90
```

### Wait for a command to succeed (exit-code mode)

```bash
CHECK_CMD='curl -fsS https://example.com/health'
USE_EXIT_CODE=1
SUCCESS_MESSAGE='✅ Service is healthy.'
POLL_INTERVAL=30
MAX_MINUTES=30
```

### A local build / long task in this shell

Point CHECK_CMD at whatever signals completion — a sentinel file the task touches, a log line, or the task's own exit via `USE_EXIT_CODE=1` wrapping the command.

## Notes

- The watcher always sends *something* (success, failure, or a timeout message after `MAX_MINUTES`), so a ping never silently disappears.
- Keep messages short and specific — they land as a phone Slack notification.
- Multiple watchers can run at once; each is its own background PID. There is no shared cleanup, so tell the user the PID if they may want to cancel it.
- The old Remote-Control/Claude implementation is preserved at `SKILL.md.remote-control.bak` if it is ever needed again.
