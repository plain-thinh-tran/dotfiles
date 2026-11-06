#!/usr/bin/env bash
# usage: drafter.sh <cursor|codex> <model> <rep>
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
W="$(cd "$(dirname "$0")" && pwd)"; root="$W/ws"; end=2026-11-07; previous=json/2026-10-31.json
runner="$1" model="$2" rep="$3"; tag="$runner-$model-r$rep"; out="$W/drafter/$tag"
prompt="You draft four sections of a weekly PR review newsletter. A senior reviewer (Claude Opus) checks every claim afterwards, so mark anything you could not prove from the files as unverified.
Read only: never edit files, never run anything that writes, never call GitHub.
Read in full: $root/PROMPT.md, $root/guidelines/README.md, $root/guidelines/decisions.md, $root/guidelines/decisions.json, $root/guidelines/verdict.md, $root/guidelines/shoutouts.md, $root/guidelines/improved.md, $root/guidelines/lacked.md, $root/codegen/example.json, the previous issue $root/$previous (grade nothing, it is context), and the data file $root/data/$end.json.
Draft only these fields, in the exact shape of example.json: verdict, shoutouts, improved, lacked. Tick every checklist item in each guideline file against your draft.
Every lacked item must carry claims; a claim you can only back from the data file gets status unverified and the evidence field names the exact data path you read (for example authored[3].botFindings).
Answer with one JSON object holding those four keys and nothing else: no markdown fences, no prose."
start=$(date +%s)
if [ "$runner" = cursor ]; then
  perl -e 'alarm shift; exec @ARGV' 1800 cursor-agent -p --model "$model" --mode ask --trust --output-format text --workspace "$root" "$prompt" >"$out.json" 2>"$out.log"
else
  perl -e 'alarm shift; exec @ARGV' 1800 codex exec -m "$model" -s read-only -C "$root" --ephemeral --skip-git-repo-check -o "$out.json" "$prompt" </dev/null >"$out.log" 2>&1
fi
rc=$?; secs=$(( $(date +%s) - start ))
valid=$(python3 -c "import json,sys,re;t=open('$out.json').read();t=re.sub(r'^\`\`\`(json)?|\`\`\`$','',t.strip(),flags=re.M);d=json.loads(t);print(all(k in d for k in ['verdict','shoutouts','improved','lacked']))" 2>/dev/null || echo False)
echo "{\"tag\":\"$tag\",\"rc\":$rc,\"seconds\":$secs,\"valid\":\"$valid\"}" >"$out.time.json"
echo "$tag rc=$rc ${secs}s valid=$valid"
