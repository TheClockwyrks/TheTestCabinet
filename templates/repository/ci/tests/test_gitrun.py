"""Git is run on the checkout the working directory is in, never on a hook's.

Git exports GIT_DIR, GIT_INDEX_FILE and the rest to every hook, and a hook's
children inherit them. They beat `cwd`, so a gate started from a commit hook
would otherwise read, and could write, the repository being committed to rather
than the checkout it entered. Every gate can run from a hook, so every git call
in this project goes through `proc.git`.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from the_test_cabinet_ci import proc

PROJECT = Path(__file__).resolve().parents[1]
# `proc` is where the one `["git", ...]` command lives, and this file spells
# commands out to prove the check below matches them, so both stand outside it.
EXEMPT = (PROJECT / "src" / "the_test_cabinet_ci" / "proc.py", Path(__file__).resolve())

# A list or tuple whose first element is the string "git": `["git", *args]`,
# `("git", "-C", ...)`. `require_tool("git")` names the tool and is not one.
DIRECT_GIT = re.compile(r"""[\[(]\s*(['"])git\1\s*[,\]]""")

# A gate that prints the checkout it entered, twice over: once as the helpers
# find it, and once as git itself answers from there.
WHERE = (
    '"""Where."""\n'
    "from the_test_cabinet_ci import enter_repo_root, git\n"
    "print(enter_repo_root())\n"
    'print(git(["rev-parse", "--show-toplevel"]).stdout.strip())\n'
)


def _decoy(tmp_path: Path) -> Path:
    """A second checkout, standing in for the repository a hook is committing to."""
    root = tmp_path / "decoy"
    root.mkdir()
    for args in (
        ["init", "--quiet", "--initial-branch=master"],
        ["config", "user.email", "decoy@example.invalid"],
        ["config", "user.name", "Decoy"],
        ["commit", "--quiet", "--allow-empty", "-m", "the decoy's only commit"],
    ):
        assert proc.git(args, cwd=root).returncode == 0
    return root


def _hook_environment(decoy: Path) -> dict[str, str]:
    """The environment git gives a hook, pointed at the decoy."""
    return {
        "GIT_DIR": str(decoy / ".git"),
        "GIT_INDEX_FILE": str(decoy / ".git" / "index"),
        "GIT_WORK_TREE": str(decoy),
    }


def _state(root: Path) -> tuple[str, str]:
    """The decoy's HEAD and working tree, as one comparable pair."""
    return (
        proc.git(["rev-parse", "HEAD"], cwd=root).stdout,
        proc.git(["status", "--porcelain"], cwd=root).stdout,
    )


def test_the_location_variables_are_stripped_and_the_rest_are_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in proc.GIT_LOCATION_VARIABLES:
        monkeypatch.setenv(name, "/somewhere/else")
    monkeypatch.setenv("GIT_AUTHOR_NAME", "Deliberate")
    cleaned = proc.git_environment()
    assert not [name for name in proc.GIT_LOCATION_VARIABLES if name in cleaned]
    # An identity a caller set on purpose points at no repository and stays.
    assert cleaned["GIT_AUTHOR_NAME"] == "Deliberate"


def test_repo_root_ignores_a_hooks_repository(checkout: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    decoy = _decoy(tmp_path)
    for name, value in _hook_environment(decoy).items():
        monkeypatch.setenv(name, value)
    below = checkout / "below"
    below.mkdir()
    assert proc.repo_root(below) == checkout


def test_a_gate_acts_on_its_own_checkout_under_a_hooks_environment(
    gate, add_gate, checkout: Path, tmp_path: Path
) -> None:
    """The live path: `gate run`, with the variables a commit hook is given."""
    decoy = _decoy(tmp_path)
    before = _state(decoy)
    add_gate("where", WHERE)
    result = gate("run", "where", env=_hook_environment(decoy))
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == [str(checkout), str(checkout)]
    # The decoy took no commit and no change at all.
    assert _state(decoy) == before


# Every folder of this project that holds Python. One left out is a hole in
# the check below.
SCANNED = ("src", "gates", "tests")


def _sources() -> list[Path]:
    return sorted(
        path for folder in SCANNED for path in (PROJECT / folder).rglob("*.py") if "__pycache__" not in path.parts
    )


def test_nothing_runs_git_except_the_helper() -> None:
    """`proc.git` is the only way this project runs git; keep it that way.

    A call site that builds its own `["git", ...]` command is the bug this
    helper exists to stop, so it is a test failure rather than a review note.
    """
    offenders = [
        f"{path.relative_to(PROJECT)}:{number}: {line.strip()}"
        for path in _sources()
        if path not in EXEMPT
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if DIRECT_GIT.search(line)
    ]
    assert offenders == [], "run git through the_test_cabinet_ci.proc.git instead:\n" + "\n".join(offenders)


def test_the_grep_would_catch_a_bypass() -> None:
    """The check above is only worth having if it matches what it is looking for."""
    assert DIRECT_GIT.search('run(["git", "check-attr", "-z", "binary"], capture=True)')
    assert DIRECT_GIT.search('subprocess.run(("git", "-C", str(root), "commit"))')
    assert DIRECT_GIT.search('argv = ["git"]')
    # Not a command: naming the tool, or running it through the helper.
    assert not DIRECT_GIT.search('require_tool("git")')
    assert not DIRECT_GIT.search('proc.git(["commit", "-m", "x"])')


def test_the_sources_scanned_are_the_whole_project() -> None:
    """A folder the scan reaches nothing in is a folder it does not cover.

    The gates are named by nothing here, because they are what a project adds
    to over time; what matters is that the folder they are in is read at all.
    """
    scanned = _sources()
    assert {"proc.py", "conftest.py", Path(__file__).name} <= {path.name for path in scanned}
    for folder in SCANNED:
        assert any(path.is_relative_to(PROJECT / folder) for path in scanned), f"nothing was scanned in {folder}/"
