#!/usr/bin/env python3
"""
deploy-doctor - diagnose and repair SST PR-stage deploy failures.

Two failure modes that look like "the deploy is broken" but are not caused by
the PR's code. Both waste a lot of time if you retrigger instead of diagnosing.

  drift     CloudFormation still believes SQS queues exist, but they were
            deleted out of band. Every deploy then fails creating Lambda event
            source mappings with AWS.SimpleQueueService.NonExistentQueue, and
            cascades DEPENDENCY_FAILED into most other stacks. Reruns cannot
            fix it: pre-deploy-cleanup only deletes stacks in a failed state,
            and the state stacks holding the queues look healthy.

  artifact  The SST build artifact from an earlier run attempt can no longer be
            downloaded ("404 Not Found: workflow run not found" from
            GetSignedArtifactURL), while it still lists as present, so the
            check job keeps skipping the build and the deploy keeps trying to
            download something it cannot fetch.

Both default to read-only. Pass --repair / --fix to act.
"""

import argparse
import json
import subprocess
import sys

QUEUE = "AWS::SQS::Queue"
QUEUE_POLICY = "AWS::SQS::QueuePolicy"

# CFN queue properties that are not SQS SetQueueAttributes attributes.
NON_ATTRIBUTE_PROPS = {"QueueName", "Tags"}


class Unresolved(Exception):
    pass


def sh(args, check=True):
    p = subprocess.run(args, capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(args)}\n{p.stderr.strip()}")
    return p.stdout.strip()


def aws(args, profile, region, check=True):
    base = ["aws"]
    if profile:
        base += ["--profile", profile]
    if region:
        base += ["--region", region]
    out = sh(base + args + ["--output", "json"], check=check)
    return json.loads(out) if out else None


def gh(args, check=True):
    # GH_TOKEN in the environment breaks gh auth in this setup.
    p = subprocess.run(
        ["gh"] + args, capture_output=True, text=True, env=_env_without_gh_token()
    )
    if check and p.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)}\n{p.stderr.strip()}")
    return p.stdout.strip()


def _env_without_gh_token():
    import os

    env = dict(os.environ)
    env.pop("GH_TOKEN", None)
    return env


# ---------------------------------------------------------------- drift


def stage_stacks(stage, profile, region):
    data = aws(["cloudformation", "describe-stacks"], profile, region)
    prefix = f"{stage}-services"
    return [
        (s["StackName"], s["StackStatus"])
        for s in data["Stacks"]
        if s["StackName"].startswith(prefix)
    ]


def stack_resources(stack, profile, region):
    out = []
    token = None
    while True:
        args = ["cloudformation", "list-stack-resources", "--stack-name", stack]
        if token:
            args += ["--starting-token", token]
        data = aws(args, profile, region)
        out += data["StackResourceSummaries"]
        token = data.get("NextToken")
        if not token:
            break
    return [r for r in out if r["ResourceStatus"] != "DELETE_COMPLETE"]


def existing_queue_names(stage, profile, region):
    names = set()
    token = None
    while True:
        args = ["sqs", "list-queues", "--queue-name-prefix", stage]
        if token:
            args += ["--starting-token", token]
        data = aws(args, profile, region)
        if not data:
            break
        for url in data.get("QueueUrls", []):
            names.add(url.rsplit("/", 1)[-1])
        token = data.get("NextToken")
        if not token:
            break
    return names


def find_drift(stage, profile, region):
    """Return [(stack, logical_id, queue_name)] for queues CFN has but SQS does not."""
    live = existing_queue_names(stage, profile, region)
    missing = []
    for stack, _status in stage_stacks(stage, profile, region):
        for r in stack_resources(stack, profile, region):
            if r["ResourceType"] != QUEUE:
                continue
            name = r["PhysicalResourceId"].rsplit("/", 1)[-1]
            if name not in live:
                missing.append((stack, r["LogicalResourceId"], name))
    return missing


# ------------------------------------------------------------- resolving


