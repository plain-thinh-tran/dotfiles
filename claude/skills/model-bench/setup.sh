#!/usr/bin/env bash
# Build isolated case repos and build packet copies from a local services clone.
# Usage: setup.sh <workdir>   Env: SERVICES_DIR (default ~/workspace/services)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
W="${1:?workdir required}"
S="${SERVICES_DIR:-$HOME/workspace/services}"
mkdir -p "$W/repos"
W="$(cd "$W" && pwd)"

clone() {
  local name="$1" sha="$2" d="$W/repos/$1"
  [ -d "$d/.git" ] && return
  git -C "$S" cat-file -e "$sha^{commit}" 2>/dev/null || command git -C "$S" fetch -q origin main
  git init -q "$d"
  git -C "$d" fetch -q --depth 2 "file://$S" "$sha"
  git -C "$d" checkout -q FETCH_HEAD
}

clone caseA "$(jq -r .sha "$DIR/cases/A.json")"
clone caseB "$(jq -r .sha "$DIR/cases/B.json")"
if ! git -C "$W/repos/caseB" log -1 --format=%cn | grep -q '^lab$'; then
  git -C "$W/repos/caseB" apply "$DIR/cases/B.plant.patch"
  git -C "$W/repos/caseB" -c user.name=lab -c user.email=lab@localhost commit -qa --amend --no-edit
fi

for c in A B; do
  mkdir -p "$W/case$c"
  command git -C "$W/repos/case$c" diff HEAD~1 HEAD >"$W/case$c/diff.patch"
  command git -C "$W/repos/case$c" log -1 --format=%B >"$W/case$c/summary.md"
done

# build <packet> <tag>: fresh copy of the packet's case repo for one worker, with its own offline install.
# Never symlink node_modules from $S: a worker running pnpm install would rewrite the real checkout.
build() {
  local p="$1" tag="$2" case d
  case="$(jq -r ".packets.$p" "$DIR/cases/packets.json")"
  d="$W/build/$p-$tag"
  rm -rf "$d"
  mkdir -p "$W/build"
  cp -c -R "$W/repos/case$case" "$d"
  (cd "$d" && pnpm install --frozen-lockfile --offline --ignore-scripts >"$d.install.log" 2>&1) || { echo "install failed, see $d.install.log" >&2; return 1; }
  echo "$d"
}

if [ "${2:-}" = build ]; then
  build "${3:?packet}" "${4:?tag}"
fi
echo "ready: $W"
