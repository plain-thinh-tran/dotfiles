#!/usr/bin/env bash
# Debate between Claude and the peers (Codex and Grok, or only Codex on the lite tier) over their blind findings.
# Usage:
#   debate.sh items <context-dir>                 number findings into debate/items.json (C* Claude, X* Codex, G* Grok)
#   debate.sh round <context-dir> <n> <peer>      peer (codex|grok) positions for round n -> debate/round-<n>.<peer>.json
#   debate.sh tally <context-dir> <n>             merge all positions -> debate/tally-<n>.json
# Env: see peers.sh; LENSES_FILE overrides lenses.md (check-code-quality uses its own); PRC_PEERS lists the peers (default "codex grok"); PRC_MAX_ROUNDS (default 3)
set -euo pipefail

CMD="${1:?usage: debate.sh items|round|tally <context-dir> [round] [peer]}"
CTX="$(cd "${2:?context dir required}" && pwd)"
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SKILL_DIR/peers.sh"
LENSES="${LENSES_FILE:-$SKILL_DIR/lenses.md}"
DEBATE="$CTX/debate"
MAX_ROUNDS="${PRC_MAX_ROUNDS:-3}"
read -r -a PEERS <<<"${PRC_PEERS:-codex grok}"
REVIEWERS=(claude "${PEERS[@]}")
prefix() {
  case "$1" in claude) echo C ;; codex) echo X ;; grok) echo G ;; esac
}
mkdir -p "$DEBATE"

case "$CMD" in
items)
  ARGS=()
  EXPR=""
  for r in "${REVIEWERS[@]}"; do
    ARGS+=(--slurpfile "$r" "$CTX/$r.json")
    EXPR+="${EXPR:+ + }number(\$$r[0]; \"$(prefix "$r")\"; \"$r\")"
  done
  jq -n "${ARGS[@]}" "def number(\$f; \$p; \$o): \$f.findings | to_entries | map(.value + {id: \"\\(\$p)\\(.key + 1)\", owner: \$o}); $EXPR" >"$DEBATE/items.json"
  jq -r '.[] | "\(.id) [\(.severity)] \(.title)"' "$DEBATE/items.json"
  ;;

round)
  ROUND="${3:?round required}"
  PEER="${4:?peer required (codex|grok)}"
  NAME="$(peer_name "$PEER")"
  OTHER=""
  for p in "${PEERS[@]}"; do
    if [ "$p" != "$PEER" ]; then OTHER="$p"; fi
  done
  CREW="You and Claude"
  OTHERS="Claude"
  OTHER_ITEMS=""
  if [ -n "$OTHER" ]; then
    OTHER_NAME="$(peer_name "$OTHER")"
    CREW="You, Claude and $OTHER_NAME"
    OTHERS="Claude or $OTHER_NAME"
    OTHER_ITEMS=" and $OTHER_NAME's (owner $OTHER)"
  fi
  REPO_DIR="$(git -C "$CTX" rev-parse --show-toplevel 2>/dev/null || pwd)"
  PR="$(jq -r .number "$CTX/meta.json")"
  BASE="$(jq -r .baseRefName "$CTX/meta.json")"

  PRIOR=""
  for ((k = 1; k < ROUND; k++)); do
    OTHER_ROUND=""
    if [ -n "$OTHER" ]; then OTHER_ROUND=" $OTHER_NAME $DEBATE/round-$k.$OTHER.json,"; fi
    PRIOR+="- round $k: Claude $DEBATE/round-$k.claude.json,$OTHER_ROUND you $DEBATE/round-$k.$PEER.json"$'\n'
  done
  if [ "$ROUND" -eq 1 ]; then
    SCOPE="Give a position on EVERY item in items.json: yours (owner $PEER), Claude's (owner claude)$OTHER_ITEMS."
  else
    SCOPE="Give a position only on the items with status contested in $DEBATE/tally-$((ROUND - 1)).json. For each, read the latest reason and evidence of $OTHERS, then answer their argument directly in your reason: say what convinced you, or exactly why it does not hold against the code."
  fi

  read -r -d '' PROMPT <<EOF || true
You are $NAME. $CREW each reviewed pull request #$PR blind. You are now debating the findings and must convince each other. A finding reaches the report only when all of you hold it, and is dropped only when none of you hold it; anything still split after round $MAX_ROUNDS goes to the human to decide. This is round $ROUND of at most $MAX_ROUNDS.
Read only: never edit files, never push, never call GitHub.

Material:
- All findings, numbered: $DEBATE/items.json (C* Claude's, X* Codex's, G* Grok's when Grok takes part; the owner field says whose)
- Diff: $CTX/diff.patch. PR head is git ref pr-$PR, base is origin/$BASE. Read code only with git show pr-$PR:<path> or git show origin/$BASE:<path>, never from the working tree (a different branch), and cite locations as plain path:line with no ref prefix.
- Review lenses: $LENSES
$( [ -z "${LENSES_FILE:-}" ] && [ -f "$SKILL_DIR/taste.md" ] && echo "- Taste rules, findings Thinh has said he does not want: $SKILL_DIR/taste.md. An item a rule covers is out of scope: disagree, or withdraw your own." )
- Diffs of related PRs in other repos, if any: $CTX/external/
$PRIOR
$SCOPE

Stances:
- On items owned by $OTHERS: agree (real and actionable as stated), revise (real, but at the severity or fix you give), disagree (not real, not reachable, not actionable, or out of scope).
- On your own items: agree (maintain it), revise (maintain with changed severity or fix), withdraw (an argument from the others or your re-check shows it is wrong).

Rules:
- Verify against the code before answering. Do not defer to the others to reach consensus, and do not defend a position the code contradicts.
- Out of scope, always disagree: CI results, merge status, approvals, PR process, style, naming, formatting.
- dead-code needs a repo wide search showing nothing reaches it. refactor needs the evidence the review lenses ask for: a named existing helper or documented repo pattern, or whatever else the lenses accept.
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
  jq -n --slurpfile items "$DEBATE/items.json" --argjson pos "$POSITIONS" --argjson reviewers "$(printf '%s\n' "${REVIEWERS[@]}" | jq -R . | jq -s .)" '
    def held: .stance == "agree" or .stance == "revise";
    $items[0] | map(
      . as $i
      | ($reviewers | map({key: ., value: $pos[.][$i.id]}) | from_entries) as $p
      | [$p[]] as $all
      | [$reviewers[] as $r | {seat: $r, position: $p[$r]} | select(.position != null and .position.stance == "revise" and .position.revised_fix != null) | {seat, fix: .position.revised_fix}] as $fixes
      | . + $p + {
          status: (
            if any($all[]; . == null) then "contested"
            elif all($all[]; held) then "agreed"
            elif any($all[]; held) then "contested"
            else "dropped" end),
          revisedFixes: $fixes
        })
  ' >"$DEBATE/tally-$ROUND.json"
  jq -r 'group_by(.status) | .[] | "\(.[0].status): \(map(.id + (if (.revisedFixes | length) > 0 then " (fix revised by \(.revisedFixes | map(.seat) | join("+")))" else "" end)) | join(" "))"' "$DEBATE/tally-$ROUND.json"
  ;;

*)
  echo "unknown command: $CMD" >&2
  exit 1
  ;;
esac
