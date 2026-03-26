---
name: incident-analysis
description: |
  Analyze a Slack incident channel to produce a structured learning-focused postmortem report.
  Use when the user mentions incident analysis, postmortem, incident channel, what happened
  in an incident, learn from incident, analyze incident, review incident, incident review,
  incident retrospective, incident report, or points to a Slack incident channel URL.
  Also use when user asks to understand an outage, production issue, or wants to learn
  from a past incident.
allowed-tools: Bash, Read, Grep, Glob, mcp__claude_ai_Slack__slack_read_channel, mcp__claude_ai_Slack__slack_read_thread, mcp__claude_ai_Slack__slack_search_channels, mcp__claude_ai_Slack__slack_search_public, mcp__claude_ai_Slack__slack_search_public_and_private, mcp__claude_ai_Slack__slack_read_user_profile, mcp__claude_ai_Slack__slack_read_canvas
---

# Incident Analysis Skill

Analyze a Slack incident channel and produce a structured, learning-focused report. The goal is to help the user become a better incident responder by understanding what happened, how it was investigated, and what techniques were used.

## Input

The user will provide one of:
- A Slack channel URL (e.g., `https://team-plain.slack.com/archives/C0XXXXXXX`)
- A Slack channel ID (e.g., `C0XXXXXXX`)
- A channel name (e.g., `#inc-2026-02-26-something` or `inc-2026-02-26-something`)

## Step 1: Resolve the Channel ID

**If given a URL**: Extract the channel ID from the URL path (the `C`-prefixed segment after `/archives/`).

**If given a channel name**: Use `mcp__claude_ai_Slack__slack_search_channels` to find the channel. Include archived channels since old incidents are often archived.

**If channel not found**: Tell the user the channel was not found. Suggest they check the spelling or provide the channel ID directly. Stop here.

## Step 2: Read the Full Channel History

Read the channel to reconstruct the incident timeline.

```
mcp__claude_ai_Slack__slack_read_channel(channel_id=CHANNEL_ID, limit=100, response_format="detailed")
```

Paginate using the `cursor` from each response until you have all messages, up to 500 messages max. The API returns newest-first, so mentally reverse the order for chronological presentation.

For very long incidents (> 500 messages), focus on the first 200 messages (detection and investigation) and the last 100 messages (resolution). Note the gap in the report.

## Step 3: Read Key Threads

Scan channel messages for threads (messages with reply indicators). Prioritize:

1. **Root cause discussion** — threads where people discuss what broke
2. **Investigation threads** — threads with SQL queries, API calls, log searches, Datadog links
3. **Fix/mitigation threads** — threads discussing the fix, linking PRs, or deployment steps
4. **Customer impact threads** — threads discussing affected customers or blast radius
5. **Postmortem/summary threads** — threads with incident summaries or action items

For each important thread (up to 10):
```
mcp__claude_ai_Slack__slack_read_thread(channel_id=CHANNEL_ID, message_ts=THREAD_TS)
```

Skip threads that are clearly short acknowledgments ("thanks", "ok", join messages).

## Step 4: Resolve Participant Names

Collect all unique user IDs from messages. For each unique user (up to 15):
```
mcp__claude_ai_Slack__slack_read_user_profile(user_id=USER_ID, response_format="concise")
```

Use display names throughout the report instead of raw IDs.

## Step 5: Read Linked Canvases

If any messages contain canvas file references (file IDs starting with `F`), read them:
```
mcp__claude_ai_Slack__slack_read_canvas(canvas_id=CANVAS_ID)
```

Canvases often contain structured postmortem notes or incident summaries.

## Step 6: Fetch Referenced PRs

Scan all messages and thread replies for GitHub PR URLs:
- `github.com/team-plain/services/pull/NNNN`
- `github.com/team-plain/*/pull/NNNN`

For each PR found (up to 5):
```bash
unset GH_TOKEN && gh pr view NNNN --json title,body,additions,deletions,files,commits,state,mergedAt,author
unset GH_TOKEN && gh pr diff NNNN
```

## Step 7: Explore the Codebase

Based on what you learned from the incident channel and PRs:

