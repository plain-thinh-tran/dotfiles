---
description: Search Datadog APM traces/spans
argument-hint: <query> [time-range]
allowed-tools: [Bash]
---

# Datadog Traces Search

Search Datadog APM spans. The user wants to search for: $ARGUMENTS

CRITICAL: Use Python (not curl) for Datadog API calls. Curl silently drops DD- prefixed headers.

```bash
python3 -c "
import urllib.request, json, os

api_key = os.environ['DD_API_KEY']
app_key = os.environ['DD_APP_KEY']

data = json.dumps({
    'data': {
        'attributes': {
            'filter': {
                'query': '<REPLACE WITH SEARCH QUERY>',
                'from': 'now-1h',
                'to': 'now'
            },
            'sort': '-timestamp',
            'page': {'limit': 25}
        },
        'type': 'search_request'
    }
}).encode()

req = urllib.request.Request(
    'https://api.datadoghq.eu/api/v2/spans/events/search',
    data=data,
    headers={'DD-API-KEY': api_key, 'DD-APPLICATION-KEY': app_key, 'Content-Type': 'application/json'},
    method='POST'
)
resp = urllib.request.urlopen(req)
result = json.loads(resp.read())
for event in result.get('data', []):
    a = event['attributes']
    dur = a.get('duration', 0) / 1e9
    print(f\"{a.get('timestamp')} [{a.get('status')}] {a.get('service')} {a.get('resource_name')} ({dur:.3f}s)\")
    print('---')
print(f\"Total: {len(result.get('data', []))} spans\")
"
```

## Query syntax
- `service:core-graphql-api env:prod-uk` - filter by service and env
- `@http.status_code:500` - HTTP errors
- `@duration:>1000000000` - slow spans (>1s, duration in nanoseconds)
- `@error:true` - error spans
- `resource_name:"POST /graphql"` - specific resource
- Rate limit: 300 requests/hour
