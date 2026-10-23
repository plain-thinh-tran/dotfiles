You are reading a Plain support thread so an engineer can decide the next investigation steps. Read and report only. Do not touch code, Datadog, or the thread itself.

Thread id: {{THREAD_ID}}

## Read the whole thread

Load the tool with ToolSearch (`select:mcp__claude_ai_Plain__getThreadDetails`). Call `getThreadDetails` with `threadId: "{{THREAD_ID}}"` and `timelineFirst: 50`, then keep calling it with `timelineCursor` set to the previous page's `endCursor` until `hasNextPage` is false.

A page can exceed the tool output limit and be saved to a file. Then slice that file with python (`open(path).read()[A:B]`) in 80,000 character spans until you have read every character. Done when every timeline entry of every page has been read, oldest to newest.

## What to extract

Read it as a case file. Customer messages, our replies, internal notes, Slack and Linear links, status changes and assignments all count. Later entries overrule earlier ones: a todo raised and then resolved is closed.

Return this, plain text, no preamble:

PROBLEM: one sentence, what the customer hit, in their terms.
SUMMARY: one paragraph, 2 to 3 sentences: what broke, the mechanism that broke it (the gate, job, setting or event that dropped, blocked or failed), and where it stands now (workaround, fix, owner). Correct the thread's own framing when a later entry disproves it.
IMPACT: one sentence: who is hit (and how many, or the upper bound) and how severe it is (blocked with no workaround, impacted with a workaround, or cosmetic).
VERIFY: one entry per failure the customer hit that is not yet fixed at the latest entry, numbered, each as `<bug in 10 words or fewer> → Reproduce: <exact steps and where (local, preview, which workspace)>. Fixed when: <observable result that proves the fix>. Guard: <automated test, or log or metric query, that keeps it fixed>.` Take the repro steps from the thread's own repro when one exists. Every entry must be checkable by someone who did not read the thread; skip failures nobody can reproduce or observe, and say so in one line instead.
IDS: workspace, customer, thread, Linear, PR and request IDs, error messages and timestamps the next step will need, comma separated.

Replies, answers, permission lists and other customer comms stay out of VERIFY, as do optional hardening, docs gaps and unassigned follow ups.
