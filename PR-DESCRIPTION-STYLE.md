# PR Description Style

The description is lean: a reviewer reads it in under a minute and understands the change before opening the diff. Every line serves that reviewer.

Shape:

1. The `> Fixes` line (the script writes it).
2. What changed, in one sentence.
3. `## Why`: what this PR brings, then what happens today without it, then a diagram, then two or three bullets.
4. One line on how it was checked, when it was checked against a real environment (plain:live, dev-uk).
5. `## Rollout`, only when something must happen before merge or after deploy: one bullet per action, tagged `Before merge:` or `After deploy:`.

`## Why` opens with "This PR lets/makes …": the outcome for users or the system, not the code. The next sentence is the problem today, in plain words. The bullets say where the change applies and which edge cases it handles, one sentence each. They are not implementation steps: no function names, no removed helpers, no settings the reviewer does not have to act on. For a race or a multi actor flow, the numbered steps that walk a sequence diagram still replace the bullets.

Plain words describe what happens, not which function does it. Name code only where the reviewer needs it to find their way. Investigation detail (log trails, event counts, queries, prod lookups) lives in the Linear issue. Add evidence, rollout, backfill, follow ups or test notes only when the reviewer needs them to trust or ship the change.

When the change is a new rule or data shape rather than a broken flow, keep `## Why` to the outcome and problem sentences plus the two or three points a reviewer must hold in their head (the defaults, the limits). Leave what the diff already shows (which layers carry a field, event defaults, permission checks, error codes) to the diff. Then show the rule applied to one real case from production, with the actual values in place, and end with one sentence on what that means for a user.

## Picking the Diagram

Choose the diagram that shows the reviewer the flow that breaks:

| Flow | Diagram |
|------|---------|
| Actors exchanging calls over time (races, retries, ordering) | Sequence: one column per actor, arrows top to bottom |
| One path whose behaviour changed | Before and after, two short blocks |
| Data moving through stages | Pipeline: `a → b → c` |
| An entity moving between states | State transitions |
| A ranking or ordering | Ranked list, highest first, with the values in the left column |
| The same structure for several customers | Side by side columns, shared rows aligned across them |

Skip it when the one sentence why already shows the flow. Draw with box characters (`│ ─ ┼ ▶ ◀`), keep columns aligned (generate it with a short script once arrows cross columns), and annotate the failing arrow at the end of its line with `✗` and the error. Show nesting with `├─` and `└─` indented under the parent.

Prefer an ASCII block over a markdown table whenever a cell would need a list or `<br>`. A note that is only a reminder for Thinh is a sentence, not a table.

Ranked list example:

```
5000  Owner
4000  Admin
3000  Support
2501    ├─ v0 SME
2500    └─ CSE
2000  Viewer
1000  None
```

## Examples

````markdown
> Fixes [LINEAR-ID](linear url)

<What changed, one sentence.>

## Why

This PR lets Plain decide which role wins when the IdP gives someone several. Today WorkOS decides, and it ranks every new custom role below Viewer, so a user in both a Viewer group and a custom role group lands on Viewer.

```
Before   WorkOS ── role  = viewer ────────────────────────────────────▶ Plain: Viewer        ✗ custom role lost
After    WorkOS ── roles = [viewer, billing team] ── highest priority ─▶ Plain: Billing team
```

- Webhook sync, hub sync and the membership backfill all rank roles the same way.
- A role whose custom role was deleted in Plain is skipped instead of failing the person's sync.

Checked on dev-uk with plain:live: the same user got Viewer on main and the custom role on this branch.

## Rollout

- Before merge: set the SpaceXSI and Vercel priorities, so their roles above Support keep winning.
- After deploy: run `backfillWorkOSMemberships` for the 16 affected orgs.
````

Race variant, when the flow needs a sequence diagram:

````markdown
## Why

This PR <outcome>. Today <root cause in one plain sentence>.

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
