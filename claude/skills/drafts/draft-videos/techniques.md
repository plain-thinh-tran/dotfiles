# Scene Techniques

Patterns that render correctly under the shipvideo-local renderer. The renderer pauses every CSS
animation and sets its `currentTime` from a virtual clock, so all timing lives in
`animation-delay` and every state must be reachable by seeking.

## Generator Helpers

Write the scene through a small Node generator (`gen.mjs`) so timings are computed, not hand
typed. These helpers carry the patterns below:

```js
const f = (n) => `${n.toFixed(3)}s`;
const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Typed text: returns html and the time typing ends, so the next beat can chain off it.
const typed = (text, t, cps = 20) => {
  const n = [...text].length;
  const dur = Math.max(0.2, n / cps);
  return {
    end: t + dur,
    html: `<span class="ty" style="--n:${n};animation:type ${f(dur)} steps(${n},end) ${f(t)} both">${esc(text)}</span>`,
  };
};

// A line that appears at t (null = visible from the start of its scene).
const line = (html, t, extra = '') =>
  t === null
    ? `<div class="ln on ${extra}">${html}</div>`
    : `<div class="ln ${extra}" style="animation-delay:${f(t)}">${html}</div>`;

const cursor = (show, hide) =>
  `<span class="cur" style="animation:appear .001s steps(1) ${f(show)} both, blink 1s linear ${f(show)} infinite${hide !== undefined ? `, gone .001s steps(1) ${f(hide)} forwards` : ''}"></span>`;

// A scene that fades in at start and out at end (null = holds to the last frame).
const scene = (start, end, inner) =>
  `<section class="scene" style="animation:sceneIn .5s cubic-bezier(.2,.7,.2,1) ${f(start)} both${end !== null ? `, sceneOut .45s ease-in ${f(end - 0.45)} forwards` : ''}">${inner}</section>`;
```

Print the computed scene boundaries and total from the generator, and write `scene.json` with
`Math.ceil(total)`.

## CSS Core

```css
.scene{position:absolute;inset:0}
.ln{height:0;overflow:hidden;white-space:pre;text-overflow:ellipsis;line-height:var(--lh);animation:grow .001s steps(1) both}
.ln.on{height:var(--lh);animation:none}
.ty{display:inline-block;overflow:hidden;white-space:pre;vertical-align:top;width:0}
.cur{display:inline-block;width:.6em;height:1.15em;vertical-align:-.2em;background:#1BD379;opacity:0}
@keyframes sceneIn{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
@keyframes sceneOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-18px)}}
@keyframes pop{from{opacity:0;transform:translateY(16px) scale(.985)}to{opacity:1;transform:none}}
@keyframes grow{from{height:0}to{height:var(--lh)}}
@keyframes type{from{width:0}to{width:calc(var(--n)*1ch)}}
@keyframes appear{from{opacity:0}to{opacity:1}}
@keyframes gone{from{opacity:1}to{opacity:0}}
@keyframes blink{0%,49.9%{opacity:1}50%,100%{opacity:0}}
```

## Rules That Bite

- **Stacked animations on one property**: the later one in the list wins while active. Give the
  entry animation `both` fill and the exit animation `forwards` fill, so the exit does not
  backfill over the entry before its start time.
- **Typing** relies on monospace and `ch` units; it only lines up in a monospace font.
- **Scrolling panes** (terminal output, TUI log panes): a fixed height box with
  `display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden`, lines growing
  from height 0. Set `flex:none` on the lines, otherwise flex shrinks every line instead of
  pushing old ones out.
- **Swapping a whole screen** (shell prompt → full screen TUI): one layer `gone` and the other
  `appear` at the same time, both `steps(1)`.
- **Highlight a line** with a short background keyframe (`rgba(27,211,121,.3)` fading to `.1`).
- **Long lines** truncate with `text-overflow:ellipsis`; when the important part sits at the end
  of a line (a status code, a byte count), widen the window or stack windows vertically instead.
- Text must never clip: leave line height headroom and keep transforms inside padded containers.

## Product Realism

When the film shows a terminal, a log or generated code, take the strings from the source:
grep the log calls and formatters, copy the real pane titles, ordering and field formats. Invent
only identifiers (account IDs, request IDs, URLs), and make them obviously fake.
