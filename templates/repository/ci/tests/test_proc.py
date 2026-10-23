"""The helpers a gate script is written with."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from the_test_cabinet_ci import proc


def test_repo_root_is_the_top_of_the_checkout(checkout: Path) -> None:
    below = checkout / "a" / "b"
    below.mkdir(parents=True)
    assert proc.repo_root(below) == checkout


def test_repo_root_outside_a_checkout(outside_a_checkout: Path) -> None:
    with pytest.raises(proc.NotInRepository, match="not inside a git checkout"):
        proc.repo_root(outside_a_checkout)


def test_repo_root_finds_a_workspace_that_is_no_checkout_yet(outside_a_checkout: Path) -> None:
    """A workspace rendered from the template is a plain directory until
    `git init` makes it one, and `make gate` has to run there."""
    workspace = outside_a_checkout / "rendered"
    (workspace / proc.WORKSPACE_MARKER).parent.mkdir(parents=True)
    (workspace / proc.WORKSPACE_MARKER).write_text("", encoding="utf-8")
    below = workspace / "apps" / "web"
    below.mkdir(parents=True)
    assert proc.repo_root(below) == workspace.resolve()


def test_enter_repo_root_changes_directory(checkout: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    below = checkout / "below"
    below.mkdir()
    monkeypatch.chdir(below)
    assert proc.enter_repo_root() == checkout
    assert Path.cwd() == checkout


def test_run_reports_the_exit_status(tmp_path: Path) -> None:
    assert proc.run([sys.executable, "-c", "raise SystemExit(3)"]).returncode == 3
    assert proc.succeeded([sys.executable, "-c", "pass"])
    assert not proc.succeeded([sys.executable, "-c", "raise SystemExit(1)"])


def test_run_captures_stdout_when_asked(tmp_path: Path) -> None:
    assert proc.run([sys.executable, "-c", "print('hello')"], capture=True).stdout == "hello\n"


def test_run_takes_paths_a_directory_and_an_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INHERITED", "yes")
    monkeypatch.setenv("UNWANTED", "yes")
    script = tmp_path / "script.py"
    script.write_text(
        "import os\nprint(os.getcwd(), *(os.environ.get(n) for n in ('INHERITED', 'ADDED', 'UNWANTED')))\n",
        encoding="utf-8",
    )
    ran = proc.run([Path(sys.executable), script], cwd=tmp_path, env={"ADDED": "too"}, unset=["UNWANTED"], capture=True)
    assert ran.stdout.split() == [os.path.realpath(tmp_path), "yes", "too", "None"]


def test_an_absent_tool_is_status_127(capfd: pytest.CaptureFixture[str]) -> None:
    assert proc.run(["a-tool-nobody-installed"]).returncode == 127
    assert "a-tool-nobody-installed: command not found" in capfd.readouterr().err


def test_fail_prints_on_stderr_and_exits(capfd: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exited:
        proc.fail("", "It broke.", "Fix it.")
    assert exited.value.code == 1
    assert capfd.readouterr() == ("", "\nIt broke.\nFix it.\n")


def test_skip_prints_on_stdout_and_passes(capfd: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exited:
        proc.skip("Nothing to check.")
    assert exited.value.code == 0
    assert capfd.readouterr() == ("Nothing to check.\n", "")


def test_require_tool(capfd: pytest.CaptureFixture[str]) -> None:
    assert Path(proc.require_tool("git")).name == "git"
    with pytest.raises(SystemExit):
        proc.require_tool("a-tool-nobody-installed", "Install it from somewhere.")
    assert capfd.readouterr().err == "a-tool-nobody-installed is not installed.\nInstall it from somewhere.\n"


def test_artifacts_dir_is_created_when_named(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    named = tmp_path / "report" / "gate"
    monkeypatch.setenv(proc.ARTIFACTS_ENV, str(named))
    assert proc.artifacts_dir() == named.resolve()
    assert named.is_dir()


@pytest.mark.parametrize("value", [None, ""])
def test_no_artifacts_dir_without_the_variable(value: str | None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(proc.ARTIFACTS_ENV, raising=False)
    if value is not None:
        monkeypatch.setenv(proc.ARTIFACTS_ENV, value)
    assert proc.artifacts_dir() is None


def test_the_helpers_flush_before_a_child_writes(tmp_path: Path) -> None:
    # With stdout a file, Python holds `say`'s line back unless it is flushed,
    # and the child's line would land ahead of it.
    out = tmp_path / "out.log"
    script = (
        "import sys\nfrom the_test_cabinet_ci import run, say\n"
        "sys.stdout.write('unflushed\\n')\nrun([sys.executable, '-c', \"print('child')\"])\nsay('after')\n"
    )
    with out.open("wb") as sink:
        subprocess.run([sys.executable, "-c", script], stdout=sink, check=True)
    assert out.read_text(encoding="utf-8").splitlines() == ["unflushed", "child", "after"]
