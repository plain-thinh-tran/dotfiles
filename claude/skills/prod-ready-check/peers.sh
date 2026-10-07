#!/usr/bin/env bash
# Shared runner for the peer reviewers, sourced by review.sh and debate.sh.
# Env: CODEX_MODEL (default gpt-5.6-sol), CODEX_EFFORT (default high), GROK_MODEL (default grok-4.7-high)

peer_name() {
  case "$1" in
  codex) echo Codex ;;
  grok) echo Grok ;;
  *) echo "unknown peer: $1 (codex|grok)" >&2; return 1 ;;
  esac
}

peer_model() {
  case "$1" in
  codex) echo "${CODEX_MODEL:-gpt-5.6-sol}" ;;
  grok) echo "${GROK_MODEL:-grok-4.7-high}" ;;
  esac
}

# run_peer <peer> <repo-dir> <schema> <out-json> <log> <prompt>
run_peer() {
  local peer="$1" repo="$2" schema="$3" out="$4" log="$5" prompt="$6"
  case "$peer" in
  codex)
    command -v codex >/dev/null || { echo "codex not installed" >&2; return 1; }
    codex exec \
      -m "$(peer_model codex)" \
      -c "model_reasoning_effort=\"${CODEX_EFFORT:-high}\"" \
      -s read-only \
      -C "$repo" \
      --ephemeral \
      --output-schema "$schema" \
      -o "$out" \
      "$prompt" >"$log" 2>&1
    ;;
  grok)
    local agent
    agent="$(command -v cursor-agent || echo "$HOME/.local/bin/cursor-agent")"
    [ -x "$agent" ] || { echo "cursor-agent not installed: curl https://cursor.com/install -fsS | bash" >&2; return 1; }
    [ -n "${CURSOR_API_KEY:-}" ] || { echo "CURSOR_API_KEY not set" >&2; return 1; }
    "$agent" -p \
      --mode ask \
      --trust \
      --model "$(peer_model grok)" \
      --output-format json \
      --workspace "$repo" \
      "$prompt

Your final reply must be only one JSON object matching this JSON schema, with no prose before or after it and no code fences:
$(cat "$schema")" >"$log" 2>"${log%.log}.err"
    jq -e '.is_error == false' "$log" >/dev/null || { echo "grok run failed, see $log" >&2; return 1; }
    jq -r '.result' "$log" | python3 -I -c '
import json, sys
required = json.load(open(sys.argv[1]))["required"]
text, dec, found = sys.stdin.read(), json.JSONDecoder(), None
for i, ch in enumerate(text):
    if ch != "{":
        continue
    try:
        obj, _ = dec.raw_decode(text, i)
    except ValueError:
        continue
    if isinstance(obj, dict) and all(k in obj for k in required):
        found = obj
if found is None:
    sys.exit("no JSON object with keys %s in grok reply" % required)
json.dump(found, sys.stdout, indent=2)
' "$schema" >"$out"
    ;;
  *)
    peer_name "$peer" >/dev/null
    ;;
  esac
}
