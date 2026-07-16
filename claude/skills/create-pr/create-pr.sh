#!/usr/bin/env bash
# create-pr.sh — enforce the Linear-driven PR workflow.
# Companion to the create-pr skill (see SKILL.md).
#
# Forces, in order:
#   1. A Linear issue id (you must have created the ticket first)
#   2. Branch renamed to <LINEAR_ID>-<slug> (no plain-thinh-tran/ prefix)
#   3. All working-tree changes committed
#   4. Pre-push checks (pnpm typecheck + format:fix) when it is a JS/TS repo
#   5. Rebase on origin/<base>, then push
#   6. A PR with a proper title and a body that is ONLY the Linear link
#
# Usage:
#   create-pr.sh -l <LINEAR_ID> -t "<Category>: <title>" [-m "<commit msg>"] [-b <base>]
#
# Example:
#   create-pr.sh -l PE-192 -t "Fix: correlationId propagation for DLQ debugging"

set -euo pipefail

die() { printf 'error: %s\n' "$1" >&2; exit 1; }

LINEAR_ID=""
TITLE=""
COMMIT_MSG=""
BASE="main"

while getopts ":l:t:m:b:h" opt; do
  case "$opt" in
    l) LINEAR_ID="$OPTARG" ;;
    t) TITLE="$OPTARG" ;;
    m) COMMIT_MSG="$OPTARG" ;;
    b) BASE="$OPTARG" ;;
    h) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    :) die "-$OPTARG needs a value" ;;
    \?) die "unknown flag -$OPTARG" ;;
  esac
done

[ -n "$LINEAR_ID" ] || die "missing -l <LINEAR_ID> (create the Linear ticket first)"
[ -n "$TITLE" ]     || die "missing -t <title>"
printf '%s' "$LINEAR_ID" | grep -Eq '^[A-Z]+-[0-9]+$' \
  || die "LINEAR_ID must look like PE-192, got: $LINEAR_ID"

# inject the Linear id into the category prefix: "Refactor: x" -> "Refactor(PE-484): x"
# leave the title untouched if it already carries a (ID) or has no category prefix
if [[ "$TITLE" =~ ^([A-Za-z]+):[[:space:]]*(.*)$ ]]; then
  TITLE="${BASH_REMATCH[1]}(${LINEAR_ID}): ${BASH_REMATCH[2]}"
fi

# gh auth in this repo can choke on a stale GH_TOKEN
unset GH_TOKEN || true

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git repo"
BRANCH="$(git branch --show-current)"
[ -n "$BRANCH" ] || die "detached HEAD; checkout a branch"
[ "$BRANCH" != "$BASE" ] || die "refusing to open a PR from $BASE; make a feature branch"

# 0. if a PR already exists for this branch, do nothing (no commit, push, or edit)
if EXISTING_URL="$(gh pr view "$BRANCH" --json url --jq '.url' 2>/dev/null)" && [ -n "$EXISTING_URL" ]; then
  echo "PR already exists, nothing to do: $EXISTING_URL"
  exit 0
fi

# 2. rename branch to <LINEAR_ID>-<slug> unless it already carries the id
slug() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40
}
if ! printf '%s' "$BRANCH" | grep -Eq "^${LINEAR_ID}-"; then
  NEW_BRANCH="${LINEAR_ID}-$(slug "$TITLE")"
  echo "renaming branch: $BRANCH -> $NEW_BRANCH"
  git branch -m "$BRANCH" "$NEW_BRANCH"
  git push origin --delete "$BRANCH" 2>/dev/null || true
  BRANCH="$NEW_BRANCH"
fi

# 3. commit all changes if the tree is dirty
if ! git diff --quiet || ! git diff --cached --quiet; then
  git add -A
  git commit -m "${COMMIT_MSG:-$TITLE}"
fi

git rev-parse --verify "origin/$BASE" >/dev/null 2>&1 || git fetch origin "$BASE"
[ -n "$(git log "origin/$BASE..HEAD" --oneline)" ] \
  || die "no commits ahead of origin/$BASE; nothing to open a PR for"

# 4. pre-push checks for JS/TS repos (matches the global pre-push checklist)
if [ -f package.json ] && command -v pnpm >/dev/null 2>&1; then
  echo "pnpm typecheck"
  pnpm typecheck
  echo "pnpm run format:fix"
  pnpm run format:fix
  if ! git diff --quiet; then
    git add -A && git commit -m "chore: format:fix"
  fi
fi

# 5. rebase on latest base, then push
git fetch origin "$BASE"
git rebase "origin/$BASE"
git push -u --force-with-lease origin "$BRANCH"

# 6. create the PR; body is ONLY the Linear link
LINEAR_URL="https://linear.app/plain/issue/${LINEAR_ID}"
BODY="[${LINEAR_ID}](${LINEAR_URL})"

gh pr create --draft --base "$BASE" --head "$BRANCH" --title "$TITLE" --body "$BODY"
gh pr view "$BRANCH" --json url --jq '.url'
