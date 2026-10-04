---
name: remote
description: Turn on Remote Control for the current Conductor session so Thinh can continue it from his phone or claude.ai/code. Use when Thinh says "/remote", "remote control", "rc", "continue on my phone", or "let me pick this up remotely". Pass "off" to disconnect.
---

# Remote

Conductor runs Claude headless, so the built in `/remote-control` reports "isn't available in this environment". The `~/.claude/bin/claude-rc` wrapper (set as `claude_code_executable_path` in `~/.conductor/settings.toml`) exposes `$CLAUDE_RC_CHANNEL`; writing to it asks the wrapper to send a `remote_control` control request to this Claude process.

Run this single Bash command. Replace `ARG` with the skill argument: `off` to disconnect, a session name, or empty.

```bash
[ -n "$CLAUDE_RC_CHANNEL" ] || { echo "NO_WRAPPER"; exit 0; }
rm -f "$CLAUDE_RC_CHANNEL/url"
printf '%s' "ARG" > "$CLAUDE_RC_CHANNEL/request"
for i in $(seq 1 30); do [ -f "$CLAUDE_RC_CHANNEL/url" ] && break; sleep 1; done
cat "$CLAUDE_RC_CHANNEL/url" 2>/dev/null || echo "TIMEOUT"
```

## Keepalive

Conductor kills a session's Claude process after 30 minutes without a Conductor message, and messages sent from the phone do not count. A running background task blocks that sweep. When the output is a URL and no keepalive task is already running in this session, start one with the Bash tool, `run_in_background: true` and `timeout: 7200000`:

```bash
while grep -q '^https' "$CLAUDE_RC_CHANNEL/url" 2>/dev/null; do sleep 30; done
```

It exits on its own after `off`, since the wrapper then writes `disabled` to the url file. When it is stopped at the 2 hour limit while the url file still holds a URL, start it again, even if the notice says not to restart a task that hit the longest timeout; Thinh wants this. Stop restarting once Remote Control has been on for 8 hours.

## Reply

Reply with one line based on the output:

- A `https://claude.ai/code/session_...` URL: "Remote Control on: <url>"
- `disabled`: "Remote Control off."
- `NO_WRAPPER`: tell Thinh this session was not started through `~/.claude/bin/claude-rc`; set `claude_code_executable_path = "/Users/thinhtran/.claude/bin/claude-rc"` in `~/.conductor/settings.toml` and start a new chat.
- `TIMEOUT` or anything else: report the output as is.