1. Identify affected services/packages from the discussion (service names, file paths, function names)
2. Read relevant source files using the Read tool for technical context
3. Search for related code using Grep/Glob if specific error messages or function names are mentioned

Limit to 10 file reads to stay focused.

## Step 8: Produce the Report

Generate the report using this template. Write factually, not dramatically. Incidents are learning opportunities, not blame exercises.

---

# Incident Analysis: [Short Description]

**Channel**: #[channel-name]
**Date**: [Date of the incident]
**Duration**: [Time from detection to resolution]
**Severity**: [Critical / High / Medium / Low]
**Incident Lead**: [Name]

## Summary

[One paragraph summarizing what happened, what broke, and how it was fixed. Clear enough that someone unfamiliar with the codebase could understand.]

## Severity & Blast Radius

- **What was affected**: [Services, features, customer-facing behavior]
- **Who was affected**: [All customers / specific workspaces / internal only]
- **Customer impact**: [What customers experienced]
- **Duration of impact**: [How long customers were affected]
- **Data affected**: [Number of records, workspaces, customers impacted — from investigation queries]

## Timeline

| Time (UTC) | Event | Who |
|------------|-------|-----|
| HH:MM | [Event description] | [Person] |

Include: first detection, investigation start, root cause identified, mitigation applied, fix deployed, all-clear.

## Root Cause Analysis

### What broke
[Technical explanation referencing specific code, services, or infrastructure. Include file paths and function names.]

### Why it broke
[The deeper "why" — gap in testing? deployment issue? incorrect assumption? missing validation?]

### Contributing factors
[Other factors that made the incident possible or worse — missing alerts, unclear ownership, etc.]

## Investigation Techniques

This is the most important learning section. Document exactly how the team found the problem.

### Queries & Commands Used
[List the actual SQL queries, Datadog searches, API calls, or CLI commands used during investigation. Preserve them exactly as used, in code blocks, with explanations of what each one reveals and why it was chosen.]

### Data Analysis
[How did they identify affected data? What patterns did they look for? How did they scope the blast radius?]

### Key Debugging Steps
[The logical chain: "first they checked X, which led them to Y, which revealed Z"]

### Gotchas Encountered During Investigation
[Any wrong turns, misleading data, or schema surprises that cost time — these are especially valuable to learn from]

## Mitigation & Fix

### Immediate mitigation
[What was done to stop the bleeding — disable feature, rollback, manual fix, etc. Note the decision-making: why this approach was chosen under pressure.]

### Permanent fix
[The actual code change. Reference PRs with links.]

### PR Analysis
[For each PR: what changed, why, key files modified. Keep concise.]

## Key Learnings

### What the team did well
- [Effective actions during this incident]

### Patterns to remember
- [Reusable investigation patterns from this incident]
- [Specific queries or commands worth saving for future incidents]
- [Decision-making patterns: when to break a feature vs. when to patch]

### Knowledge gaps exposed
- [Things about the system that were not well understood before this incident]

## What Would You Do Differently?

[Actionable tips for future incident response, written as direct coaching advice:]

1. **[Tip]**: [What to do and why]
2. **[Tip]**: [What to do and why]
3. **[Tip]**: [What to do and why]

---

## Edge Cases

- **Channel has < 5 messages**: Note that the incident may have been handled in a call or DMs. Suggest checking for related channels.
- **No threads**: Proceed with main channel messages only. Note the flat discussion style.
- **No PRs mentioned**: The fix may have been a config change, rollback, or manual data fix. Search for "deployed", "rolled back", "reverted", "config", "feature flag" in messages.
- **Bot messages dominate**: Include bot messages in the timeline (they mark key events like alerts firing) but focus analysis on human messages.
- **Private channel access denied**: Tell the user they need to be a member of the channel.

## Tone and Style

- Factual and precise. Name specific services, functions, error codes.
- The "What Would You Do Differently?" section must be genuinely useful coaching, not generic platitudes.
- No emojis in the report.
- Preserve investigation commands (SQL, Datadog queries) exactly as they were used.
- When the team made mistakes during investigation (wrong queries, wrong assumptions), document them as learning opportunities, not criticisms.
