---
name: show-me
description: Record a short demo of only the features this session built and embed it in the Raumschiff chat as a playable clip. Use when Thinh sends "/show-me", presses Show me in Raumschiff, or says "show me", "record a demo", "show me what you built", "paste the video in here".
---

# Show Me

Thinh wants to see what you built, played inline in his Raumschiff chat. Record it, then embed it. Do not ask first.

## Scope

- Only the features this session implemented. Read `git diff origin/main...` and your own turns to list them; skip setup, login and anything unchanged.
- 15 to 45 seconds. One pass through each feature, slow enough to read, no dead time.
- Text after `/show-me` narrows it (a feature, a page, a flow). Follow it.
- Nothing visual changed (backend, CLI, infra)? Record the terminal or the output that proves it works, or say in one line that there is nothing to show and why.

## Record

Pick the first that fits:

1. Web UI: chrome-devtools MCP. Open your own tab with `new_page`, log in before `screencast_start` (never record a password), drive the flow, `screencast_stop`, close your tab.
2. Raumschiff itself: `macos/drive.ts` (launch, drive the view, `shot <name>` after each step), then step 4.
3. A native app or anything else you can screenshot.
4. Only screenshots: stitch them into a clip, about 1.5 seconds each:
   `ffmpeg -y -framerate 2/3 -pattern_type glob -i '<dir>/*.png' -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" -r 30 <out>.mp4`

Save the clip under the workspace's `.context/demos/` (create it), with a name that says what it shows. Extension `.mp4`, `.mov` or `.webm`. Check it plays: `ffprobe -v error -show_entries format=duration -of csv=p=0 <file>` prints a duration.

## Reply

One caption line per clip saying what it shows, then the clip on its own line:

![](</absolute/path/to/clip.mp4>)

- Absolute path, no `~`, no backticks around it. Raumschiff renders it as a player.
- A still that matters more than motion can go in the same way as a `.png`.
- Never `open` the file on the Mac, never offer Slack or another channel, never say the chat only takes text.
