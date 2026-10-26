#!/usr/bin/env bash
# Blind, read-only code quality review of a PR gathered by prod-ready-check/gather.sh.
# Usage: review.sh <context-dir> <codex|grok>   (writes <peer>.json and <peer>.log there)
# Env: see prod-ready-check/peers.sh
set -euo pipefail

CTX="${1:?usage: review.sh <context-dir> <codex|grok>}"
PEER="${2:?usage: review.sh <context-dir> <codex|grok>}"
CTX="$(cd "$CTX" && pwd)"
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
PRC_DIR="$HOME/.claude/skills/prod-ready-check"
source "$PRC_DIR/peers.sh"
peer_name "$PEER" >/dev/null

[ -f "$CTX/meta.json" ] || { echo "$CTX/meta.json missing, run gather.sh first" >&2; exit 1; }

REPO_DIR="$(git -C "$CTX" rev-parse --show-toplevel 2>/dev/null || pwd)"
PR="$(jq -r .number "$CTX/meta.json")"
BASE="$(jq -r .baseRefName "$CTX/meta.json")"
URL="$(jq -r .url "$CTX/meta.json")"

PROMPT="$(cat <<EOF
Review pull request $URL for code smells and maintainability refactors only, as scoped below.
Read only: never edit files, never push, never call GitHub.

Material:
- Diff: $CTX/diff.patch
- Summary with review threads and the author's related PRs (ignore any CI status in it): $CTX/summary.md
- PR head is the local git ref pr-$PR. Read PR files only with git show pr-$PR:<path> and base files only with git show origin/$BASE:<path>. The working tree is a different branch: never read source files from disk, and cite only code you read through git show.
- Report every location as plain path:line with no ref prefix (not pr-$PR:path).
$( [ -f "$CTX/scout.md" ] && echo "- Map of existing helpers, precedents and callers from a scout (leads, verify before relying on them): $CTX/scout.md" )

Search the repo for the existing helpers, components, hooks and patterns the changed code could reuse.

$(cat "$SKILL_DIR/lenses.md")

Return every finding in the schema. List what you checked and found fine in checked_fine.
EOF
)"

run_peer "$PEER" "$REPO_DIR" "$PRC_DIR/findings.schema.json" "$CTX/$PEER.json" "$CTX/$PEER.log" "$PROMPT"

jq -e '.findings' "$CTX/$PEER.json" >/dev/null
echo "$PEER ($(peer_model "$PEER")) findings: $(jq '.findings | length' "$CTX/$PEER.json") -> $CTX/$PEER.json"
