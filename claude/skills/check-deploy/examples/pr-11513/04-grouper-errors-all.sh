# phase: prod
# No grouper Lambda errors since the prod deploy (covers the four lower traffic groupers too).
set -uo pipefail
start=$(date -u -r $(( PROD_DONE_MS / 1000 )) +%Y-%m-%dT%H:%M:%SZ); end=$(date -u +%Y-%m-%dT%H:%M:%SZ)
bad=()
for g in Slack Discord Nango MSTeams WorkOS; do
  e=$(aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Errors \
    --dimensions Name=FunctionName,Value=prod-uk-services-${g}WebhookHandlerMessageGrouperService \
    --start-time "$start" --end-time "$end" --period 86400 --statistics Sum --query 'Datapoints[0].Sum' --output text)
  [[ "$e" == "None" || "${e%.*}" -eq 0 ]] || bad+=("$g=$e")
done
if [[ ${#bad[@]} -eq 0 ]]; then echo "0 grouper errors since prod deploy"; else echo "grouper errors: ${bad[*]}"; exit 1; fi
