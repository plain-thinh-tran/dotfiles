---
description: Search Datadog logs
argument-hint: <query> [time-range]
allowed-tools: [Bash]
---

# Datadog Logs Search

Search Datadog logs. The user wants to search for: $ARGUMENTS

CRITICAL: Use Python (not curl) for Datadog API calls. Curl silently drops DD- prefixed headers.

```bash
python3 -c "
import urllib.request, json, os

api_key = os.environ['DD_API_KEY']
app_key = os.environ['DD_APP_KEY']

data = json.dumps({
    'filter': {
        'query': '<REPLACE WITH SEARCH QUERY>',
        'from': 'now-1h',
        'to': 'now',
        'indexes': ['*']
    },
    'sort': '-timestamp',
    'page': {'limit': 25}
}).encode()

req = urllib.request.Request(
    'https://api.datadoghq.eu/api/v2/logs/events/search',
    data=data,
    headers={'DD-API-KEY': api_key, 'DD-APPLICATION-KEY': app_key, 'Content-Type': 'application/json'},
    method='POST'
)
resp = urllib.request.urlopen(req)
result = json.loads(resp.read())
for event in result.get('data', []):
    a = event['attributes']
    print(f\"{a.get('timestamp')} [{a.get('status')}] {a.get('service')}: {str(a.get('message',''))[:200]}\")
    print('---')
print(f\"Total: {len(result.get('data', []))} logs\")
"
```

## Query syntax
- `service:core-graphql-api env:prod-uk` - filter by service and environment
- `status:error` or `status:warn` - filter by status
- `@http.status_code:500` - filter by attribute
- Time ranges: default `now-1h`, use `now-30m`, `now-24h`, `now-7d` etc.
- Paginate using `meta.page.after` cursor from response
