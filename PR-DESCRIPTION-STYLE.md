# PR Description Style

The description is lean: a reviewer reads it in under a minute and understands the change before opening the diff. Every line serves that reviewer.

Shape:

1. The `> Fixes` line (the script writes it).
2. What changed, in one sentence: the outcome for users or the system, not the code.
3. The terms a reader needs for the rest, as bullets right under that sentence.
4. `## Why`: what this PR unlocks, in one or two plain sentences.
5. `## Changes`: the `Before` and `Now` lines, then one line on what stays the same.
6. `## Evidence`, only when it carries substantial numbers or proves the change works in a real environment (see Evidence below). Without one, a single line on how it was checked, when it was checked against a real environment (plain:live, dev-uk).
7. `## Rollout`, only when something must happen before merge or after deploy: one bullet per action, tagged `Before merge:` or `After deploy:`.

Say each fact once. The `Before` line already shows what breaks today, so `## Why` does not restate it, and the summary sentence already says what changed, so `## Changes` does not either.

The terms come first so every later section reads without a lookup. One bullet per non trivial term (domain language, internal names like "debt", "cold sync", "hub role"), in quotes, with its plain meaning and a concrete example value. Keep it to the one to three terms the summary and the `Before` and `Now` lines actually use. Skip terms any Plain engineer knows, and terms the diagram already makes obvious (a process name like "membership sync" needs no definition when the diagram shows what it does).

`## Why` justifies the PR from the goal it serves: what it lets us or the customer do next, and why that matters. Link the parent PR or project only when the reviewer has to open it to follow. No diagram, no bullets.

`## Changes` is the `Before` and `Now` lines in a code block, one pair per behaviour that changed; mark each broken `Before` with `✗` and the error. Under it, one plain sentence on the scope that stays the same (which customers, orgs or paths see no difference). Add bullets only for an edge case a reviewer would get wrong without being told; edge cases the Evidence line or the tests already prove stay out. Never implementation steps: no function names, no removed helpers, no settings the reviewer does not have to act on. For a race or a multi actor flow, a sequence diagram follows the `Before` and `Now` lines, with numbered steps walking it.

Every sentence says what the system now does with what. No vague verbs ("leave alone", "handle", "support", "safely", "respect"): a reader can take "sync leaves hub roles alone" to mean sync stops touching the org. Write "sync ignores hub roles and still applies the workspace role" instead. When a sentence names a component, say which part of its behaviour changed and which part stays.

Plain words describe what happens, not which function does it. Name code only where the reviewer needs it to find their way. Investigation detail (log trails, raw queries, prod lookups) lives in the Linear issue; only the numbers or results that justify the PR go in `## Evidence`. Add evidence, rollout, backfill, follow ups or test notes only when the reviewer needs them to trust or ship the change.

When the change is a new rule or data shape rather than a broken flow, keep `## Changes` to the two or three points a reviewer must hold in their head (the defaults, the limits). Leave what the diff already shows (which layers carry a field, event defaults, permission checks, error codes) to the diff. Then show the rule applied to one real case from production, with the actual values in place, and end with one sentence on what that means for a user.

## Evidence

Add `## Evidence` only when it holds something a reviewer needs to trust the PR: numbers that size the problem or the gain (error counts, failed runs, timings before and after), or the result of running the change in a real environment (dev-uk, plain:live, a browser walk through). "Tests pass" or a restated diff is not evidence; leave the section out.

Shape:

- One or two sentences on the setup first: where it ran, what data it ran on, how each run started.
- Then the data, in the smallest form that holds it: a table of three or four short columns, a timing bar chart, or two or three bullets. Bold the key value in each row. No URLs, paths or query strings inside table cells; link a run id or PR number instead.
- Caveats and untested cases go in a `> [!NOTE]` callout, a hint about prod in `> [!TIP]`, never in a closing paragraph.
- Replace customer and workspace names and ids with placeholders (`Workspace A`), and never include test credentials or personal emails.

Example from a browser walk through:

```markdown
## Evidence

Same branch run locally against dev-uk, signed in as a test user whose hub links two workspaces, `Workspace A` and `Workspace B` (in picker order). Each run starts signed out and picks the hub in AuthKit; Plain's picker never showed.

| Case | Before picking the hub | Lands on |
| --- | --- | --- |
| First login | Nothing stored | **Workspace A** (first in picker) |
| Returning | Used `Workspace B`, logged out | **Workspace B** (last used) |

> [!NOTE]
> No hub workspace and pending invites are covered by unit tests only.
```

Example sizing a problem:

```markdown
## Evidence

54 failed `PR Stage - Removal` runs between 2026-10-21 and 2026-10-22:

| Cause | Runs |
| --- | --- |
| `Workspace "prNNNNN" doesn't exist` (this PR) | **31** |
| `DescribeNetworkInterfaces` 403 (infrastructure#716) | 17 |
| Other | 6 |
```

## Picking the Diagram

The `Before` and `Now` lines are the default diagram. Add a bigger one under them only when two lines cannot show the flow that breaks:

| Flow | Diagram |
|------|---------|
| Actors exchanging calls over time (races, retries, ordering) | Sequence: one column per actor, arrows top to bottom |
| Data moving through stages | Pipeline: `a → b → c` |
| An entity moving between states | State transitions |
| A ranking or ordering | Ranked list, highest first, with the values in the left column |
| The same structure for several customers | Side by side columns, shared rows aligned across them |

Draw with box characters (`│ ─ ┼ ▶ ◀`), keep columns aligned (generate it with a short script once arrows cross columns), and annotate the failing arrow at the end of its line with `✗` and the error. Show nesting with `├─` and `└─` indented under the parent.

Keep every diagram line under 80 characters so GitHub shows it without a horizontal scrollbar. Name each step in words ("Plain's picker", "last used hub workspace"), not by URL or query string, and leave out hops the reviewer does not need. When a line is still too long, shorten the words before splitting the flow across lines:

```
Before  pick hub ─▶ Plain's picker ─▶ pick again   ✗
After   pick hub ─▶ last used hub workspace
```

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

Plain now picks the highest priority role when the IdP gives someone several.

- A "role slug" is the id WorkOS sends Plain for a role, like `viewer` or `billing-team`, mapped from the customer's IdP groups.
- A "priority" is a number on each Plain role, from Owner 5000 down to None 1000. The highest one wins.

## Why

Customers manage access through IdP groups, so a user in a Viewer group and a custom role group has to end up on the custom role for custom roles to be usable at all.

## Changes

```
Before   WorkOS ── role  = viewer ────────────────────────────────────▶ Plain: Viewer        ✗ custom role lost
Now      WorkOS ── roles = [viewer, billing team] ── highest priority ─▶ Plain: Billing team
```

Users with a single role sync exactly as today.

Checked on dev-uk with plain:live: the same user got Viewer on main and the custom role on this branch.

## Rollout

- Before merge: set the SpaceXSI and Vercel priorities, so their roles above Support keep winning.
- After deploy: run `backfillWorkOSMemberships` for the 16 affected orgs.
````

Race variant, when the flow needs a sequence diagram:

````markdown
## Changes

```
Before   <one line, ending in ✗ and the error>
Now      <one line>

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
