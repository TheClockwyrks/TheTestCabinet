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
        "ui-common",
        "tool-model-core",
        "tool-sprite",
        "tool-paint",
        "tool-voxel",
        "tool-mc",
        "tool-sn",
        "tool-dc",
        "tool-particle",
        "tool-audio-core",
        "tool-sfx-synth",
        "tool-sfx-sample",
        "tool-music",
        "microservice-backend",
        "microservice-dispatcher",
        "microservice-driver",
        "microservice-artifacts",
        "microservice-repos",
        "microservice-publisher",
        "microservice-arena",
        "gg",
        "the-spec-cabinet",
        "testcabinet.ai",
        "console.testcabinet.ai",
        "gg.rocks",
        "client-tauri",
        "test-suites",
    }
    assert set(edges.KINDS) == {"library", "tool", "application", "shell", "site", "content"}


def test_every_tool_image_is_a_tool() -> None:
    assert all(edges.REPOSITORIES[tool] == "tool" for tool in edges.TOOL_IMAGES)
    assert {"tool-model-core", "tool-audio-core"}.isdisjoint(edges.TOOL_IMAGES)


def test_the_backend_api_package_comes_from_the_hub() -> None:
    """The console takes the backend's API package from contracts, so no application depends on another."""
    assert edges.PACKAGES["@clockwyrks/backend-api"] == "contracts"
    applications = {repo for repo, kind in edges.REPOSITORIES.items() if kind in ("application", "site", "shell")}
    assert not [
        (repo, one.target) for repo, row in edges.BUILD_EDGES.items() for one in row if one.target in applications
    ]


