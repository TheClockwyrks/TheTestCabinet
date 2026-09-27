"""Finding and describing gates. Nothing here may import or run one."""

from __future__ import annotations

from pathlib import Path

import pytest

from the_test_cabinet_ci import runner


def _gate(directory: Path, name: str, source: str = '"""A gate."""\n') -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(source, encoding="utf-8")
    return path


def test_discovers_gates_sorted_by_id(tmp_path: Path) -> None:
    for name in ("web-test.py", "a2-check.py", "rust-fmt.py"):
        _gate(tmp_path, name)
    assert [gate.id for gate in runner.discover(tmp_path)] == ["a2-check", "rust-fmt", "web-test"]


def test_ignores_what_is_not_shaped_like_a_gate(tmp_path: Path) -> None:
    _gate(tmp_path, "good.py")
    _gate(tmp_path, "_shared.py")
    _gate(tmp_path, "Upper.py")
    _gate(tmp_path, "under_score.py")
    _gate(tmp_path, "trailing-.py")
    _gate(tmp_path, "notes.md")
    (tmp_path / "folder.py").mkdir()
    assert [gate.id for gate in runner.discover(tmp_path)] == ["good"]


def test_a_missing_directory_has_no_gates(tmp_path: Path) -> None:
    assert runner.discover(tmp_path / "absent") == []


def test_description_is_the_first_docstring_line(tmp_path: Path) -> None:
    path = _gate(tmp_path, "g.py", '"""\n   Check the thing.   \n\nAnd say more about it.\n"""\nimport sys\n')
    assert runner.describe(path) == "Check the thing."


def test_description_is_read_without_running_the_script(tmp_path: Path) -> None:
    marker = tmp_path / "ran"
    path = _gate(
        tmp_path,
        "g.py",
        f'"""Described."""\nimport a_module_that_does_not_exist\nopen({str(marker)!r}, "w")\nraise SystemExit(9)\n',
    )
    assert runner.describe(path) == "Described."
    assert not marker.exists()


@pytest.mark.parametrize("source", ["import sys\n", "", "def broken(:\n", "x = '''not a docstring'''\n"])
def test_no_docstring_is_an_empty_description(tmp_path: Path, source: str) -> None:
    assert runner.describe(_gate(tmp_path, "g.py", source)) == ""


def test_select_keeps_the_order_given_and_runs_each_once(tmp_path: Path) -> None:
    for name in ("a.py", "b.py", "c.py"):
        _gate(tmp_path, name)
    assert [gate.id for gate in runner.select(tmp_path, ["c", "a", "c"])] == ["c", "a"]


def test_select_everything_is_in_id_order(tmp_path: Path) -> None:
    for name in ("b.py", "a.py"):
        _gate(tmp_path, name)
    assert [gate.id for gate in runner.select(tmp_path, [], everything=True)] == ["a", "b"]


def test_an_unknown_id_names_the_known_ones(tmp_path: Path) -> None:
    for name in ("rust-fmt.py", "web-test.py"):
        _gate(tmp_path, name)
    with pytest.raises(runner.UnknownGate) as raised:
        runner.select(tmp_path, ["rust-fmt", "nope", "also-nope"])
    assert raised.value.unknown == ["nope", "also-nope"]
    assert str(raised.value) == "unknown gates: nope, also-nope. Known gates: rust-fmt, web-test"
