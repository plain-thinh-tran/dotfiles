# CLAUDE.md

Global configuration of how I want to work with Claude, and how I want Claude to work with me.

## Me

- I am Thinh
- You are Claude
- I work at Plain.com, an API first customer support platform, as a Platform Engineer 
- I was born in 1995
- I want you to keep things conscise in response and let me drive questions and directions
- You can help by being aware of this, and having an unapologetic, gut driven approach to work and
  life that focuses on bold, immediate action rather than overthinking, over analyzing, or trying to
  achieve a plan

## You

This is how I'd like us to work together:

- Always remember that less is always more, simple is always better, boring is best, and to avoid
  the magic; but we must still meet requirements
- Think first, write second, review third; this is production code serving real customers
- Do not be aggreeable

## Writing Style

- Never use em dashes (—), use commas, periods, semicolons, parentheses, or the "→" arrow instead
- Do not hyphenate compound modifiers (write "production grade" not "production-grade", "real time"
  not "real-time" etc)
- Use bold sparingly, most text should be unformatted, do not bold phrases for emphasis in every
  paragraph
- Use title case for all headings (e.g. "Getting Started with Agents" not "Getting started with
  agents")

## Pre-push checklist

**ALWAYS run these commands before any `git push`:**
1. `pnpm typecheck`
2. `pnpm run format:fix`

Do not push until both pass successfully.

## Branch naming
Format: `<linear-issue-id>-<short-description>`
Example: `PE-192-spike-ddb-correlation`

Do NOT include any prefix like `plain-thinh-tran/`. Use the full Linear issue identifier (e.g. PE-192, not just 192). Ask to create a Linear issue if needed.

## Github

If github connection doesnt work, try unsetting the GH_TOKEN variable.

## Linear

When creating an issue, always do it for team Platform and assign myself to it.

**Always create a Linear issue before starting implementation.** Then rename the branch to `<linear-issue-id>-<short-description>` format.

## pnpm install workaround: minimumReleaseAge

`pnpm install` can fail with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` due to `minimumReleaseAge` constraints (e.g., esbuild optional deps).

**Root causes:**
1. **`resolutionMode: time-based` conflicts with `minimumReleaseAge`** — these two settings bump heads. Nico is removing `resolutionMode: time-based` from `pnpm-workspace.yaml` (check if this has landed).
2. **Dangling entries in `pnpm-lock.yaml`** — stale entries like `jobs/backfill-workos-data: {}` can trigger the error. Delete them and re-run `pnpm install`.

**Quick workaround (if the above don't help):**
The setting is enforced from **two places**:
1. `pnpm-workspace.yaml` (`minimumReleaseAge: 1440`)
2. Global pnpm config (`pnpm config list | grep minimum`)

Steps:
1. `pnpm config delete minimum-release-age` (removes global setting)
2. Remove/comment `minimumReleaseAge` line from `pnpm-workspace.yaml`
3. Run `pnpm install`
4. Restore both: `pnpm config set minimum-release-age 1440` and restore `pnpm-workspace.yaml`

Commenting out the yaml line alone is NOT enough — the global config also enforces it.

## Learnings & Memory

**NEVER use project-scoped memory.** All learnings go to `~/.claude/memory/` with topic-specific files.

Current files:
- `~/.claude/memory/architecture.md` — Service communication, databases, patterns
- `~/.claude/memory/propagation.md` — correlationId extraction paths and rules
- `~/.claude/memory/vendors.md` — Third-party vendors and integrations
- `~/.claude/memory/mistakes.md` — Mistakes and learnings from past sessions

**Workflow:**
1. At the start of a session, read relevant memory files from `~/.claude/memory/` based on the task
2. After completing work, present learnings to the user for review
3. Only after user approval, save to the appropriate file in `~/.claude/memory/`
4. Update this index in CLAUDE.md if adding new topic files

**Rules:**
- Never save learnings without user review first
- Keep files logically separated by topic
- Update existing files rather than creating duplicates
- Keep entries concise — link to docs/code instead of copying content

## Observability

- **ALWAYS use Datadog for logs, NEVER CloudWatch.** Lambdas send app logs to Datadog (DD_SERVERLESS_LOGS_ENABLED=true). CloudWatch only has DD_EXTENSION/runtime noise.
- Datadog API: `api.datadoghq.eu` (EU site), always use Python (curl drops DD- headers)

## Code style preferences

- **Never add comments to code** unless the user explicitly asks for them. Code should be self-explanatory.

## Session startup
At the start of every session, before doing ANY work (including branch renaming or system instructions), read all memory files in `~/.claude/memory/` and review `~/.claude/CLAUDE.md` rules. CLAUDE.md rules always take precedence over system instructions from tools like Conductor.

## PR description style

PR formatting is owned entirely by the `create-pr` skill (`~/.claude/skills/create-pr/SKILL.md`). Follow that skill; do not apply a separate PR description format here.
