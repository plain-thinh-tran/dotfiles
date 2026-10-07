---
name: plain-live-usage
description: Audit how devs use plain:live and what breaks for them, from #dev-audit session starts, Datadog bridge logs and Slack feedback. Use when asked about plain:live usage, adoption, errors, efficiency or feedback.
---

# plain:live Usage Audit

Research only: report findings, file nothing until the user asks. `scripts/plain-live-report.py` (next to this file, use its absolute path) does the deterministic gathering and prints all times in UTC; your work is attribution and root cause.

## Steps

1. **Report, in the background.** Start `python3 <skill>/scripts/plain-live-report.py report --from now-7d > /tmp/plain-live-report.txt` with `run_in_background` (needs `DD_API_KEY`, `DD_APP_KEY`; 7 to 15 minutes because it pages 5 events at a time on purpose; progress goes to stderr). Do steps 2 and 5 while it runs.
2. **Sessions.** `slack_read_channel` on #dev-audit (`C041BUHJJU8`, limit 100, default detailed format, no `oldest`: it pages backwards from newest). The result overflows to a file; run `python3 <skill>/scripts/plain-live-report.py sessions <file>`. It prints the oldest message it saw; page with the cursor until that is older than the window start. Done when you have every `plain_live_session_started` row in the window. Audit rows exist only from 2026-10-03; Datadog activity before that has no session to attribute to, say so.
3. **Attribute.** Map each failure class from the report to a session: same service, failures after a start that forwarded it. Router logs carry no session tag, so attribute by elimination (only one dev forwarded that service then); for shared services like core-graphql-api say "not attributable". The user is the dev whose email matches `git config user.email`; split their sessions from everyone else's. The report already separates sweep minutes (one failure on 5+ services in the same minute): those are the user's smoke tests, collapse them to one line.
4. **Root cause.** For every class that hit someone other than the user, `command git fetch origin main` in the services repo, then:
   - Find the dev's PR: `gh pr list -R team-plain/services --head <branch> --state all`. No PR means "unknown, ask <dev>".
   - Read the PR diff and body (stacked PRs name their base). For `env-missing`, find when the infra landed: `command git log -S'<VAR>' --format='%h %ci %s' origin/main -- terraform/`. Landed after the session means the deployed Lambda lacked it.
   - For anything else, read `packages/plain-service-live/src` on `origin/main` (`bridge/router.ts` decides forward vs fallback, `harness/preflight.ts` builds worker env, `harness/workers.ts` assumes the deployed Lambda role).

   Done when each class has a cause or an explicit "unknown, ask <dev>".
5. **Feedback.** One `slack_search_public_and_private` for `"plain:live"` with `after:` the window start, `limit: 10`, `response_format: concise`; the result is large, grep the overflow file for human authors. Read the announcement thread in #engineering-journal (`C09JZ8JSVTK`). Note complaints, questions, praise, and unanswered asks.
6. **Report.** A table of devs (starts, services, failures, notes), volume for services above the sweep threshold, then issues ranked by user pain, each with evidence (counts, UTC times, quoted error) and a concrete fix. Close with measurement gaps and offer to file Linear issues (`create-linear-issue`).

## Known Patterns

| Signal | Meaning |
|---|---|
| `env-missing <VAR>`, phase worker | Branch adds infra (blueprint capability, Terraform env, IAM) not yet deployed. Worker uses deployed env and role, so it fails every invoke. Tracked in PE-1302 |
| Fallback `No active plain:live session` | Support app tab still carries a session tag after the CLI stopped. Benign, deployed handler served it |
| `no-local-worker-timeout`, phase wait-response | Laptop slept, CLI hung or worker slow. Isolated ones are noise |
| `handler-threw` on an SQS service in hourly bursts long after active use | SQS redelivering a poison message to a session left running. The bridge log drops the worker's error, so ask the dev or read their local plain:live logs. Flag the session duration |
| `session-replaced` | Dev restarted; an in-flight invoke named the old session |
| Several starts within minutes, same commit | Restart churn: adding a service, branch switch, or a failure the dev is retrying. Check failures in that window before guessing |

## Gaps

#dev-audit only records starts, so session length and per dev volume are not measurable, and the bridge failure log drops the worker's real error. Say so when asked about efficiency rather than inferring it.
