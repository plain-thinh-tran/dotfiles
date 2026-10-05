#!/usr/bin/env bash
[ -n "$CLAUDE_RC_CHANNEL" ] || { echo "NO_WRAPPER"; exit 0; }
rm -f "$CLAUDE_RC_CHANNEL/url"
printf '%s' "$1" > "$CLAUDE_RC_CHANNEL/request"
for _ in $(seq 1 30); do [ -f "$CLAUDE_RC_CHANNEL/url" ] && break; sleep 1; done
cat "$CLAUDE_RC_CHANNEL/url" 2>/dev/null || echo "TIMEOUT"
