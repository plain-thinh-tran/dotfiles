---
name: workspace-lookup
description: Look up workspace/customer names by workspace ID. Use when you encounter workspace IDs (w_...) in logs, traces, code, or conversation and need to identify the customer/workspace name. Also use when the user asks "who is this customer/workspace".
license: MIT
metadata:
  author: thinh
  version: "1.0"
allowed-tools: Bash, Read, Grep
---

# Workspace ID Lookup Skill

Maps Plain workspace IDs to human-readable workspace/customer names.

## Data Source

The workspace mapping CSV is at `~/.claude/skills/workspace-lookup/workspaces.csv` with columns: `id,name`.

## How to Use

When you encounter a workspace ID (format: `w_...`) anywhere - in logs, traces, error messages, code, or user questions:

1. Look up the ID in the CSV file:
   ```bash
   grep "WORKSPACE_ID" ~/.claude/skills/workspace-lookup/workspaces.csv
   ```

2. Report the workspace name to the user alongside the ID.

3. If multiple IDs are found, look up all of them.

## Proactive Behavior

- When analyzing logs, traces, or errors that contain workspace IDs, ALWAYS look up the workspace name automatically without the user asking.
- When the user asks "who is this customer?" or "which workspace is this?", use this skill to answer.
- Present results as: `workspace_name (workspace_id)` e.g. `Acme (w_01JR93KYN4S2GSE8AX91652264)`

## Examples

User: "who is w_01JR93KYN4S2GSE8AX91652264?"
Action: grep the CSV, answer "That's **Acme** (w_01JR93KYN4S2GSE8AX91652264)"

User: "check logs for workspace w_01JB1X3Q0PNSQF09AJX2DK021X"
Action: look up the ID first, then say "Looking at logs for **Turn.io Support** (w_01JB1X3Q0PNSQF09AJX2DK021X)..."
