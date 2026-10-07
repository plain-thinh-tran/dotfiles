#!/usr/bin/env python3
"""plain:live usage report. All times printed in UTC.

  sessions <slack-dump.txt>       parse a saved slack_read_channel dump of #dev-audit (detailed format)
  report [--from now-7d] [--env dev-uk]
                                  Datadog: invokes, fallbacks and bridge failures
"""

import argparse
import collections
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

SITE = "https://api.datadoghq.eu"
SWEEP_MIN_SERVICES = 5
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


def daily_counts(query, frm):
    body = {
        "filter": {"query": query, "from": frm, "to": "now"},
        "compute": [{"aggregation": "count", "type": "timeseries", "interval": "1d"}],
        "group_by": [{"facet": "service", "limit": 1000}],
    }
    result = {}
    for bucket in post("/api/v2/logs/analytics/aggregate", body)["data"]["buckets"]:
        series = {p["time"][:10]: int(p["value"]) for p in bucket["computes"]["c0"] if p["value"]}
        result[bucket["by"]["service"]] = series
    return result


def fetch_events(query, frm, label):
    # Some bridge failure events embed the whole Lambda event; pages above ~5 truncate mid-stream.
    events, cursor = [], None
    while True:
        body = {"filter": {"query": query, "from": frm, "to": "now"}, "page": {"limit": 5}, "sort": "timestamp"}
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
            progress(f"  {label}: {len(events)} events")
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


def print_by_service(events):
    by_service = collections.defaultdict(list)
    for event in events:
        by_service[event["service"]].append(event["ts"])
    for service, times in sorted(by_service.items(), key=lambda kv: -len(kv[1])):
        hours = len({t[:13] for t in times})
        print(f"    {service}: {len(times)} | {times[0][:16]} to {times[-1][:16]} | {hours} active hours")


def report(args):
    base = f"env:{args.env}"
    progress("invokes...")
    invokes = daily_counts(f'{base} "plain:live publishing invoke"', args.frm)
    busy = {s: v for s, v in invokes.items() if sum(v.values()) > SWEEP_MIN_SERVICES}
    quiet = sorted(s for s in invokes if s not in busy)
    print(f"## Invokes forwarded ({args.frm}): {sum(sum(v.values()) for v in invokes.values())} across {len(invokes)} services")
    for service, series in sorted(busy.items(), key=lambda kv: -sum(kv[1].values())):
        print(f"  {service}: {sum(series.values())} {series}")
    print(f"  {len(quiet)} services with <= {SWEEP_MIN_SERVICES} invokes (likely sweeps): {', '.join(quiet)}")

    progress("fallbacks...")
    fallbacks = collections.defaultdict(list)
    for event in fetch_events(f'{base} "plain:live falling back to the deployed handler"', args.frm, "fallbacks"):
        reason = re.search(r"err: \w+ \[Error\]: ([^.]{0,90})", event["msg"])
        fallbacks[(event["service"], reason.group(1) if reason else "?")].append(event["ts"][:16])
    print("\n## Fallbacks to the deployed handler")
    for (service, reason), times in sorted(fallbacks.items()):
        print(f"  {len(times)}x {service} | {reason} | {times[0]} to {times[-1]}")

    progress("bridge failures...")
    failures = fetch_events(f'{base} "plain:live bridge failed"', args.frm, "failures")
    services_per_minute = collections.defaultdict(set)
    for event in failures:
        services_per_minute[event["ts"][:16]].add(event["service"])
    sweep_minutes = {m for m, s in services_per_minute.items() if len(s) >= SWEEP_MIN_SERVICES}
    sweeps = [e for e in failures if e["ts"][:16] in sweep_minutes]
    real = [e for e in failures if e["ts"][:16] not in sweep_minutes]

    print(f"\n## Bridge failures: {len(failures)} ({len(sweeps)} in sweep minutes, {len(real)} other)")
    if sweep_minutes:
        print(f"  Sweep minutes (>= {SWEEP_MIN_SERVICES} services failing in one minute): {', '.join(sorted(sweep_minutes))}")
    by_class = collections.defaultdict(list)
    for event in real:
        name, detail = classify(event["msg"])
        by_class[(name, detail, event["phase"])].append(event)
    for (name, detail, phase), events in sorted(by_class.items(), key=lambda kv: -len(kv[1])):
        print(f"\n### {len(events)}x {name} {detail} (phase {phase})")
        print_by_service(events)


def to_utc(stamp):
    match = re.match(r"(\S+ \S+) (\w+)", stamp)
    if match is None or match.group(2) not in SLACK_TZ_OFFSETS:
        return stamp
    local = datetime.datetime.strptime(match.group(1), "%Y-%m-%d %H:%M:%S")
    return (local - datetime.timedelta(hours=SLACK_TZ_OFFSETS[match.group(2)])).strftime("%Y-%m-%dT%H:%M UTC")


def sessions(args):
    raw = open(args.dump).read()
    try:
        text = json.loads(raw)["messages"]
    except (json.JSONDecodeError, KeyError):
        text = raw
    blocks = text.split("=== Message from ")[1:]
    rows = []
    for message in blocks:
        if "plain_live" not in message:
            continue
        def field(pattern):
            match = re.search(pattern, message)
            return match.group(1).replace("`", "") if match else ""
        rows.append(" | ".join([
            to_utc(field(r"at (\S+ \S+ \w+)")),
            field(r"\*Action\*: (\S+)"),
            field(r"mailto:([^@|]+)"),
            field(r"\*Services\*: (.*)"),
            field(r"\*Origin\*: (.*)"),
            field(r"\*Git\*: (.*)"),
        ]))
    for row in rows:
        print(row)
    oldest = re.findall(r"at (\S+ \S+ \w+) ===", text)
    progress(f"{len(rows)} plain:live rows from {len(blocks)} messages; oldest message {to_utc(oldest[-1]) if oldest else 'unknown'}")
    if not blocks:
        progress("No '=== Message from' blocks: re-read the channel with the default detailed response_format")


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    parse_sessions = sub.add_parser("sessions")
    parse_sessions.add_argument("dump")
    parse_report = sub.add_parser("report")
    parse_report.add_argument("--from", dest="frm", default="now-7d")
    parse_report.add_argument("--env", default="dev-uk")
    args = parser.parse_args()
    if args.command == "sessions":
        sessions(args)
    else:
        if "DD_API_KEY" not in os.environ or "DD_APP_KEY" not in os.environ:
            sys.exit("DD_API_KEY and DD_APP_KEY must be set")
        report(args)


if __name__ == "__main__":
    main()
