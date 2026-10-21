You are reading a Plain support thread so an engineer can decide the next investigation steps. Read and report only. Do not touch code, Datadog, or the thread itself.

Thread id: {{THREAD_ID}}

## Read the whole thread

Load the tool with ToolSearch (`select:mcp__claude_ai_Plain__getThreadDetails`). Call `getThreadDetails` with `threadId: "{{THREAD_ID}}"` and `timelineFirst: 50`, then keep calling it with `timelineCursor` set to the previous page's `endCursor` until `hasNextPage` is false.

A page can exceed the tool output limit and be saved to a file. Then slice that file with python (`open(path).read()[A:B]`) in 80,000 character spans until you have read every character. Done when every timeline entry of every page has been read, oldest to newest.

## What to extract

Read it as a case file. Customer messages, our replies, internal notes, Slack and Linear links, status changes and assignments all count. Later entries overrule earlier ones: a todo raised and then resolved is closed.

Return this, plain text, no preamble:

PROBLEM: one sentence, what the customer hit, in their terms.
STATE: one sentence, where it stands at the latest entry and who spoke last.
TIMELINE: the causal chain, 3 to 6 numbered lines, `<UTC date, time> <what changed> → <effect on the customer>`. Start at the trigger (the change that broke things), not at the customer's first message, and end at the latest fix or workaround. Name the mechanism each step went through (the gate, job, setting or event that dropped, blocked or failed). Correct the thread's own framing when a later entry disproves it.
IMPACT: the blast radius as of the latest entry:
- Who: which of the customer's users or end customers were hit, and how many (or the upper bound).
- Lost: what they lost or never got (data, threads, notifications, SLAs, access).
- Window: start and end in UTC, with the duration.
- Scale: the measured count, or "unknown" plus the step that would measure it.
- Loose ends: symptoms the customer reported that no entry followed up.
PLATFORM RISK: one sentence on whether the root cause could hit other workspaces, and why the platform let it fail silently, or "none" when the cause is specific to this customer.
MUST DOS: the engineering work still open at the latest entry: each failure the customer hit that is not yet fixed. One line each, `P<n> <todo in 10 words or fewer> → <why it fails, 12 words or fewer> (<confirmed | suspected | unknown>)`, sorted by priority:
- P1: the customer is blocked with no workaround.
- P2: the customer is impacted but has a workaround.
- P3: other work needed to close the thread.

The reason is the cause the thread's evidence points to: an internal note, a bug analysis, a log line, an error message. Tag it `confirmed` when an entry proves it, `suspected` when an entry only proposes it, and `unknown` when no entry addresses it (then write the leading lead instead).
IDS: workspace, customer, thread, Linear, PR and request IDs, error messages and timestamps the next step will need, comma separated.

Each MUST DOS line traces to a specific entry. The list holds investigation and fix work only: replies, answers, permission lists and other customer comms stay out, as do optional hardening, docs gaps and unassigned follow ups.
