---
name: plain-live-usage
description: Audit how devs use plain:live and what breaks for them, from #dev-audit session starts, Datadog bridge logs and Slack feedback. Use when asked about plain:live usage, adoption, errors, efficiency or feedback.
---

# plain:live Usage Audit

Research only: report findings, file nothing until the user asks. `scripts/plain-live-report.py` (next to this file, use its absolute path) does the gathering and cross referencing and prints all times in UTC; your work is judging attribution and finding root cause.

The user is the dev whose `git config user.email` local part (run it in the services repo) matches the `dev` column. Their laptop sessions and their `cloud-agent` sessions are both theirs.

## Steps

1. **Sessions.** `slack_read_channel` on #dev-audit (`C041BUHJJU8`, limit 100, default detailed format, no `oldest`: it pages backwards from newest). The result overflows to a file. Run `python3 <skill>/scripts/plain-live-report.py sessions <file>`: it prints every start and a per dev summary, and on stderr the oldest message it saw. One page usually reaches past a 7 day window; page with the cursor only when the oldest message is newer than the window start. Audit rows exist only from 2026-10-03, so Datadog activity before that has no session to attribute to.
2. **Report, in the background.** `command git -C <services> fetch -q origin main`, then start `python3 <skill>/scripts/plain-live-report.py report --from now-7d --sessions <file> --repo <services> > /tmp/plain-live-report.txt` with `run_in_background` (needs `DD_API_KEY`, `DD_APP_KEY`; about 7 minutes, progress with totals on stderr). It prints invokes per service, fallbacks, sweep windows (the user's smoke tests, failures on 3+ services in the same minute, collapse each to one line), and every other failure grouped by class, then service, with trigger type, an hourly histogram and per dev candidates. Do step 4 while it runs.
3. **Attribute and root cause.** For each failure class outside the sweeps, read the `candidates` line (failures per dev). One dev settles it; several devs on a shared service like core-graphql-api means "not attributable"; `no audit session:N` means pre audit or an unaudited CLI, ask. For every class that hit someone other than the user:
   - Find the dev's PR: `gh pr list -R team-plain/services --head <branch> --state all`. No PR means "unknown, ask <dev>".
   - Read the PR diff and body (stacked PRs name their base). For `env-missing`, find when the infra landed: `command git log -S'<VAR>' --format='%h %ci %s' origin/main -- terraform/services/<service>/`. Landed after the session means the deployed Lambda lacked it.
   - The class names come from log text matched in the script's `ERROR_CLASSES`, not from plain:live source. Read `packages/plain-service-live/src` on `origin/main` only when the class is a bridge behaviour (`bridge/router.ts` forward vs fallback, `harness/preflight.ts` worker env, `harness/workers.ts` deployed role).

   Done when each class has a cause or an explicit "unknown, ask <dev>".
4. **Feedback.** One `slack_search_public_and_private` for `"plain:live"` with `after:` the window start, `limit: 10`, `response_format: concise`. Read the announcement thread: `slack_read_thread` channel `C09JZ8JSVTK`, ts `1791296942.830359`. Report other devs' complaints, questions, praise and unanswered asks; skip the user's own posts. Summarise DMs without quoting them.
5. **Report.** A table of devs (starts, origins, services, failures, notes), volume for services above the sweep line, then issues ranked by user pain. Each issue gets evidence (counts, UTC times, the quoted error), cause and a one line fix. Close with measurement gaps and offer to file Linear issues (`create-linear-issue`).

## Known Patterns

| Signal | Meaning |
|---|---|
| `env-missing <VAR>`, phase worker | Branch adds infra (blueprint capability, Terraform env, IAM) not yet deployed. Worker uses deployed env and role, so it fails every invoke. Tracked in PE-1302 |
| Fallback `No active plain:live session` | Support app tab still carries a session tag after the CLI stopped. Benign, deployed handler served it |
| `no-local-worker-timeout`, phase wait-response | Laptop slept, CLI hung or worker slow. Isolated ones are noise |
| `handler-threw` on an `[sqs]` service, hourly histogram showing bursts long after the last start | SQS redelivering a poison message to a session left running. The bridge log drops the worker's error, so ask the dev or read their local plain:live logs. Flag the session duration |
| `session-replaced` | Dev restarted; an in-flight invoke named the old session |
| `restarts within 15 min` above 0 | Restart churn: adding a service, branch switch, or a failure the dev is retrying. Check failures in that window before guessing |

## Gaps

#dev-audit only records starts, so session length and per dev volume are not measurable, router logs carry no session tag, and the bridge failure log drops the worker's real error. Say so when asked about efficiency rather than inferring it.
