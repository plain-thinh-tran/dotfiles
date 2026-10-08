#!/usr/bin/env bash
# Upgrade the Codex and Cursor CLIs, list the models each offers, and flag ids not seen before.
# Usage: refresh.sh [--save]   (--save records the current lists as seen)
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
DIR="$(cd "$(dirname "$0")" && pwd)"
SEEN="$DIR/models.seen"
touch "$SEEN"

echo "== CLIs"
if brew list --cask codex >/dev/null 2>&1; then brew upgrade --cask codex >/dev/null 2>&1; fi
echo "codex $(codex --version 2>/dev/null | awk '{print $2}')"
cursor-agent update 2>&1 | tail -1
echo "cursor-agent $(cursor-agent --version 2>/dev/null)"

codex exec -m "$(jq -r '.models[] | select(.visibility == "list") | .slug' "$HOME/.codex/models_cache.json" | head -1)" \
  -c 'model_reasoning_effort="low"' -s read-only --skip-git-repo-check --ephemeral "Reply ok" >/dev/null 2>&1

CURRENT="$(mktemp)"
{
  jq -r '.models[] | select(.visibility == "list") | "codex \(.slug)  \(.description)"' "$HOME/.codex/models_cache.json"
  cursor-agent models 2>/dev/null | sed -n 's/^\([a-z0-9][^ ]*\) - \(.*\)$/cursor \1  \2/p' | grep -v -- '-fast '
} | sort -u >"$CURRENT"

echo "== Codex models"
grep '^codex ' "$CURRENT" | sed 's/^codex //'
echo "== New since last --save"
cut -d' ' -f1,2 "$CURRENT" | sort -u | comm -23 - <(cut -d' ' -f1,2 "$SEEN" | sort -u) | sed 's/^/  /'
echo "(full Cursor list: cursor-agent models)"

if [ "${1:-}" = "--save" ]; then cp "$CURRENT" "$SEEN"; echo "saved $SEEN"; fi
rm -f "$CURRENT"
