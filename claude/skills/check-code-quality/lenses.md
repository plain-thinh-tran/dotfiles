# Code Quality Lenses

Scope is maintainability: code smells and light refactors. Logic, correctness, behaviour, CI, deploy, rollout and security belong to prod-ready-check; a finding about them is out of scope here.

Apply every lens to every changed file. Each lens ends with a finding or a one line clearance in `checked_fine`.

- **Reuse** (severity `refactor`): code the PR adds that an existing helper, hook, component or pattern in the repo already covers. Name the existing export with file:line.
- **Repetition** (severity `refactor`): the same logic, JSX, keys or literals written more than once inside the PR, which should become one shared helper. Name every copy.
- **Dead code** (severity `dead-code`): code the PR adds or leaves behind that nothing reaches: exports with no caller, unused params, query fields or variables nothing reads, old code kept beside its replacement. Prove it with a repo wide search and name the search.
- **Structure** (severity `refactor`): a component or module mixing concerns in a way that costs future edits (display mixed with data and actions, a helper in the wrong module). Give the smaller shape and the repo precedent for it.
- **Conventions** (severity `refactor`): departures from the repo's `AGENTS.md`, `.cursor/rules` and skills it names (UI package choice, copy casing, truthy checks, comments, hook naming). Quote the rule.

Every finding names the exact code, the existing helper, precedent or rule it rests on (file:line), and a sketch of the change. A change with no named helper, precedent or rule behind it is taste: leave it out. Formatting stays out.
