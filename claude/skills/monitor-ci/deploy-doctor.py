#!/usr/bin/env python3
"""
deploy-doctor - diagnose and repair SST PR-stage deploy failures.

Three failure modes that look like "the deploy is broken" but are not caused by
the PR's code. All waste a lot of time if you retrigger instead of diagnosing.

  drift     CloudFormation still believes SQS queues exist, but they were
            deleted out of band. Every deploy then fails creating Lambda event
            source mappings with AWS.SimpleQueueService.NonExistentQueue, and
            cascades DEPENDENCY_FAILED into most other stacks. Reruns cannot
            fix it: pre-deploy-cleanup only deletes stacks in a failed state,
            and the state stacks holding the queues look healthy.

  orphans   A stack was deleted (manually or by pre-deploy-cleanup) but some of
            its named resources (SSM parameters, Lambda functions, API Gateways)
            survived. CloudFormation CREATE then fails with "Validation failed
            with N error(s)" before creating any resources, because the named
            resources already exist outside the stack. No resource-level events
            appear; the failure is at template validation time.

  artifact  The SST build artifact from an earlier run attempt can no longer be
            downloaded ("404 Not Found: workflow run not found" from
            GetSignedArtifactURL), while it still lists as present, so the
            check job keeps skipping the build and the deploy keeps trying to
            download something it cannot fetch.

All default to read-only. Pass --repair / --fix to act.
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


# -------------------------------------------------------------- orphans

NAMED_RESOURCE_TYPES = {
    "AWS::SSM::Parameter": "Name",
    "AWS::Lambda::Function": "FunctionName",
    "AWS::ApiGatewayV2::Api": "Name",
}


def _extract_named_resources(template):
    """Return [(resource_type, name)] for resources with hardcoded names."""
    resources = template.get("Resources", {})
    out = []
    for _logical, res in resources.items():
        rtype = res.get("Type", "")
        name_key = NAMED_RESOURCE_TYPES.get(rtype)
        if not name_key:
            continue
        name = res.get("Properties", {}).get(name_key)
        if isinstance(name, str):
            out.append((rtype, name))
    return out


def _resource_exists(rtype, name, profile, region):
    """Check if a named resource exists in AWS."""
    try:
        if rtype == "AWS::SSM::Parameter":
            aws(["ssm", "get-parameter", "--name", name], profile, region)
            return True
        if rtype == "AWS::Lambda::Function":
            aws(["lambda", "get-function", "--function-name", name], profile, region)
            return True
        if rtype == "AWS::ApiGatewayV2::Api":
            data = aws(["apigatewayv2", "get-apis"], profile, region)
            return any(a.get("Name") == name for a in data.get("Items", []))
    except RuntimeError:
        return False
    return False


def _delete_resource(rtype, name, profile, region):
    """Delete a named resource from AWS."""
    if rtype == "AWS::SSM::Parameter":
        aws(["ssm", "delete-parameter", "--name", name], profile, region)
    elif rtype == "AWS::Lambda::Function":
        aws(["lambda", "delete-function", "--function-name", name], profile, region)
    elif rtype == "AWS::ApiGatewayV2::Api":
        data = aws(["apigatewayv2", "get-apis"], profile, region)
        for a in data.get("Items", []):
            if a.get("Name") == name:
                aws(
                    ["apigatewayv2", "delete-api", "--api-id", a["ApiId"]],
                    profile,
                    region,
                )
                break


def find_orphans(stage, stack_name, profile, region):
    """Find named resources that exist in AWS but whose stack is gone or ROLLBACK_COMPLETE."""
    # Get the template from the CDK assets bucket
    cdk_data = aws(
        [
            "cloudformation",
            "describe-stacks",
            "--stack-name",
            "CDKToolkit",
            "--query",
            "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue",
        ],
        profile,
        region,
    )
    if not cdk_data:
        raise Unresolved("CDKToolkit stack not found or has no BucketName output")
    bucket = cdk_data[0]

    # Check if the stack exists and what state it's in
    full_name = f"{stage}-services-{stack_name}"
    stack_data = aws(
        ["cloudformation", "describe-stacks", "--stack-name", full_name],
        profile,
        region,
        check=False,
    )

    template = None
    if stack_data and "Stacks" in stack_data:
        stack_status = stack_data["Stacks"][0]["StackStatus"]
        if stack_status in ("ROLLBACK_COMPLETE", "CREATE_FAILED"):
            # Get template from the failed stack
            tmpl_data = aws(
                [
                    "cloudformation",
                    "get-template",
                    "--stack-name",
                    full_name,
                    "--query",
                    "TemplateBody",
                ],
                profile,
                region,
                check=False,
            )
            if tmpl_data:
                template = tmpl_data if isinstance(tmpl_data, dict) else json.loads(tmpl_data)
    else:
        # Stack doesn't exist; find the template in the CDK assets bucket by
        # looking for recent large JSON files (stack templates are typically >50KB)
        listing = sh(
            ["aws"]
            + (["--profile", profile] if profile else [])
            + ["--region", region, "s3", "ls", f"s3://{bucket}/", "--recursive"],
            check=False,
        )
        # Find JSON files, sort by date descending, pick candidates
        candidates = []
        for line in listing.strip().split("\n"):
            if not line or not line.strip():
                continue
            parts = line.split()
            if len(parts) < 4:
                continue
            size = int(parts[2])
            key = parts[3]
            if key.endswith(".json") and size > 50000:
                candidates.append((parts[0] + " " + parts[1], size, key))
        candidates.sort(reverse=True)

        for _, _, key in candidates[:10]:
            content = sh(
                ["aws"]
                + (["--profile", profile] if profile else [])
                + ["--region", region, "s3", "cp", f"s3://{bucket}/{key}", "-"],
                check=False,
            )
            try:
                tmpl = json.loads(content)
            except (json.JSONDecodeError, TypeError):
                continue
            named = _extract_named_resources(tmpl)
            if any(stage in name for _, name in named):
                template = tmpl
                break

    if not template:
        print(f"Could not find template for {full_name}.")
        return []

    named = _extract_named_resources(template)
    orphans = []
    for rtype, name in named:
        if _resource_exists(rtype, name, profile, region):
            orphans.append((rtype, name))
    return orphans


def cmd_orphans(args):
    orphans = find_orphans(args.stage, args.stack, args.profile, args.region)
    if not orphans:
        print(f"No orphaned resources for {args.stage}-services-{args.stack}.")
        return 0

    print(f"{len(orphans)} orphaned resource(s) blocking stack CREATE:\n")
    for rtype, name in orphans:
        short_type = rtype.rsplit("::", 1)[-1]
        print(f"  {short_type}: {name}")
    print()

    if not args.repair:
        print("Dry run. Re-run with --repair to delete them.")
        return 1

    full_name = f"{args.stage}-services-{args.stack}"
    # Delete the ROLLBACK_COMPLETE stack first if it exists
    stack_data = aws(
        ["cloudformation", "describe-stacks", "--stack-name", full_name],
        args.profile,
        args.region,
        check=False,
    )
    if stack_data and "Stacks" in stack_data:
        status = stack_data["Stacks"][0]["StackStatus"]
        if status in ("ROLLBACK_COMPLETE", "CREATE_FAILED"):
            print(f"Deleting {full_name} ({status})...")
            aws(
                ["cloudformation", "delete-stack", "--stack-name", full_name],
                args.profile,
                args.region,
            )
            aws(
                [
                    "cloudformation",
                    "wait",
                    "stack-delete-complete",
                    "--stack-name",
                    full_name,
                ],
                args.profile,
                args.region,
            )

    for rtype, name in orphans:
        short_type = rtype.rsplit("::", 1)[-1]
        print(f"  deleting {short_type}: {name}")
        _delete_resource(rtype, name, args.profile, args.region)

    print(f"\nDeleted {len(orphans)} orphaned resource(s). Rerun the deploy.")
    return 0


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

    o = sub.add_parser("orphans", help="named resources orphaned after stack deletion")
    o.add_argument("-s", "--stage", required=True, help="e.g. pr-indigo")
    o.add_argument("--stack", required=True, help="stack name without stage prefix, e.g. CoreApiStack")
    o.add_argument("--profile", default=None, help="AWS profile (default: env)")
    o.add_argument("--region", default="eu-west-2")
    o.add_argument("--repair", action="store_true", help="delete orphans and clean up stack")
    o.set_defaults(func=cmd_orphans)

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
