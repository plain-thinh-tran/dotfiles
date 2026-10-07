#!/usr/bin/env bash
# Collects everything prod-ready-check needs about one PR into a context dir.
# Usage: gather.sh <pr-number|pr-url> [-R owner/repo] [-n author-pr-limit] [-o out-dir]
set -euo pipefail

usage() {
  echo "usage: gather.sh <pr-number|pr-url> [-R owner/repo] [-n author-pr-limit] [-o out-dir]" >&2
  exit 2
}

[ $# -ge 1 ] || usage
PR_ARG="$1"
shift
REPO=""
AUTHOR_LIMIT=40
OUT_DIR=""
while getopts "R:n:o:" opt; do
  case "$opt" in
    R) REPO="$OPTARG" ;;
    n) AUTHOR_LIMIT="$OPTARG" ;;
    o) OUT_DIR="$OPTARG" ;;
    *) usage ;;
  esac
done

command -v gh >/dev/null || { echo "gh not installed" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq not installed" >&2; exit 1; }

if ! gh auth status >/dev/null 2>&1; then
  unset GH_TOKEN
fi

if [[ "$PR_ARG" =~ github\.com/([^/]+/[^/]+)/pull/([0-9]+) ]]; then
  REPO="${REPO:-${BASH_REMATCH[1]}}"
  PR="${BASH_REMATCH[2]}"
elif [[ "$PR_ARG" =~ ^[0-9]+$ ]]; then
  PR="$PR_ARG"
else
  usage
fi
if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi

if [ -z "$OUT_DIR" ]; then
  if git rev-parse --show-toplevel >/dev/null 2>&1; then
    OUT_DIR="$(git rev-parse --show-toplevel)/.context/prod-ready-check/pr-$PR"
  else
    OUT_DIR="${TMPDIR:-/tmp}/prod-ready-check/pr-$PR"
  fi
fi
mkdir -p "$OUT_DIR"

OWNER="${REPO%%/*}"
NAME="${REPO##*/}"
SUMMARY="$OUT_DIR/summary.md"

gh pr view "$PR" -R "$REPO" --json \
  number,title,body,url,author,state,isDraft,baseRefName,headRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision,additions,deletions,changedFiles,labels,createdAt,files \
  >"$OUT_DIR/meta.json"
gh pr diff "$PR" -R "$REPO" >"$OUT_DIR/diff.patch"
jq -r '.files[].path' "$OUT_DIR/meta.json" >"$OUT_DIR/files.txt"
if [ "$(wc -l <"$OUT_DIR/files.txt")" -ge 100 ]; then
  gh pr diff "$PR" -R "$REPO" --name-only >"$OUT_DIR/files.txt"
fi

AUTHOR="$(jq -r .author.login "$OUT_DIR/meta.json")"
BASE="$(jq -r .baseRefName "$OUT_DIR/meta.json")"
TITLE="$(jq -r .title "$OUT_DIR/meta.json")"
TICKETS="$(jq -r '[.title, .body, .headRefName] | join(" ")' "$OUT_DIR/meta.json" | grep -oE '[A-Z]{2,6}-[0-9]{2,}' | sort -u || true)"


gh api graphql -F owner="$OWNER" -F name="$NAME" -F pr="$PR" -f query='
query($owner: String!, $name: String!, $pr: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 1) { nodes { author { login } body url } }
        }
      }
      reviews(last: 30) { nodes { author { login } state body submittedAt } }
    }
  }
}' >"$OUT_DIR/reviews.json"

gh pr list -R "$REPO" --author "$AUTHOR" --state all --limit "$AUTHOR_LIMIT" \
  --json number,title,state,mergedAt,createdAt,headRefName,baseRefName,url,files \
  | jq --argjson pr "$PR" '[.[] | select(.number != $pr)]' >"$OUT_DIR/author-prs.json"

jq --rawfile changed "$OUT_DIR/files.txt" '
  ($changed | split("\n") | map(select(length > 0))) as $mine
  | ($mine | map(split("/")[0:2] | join("/")) | unique) as $dirs
  | map(
      . as $p
      | ($p.files | map(.path)) as $theirs
      | {
          number, title, state, mergedAt, url, baseRefName,
          sameFiles: [$theirs[] | select(. as $f | $mine | index($f))],
          sameDirs: ([$theirs[] | split("/")[0:2] | join("/") | select(. as $d | $dirs | index($d))] | unique)
        }
    )
  | map(select((.sameFiles | length) > 0 or (.sameDirs | length) > 0))
  | sort_by(-(.sameFiles | length), -(.sameDirs | length))
