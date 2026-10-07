#!/usr/bin/env python3
"""plain:live usage report. All times printed in UTC.

  sessions <slack-dump.txt> [--day YYYY-MM-DD | --all]
      Parse a saved slack_read_channel dump of #dev-audit (detailed format): one row per
      session start plus a per dev summary. Defaults to sessions started today (local day).
  report --sessions <slack-dump.txt> [--day YYYY-MM-DD] [--repo <services checkout>] [--env dev-uk]
  report --from now-7d [--sessions <slack-dump.txt>] [--repo <services checkout>]
      Datadog invokes, fallbacks and bridge failures. By default the window runs from the first
      session started on --day (today) to the end of that day. --from switches to a rolling
      window. Each failing service lists the devs whose sessions could have caused it, and with
      --repo its blueprint trigger.
"""

import argparse
import collections
import datetime
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

SITE = "https://api.datadoghq.eu"
SWEEP_MIN_SERVICES = 3
QUIET_MAX_INVOKES = 5
SWEEP_PAD = datetime.timedelta(minutes=5)
ATTRIBUTION_LOOKBACK = datetime.timedelta(hours=24)
SLACK_TZ_OFFSETS = {"CEST": 2, "CET": 1, "BST": 1, "GMT": 0, "UTC": 0}
ERROR_CLASSES = [
    ("env-missing", r"Environment variable (\w+) not found"),
    ("no-local-worker-timeout", r"Timed out waiting for local plain:live response"),
    ("session-replaced", r"active session is"),
    ("worker-restarted", r"restarted before the invocation completed"),
    ("worker-stopped", r"Worker for \w+ stopped"),
    ("sns-routing-missing", r"routing message attribute"),
    ("zod", r"ZodError"),
    ("unauthorized", r"Unauthorized"),
    ("handler-threw", r'internal_error: "Error handling'),
    ("type-error", r"TypeError"),
]


def progress(text):
    print(text, file=sys.stderr, flush=True)


def parse_ts(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)


def post(path, body):
    headers = {
        "DD-API-KEY": os.environ["DD_API_KEY"],
        "DD-APPLICATION-KEY": os.environ["DD_APP_KEY"],
        "Content-Type": "application/json",
    }
    for attempt in range(8):
        request = urllib.request.Request(SITE + path, data=json.dumps(body).encode(), headers=headers)
        try:
            return json.load(urllib.request.urlopen(request, timeout=60))
        except urllib.error.HTTPError as error:
            if error.code != 429:
                raise
            time.sleep(10 * (attempt + 1))
        except Exception:
            time.sleep(5)
    raise RuntimeError(f"Datadog request failed after retries: {path}")


def aggregate(query, window, interval=None):
    compute = {"aggregation": "count"}
    if interval is not None:
        compute.update({"type": "timeseries", "interval": interval})
    body = {
        "filter": {"query": query, "from": window[0], "to": window[1]},
        "compute": [compute],
        "group_by": [{"facet": "service", "limit": 1000}],
    }
    return post("/api/v2/logs/analytics/aggregate", body)["data"]["buckets"]


def invoke_counts(query, window, interval):
    width = 13 if interval == "1h" else 10
    result = {}
    for bucket in aggregate(query, window, interval):
        result[bucket["by"]["service"]] = {p["time"][:width]: int(p["value"]) for p in bucket["computes"]["c0"] if p["value"]}
    return result


def fetch_events(query, window, label):
    total = sum(int(b["computes"]["c0"]) for b in aggregate(query, window))
    # Some bridge failure events embed the whole Lambda event; pages above ~5 truncate mid-stream.
    events, cursor = [], None
    while True:
        body = {"filter": {"query": query, "from": window[0], "to": window[1]}, "page": {"limit": 5}, "sort": "timestamp"}
        if cursor is not None:
            body["page"]["cursor"] = cursor
        page = post("/api/v2/logs/events/search", body)
        for item in page["data"]:
            attributes = item["attributes"]
            message = attributes.get("message", "")
            phase = re.search(r"phase: '([^']+)'", message)
            events.append({
                "service": attributes.get("service"),
                "ts": attributes.get("timestamp"),
                "phase": phase.group(1) if phase else "?",
                "msg": message[:4000],
            })
        if len(events) % 100 < 5:
            progress(f"  {label}: {len(events)}/{total}")
        cursor = page.get("meta", {}).get("page", {}).get("after")
        if cursor is None:
            return events


def classify(message):
    for name, pattern in ERROR_CLASSES:
        match = re.search(pattern, message)
        if match is not None:
            return name, match.group(1) if match.groups() else ""
    first = re.search(r"err: (.{0,100})", message)
    return "other", first.group(1) if first else message[:100]


def service_id_to_name(service_id):
    stem = re.sub(r"Service$", "", service_id)
    return re.sub(r"(?<!^)(?=[A-Z])", "-", stem).lower()


def read_blueprints(repo):
    by_name = {}
    for path in glob.glob(os.path.join(repo, "lambdas", "*", "blueprint.yaml")):
        text = open(path).read()
        name = re.search(r"^service: (\S+)", text, re.M)
        trigger = re.search(r"^triggers:\s*\n {2}(\w+):", text, re.M)
        if name is not None:
            by_name[name.group(1)] = trigger.group(1) if trigger else "?"
    return by_name


