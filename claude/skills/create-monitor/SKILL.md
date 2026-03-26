---
name: create-monitor
description: Create a Datadog monitor with standardized formatting, actionable alerts, and proper Slack notifications. Use when user wants to create, update, or review Datadog monitors.
allowed-tools: Bash, Read, Grep, Glob
---

# Create Datadog Monitor

Create clean, actionable Datadog monitors with standardized Slack notifications.

## Guiding Principles

- **Actionable over informative.** Every alert must tell the responder what to do, not just what happened.
- **Discuss before creating.** If you're unsure whether the alert makes sense, is too noisy, or has the right threshold — discuss it with the user first.
- **Use the custom webhook.** Always route to `@webhook-Datadog-To-Slack` — this goes through the datadog-to-slack Lambda for priority formatting, ack tracking, and daily summaries.
- **Less is more.** Hide metrics, queries, and tags from Slack. The responder needs next steps and links, not raw data.

## Pre-flight Questions

Before creating a monitor, confirm these with the user if not specified:

1. **What metric/condition?** — The specific metric, threshold, and evaluation window
2. **Priority level?** — P1 (Critical), P2 (High), or P3 (Low)
3. **Who to notify?** — Which Slack channel and whether to tag `@platform-team`
4. **Is this actionable?** — Can the responder actually do something when this fires? If not, reconsider the alert

## API Setup

Always use Python with `urllib` to call the Datadog API. Never use curl (it drops DD- headers).

```python
import json, os, urllib.request

SITE = os.environ.get('DD_SITE', 'api.datadoghq.eu')
DD_APP = 'https://app.datadoghq.eu'
API_KEY = os.environ['DD_API_KEY']
APP_KEY = os.environ['DD_APP_KEY']
```

## Monitor Standards

### Naming Convention

Clean names without environment prefixes. Use template variables for the affected resource:

| Resource | Template Variable | Example Name |
|----------|------------------|--------------|
| Lambda function | `{{service.name}}` | `High Error Rate on {{service.name}}` |
| API Gateway | `{{apiname.name}}` | `API Gateway 5XX on {{apiname.name}}` |
| DynamoDB table | `{{tablename.name}}` | `DynamoDB Throttling on {{tablename.name}}` |
| RDS instance | `{{dbinstanceidentifier.name}}` | `RDS CPU High on {{dbinstanceidentifier.name}}` |
| SQS queue | `{{queuename.name}}` | `SQS DLQ Messages on {{queuename.name}}` |
| APM route | `{{resource_name.name}}` | `High Error Rate on {{resource_name.name}}` |
| Service (logs) | `{{service.name}}` | `Log Error Spike on {{service.name}}` |

**IMPORTANT:** For Lambda monitors, always use `service` tag (not `functionname`) in both queries and names. The `service` tag gives human-readable names like `chat-unread-messages-handler` instead of `prod-uk-services-chatunreadmessageshandler`.

### Message Template

```
{{#is_alert}}
<Priority Label>

<One sentence describing what happened and its impact.>

**Next steps:**
- [<Link text>](<Datadog URL>)
- [<Link text>](<Datadog URL>)
- <Plain text action item if needed>

<@platform-team tag for P1 only>
@webhook-Datadog-To-Slack
{{/is_alert}}
```

Rules:
- **Alert only** — Never include `{{#is_recovery}}`, `{{#is_warning}}`, or `{{#is_no_data}}` blocks
- **Priority label** on the first line: `P1 (Critical)`, `P2 (High)`, or `P3 (Low)`
- **One-sentence description** — what broke and what's the user impact
- **Next steps** — 2-3 actionable items with Datadog links
- **Links** — Only `app.datadoghq.eu` links. Never AWS console links. Common patterns:
  - Logs: `https://app.datadoghq.eu/logs?query=env%3Aprod-uk%20status%3Aerror%20service%3A{{service.name}}&live=true`
  - Serverless: `https://app.datadoghq.eu/functions?cloud=aws&entity_type=lambda_function&query=service%3A{{service.name}}`
  - APM traces: `https://app.datadoghq.eu/apm/traces?query=env%3Aprod-uk%20status%3Aerror&live=true`
  - Integration dashboards: `https://app.datadoghq.eu/dash/integration/<integration_name>`
