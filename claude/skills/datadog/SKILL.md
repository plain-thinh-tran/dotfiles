---
name: datadog
description: Query Datadog logs, metrics, APM traces, dashboards, and monitors via the API. Use when asked to search logs, check metrics, investigate traces, or manage monitors.
---

# Datadog Skill

Query Datadog using the Python CLI at `scripts/datadog-api.py` (relative to this skill directory, installed at `~/.claude/skills/datadog/scripts/datadog-api.py`).

Requires `DD_API_KEY` and `DD_APP_KEY` env vars. Site: `api.datadoghq.eu`.

## Commands

```bash
# Logs
python3 ~/.claude/skills/datadog/scripts/datadog-api.py logs "<query>" [--from now-1h] [--to now] [--limit 25]

# Metrics
python3 ~/.claude/skills/datadog/scripts/datadog-api.py metrics "<query>" [--seconds-ago 3600]

# APM traces
python3 ~/.claude/skills/datadog/scripts/datadog-api.py traces "<query>" [--from now-1h] [--to now]

# Monitors
python3 ~/.claude/skills/datadog/scripts/datadog-api.py monitors list [--name <substr>] [--tags <tags>]
python3 ~/.claude/skills/datadog/scripts/datadog-api.py monitors get <id>
```

## Notes

- Always use `DD_API_KEY` from env — never hardcode keys
- For log queries use Datadog search syntax: `service:my-service @field:value`
- Default time range is last 1 hour
