# Lenses

Apply every lens to the code in the diff. Each lens ends with a finding or a one line clearance.

Code only. CI results, merge status, review approvals, and PR process are out of scope: never report them.

- **Deploy**: does the pipeline fail? Ordering across systems (OpenTofu vs SST, migrations vs code), state imports matching live ids and names, ForceNew attributes on imported resources, `prevent_destroy` collisions, CloudFormation exports still imported by other stacks, missing env vars, permissions, secrets.
  - SST (`sst deploy`, including `--from` in CI) re-adds `ExportsOutput*` exports still imported by other stacks (`sst/stacks/deploy.js` `addInUseExports`), so a CDK automatic export rename does not fail the deploy on its own. Check that before reporting an "export in use" failure.
- **Contract**: routes, paths, methods, headers, auth and IP policy, event and stored schema fields without `.default()`, removed outputs or exports still consumed.
- **Data**: deletes, shortened retention, missing DeletionPolicy Retain, irreversible migrations.
- **Silent regression**: behaviour the old path had that the new one drops (redeploy triggers, validation, logging, metrics, alarms, tracing, warming), and imported resources whose first apply rewrites live config (rule descriptions, tags, defaults).
- **Operability**: routine future edits that will apply and do nothing (config not in a redeploy trigger, duplicated values that will drift).
- **Rollback**: what breaks if prod rolls back to the commit before this PR. Call out one way doors.
- **Blast radius**: edits to shared constants, utils, and lists that change behaviour for other callers.
- **Dead code** (severity `dead-code`): code the PR adds or leaves behind that nothing reaches. Exports with no caller, branches the new logic makes unreachable, error constructors or schema types no longer produced, parameters never read, comments or runbooks describing removed behaviour, old implementations kept beside their replacement. Prove it with a repo wide search and name the search.
- **Design** (severity `refactor`): a concrete, smaller or safer shape for code the PR adds. Duplicated logic that an existing helper already covers, a pattern the repo's `AGENTS.md` / `docs/` prescribes and the PR departs from (aggregate boundaries, event driven side effects, transactions, Result handling), or a type or abstraction that would remove a class of bug. Name the existing helper or pattern and sketch the change. Taste, naming, and formatting stay out.

Every breaking, regression, or worth-knowing finding names a concrete failure in deploy, production traffic, data, or rollback, with evidence (code reference, vendor doc, provider or library source, live read). Every dead-code or refactor finding names the exact code and the evidence that it is unreached or that the alternative exists. Report only what the author must change or verify; observations that need no action go in `checked_fine`.
