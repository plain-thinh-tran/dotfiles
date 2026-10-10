#!/usr/bin/env python3
# Usage: tick.py <ctx-dir>
# One deterministic round: pipeline, Datadog Error Tracking, PR checks.
# Prints a status block; "ATTENTION ..." lines appear once per new problem.
# Exit: 0 keep watching, 10 done and healthy, 11 deploy run failed.
# A check exiting 75 is WARM (not ready to judge yet): not a failure, but the tick is not clean.
import fnmatch
import glob
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

SOAK_MINUTES = int(os.environ.get("CHECK_DEPLOY_SOAK_MINUTES", "15"))
CLEAN_TICKS = 3
CHECK_TIMEOUT = 90
LOOKBACK_MS = 5 * 60 * 1000

ctx = os.path.abspath(sys.argv[1])
state_file = os.path.join(ctx, "state.json")
state = json.load(open(state_file))
state.setdefault("alerted", [])
state.setdefault("clean_streak", 0)
services = [s.strip() for s in open(os.path.join(ctx, "services.txt")) if s.strip() and not s.startswith("#")]
now_ms = int(time.time() * 1000)
lines, attention, current_keys = [], [], set()


def alert(key, text):
    current_keys.add(key)
    if key not in state["alerted"]:
        state["alerted"].append(key)
        attention.append(f"ATTENTION {text}")


def save():
    json.dump(state, open(state_file, "w"), indent=2)


run = None
if "run_id" in state:
    run = lib.pipeline(state["run_id"])
    if run["conclusion"] == "cancelled":
        run = None
if run is None:
    found = lib.resolve_run(state["merge_sha"])
    if found is None:
        print(f"TICK {time.strftime('%H:%M')} waiting: no deploy run contains {state['merge_sha'][:10]} yet")
        save()
        sys.exit(0)
    state["run_id"] = found["databaseId"]
    run = lib.pipeline(state["run_id"])

if run["failed"]:
    stage = "failed"
elif run["prod_done_ms"]:
    stage = "prod-uk deployed"
elif run["prod_start_ms"]:
    stage = "prod-uk deploying"
elif run["dev_start_ms"]:
    stage = "dev-uk"
else:
    stage = "building"

for f in run["failed"]:
    alert(f"pipeline:{state['run_id']}:{f['job']}", f"pipeline job failed: {f['job']} / {f['step']} {f['url']}")

flagged_ours, flagged_other = 0, 0
for env, start in (("prod-uk", run["prod_start_ms"]),):
    if start is None:
        continue
    try:
        by_id = {i["id"]: i for i in lib.error_issues(env, start - LOOKBACK_MS, now_ms)}
        for svc in services:
            by_id.update({i["id"]: i for i in lib.error_issues(env, start - LOOKBACK_MS, now_ms, f"service:{svc}")})
        issues = list(by_id.values())
    except RuntimeError as e:
        lines.append(f"errors {env}: lookup failed: {e}")
        continue
    env_ours, env_other = 0, 0
    for i in issues:
        new = (i["first_seen_ms"] or 0) >= start or i["first_seen_version"] == run["head_sha"]
        if not new:
            continue
        ours = any(fnmatch.fnmatch(i["service"], s) for s in services)
        env_ours += ours
        env_other += not ours
        kind = "ours" if ours else "other"
        alert(
            f"error:{i['id']}",
            f"error {kind} {env} {i['service']} x{i['count']} {i['error_type']}: {i['message']} {i['url']}",
        )
    flagged_ours += env_ours
    flagged_other += env_other
    lines.append(f"errors {env}: {len(issues)} active, new since deploy: ours={env_ours} other={env_other}")

check_results = []
for path in sorted(glob.glob(os.path.join(ctx, "checks", "*.sh"))):
    name = os.path.basename(path)
    header = open(path).read(400)
    phase = "always" if "# phase: always" in header else "prod"
    if phase == "prod" and not run["prod_done_ms"]:
        check_results.append((name, "WAIT", "runs after prod-uk deploys"))
        continue
    env = dict(os.environ, AWS_PROFILE="prod-uk-claude-read-only", AWS_REGION="eu-west-2", CTX=ctx,
               DD=os.path.join(os.path.dirname(os.path.abspath(__file__)), "dd.py"),
               PROD_START_MS=str(run["prod_start_ms"] or ""), PROD_DONE_MS=str(run["prod_done_ms"] or ""))
    try:
        out = subprocess.run(["bash", path], capture_output=True, text=True, env=env, timeout=CHECK_TIMEOUT)
        evidence = (out.stdout.strip().splitlines() or [out.stderr.strip()[:200]])[-1][:200]
        result = {0: "PASS", 75: "WARM"}.get(out.returncode, "FAIL")
    except subprocess.TimeoutExpired:
        result, evidence = "FAIL", f"timed out after {CHECK_TIMEOUT}s"
    check_results.append((name, result, evidence))
    if result == "FAIL":
        alert(f"check:{name}", f"check failed {name}: {evidence}")

state["alerted"] = [k for k in state["alerted"] if not k.startswith("check:") or k in current_keys]

clean = not run["failed"] and flagged_ours == 0 and flagged_other == 0 and all(r in ("PASS", "WAIT") for _, r, _ in check_results)
state["clean_streak"] = state["clean_streak"] + 1 if (clean and run["prod_done_ms"]) else 0

print(f"TICK {time.strftime('%H:%M')} run {state['run_id']} {run['status']} {run['conclusion']} stage={stage} clean={state['clean_streak']}/{CLEAN_TICKS}")
if run["running"]:
    print(f"running: {', '.join(run['running'])}")
for line in lines:
    print(line)
for name, result, evidence in check_results:
    print(f"check {result} {name}: {evidence}")
for line in attention:
    print(line)
save()

if run["status"] == "completed" and run["conclusion"] != "success":
    print(f"DONE deploy run {run['conclusion']} {run['url']}")
    sys.exit(11)
soaked = run["prod_done_ms"] and now_ms - run["prod_done_ms"] >= SOAK_MINUTES * 60 * 1000
if run["status"] == "completed" and soaked and state["clean_streak"] >= CLEAN_TICKS:
    print(f"DONE healthy: prod-uk deployed {SOAK_MINUTES}+ min ago, {state['clean_streak']} clean ticks")
    sys.exit(10)
sys.exit(0)
