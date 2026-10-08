"""What the tests share: a throwaway checkout with gates in it, and the CLIs.

The commands are run as child processes, the way pre-commit and a workflow run
them, so that what a test reads off stdout is what a caller would read.
"""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from collections.abc import Callable
from pathlib import Path

import pytest

from the_test_cabinet_ci import proc


@pytest.fixture
def checkout(tmp_path: Path) -> Path:
    """An empty git checkout with a `ci/gates/` directory."""
    root = tmp_path / "checkout"
    (root / "ci" / "gates").mkdir(parents=True)
    # Through the project's own helper: a plain subprocess would inherit a
    # commit hook's GIT_DIR and act on the repository being committed to.
    assert proc.git(["init", "--quiet", str(root)]).returncode == 0
    # git answers with the resolved path, and the tests compare against it.
    return root.resolve()


@pytest.fixture
def outside_a_checkout(tmp_path: Path) -> Path:
    """A directory that is inside no git checkout.

    GIT_CEILING_DIRECTORIES used to draw this boundary, but it is one of the
    variables `proc.git` strips (it decides which repository discovery finds),
    so the boundary has to be real. Every ancestor is checked here, in Python
    rather than by asking git, and the rare machine whose temporary directory
    sits inside a checkout skips the test instead of failing it.
    """
    outside = tmp_path / "outside"
    outside.mkdir()
    for ancestor in [outside, *outside.parents]:
        if (ancestor / ".git").exists():
            pytest.skip(f"{ancestor} is a git checkout, so nothing under it is outside one")
    return outside


@pytest.fixture
def add_gate(checkout: Path) -> Callable[..., Path]:
    """Write a gate script into the checkout: `add_gate("id", "python source")`."""

    def add(gate_id: str, source: str) -> Path:
        path = checkout / "ci" / "gates" / f"{gate_id}.py"
        path.write_text(textwrap.dedent(source), encoding="utf-8")
        return path

    return add


def _cli(module: str, args: list[str], cwd: Path, env: dict[str, str] | None) -> subprocess.CompletedProcess[str]:
    environment = {name: value for name, value in os.environ.items() if name != "CI_GATE_ARTIFACTS"}
    environment.update(env or {})
    return subprocess.run(
        [sys.executable, "-m", module, *args],
        cwd=cwd,
        env=environment,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture
def gate(checkout: Path) -> Callable[..., subprocess.CompletedProcess[str]]:
    """Run the `gate` command inside the checkout."""

    def run(*args: str, cwd: Path | None = None, env: dict[str, str] | None = None):
        return _cli("the_test_cabinet_ci.gate_cli", list(args), cwd or checkout, env)

    return run


@pytest.fixture
def metrics_cli(tmp_path: Path) -> Callable[..., subprocess.CompletedProcess[str]]:
    """Run the `metrics` command."""

    def run(*args: str, cwd: Path | None = None):
        return _cli("the_test_cabinet_ci.metrics_cli", list(args), cwd or tmp_path, None)

    return run
