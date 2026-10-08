"""The gates this workspace ships, read and never run."""

from __future__ import annotations

import ast
import tomllib
from pathlib import Path

import pytest

from the_test_cabinet_ci import proc, runner

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


def _uv_projects() -> list[str]:
    """Every directory of the workspace holding a `pyproject.toml`.

    git decides what the workspace holds where there is a repository: what it
    tracks, and what it would track, which leaves out a scratch checkout under
    an ignored directory and the files of a submodule, which has gates of its
    own. A workspace no repository holds yet is searched instead, leaving out
    what a tool installed.
    """
    listed = proc.git(
        ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*pyproject.toml"], cwd=ROOT, quiet=True
    )
    if listed.returncode == 0:
        paths = [Path(line) for line in listed.stdout.splitlines()]
    else:
        installed = {"node_modules", "target", "dist"}
        paths = [
            path.relative_to(ROOT)
            for path in ROOT.glob("**/pyproject.toml")
            if not any(part in installed or part.startswith(".") for part in path.relative_to(ROOT).parts)
        ]
    return sorted(path.parent.as_posix() for path in paths if path.name == "pyproject.toml")


def _projects_linted() -> list[str]:
    """The uv projects `python-lint` names."""
    named = next(
        node.value
        for node in ast.parse((GATES_DIR / "python-lint.py").read_text(encoding="utf-8")).body
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", None) == "PROJECTS"
    )
    return ast.literal_eval(named)


def test_the_python_gate_names_every_uv_project() -> None:
    """A project the gate does not name is Python nothing lints, so one added
    without naming it, or a directory holding it, fails here rather than going
    unlinted. The gate also names the repository scripts and the repository
    kit, whose Python is held to the same rules from those directories."""
    named = [Path(path) for path in _projects_linted()]
    missing = [project for project in _uv_projects() if not any(Path(project).is_relative_to(path) for path in named)]
    assert missing == [], f"python-lint names none of the uv projects {missing}"


def test_every_uv_project_is_linted_by_one_configuration() -> None:
    """The rules are settled in `ci/` alone, so the projects cannot drift. A
    directory the gate names that is no uv project, such as the scripts, or the
    kit, whose `ci/` is the rendered repository's own settled project, is
    passed over."""
    for project in _projects_linted():
        if project == "ci" or not (ROOT / project / "pyproject.toml").is_file():
            continue
        pyproject = tomllib.loads((ROOT / project / "pyproject.toml").read_text(encoding="utf-8"))
        back = "/".join([".."] * len(Path(project).parts))
        assert pyproject.get("tool", {}).get("ruff") == {"extend": f"{back}/ci/pyproject.toml"}, (
            f"{project}/pyproject.toml settles ruff's rules itself rather than extending ci/pyproject.toml's"
        )


def test_the_repository_scripts_extend_the_one_configuration() -> None:
    settings = tomllib.loads((ROOT / "scripts" / "repos" / "ruff.toml").read_text(encoding="utf-8"))
    assert settings == {"extend": "../../ci/pyproject.toml"}


def test_ruff_is_pinned_where_a_gate_finds_it() -> None:
    """A Python gate runs in this project's own environment, so the linter it
    reaches for has to be a dependency of it rather than something the machine
    happens to carry."""
    pyproject = tomllib.loads((ROOT / "ci" / "pyproject.toml").read_text(encoding="utf-8"))
    assert any(requirement.startswith("ruff") for requirement in pyproject["dependency-groups"]["dev"])
    assert "ruff" in pyproject["tool"], "the settings a gate reads live with the gate"
