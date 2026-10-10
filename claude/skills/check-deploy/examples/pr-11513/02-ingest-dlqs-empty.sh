# phase: prod
# Grouper failures land in these DLQs; any message means webhooks are not being ingested.
set -uo pipefail
bad=()
for g in Slack Discord Nango MSTeams WorkOS; do
  url="https://sqs.eu-west-2.amazonaws.com/465335901885/prod-uk-services-${g}WebhookHandlerMessageGrouperServiceQueue_dlq"
  n=$(aws sqs get-queue-attributes --queue-url "$url" --attribute-names ApproximateNumberOfMessages --query Attributes.ApproximateNumberOfMessages --output text 2>&1)
  [[ "$n" == "0" ]] || bad+=("$g=$n")
done
if [[ ${#bad[@]} -eq 0 ]]; then echo "5/5 ingest DLQs empty"; else echo "DLQ messages: ${bad[*]}"; exit 1; fi