class StackContext:
    """Resolves CFN intrinsics against a deployed stack's real resources."""

    def __init__(self, stack, profile, region, account):
        self.stack = stack
        self.profile = profile
        self.region = region
        self.account = account
        res = stack_resources(stack, profile, region)
        self.physical = {r["LogicalResourceId"]: r["PhysicalResourceId"] for r in res}
        self.types = {r["LogicalResourceId"]: r["ResourceType"] for r in res}
        body = aws(
            [
                "cloudformation",
                "get-template",
                "--stack-name",
                stack,
                "--query",
                "TemplateBody",
            ],
            profile,
            region,
        )
        if isinstance(body, str):
            body = json.loads(body)
        self.template = body
        self.resources = body.get("Resources", {})

    def arn_for(self, logical):
        rtype = self.types.get(logical)
        pid = self.physical.get(logical)
        if pid is None:
            raise Unresolved(f"{logical} has no physical id in {self.stack}")
        if rtype == QUEUE:
            name = pid.rsplit("/", 1)[-1]
            return f"arn:aws:sqs:{self.region}:{self.account}:{name}"
        if rtype == "AWS::KMS::Key":
            return f"arn:aws:kms:{self.region}:{self.account}:key/{pid}"
        if rtype == "AWS::S3::Bucket":
            return f"arn:aws:s3:::{pid}"
        if rtype == "AWS::SNS::Topic":
            return pid
        raise Unresolved(f"no Arn rule for {rtype} ({logical})")

    def export(self, name):
        data = aws(
            [
                "cloudformation",
                "list-exports",
                "--query",
                f"Exports[?Name=='{name}'].Value",
            ],
            self.profile,
            self.region,
        )
        if not data:
            raise Unresolved(f"export {name} not found")
        return data[0]

    def resolve(self, node):
        if isinstance(node, dict):
            if len(node) == 1:
                (key, val), = node.items()
                if key == "Ref":
                    if val not in self.physical:
                        raise Unresolved(f"Ref {val} not in {self.stack}")
                    return self.physical[val]
                if key == "Fn::GetAtt":
                    logical, attr = val if isinstance(val, list) else val.split(".", 1)
                    if attr != "Arn":
                        raise Unresolved(f"Fn::GetAtt {logical}.{attr} unsupported")
                    return self.arn_for(logical)
                if key == "Fn::ImportValue":
                    return self.export(self.resolve(val))
            return {k: self.resolve(v) for k, v in node.items()}
        if isinstance(node, list):
            return [self.resolve(v) for v in node]
        return node


# ---------------------------------------------------------------- repair


def queue_plan(ctx, logical):
    props = ctx.resources[logical]["Properties"]
    name = props["QueueName"]
    attributes = {}
    for k, v in props.items():
        if k in NON_ATTRIBUTE_PROPS:
            continue
        resolved = ctx.resolve(v)
        # SQS wants these as JSON strings, CFN declares them as objects.
        if k in ("RedrivePolicy", "RedriveAllowPolicy"):
            resolved = json.dumps(resolved)
        attributes[k] = str(resolved) if not isinstance(resolved, str) else resolved
    tags = {t["Key"]: t["Value"] for t in props.get("Tags", [])}
    return name, attributes, tags


def policies_for(ctx, queue_logicals):
    """[(queue_logical, policy_json)] for QueuePolicy resources targeting these queues."""
    out = []
    for logical, res in ctx.resources.items():
        if res.get("Type") != QUEUE_POLICY:
            continue
        props = res.get("Properties", {})
        for q in props.get("Queues", []):
            target = q.get("Ref") if isinstance(q, dict) else None
            if target in queue_logicals:
                doc = ctx.resolve(props["PolicyDocument"])
                out.append((target, json.dumps(doc)))
    return out


