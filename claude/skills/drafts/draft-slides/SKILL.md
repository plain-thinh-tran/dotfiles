---
name: draft-slides
description: Build a concise Plain branded HTML slide deck for an internal engineering presentation, with click through builds and architecture diagrams. Use when asked for slides, a deck or a presentation to show engineers a feature, a system or a change.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Draft Slides

A deck is one self-contained HTML file: a 1920x1080 stage scaled to the window, Plain palette,
keyboard and click navigation, and click through builds. Start from
[`template.html`](template.html); it carries the styles, the diagram primitives and the
navigation, so you only write slides.

## Concise

The audience is engineers in a live session, so every slide carries one claim and the speaker
carries the rest.

- 3 to 5 slides. Each headline is the claim, in title case.
- At most 3 cards or 4 bullets per slide, one sentence each. Prefer a diagram over text.
- Box labels are a name plus one short detail line.
- Diagrams use fictional people (Maya, Omar, Priya) and example services, never colleagues.
- Commas, periods or `→` in place of em dashes; compound modifiers unhyphenated.

## Steps

1. **Outline.** One line per slide: its claim and its visual. Verify every technical claim
   against the code, and mark claims that describe the vision rather than current behaviour.
   Done when every claim has a source or a vision mark.
2. **Build.** Copy the template to `.context/<topic>-slides/index.html` and replace its example
   slides. Inline the Plain logomark SVG on the title slide (from
   `shipvideo-local/local/assets/plain/logo/logomark/default.svg`).
   - **Builds**: give elements `data-step="n"`; step 0 shows on arrival, each click reveals the
     next number. Steps are per slide.
   - **Diagrams**: absolutely positioned `.node` and `.group` boxes inside `.flow`, one SVG
     overlay per slide for arrows. Give each slide's `<marker>` elements unique ids (`a2`,
     `a3`): a reused id resolves to the first slide's marker, which is hidden, so every later
     arrowhead disappears. Leave at least 70px between boxes an arrow joins, end every arrow on
     a box edge, and keep `.lbl` labels clear of arrowheads and group borders.
3. **Inspect.** Run `scripts/setup.sh` from the `draft-videos` skill once (it provides
   Playwright), then this skill's `scripts/shoot.mjs index.html shots`. It
   screenshots every slide at every build step. Read each PNG and fix overflow past the slide
   edge, wrapped labels, overlaps and hidden arrows, then shoot again. Done when every state
   reads cleanly.
4. **Deliver.** Delete the shots, copy the deck to `~/Desktop/<topic>-slides.html`, `open` it,
   and report the slide list, the build steps, and any vision claim.
