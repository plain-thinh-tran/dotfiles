#!/usr/bin/env bash
# Blind, read-only peer review of a PR gathered by gather.sh.
# Usage: review.sh <context-dir> <codex|grok>   (writes <peer>.json and <peer>.log there)
# Env: see peers.sh
set -euo pipefail

CTX="${1:?usage: review.sh <context-dir> <codex|grok>}"
PEER="${2:?usage: review.sh <context-dir> <codex|grok>}"
CTX="$(cd "$CTX" && pwd)"
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SKILL_DIR/peers.sh"
peer_name "$PEER" >/dev/null

[ -f "$CTX/meta.json" ] || { echo "$CTX/meta.json missing, run gather.sh first" >&2; exit 1; }

REPO_DIR="$(git -C "$CTX" rev-parse --show-toplevel 2>/dev/null || pwd)"
PR="$(jq -r .number "$CTX/meta.json")"
BASE="$(jq -r .baseRefName "$CTX/meta.json")"
URL="$(jq -r .url "$CTX/meta.json")"

PROMPT="$(cat <<EOF
Review pull request $URL for breaking changes and regressions before it merges to production.
Read only: never edit files, never push, never call GitHub.

Material:
- Diff: $CTX/diff.patch
- Summary with CI, review threads, and the author's related PRs: $CTX/summary.md
- PR head is the local git ref pr-$PR. Read files with: git show pr-$PR:<path>
- Compare against origin/$BASE. Local branches are stale.

Trace every changed file to what it replaces and what consumes it (callers, other stacks, readers of outputs, schemas, env vars), and compare old and new behaviour attribute by attribute. Back external facts with library or provider source in the repo's node_modules or vendor docs you already know, and say which.

$(cat "$SKILL_DIR/lenses.md")

Return every finding in the schema. Use worth-knowing for non-blocking items. List parity checks that passed in checked_fine.
EOF
)"

run_peer "$PEER" "$REPO_DIR" "$SKILL_DIR/findings.schema.json" "$CTX/$PEER.json" "$CTX/$PEER.log" "$PROMPT"

jq -e '.findings' "$CTX/$PEER.json" >/dev/null
echo "$PEER ($(peer_model "$PEER")) findings: $(jq '.findings | length' "$CTX/$PEER.json") -> $CTX/$PEER.json"
