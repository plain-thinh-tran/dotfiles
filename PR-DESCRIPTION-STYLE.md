# PR Description Style

The description is lean: a reviewer reads it in under a minute and understands the change before opening the diff. Every line serves that reviewer.

Shape:

1. The `> Fixes` line (the script writes it).
2. What changed, in one sentence.
3. `## Why`: the root cause in one plain sentence, then a diagram of the flow, then numbered steps that walk the diagram in plain words, one sentence each.

Plain words describe what happens, not which function does it. Name code only where the reviewer needs it to find their way. Investigation detail (log trails, event counts, queries, prod lookups) lives in the Linear issue. Add evidence, rollout, backfill, follow ups or test notes only when the reviewer needs them to trust or ship the change.

## Picking the Diagram

Choose the diagram that shows the reviewer the flow that breaks:

| Flow | Diagram |
|------|---------|
| Actors exchanging calls over time (races, retries, ordering) | Sequence: one column per actor, arrows top to bottom |
| One path whose behaviour changed | Before and after, two short blocks |
| Data moving through stages | Pipeline: `a → b → c` |
| An entity moving between states | State transitions |

Skip it when the one sentence why already shows the flow. Draw with box characters (`│ ─ ┼ ▶ ◀`), keep columns aligned (generate it with a short script once arrows cross columns), and annotate the failing arrow at the end of its line with `✗` and the error.

## Example

````markdown
> Fixes [LINEAR-ID](linear url)

<What changed, one sentence.>

## Why

<Root cause in one plain sentence.>

```
caller                  store                  handler
    │                       │                       │
    │── write ─────────────▶│                       │
    │── call ───────────────┼──────────────────────▶│
    │                       │◀─ read ───────────────│
    │                       │── old value ─────────▶│  stale read
    │                       │◀─ act on it ──────────│
    │                       │── conflict ──────────▶│  ✗ <error code>
```

1. <One sentence per arrow group, in plain words.>
2. <...>
````

## Editing

Thinh edits descriptions on GitHub. Before `gh pr edit --body-file`, fetch the live body (`gh pr view <number> --json body -q .body`) and patch only the section you are changing. Delete leftover placeholder comments from the `create-pr.sh` skeleton.
