#!/bin/bash
set -u
R=~/.mission-control/benchmark/results/codex
OUT=$(cd "$(dirname "$0")" && pwd)
MODELS=(gpt-6-sol gpt-6.1-sol@high gpt-6-astra)
CASES=$(cd ~/.mission-control/benchmark/cases && ls | grep -v '^lookup-' | sed 's/\.json$//')
snap() {
  mkdir -p "$OUT/r$1"
  for m in "${MODELS[@]}"; do d=${m/@/_}; cp -R "$R/$d" "$OUT/r$1/"; done
  ~/.claude/bin/mc bench | grep -E "^Codex.*(GPT-6 Sol:|GPT-6.1 Sol high|GPT-6 Astra)" > "$OUT/r$1/scores.txt"
}
missing() {
  local d=${1/@/_} since=$2
  for c in $CASES; do
    python3 -c "import json,sys;j=json.load(open('$R/$d/$c.json'));sys.exit(0 if j['at']>'$since' and not j.get('error') else 1)" 2>/dev/null || echo $c
  done
}
drain() { until ~/.claude/bin/mc bench 2>/dev/null | head -1 | grep -q " 0 running, 0 queued"; do sleep 60; done; }
snap 1
for round in 2 3; do
  since=$(date -u +%Y-%m-%dT%H:%M:%S)
  for attempt in 1 2 3; do
    any=0
    for m in "${MODELS[@]}"; do
      miss=$(missing $m $since | python3 -c 'import sys,json;print(json.dumps(sys.stdin.read().split()))')
      [ "$miss" = "[]" ] && continue
      any=1
      curl -s -X POST localhost:4747/api/benchmark/run -H 'content-type: application/json' -d "{\"seat\":\"codex\",\"model\":\"$m\",\"cases\":$miss}" -o /dev/null
      echo "round $round attempt $attempt queued $m $miss"
    done
    [ $any = 0 ] && break
    sleep 30; drain
  done
  snap $round
  echo "round $round done"; cat "$OUT/r$round/scores.txt"
done
