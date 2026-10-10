#!/usr/bin/env python3
# Usage: context.py <pr-number>   (run inside a team-plain/services checkout)
# Writes .context/check-deploy/pr-<N>/ with pr.md, services.txt, checks/ and state.json.
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

pr = sys.argv[1]
root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
ctx = os.path.join(root, ".context", "check-deploy", f"pr-{pr}")
os.makedirs(os.path.join(ctx, "checks"), exist_ok=True)

info = lib.gh_json(
    "pr", "view", pr, "-R", lib.REPO,
    "--json", "number,title,body,state,mergedAt,mergeCommit,url,files",
)
if info["state"] != "MERGED":
    sys.exit(f"PR {pr} is {info['state']}, not merged")
merge_sha = info["mergeCommit"]["oid"]
files = [f["path"] for f in info["files"]]

services, shared = set(), set()
for path in files:
    m = re.match(r"lambdas/([^/]+)/", path)
    if m:
        blueprint = os.path.join(root, "lambdas", m.group(1), "blueprint.yaml")
        name = m.group(1)
        if os.path.exists(blueprint):
            found = re.search(r"^service:\s*(\S+)", open(blueprint).read(), re.M)
            name = found.group(1) if found else name
        services.add(f"{name}*")
        continue
    m = re.match(r"(?:terraform/services|services)/([^/]+)/", path)
    if m:
        services.add(f"{m.group(1)}*")
        continue
    m = re.match(r"(packages/[^/]+|infra|terraform/modules/[^/]+|terraform/catalog)/", path)
    if m:
        shared.add(m.group(1))

services_file = os.path.join(ctx, "services.txt")
if not os.path.exists(services_file):
    with open(services_file, "w") as f:
        f.write("\n".join(sorted(services)) + "\n")

with open(os.path.join(ctx, "pr.md"), "w") as f:
    f.write(f"# PR {info['number']}: {info['title']}\n\n{info['url']}\n\n")
    f.write(f"merge commit: {merge_sha}\nmerged at: {info['mergedAt']}\n\n")
    f.write("## Changed files\n\n" + "\n".join(f"- {p}" for p in files) + "\n\n")
    f.write("## Shared code touched (consumers not derived)\n\n" + ("\n".join(f"- {s}" for s in sorted(shared)) or "none") + "\n\n")
    f.write("## Description\n\n" + (info["body"] or "") + "\n")

state_file = os.path.join(ctx, "state.json")
state = json.load(open(state_file)) if os.path.exists(state_file) else {}
state.update({"pr": pr, "merge_sha": merge_sha, "merged_at": info["mergedAt"]})
run = lib.resolve_run(merge_sha)
if run is not None:
    state["run_id"] = run["databaseId"]
json.dump(state, open(state_file, "w"), indent=2)

print(f"context: {ctx}")
print(f"merge commit: {merge_sha[:10]}  deploy run: {state.get('run_id', 'not found yet')}")
print(f"services.txt: {', '.join(sorted(services)) or 'none derived'}")
print(f"shared code: {', '.join(sorted(shared)) or 'none'}")