- **Team tag** — Only for P1: `<!subteam^S091CQDA35G>` (this is the `@platform-team` Slack user group)
- **No "View this monitor" links** — The Slack notification title already links to the monitor. Never add a self-link.
- **Channel** — Always `@webhook-Datadog-To-Slack`. This routes through the datadog-to-slack Lambda, not directly to Slack

### Required Options

Every monitor must set these options:

```python
"options": {
    "notification_preset_name": "hide_all",  # Hides query, metric value, tags from Slack
    "include_tags": False,                    # No tag metadata in notification
    "notify_audit": False,
    # ... threshold-specific options
}
```

**CRITICAL: Datadog API gotcha** — When updating monitor options with PUT, you MUST always send BOTH `notification_preset_name` and `include_tags` together. Datadog's PUT merges options shallowly, so sending only one field can reset the other to its default (`include_tags` defaults to `true`). Always include both in every update call.

### Priority Levels

| Priority | When to use | Team tag? |
|----------|-------------|-----------|
| P1 (Critical) | Service down, data loss risk, customer-facing impact | Yes — `<!subteam^S091CQDA35G>` |
| P2 (High) | Degraded performance, elevated errors, needs attention soon | No |
| P3 (Low) | Informational, investigate when convenient | No |

## Creating a Monitor

### Full Example: Lambda Error Rate Monitor

```python
import json, os, urllib.request

SITE = os.environ.get('DD_SITE', 'api.datadoghq.eu')
DD_APP = 'https://app.datadoghq.eu'

payload = {
    "name": "High Error Rate on {{service.name}}",
    "type": "query alert",
    "query": "sum(last_15m):sum:aws.lambda.errors{env:prod-uk} by {service}.as_count() / sum:aws.lambda.invocations{env:prod-uk} by {service}.as_count() >= 0.1",
    "message": "{{#is_alert}}\nP2 (High)\n\nLambda function **{{service.name}}** has more than {{eval \"threshold * 100\"}}% error rate in the last 15 minutes.\n\n**Next steps:**\n- [View error logs](" + DD_APP + "/logs?query=env%3Aprod-uk%20status%3Aerror%20service%3A{{service.name}}&live=true)\n- [View function in Serverless](" + DD_APP + "/functions?cloud=aws&entity_type=lambda_function&query=service%3A{{service.name}})\n- Check for recent deployments that may have introduced regressions\n\n@webhook-Datadog-To-Slack\n{{/is_alert}}",
    "tags": [],  # Keep empty — tags show in Slack notifications even with include_tags=false
    "priority": 2,
    "options": {
        "thresholds": {"critical": 0.1},
        "notification_preset_name": "hide_all",
        "include_tags": False,
        "notify_no_data": False,
        "notify_audit": False,
        "new_group_delay": 60,
        "evaluation_delay": 300,
    },
}

data = json.dumps(payload).encode()
req = urllib.request.Request(
    f"https://{SITE}/api/v1/monitor",
    data=data, method="POST",
    headers={
        "Content-Type": "application/json",
        "DD-API-KEY": os.environ["DD_API_KEY"],
        "DD-APPLICATION-KEY": os.environ["DD_APP_KEY"],
    },
)
resp = urllib.request.urlopen(req)
result = json.loads(resp.read())
print(f"Created monitor {result['id']}: {result['name']}")
```

## Updating a Monitor

Use PUT to update. Only include fields you want to change:

```python
payload = {"message": new_message, "options": {"notification_preset_name": "hide_all"}}
req = urllib.request.Request(
    f"https://{SITE}/api/v1/monitor/{monitor_id}",
    data=json.dumps(payload).encode(), method="PUT",
    headers={...},
)
```