' "$OUT_DIR/author-prs.json" >"$OUT_DIR/author-overlap.json"

echo '[]' >"$OUT_DIR/ticket-prs.json"
for ticket in $TICKETS; do
  gh pr list -R "$REPO" --state all --limit 20 --search "$ticket" \
    --json number,title,state,mergedAt,url,author \
    | jq --arg t "$ticket" --argjson pr "$PR" '[.[] | select(.number != $pr) | . + {ticket: $t, author: .author.login}]'
done | jq -s 'add // [] | unique_by(.number)' >"$OUT_DIR/ticket-prs.json"

LOCAL_REF=""
DRIFT=""
if git rev-parse --show-toplevel >/dev/null 2>&1 \
  && git remote get-url origin 2>/dev/null | grep -qi "$REPO"; then
  git fetch -q origin "$BASE" "+pull/$PR/head:pr-$PR"
  LOCAL_REF="pr-$PR"
  MERGE_BASE="$(git merge-base "origin/$BASE" "$LOCAL_REF")"
  CHANGED=()
  while IFS= read -r path; do
    CHANGED+=("$path")
  done <"$OUT_DIR/files.txt"
  DRIFT="$(git log --oneline "$MERGE_BASE..origin/$BASE" -- "${CHANGED[@]}" 2>/dev/null || true)"
  printf '%s\n' "$DRIFT" >"$OUT_DIR/base-drift.txt"
fi

{
  echo "# PR #$PR: $TITLE"
  echo
  jq -r '"- url: \(.url)\n- author: \(.author.login)\n- state: \(.state)\(if .isDraft then " (draft)" else "" end)\n- base: \(.baseRefName) <- \(.headRefName) @ \(.headRefOid[0:10])\n- size: +\(.additions) -\(.deletions) in \(.changedFiles) files\n- labels: \([.labels[].name] | join(", "))"' "$OUT_DIR/meta.json"
  echo "- tickets: $(echo "$TICKETS" | tr '\n' ' ')"
  if [ -n "$LOCAL_REF" ]; then
    echo "- local ref: $LOCAL_REF (read files with: git show $LOCAL_REF:<path>)"
  fi
  echo
  echo "## Review Threads"
  jq -r '
    .data.repository.pullRequest.reviewThreads.nodes
    | map(select(.isResolved | not))
    | if length == 0 then "no unresolved threads"
      else .[] | "- \(.path):\(.line // "?") \(.comments.nodes[0].author.login): \(.comments.nodes[0].body | gsub("\n"; " ") | .[0:160]) \(.comments.nodes[0].url)"
      end' "$OUT_DIR/reviews.json"
  echo
  echo "## Changed Files"
  sed 's/^/- /' "$OUT_DIR/files.txt"
  echo
  echo "## Author PRs Touching the Same Area"
  jq -r '
    if length == 0 then "none in the last author PRs"
    else .[] | "- #\(.number) [\(.state)\(if .mergedAt then " " + .mergedAt[0:10] else "" end)] \(.title)\n  same files: \(.sameFiles | .[0:6] | join(", "))\(if (.sameFiles | length) > 6 then " …" else "" end)\n  same dirs: \(.sameDirs | join(", "))"
    end' "$OUT_DIR/author-overlap.json"
  echo
  echo "## Author Open PRs"
  jq -r 'map(select(.state == "OPEN")) | if length == 0 then "none" else .[] | "- #\(.number) \(.title) (base \(.baseRefName))" end' "$OUT_DIR/author-prs.json"
  echo
  echo "## PRs Sharing a Ticket"
  jq -r 'if length == 0 then "none" else .[] | "- #\(.number) [\(.state)] \(.ticket) by \(.author): \(.title)" end' "$OUT_DIR/ticket-prs.json"
  echo
  echo "## Base Drift on Changed Files Since Merge Base"
  if [ -z "$LOCAL_REF" ]; then
    echo "skipped: not inside a clone of $REPO"
  elif [ -z "$DRIFT" ]; then
    echo "none"
  else
    printf '%s\n' "$DRIFT" | sed 's/^/- /'
  fi
} >"$SUMMARY"

cat "$SUMMARY"
echo
echo "context dir: $OUT_DIR (diff.patch, meta.json, reviews.json, author-prs.json, author-overlap.json, ticket-prs.json)"
