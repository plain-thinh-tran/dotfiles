#!/usr/bin/env bash
started="$CLAUDE_RC_CHANNEL/started"
[ -f "$started" ] || date +%s > "$started"
end=$(( $(cat "$started") + 4 * 3600 ))
restart=$(( $(date +%s) + 7000 ))
while grep -q '^https' "$CLAUDE_RC_CHANNEL/url" 2>/dev/null && [ "$(date +%s)" -lt "$end" ]; do
  [ "$(date +%s)" -ge "$restart" ] && { echo "RESTART"; exit 0; }
  sleep 30
done
rm -f "$started"
echo "DONE"
