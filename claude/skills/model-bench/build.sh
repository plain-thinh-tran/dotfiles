#!/usr/bin/env bash
# Run one build worker on a packet in a fresh repo copy.
# Usage: build.sh <workdir> <P1|P2> <codex|cursor|claude> <model> [effort]
#   claude only renders the packet; launch it with the Agent tool (model: <model>) and record usage
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
DIR="$(cd "$(dirname "$0")" && pwd)"
W="$(cd "${1:?workdir}" && pwd)" P="${2:?packet}" RUNNER="${3:?runner}" MODEL="${4:?model}" EFFORT="${5:-medium}"
TAG="$RUNNER-$MODEL"
REPO="$("$DIR/setup.sh" "$W" build "$P" "$TAG" | head -1)"
PROMPT="$(sed "s#{{REPO}}#$REPO#g" "$DIR/packets/$P.md")"
LOG="$W/build/$P-$TAG.log"

if [ "$RUNNER" = claude ]; then
  echo "$PROMPT" >"$W/build/$P-$TAG.prompt.md"
  echo "$W/build/$P-$TAG.prompt.md"
  exit 0
fi

START=$(date +%s)
case "$RUNNER" in
codex)
  codex exec -m "$MODEL" -c "model_reasoning_effort=\"$EFFORT\"" -s workspace-write \
    -C "$REPO" --ephemeral \
    "$PROMPT" >"$LOG" 2>&1
  ;;
cursor)
  cursor-agent -p --force --trust --model "$MODEL" --output-format json \
    --workspace "$REPO" "$PROMPT" >"$LOG" 2>"$LOG.err"
  ;;
esac
RC=$?
echo "{\"tag\":\"$P-$TAG\",\"rc\":$RC,\"seconds\":$(( $(date +%s) - START ))}" | tee "$W/build/$P-$TAG.time.json"
