---
name: guide
description: Generate a deep implementation guide for a task instead of coding it. Use when user wants to understand and implement a change themselves, wants a tutorial, or says "guide me" / "teach me" / "write me a guide".
allowed-tools: Bash(read-only), Read, Grep, Glob, Agent, Write
---

# Implementation Guide Generator

Generate a comprehensive, tutorial-style implementation guide that teaches the developer everything they need to understand and implement a change themselves.

## Philosophy

This skill exists for when the developer wants to stay hands-on. Instead of writing code, you produce a document that:
- **Teaches** the surrounding system deeply — not just what to change, but why things are the way they are
- **Explains rationale** behind architectural decisions so the developer can make good judgment calls
- **Provides step-by-step instructions** detailed enough to follow but not so rigid they can't be adapted
- **Surfaces gotchas and edge cases** the developer would hit if they went in blind

The output should feel like a senior engineer sitting next to you, walking you through the codebase before you start coding.

## Workflow

### 1. Understand the request

Ask clarifying questions if the task is ambiguous. You need to know:
- What the user wants to achieve
- Any constraints or preferences they have
- How deep they want the guide to go (default: very deep)

### 2. Deep codebase exploration

Use the Explore agent extensively. Launch multiple agents in parallel to cover:
- The files and modules directly involved in the change
- Adjacent systems that interact with or are affected by the change
- Existing patterns, utilities, and conventions that should be followed
- Tests, configs, and infrastructure related to the change
- Historical context: recent commits, related PRs, or past decisions in the area

Be thorough. Read full files, trace call chains, understand data flow. This step should take significant time — that's expected. The quality of the guide depends on the depth of exploration.

### 3. Think deeply

Use extended thinking (ultrathink) to:
- Synthesize everything you've learned into a coherent mental model
- Identify the optimal implementation approach and alternatives you considered
- Anticipate problems, edge cases, and common mistakes
- Decide what the developer most needs to understand vs. what's noise

### 4. Write the guide

Write the guide to `.context/guide.md` in the current project directory (create `.context/` if needed). This path is gitignored and easily accessible in Cursor.

If the user specifies a different output path, use that instead.

## Guide Structure

The guide MUST follow this structure. Every section should be substantial — this is not a quick summary.

```markdown
# Implementation Guide: <Task Title>

## Background & Context

<Explain the broader system this change lives in. What does this part of the codebase do?
How does it fit into the overall architecture? What are the key abstractions and data flows?
Include diagrams (text-based) if they help. The developer should finish this section
understanding the "world" they're about to work in.>

## Why We're Doing This

<The motivation. What problem exists today? What's the impact? Why now?
If there were previous approaches or discussions, mention them.
Help the developer understand the "why" deeply enough to make good decisions
when they inevitably need to deviate from the plan.>

## Key Files & Components

<For each file/module involved, explain:
- What it does and its role in the system
- Key functions/classes and what they're responsible for
- How it connects to other parts of the system
- Anything non-obvious about how it works

Include file paths and line references. The developer will have these open in Cursor.>

## Existing Patterns to Follow

<Document the conventions and patterns already established in the codebase that
this change should follow. Show concrete examples from existing code.
This prevents the developer from reinventing the wheel or breaking consistency.>

## Implementation Plan

### Step 1: <Descriptive step name>

<For each step:
- What to do and where
- Why this step matters / what it achieves
- Code snippets showing the expected shape of the change (not copy-paste-ready,
  but enough to guide)
- What to watch out for
- How to verify this step works before moving on>

### Step 2: ...

<Continue for all steps. Order matters — dependencies between steps should be clear.>

## Edge Cases & Gotchas

<Things that will bite the developer if they're not careful:
- Subtle interactions between systems
- Common mistakes in this area of the codebase
- Performance considerations
- Error handling requirements
- Things that look like they should work but don't (and why)>

## Testing & Verification

<How to verify the implementation is correct:
- What to test manually
- What automated tests to write or update
- How to validate in staging/production
- What signals indicate success vs. subtle breakage>

## Further Reading

<Links to relevant docs, PRs, Linear issues, or external references
that would help the developer go even deeper if they want to.>
```

## Rules

1. **Read-only exploration.** Do not modify any project files except the guide output.
2. **Be exhaustive.** The guide should be long and detailed. 2000+ words is normal. The developer asked for depth — deliver it.
3. **Teach, don't just instruct.** Explain *why* at every level, not just *what*.
4. **Use real code references.** Point to actual files, functions, and line numbers in the codebase.
5. **Show existing patterns.** When the codebase already has a convention for something, show a concrete example the developer can follow.
6. **Be opinionated.** Recommend the best approach, explain why, and note alternatives you considered and rejected.
7. **Surface non-obvious knowledge.** The most valuable parts of the guide are things the developer wouldn't discover on their own without significant exploration.
8. **No fluff.** Every paragraph should teach something. Dense information, not padding.
