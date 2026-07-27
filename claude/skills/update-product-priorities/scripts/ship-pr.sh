#!/usr/bin/env bash
# ship-pr.sh — open the priorities PR and embed the board screenshot in its body.
#
# Wraps the create-pr skill's create-pr.sh (branch rename, commit, checks,
# rebase, push, draft PR), then publishes the screenshot and appends it to the
# PR description.
#
# Usage:
#   ship-pr.sh -l PE-192 -t "Chore: update platform priorities 2026-07-27" \
#              [-s /tmp/priorities.png] [-b main]
#
# GitHub has no API for attaching an image to a PR body, so the screenshot is
# pushed to a side branch (default `pr-assets`, never merged) and referenced by
# its raw URL. The PR diff stays clean. Re-running replaces the screenshot
# section rather than stacking duplicates.

set -euo pipefail

die() { printf 'error: %s\n' "$1" >&2; exit 1; }

CREATE_PR="$HOME/.claude/skills/create-pr/create-pr.sh"
ASSET_BRANCH="pr-assets"
MARKER="### Board after update"

LINEAR_ID=""; TITLE=""; SHOT=""; BASE="main"
while getopts ":l:t:s:b:h" opt; do
  case "$opt" in
    l) LINEAR_ID="$OPTARG" ;;
    t) TITLE="$OPTARG" ;;
    s) SHOT="$OPTARG" ;;
    b) BASE="$OPTARG" ;;
    h) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    :) die "-$OPTARG needs a value" ;;
    \?) die "unknown flag -$OPTARG" ;;
  esac
done

[ -n "$LINEAR_ID" ] || die "missing -l <LINEAR_ID> (create the Linear ticket first)"
[ -n "$TITLE" ]     || die "missing -t <title>"
[ -x "$CREATE_PR" ] || die "create-pr.sh not found at $CREATE_PR"
[ -z "$SHOT" ] || [ -f "$SHOT" ] || die "screenshot not found: $SHOT"

unset GH_TOKEN || true

"$CREATE_PR" -l "$LINEAR_ID" -t "$TITLE" -b "$BASE"

BRANCH="$(git branch --show-current)"
PR_URL="$(gh pr view "$BRANCH" --json url --jq '.url')"

if [ -z "$SHOT" ]; then
  echo "$PR_URL"
  exit 0
fi

REPO="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
DEST="${LINEAR_ID}-$(date +%Y%m%d%H%M%S).png"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# make sure the asset branch exists
if ! gh api "repos/$REPO/git/ref/heads/$ASSET_BRANCH" >/dev/null 2>&1; then
  echo "creating $ASSET_BRANCH branch"
  BASE_SHA="$(gh api "repos/$REPO/git/ref/heads/$BASE" --jq '.object.sha')"
  gh api --method POST "repos/$REPO/git/refs" \
    -f "ref=refs/heads/$ASSET_BRANCH" -f "sha=$BASE_SHA" >/dev/null
fi

# upload via the contents API (--rawfile keeps the base64 blob off the arg list)
base64 < "$SHOT" | tr -d '\n' > "$TMP/b64"
jq -n \
  --arg m "Add board screenshot for $LINEAR_ID" \
  --rawfile c "$TMP/b64" \
  --arg b "$ASSET_BRANCH" \
  '{message: $m, content: $c, branch: $b}' > "$TMP/payload.json"

gh api --method PUT "repos/$REPO/contents/$DEST" --input "$TMP/payload.json" >/dev/null
RAW="https://raw.githubusercontent.com/${REPO}/${ASSET_BRANCH}/${DEST}"

# drop any previous screenshot section, then append the fresh one
gh pr view "$BRANCH" --json body --jq '.body' \
  | awk -v m="$MARKER" '$0 == m { exit } { print }' > "$TMP/body.md"

{
  printf '%s\n\n' "$MARKER"
  printf '![Priorities board](%s)\n' "$RAW"
} >> "$TMP/body.md"

gh pr edit "$BRANCH" --body-file "$TMP/body.md" >/dev/null
echo "$PR_URL"
