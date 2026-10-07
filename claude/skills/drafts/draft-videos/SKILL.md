---
name: draft-videos
description: Render a short Plain branded motion video (MP4) from a scripted HTML scene, for LinkedIn posts or internal announcements. Use when asked for a launch video, demo video, supercut, motion design or animated walkthrough of a feature or flow.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Draft Videos

A film is one 1920x1080 HTML document animated with CSS keyframes only, rendered frame by frame
by `team-plain/shipvideo-local` (headless Chromium + ffmpeg). You write the scene; the renderer
turns it into an MP4.

## Pacing

Short film, unhurried beats. The viewer must be able to read every frame that matters.

- One idea per scene; cut any scene the story survives without.
- Hold every scene for at least 2.5s after its last element lands. Hold text for about 1s per 4
  words on top of the animation.
- Type commands at about 20 characters per second; reveal log lines 0.3 to 0.6s apart.
- Scene transitions are 0.45s fades, never faster.
- Target 30 to 60s total. LinkedIn: open on the payoff in the first 3s. Announcement: open on a
  title card naming the change.

## Steps

1. **Storyboard.** Write the beats as a list (scene, what appears, seconds) and confirm the facts
   behind each one. When the film shows a product, read its source for the real output strings
   (see Product Realism in [`techniques.md`](techniques.md)). Done when every beat has a
   duration and a source for its content.
2. **Set up the renderer.** Run this skill's [`scripts/setup.sh`](scripts/setup.sh); it prints the
   shipvideo-local directory (`$SHIPVIDEO_DIR`, default `~/workspace/shipvideo-local`). Read
   `local/plain-brand.mjs` there for the brand direction and take the logo from
   `local/assets/plain/`.
3. **Write the generator.** Work in `.context/<topic>-video/`. Write `gen.mjs` that emits
   `scene.html` and `scene.json`, using the helpers and CSS in [`techniques.md`](techniques.md).
   The scene contract the renderer enforces: CSS keyframes for all motion, inline SVG for the
   logo, Google Fonts as the only external resource (no `<script>`, `<img>`, `<video>`,
   `<iframe>`, CSS transitions, inline handlers or `Math.random`).
4. **Check.** `node $SHIPVIDEO_DIR/local/render.mjs --check scene.html <seconds>` must report
   `"ok": true`.
5. **Inspect frames.** Run this skill's `scripts/snap.mjs scene.html frames <t1> <t2> ...` with one time near
   the end of every scene, then Read each PNG. Fix clipping, overflow, overlap, squashed lines
   and unreadable holds, then snap again. Done when every scene's final frame reads cleanly.
6. **Render.** `node $SHIPVIDEO_DIR/local/render.mjs --render scene.html <seconds> <name>.mp4`
   (about real time), copy the MP4 to `~/Desktop`, delete the frames.
7. **Report** the path, duration and size, which content is invented (IDs, URLs) and any fact
   you could not verify.
