---
description: Query Datadog metrics
argument-hint: <metric-query> [time-range]
allowed-tools: [Bash]
---

# Datadog Metrics Query

Query Datadog metrics. The user wants to query: $ARGUMENTS

CRITICAL: Use Python (not curl) for Datadog API calls. Curl silently drops DD- prefixed headers.

```bash
python3 -c "
import urllib.request, json, os, time
from urllib.parse import quote

api_key = os.environ['DD_API_KEY']
app_key = os.environ['DD_APP_KEY']

now = int(time.time())
from_ts = now - 3600

query = '<REPLACE WITH METRIC QUERY>'
url = f'https://api.datadoghq.eu/api/v1/query?from={from_ts}&to={now}&query={quote(query)}'

req = urllib.request.Request(url, headers={'DD-API-KEY': api_key, 'DD-APPLICATION-KEY': app_key})
resp = urllib.request.urlopen(req)
result = json.loads(resp.read())

for s in result.get('series', []):
    points = s.get('pointlist', [])
    vals = [p[1] for p in points if p[1] is not None]
    print(f\"Metric: {s.get('expression')}\")
    print(f\"Points: {len(points)}, Min: {min(vals):.2f}, Max: {max(vals):.2f}, Avg: {sum(vals)/len(vals):.2f}, Latest: {vals[-1]:.2f}\")
    print('---')
"
```

## Query syntax
- `avg:system.cpu.user{service:houston}` - CPU by service
- `sum:aws.lambda.invocations{functionname:my-func}.as_count()` - invocations
- `avg:trace.express.request.duration{service:houston}` - request duration
- Aggregations: `avg`, `sum`, `min`, `max`, `count`
- Time: default 1h, adjust `from_ts = now - <seconds>`
