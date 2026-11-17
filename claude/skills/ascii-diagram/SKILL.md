---
name: ascii-diagram
description: Draw box and arrow diagrams as Unicode ASCII text for gists, PR descriptions, Slack and terminals. Use when asked for an ASCII diagram, a text diagram, or a schema, dependency, flow or sequence overview in plain text.
---

# ASCII Diagram

Render diagrams with `ascii-diagram` (installed at `~/.claude/bin/ascii-diagram`, source `scripts/asciidiagram.py`, Python stdlib only). Boxes list their content line by line, so a GraphQL type box carries its fields.

## Pick a Type

| Diagram | Use for | Command |
| --- | --- | --- |
| `layers` | Top down dependency graphs: GraphQL schema overviews, service architecture, data ownership | `ascii-diagram layers spec.json` |
| `flow` | One left to right pipeline with optional arrow labels: request path, event chain | `ascii-diagram flow spec.json` |
| `sequence` | Calls between actors over time, dashed replies, self calls | `ascii-diagram sequence spec.json` |
| `Canvas` (Python) | Anything the three above cannot place: side by side groups, back edges, exact positions | Python script, see below |

Default to `layers`. Reach for `Canvas` only after a JSON spec renders a layout you cannot fix by reordering rows.

## Steps

1. Print the starting spec: `ascii-diagram example <type>`.
2. Write the spec to a file and render it. Nodes take a string or a list of lines.
3. Read the output and fix the layout until no line crosses a box and every edge reads unambiguously. Done when the render is that clean.
4. Put the result in a fenced code block wherever it goes.

## Layers Spec

- `rows`: node ids top to bottom; order within a row is left to right. Reorder rows to untangle edges.
- `edges`: `[from, to]`, always pointing to a lower row. An edge that skips rows gets a pass through line at the right end of each row it skips.
- Edges between the same two rows that share a node merge into one bus (two parents into one child, one parent fanning out).
- Optional: `"align": "left"` (default `center`), `"hgap": 3`.
- Keep a box to the fields that carry the edges. Leave ids, timestamps and scalars out unless asked.

## Sequence Spec

`messages` entries are `[from, to, label]`; add `"dashed"` as a fourth item for replies. `from == to` draws a self call.

## Canvas

For custom layouts, script against the library:

```python
import sys, os
sys.path.insert(0, os.path.expanduser('~/.claude/skills/ascii-diagram/scripts'))
from asciidiagram import Canvas, box_size, bus

c = Canvas()
a = c.box(0, 0, ['Query {', '  hub', '}'])
b = c.box(0, a.bottom + 3, 'type Hub')
c.line([(a.cx, a.bottom), (a.cx, b.top - 1)], arrow=True)
print(c.render())
```

- `box(x, y, lines, width=None, dashed=False)` returns a `Box` with `left right top bottom cx cy` and `row(i)`, the y of content line `i`. `box_size(lines)` gives `(w, h)` before placing.
- `dashed=True` draws the border `┄ ┆`. Use it to mark what already exists against what is new, and say so in a legend under the block; colour does not survive markdown code blocks.
- Field level edges read best: start at `(box.right, box.row(i))` and end at `(target.left - 1, target.row(0))`. Keep big boxes in a left column with edges down a lane at `x = 1`, and branch small boxes (enums, scalars) to the right. Give edges from higher rows the outer lanes so they never cross.
- `line(points, arrow=False)` draws an orthogonal polyline. Starting or ending on an existing line or box border joins it (`┬ ├ ┼`); crossing another line mid segment keeps the vertical. End one cell before a box when `arrow=True`.
- `bus(canvas, sources, targets, lane_y)` draws a merge or fan out: `sources` are `(x, y)` stub starts, `targets` are `(x, y, arrow)`.
- `text(x, y, s)` writes a label over anything.
