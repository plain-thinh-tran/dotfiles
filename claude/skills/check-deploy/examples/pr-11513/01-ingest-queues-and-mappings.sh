# phase: prod
# Each grouper has its OpenTofu ingest queue and an Enabled event source mapping on it.
set -uo pipefail
bad=()
for g in Slack Discord Nango MSTeams WorkOS; do
  fn="prod-uk-services-${g}WebhookHandlerMessageGrouperService"
  q="prod-uk-services-${g}WebhookHandlerMessageGrouperServiceQueue"
  state=$(aws lambda list-event-source-mappings --function-name "$fn" --query "EventSourceMappings[?ends_with(EventSourceArn, ':$q')].State | [0]" --output text 2>&1)
  [[ "$state" == "Enabled" ]] || bad+=("$g:$state")
done
if [[ ${#bad[@]} -eq 0 ]]; then echo "5/5 ingest mappings Enabled"; else echo "not Enabled: ${bad[*]}"; exit 1; fi
