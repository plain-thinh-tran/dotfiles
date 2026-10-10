#!/usr/bin/env python3
# Datadog helpers for PR checks. Prints one value. Exit 75 when Datadog stays rate limited
# after retries (the check reads as WARM), any other non-zero exit on API failure.
#   dd.py logs-count '<log query>' <since-ms>     → number of matching logs since since-ms
#   dd.py errors <env> <since-ms>                 → Error Tracking issues as JSON lines
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

cmd = sys.argv[1]
try:
    if cmd == "logs-count":
        print(lib.logs_count(sys.argv[2], int(sys.argv[3])))
    elif cmd == "errors":
        for issue in lib.error_issues(sys.argv[2], int(sys.argv[3])):
            print(json.dumps(issue))
    else:
        sys.exit(f"unknown command {cmd}")
except lib.RateLimited as e:
    print(f"datadog rate limited: {e}")
    sys.exit(75)
