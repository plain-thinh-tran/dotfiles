---
name: remote
description: Turn on Remote Control for the current Conductor session so Thinh can continue it from his phone or claude.ai/code. Use when Thinh says "/remote", "remote control", "rc", "continue on my phone", or "let me pick this up remotely". Pass "off" to disconnect.
effort: low
---

# Remote

Scripted task, no investigation. Do not read the scripts.

Run `~/.claude/skills/remote/toggle.sh "ARG"`, with `ARG` the skill argument: `off`, a session name, or empty.

If the output is a URL and no keepalive task is running in this session, start one: Bash `~/.claude/skills/remote/keepalive.sh`, `run_in_background: true`, `timeout: 7200000`. Conductor kills idle sessions after 30 minutes and phone messages do not count; a running background task blocks that.

When the keepalive task finishes, the turn has no text at all, not even an acknowledgement:

- `RESTART` → start it again the same way, then end the turn.
- `DONE` → end the turn immediately.
- If the notification does not show the output, read it with one `tail -1` and apply the above.

Do not restart on anything else. It stops itself after `off` or 4 hours.

After running `toggle.sh`, reply with one line:

- URL: "Remote Control on: <url>"
- `disabled`: "Remote Control off."
- `NO_WRAPPER`: session not started through `~/.claude/bin/claude-rc`; set `claude_code_executable_path = "/Users/thinhtran/.claude/bin/claude-rc"` in `~/.conductor/settings.toml` and start a new chat.
- Anything else: report it as is.
