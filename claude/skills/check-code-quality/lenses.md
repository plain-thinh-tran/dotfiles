# Code Quality Lenses

Scope is maintainability: code smells and light refactors. Logic, correctness, behaviour, CI, deploy, rollout and security belong to prod-ready-check; a finding about them is out of scope here.

Apply every lens to every changed file. Each lens ends with a finding or a one line clearance in `checked_fine`.

- **Reinvented wheel** (severity `refactor`): every new helper, hook, component, constant, type or pattern the PR adds gets a search for an existing one that does the same job. When one exists, the PR reuses it. Name the existing export with file:line and its caller count.
- **Precedent** (severity `refactor`): when the repo already has a standard way to build this shape (a key factory, a shared menu, a drag wrapper, an error toast), the PR follows it. Where the repo has two ways, the documented one wins, else the one with more call sites. Name the precedent file and its call sites.
- **Repetition** (severity `refactor`): the same logic, JSX, keys or literals written more than once inside the PR, which should become one shared helper. Name every copy.
- **Bloat** (severity `refactor`): code that can shrink with no change in behaviour. Look for:
  - state that can be derived;
  - wrappers, props and variables that only pass values through;
  - branches for cases the types already rule out;
  - abstractions with one caller;
  - hand written logic that the standard library, the framework or an installed package already provides.

  Give the smaller version and the lines it saves.
- **Dead code** (severity `dead-code`): code the PR adds or leaves behind that nothing reaches: exports with no caller, unused params, query fields or variables nothing reads, old code kept beside its replacement. Prove it with a repo wide search and name the search.
- **Structure** (severity `refactor`): a component or module mixing concerns in a way that costs future edits (display mixed with data and actions, a helper in the wrong module). Give the smaller shape and the repo precedent for it.
- **Conventions** (severity `refactor`): departures from the repo's `AGENTS.md`, `.cursor/rules` and skills it names (UI package choice, copy casing, truthy checks, comments, hook naming). Quote the rule.

Every finding names the exact code and what it rests on: an existing helper, a precedent or a rule (file:line), or for bloat the smaller version with the lines saved. Add a sketch of the change. A change backed by none of these is taste: leave it out. Formatting stays out.
