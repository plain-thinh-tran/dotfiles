---
name: learn-taste
description: Turn the findings Thinh kept and dropped in past prod-ready-check reviews into generic taste rules that every reviewer reads.
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit
---

# Learn Taste

Reviewers keep raising findings Thinh drops. This skill distills his settled findings into generic rules in `~/.claude/skills/prod-ready-check/taste.md`, which the blind review, the debate and the Raumschiff benchmark all read next to `lenses.md`. A rule is a lesson about a class of finding, never about one PR.

1. **Gather.** Run `bun "$(dirname "$(readlink -f ~/.claude/bin/mc)")/../bench/settled.ts"`. It prints every kept and dropped finding of prod-ready-check runs that are not benchmark cases, with Thinh's reason when he gave one, and records those PRs so they never become benchmark cases. This output is the only evidence you use: findings from benchmark PRs stay unseen so the benchmark can still measure the rules. Read the current `taste.md` if it exists. Done when you have both.
2. **Distill.** Group the dropped findings by the class of concern they share (a kind of check, a kind of code, a severity that was overrated). A group becomes a candidate rule when it has at least two dropped findings, or one with a reason that states a general preference. Write each rule as one line Thinh would say to a new reviewer, naming the class and where it applies ("Missing metrics or alarms on internal admin endpoints is not worth a finding"), with no PR numbers, ticket keys or file paths. Then test each rule against every kept finding: a rule that would also have silenced a kept finding gets narrowed until it does not, or is discarded. Done when every dropped finding is either covered by a rule, already covered by `taste.md`, or left alone because it is a one off.
3. **Ask.** Push one decision per candidate with `~/.claude/bin/mc push <dir>/mc.json`: `runId` `learn-taste-<YYYY-MM-DD>`, `skill` `learn-taste`, `title` "Taste rules from past reviews", todos with `kind` `decision`, `category` `needs-you`, `title` the rule, `question` the dropped findings behind it (title and reason, one line each) and the closest kept finding it was narrowed against, `options` `accept` ("Add the rule") and `reject` ("Leave it out"). A note from Thinh rewords the rule. Start `~/.claude/bin/mc wait <runId>` with `run_in_background` and end the turn.
4. **Write.** When the answers arrive, add the accepted rules (with Thinh's wording when he gave one) to `taste.md` in this shape, and `mc resolve` each decision with what was written:

   ```markdown
   ## Taste

   Rules from findings Thinh dropped in past reviews. Leave out a finding a rule covers, unless it would break production or lose data.

   - <rule>
   ```

   Keep at most 20 rules. When an accepted rule would pass 20, or overlaps an existing one, merge them into one rule and say so in the resolution. Run `~/.claude/bin/mc done <runId>`. Done when `taste.md` holds every accepted rule and each decision is resolved.
5. **Measure.** Tell Thinh to rerun the benchmark from Raumschiff (Agents report, Benchmark, Run…). Noise should fall and kept found should hold; a drop in kept found means a rule is too broad.
