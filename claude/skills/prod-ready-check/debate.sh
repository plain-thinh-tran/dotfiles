#!/usr/bin/env bash
# Debate between Claude and Codex over their blind findings.
# Usage:
#   debate.sh items <context-dir>          number findings into debate/items.json (C* Claude, X* Codex)
#   debate.sh codex <context-dir> <round>  Codex positions for a round -> debate/round-<n>.codex.json
#   debate.sh tally <context-dir> <round>  merge both sides' positions -> debate/tally-<n>.json
# Env: CODEX_MODEL (default gpt-5.6-sol), CODEX_EFFORT (default high)
set -euo pipefail

CMD="${1:?usage: debate.sh items|codex|tally <context-dir> [round]}"
CTX="$(cd "${2:?context dir required}" && pwd)"
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
DEBATE="$CTX/debate"
mkdir -p "$DEBATE"

case "$CMD" in
items)
  jq -n --slurpfile c "$CTX/claude.json" --slurpfile x "$CTX/codex.json" '
    ($c[0].findings | to_entries | map(.value + {id: "C\(.key + 1)", owner: "claude"}))
    + ($x[0].findings | to_entries | map(.value + {id: "X\(.key + 1)", owner: "codex"}))
  ' >"$DEBATE/items.json"
  jq -r '.[] | "\(.id) [\(.severity)] \(.title)"' "$DEBATE/items.json"
  ;;

codex)
  ROUND="${3:?round required}"
  command -v codex >/dev/null || { echo "codex not installed" >&2; exit 1; }
  REPO_DIR="$(git -C "$CTX" rev-parse --show-toplevel 2>/dev/null || pwd)"
  PR="$(jq -r .number "$CTX/meta.json")"
  BASE="$(jq -r .baseRefName "$CTX/meta.json")"
  MODEL="${CODEX_MODEL:-gpt-5.6-sol}"
  EFFORT="${CODEX_EFFORT:-high}"

  PRIOR=""
  for ((k = 1; k < ROUND; k++)); do
    PRIOR+="- earlier round $k: Claude $DEBATE/round-$k.claude.json, you $DEBATE/round-$k.codex.json"$'\n'
  done
  if [ "$ROUND" -eq 1 ]; then
    SCOPE="Give a position on EVERY item in items.json, both yours (owner codex) and Claude's (owner claude)."
  else
    SCOPE="Give a position only on the items listed as contested in $DEBATE/tally-$((ROUND - 1)).json. Read Claude's latest reason and evidence for each before answering."
  fi

  read -r -d '' PROMPT <<EOF || true
You and Claude each reviewed pull request #$PR blind. You are now debating the findings to reach consensus. This is round $ROUND of at most 3.
Read only: never edit files, never push, never call GitHub.

Material:
- All findings, numbered: $DEBATE/items.json (C* are Claude's, X* are yours)
- Diff: $CTX/diff.patch. PR head is git ref pr-$PR (git show pr-$PR:<path>). Base is origin/$BASE.
- Review lenses: $SKILL_DIR/lenses.md
$PRIOR
$SCOPE

Stances:
- On Claude's items: agree (real and actionable as stated), revise (real, but at the severity or fix you give), disagree (not real, not reachable, not actionable, or out of scope).
- On your own items: agree (maintain it), revise (maintain with changed severity or fix), withdraw (Claude's argument or your re-check shows it is wrong).

Rules:
- Verify against the code before answering; do not defer to Claude and do not defend a position the code contradicts.
- Out of scope, always disagree: CI results, merge status, approvals, PR process, style, naming, formatting.
- dead-code needs a repo wide search showing nothing reaches it. refactor needs a named existing helper or documented repo pattern.
- Two items with the same root cause: take the same stance on both and name the other id in reason; the report merges them.
- evidence names the file:line, search, or source you checked. revised_fix is null unless stance is revise and the fix changes.
EOF

  codex exec \
    -m "$MODEL" \
    -c "model_reasoning_effort=\"$EFFORT\"" \
    -s read-only \
    -C "$REPO_DIR" \
    --ephemeral \
    --output-schema "$SKILL_DIR/debate.schema.json" \
    -o "$DEBATE/round-$ROUND.codex.json" \
    "$PROMPT" >"$DEBATE/round-$ROUND.codex.log" 2>&1

  jq -e '.positions' "$DEBATE/round-$ROUND.codex.json" >/dev/null
  echo "codex round $ROUND positions: $(jq '.positions | length' "$DEBATE/round-$ROUND.codex.json") -> $DEBATE/round-$ROUND.codex.json"
  ;;

tally)
  ROUND="${3:?round required}"
  FILES_C=() FILES_X=()
  for ((k = 1; k <= ROUND; k++)); do
    [ -f "$DEBATE/round-$k.claude.json" ] || { echo "missing round-$k.claude.json" >&2; exit 1; }
    [ -f "$DEBATE/round-$k.codex.json" ] || { echo "missing round-$k.codex.json" >&2; exit 1; }
    FILES_C+=("$DEBATE/round-$k.claude.json")
    FILES_X+=("$DEBATE/round-$k.codex.json")
  done
  jq -n \
    --slurpfile items "$DEBATE/items.json" \
    --argjson c "$(jq -s '[.[].positions[]] | reduce .[] as $p ({}; .[$p.id] = $p)' "${FILES_C[@]}")" \
    --argjson x "$(jq -s '[.[].positions[]] | reduce .[] as $p ({}; .[$p.id] = $p)' "${FILES_X[@]}")" '
    def yes: . == "agree" or . == "revise";
    $items[0] | map(
      . as $i
      | ($c[$i.id] // null) as $cp
      | ($x[$i.id] // null) as $xp
      | (if $i.owner == "claude" then $cp else $xp end) as $own
      | (if $i.owner == "claude" then $xp else $cp end) as $other
      | . + {
          claude: $cp,
          codex: $xp,
          status: (
            if $own == null or $other == null then "contested"
            elif ($own.stance == "withdraw" or $own.stance == "disagree") then "dropped"
            elif ($own.stance | yes) and ($other.stance | yes) then "agreed"
            else "contested" end)
        })
  ' >"$DEBATE/tally-$ROUND.json"
  jq -r 'group_by(.status) | .[] | "\(.[0].status): \(map(.id) | join(" "))"' "$DEBATE/tally-$ROUND.json"
  ;;

*)
  echo "unknown command: $CMD" >&2
  exit 1
  ;;
esac
