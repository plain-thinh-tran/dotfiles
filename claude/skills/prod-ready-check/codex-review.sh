#!/usr/bin/env bash
# Blind, read-only Codex review of a PR gathered by gather.sh.
# Usage: codex-review.sh <context-dir>   (writes codex.json and codex.log there)
# Env: CODEX_MODEL (default gpt-5.6-sol), CODEX_EFFORT (default high)
set -euo pipefail

CTX="${1:?usage: codex-review.sh <context-dir>}"
CTX="$(cd "$CTX" && pwd)"
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL="${CODEX_MODEL:-gpt-5.6-sol}"
EFFORT="${CODEX_EFFORT:-high}"

command -v codex >/dev/null || { echo "codex not installed" >&2; exit 1; }
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

codex exec \
  -m "$MODEL" \
  -c "model_reasoning_effort=\"$EFFORT\"" \
  -s read-only \
  -C "$REPO_DIR" \
  --ephemeral \
  --output-schema "$SKILL_DIR/findings.schema.json" \
  -o "$CTX/codex.json" \
  "$PROMPT" >"$CTX/codex.log" 2>&1

jq -e '.findings' "$CTX/codex.json" >/dev/null
echo "codex ($MODEL) findings: $(jq '.findings | length' "$CTX/codex.json") -> $CTX/codex.json"