def repair(stage, profile, region, missing, apply_changes):
    account = aws(
        ["sts", "get-caller-identity", "--query", "Account"], profile, region
    )
    contexts = {}
    by_stack = {}
    for stack, logical, name in missing:
        by_stack.setdefault(stack, []).append((logical, name))

    plans = []
    for stack, entries in by_stack.items():
        ctx = contexts.setdefault(
            stack, StackContext(stack, profile, region, account)
        )
        for logical, name in entries:
            try:
                plans.append((stack, logical) + queue_plan(ctx, logical))
            except Unresolved as e:
                print(f"  SKIP {name}: {e}", file=sys.stderr)

    # DLQs have no RedrivePolicy, so creating those first makes the redrive
    # targets resolvable for the queues that point at them.
    plans.sort(key=lambda p: "RedrivePolicy" in p[3])

    for stack, logical, name, attributes, tags in plans:
        print(f"  create {name}")
        for k, v in attributes.items():
            print(f"      {k}={v}")
        if not apply_changes:
            continue
        args = ["sqs", "create-queue", "--queue-name", name]
        if attributes:
            args += ["--attributes", json.dumps(attributes)]
        if tags:
            args += ["--tags", json.dumps(tags)]
        aws(args, profile, region)

    for stack, entries in by_stack.items():
        ctx = contexts[stack]
        logicals = {logical for logical, _ in entries}
        for target, policy in policies_for(ctx, logicals):
            name = ctx.resources[target]["Properties"]["QueueName"]
            print(f"  policy {name}")
            if not apply_changes:
                continue
            url = aws(
                ["sqs", "get-queue-url", "--queue-name", name, "--query", "QueueUrl"],
                profile,
                region,
            )
            aws(
                [
                    "sqs",
                    "set-queue-attributes",
                    "--queue-url",
                    url,
                    "--attributes",
                    json.dumps({"Policy": policy}),
                ],
                profile,
                region,
            )


def cmd_drift(args):
    missing = find_drift(args.stage, args.profile, args.region)
    if not missing:
        print(f"No SQS drift on {args.stage}. CFN and SQS agree.")
        return 0

    print(f"{len(missing)} queue(s) CloudFormation believes exist but SQS does not:\n")
    for stack, logical, name in missing:
        print(f"  {name}\n      stack={stack} logical={logical}")
    print()

    if args.repair:
        print("Repairing (names are reused so ARNs match, which keeps existing")
        print("SNS subscriptions and S3 notification configs valid):\n")
    else:
        print("Dry run. Re-run with --repair to recreate them.\n")
    repair(args.stage, args.profile, args.region, missing, args.repair)

    if args.repair:
        left = find_drift(args.stage, args.profile, args.region)
        print(f"\n{len(left)} still missing." if left else "\nAll queues restored.")
        return 1 if left else 0
    return 1


# -------------------------------------------------------------- artifact

ARTIFACT_404 = "GetSignedArtifactURL"


def cmd_artifact(args):
    jobs = json.loads(gh(["run", "view", args.run, "--repo", args.repo, "--json", "jobs"]))
    failed = [j for j in jobs["jobs"] if j.get("conclusion") == "failure"]
    hit = False
    for j in failed:
        log = gh(
            ["run", "view", "--repo", args.repo, "--job", str(j["databaseId"]), "--log-failed"],
            check=False,
        )
        if ARTIFACT_404 in log:
            print(f"Stale artifact download in job: {j['name']}")
            hit = True
    if not hit:
        print("No stale-artifact signature in the failed jobs. Different problem.")
        return 0

    arts = json.loads(
        gh(["api", f"repos/{args.repo}/actions/runs/{args.run}/artifacts"])
    )["artifacts"]
    if not arts:
        print("No artifacts left on the run; rerun should rebuild.")
    for a in arts:
        print(f"  {'delete' if args.fix else 'would delete'} {a['name']} id={a['id']}")
        if args.fix:
            gh(["api", "-X", "DELETE", f"repos/{args.repo}/actions/artifacts/{a['id']}"])

    if not args.fix:
        print("\nDry run. Re-run with --fix to delete and retrigger.")
        return 1

    # A --failed rerun would skip the build job again; the full rerun is what
    # forces a fresh artifact bound to the new attempt.
    gh(["run", "rerun", args.run, "--repo", args.repo])
    print("\nArtifacts deleted, full rerun triggered.")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("drift", help="SQS queues CFN thinks exist but do not")
    d.add_argument("-s", "--stage", required=True, help="e.g. pr-indigo")
    d.add_argument("--profile", default=None, help="AWS profile (default: env)")
    d.add_argument("--region", default="eu-west-2")
    d.add_argument("--repair", action="store_true", help="actually recreate them")
    d.set_defaults(func=cmd_drift)

    a = sub.add_parser("artifact", help="stale SST build artifact 404")
    a.add_argument("-r", "--run", required=True, help="workflow run id")
    a.add_argument("--repo", default="team-plain/services")
    a.add_argument("--fix", action="store_true", help="delete artifacts and rerun")
    a.set_defaults(func=cmd_artifact)

    args = p.parse_args()
    try:
        return args.func(args)
    except (RuntimeError, Unresolved) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
