---
name: create-pr
description: Create a pull request with rebase, Linear issue link, and concise description.
allowed-tools: Bash, Read, Grep, Glob
---

# Create PR

Create clean, reviewer-friendly pull requests. Optimized for quick review — no walls of text, no file listings, no code snippets.

## Guiding Principles

- **Describe intent, not implementation.** Say what you tried to achieve, not what you did. Reviewers can read the diff for the "what".
- **One logical change per PR.** If you can't summarize it in one title, consider splitting into multiple PRs.
- **Don't mix unrelated changes.** Formatting fixes, refactors, and feature work belong in separate PRs.
- **Smaller is better.** Reviewing 30 lines is easy. Reviewing 300 is painful. Keep the scope tight.

## Workflow

### 1. Ensure changes are committed

Check `git status`. If there are uncommitted changes, ask the user if they'd like to commit first. Do not proceed with uncommitted work.

### 2. Ensure Linear issue exists

Check the branch name for a Linear issue ID (format: `<TEAM-ID>-<number>-...`, e.g. `PE-425-fix-something`).

If the branch has no Linear issue ID:
1. Create a Linear issue using the Linear MCP tool (`save_issue`) — team: Platform, assignee: me, title and description derived from the commits
2. Rename the branch: `git branch -m <current-branch> <LINEAR-ID>-<short-description>`
3. If the old branch was already pushed, delete it from remote: `git push origin --delete <old-branch>`

**Do not proceed without a Linear issue.** The `verify-linear-issue` CI check will fail without one.

### 3. Pre-flight: rebase and push

```bash
# Rebase onto latest main
git fetch origin main && git rebase origin/main

# Push (create remote branch if needed)
git push -u origin HEAD
```

If rebase has conflicts, stop and ask the user to resolve them.
If the branch was already pushed and rebase rewrote history, use `git push --force-with-lease`.

### 4. Gather context

```bash
# Understand what's in the PR
git log origin/main..HEAD --oneline
git diff origin/main..HEAD --stat
```

Identify:
- The Linear issue number from the branch name (format: `dev-<number>-...`)
- The core motivation — what problem exists and why this change solves it
- The category of change (see Title Format below)

### 5. Scope check

Before creating the PR, review the commits and diff:
- If there are unrelated changes (e.g. formatting fixes mixed with logic), suggest splitting into separate PRs
- If the PR touches 20+ files with different concerns, suggest breaking it up
- If it's all one logical change, proceed

### 6. Create the PR

Use `gh pr create` with this format:

