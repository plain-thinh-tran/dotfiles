---
name: thread
description: Pick up a Plain thread, rename the workspace branch after it, and report what happened, the impact and a verification plan for Thinh to approve.
disable-model-invocation: false
argument-hint: <plain thread URL | th_ id | T-ref>
---

# Thread

Start an investigation from a Plain thread: name the Conductor workspace after it, read the whole thread, and hand Thinh what happened, the impact and a plan to verify each bug so he can approve it before any fix starts. This skill reads and reports. It does not start investigating or fixing.

## 1. Resolve the thread

Take the `th_…` id from `$ARGUMENTS` (a URL `…/thread/th_…/` or a bare id). For a `T-12345` ref, find the id with `searchThreads`. Load the Plain tools with ToolSearch (`select:mcp__claude_ai_Plain__getThreadDetails,mcp__claude_ai_Plain__searchThreads`).

Fetch the header only, with `getThreadDetails(threadId, timelineFirst: 1)`, and take `ref`, `title`, `status`, `priority`. Done when you have all four.

## 2. Rename the branch

Conductor's sidebar title comes from the branch name, so renaming the branch renames the session. Invoking `/thread` is Thinh's go-ahead to rename.

Target: `<ref>-<slug>`, for example `T-36806-native-github-connection`. No workspace prefix.

- `<ref>`: the thread ref exactly as Plain returns it, uppercase `T`.
- `<slug>`: the 3 to 4 words of the title that name the problem, lowercase, hyphenated, ASCII only. Drop filler ("does not", "the", "issue with").

Rename with `git branch -m <target>` only when the branch is local. If `git rev-parse --abbrev-ref @{upstream}` succeeds or `gh pr view` finds a PR, leave the branch as is and note it in the output; a pushed branch would orphan its PR. Done when `git branch --show-current` prints the target, or you have recorded why it was skipped.

## 3. Read the thread

Dispatch one subagent (`model: sonnet`, `run_in_background: false`) with the prompt in [`investigate.md`](investigate.md), replacing `{{THREAD_ID}}` with the thread id. The timeline often runs past 80k characters, so it stays out of the main context. Done when the subagent returns its report.

## 4. Report

Print this as rendered markdown, never inside a code block (code blocks do not wrap, so long lines run off screen). Print nothing else:

**T-12345 · <title> · <status> · P<priority>**
Branch: `<new branch>`, or unchanged (<reason>)

**What happened**
<the subagent's SUMMARY: one paragraph, 2 to 3 sentences, no list>

**Impact**
<the subagent's IMPACT: one sentence, who is hit and how severe>

**Verification plan**
1. <bug> → Reproduce: <steps and where>. Fixed when: <observable result>. Guard: <test or check that keeps it fixed>.
2. …

Approve the plan or tell me what to change.

Write in plain English, so Thinh can repeat it to the team without decoding internal names. Keep "What happened" to 2 to 3 sentences and "Impact" to one sentence, even when the subagent returned more. Stop after the plan and wait for Thinh's approval; do not start reproducing or fixing.
