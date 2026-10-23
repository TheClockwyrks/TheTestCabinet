"""Tests for protect.py: the policies a repository is to carry, and what a run creates.

No test reaches Azure DevOps. `protect` takes the function that runs `az`, so
a fake stands in for it that answers from a small project and records what it
was asked to create.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

import protect
import render

APPROVERS = "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"
PATH_LENGTH = "001a79cf-fda1-4c4e-9e7c-bac40ee5ead8"
REFERENCE_ID = "reference-id"
TARGET_ID = "target-id"


def _policy(type_id: str, title: str, repository: str, branch: str = "", **settings: Any) -> dict[str, Any]:
    scope: dict[str, Any] = {"repositoryId": repository}
    if branch:
        scope |= {"refName": f"refs/heads/{branch}", "matchKind": "Exact"}
    return {
        "isEnabled": True,
        "isBlocking": True,
        "type": {"id": type_id, "displayName": title},
        "settings": {**settings, "scope": [scope]},
    }


def _reference() -> list[dict[str, Any]]:
    return [
        _policy(
            APPROVERS,
            "Minimum number of reviewers",
            REFERENCE_ID,
            "master",
            minimumApproverCount=1,
        ),
        _policy(
            protect.BUILD_POLICY,
            "Build",
            REFERENCE_ID,
            "master",
            buildDefinitionId=45,
            displayName="contracts gates",
            validDuration=720.0,
        ),
        _policy(PATH_LENGTH, "Path Length restriction", REFERENCE_ID, maxPathLength=248),
    ]


def test_a_trunk_policy_is_wanted_on_each_protected_branch_and_a_repository_policy_once() -> None:
    wanted, notices = protect.desired(_reference(), TARGET_ID, "contracts", 46)
    assert notices == []
    assert [(policy.title, policy.branch) for policy in wanted] == [
        ("Minimum number of reviewers", "master"),
        ("Minimum number of reviewers", "staging"),
        ("Build", "master"),
        ("Build", "staging"),
        ("Path Length restriction", ""),
    ]
    assert "nightly" not in {policy.branch for policy in wanted}
    staging = wanted[1].configuration()
    assert staging["isBlocking"] and staging["isEnabled"]
    assert staging["settings"] == {
        "minimumApproverCount": 1,
        "scope": [
            {
                "repositoryId": TARGET_ID,
                "refName": "refs/heads/staging",
                "matchKind": "Exact",
            }
        ],
    }
    assert wanted[4].settings["scope"] == [{"repositoryId": TARGET_ID}]


def test_a_build_validation_names_the_repositorys_own_pipeline() -> None:
    wanted, _ = protect.desired(_reference(), TARGET_ID, "contracts", 46)
    build = wanted[2].settings
    assert build["buildDefinitionId"] == 46
    assert build["displayName"] == "contracts gates"
    assert build["validDuration"] == 720.0


def test_a_repository_without_a_pipeline_is_given_no_build_validation_and_told_so() -> None:
    wanted, notices = protect.desired(_reference(), TARGET_ID, "contracts", None)
    assert protect.BUILD_POLICY not in {policy.type_id for policy in wanted}
    assert notices == [
        "contracts has no pipeline named contracts, so master is given no build validation",
        "contracts has no pipeline named contracts, so staging is given no build validation",
    ]


def test_a_policy_on_another_branch_of_the_reference_is_not_part_of_the_pattern() -> None:
    reference = [_policy(APPROVERS, "Minimum number of reviewers", REFERENCE_ID, "release")]
    assert protect.desired(reference, TARGET_ID, "contracts", 46) == ([], [])


def test_a_policy_the_repository_carries_at_the_same_scope_is_not_wanted_again() -> None:
    wanted, _ = protect.desired(_reference(), TARGET_ID, "contracts", 46)
    existing = [
        _policy(
            APPROVERS,
            "Minimum number of reviewers",
            TARGET_ID,
            "master",
            minimumApproverCount=2,
        ),
        _policy(PATH_LENGTH, "Path Length restriction", TARGET_ID, maxPathLength=100),
    ]
    assert [(policy.title, policy.branch) for policy in protect.missing(wanted, existing)] == [
        ("Minimum number of reviewers", "staging"),
        ("Build", "master"),
        ("Build", "staging"),
    ]


class FakeAz:
    """An Azure DevOps holding the reference and one target repository."""

    def __init__(
        self,
        heads: Sequence[str],
        policies: list[dict[str, Any]],
        pipeline: bool = True,
    ) -> None:
        self.heads = list(heads)
        self.policies = policies
        self.pipeline = pipeline
        self.created_refs: list[tuple[str, str]] = []
        self.created_policies: list[dict[str, Any]] = []
        self.projects: list[str] = []

    def __call__(self, arguments: Sequence[str]) -> Any:
        arguments = list(arguments)
        assert arguments[arguments.index("--org") + 1] == protect.ORGANISATION
        project = arguments[arguments.index("--project") + 1]
        command = arguments[: next(i for i, word in enumerate(arguments) if word.startswith("--"))]
        if command == ["repos", "show"]:
            name = arguments[arguments.index("--repository") + 1]
            return {"id": REFERENCE_ID if name == protect.REFERENCE else TARGET_ID}
        if command == ["repos", "ref", "list"]:
            return [{"name": f"refs/heads/{head}", "objectId": "abc123"} for head in self.heads]
        if command == ["repos", "ref", "create"]:
            self.created_refs.append(
                (
                    arguments[arguments.index("--name") + 1],
                    arguments[arguments.index("--object-id") + 1],
                )
            )
            return {}
        if command == ["pipelines", "list"]:
            name = arguments[arguments.index("--name") + 1]
            # Azure matches the name as a pattern, so a longer name comes back too.
            return [{"id": 7, "name": f"{name}-ci-images"}, {"id": 46, "name": name}] if self.pipeline else []
        if command == ["repos", "policy", "list"]:
            self.projects.append(project)
            # The pattern is read first, then what the repository already carries.
            return _reference() if len(self.projects) == 1 else self.policies
        if command == ["repos", "policy", "create"]:
            path = Path(arguments[arguments.index("--policy-configuration") + 1])
            self.created_policies.append(json.loads(path.read_text(encoding="utf-8")))
            return {}
        raise AssertionError(f"an unexpected az command: {arguments}")


def test_a_new_repository_gets_its_branches_and_every_policy() -> None:
    az, said = FakeAz(["master"], []), []
    protect.protect("contracts", az=az, say=said.append)
    assert az.created_refs == [("heads/staging", "abc123"), ("heads/nightly", "abc123")]
    assert az.projects == [protect.PROJECT, protect.PROJECT]
    scopes = [
        (created["type"]["id"], created["settings"]["scope"][0].get("refName", "")) for created in az.created_policies
    ]
    assert scopes == [
        (APPROVERS, "refs/heads/master"),
        (APPROVERS, "refs/heads/staging"),
        (protect.BUILD_POLICY, "refs/heads/master"),
        (protect.BUILD_POLICY, "refs/heads/staging"),
        (PATH_LENGTH, ""),
    ]
    assert all(created["settings"]["scope"][0]["repositoryId"] == TARGET_ID for created in az.created_policies)
    assert az.created_policies[2]["settings"]["buildDefinitionId"] == 46
    assert "contracts: create staging at master" in said
    assert "contracts: add Path Length restriction on the repository" in said


def test_a_second_run_creates_nothing() -> None:
    wanted, _ = protect.desired(_reference(), TARGET_ID, "contracts", 46)
    held = [{"isEnabled": True, "type": {"id": policy.type_id}, "settings": policy.settings} for policy in wanted]
    az, said = FakeAz(render.BRANCHES, held), []
    protect.protect("contracts", az=az, say=said.append)
    assert az.created_refs == []
    assert az.created_policies == []
    assert said == []


def test_a_dry_run_says_what_it_would_create_and_creates_nothing() -> None:
    az, said = FakeAz(["master"], [], pipeline=False), []
    protect.protect("contracts", dry_run=True, az=az, say=said.append)
    assert az.created_refs == [] and az.created_policies == []
    assert "contracts: create nightly at master" in said
    assert "contracts has no pipeline named contracts, so staging is given no build validation" in said
    assert "contracts: add Minimum number of reviewers on staging" in said


def test_a_repository_without_the_trunk_is_refused() -> None:
    with pytest.raises(protect.ProtectError, match="has no master to start a branch from"):
        protect.protect("contracts", az=FakeAz([], []), say=lambda _: None)


def test_the_protected_branches_are_long_lived_branches_and_nightly_is_not_one() -> None:
    assert set(protect.PROTECTED) < set(render.BRANCHES)
    assert set(render.BRANCHES) - set(protect.PROTECTED) == {"nightly"}
