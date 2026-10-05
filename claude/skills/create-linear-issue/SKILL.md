---
name: create-linear-issue
description: Create a Linear issue through the Linear MCP in team Platform with a project, priority, and labels. Use whenever an issue must be created, including when create-pr or another skill needs a Linear id.
allowed-tools: mcp__claude_ai_Linear__list_projects, mcp__claude_ai_Linear__list_milestones, mcp__claude_ai_Linear__list_issue_labels, mcp__claude_ai_Linear__save_issue
---

# Create Linear Issue

Every issue goes in team Platform, in a project, with a priority and at least one label, assigned to me. `linear-issue-guard.py` runs as a PreToolUse hook on `save_issue` and denies any create that misses one of these. If it denies, fix the arguments it names and retry.

## Steps

1. List open projects: `list_projects` with `team: "Platform"`, `state: "started"`, `fields: ["name", "status", "startDate", "targetDate"]`. Every result carries an `id` like `P-PE-885`.
2. Pick the project. Use a named project only when the work clearly belongs to it (same goal, not just the same area). Otherwise use this week's reactive project: the one named `Reactive Work Q<n>W<n>` whose `startDate <= today <= targetDate`; if none matches (weekend), the open `Reactive Work` project with the latest `startDate`. If no reactive project is open, stop and ask me.
3. For the reactive project, pick a milestone: `list_milestones` with the project id. Use the one that matches (Error Tracking Issues, Datadog, Cost Reduction, Customer Request, CI/CD Fix, Code Refactor, Security Patch); skip it when none fits.
4. Pick labels: `list_issue_labels` with `team: "Platform"`, `limit: 250`. Ignore groups and labels with `retiredAt`. Use `Bug` or `Papercut` for broken behavior, the matching `System` child (e.g. `CI/CD`, `Email`), and the `repo` child for the repo the change lands in (e.g. `team-plain/services`). A group allows one child, so never pass two `System` or two `repo` labels.
5. Pick priority: 1 urgent for customer facing breakage or incidents, 2 high for work blocking someone this week, 3 medium by default, 4 low for cleanup that can wait.
6. Create it with `save_issue`:

```json
{
  "team": "Platform",
  "title": "<plain description, no category prefix>",
  "description": "<markdown>",
  "project": "<project id from step 1, e.g. P-PE-885>",
  "milestone": "<milestone id from step 3, optional>",
  "priority": 3,
  "labels": ["<label>", "<label>"],
  "assignee": "me"
}
```

Always pass ids for project and milestone: every team has a project named `Reactive Work Q<n>W<n>`, so names are ambiguous and the MCP rejects them. The result carries the identifier (e.g. `PE-1234`); pass it to `create-pr.sh -l`.
