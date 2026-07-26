#!/usr/bin/env python3
"""
Datadog API CLI - Search logs, query metrics, search APM traces,
view/create dashboards, and view monitors.

Requires DD_API_KEY and DD_APP_KEY environment variables.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


SITE = os.environ.get("DD_SITE", "api.datadoghq.eu")


def get_keys():
    api_key = os.environ.get("DD_API_KEY")
    app_key = os.environ.get("DD_APP_KEY")
    missing = []
    if not api_key:
        missing.append(
            "DD_API_KEY is not set. Copy the existing 'Developer API Key' from:\n"
            "  https://app.datadoghq.eu/organization-settings/api-keys"
        )
    if not app_key:
        missing.append(
            "DD_APP_KEY is not set. Create a new application key at:\n"
            "  https://app.datadoghq.eu/organization-settings/application-keys"
        )
    if missing:
        print("Error: Missing required environment variables:\n", file=sys.stderr)
        for msg in missing:
            print(f"  - {msg}\n", file=sys.stderr)
        sys.exit(1)
    return api_key, app_key


def dd_request(method, path, api_key, app_key, data=None):
    """Make a request to the Datadog API."""
    url = f"https://{SITE}{path}"
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "DD-API-KEY": api_key,
            "DD-APPLICATION-KEY": app_key,
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        resp = urllib.request.urlopen(req)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        print(f"Error: HTTP {e.code} from Datadog API", file=sys.stderr)
        try:
            print(json.dumps(json.loads(error_body), indent=2), file=sys.stderr)
        except json.JSONDecodeError:
            print(error_body, file=sys.stderr)
        sys.exit(1)


def cmd_logs(args):
    """Search Datadog logs."""
    api_key, app_key = get_keys()
    data = {
        "filter": {
            "query": args.query,
            "from": args.from_time,
            "to": args.to_time,
            "indexes": ["*"],
        },
        "sort": args.sort,
        "page": {"limit": args.limit},
    }
    if args.cursor:
        data["page"]["cursor"] = args.cursor
    result = dd_request("POST", "/api/v2/logs/events/search", api_key, app_key, data)
    print(json.dumps(result, indent=2))


def cmd_metrics(args):
    """Query Datadog metrics."""
    api_key, app_key = get_keys()
    now = int(time.time())
    from_ts = now - args.seconds_ago
    query = urllib.parse.quote(args.query)
    path = f"/api/v1/query?from={from_ts}&to={now}&query={query}"
    result = dd_request("GET", path, api_key, app_key)
    print(json.dumps(result, indent=2))


def cmd_traces(args):
    """Search Datadog APM spans."""
    api_key, app_key = get_keys()
    page = {"limit": args.limit}
    if args.cursor:
        page["cursor"] = args.cursor
    data = {
        "data": {
            "attributes": {
                "filter": {
                    "query": args.query,
                    "from": args.from_time,
                    "to": args.to_time,
                },
                "sort": args.sort,
                "page": page,
            },
            "type": "search_request",
        }
    }
    result = dd_request(
        "POST", "/api/v2/spans/events/search", api_key, app_key, data
    )
    print(json.dumps(result, indent=2))


def cmd_dashboards(args):
    """List, get, or create Datadog dashboards."""
    api_key, app_key = get_keys()
    if args.action == "list":
        result = dd_request("GET", "/api/v1/dashboard", api_key, app_key)
        print(json.dumps(result, indent=2))
    elif args.action == "get":
        result = dd_request(
            "GET", f"/api/v1/dashboard/{args.id}", api_key, app_key
        )
        print(json.dumps(result, indent=2))
    elif args.action == "create":
        widgets = json.loads(args.widgets_json)
        data = {
            "title": args.title,
            "layout_type": args.layout_type,
            "widgets": widgets,
        }
        if args.description:
            data["description"] = args.description
        result = dd_request("POST", "/api/v1/dashboard", api_key, app_key, data)
        print(json.dumps(result, indent=2))


def cmd_monitors(args):
    """List, get, or create Datadog monitors."""
    api_key, app_key = get_keys()
    if args.action == "list":
        params = {}
        if args.name:
            params["name"] = args.name
        if args.tags:
            params["tags"] = args.tags
        if args.page_size:
            params["page_size"] = str(args.page_size)
        query_string = urllib.parse.urlencode(params)
        path = f"/api/v1/monitor?{query_string}" if query_string else "/api/v1/monitor"
        result = dd_request("GET", path, api_key, app_key)
        print(json.dumps(result, indent=2))
    elif args.action == "get":
        result = dd_request(
            "GET", f"/api/v1/monitor/{args.id}", api_key, app_key
        )
        print(json.dumps(result, indent=2))
    elif args.action == "create":
        data = {
            "name": args.name,
            "type": args.type,
            "query": args.query,
            "message": args.message or "",
            "tags": json.loads(args.tags_json) if args.tags_json else [],
            "options": {
                "thresholds": {"critical": args.critical},
                "notify_no_data": args.notify_no_data,
                "renotify_interval": args.renotify_interval,
            },
        }
        if args.warning is not None:
            data["options"]["thresholds"]["warning"] = args.warning
        result = dd_request("POST", "/api/v1/monitor", api_key, app_key, data)
        monitor_id = result.get("id")
        print(f"Created monitor {monitor_id}")
        print(f"URL: https://app.datadoghq.eu/monitors/{monitor_id}")
        print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Datadog API CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Logs subcommand
    logs_parser = subparsers.add_parser("logs", help="Search logs")
    logs_parser.add_argument("query", help="Datadog log search query")
    logs_parser.add_argument(
        "--from",
        dest="from_time",
        default="now-1h",
        help="Start time (default: now-1h)",
    )
    logs_parser.add_argument(
        "--to", dest="to_time", default="now", help="End time (default: now)"
    )
    logs_parser.add_argument(
        "--limit", type=int, default=25, help="Max results (default: 25)"
    )
    logs_parser.add_argument(
        "--sort", default="-timestamp", help="Sort order (default: -timestamp)"
    )
    logs_parser.add_argument(
        "--cursor", help="Pagination cursor from previous response"
    )

    # Metrics subcommand
    metrics_parser = subparsers.add_parser("metrics", help="Query metrics")
    metrics_parser.add_argument("query", help="Datadog metrics query")
    metrics_parser.add_argument(
        "--seconds-ago",
        type=int,
        default=3600,
        help="Lookback in seconds (default: 3600)",
    )

    # Traces subcommand
    traces_parser = subparsers.add_parser("traces", help="Search APM traces/spans")
    traces_parser.add_argument("query", help="Datadog span search query")
    traces_parser.add_argument(
        "--from",
        dest="from_time",
        default="now-1h",
        help="Start time (default: now-1h)",
    )
    traces_parser.add_argument(
        "--to", dest="to_time", default="now", help="End time (default: now)"
    )
    traces_parser.add_argument(
        "--limit", type=int, default=25, help="Max results (default: 25)"
    )
    traces_parser.add_argument(
        "--sort", default="-timestamp", help="Sort order (default: -timestamp)"
    )
    traces_parser.add_argument(
        "--cursor", help="Pagination cursor from previous response"
    )

    # Dashboards subcommand
    dash_parser = subparsers.add_parser(
        "dashboards", help="List, get, or create dashboards"
    )
    dash_sub = dash_parser.add_subparsers(dest="action", required=True)

    dash_sub.add_parser("list", help="List all dashboards")

    dash_get = dash_sub.add_parser("get", help="Get a dashboard by ID")
    dash_get.add_argument("id", help="Dashboard ID")

    dash_create = dash_sub.add_parser("create", help="Create a dashboard")
    dash_create.add_argument("--title", required=True, help="Dashboard title")
    dash_create.add_argument(
        "--layout-type",
        default="ordered",
        help="Layout type: ordered or free (default: ordered)",
    )
    dash_create.add_argument(
        "--widgets-json",
        required=True,
        help="JSON string of the widgets array",
    )
    dash_create.add_argument("--description", help="Dashboard description")

    # Monitors subcommand
    mon_parser = subparsers.add_parser("monitors", help="List or get monitors")
    mon_sub = mon_parser.add_subparsers(dest="action", required=True)

    mon_list = mon_sub.add_parser("list", help="List monitors")
    mon_list.add_argument("--name", help="Filter by monitor name (substring match)")
    mon_list.add_argument("--tags", help="Comma-separated tags filter")
    mon_list.add_argument(
        "--page-size", type=int, default=100, help="Results per page (default: 100)"
    )

    mon_get = mon_sub.add_parser("get", help="Get a monitor by ID")
    mon_get.add_argument("id", help="Monitor ID")

    mon_create = mon_sub.add_parser("create", help="Create a monitor")
    mon_create.add_argument("--name", required=True, help="Monitor name")
    mon_create.add_argument(
        "--type",
        required=True,
        help='Monitor type (e.g. "query alert", "trace-analytics alert", "log alert")',
    )
    mon_create.add_argument("--query", required=True, help="Monitor query")
    mon_create.add_argument("--message", help="Alert message (supports @mentions and {{variables}})")
    mon_create.add_argument("--critical", type=float, required=True, help="Critical threshold")
    mon_create.add_argument("--warning", type=float, help="Warning threshold")
    mon_create.add_argument("--tags-json", help='JSON array of tags (e.g. \'["env:prod","team:billing"]\')')
    mon_create.add_argument("--notify-no-data", action="store_true", help="Alert on no data")
    mon_create.add_argument("--renotify-interval", type=int, default=0, help="Renotify interval in minutes (0 = off)")

    args = parser.parse_args()
    if args.command == "logs":
        cmd_logs(args)
    elif args.command == "metrics":
        cmd_metrics(args)
    elif args.command == "traces":
        cmd_traces(args)
    elif args.command == "dashboards":
        cmd_dashboards(args)
    elif args.command == "monitors":
        cmd_monitors(args)


if __name__ == "__main__":
    main()
