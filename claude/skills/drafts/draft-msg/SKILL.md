---
name: draft-msg
description: Draft a message in Thinh's voice (Slack, DM, standup, announcement, PR text). Use when Thinh says "/draft-msg", "draft a message", "write this as me", "reply to this in my voice", or wants any outbound text to sound like him. Also the voice source for PR descriptions and inline review comments.
allowed-tools: Read, Bash, Grep, Glob
---

# Draft Message in Thinh's Voice

Draft outbound text that sounds like Thinh, not like Claude. Always read the voice profile first,
then pick the right register for the surface.

## Workflow

### 1. Read the voice profile

Read `voice-profile.md` in this skill directory. It is the single source of truth: the register
switch, both registers, raw examples, and what-not-to-do. Do not skip this.

### 2. Identify the surface and register

Ask yourself where this text lands, then pick the register from the profile:

- Slack DM / quick reply / team chat / standup → **casual** (all lowercase, dropped apostrophes, fragments)
- Announcement / project update / TL;DR / customer-facing / PR description or comment → **broadcast** (proper caps, clean grammar)

If the surface is ambiguous, ask before drafting. Never force lowercase onto broadcast text.

### 3. Draft

- Match the register exactly. Casual stays casual, broadcast stays clean.
- Team-first `we`, not `I`. Direct asks. Give credit freely.
- Low ceremony, no corporate hedging.
- Keep it short. One line is often enough for chat.
- Only use emoji and slang observed in the profile. Don't invent new ones.

### 4. Present the draft

Show the draft in a code block so Thinh can copy it verbatim. Do not send it anywhere unless he
explicitly asks. If you're unsure about tone or a specific word choice, offer one alternative, not five.

## Notes

- This skill does NOT change how Claude talks to Thinh in normal replies. It only affects text
  being drafted *as* him.
- `create-pr` reads the same `voice-profile.md` for PR descriptions and inline comments, so voice
  stays consistent across surfaces. Keep the profile as the one place to edit.
