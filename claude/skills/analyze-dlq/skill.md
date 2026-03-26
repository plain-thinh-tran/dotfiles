---
name: analyze-dlq
description: Analyze DLQ (Dead Letter Queue) messages for a service. Use when user asks to investigate, analyze, or look at a DLQ, dead letter queue, or failed messages.
allowed-tools: Bash, Read, Glob, Grep, Agent, mcp__datadog-mcp__search_datadog_logs, mcp__datadog-mcp__analyze_datadog_logs
user-intent: research
---

# Analyze DLQ

Investigate Dead Letter Queue messages to diagnose why messages are failing. This is an **analysis-only** workflow — no fixes, no implementation, no redriving. Produce a diagnosis and report findings directly to the user.

**IMPORTANT**: This is a research/investigation task. Do NOT enter plan mode or propose a plan. Just investigate and report findings inline.

## Critical Rules

- **Analysis only** — Do NOT implement fixes, redrive messages, or take any corrective action. Your job is to investigate and report.
- **No plan mode** — Do NOT create a plan file or enter plan mode. Present findings directly to the user as text output.
- **Always start by reading the service code** — Before touching any DLQ message, understand the service's types, handlers, and message flow.
- **Use `plain-internal-cli` to inspect DLQ messages** — This is the primary tool. Fall back to AWS CLI only if it fails.
- **Trace correlationIds through Datadog** — If messages contain a `correlationId`, use the Datadog MCP to find all related logs for the full processing story.

## Workflow

### 1. Identify the service

Determine which service the DLQ belongs to based on the queue name. The queue name usually maps to a service directory under `services/` or a stack in `infra/stacks/`.

Tell the user: "Investigating DLQ for service: <service-name>"

### 2. Read the service codebase

Read and understand:
- The handler that processes messages from the queue (look in `services/<service>/` and the corresponding stack in `infra/stacks/`)
- The types/schemas for expected message payloads (usually in a `types.ts` file)
- The message flow: where messages come from, how they're parsed, what processing happens
- Any relevant aggregate functions called by the handler

Use the Explore agent if needed for broader codebase understanding.

### 3. Peek at DLQ messages

**Primary: Use `plain-internal-cli`**

The CLI lives at `plain-internal-cli/` in the repo root. Run commands from that directory:

```bash
cd plain-internal-cli && NODE_ENV=development npx tsx src/cli.ts ops peek-queue <queue-name>
```

For non-prod stages, add `--stage <stage>`:
```bash
cd plain-internal-cli && NODE_ENV=development npx tsx src/cli.ts ops peek-queue --stage devlocal <queue-name>
```

Useful flags:
- `--ugly` — raw JSON output, useful for piping to `python3 -m json.tool` or `jq`
- `-v` / `--verbose` — debug logs

To discover available queues:
```bash
cd plain-internal-cli && NODE_ENV=development npx tsx src/cli.ts ops list-queues
```

To peek at an S3-referenced payload:
```bash
cd plain-internal-cli && NODE_ENV=development npx tsx src/cli.ts ops peek-queue-message <s3Key>
```

**Fallback: AWS CLI (if plain-internal-cli fails)**

Two-step process — get the queue URL first, then use it:

```bash
# Step 1: Get queue URL
aws sqs get-queue-url --queue-name <dlq-queue-name> --profile prod-uk

# Step 2: Get message count
aws sqs get-queue-attributes \
  --queue-url "<queue-url-from-step-1>" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --profile prod-uk

# Step 3: Peek at messages (visibility-timeout 0 keeps them available)
aws sqs receive-message \
  --queue-url "<queue-url-from-step-1>" \
  --max-number-of-messages 10 \
  --visibility-timeout 0 \
  --profile prod-uk
```

**IMPORTANT**: `get-queue-attributes` requires `--queue-url`, NOT `--queue-name`. You must get the URL first.

Parse raw SQS output with python for readability:
```bash
aws sqs receive-message --queue-url "<url>" --max-number-of-messages 10 --visibility-timeout 0 --profile prod-uk 2>&1 \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for i, msg in enumerate(data.get('Messages', [])):
    body = json.loads(msg['Body'])
    detail = body.get('detail', {})
    payload = detail.get('payload', {})
    print(f'=== Message {i+1} ===')
    print(f'  Time: {body.get(\"time\")}')
    print(f'  Event type: {body.get(\"detail-type\")}')
    print(f'  Event ID: {detail.get(\"eventId\")}')
    print(f'  Workspace ID: {detail.get(\"workspaceId\")}')
    print(f'  Correlation ID: {detail.get(\"plainCorrelationId\")}')
    print(json.dumps(payload, indent=2)[:500])
    print()
"
```

Note the number of messages, their shapes, and any common patterns. Deduplicate by event ID — the same event may appear multiple times due to SQS retries.

### 4. Inspect payload structure

Messages may reference payloads stored in S3 — fetch them with the CLI or AWS CLI:

```bash
# Using plain-internal-cli
cd plain-internal-cli && NODE_ENV=development npx tsx src/cli.ts ops peek-queue-message <s3Key>

# Using AWS CLI
aws s3 cp s3://<bucket>/<key> - --profile prod-uk | python3 -m json.tool
```

Identify:
- What data shape is in the failing messages
- Are all messages failing for the same reason or different reasons
- What fields are present/missing compared to what the schema expects

### 5. Trace with Datadog

If messages contain a `correlationId` (or similar trace identifier):
- Use the Datadog MCP to search logs for that correlationId
- Look for error logs, parse failures, or exception traces
- Identify the exact point of failure in the processing pipeline

Also search for:
- Error patterns in the service's logs around the time DLQ messages appeared
- Any spike in error rates or changes in log patterns

### 6. Check recent code changes

```bash
git log --oneline --since="7 days ago" -- services/<service-name>/
git log --oneline --since="7 days ago" -- packages/<relevant-packages>/
```

Look for:
- Schema changes that might have introduced incompatibilities
- New message types being handled (or no longer being handled)
- Changes to parsing, validation, or event routing logic
- PRs that correlate with when DLQ messages started appearing

Cross-reference deployment timestamps with when errors first appeared in Datadog.

### 7. Report findings

Present a structured analysis directly to the user (NOT as a plan file):

1. **DLQ Overview** — How many messages, time range, common patterns
2. **Root Cause** — What exactly is causing messages to fail (with evidence)
3. **Trigger** — What change or event caused this to start (PR, deployment, external data change)
4. **Impact** — What functionality is affected, which customers/workspaces
5. **Suggested Fix** — What needs to change to resolve the issue (describe, don't implement)
6. **Redriveability** — Whether DLQ messages can be redriven after a fix, or if they need manual intervention
