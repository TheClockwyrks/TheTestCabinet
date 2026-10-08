"""The edge table, and the check of a tree of manifests against it."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from the_test_cabinet_ci import edges


def _write(root: Path, relative: str, text: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _package(root: Path, relative: str, name: str, **fields: object) -> None:
    _write(root, relative, json.dumps({"name": name, **fields}))


def test_the_table_is_whole() -> None:
    assert edges.table_problems() == []


def test_every_repository_the_design_names_is_in_the_table() -> None:
    assert set(edges.REPOSITORIES) == {
        "contracts",
        "engines",
        "gg",
        "tcab",
        "web",
        "the-spec-cabinet",
        "gg.rocks",
        "test-suites",
    }
    assert set(edges.KINDS) == {"library", "application", "site", "content"}


@pytest.mark.parametrize(
    ("repo", "target", "expected"),
    [
        ("contracts", "engines", False),
        ("engines", "contracts", True),
        ("engines", "tcab", False),
        ("gg", "contracts", True),
        ("gg", "tcab", False),
        ("tcab", "contracts", True),
        ("tcab", "engines", True),
        ("tcab", "gg", False),
        ("tcab", "web", False),
        ("web", "tcab", False),
        ("the-spec-cabinet", "tcab", False),
        ("the-spec-cabinet", "gg", False),
        ("the-spec-cabinet", "web", False),
        ("test-suites", "engines", False),
        ("gg.rocks", "contracts", False),
    ],
)
def test_crates_follow_the_edges_the_design_draws(repo: str, target: str, expected: bool) -> None:
    permitted = edges.edge(repo, target)
    assert (permitted is not None and permitted.crates) is expected


def test_no_repository_depends_on_gg_at_build_time() -> None:
    assert not [repo for repo, row in edges.BUILD_EDGES.items() if any(one.target == "gg" for one in row)]


def test_the_closure_is_what_a_build_may_fetch() -> None:
    assert edges.closure("contracts") == []
    assert edges.closure("engines") == ["contracts"]
    assert edges.closure("tcab") == ["contracts", "engines"]
    assert edges.closure("web") == ["contracts", "engines"]
    assert edges.closure("test-suites") == []


@pytest.mark.parametrize(
    ("source", "repo"),
    [
        ("https://github.com/TheClockwyrks/contracts", "contracts"),
        ("https://github.com/TheClockwyrks/contracts.git", "contracts"),
        ("https://github.com/TheClockwyrks/TheTestCabinet", "the-test-cabinet"),
        ("https://dev.azure.com/genyume/the-test-cabinet/_git/engines", "engines"),
        ("git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/tcab", "tcab"),
        ("https://github.com/rust-lang/regex", None),
        ("https://github.com/TheClockwyrks/SomeOtherProject", "SomeOtherProject"),
    ],
)
def test_a_source_names_its_repository(source: str, repo: str | None) -> None:
    assert edges.repository_of_source(source) == repo


def test_a_git_source_on_a_permitted_edge_passes(tmp_path: Path) -> None:
    _write(
        tmp_path,
        "Cargo.toml",
        "[workspace]\n[workspace.dependencies]\n"
        'test-cabinet-contracts = { git = "https://github.com/TheClockwyrks/contracts", tag = "v0.1.0" }\n',
    )
    assert edges.violations(tmp_path, "engines") == []


def test_a_git_source_off_the_edges_is_refused(tmp_path: Path) -> None:
    _write(
        tmp_path,
        "crates/x/Cargo.toml",
        '[package]\nname = "x"\n[dependencies]\n'
        'test-cabinet-core = { git = "https://github.com/TheClockwyrks/tcab" }\n',
    )
    assert edges.violations(tmp_path, "the-spec-cabinet") == [
        (
            "crates/x/Cargo.toml: [dependencies] test-cabinet-core comes from tcab,"
            " whose crates the-spec-cabinet may not name"
        )
    ]


def test_a_renamed_dependency_is_judged_by_its_source(tmp_path: Path) -> None:
    _write(
        tmp_path,
        "Cargo.toml",
        "[package]\nname = \"x\"\n[target.'cfg(unix)'.dev-dependencies]\n"
        'gg = { package = "test-cabinet-gg", git = "https://github.com/TheClockwyrks/gg" }\n',
    )
    assert edges.violations(tmp_path, "tcab") == [
        "Cargo.toml: [dev-dependencies] test-cabinet-gg comes from gg, whose crates tcab may not name"
    ]


def test_a_crate_of_an_unknown_project_mirror_is_refused(tmp_path: Path) -> None:
    _write(
        tmp_path,
        "Cargo.toml",
        '[package]\nname = "x"\n[dependencies]\nv = { git = "https://github.com/TheClockwyrks/elsewhere" }\n',
    )
    assert edges.violations(tmp_path, "tcab") == [
        (
            "Cargo.toml: [dependencies] v comes from https://github.com/TheClockwyrks/elsewhere,"
            " which is no repository of the project"
        )
    ]


def test_a_path_dependency_leaving_the_repository_is_refused(tmp_path: Path) -> None:
    repo = tmp_path / "web"
    _write(
        repo,
        "crates/a/Cargo.toml",
        '[package]\nname = "a"\n[dependencies]\nb = { path = "../b" }\nc = { path = "../../../tcab/crates/c" }\n',
    )
    _write(repo, "crates/b/Cargo.toml", '[package]\nname = "b"\n')
    assert edges.violations(repo, "web") == [
        "crates/a/Cargo.toml: [dependencies] c is a path dependency outside the repository"
    ]


def test_registry_crates_and_own_sources_pass(tmp_path: Path) -> None:
    _write(
        tmp_path,
        "Cargo.toml",
        '[package]\nname = "x"\n[dependencies]\nserde = "1"\nown = { git = "https://github.com/TheClockwyrks/tcab" }\n',
    )
    assert edges.violations(tmp_path, "tcab") == []


def test_a_package_on_a_permitted_edge_passes(tmp_path: Path) -> None:
    _package(tmp_path, "package.json", "root", dependencies={"@clockwyrks/run-record": "0.1.0", "react": "19.0.0"})
    assert edges.violations(tmp_path, "web") == []


def test_a_narrowed_edge_admits_its_package_alone(tmp_path: Path) -> None:
    _package(
        tmp_path,
        "packages/a/package.json",
        "@clockwyrks/a",
        dependencies={"@clockwyrks/backend-api": "0.1.0", "@clockwyrks/browser-driver": "0.1.0"},
    )
    assert edges.violations(tmp_path, "web") == [
        (
            "packages/a/package.json: [dependencies] @clockwyrks/browser-driver comes from tcab,"
            " which web may not depend on"
        )
    ]


def test_engines_never_takes_run_record(tmp_path: Path) -> None:
    _package(
        tmp_path,
        "packages/voxel-runtime/package.json",
        "@clockwyrks/voxel-runtime",
        dependencies={"@clockwyrks/asset-contract": "0.1.0"},
        devDependencies={"@clockwyrks/run-record": "0.1.0"},
    )
    assert edges.violations(tmp_path, "engines") == [
        (
            "packages/voxel-runtime/package.json: [devDependencies] @clockwyrks/run-record comes from contracts, which"
            " engines may not depend on"
        )
    ]


def test_an_unknown_project_package_is_refused(tmp_path: Path) -> None:
    _package(tmp_path, "package.json", "root", peerDependencies={"@clockwyrks/nowhere": "1.0.0"})
    assert edges.violations(tmp_path, "tcab") == [
        "package.json: [peerDependencies] @clockwyrks/nowhere is produced by no repository of the project"
    ]


def test_a_workspace_member_is_its_own_package(tmp_path: Path) -> None:
    _package(tmp_path, "package.json", "root", workspaces=["packages/*"], devDependencies={"@clockwyrks/fresh": "*"})
    _package(tmp_path, "packages/fresh/package.json", "@clockwyrks/fresh")
    assert edges.violations(tmp_path, "contracts") == []


def test_a_file_dependency_leaving_the_repository_is_refused(tmp_path: Path) -> None:
    repo = tmp_path / "web"
    _package(repo, "package.json", "root", dependencies={"@clockwyrks/ui": "file:packages/ui", "x": "file:../tcab/x"})
    _package(repo, "packages/ui/package.json", "@clockwyrks/ui")
    assert edges.violations(repo, "web") == [
        "package.json: [dependencies] x is a path dependency outside the repository"
    ]


def test_installed_and_built_trees_are_not_judged(tmp_path: Path) -> None:
    _package(tmp_path, "node_modules/x/package.json", "x", dependencies={"@clockwyrks/nowhere": "1"})
    _write(tmp_path, "target/debug/Cargo.toml", '[dependencies]\nv = { git = "https://github.com/TheClockwyrks/gg" }\n')
    assert edges.violations(tmp_path, "contracts") == []


def test_an_unknown_repository_is_refused() -> None:
    with pytest.raises(ValueError, match="unknown repository"):
        edges.edges_of("elsewhere")


def test_describe_names_each_edge() -> None:
    assert edges.describe("contracts") == "no other repository of the project"
    assert edges.describe("web") == (
        "contracts (crates and packages); engines (crates and packages); tcab (@clockwyrks/backend-api)"
    )
    assert edges.describe("engines") == "contracts (crates and @clockwyrks/asset-contract)"
