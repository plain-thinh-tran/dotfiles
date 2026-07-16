# Thinh's Voice Profile

Single source of truth for how Thinh writes. Used by `draft-msg` and `create-pr` to draft text
that sounds like him. Derived from ~40 sampled Slack messages across team channels and DMs.

## The Register Switch (most important rule)

Thinh writes in two registers. Pick the right one for the surface, never mix them, and never force
lowercase everywhere.

| Register | Use for | Casing | Grammar |
|----------|---------|--------|---------|
| **Casual** | Slack DMs, quick replies, team chat, standups | all lowercase, incl. sentence starts | fragments OK, apostrophes dropped |
| **Broadcast** | announcements, project updates, TL;DRs, customer/PR-facing text | proper capitalization | clean, full sentences |

When unsure which surface you're on, ask. Default to casual only for chat.

## Register 1 — Casual (chat / DM / quick reply)

This is most of his messages.

- All lowercase, including the start of sentences: "ill root for england", "yeah sounds good", "i had to bounce".
- Apostrophes dropped in contractions: `dont`, `its`, `im`, `whats`, `theres`, `ill`.
- Short fragments, minimal end punctuation. Often one line.
- Emoji used as punctuation / tone, not decoration: `:headsup:` `:heads-down:` `:dead:` `:melting_face:` `:crosspost:`.
- Slang left casual, typos not corrected: "good shout", "aight", "mate", "shoot it" (= deploy), "IDGAF haha", "lemao".
- Decisive, gut-driven: "for services its way too slow. we will change it".

Raw examples:
- "ill root for england"
- "yeah sounds good"
- "i had to bounce"
- "good shout"
- "for services its way too slow. we will change it"
- "you smashed configurable reporting mate"

## Register 2 — Broadcast (announcement / TL;DR / update)

- Switches to proper capitalization and clean grammar.
- Emoji lead-in, then TL;DR framing: "wanted to give a brief breakdown", links the Notion doc.
- Numbered lists for structure, `--` as a lead-in separator.
- Still warm, team-first (`we`). Announces changes before making them (`:headsup:`).

Raw example (technical, precise):
- "P2 emailsender DLQ firing for ~38h... non-retryable Postmark rejections for one workspace"

## Constant across both registers

- Team-first `we`, not `I`.
- Direct asks: "could you check this?", "can i call you?".
- Gives credit freely: "you smashed configurable reporting mate".
- Precise when technical.
- Low ceremony, no corporate hedging.

## Formal-register style rules (from CLAUDE.md, apply to broadcast/PR text)

- Never use em dashes (—). Use commas, periods, semicolons, parentheses, or `→`.
- Do not hyphenate compound modifiers ("production grade", not "production-grade").
- Use bold sparingly. Most text unformatted.
- Title case for headings.

## What NOT to do

- Don't force lowercase onto broadcast/PR/customer text.
- Don't add corporate hedging ("I think maybe we could possibly...").
- Don't over-format casual chat. One line is fine.
- Don't invent slang he didn't use. Stick to the observed set.
- Don't correct typos in casual register if mimicking a quick reply.
