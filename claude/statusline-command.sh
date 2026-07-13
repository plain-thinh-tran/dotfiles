#!/usr/bin/env bash
set -uo pipefail

input=$(cat)

RESET=$'\033[0m'
DIM=$'\033[2m'
FG=$'\033[38;5;250m'
MUT=$'\033[38;5;250m'
YELLOW=$'\033[38;5;221m'
RED=$'\033[38;5;210m'
OVER_C=$'\033[38;5;203m'
SEP=" ${DIM}•${RESET} "

threshold() { local p=${1:-0}
  if [ "$p" -ge 90 ]; then printf '%s' "$RED"
  elif [ "$p" -ge 70 ]; then printf '%s' "$YELLOW"
  else printf '%s' "$MUT"; fi
}

fmt_time() { local e=${1:-}; [ -z "$e" ] && return
  date -r "$e" +%H:%M 2>/dev/null || date -d "@$e" +%H:%M 2>/dev/null || true
}

PR=$(echo "$input"      | jq -r '.pr.number // empty')
DIR=$(echo "$input"     | jq -r '.workspace.current_dir // .cwd // "."')
MODEL=$(echo "$input"   | jq -r '.model.display_name // "?"')
EFFORT=$(echo "$input"  | jq -r '.effort.level // empty')
PCT=$(echo "$input"     | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
TOTIN=$(echo "$input"   | jq -r '.context_window.total_input_tokens // 0')
FIVE=$(echo "$input"    | jq -r '.rate_limits.five_hour.used_percentage // empty')
FIVE_RST=$(echo "$input"| jq -r '.rate_limits.five_hour.resets_at // empty')
WEEK=$(echo "$input"    | jq -r '.rate_limits.seven_day.used_percentage // empty')

BRANCH=$(git -C "$DIR" branch --show-current 2>/dev/null || true)
MAXB=22
[ "${#BRANCH}" -gt "$MAXB" ] && BRANCH="${BRANCH:0:$((MAXB-1))}…"

SEGS=()

[ -n "$PR" ]     && SEGS+=("${MUT}#${PR}${RESET}")
[ -n "$BRANCH" ] && SEGS+=("${MUT}${BRANCH}${RESET}")

M="${FG}${MODEL}${RESET}"
if [ -n "$EFFORT" ]; then
  E="$(tr '[:lower:]' '[:upper:]' <<<"${EFFORT:0:1}")${EFFORT:1}"
  M="$M ${MUT}(${E})${RESET}"
fi
SEGS+=("$M")

CTX="$(threshold "$PCT")${PCT}%${RESET}"
[ "$TOTIN" -gt 150000 ] && CTX="$CTX ${OVER_C}($((TOTIN/1000))k)${RESET}"
SEGS+=("$CTX")

if [ -n "$FIVE" ] || [ -n "$WEEK" ]; then
  RL=""
  if [ -n "$FIVE" ]; then
    n=$(printf '%.0f' "$FIVE"); t=$(fmt_time "$FIVE_RST")
    RL="${MUT}5h${RESET} $(threshold "$n")${n}%${RESET}"
    [ -n "$t" ] && RL="$RL ${MUT}(${t})${RESET}"
  fi
  if [ -n "$WEEK" ]; then
    n=$(printf '%.0f' "$WEEK")
    W="${MUT}7d${RESET} $(threshold "$n")${n}%${RESET}"
    RL="${RL:+$RL ${DIM}/${RESET} }$W"
  fi
  SEGS+=("$RL")
fi

out=""
for s in "${SEGS[@]}"; do
  out="${out:+$out$SEP}$s"
done
printf '%s\n' "$out"
