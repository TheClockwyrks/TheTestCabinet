"""The superrepo's lock-file rules (`the_test_cabinet_ci.lockfile`)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from the_test_cabinet_ci import lockfile

PACKAGES = """version = 4

[[package]]
name = "test-cabinet-driver"
version = "0.0.0"
dependencies = ["test-cabinet-contracts", "test-cabinet-engines"]

[[package]]
name = "test-cabinet-contracts"
version = "0.2.0"

[[package]]
name = "test-cabinet-engines"
version = "1.1.0"
"""

CONTRACTS_UNUSED = """
[[patch.unused]]
name = "api-codegen"
version = "0.2.0"

[[patch.unused]]
name = "contract-codegen"
version = "0.2.0"
"""

ENGINES_UNUSED = """
[[patch.unused]]
name = "foray-cli"
version = "0.0.0"

[[patch.unused]]
name = "lattice-cli"
version = "0.0.0"
"""

# The two orders cargo writes the one resolution in, the unused patches of
# contracts' table first or engines' first.
CONTRACTS_FIRST = PACKAGES + CONTRACTS_UNUSED + ENGINES_UNUSED
ENGINES_FIRST = PACKAGES + ENGINES_UNUSED + CONTRACTS_UNUSED


def _workspace(root: Path) -> Path:
    root.mkdir(parents=True)
    (root / "Cargo.toml").write_text('[package]\nname = "app"\n', encoding="utf-8")
    return root


def test_no_patch_table_means_locked(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CARGO_HOME", str(tmp_path / "cargo-home"))
    root = _workspace(tmp_path / "app")
    assert lockfile.patch_table_active(root) is False
    assert lockfile.locked_arguments(root) == ["--locked"]


def test_a_patch_table_above_the_workspace_drops_locked(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CARGO_HOME", str(tmp_path / "cargo-home"))
    root = _workspace(tmp_path / "super" / "packages" / "guest")
    (tmp_path / "super" / ".cargo").mkdir()
    (tmp_path / "super" / ".cargo" / "config.toml").write_text(
        '[patch."https://github.com/TheClockwyrks/engines"]\n'
        'test-cabinet-engines = { path = "engines/crates/engines" }\n',
        encoding="utf-8",
    )
    assert lockfile.patch_table_active(root) is True
    assert lockfile.locked_arguments(root) == []


def test_a_commented_patch_table_is_not_active(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CARGO_HOME", str(tmp_path / "cargo-home"))
    root = _workspace(tmp_path / "super")
    (root / ".cargo").mkdir()
    (root / ".cargo" / "config.toml").write_text('#   [patch."https://example"]\n', encoding="utf-8")
    assert lockfile.locked_arguments(root) == ["--locked"]


def test_this_superrepo_builds_without_locked() -> None:
    root = Path(__file__).resolve().parents[2]
    assert lockfile.locked_arguments(root) == []


def test_two_locks_differing_only_in_the_order_of_the_unused_groups_are_one_resolution() -> None:
    assert CONTRACTS_FIRST != ENGINES_FIRST
    assert lockfile.same_resolution(CONTRACTS_FIRST, ENGINES_FIRST)


def test_an_unused_patch_more_or_less_is_another_resolution() -> None:
    fewer = PACKAGES + CONTRACTS_UNUSED
    assert not lockfile.same_resolution(CONTRACTS_FIRST, fewer)


def test_a_package_entry_that_differs_is_another_resolution() -> None:
    moved = CONTRACTS_FIRST.replace('version = "1.1.0"', 'version = "1.2.0"')
    assert not lockfile.same_resolution(CONTRACTS_FIRST, moved)


def test_a_lock_that_does_not_parse_is_another_resolution() -> None:
    assert not lockfile.same_resolution(CONTRACTS_FIRST, "[[package]\n")


def test_the_superrepo_locks_are_the_root_one_and_the_nested_ones(tmp_path: Path) -> None:
    for relative in ("Cargo.lock", "packages/guest/Cargo.lock", "packages/gg/guest/Cargo.lock", "crates/x/Cargo.lock"):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("version = 4\n", encoding="utf-8")
    assert [lock.relative_to(tmp_path).as_posix() for lock in lockfile.superrepo_locks(tmp_path)] == [
        "Cargo.lock",
        "packages/gg/guest/Cargo.lock",
        "packages/guest/Cargo.lock",
    ]


def test_a_build_that_only_reorders_a_lock_leaves_it_as_it_was(tmp_path: Path) -> None:
    lock = tmp_path / "Cargo.lock"
    lock.write_text(CONTRACTS_FIRST, encoding="utf-8")
    os.utime(lock, ns=(1_000_000_000, 1_000_000_000))
    with lockfile.keep_lock_order([lock]):
        lock.write_text(ENGINES_FIRST, encoding="utf-8")
    assert lock.read_text(encoding="utf-8") == CONTRACTS_FIRST
    assert lock.stat().st_mtime_ns == 1_000_000_000


def test_a_build_that_changes_a_lock_keeps_the_change(tmp_path: Path) -> None:
    lock = tmp_path / "Cargo.lock"
    lock.write_text(CONTRACTS_FIRST, encoding="utf-8")
    changed = PACKAGES + CONTRACTS_UNUSED
    with lockfile.keep_lock_order([lock, tmp_path / "missing" / "Cargo.lock"]):
        lock.write_text(changed, encoding="utf-8")
    assert lock.read_text(encoding="utf-8") == changed
