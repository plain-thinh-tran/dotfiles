#!/usr/bin/env bash
# Three way debate between Claude, Codex and Grok over their blind findings.
# Usage:
#   debate.sh items <context-dir>                 number findings into debate/items.json (C* Claude, X* Codex, G* Grok)
#   debate.sh round <context-dir> <n> <peer>      peer (codex|grok) positions for round n -> debate/round-<n>.<peer>.json
#   debate.sh tally <context-dir> <n>             merge all positions -> debate/tally-<n>.json
# Env: see peers.sh
set -euo pipefail

CMD="${1:?usage: debate.sh items|round|tally <context-dir> [round] [peer]}"
CTX="$(cd "${2:?context dir required}" && pwd)"
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SKILL_DIR/peers.sh"
DEBATE="$CTX/debate"
MAX_ROUNDS=3
REVIEWERS=(claude codex grok)
mkdir -p "$DEBATE"

case "$CMD" in
items)
  jq -n --slurpfile c "$CTX/claude.json" --slurpfile x "$CTX/codex.json" --slurpfile g "$CTX/grok.json" '
    def number($f; $p; $o): $f.findings | to_entries | map(.value + {id: "\($p)\(.key + 1)", owner: $o});
    number($c[0]; "C"; "claude") + number($x[0]; "X"; "codex") + number($g[0]; "G"; "grok")
  ' >"$DEBATE/items.json"
  jq -r '.[] | "\(.id) [\(.severity)] \(.title)"' "$DEBATE/items.json"
  ;;

round)
  ROUND="${3:?round required}"
  PEER="${4:?peer required (codex|grok)}"
  NAME="$(peer_name "$PEER")"
  OTHER="$([ "$PEER" = codex ] && echo grok || echo codex)"
  OTHER_NAME="$(peer_name "$OTHER")"
  REPO_DIR="$(git -C "$CTX" rev-parse --show-toplevel 2>/dev/null || pwd)"
  PR="$(jq -r .number "$CTX/meta.json")"
  BASE="$(jq -r .baseRefName "$CTX/meta.json")"

  PRIOR=""
  for ((k = 1; k < ROUND; k++)); do
    PRIOR+="- round $k: Claude $DEBATE/round-$k.claude.json, $OTHER_NAME $DEBATE/round-$k.$OTHER.json, you $DEBATE/round-$k.$PEER.json"$'\n'
  done
  if [ "$ROUND" -eq 1 ]; then
    SCOPE="Give a position on EVERY item in items.json: yours (owner $PEER), Claude's (owner claude) and $OTHER_NAME's (owner $OTHER)."
  else
    SCOPE="Give a position only on the items with status contested in $DEBATE/tally-$((ROUND - 1)).json. For each, read Claude's and $OTHER_NAME's latest reason and evidence, then answer their argument directly in your reason: say what convinced you, or exactly why it does not hold against the code."
  fi

  read -r -d '' PROMPT <<EOF || true
You are $NAME. You, Claude and $OTHER_NAME each reviewed pull request #$PR blind. The three of you are now debating the findings and must convince each other. A finding reaches the report only when all three of you hold it, and is dropped only when none of you hold it; anything still split after round $MAX_ROUNDS goes to the human to decide. This is round $ROUND of at most $MAX_ROUNDS.
Read only: never edit files, never push, never call GitHub.

Material:
- All findings, numbered: $DEBATE/items.json (C* Claude's, X* Codex's, G* Grok's; the owner field says whose)
- Diff: $CTX/diff.patch. PR head is git ref pr-$PR (git show pr-$PR:<path>). Base is origin/$BASE.
- Review lenses: $SKILL_DIR/lenses.md
$PRIOR
$SCOPE

Stances:
- On items owned by Claude or $OTHER_NAME: agree (real and actionable as stated), revise (real, but at the severity or fix you give), disagree (not real, not reachable, not actionable, or out of scope).
- On your own items: agree (maintain it), revise (maintain with changed severity or fix), withdraw (an argument from the others or your re-check shows it is wrong).

Rules:
- Verify against the code before answering. Do not defer to the others to reach consensus, and do not defend a position the code contradicts.
- Out of scope, always disagree: CI results, merge status, approvals, PR process, style, naming, formatting.
- dead-code needs a repo wide search showing nothing reaches it. refactor needs a named existing helper or documented repo pattern.
- Two items with the same root cause: take the same stance on both and name the other id in reason; the report merges them.
- evidence names the file:line, search, or source you checked. revised_fix is null unless stance is revise and the fix changes.
EOF

  run_peer "$PEER" "$REPO_DIR" "$SKILL_DIR/debate.schema.json" \
    "$DEBATE/round-$ROUND.$PEER.json" "$DEBATE/round-$ROUND.$PEER.log" "$PROMPT"

  jq -e '.positions' "$DEBATE/round-$ROUND.$PEER.json" >/dev/null
  echo "$PEER round $ROUND positions: $(jq '.positions | length' "$DEBATE/round-$ROUND.$PEER.json") -> $DEBATE/round-$ROUND.$PEER.json"
  ;;

tally)
  ROUND="${3:?round required}"
  POSITIONS="{}"
  for r in "${REVIEWERS[@]}"; do
    FILES=()
    for ((k = 1; k <= ROUND; k++)); do
      [ -f "$DEBATE/round-$k.$r.json" ] || { echo "missing round-$k.$r.json" >&2; exit 1; }
      FILES+=("$DEBATE/round-$k.$r.json")
    done
    POSITIONS="$(jq --arg r "$r" --argjson p "$(jq -s '[.[].positions[]] | reduce .[] as $p ({}; .[$p.id] = $p)' "${FILES[@]}")" '.[$r] = $p' <<<"$POSITIONS")"
  done
  jq -n --slurpfile items "$DEBATE/items.json" --argjson pos "$POSITIONS" '
    def held: .stance == "agree" or .stance == "revise";
    $items[0] | map(
      . as $i
      | {claude: $pos.claude[$i.id], codex: $pos.codex[$i.id], grok: $pos.grok[$i.id]} as $p
      | [$p[]] as $all
      | . + $p + {
          status: (
            if any($all[]; . == null) then "contested"
            elif all($all[]; held) then "agreed"
            elif any($all[]; held) then "contested"
            else "dropped" end)
        })
  ' >"$DEBATE/tally-$ROUND.json"
  jq -r 'group_by(.status) | .[] | "\(.[0].status): \(map(.id) | join(" "))"' "$DEBATE/tally-$ROUND.json"
  ;;

*)
  echo "unknown command: $CMD" >&2
  exit 1
  ;;
esac
