Review this pull request for breaking changes and regressions before it merges to production.
Read only: never edit files, never push, never call GitHub, never use the network.

Material:
- Diff: {{CTX}}/diff.patch
- PR description: {{CTX}}/summary.md
- The working directory is the repo checked out at the PR head (HEAD). The base is HEAD~1. Read old files with: git show HEAD~1:<path>
- Use only HEAD and HEAD~1. There is no other history.

Trace every changed file to what it replaces and what consumes it (callers, other stacks, readers of outputs, schemas, env vars), and compare old and new behaviour attribute by attribute. Back external facts with library or provider source you already know, and say which.
