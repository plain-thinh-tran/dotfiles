#!/usr/bin/env bash
# Send an immediate Slack DM via the Rocky bot token. Deterministic, no LLM.
#
# Usage: slack-notify.sh "message text"
#
# Env:
#   ROCKY_OAUTH_TOKEN   (required)  Slack bot token (xoxb-...)
#   SLACK_PING_USER_ID  (optional)  target Slack user id (default: U0AQCM5FQ7K)
#
# Slack's chat.postMessage resolves a user id passed as `channel` to that
# user's DM channel, so no conversations.open call is needed.
set -euo pipefail

TOKEN="${ROCKY_OAUTH_TOKEN:-}"
USER_ID="${SLACK_PING_USER_ID:-U0AQCM5FQ7K}"

if [ -z "$TOKEN" ]; then
  echo "slack-notify: ROCKY_OAUTH_TOKEN is not set" >&2
  exit 1
fi

MESSAGE="$*"
if [ -z "$MESSAGE" ]; then
  echo "slack-notify: no message provided" >&2
  echo "usage: slack-notify.sh \"message text\"" >&2
  exit 2
fi

RESPONSE=$(curl -sS -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data "$(jq -n --arg ch "$USER_ID" --arg txt "$MESSAGE" '{channel:$ch, text:$txt}')")

if [ "$(printf '%s' "$RESPONSE" | jq -r '.ok')" = "true" ]; then
  echo "slack-notify: sent to $USER_ID"
  exit 0
fi

echo "slack-notify: failed: $(printf '%s' "$RESPONSE" | jq -r '.error // "unknown_error"')" >&2
exit 1
