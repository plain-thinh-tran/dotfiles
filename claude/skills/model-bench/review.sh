#!/usr/bin/env bash
# Run one blind review seat on a case with the prod-ready-check prompt and lenses.
# Usage: review.sh <workdir> <A|B> <codex|cursor|claude> <model> [effort]
#   codex/cursor run now and write runs/<case>/<runner>-<model>-<effort>.{json,log,time.json}
#   claude only renders the prompt; launch it with the Agent tool (model: <model>) and record usage
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
DIR="$(cd "$(dirname "$0")" && pwd)"
PRC="$HOME/.claude/skills/prod-ready-check"
W="$(cd "${1:?workdir}" && pwd)" CASE="${2:?case}" RUNNER="${3:?runner}" MODEL="${4:?model}" EFFORT="${5:-high}"
CTX="$W/case$CASE" REPO="$W/repos/case$CASE" OUT="$W/runs/$CASE"
TAG="$RUNNER-$MODEL-$EFFORT"
mkdir -p "$OUT"
source "$PRC/peers.sh"

PROMPT="$(sed "s#{{CTX}}#$CTX#g" "$DIR/prompts/review.md")

$(cat "$PRC/lenses.md")

Return every finding in the schema. Use worth-knowing for non-blocking items. List parity checks that passed in checked_fine."

if [ "$RUNNER" = claude ]; then
  printf '%s\n\nWork only inside %s. Never read other files under %s except %s/diff.patch and %s/summary.md.\nWrite your answer as JSON matching %s to %s, then reply with only the number of findings.\n' \
    "$PROMPT" "$REPO" "$W" "$CTX" "$CTX" "$PRC/findings.schema.json" "$OUT/$TAG.json" >"$OUT/$TAG.prompt.md"
  echo "$OUT/$TAG.prompt.md"
  exit 0
fi

PEER="$([ "$RUNNER" = cursor ] && echo grok || echo codex)"
export CODEX_MODEL="$MODEL" GROK_MODEL="$MODEL" CODEX_EFFORT="$EFFORT"
START=$(date +%s)
run_peer "$PEER" "$REPO" "$PRC/findings.schema.json" "$OUT/$TAG.json" "$OUT/$TAG.log" "$PROMPT"
RC=$?
SECS=$(( $(date +%s) - START ))
echo "{\"tag\":\"$TAG\",\"rc\":$RC,\"seconds\":$SECS}" >"$OUT/$TAG.time.json"
echo "$TAG rc=$RC ${SECS}s findings=$(jq '.findings | length' "$OUT/$TAG.json" 2>/dev/null)"
