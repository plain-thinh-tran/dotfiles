---
name: plain-live-usage
description: Audit how devs use plain:live and what breaks for them, from #dev-audit session starts, Datadog bridge logs and Slack feedback. Use when asked about plain:live usage, adoption, errors, efficiency or feedback.
---

# plain:live Usage Audit

Research only: report findings, file nothing until the user asks. `scripts/plain-live-report.py` (next to this file) does the deterministic gathering; your work is attribution and root cause.

## Steps

1. **Sessions.** `slack_read_channel` on #dev-audit (`C041BUHJJU8`, limit 100). The result overflows to a file; parse it with `python3 scripts/plain-live-report.py sessions <file>`. Page with the cursor until you pass the window start (default 7 days). Done when you have every `plain_live_session_started` row: who, services, origin, branch, dirty flag.
2. **Datadog.** `python3 scripts/plain-live-report.py report --from now-7d` (needs `DD_API_KEY`, `DD_APP_KEY`; takes minutes, it pages 5 events at a time on purpose). Gives invokes per service per day, fallbacks, and bridge failures grouped by class, phase, hour and service.
3. **Attribute.** Map each failure class to a session: same service, failure hour after a start of a session that forwarded it. Router logs carry no session tag, so attribute by elimination (only one dev forwarded that service then). Split the user's own sessions from everyone else's; they built the tool and their sweeps (one failure on dozens of services in the same minute) are smoke tests, not user pain.
4. **Root cause.** For every class that hit someone other than the user: read the dev's branch PR (`gh pr list -R team-plain/services --search <branch> --state all`, then `gh pr diff`) and the plain:live source on `origin/main` in the services repo (`packages/plain-service-live/src`; `harness/preflight.ts` builds worker env, `harness/workers.ts` assumes the deployed Lambda role, `bridge/router.ts` decides forward vs fallback). Done when each class has a cause or an explicit "unknown, ask <dev>".
5. **Feedback.** `slack_search_public_and_private` for `"plain:live"` (and `plain-live`), and read the announcement thread in #engineering-journal (`C09JZ8JSVTK`). Note complaints, questions, praise.
6. **Report.** A table of devs (starts, services, notes), volume per service, then issues ranked by user pain, each with evidence (counts, times, quoted error) and a concrete fix. Close with measurement gaps and offer to file Linear issues (`create-linear-issue`).

## Known Patterns

| Signal | Meaning |
|---|---|
| `env-missing <VAR>`, phase worker | Branch adds infra (blueprint capability, Terraform env, IAM) not yet deployed. Worker uses deployed env and role, so it fails every invoke. Tracked in PE-1302 |
| Fallback `No active plain:live session` | Support app tab still carries a session tag after the CLI stopped. Benign, deployed handler served it |
| `no-local-worker-timeout`, phase wait-response | Laptop slept, CLI hung or worker slow. Isolated ones are noise |
| `handler-threw` for hours, errors close to invokes | A forgotten session failing everything it intercepts on a shared queue. Flag the duration |
| `session-replaced` | Dev restarted; an in-flight invoke named the old session |
| Several starts within minutes, same commit | Restart churn: adding a service, branch switch, or a failure the dev is retrying. Check failures in that window before guessing |

## Gaps

#dev-audit only records starts, so session length and per dev volume are not measurable. Say so when asked about efficiency rather than inferring it.
