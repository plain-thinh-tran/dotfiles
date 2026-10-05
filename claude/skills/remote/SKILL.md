---
name: remote
description: Turn on Remote Control for the current Conductor session so Thinh can continue it from his phone or claude.ai/code. Use when Thinh says "/remote", "remote control", "rc", "continue on my phone", or "let me pick this up remotely". Pass "off" to disconnect.
effort: low
---

# Remote

Scripted task, no investigation. Do not read the scripts.

Run `~/.claude/skills/remote/toggle.sh "ARG"`, with `ARG` the skill argument: `off`, a session name, or empty.

If the output is a URL and no keepalive task is running in this session, start one: Bash `~/.claude/skills/remote/keepalive.sh`, `run_in_background: true`, `timeout: 7200000`. Conductor kills idle sessions after 30 minutes and phone messages do not count; a running background task blocks that.

When the keepalive task finishes: output `RESTART` → start it again the same way, silently. `DONE` → do nothing. Do not restart on anything else. It stops itself after `off` or 4 hours.

Reply with one line:

- URL: "Remote Control on: <url>"
- `disabled`: "Remote Control off."
- `NO_WRAPPER`: session not started through `~/.claude/bin/claude-rc`; set `claude_code_executable_path = "/Users/thinhtran/.claude/bin/claude-rc"` in `~/.conductor/settings.toml` and start a new chat.
- Anything else: report it as is.
