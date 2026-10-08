"""The gates this workspace ships, read and never run."""

from __future__ import annotations

import ast
import tomllib
from pathlib import Path

import pytest

from the_test_cabinet_ci import runner

ROOT = Path(__file__).resolve().parents[2]
GATES_DIR = Path(__file__).resolve().parents[1] / "gates"
GATES = runner.discover(GATES_DIR)


def test_every_script_under_gates_is_a_gate() -> None:
    # A stem that is not shaped like an id would silently drop out of the list,
    # so the gate would exist and nothing would ever run it.
    stems = sorted(path.stem for path in GATES_DIR.glob("*.py") if not path.stem.startswith("_"))
    assert [gate.id for gate in GATES] == stems


@pytest.mark.parametrize("gate", GATES, ids=lambda gate: gate.id)
def test_a_gate_parses_and_is_described(gate: runner.Gate) -> None:
    ast.parse(gate.path.read_text(encoding="utf-8"))
    assert gate.description, f"{gate.path.name} needs a module docstring: its first line is the description"


def test_ruff_is_pinned_where_a_gate_finds_it() -> None:
    """A Python gate runs in this project's own environment, so the linter it
    reaches for has to be a dependency of it rather than something the machine
    happens to carry."""
    pyproject = tomllib.loads((ROOT / "ci" / "pyproject.toml").read_text(encoding="utf-8"))
    assert any(requirement.startswith("ruff") for requirement in pyproject["dependency-groups"]["dev"])
    assert "ruff" in pyproject["tool"], "the settings a gate reads live with the gate"