def parse_sessions(dump):
    raw = open(dump).read()
    try:
        text = json.loads(raw)["messages"]
    except (json.JSONDecodeError, KeyError):
        text = raw
    blocks = text.split("=== Message from ")[1:]
    rows = []
    for message in blocks:
        if "plain_live_session_started" not in message:
            continue
        def field(pattern):
            match = re.search(pattern, message)
            return match.group(1).replace("`", "").strip() if match else ""
        start = to_utc(field(r"at (\S+ \S+ \w+)"))
        rows.append({
            "start": start,
            "dev": field(r"mailto:([^@|]+)"),
            "service_ids": [s.strip() for s in field(r"\*Services\*: (.*)").split(",") if s.strip()],
            "origin": normalize_origin(field(r"\*Origin\*: (.*)")),
            "git": field(r"\*Git\*: (.*)"),
        })
    oldest = re.findall(r"at (\S+ \S+ \w+) ===", text)
    progress(f"{len(rows)} session starts from {len(blocks)} messages; oldest message {to_utc(oldest[-1]).isoformat() if oldest else 'unknown'}")
    if not blocks:
        progress("No '=== Message from' blocks: re-read the channel with the default detailed response_format")
    return sorted(rows, key=lambda r: r["start"])


def normalize_origin(origin):
    if origin.startswith("Cursor cloud agent"):
        return "cloud-agent"
    return origin if origin != "" else "unknown"


def to_utc(stamp):
    match = re.match(r"(\S+ \S+) (\w+)", stamp)
    local = datetime.datetime.strptime(match.group(1), "%Y-%m-%d %H:%M:%S")
    return local - datetime.timedelta(hours=SLACK_TZ_OFFSETS.get(match.group(2), 0))


def print_sessions(rows):
    print("## Session starts (UTC)")
    for row in rows:
        print(f"  {row['start']:%Y-%m-%d %H:%M} | {row['dev']} | {row['origin']} | {', '.join(row['service_ids'])} | {row['git']}")
    print("\n## Per dev")
    by_dev = collections.defaultdict(list)
    for row in rows:
        by_dev[row["dev"]].append(row)
    for dev, starts in sorted(by_dev.items(), key=lambda kv: -len(kv[1])):
        origins = collections.Counter(r["origin"] for r in starts)
        services = sorted({s for r in starts for s in r["service_ids"]})
        branches = sorted({r["git"].split(" @ ")[0] for r in starts})
        churn = sum(1 for a, b in zip(starts, starts[1:]) if b["start"] - a["start"] <= datetime.timedelta(minutes=15))
        print(f"  {dev}: {len(starts)} starts {dict(origins)} | {starts[0]['start']:%m-%d %H:%M} to {starts[-1]['start']:%m-%d %H:%M} | restarts within 15 min: {churn}")
        print(f"    services: {', '.join(services)}")
        print(f"    branches: {', '.join(branches)}")


def sweep_windows(failures):
    services_per_minute = collections.defaultdict(set)
    for event in failures:
        services_per_minute[event["ts"][:16]].add(event["service"])
    minutes = sorted(parse_ts(m + ":00") for m, s in services_per_minute.items() if len(s) >= SWEEP_MIN_SERVICES)
    windows = []
    for minute in minutes:
        if windows and minute - windows[-1][1] <= 2 * SWEEP_PAD:
            windows[-1][1] = minute
        else:
            windows.append([minute, minute])
    return [(start - SWEEP_PAD, end + SWEEP_PAD + datetime.timedelta(minutes=1)) for start, end in windows]


def candidates(service, events, sessions):
    forwarding = [s for s in sessions if service in {service_id_to_name(i) for i in s["service_ids"]}]
    per_dev = collections.Counter()
    unmatched = 0
    for event in events:
        at = parse_ts(event["ts"])
        devs = {s["dev"] for s in forwarding if at - ATTRIBUTION_LOOKBACK <= s["start"] <= at}
        if not devs:
            unmatched += 1
        for dev in devs:
            per_dev[dev] += 1
    parts = [f"{dev}:{count}" for dev, count in per_dev.most_common()]
    if unmatched:
        parts.append(f"no audit session:{unmatched}")
    return ", ".join(parts)


def print_failure_class(events, sessions, triggers):
    by_service = collections.defaultdict(list)
    for event in events:
        by_service[event["service"]].append(event)
    for service, service_events in sorted(by_service.items(), key=lambda kv: -len(kv[1])):
        hourly = collections.Counter(e["ts"][5:13] for e in service_events)
        trigger = f" [{triggers.get(service, '?')}]" if triggers else ""
        print(f"    {service}{trigger}: {len(service_events)} | {service_events[0]['ts'][:16]} to {service_events[-1]['ts'][:16]}")
        print(f"      hourly: {' '.join(f'{h}h:{n}' for h, n in sorted(hourly.items()))}")
        if sessions is not None:
            print(f"      candidates: {candidates(service, service_events, sessions)}")


