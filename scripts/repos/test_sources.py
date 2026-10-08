"""The patch table, the package links and the git rewrites, each derived from the table of repositories."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

import pytest

import render
import sources

CONTRACTS = "https://github.com/TheClockwyrks/contracts"


def _crate(root: Path, repo: str, directory: str, name: str) -> None:
    manifest = root / repo / "crates" / directory / "Cargo.toml"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(f'[package]\nname = "{name}"\n', encoding="utf-8")
    (root / repo / "Cargo.toml").write_text('[workspace]\nmembers = ["crates/*"]\n', encoding="utf-8")


def test_every_repository_has_a_mirror_named_as_it_is_on_azure() -> None:
    mirrors = render.edge_table().MIRRORS
    assert set(render.repositories()) <= set(mirrors)
    assert all(mirrors[repo] == repo for repo in render.repositories())
    assert render.public_source("contracts") == CONTRACTS
    assert render.public_source("the-test-cabinet") == "https://github.com/TheClockwyrks/TheTestCabinet"


def test_the_patch_table_comments_out_a_repository_not_checked_out(tmp_path: Path) -> None:
    block = sources.patch_block(tmp_path)
    assert block.startswith(sources.BEGIN) and block.rstrip().endswith(sources.END)
    assert "# contracts is not checked out" in block
    assert f'#   [patch."{CONTRACTS}"]' in block
    assert f'\n[patch."{CONTRACTS}"]' not in block
    assert "[net]" not in block, "a block with no active entry fetches nothing"
    assert "gg.rocks" not in block and "test-suites" not in block, "a kind with no crate has no table"
    assert tomllib.loads(block) == {}


def test_the_patch_table_patches_every_crate_a_checkout_declares(tmp_path: Path) -> None:
    _crate(tmp_path, "contracts", "contracts", "test-cabinet-contracts")
    _crate(tmp_path, "contracts", "contract-schema", "test-cabinet-contract-schema")
    parsed = tomllib.loads(sources.patch_block(tmp_path))
    assert parsed["patch"] == {
        CONTRACTS: {
            "test-cabinet-contract-schema": {"path": "contracts/crates/contract-schema"},
            "test-cabinet-contracts": {"path": "contracts/crates/contracts"},
        }
    }
    assert parsed["net"] == {"git-fetch-with-cli": True}


def test_the_block_replaces_itself_and_keeps_the_rest_of_the_file(tmp_path: Path) -> None:
    config = '[alias]\nb = "build"\n'
    once = sources.with_patch_block(config, tmp_path)
    assert once.startswith(config) and sources.BEGIN in once
    _crate(tmp_path, "contracts", "contracts", "test-cabinet-contracts")
    twice = sources.with_patch_block(once + "\n# after\n", tmp_path)
    assert twice.count(sources.BEGIN) == 1
    assert twice.startswith(config) and twice.endswith("# after\n")
    assert f'\n[patch."{CONTRACTS}"]' in twice
    with pytest.raises(ValueError, match="never closes it"):
        sources.with_patch_block(f"{sources.BEGIN}\n", tmp_path)


def test_the_committed_patch_table_is_current() -> None:
    config = sources.CARGO_CONFIG.read_text(encoding="utf-8")
    assert sources.with_patch_block(config) == config, "run scripts/repos/sources.py patch-table --write"


def test_the_committed_package_links_are_current() -> None:
    written = (render.SUPERREPO / sources.links.TABLE).read_text(encoding="utf-8")
    assert written == sources.links.render_table(sources.package_links()), "run scripts/repos/link-packages.sh"


def _workspace(root: Path, repo: str, packages: dict[str, dict[str, object]]) -> None:
    (root / repo).mkdir(parents=True, exist_ok=True)
    (root / repo / "package.json").write_text(
        json.dumps({"name": repo, "workspaces": ["packages/*"]}), encoding="utf-8"
    )
    for directory, manifest in packages.items():
        path = root / repo / "packages" / directory / "package.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(manifest), encoding="utf-8")


def test_the_package_links_name_what_each_checked_out_workspace_produces(tmp_path: Path) -> None:
    _workspace(tmp_path, "contracts", {"run-record": {"name": "@clockwyrks/run-record"}})
    _workspace(tmp_path, "web", {"ui": {"name": "@clockwyrks/ui", "dependencies": {"@clockwyrks/run-record": "0.1.0"}}})
    assert sources.package_links(tmp_path) == {
        "contracts": {"@clockwyrks/run-record": "packages/run-record"},
        "web": {"@clockwyrks/ui": "packages/ui"},
    }
    # The plan is read from the written table, as link-packages.sh writes it first.
    (tmp_path / sources.links.TABLE).write_text(
        sources.links.render_table(sources.package_links(tmp_path)), encoding="utf-8"
    )
    assert sources.link_plan(tmp_path) == [
        "install\tcontracts",
        "build\tcontracts",
        "install\tweb\tcontracts/packages/run-record",
    ]


def test_the_package_links_keep_a_repository_not_checked_out(tmp_path: Path) -> None:
    (tmp_path / sources.links.TABLE).write_text(
        sources.links.render_table({"engines": {"@clockwyrks/simple-2d": "packages/simple-2d"}}), encoding="utf-8"
    )
    _workspace(tmp_path, "contracts", {"run-record": {"name": "@clockwyrks/run-record"}})
    assert sources.package_links(tmp_path) == {
        "contracts": {"@clockwyrks/run-record": "packages/run-record"},
        "engines": {"@clockwyrks/simple-2d": "packages/simple-2d"},
    }


def test_a_rewrite_sends_each_public_source_to_its_azure_remote() -> None:
    pairs = {source: remote for remote, source in sources.rewrites()}
    assert pairs[CONTRACTS] == "git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/contracts"
    assert pairs["https://github.com/TheClockwyrks/TheTestCabinet"].endswith("/the-test-cabinet")
    environment = sources.rewrite_environment()
    assert int(environment["GIT_CONFIG_COUNT"]) == len(pairs)
    command = sources.rewrite_commands()[0]
    assert command[:3] == ["git", "config", "--global"] and command[3].endswith(".insteadOf")


def test_the_command_line_prints_a_mirror(capsys: pytest.CaptureFixture[str]) -> None:
    assert sources.main(["mirror", "the-test-cabinet"]) == 0
    assert capsys.readouterr().out.strip() == "TheTestCabinet"
    assert sources.main(["mirror", "nothing"]) == 1
