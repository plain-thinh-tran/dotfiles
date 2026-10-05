#!/usr/bin/env python3
"""PreToolUse hook for the Linear MCP save_issue tool.

Denies a create unless it targets team Platform with a project id, a priority (1-4), and at least one
label, and denies any create from a git repo whose origin is not under team-plain. Denies an update that moves the issue off Platform or clears its project, priority, or labels.
"""

import json
import re
import subprocess
import sys

PLATFORM_TEAM = {"platform", "pe", "2e5d1dbd-84da-4f36-902a-e3291deaa73b"}
PROJECT_ID = re.compile(r"^(P-[A-Z]+-\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$")
SKILL = "Follow ~/.claude/skills/create-linear-issue/SKILL.md."


def origin_url(cwd):
    try:
        result = subprocess.run(
            ["git", "-C", cwd, "remote", "get-url", "origin"], capture_output=True, text=True, timeout=5
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def problems_on_create(args, cwd):
    url = origin_url(cwd)
    if url and not re.search(r"[:/]team-plain/", url):
        return [f"Linear issues are only created for team-plain repos, this repo is {url}. Do not create one"]
    problems = []
    if str(args.get("team") or "").strip().lower() not in PLATFORM_TEAM:
        problems.append('team must be "Platform"')
    if not str(args.get("project") or "").strip():
        problems.append("project is required (this week's Reactive Work project when nothing fits better)")
    elif not PROJECT_ID.match(str(args["project"])):
        problems.append("project must be an id like P-PE-885 from list_projects, names are ambiguous across teams")
    if args.get("priority") not in (1, 2, 3, 4):
        problems.append("priority must be 1 (urgent), 2 (high), 3 (medium) or 4 (low)")
    if not (args.get("labels") or args.get("addLabels")):
        problems.append("at least one label is required")
    return problems


def problems_on_update(args):
    problems = []
    if "team" in args and str(args["team"] or "").strip().lower() not in PLATFORM_TEAM:
        problems.append("issues stay in team Platform")
    if "project" in args and not str(args["project"] or "").strip():
        problems.append("project cannot be removed")
    elif "project" in args and not PROJECT_ID.match(str(args["project"])):
        problems.append("project must be an id like P-PE-885 from list_projects, names are ambiguous across teams")
    if "priority" in args and args["priority"] not in (1, 2, 3, 4):
        problems.append("priority cannot be cleared")
    if "labels" in args and not args["labels"]:
        problems.append("labels cannot be cleared")
    return problems


def main():
    event = json.load(sys.stdin)
    args = event.get("tool_input") or {}
    problems = problems_on_update(args) if args.get("id") else problems_on_create(args, event.get("cwd") or ".")
    if not problems:
        return
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "Linear issue rejected: " + "; ".join(problems) + ". " + SKILL,
            }
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
