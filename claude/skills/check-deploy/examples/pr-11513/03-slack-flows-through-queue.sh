# phase: prod
# Slack traffic never stops in prod, so 10 min after deploy the Slack ingest queue must have
# received messages and the grouper must be running without errors.
set -uo pipefail
since=$(( PROD_DONE_MS / 1000 ))
now=$(date +%s)
if (( now - since < 600 )); then echo "warming up ($(( (now - since) / 60 )) of 10 min)"; exit 75; fi
start=$(date -u -r "$since" +%Y-%m-%dT%H:%M:%SZ); end=$(date -u -r "$now" +%Y-%m-%dT%H:%M:%SZ)
sent=$(aws cloudwatch get-metric-statistics --namespace AWS/SQS --metric-name NumberOfMessagesSent \
  --dimensions Name=QueueName,Value=prod-uk-services-SlackWebhookHandlerMessageGrouperServiceQueue \
  --start-time "$start" --end-time "$end" --period 86400 --statistics Sum --query 'Datapoints[0].Sum' --output text)
errors=$(aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Errors \
  --dimensions Name=FunctionName,Value=prod-uk-services-SlackWebhookHandlerMessageGrouperService \
  --start-time "$start" --end-time "$end" --period 86400 --statistics Sum --query 'Datapoints[0].Sum' --output text)
echo "slack ingest sent=$sent grouper errors=$errors since prod deploy"
[[ "$sent" != "None" && "${sent%.*}" -gt 0 && ( "$errors" == "None" || "${errors%.*}" -eq 0 ) ]]
