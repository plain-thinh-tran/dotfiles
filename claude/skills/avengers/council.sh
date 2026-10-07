#!/usr/bin/env bash
# Council meeting: Codex Sol and Cursor Grok answer the same read-only prompt in parallel.
# Usage: council.sh design|challenge|review <meeting-dir>
#   design     needs brief.md               -> design.sol.md, design.grok.md
#   challenge  needs brief.md, design.md    -> challenge.sol.md, challenge.grok.md
#   review     needs design.md, diff.patch  -> review.sol.md, review.grok.md
# Env: CODEX_MODEL (default gpt-6-sol), CODEX_EFFORT (default high), CURSOR_MODEL (default grok-4.7-high)
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

STAGE="${1:?usage: council.sh design|challenge|review <meeting-dir>}"
DIR="$(cd "${2:?meeting dir required}" && pwd)"
CODEX_MODEL="${CODEX_MODEL:-gpt-6-sol}"
CODEX_EFFORT="${CODEX_EFFORT:-high}"
CURSOR_MODEL="${CURSOR_MODEL:-grok-4.7-high}"
REPO_DIR="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"

need() { [ -f "$DIR/$1" ] || { echo "$DIR/$1 missing" >&2; exit 1; }; }

HEADER="You sit on a council with Claude Opus 5.5 (chair), Codex Sol and Cursor Grok. The others answer the same prompt blind; the chair merges the answers.
Read only: never edit files, never run anything that writes, never push, never call GitHub.
Repo: $REPO_DIR. Cite file:line for every claim about the code."

case "$STAGE" in
design)
  need brief.md
  TASK="Design meeting. Read the brief at $DIR/brief.md, explore the code it points at, and propose a design.
Answer in markdown with these sections:
## Approach        the design in a few sentences, simplest thing that meets the brief
## Changes         each file to create or change and what changes, with file:line anchors
## Risks           what breaks, regresses or surprises in production, and how the design avoids it
## Rejected        alternatives you considered and why they lose
## Questions       anything the brief leaves open that changes the design"
  ;;
challenge)
  need brief.md
  need design.md
  TASK="Design meeting, second pass. The chair merged everyone's proposals into $DIR/design.md for the brief at $DIR/brief.md.
Attack it: wrong assumptions about the code, missed callers or consumers, production risks, simpler options it skipped, scope creep.
Answer in markdown as a numbered list of objections, each with file:line evidence and the change you want. Answer exactly 'No objections' if you have none."
  ;;
review)
  need design.md
  need diff.patch
  TASK="Code review meeting. Review the diff at $DIR/diff.patch against the agreed design at $DIR/design.md.
Hunt for correctness bugs, regressions, breaking changes for callers or consumers, drift from the design, dead code, and missing tests for new behaviour. Skip style and formatting.
Answer in markdown as a numbered list, each item: [blocking|should-fix|nit] title, file:line, concrete failure scenario, fix. Answer exactly 'No findings' if you have none."
  ;;
*)
  echo "unknown stage: $STAGE" >&2
  exit 1
  ;;
esac

PROMPT="$HEADER

$TASK"

sol() {
  command -v codex >/dev/null || { echo "codex not installed" >"$DIR/$STAGE.sol.log"; return 1; }
  codex exec \
    -m "$CODEX_MODEL" \
    -c "model_reasoning_effort=\"$CODEX_EFFORT\"" \
    -s read-only \
    -C "$REPO_DIR" \
    --ephemeral \
    -o "$DIR/$STAGE.sol.md" \
    "$PROMPT" >"$DIR/$STAGE.sol.log" 2>&1
}

grok() {
  local bin
  bin="$(command -v cursor-agent || command -v agent)" || {
    echo "cursor-agent not installed: curl https://cursor.com/install -fsS | bash" >"$DIR/$STAGE.grok.log"
    return 1
  }
  "$bin" -p \
    --model "$CURSOR_MODEL" \
    --mode ask \
    --trust \
    --output-format text \
    --workspace "$REPO_DIR" \
    "$PROMPT" >"$DIR/$STAGE.grok.md" 2>"$DIR/$STAGE.grok.log"
}

sol &
SOL_PID=$!
grok &
GROK_PID=$!

STATUS=0
report() {
  local name="$1" pid="$2" out="$DIR/$STAGE.$1.md"
  if wait "$pid" && [ -s "$out" ]; then
    echo "$name: $out"
  else
    echo "$name: FAILED, see $DIR/$STAGE.$name.log" >&2
    tail -5 "$DIR/$STAGE.$name.log" >&2
    STATUS=1
  fi
}
report sol "$SOL_PID"
report grok "$GROK_PID"
exit "$STATUS"