@pytest.mark.parametrize(
    ("repo", "target", "expected"),
    [
        ("contracts", "engines", False),
        ("engines", "contracts", True),
        ("engines", "microservice-driver", False),
        ("gg", "contracts", True),
        ("gg", "microservice-driver", False),
        ("microservice-driver", "contracts", True),
        ("microservice-driver", "engines", True),
        ("microservice-driver", "tool-sprite", True),
        ("microservice-driver", "tool-voxel", True),
        ("microservice-driver", "tool-model-core", True),
        ("microservice-driver", "tool-audio-core", True),
        ("microservice-driver", "tool-mc", False),
        ("microservice-driver", "gg", False),
        ("microservice-driver", "microservice-artifacts", False),
        ("microservice-backend", "engines", True),
        ("microservice-backend", "microservice-artifacts", False),
        ("microservice-dispatcher", "engines", False),
        ("microservice-arena", "engines", True),
        ("tool-mc", "tool-model-core", True),
        ("tool-sprite", "tool-model-core", False),
        ("tool-music", "tool-audio-core", True),
        ("console.testcabinet.ai", "microservice-backend", False),
        ("the-spec-cabinet", "microservice-driver", False),
        ("the-spec-cabinet", "gg", False),
        ("the-spec-cabinet", "ui-common", False),
        ("test-suites", "engines", False),
        ("gg.rocks", "contracts", False),
        ("client-tauri", "console.testcabinet.ai", False),
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
    assert edges.closure("microservice-arena") == ["contracts", "engines"]
    assert edges.closure("microservice-driver") == [
        "contracts",
        "engines",
        "tool-audio-core",
        "tool-model-core",
        "tool-sprite",
        "tool-voxel",
    ]
    assert edges.closure("console.testcabinet.ai") == []
    assert edges.closure("test-suites") == []


@pytest.mark.parametrize(
    ("source", "repo"),
    [
        ("https://github.com/TheClockwyrks/contracts", "contracts"),
        ("https://github.com/TheClockwyrks/contracts.git", "contracts"),
        ("https://github.com/TheClockwyrks/TheTestCabinet", "the-test-cabinet"),
        ("https://dev.azure.com/genyume/the-test-cabinet/_git/engines", "engines"),
        ("git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/microservice-driver", "microservice-driver"),
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
        'test-cabinet-driver = { git = "https://github.com/TheClockwyrks/microservice-driver" }\n',
    )
    assert edges.violations(tmp_path, "the-spec-cabinet") == [
        (
            "crates/x/Cargo.toml: [dependencies] test-cabinet-driver comes from microservice-driver,"
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
    assert edges.violations(tmp_path, "microservice-driver") == [
        "Cargo.toml: [dev-dependencies] test-cabinet-gg comes from gg, whose crates microservice-driver may not name"
    ]


def test_a_crate_of_an_unknown_project_mirror_is_refused(tmp_path: Path) -> None:
    _write(
        tmp_path,
        "Cargo.toml",
        '[package]\nname = "x"\n[dependencies]\nv = { git = "https://github.com/TheClockwyrks/elsewhere" }\n',
    )
    assert edges.violations(tmp_path, "microservice-driver") == [
        (
            "Cargo.toml: [dependencies] v comes from https://github.com/TheClockwyrks/elsewhere,"
            " which is no repository of the project"
        )
    ]


def test_a_path_dependency_leaving_the_repository_is_refused(tmp_path: Path) -> None:
    repo = tmp_path / "microservice-backend"
    _write(
        repo,
        "crates/a/Cargo.toml",
        '[package]\nname = "a"\n[dependencies]\nb = { path = "../b" }\nc = { path = "../../../contracts/crates/c" }\n',
    )
    _write(repo, "crates/b/Cargo.toml", '[package]\nname = "b"\n')
    assert edges.violations(repo, "microservice-backend") == [
        "crates/a/Cargo.toml: [dependencies] c is a path dependency outside the repository"
    ]


def test_registry_crates_and_own_sources_pass(tmp_path: Path) -> None:
    _write(
        tmp_path,
        "Cargo.toml",
        '[package]\nname = "x"\n[dependencies]\nserde = "1"\n'
        'own = { git = "https://github.com/TheClockwyrks/microservice-driver" }\n',
    )
    assert edges.violations(tmp_path, "microservice-driver") == []


def test_a_package_on_a_permitted_edge_passes(tmp_path: Path) -> None:
    _package(
        tmp_path,
        "package.json",
        "root",
        dependencies={"@clockwyrks/run-record": "0.1.0", "@clockwyrks/backend-api": "0.1.0", "react": "19.0.0"},
    )
    assert edges.violations(tmp_path, "console.testcabinet.ai") == []


def test_a_narrowed_edge_admits_its_package_alone(tmp_path: Path) -> None:
    _package(
        tmp_path,
        "packages/a/package.json",
        "@clockwyrks/a",
        dependencies={"@clockwyrks/asset-contract": "0.1.0", "@clockwyrks/backend-api": "0.1.0"},
    )
    assert edges.violations(tmp_path, "engines") == [
        (
            "packages/a/package.json: [dependencies] @clockwyrks/backend-api comes from contracts,"
            " which engines may not depend on"
        )
    ]


def test_an_application_package_is_refused_to_a_site(tmp_path: Path) -> None:
    _package(tmp_path, "package.json", "root", dependencies={"@clockwyrks/gg-sandbox": "0.1.0"})
    assert edges.violations(tmp_path, "console.testcabinet.ai") == [
        (
            "package.json: [dependencies] @clockwyrks/gg-sandbox comes from gg,"
            " which console.testcabinet.ai may not depend on"
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
    assert edges.violations(tmp_path, "microservice-driver") == [
        "package.json: [peerDependencies] @clockwyrks/nowhere is produced by no repository of the project"
    ]


def test_a_workspace_member_is_its_own_package(tmp_path: Path) -> None:
    _package(tmp_path, "package.json", "root", workspaces=["packages/*"], devDependencies={"@clockwyrks/fresh": "*"})
    _package(tmp_path, "packages/fresh/package.json", "@clockwyrks/fresh")
    assert edges.violations(tmp_path, "contracts") == []


def test_a_file_dependency_leaving_the_repository_is_refused(tmp_path: Path) -> None:
    repo = tmp_path / "ui-common"
    _package(
        repo, "package.json", "root", dependencies={"@clockwyrks/ui": "file:packages/ui", "x": "file:../contracts/x"}
    )
    _package(repo, "packages/ui/package.json", "@clockwyrks/ui")
    assert edges.violations(repo, "ui-common") == [
        "package.json: [dependencies] x is a path dependency outside the repository"
    ]


def test_installed_and_built_trees_are_not_judged(tmp_path: Path) -> None:
    _package(tmp_path, "node_modules/x/package.json", "x", dependencies={"@clockwyrks/nowhere": "1"})
    _write(tmp_path, "target/debug/Cargo.toml", '[dependencies]\nv = { git = "https://github.com/TheClockwyrks/gg" }\n')
    assert edges.violations(tmp_path, "contracts") == []


def test_a_content_repositorys_catalog_is_content_not_its_build(tmp_path: Path) -> None:
    """A seeded workspace or a reference implementation is built in a run's tree, not by the repository."""
    _write(
        tmp_path,
        "test-cases/adversarial/easy/foray/v1.0.0/workspaces/base/controller/Cargo.toml",
        '[package]\nname = "controller"\n[dependencies]\nforay-core = { path = "../../../vendor/foray-core" }\n',
    )
    _package(
        tmp_path,
        "test-cases/end-to-end/easy/spectra/v2.0.0/references/none/base/package.json",
        "spectra",
        dependencies={"@clockwyrks/run-record": "0.1.0"},
    )
    _package(
        tmp_path, "game-jams/trains/v1.0.0/workspaces/base/package.json", "jam", dependencies={"@clockwyrks/web": "1"}
    )
    _package(tmp_path, "test-suites/carom/versions/v1.0.0/package.json", "carom", dependencies={"@clockwyrks/web": "1"})
    _package(tmp_path, "tools/designer/package.json", "@clockwyrks/designer", dependencies={"@clockwyrks/web": "1"})
    assert edges.violations(tmp_path, "test-suites") == [
        (
            "tools/designer/package.json: [dependencies] @clockwyrks/web comes from console.testcabinet.ai,"
            " which test-suites may not depend on"
        )
    ]


def test_only_a_content_repository_leaves_those_trees_out(tmp_path: Path) -> None:
    _package(tmp_path, "test-cases/x/package.json", "x", dependencies={"@clockwyrks/gg-sandbox": "1"})
    assert edges.content_trees("contracts") == frozenset()
    assert edges.violations(tmp_path, "contracts") == [
        (
            "test-cases/x/package.json: [dependencies] @clockwyrks/gg-sandbox comes from gg,"
            " which contracts may not depend on"
        )
    ]


def test_an_unknown_repository_is_refused() -> None:
    with pytest.raises(ValueError, match="unknown repository"):
        edges.edges_of("elsewhere")


def test_describe_names_each_edge() -> None:
    assert edges.describe("contracts") == "no other repository of the project"
    assert edges.describe("console.testcabinet.ai") == "contracts (packages); engines (packages); ui-common (packages)"
    assert edges.describe("tool-voxel") == "contracts (crates and packages); tool-model-core (crates and packages)"
    assert edges.describe("engines") == "contracts (crates and @clockwyrks/asset-contract)"
