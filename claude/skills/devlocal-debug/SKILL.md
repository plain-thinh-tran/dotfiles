---
name: devlocal-debug
description: Deploy to devlocal, invoke Lambdas with test events, and monitor Datadog logs for troubleshooting. Use when debugging Lambda behavior, checking log fields, or verifying fixes in an isolated environment.
license: MIT
metadata:
  author: thinh-tran
  version: "1.1"
allowed-tools: Bash, Read, Skill
---

# Devlocal Debug Skill

Deploy a service to devlocal, invoke its Lambda directly, and monitor Datadog logs to verify runtime behavior.

## 1. Deploy to devlocal

**IMPORTANT:** Check AWS SSO session first. If expired, run `aws sso login --profile devlocal`.

```bash
DATADOG_ENABLED=true AWS_PROFILE=devlocal pnpm sst:deploy --stage devlocal
```

To deploy a specific stack only (much faster — use this when possible):
```bash
DATADOG_ENABLED=true AWS_PROFILE=devlocal pnpm sst:deploy --stage devlocal <StackName>
```

A full deploy can timeout on large codebases. Always prefer deploying a specific stack.

Key environment notes:
- `DATADOG_ENABLED=true` enables Datadog logging
- devlocal sets `PLAIN_LOG_SAMPLE_RATE=1` (all logs written, no sampling)
- Datadog env tag: `devlocal-<username>` (e.g., `devlocal-thinh-tran`)

## 2. Find Lambda function names

After deployment, find the exact function name:

```bash
AWS_PROFILE=devlocal aws lambda list-functions --region eu-west-2 \
  --query "Functions[?contains(FunctionName, '<SEARCH_TERM>')].FunctionName" --output text
```

Lambda naming convention: `devlocal-services-<LambdaId>` (e.g., `devlocal-services-MSTeamsSyncPostsHandler`).
The `LambdaId` is defined in the infra stack (e.g., `msTeamsSyncStack.ts`).

## 3. Invoke Lambda with a test event

### Create the test event file

Place test events inside the workspace at `.context/test-event.json` (gitignored).
Do NOT use `/tmp/` — the Write tool cannot write outside the workspace.

### SQS-triggered Lambdas

```json
{
  "Records": [{
    "messageId": "test-debug-001",
    "body": "<JSON-stringified message body>",
    "eventSource": "aws:sqs",
    "eventSourceARN": "arn:aws:sqs:eu-west-2:000000000000:test",
    "awsRegion": "eu-west-2"
  }]
}
```

The `body` field should contain the message the handler expects. Check the handler's message schema
(typically in `packages/messages/src/messages/`).

For SNS-wrapped messages (SNS->SQS subscription without `rawMessageDelivery`), wrap in SNS envelope:
```json
{
  "body": "{\"Message\": \"<escaped-inner-message>\", \"MessageAttributes\": {\"plainCorrelationId\": {\"Type\": \"String\", \"Value\": \"test-corr-id\"}}}"
}
```

### Invoke

**CRITICAL:** Use `--cli-binary-format raw-in-base64-out` with AWS CLI v2. Without it, you get
`Invalid UTF-8 middle byte` errors.

```bash
AWS_PROFILE=devlocal aws lambda invoke \
  --function-name <FUNCTION_NAME> \
  --invocation-type RequestResponse \
  --cli-binary-format raw-in-base64-out \
  --payload file://<ABSOLUTE_PATH_TO_EVENT_JSON> \
  --region eu-west-2 \
  <WORKSPACE>/.context/response.json && cat <WORKSPACE>/.context/response.json
```

The handler may error (no real data) — that's expected. Focus on whether logs were produced.

### EventBridge-triggered Lambdas

```json
{
  "detail-type": "domain.entity.event_name",
  "source": "test",
  "detail": {
    "plainCorrelationId": "test-corr-id",
    "payload": {}
  }
}
```

### Cron-triggered Lambdas

```json
{}
```

## 4. Monitor Datadog logs

Use the `dd-logs` skill to search for logs from the devlocal environment:

```
service:<service-name> env:devlocal*
```

To check for specific fields:
```
@plainCorrelationId:* service:<service-name> env:devlocal*
```

To find the service name for a Lambda: it's the kebab-case version of the Lambda ID
(e.g., `MSTeamsSyncPostsHandler` -> `msteams-sync-posts-handler`).

Allow 1-2 minutes after Lambda invocation for logs to appear in Datadog.

## 5. Troubleshooting checklist

1. **AWS SSO expired?** Run `aws sso login --profile devlocal` before deploying or invoking
2. **Full deploy timeout?** Deploy only the specific stack: append `<StackName>` to the deploy command
3. **`Invalid UTF-8 middle byte` on invoke?** Add `--cli-binary-format raw-in-base64-out`
4. **Can't write test event to /tmp?** Use `.context/` directory inside the workspace instead
5. **No logs at all?** Check deployment succeeded, function name is correct, and `DATADOG_ENABLED=true` was set
6. **Logs exist but missing a field?** The field is not being set at runtime — investigate the code path
7. **Handler errors?** Expected with fake data. Focus on whether logs appeared and contained the expected fields
8. **Sampling dropping logs?** devlocal uses `PLAIN_LOG_SAMPLE_RATE=1`, so all logs should appear. Verify: `aws lambda get-function-configuration --function-name <NAME> --region eu-west-2 --query "Environment.Variables.PLAIN_LOG_SAMPLE_RATE"`