def local_day_bounds(day):
    local_tz = datetime.datetime.now().astimezone().tzinfo
    start = datetime.datetime.combine(datetime.date.fromisoformat(day), datetime.time(), local_tz)
    to_naive_utc = lambda value: value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return to_naive_utc(start), to_naive_utc(start + datetime.timedelta(days=1))


def sessions_on(rows, day):
    start, end = local_day_bounds(day)
    return [r for r in rows if start <= r["start"] < end]


def iso(value):
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def resolve_window(args, sessions):
    if args.frm is not None:
        return (args.frm, "now"), sessions, "1d"
    if sessions is None:
        sys.exit("Pass --sessions <dump> (window = today's sessions) or --from <range>")
    todays = sessions_on(sessions, args.day)
    if not todays:
        sys.exit(f"No plain:live session starts on {args.day} in the dump")
    _, day_end = local_day_bounds(args.day)
    end = min(day_end, datetime.datetime.utcnow())
    return (iso(todays[0]["start"]), iso(end)), todays, "1h"


def report(args):
    sessions = parse_sessions(args.sessions) if args.sessions else None
    triggers = read_blueprints(args.repo) if args.repo else {}
    window, shown, interval = resolve_window(args, sessions)
    progress(f"window {window[0]} to {window[1]}")
    if shown is not None:
        print_sessions(shown)
        print()

    base = f"env:{args.env}"
    progress("invokes...")
    invokes = invoke_counts(f'{base} "plain:live publishing invoke"', window, interval)
    busy = {s: v for s, v in invokes.items() if sum(v.values()) > QUIET_MAX_INVOKES}
    quiet = sorted(s for s in invokes if s not in busy)
    print(f"## Invokes forwarded ({window[0]} to {window[1]}, per {interval}): {sum(sum(v.values()) for v in invokes.values())} across {len(invokes)} services")
    for service, series in sorted(busy.items(), key=lambda kv: -sum(kv[1].values())):
        print(f"  {service}: {sum(series.values())} {series}")
    print(f"  {len(quiet)} services with <= {QUIET_MAX_INVOKES} invokes (likely sweeps)")

    progress("fallbacks...")
    fallbacks = collections.defaultdict(list)
    for event in fetch_events(f'{base} "plain:live falling back to the deployed handler"', window, "fallbacks"):
        reason = re.search(r"err: \w+ \[Error\]: ([^.]{0,90})", event["msg"])
        fallbacks[(event["service"], reason.group(1) if reason else "?")].append(event["ts"][:16])
    print("\n## Fallbacks to the deployed handler")
    for (service, reason), times in sorted(fallbacks.items()):
        print(f"  {len(times)}x {service} | {reason} | {times[0]} to {times[-1]}")

    progress("bridge failures...")
    failures = fetch_events(f'{base} "plain:live bridge failed"', window, "failures")
    windows = sweep_windows(failures)
    in_sweep = lambda e: any(start <= parse_ts(e["ts"]) <= end for start, end in windows)
    sweeps = [e for e in failures if in_sweep(e)]
    real = [e for e in failures if not in_sweep(e)]

    print(f"\n## Bridge failures: {len(failures)} ({len(sweeps)} in sweeps, {len(real)} other)")
    if sessions is not None:
        print("  candidates = failures per dev who started a session forwarding that service in the 24h before each failure")
    for start, end in windows:
        inside = [e for e in sweeps if start <= parse_ts(e["ts"]) <= end]
        classes = collections.Counter(classify(e["msg"])[0] for e in inside)
        print(f"  Sweep {start:%m-%d %H:%M} to {end:%H:%M}: {len(inside)} failures on {len({e['service'] for e in inside})} services {dict(classes)}")

    by_class = collections.defaultdict(list)
    for event in real:
        name, detail = classify(event["msg"])
        by_class[(name, detail, event["phase"])].append(event)
    for (name, detail, phase), events in sorted(by_class.items(), key=lambda kv: -len(kv[1])):
        print(f"\n### {len(events)}x {name} {detail} (phase {phase})")
        print_failure_class(events, sessions, triggers)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    parse_sessions_cmd = sub.add_parser("sessions")
    parse_sessions_cmd.add_argument("dump")
    parse_sessions_cmd.add_argument("--day", default=datetime.date.today().isoformat())
    parse_sessions_cmd.add_argument("--all", action="store_true")
    parse_report = sub.add_parser("report")
    parse_report.add_argument("--day", default=datetime.date.today().isoformat())
    parse_report.add_argument("--from", dest="frm")
    parse_report.add_argument("--env", default="dev-uk")
    parse_report.add_argument("--sessions")
    parse_report.add_argument("--repo")
    args = parser.parse_args()
    if args.command == "sessions":
        rows = parse_sessions(args.dump)
        print_sessions(rows if args.all else sessions_on(rows, args.day))
        return
    if "DD_API_KEY" not in os.environ or "DD_APP_KEY" not in os.environ:
        sys.exit("DD_API_KEY and DD_APP_KEY must be set")
    report(args)


if __name__ == "__main__":
    main()
