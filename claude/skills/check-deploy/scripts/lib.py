import calendar
import json
import os
import subprocess
import time
import urllib.error
import urllib.request

REPO = "team-plain/services"
DD_SITE = "https://api.datadoghq.eu"

DEV_START_JOBS = ("Deploy plain services dev-uk",)
PROD_START_JOBS = ("Deploy plain services prod-uk", "Deploy plain services prod-uk (fast track)")
PROD_DONE_JOBS = ("Promote plain service aliases prod-uk", "Promote plain service aliases prod-uk (fast track)")


def gh(*args):
    env = {k: v for k, v in os.environ.items() if k != "GH_TOKEN"}
    out = subprocess.run(["gh", *args], capture_output=True, text=True, env=env)
    if out.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)}: {out.stderr.strip()}")
    return out.stdout


def gh_json(*args):
    return json.loads(gh(*args))


def contains_commit(head_sha, merge_sha):
    if head_sha == merge_sha:
        return True
    cmp = gh_json("api", f"repos/{REPO}/compare/{merge_sha}...{head_sha}")
    return cmp["status"] in ("ahead", "identical")


def resolve_run(merge_sha):
    runs = gh_json(
        "run", "list", "-R", REPO, "--workflow=deploy.yml", "--branch", "main", "--limit", "15",
        "--json", "databaseId,headSha,status,conclusion,createdAt",
    )
    for run in sorted(runs, key=lambda r: r["createdAt"]):
        if run["conclusion"] == "cancelled":
            continue
        if contains_commit(run["headSha"], merge_sha):
            return run
    return None


def iso_to_ms(iso):
    if not iso or iso.startswith("0001"):
        return None
    return calendar.timegm(time.strptime(iso, "%Y-%m-%dT%H:%M:%SZ")) * 1000


def pipeline(run_id):
    run = gh_json("run", "view", str(run_id), "-R", REPO, "--json", "status,conclusion,headSha,url,jobs")
    jobs = run["jobs"]

    def started(names):
        times = [iso_to_ms(j.get("startedAt")) for j in jobs if j["name"] in names and j.get("conclusion") != "skipped"]
        times = [t for t in times if t is not None]
        return min(times) if times else None

    prod_done = None
    for j in jobs:
        if j["name"] in PROD_DONE_JOBS and j.get("conclusion") == "success":
            prod_done = iso_to_ms(j.get("completedAt"))

    failed = []
    for j in jobs:
        if j.get("conclusion") in ("failure", "timed_out", "startup_failure"):
            step = next((s["name"] for s in j.get("steps", []) if s.get("conclusion") == "failure"), "")
            failed.append({"job": j["name"], "step": step, "url": j.get("url", "")})

    running = [j["name"] for j in jobs if j["status"] in ("in_progress", "queued", "waiting", "pending")]
    return {
        "status": run["status"],
        "conclusion": run.get("conclusion") or "",
        "head_sha": run["headSha"],
        "url": run["url"],
        "dev_start_ms": started(DEV_START_JOBS),
        "prod_start_ms": started(PROD_START_JOBS),
        "prod_done_ms": prod_done,
        "failed": failed,
        "running": running,
    }


def dd_keys():
    api = os.environ.get("DD_API_KEY")
    app = os.environ.get("DD_APP_KEY") or os.environ.get("DD_APPLICATION_KEY")
    if not api or not app:
        raise RuntimeError("DD_API_KEY and DD_APP_KEY (or DD_APPLICATION_KEY) must be set")
    return api, app


def dd_post(path, body):
    api, app = dd_keys()
    req = urllib.request.Request(
        f"{DD_SITE}{path}",
        data=json.dumps(body).encode(),
        headers={"DD-API-KEY": api, "DD-APPLICATION-KEY": app, "Content-Type": "application/json"},
    )
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Datadog {path} {e.code}: {e.read()[:300]!r}") from e


def error_issues(env, since_ms, until_ms=None, extra_query=""):
    until_ms = until_ms or int(time.time() * 1000)
    issues = {}
    for track in ("logs", "trace"):
        body = {
            "data": {
                "type": "search_request",
                "attributes": {"query": f"env:{env} {extra_query}".strip(), "from": since_ms, "to": until_ms, "track": track, "persona": "BACKEND"},
            }
        }
        res = dd_post("/api/v2/error-tracking/issues/search?include=issue", body)
        counts = {d["id"]: d["attributes"].get("total_count", 0) for d in res.get("data", [])}
        for inc in res.get("included", []):
            if inc.get("type") != "issue":
                continue
            a = inc["attributes"]
            issues[inc["id"]] = {
                "id": inc["id"],
                "track": track,
                "service": a.get("service", ""),
                "error_type": a.get("error_type", ""),
                "message": (a.get("error_message") or "")[:200],
                "first_seen_ms": a.get("first_seen"),
                "first_seen_version": a.get("first_seen_version", ""),
                "state": a.get("state", ""),
                "count": counts.get(inc["id"], 0),
                "url": f"https://app.datadoghq.eu/error-tracking/issue/{inc['id']}",
            }
    return list(issues.values())


def logs_count(query, since_ms, until_ms=None):
    until_ms = until_ms or int(time.time() * 1000)
    body = {
        "filter": {"query": query, "from": str(since_ms), "to": str(until_ms)},
        "compute": [{"aggregation": "count"}],
    }
    res = dd_post("/api/v2/logs/analytics/aggregate", body)
    buckets = res.get("data", {}).get("buckets", [])
    return int(buckets[0]["computes"]["c0"]) if buckets else 0
