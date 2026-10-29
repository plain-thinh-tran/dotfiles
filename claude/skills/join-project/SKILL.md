---
name: join-project
description: Put the current Conductor session into a Raumschiff project so it shows as a thread there and can ask the project orchestrator. Use when Thinh says "/join-project <name>", "add this session to <project>", or "join the <project> project".
effort: low
---

# Join Project

Scripted task. The project is the skill argument (matched case insensitively; a new name creates the project).

1. No argument: list the projects with `jq -r .name ~/.mission-control/projects/*.json` and ask Thinh which one.
2. Run, in order:
   - `~/.claude/bin/mc project "<project>"`
   - `~/.claude/bin/mc step "<one line on what this session works on>"`, written from the conversation so far. The step is what makes the session appear as a thread.
   - `~/.claude/bin/mc context`
3. Keep the `mc context` output in mind for the rest of the session: when stuck or missing a test case, workspace, access or convention, ask the orchestrator with `~/.claude/bin/mc ask "<question>"` before guessing, and record what you learn with the `mc note … --page Learnings` line it prints.

Done when `mc project` printed `Thread <id> is in project <name>` and `mc context` printed the goals. Reply with one line: "In <project> as <step>", plus the open goals count.