```bash
gh pr create --title "<Category>: <short description>" --body "$(cat <<'EOF'
<One sentence telling the reviewer what to expect from this PR.>

## Context

<1-3 bullet points. What problem existed? Why does this change matter? Focus on intent, not implementation.>

## Linear

[DEV-<number>](https://linear.app/plain/issue/DEV-<number>)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Important:** If `gh` fails due to auth, try `unset GH_TOKEN` first and retry.

### 7. Return the PR URL

Print the PR URL so the user can open it.

### 8. Handle Cursor Bugbot comments

After the PR is created, Cursor Bugbot will analyze the diff and may leave review comments. Check for them:

```bash
gh api repos/<owner>/<repo>/pulls/<number>/comments
```

For each finding:
1. **Evaluate** — read the comment, understand the issue, check the code to see if it's valid
2. **Fix if valid** — make the code change, commit, and push
3. **Reply** — leave a concise reply on the comment explaining what was fixed and referencing the commit SHA. Keep it factual, no filler phrases like "good catch" or "great point"
4. **Resolve** — resolve the conversation thread if the fix fully addresses it

**Reply format:**
```
Fixed in <short-sha>. <One sentence explaining the fix.>
```

**Example:**
```
Fixed in bf7bef4. Narrowed the warning to only fire for aws:sqs and aws:sns events — S3, DynamoDB Streams, and Kinesis are legitimate entry points.
```

```
Fixed in bf7bef4. Added SNS→Lambda extraction at Records[0].Sns.MessageAttributes so workflow-exec-handler correctly picks up the correlationId.
```

If the finding is not valid, reply explaining why and resolve.

## Title Format

Prefix the title with a category. Keep the full title under 70 characters.

| Category | When to use |
|----------|-------------|
| `Fix:` | Bug fixes, broken behavior |
| `Feature:` | New functionality |
| `Refactor:` | Code restructuring, no behavior change |
| `Chore:` | Dependencies, config, CI, tooling |
| `Docs:` | Documentation only |
| `Perf:` | Performance improvements |
| `Test:` | Adding or updating tests only |

Examples:
- `Fix: plainCorrelationId propagation for DLQ debugging`
- `Feature: add webhook retry with exponential backoff`
- `Refactor: extract email validation into shared package`

## PR Description Rules

**Voice:** Draft the description in Thinh's broadcast register. Read the voice profile at
`~/.claude/skills/draft-msg/voice-profile.md` (broadcast register + formal style rules) before
writing. Proper capitalization, clean grammar, no em dashes, no hyphenated compound modifiers.

### Do
- **Start with a one-sentence intro** — tell the reviewer what to expect at a glance
- **"Context" section**: 1-3 short bullet points describing the problem and intent
- **Linear issue link**: placed after Context for easy access
- Use plain language, short sentences
- Describe what you tried to achieve, not how

### Don't
- Don't list changed files or directories
- Don't include code snippets or diffs
- Don't write paragraphs — use bullets
- Don't explain implementation details (the diff shows the "how")
- Don't add a "Summary" section that restates the title
- Don't over-explain — trust the reviewer to read the code
- Don't mix "why" with "what" — keep the intent clear
- Don't include a test plan section

## Example

```
Fixes correlationId propagation so DLQ messages can be traced back to their originating request.

## Context

- DLQ messages can't be traced back to originating requests — no correlationId in the message body
- Several services had broken correlation chains, making debugging production failures harder
- No alerting existed to catch future gaps

## Linear

[DEV-177](https://linear.app/plain/issue/DEV-177)
```

### 9. Add inline review comments for the reviewer

After the PR is created (or after pushing new commits to an existing PR), review the diff and add inline comments on non-obvious, important changes to help the reviewer understand the reasoning.

**When to comment:**
- Design decisions where alternatives existed (e.g. middleware vs manual changes)
- Tricky logic that isn't self-explanatory
- Changes that affect multiple files with a shared pattern — explain the pattern once, reference it elsewhere
- IAM / infra changes that need justification
- Graceful fallbacks or edge case handling

**When NOT to comment:**
- Import changes
- Formatting / cosmetic changes
- Obvious code (variable renames, type updates, test assertions)
- Anything a competent reviewer can understand in 5 seconds

**Voice:** Comments are broadcast register. Match the voice profile at
`~/.claude/skills/draft-msg/voice-profile.md` — clean grammar, no hedging, no corporate filler.

**Style rules:**
- No titles or headers — jump straight into the explanation
- Keep it short but comprehensive (2-4 sentences)
- Never repeat yourself — if multiple files follow the same pattern, explain it on one file and write "Same pattern as above" or "See comment on <file>" on the others
- Defend your decisions: explain *why* this approach, not *what* the code does

**How to post:**
```bash
unset GH_TOKEN && gh api repos/<owner>/<repo>/pulls/<number>/comments \
  -f commit_id="<sha>" \
  -f path="<file>" \
  -f side="RIGHT" \
  -F line=<line> \
  -f body="<comment>"
```

For multi-line comments, add `-F start_line=<start> -f start_side="RIGHT"`.

## Learnings

### For architectural / multi-service changes
- **Include a flow diagram** — show the message flow as a simple text diagram (e.g. `cron → SQS → workspace handler → SQS → post handler`). Makes the PR instantly scannable.
- **Show the architecture, don't name it** — don't say "three-tier fan-out architecture". Show a concrete flow diagram or responsibility table instead. Prefer visual clarity over jargon.
- **Don't include specific duration/timing claims** (e.g. "7.5 min", "83+ minutes of stagger") — these are implementation details that belong in code review comments, not the PR description.
