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

Reply with one line based on the output:

- A `https://claude.ai/code/session_...` URL: "Remote Control on: <url>"
- `disabled`: "Remote Control off."
- `NO_WRAPPER`: tell Thinh this session was not started through `~/.claude/bin/claude-rc`; set `claude_code_executable_path = "/Users/thinhtran/.claude/bin/claude-rc"` in `~/.conductor/settings.toml` and start a new chat.
- `TIMEOUT` or anything else: report the output as is.
