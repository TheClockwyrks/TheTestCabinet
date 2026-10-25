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


def test_uv_project_refuses_a_folder_that_is_no_project(tmp_path: Path, capfd: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exited:
        proc.uv_project(tmp_path / "tools" / "example", ["pytest"])
    assert exited.value.code == 1
    assert "tools/example is not a uv project" in capfd.readouterr().err


def test_uv_project_runs_in_that_project_without_this_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "pyproject.toml").write_text("", encoding="utf-8")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    record = tmp_path / "record"
    uv = bin_dir / "uv"
    # Written without an f-string, whose doubled braces the template would read.
    uv.write_text('#!/bin/sh\necho "$@" "venv=${VIRTUAL_ENV:-unset}" > ' + str(record) + "\n", encoding="utf-8")
    uv.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("VIRTUAL_ENV", "/this/projects/venv")
    assert proc.uv_project(project, ["example", "check"])
    assert record.read_text(encoding="utf-8").split() == [
        "run", "--quiet", "--project", str(project), "example", "check", "venv=unset",
    ]  # fmt: skip


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


# The figures cspell's and markdownlint-cli2's summaries state, as the gates read them.
CSPELL_COUNT = r"Files checked: (\d+)"
MARKDOWNLINT_COUNT = r"Linting: (\d+) file"

# What cspell 10 prints, and nothing else, when its globs and ignores leave it no file.
CSPELL_USAGE = "Usage: cspell lint [options] [globs...]\n\nPatterns:\n - [globs...]            Glob Patterns\n"


@pytest.mark.parametrize(
    ("output", "pattern", "count"),
    [
        ("CSpell: Files checked: 73, Issues found: 0 in 0 files.\n", CSPELL_COUNT, 73),
        ("CSpell: Files checked: 74 (74 from cache), Issues found: 1 in 1 file.\n", CSPELL_COUNT, 74),
        ("CSpell: Files checked: 0, Issues found: 0 in 0 files.\n", CSPELL_COUNT, 0),
        ("\x1b[1mCSpell: Files checked: \x1b[32m5\x1b[0m, Issues found: 0\n", CSPELL_COUNT, 5),
        (CSPELL_USAGE, CSPELL_COUNT, None),
        ("Finding: **/*.md !.git/**\nLinting: 12 file(s)\nSummary: 0 error(s)\n", MARKDOWNLINT_COUNT, 12),
        ("Finding: **/*.md !.git/**\nLinting: 0 file(s)\nSummary: 0 error(s)\n", MARKDOWNLINT_COUNT, 0),
        ("", MARKDOWNLINT_COUNT, None),
    ],
)
def test_files_checked_reads_the_count_a_tool_states(output: str, pattern: str, count: int | None) -> None:
    assert proc.files_checked(output, pattern) == count


def test_a_lint_tool_that_checked_files_passes_with_its_count(capfd: pytest.CaptureFixture[str]) -> None:
    assert proc.require_files_checked("cspell", "CSpell: Files checked: 3, Issues found: 0", CSPELL_COUNT) == 3
    assert capfd.readouterr() == ("", "")


@pytest.mark.parametrize(
    ("output", "found"),
    [
        ("Linting: 0 file(s)\nSummary: 0 error(s)\n", "markdownlint-cli2 checked no file."),
        ("", "markdownlint-cli2 reported no count of the files it checked"),
    ],
)
def test_a_lint_tool_that_checked_no_file_fails_saying_why(
    output: str, found: str, capfd: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit) as exited:
        proc.require_files_checked("markdownlint-cli2", output, MARKDOWNLINT_COUNT)
    assert exited.value.code == 1
    err = capfd.readouterr().err
    assert found in err
    assert "Its globs and ignore patterns left it no file to check" in err
    assert "`**/.git/**`" in err
    assert "`/.git/**`" in err


def _tool(tmp_path: Path, output: str, status: int) -> list[str]:
    """A command that writes `output`, half on stdout and half on stderr, and exits `status`."""
    middle = len(output) // 2
    script = tmp_path / "tool.py"
    script.write_text(
        "import sys\n"
        f"sys.stdout.write({output[:middle]!r}); sys.stdout.flush()\n"
        f"sys.stderr.write({output[middle:]!r}); sys.stderr.flush()\n"
        f"raise SystemExit({status})\n",
        encoding="utf-8",
    )
    return [sys.executable, str(script)]


def test_run_lint_echoes_the_tool_and_returns_its_status(tmp_path: Path, capfd: pytest.CaptureFixture[str]) -> None:
    """The tool's verdict is the gate's to judge once it checked a file: a
    failure from a real lint error comes back, with every line it wrote."""
    output = "notes.md:1:3 - Unknown word (qzxvbnmk)\nCSpell: Files checked: 2, Issues found: 1 in 1 file.\n"
    done = proc.run_lint("cspell", _tool(tmp_path, output, 1), counted=CSPELL_COUNT)
    assert done.returncode == 1
    assert capfd.readouterr() == (output, "")


def test_run_lint_fails_on_no_file_without_the_usage_text(tmp_path: Path, capfd: pytest.CaptureFixture[str]) -> None:
    """cspell finding no file prints its whole usage and fails, which names no
    cause; the gate leaves that out and says what happened instead."""
    with pytest.raises(SystemExit) as exited:
        proc.run_lint("cspell", _tool(tmp_path, CSPELL_USAGE, 1), counted=CSPELL_COUNT)
    assert exited.value.code == 1
    out, err = capfd.readouterr()
    assert "Usage:" not in out + err
    assert "Glob Patterns" not in out + err
    assert "cspell reported no count of the files it checked" in err


def test_run_lint_fails_on_a_count_of_zero_though_the_tool_passed(
    tmp_path: Path, capfd: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit) as exited:
        proc.run_lint(
            "markdownlint-cli2",
            _tool(tmp_path, "Linting: 0 file(s)\nSummary: 0 error(s)\n", 0),
            counted=MARKDOWNLINT_COUNT,
        )
    assert exited.value.code == 1
    out, err = capfd.readouterr()
    assert "Linting: 0 file(s)" in out
    assert "markdownlint-cli2 checked no file." in err
