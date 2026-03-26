#!/bin/sh
input=$(cat)

cwd=$(echo "$input" | jq -r '.cwd // .workspace.current_dir // empty')
model=$(echo "$input" | jq -r '.model.display_name // empty')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# Shorten the path: replace $HOME with ~
home="$HOME"
short_dir="${cwd#$home}"
if [ "$short_dir" != "$cwd" ]; then
  short_dir="~$short_dir"
fi

# Git branch (skip optional lock to avoid blocking)
git_branch=""
if [ -d "$cwd/.git" ] || git -C "$cwd" rev-parse --git-dir > /dev/null 2>&1; then
  git_branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)
fi

# Build output
# Colors: blue for dir, grey for git/user, cyan for model, yellow for context
printf '\033[38;5;75m%s\033[0m' "$short_dir"

if [ -n "$git_branch" ]; then
  printf ' \033[38;5;242m%s\033[0m' "$git_branch"
fi

if [ -n "$model" ]; then
  printf ' \033[38;5;117m%s\033[0m' "$model"
fi

if [ -n "$used_pct" ]; then
  printf ' \033[38;5;229mctx:%s%%\033[0m' "$(printf '%.0f' "$used_pct")"
fi
