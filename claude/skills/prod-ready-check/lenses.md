# Lenses

Apply every lens to the diff. Each lens ends with a finding or a one line clearance.

- **Deploy**: does the pipeline fail? Ordering across systems (OpenTofu vs SST, migrations vs code), state imports matching live ids and names, ForceNew attributes on imported resources, `prevent_destroy` collisions, CloudFormation exports still imported by other stacks, missing env vars, permissions, secrets.
  - SST (`sst deploy`, including `--from` in CI) re-adds `ExportsOutput*` exports still imported by other stacks (`sst/stacks/deploy.js` `addInUseExports`), so a CDK automatic export rename does not fail the deploy on its own. Check that before reporting an "export in use" failure.
- **Contract**: routes, paths, methods, headers, auth and IP policy, event and stored schema fields without `.default()`, removed outputs or exports still consumed.
- **Data**: deletes, shortened retention, missing DeletionPolicy Retain, irreversible migrations.
- **Silent regression**: behaviour the old path had that the new one drops (redeploy triggers, validation, logging, metrics, alarms, tracing, warming), and imported resources whose first apply rewrites live config (rule descriptions, tags, defaults).
- **Operability**: routine future edits that will apply and do nothing (config not in a redeploy trigger, duplicated values that will drift).
- **Rollback**: what breaks if prod rolls back to the commit before this PR. Call out one way doors.
- **Blast radius**: edits to shared constants, utils, and lists that change behaviour for other callers.
- **Gate**: failing or pending CI, unresolved review threads, changes requested, base drift on changed files.

Every finding names a concrete failure in deploy, production traffic, data, or rollback, with evidence (code reference, vendor doc, provider or library source, live read). Style, naming, and taste stay out.
