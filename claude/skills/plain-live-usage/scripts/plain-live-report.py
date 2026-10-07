#!/usr/bin/env python3
"""plain:live usage report.

  sessions <slack-dump.txt>       parse a saved slack_read_channel dump of #dev-audit
  report [--from now-7d] [--env dev-uk]
                                  Datadog: invokes, fallbacks and bridge failures
"""

import argparse
import collections
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

SITE = "https://api.datadoghq.eu"
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
        "group_by": [{"facet": "service", "limit": 100}],
    }
    result = {}
    for bucket in post("/api/v2/logs/analytics/aggregate", body)["data"]["buckets"]:
        series = {p["time"][:10]: int(p["value"]) for p in bucket["computes"]["c0"] if p["value"]}
        result[bucket["by"]["service"]] = series
    return result


def fetch_events(query, frm):
    # Some bridge failure events embed the whole Lambda event; pages above ~5 truncate mid-stream.
    events, cursor = [], None
    while True:
        body = {"filter": {"query": query, "from": frm, "to": "now"}, "page": {"limit": 5}, "sort": "timestamp"}
        if cursor is not None:
            body["page"]["cursor"] = cursor
        page = post("/api/v2/logs/events/search", body)
        for item in page["data"]:
            attributes = item["attributes"]
            events.append({
                "service": attributes.get("service"),
                "ts": attributes.get("timestamp"),
                "msg": attributes.get("message", "")[:4000],
            })
        cursor = page.get("meta", {}).get("page", {}).get("after")
        if cursor is None:
            return events


def classify(message):
    phase = re.search(r"phase: '([^']+)'", message)
    for name, pattern in ERROR_CLASSES:
        match = re.search(pattern, message)
        if match is not None:
            detail = match.group(1) if match.groups() else ""
            return name, detail, phase.group(1) if phase else "?"
    first = re.search(r"err: (.{0,100})", message)
    return "other", first.group(1) if first else message[:100], phase.group(1) if phase else "?"


def report(args):
    base = f"env:{args.env}"
    print(f"## Invokes forwarded per service per day ({args.frm})")
    for service, series in sorted(daily_counts(f'{base} "plain:live publishing invoke"', args.frm).items()):
        print(f"  {service}: {series}")

    print("\n## Fallbacks to the deployed handler")
    fallbacks = collections.defaultdict(list)
    for event in fetch_events(f'{base} "plain:live falling back to the deployed handler"', args.frm):
        reason = re.search(r"err: \w+ \[Error\]: ([^.]{0,90})", event["msg"])
        fallbacks[(event["service"], reason.group(1) if reason else "?")].append(event["ts"][:16])
    for (service, reason), times in sorted(fallbacks.items()):
        print(f"  {len(times)}x {service} | {reason} | {times[0]} to {times[-1]}")

    failures = fetch_events(f'{base} "plain:live bridge failed"', args.frm)
    print(f"\n## Bridge failures: {len(failures)}")
    by_class = collections.defaultdict(list)
    for event in failures:
        name, detail, phase = classify(event["msg"])
        by_class[(name, detail, phase)].append(event)
    for (name, detail, phase), events in sorted(by_class.items(), key=lambda kv: -len(kv[1])):
        hours = collections.Counter((e["ts"][:13], e["service"]) for e in events)
        print(f"\n### {len(events)}x {name} {detail} (phase {phase})")
        for (hour, service), count in sorted(hours.items())[:20]:
            print(f"    {hour}h {service}: {count}")
        if len(hours) > 20:
            print(f"    ... {len(hours) - 20} more hour/service rows")


def sessions(args):
    raw = open(args.dump).read()
    try:
        text = json.loads(raw)["messages"]
    except (json.JSONDecodeError, KeyError):
        text = raw
    for message in text.split("=== Message from ")[1:]:
        if "plain_live" not in message:
            continue
        def field(pattern):
            match = re.search(pattern, message)
            return match.group(1).replace("`", "") if match else ""
        print(" | ".join([
            field(r"at (\S+ \S+)"),
            field(r"\*Action\*: (\S+)"),
            field(r"mailto:([^@|]+)"),
            field(r"\*Services\*: (.*)"),
            field(r"\*Origin\*: (.*)"),
            field(r"\*Git\*: (.*)"),
        ]))


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
