#!/usr/bin/env bash
# Clones and installs team-plain/shipvideo-local (renderer, Playwright, ffmpeg) once.
set -euo pipefail
dir="${SHIPVIDEO_DIR:-$HOME/workspace/shipvideo-local}"
if [ ! -d "$dir/.git" ]; then
  (unset GH_TOKEN; gh repo clone team-plain/shipvideo-local "$dir" -- --depth 1)
fi
cd "$dir"
[ -d node_modules ] || pnpm install --frozen-lockfile
pnpm exec playwright-core install chromium-headless-shell >/dev/null
echo "$dir"
