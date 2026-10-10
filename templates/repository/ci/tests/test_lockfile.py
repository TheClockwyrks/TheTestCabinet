"""The lock-file rules of an application (`the_test_cabinet_ci.lockfile`)."""

from __future__ import annotations

from pathlib import Path

import pytest

from the_test_cabinet_ci import lockfile
from the_test_cabinet_ci.proc import git

STANDALONE = """
version = 4

[[package]]
name = "test-cabinet-cli"
version = "0.0.0"
dependencies = ["test-cabinet-contracts"]

[[package]]
name = "test-cabinet-contracts"
version = "0.0.0"
source = "git+https://github.com/TheClockwyrks/contracts?branch=master#abc"
"""

REWRITTEN = """
version = 4

[[package]]
name = "test-cabinet-cli"
version = "0.0.0"
dependencies = ["test-cabinet-contracts"]

[[package]]
name = "test-cabinet-contracts"
version = "0.0.0"

[[patch.unused]]
name = "test-cabinet-engines"
version = "0.0.0"
"""


def _workspace(root: Path) -> Path:
    root.mkdir(parents=True)
    (root / "Cargo.toml").write_text('[package]\nname = "app"\n', encoding="utf-8")
    return root


def test_no_patch_table_means_locked(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CARGO_HOME", str(tmp_path / "cargo-home"))
    root = _workspace(tmp_path / "app")
    assert lockfile.patch_table_active(root) is False
    assert lockfile.locked_arguments(root) == ["--locked"]


def test_a_patch_table_above_the_checkout_is_seen(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CARGO_HOME", str(tmp_path / "cargo-home"))
    root = _workspace(tmp_path / "super" / "app")
    (tmp_path / "super" / ".cargo").mkdir()
    (tmp_path / "super" / ".cargo" / "config.toml").write_text(
        '[patch."https://github.com/TheClockwyrks/contracts"]\ntest-cabinet-contracts = { path = "contracts" }\n',
        encoding="utf-8",
    )
    assert lockfile.patch_table_active(root) is True
    assert lockfile.locked_arguments(root) == []


def test_an_empty_patch_table_does_not_count(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CARGO_HOME", str(tmp_path / "cargo-home"))
    root = _workspace(tmp_path / "app")
    (root / ".cargo").mkdir()
    (root / ".cargo" / "config.toml").write_text("[net]\ngit-fetch-with-cli = true\n", encoding="utf-8")
    assert lockfile.patch_table_active(root) is False


def test_a_patch_table_in_cargo_home_is_seen(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = tmp_path / "cargo-home"
    home.mkdir()
    (home / "config.toml").write_text('[patch.crates-io]\nserde = { path = "serde" }\n', encoding="utf-8")
    monkeypatch.setenv("CARGO_HOME", str(home))
    assert lockfile.patch_table_active(_workspace(tmp_path / "app")) is True


def test_a_standalone_lock_file_has_no_problems() -> None:
    assert lockfile.rewritten_lock_problems(STANDALONE, {"test-cabinet-cli"}) == []


def test_the_workspace_s_own_crate_needs_no_source() -> None:
    problems = lockfile.rewritten_lock_problems(STANDALONE)
    assert problems == ["test-cabinet-cli has no source, so it was resolved to a sibling checkout"]


def test_a_registry_crate_is_never_a_mark() -> None:
    registry = (
        STANDALONE
        + '\n[[package]]\nname = "serde"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n'
    )
    assert lockfile.rewritten_lock_problems(registry, {"test-cabinet-cli"}) == []


def test_workspace_members_are_read_from_the_manifests(tmp_path: Path) -> None:
    crate = tmp_path / "app" / "crates" / "test-cabinet-cli"
    crate.mkdir(parents=True)
    (tmp_path / "app" / "Cargo.toml").write_text('[workspace]\nmembers = ["crates/*"]\n', encoding="utf-8")
    (crate / "Cargo.toml").write_text('[package]\nname = "test-cabinet-cli"\n', encoding="utf-8")
    assert lockfile.workspace_members(tmp_path / "app") == {"test-cabinet-cli"}


def test_a_rewritten_lock_file_names_both_marks() -> None:
    problems = lockfile.rewritten_lock_problems(REWRITTEN, {"test-cabinet-cli"})
    assert any("[[patch.unused]]" in problem for problem in problems)
    assert any(problem.startswith("test-cabinet-contracts has no source") for problem in problems)


def test_a_lock_file_that_does_not_parse_is_a_problem() -> None:
    assert lockfile.rewritten_lock_problems("version = [")[0].startswith("Cargo.lock does not parse")


def _repository(root: Path) -> Path:
    (root / "crates" / "test-cabinet-cli").mkdir(parents=True)
    (root / "crates" / "test-cabinet-cli" / "Cargo.toml").write_text(
        '[package]\nname = "test-cabinet-cli"\n', encoding="utf-8"
    )
    git(["init", "-q", "-b", "master"], cwd=root)
    git(["config", "user.name", "test"], cwd=root)
    git(["config", "user.email", "test@example.com"], cwd=root)
    return root


def test_the_staged_lock_file_is_judged_over_the_working_copy(tmp_path: Path) -> None:
    root = _repository(tmp_path / "app")
    (root / "Cargo.lock").write_text(STANDALONE, encoding="utf-8")
    git(["add", "Cargo.lock"], cwd=root)
    git(["commit", "-q", "-m", "chore: lock"], cwd=root)
    (root / "Cargo.lock").write_text(REWRITTEN, encoding="utf-8")
    assert lockfile.committed_lock_problems(root) == []
    git(["add", "Cargo.lock"], cwd=root)
    assert lockfile.committed_lock_problems(root) != []


def test_a_missing_lock_file_is_a_problem(tmp_path: Path) -> None:
    root = _repository(tmp_path / "app")
    assert lockfile.committed_lock_problems(root) == [
        "no Cargo.lock is committed or staged, and an application commits one"
    ]
