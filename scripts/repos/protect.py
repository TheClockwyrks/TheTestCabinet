#!/usr/bin/env python3
"""Give a repository on Azure DevOps its long-lived branches and the policies that protect them.

    scripts/repos/protect.py [--like <repository>] [--dry-run] <name>...

Every repository has three long-lived branches, `render.BRANCHES`. `master`
and `staging` are protected: each takes pull requests alone, approved by a
reviewer, with every comment resolved and the repository's pipeline passed as
the build validation. `nightly` carries no policy and takes pushes.

The policies are copied from a repository that already carries them, `--like`,
the superrepo `the-test-cabinet` by default, so the reviewers and the
patterns a policy names are read from Azure DevOps and written nowhere here.
A policy the reference holds on `master` is given to the repository on each
protected branch, and a policy it holds on the repository as a whole, the
push restrictions, is given to the repository as a whole. A build validation
names the pipeline definition called after the repository, and is left out
with a notice while the repository has none.

Every step is skipped when it has already happened: a branch that exists is
not created, and a policy of a type the repository already carries at the
same scope is left as it is, so a second run changes nothing.

The script drives the Azure CLI with its `azure-devops` extension, signed in
as someone who may edit the project's policies.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, NamedTuple

import render

# The organisation and the Azure DevOps project every repository lives in.
ORGANISATION = render.AZURE_ORGANISATION
PROJECT = render.AZURE_PROJECT
# The branches a policy protects; the rest of `render.BRANCHES` take pushes.
PROTECTED = ("master", "staging")
# The repository whose policies are the pattern: the superrepo, whose master
# and staging already take pull requests alone.
REFERENCE = "the-test-cabinet"
# The branch of the reference whose policies are the pattern for each
# protected branch, and the branch a new branch starts from.
TRUNK = "master"
# The policy type that runs a pipeline as a pull request's build validation.
BUILD_POLICY = "0609b952-1397-4640-95ec-e00a01b2c241"

# Runs one `az` command and answers what it printed, parsed as JSON.
Az = Callable[[Sequence[str]], Any]


class ProtectError(Exception):
    """A repository could not be protected."""


class Policy(NamedTuple):
    """One policy configuration to create."""

    type_id: str
    title: str
    # The branch the policy holds, or the empty string for the whole repository.
    branch: str
    blocking: bool
    settings: dict[str, Any]

    def configuration(self) -> dict[str, Any]:
        return {
            "isEnabled": True,
            "isBlocking": self.blocking,
            "type": {"id": self.type_id},
            "settings": self.settings,
        }


def _ref(branch: str) -> str:
    return f"refs/heads/{branch}"


def _scoped(policies: list[dict[str, Any]], repository_id: str) -> list[dict[str, Any]]:
    """The enabled policies whose one scope is the repository, in the order Azure answers them."""
    found = []
    for policy in policies:
        scope = policy["settings"].get("scope") or []
        if policy.get("isEnabled") and len(scope) == 1 and scope[0].get("repositoryId") == repository_id:
            found.append(policy)
    return found


def _branch(policy: dict[str, Any]) -> str:
    """The branch a policy holds, or the empty string for the whole repository."""
    ref = policy["settings"]["scope"][0].get("refName") or ""
    return ref.removeprefix("refs/heads/")


def desired(
    reference: list[dict[str, Any]],
    repository_id: str,
    name: str,
    pipeline: int | None,
) -> tuple[list[Policy], list[str]]:
    """The policies a repository is to carry, and a notice for each one left out.

    `reference` is the reference repository's own policies. One held on its
    trunk is wanted on each protected branch; one held on the repository as a
    whole is wanted on the repository as a whole; one held on any other branch
    of the reference is not part of the pattern.
    """
    wanted: list[Policy] = []
    notices: list[str] = []
    for policy in reference:
        held = _branch(policy)
        if held not in ("", TRUNK):
            continue
        type_id = policy["type"]["id"]
        title = policy["type"].get("displayName", type_id)
        for branch in PROTECTED if held else ("",):
            settings = {key: value for key, value in policy["settings"].items() if key != "scope"}
            scope: dict[str, Any] = {"repositoryId": repository_id}
            if branch:
                scope |= {"refName": _ref(branch), "matchKind": "Exact"}
            if type_id == BUILD_POLICY:
                if pipeline is None:
                    notices.append(f"{name} has no pipeline named {name}, so {branch} is given no build validation")
                    continue
                settings |= {
                    "buildDefinitionId": pipeline,
                    "displayName": f"{name} gates",
                }
            settings["scope"] = [scope]
            wanted.append(Policy(type_id, title, branch, bool(policy.get("isBlocking")), settings))
    return wanted, notices


def missing(wanted: list[Policy], existing: list[dict[str, Any]]) -> list[Policy]:
    """The wanted policies whose type the repository does not already carry at the same scope."""
    held = {(policy["type"]["id"], _branch(policy)) for policy in existing}
    return [policy for policy in wanted if (policy.type_id, policy.branch) not in held]


def _az(arguments: Sequence[str]) -> Any:
    done = subprocess.run(["az", *arguments, "-o", "json"], capture_output=True, text=True, check=False)
    if done.returncode != 0:
        raise ProtectError(f"az {' '.join(arguments)} failed:\n{done.stderr.strip()}")
    return json.loads(done.stdout) if done.stdout.strip() else None


def protect(
    name: str,
    *,
    like: str = REFERENCE,
    dry_run: bool = False,
    az: Az = _az,
    say: Callable[[str], None] = print,
) -> None:
    """Create the branches `name` lacks and the policies it lacks, as `like` carries them."""
    target = pattern = ["--org", ORGANISATION, "--project", PROJECT]
    repository_id = az(["repos", "show", "--repository", name, *target])["id"]
    reference_id = az(["repos", "show", "--repository", like, *pattern])["id"]

    heads = az(["repos", "ref", "list", "--repository", name, "--filter", "heads/", *target])
    tips = {head["name"]: head["objectId"] for head in heads}
    if _ref(TRUNK) not in tips:
        raise ProtectError(f"{PROJECT}/{name} has no {TRUNK} to start a branch from")
    for branch in render.BRANCHES:
        if _ref(branch) in tips:
            continue
        say(f"{name}: create {branch} at {TRUNK}")
        if not dry_run:
            az(
                [
                    "repos",
                    "ref",
                    "create",
                    "--name",
                    f"heads/{branch}",
                    "--object-id",
                    tips[_ref(TRUNK)],
                    "--repository",
                    name,
                    *target,
                ]
            )

    definitions = az(["pipelines", "list", "--name", name, *target]) or []
    pipeline = next((entry["id"] for entry in definitions if entry["name"] == name), None)
    reference = _scoped(az(["repos", "policy", "list", *pattern]), reference_id)
    if not reference:
        raise ProtectError(f"{PROJECT}/{like} carries no policy to copy")
    wanted, notices = desired(reference, repository_id, name, pipeline)
    for notice in notices:
        say(notice)
    existing = _scoped(az(["repos", "policy", "list", *target]), repository_id)
    for policy in missing(wanted, existing):
        say(f"{name}: add {policy.title} on {policy.branch or 'the repository'}")
        if dry_run:
            continue
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.json"
            path.write_text(json.dumps(policy.configuration()), encoding="utf-8")
            az(
                [
                    "repos",
                    "policy",
                    "create",
                    "--policy-configuration",
                    str(path),
                    *target,
                ]
            )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("names", nargs="+", metavar="name", help="a repository, such as contracts")
    parser.add_argument(
        "--like",
        default=REFERENCE,
        help="the repository whose policies are copied",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="say what would be created and create nothing",
    )
    arguments = parser.parse_args(argv)
    try:
        for name in arguments.names:
            protect(name, like=arguments.like, dry_run=arguments.dry_run)
    except ProtectError as error:
        print(f"protect: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
