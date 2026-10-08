#!/usr/bin/env bash
# Print what each run produced so it can be graded against cases/ground-truth.md.
# Usage: grade.sh <workdir> review <A|B>   findings per review run
#        grade.sh <workdir> build <P1|P2>  mechanical checks per build worker
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
W="$(cd "${1:?workdir}" && pwd)" MODE="${2:?review|build}" ID="${3:?case or packet}"

review() {
  for f in "$W/runs/$ID"/*.json; do
    case "$f" in *.time.json) continue ;; esac
    local t="${f%.json}.time.json"
    echo "### $(basename "$f" .json) $([ -f "$t" ] && jq -r '"\(.seconds)s rc=\(.rc)"' "$t")"
    jq -r '.findings[] | "- [\(.severity)/\(.confidence)] \(.title) (\(.location))"' "$f" 2>/dev/null || echo "  (unparseable)"
  done
}

vitest() {
  (cd "$1" && NO_COLOR=1 npx vitest run --config vitest.config.js "$2" >"$1.vitest.log" 2>&1) && echo pass || echo "FAIL (see $1.vitest.log)"
}

build_p1() {
  local d="$1" f=packages/aggregates/src/thread/threadDbFilterUtils.ts t=packages/aggregates/src/thread/threadDbFilterUtils.test.ts
  local keep
  echo "  files: $(command git -C "$d" diff --name-only | tr '\n' ' ')"
  echo "  empty fragments left in SLA/agentStatus builders: $(awk '/serviceLevelAgreements: \(filter/,/statuses: \(statuses/' "$d/$f" | grep -c 'sql.fragment``')"
  echo "  own suite: $(vitest "$d" "$t")"
  keep="$(mktemp)"
  cp "$d/$t" "$keep"
  command git -C "$d" show "HEAD:$t" >"$d/$t"
  if command git -C "$d" apply "$DIR/packets/P1.hidden.patch" 2>/dev/null; then
    echo "  hidden test: $(vitest "$d" "$t")"
  else
    echo "  hidden test: patch does not apply"
  fi
  cp "$keep" "$d/$t"
  rm -f "$keep"
}

build_p2() {
  local d="$1" orig
  orig="$(jq -r .sha "$DIR/cases/B.json")"
  echo "  files: $(command git -C "$d" diff --name-only | tr '\n' ' ')"
  echo "  residual diff vs the real PR (empty means identical):"
  command git -C "$d" diff "$orig" -- packages/importers/src/handlers/importCustomers.ts packages/aggregates/src/customers/customerAggregate.ts | sed 's/^/    /'
}

if [ "$MODE" = review ]; then review; exit; fi
for d in "$W/build/$ID"-*/; do
  d="${d%/}"
  t="$d.time.json"
  echo "### $(basename "$d") $([ -f "$t" ] && jq -r '"\(.seconds)s rc=\(.rc)"' "$t")"
  "build_$(echo "$ID" | tr '[:upper:]' '[:lower:]')" "$d"
done