## Promoting to Production (N/A — webhook handles routing)

All monitors go directly to `@webhook-Datadog-To-Slack`. The datadog-to-slack Lambda routes to `#notif-datadog-tests` channel internally. No promotion step needed.

1. No promotion needed — `@webhook-Datadog-To-Slack` is already the final destination
2. Verify: `GET /api/v1/monitor/{id}` and confirm the message

## Testing a Monitor

To trigger a test alert for metric monitors:

1. Submit metric data above the threshold using `POST /api/v1/series`
2. Wait ~90s for evaluation
3. Check monitor state: `GET /api/v1/monitor/{id}` — look at `overall_state`
4. Check Slack channel for the notification
5. To reset: submit values below threshold, wait for recovery, then re-trigger

## Checklist Before Creating

- [ ] Is this alert actionable? Can the responder do something?
- [ ] Is the threshold reasonable? Not too noisy, not too lenient?
- [ ] Are the Datadog links correct and useful?
- [ ] Is the priority level appropriate?
- [ ] Is the description concise and clear?
- [ ] Using `@webhook-Datadog-To-Slack` in the message?
- [ ] `notification_preset_name: hide_all` set?
- [ ] `include_tags: false` set?
- [ ] No recovery block?
- [ ] Team tag only if P1?

## Common Query Patterns

```python
# Lambda error rate (by service)
"sum(last_15m):sum:aws.lambda.errors{env:prod-uk} by {service}.as_count() / sum:aws.lambda.invocations{env:prod-uk} by {service}.as_count() >= 0.1"

# Lambda throttle rate (by service)
"sum(last_15m):sum:aws.lambda.throttles{env:prod-uk} by {service}.as_count() / (sum:aws.lambda.throttles{env:prod-uk} by {service}.as_count() + sum:aws.lambda.invocations{env:prod-uk} by {service}.as_count()) >= 0.2"

# Lambda OOM (by service)
"avg(last_15m):sum:aws.lambda.enhanced.out_of_memory{env:prod-uk} by {service} > 0"

# Lambda p95 duration (by service)
"avg(last_15m):p95:aws.lambda.enhanced.duration{env:prod-uk} by {service} > 5000"

# SQS queue age of oldest message (all queues, multi-alert by queuename)
# Button URL: https://app.datadoghq.eu/metric/explorer?live=false&q.0.metric=aws.sqs.approximate_age_of_oldest_message&q.0.scope=queuename%3A{{queuename.name}}&q.0.aggr=max
"min(last_5m):max:aws.sqs.approximate_age_of_oldest_message{queuename:*_dlq} by {queuename} > 60"

# SQS queue backlog
"avg(last_15m):avg:aws.sqs.approximate_number_of_messages_visible{!queuename:*_dlq} by {queuename} > 1000"

# Log error spike (by service)
'logs("env:prod-uk status:error").index("*").rollup("count").by("service").last("5m") > 500'

# APM route error rate
"sum(last_15m):sum:trace.express.request.errors{env:prod-uk} by {resource_name}.as_count() / sum:trace.express.request.hits{env:prod-uk} by {resource_name}.as_count() >= 0.1"

# RDS CPU
"avg(last_15m):avg:aws.rds.cpuutilization{*} by {dbinstanceidentifier} > 80"

# API Gateway 5XX rate
"sum(last_15m):sum:aws.apigateway.5xxerror{*} by {apiname,stage}.as_count() / sum:aws.apigateway.count{*} by {apiname,stage}.as_count() >= 0.1"

# Anomaly detection on Lambda errors
'avg(last_1h):anomalies(sum:aws.lambda.errors{env:prod-uk} by {version,service}.as_count(), "basic", 2, direction="both", interval=20, alert_window="last_5m", count_default_zero="true") >= 1'
```
