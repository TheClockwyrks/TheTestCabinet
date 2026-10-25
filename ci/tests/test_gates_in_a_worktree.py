"""The lint gates check the same files in a checkout held under a `.git` path.

A tool that manages worktrees may add one under the repository's own `.git`,
at `.git/<tool>/worktrees/<id>/`, so every file of that checkout has a `.git`
segment in its path, and an ignore pattern such as `**/.git/**` that a tool
matches against the whole path leaves every one of them out. The tests here
copy this workspace's files into a throwaway repository, add a worktree of it
under its `.git`, and run the `cspell` and `markdownlint` gates in both: each
has to check the same files in the worktree as in the repository's own
checkout. A gate whose configuration leaves it no file has to fail saying so,
rather than with cspell's usage text or with markdownlint-cli2's silent pass.
The web app's suite, whose Vite `server.fs.deny` has to let such a checkout
through too, is run there as well.

The tools are the npm workspace's, which is why each checkout is given this
workspace's installed `node_modules` rather than one of its own, and why the
tests are skipped where the workspace is not installed: the gates they stand
for fail there too, asking for `npm ci`. On the pipeline that is the track that
runs `ci-tests` without the npm install.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

from the_test_cabinet_ci import proc

ROOT = Path(__file__).resolve().parents[2]
GATES_DIR = ROOT / "ci" / "gates"

# Where a tool managing worktrees adds one, under the repository's `.git`.
WORKTREE = Path(".git/tool/worktrees/x95fe4vri6bee9cpiwqyls8f")

# What each gate's summary states it checked, as the gate reads it.
COUNTS = {
    "cspell": r"Files checked: (\d+)",
    "markdownlint": r"Linting: (\d+) file",
}

# The directories whose installed packages the checkouts share with this one.
# The superrepo carries no web app of its own (the console is
# `console.testcabinet.ai`'s, with its own gates), so the root's is the one.
INSTALLED = (".",)

# The web app's Vite configuration, whose `server.fs.deny` the last test
# judges; absent here, since the superrepo carries no web app, so it skips.
VITE_CONFIG = ROOT / "apps" / "web" / "vite.config.ts"

# The web app's smallest test file: what its setup file loads is what Vite's
# default deny refused first, so any file of the suite reproduces the failure.
VITEST_FILE = "src/backend.test.ts"

IDENTITY = ["-c", "user.name=ci", "-c", "user.email=ci@localhost", "-c", "commit.gpgsign=false"]


def _git(cwd: Path, *args: str) -> None:
    done = proc.git([*IDENTITY, *args], cwd=cwd, quiet=True)
    assert done.returncode == 0, f"git {' '.join(args)} failed in {cwd}"


# What a workspace's tools write into it, which no checkout of it carries.
INSTALLED_DIRS = {".git", "node_modules", "target", "dist", ".venv"}


def _files() -> list[Path]:
    """The files of this workspace a checkout of it carries, relative to its root.

    git decides where there is a repository: what it tracks, and what it would
    track. A workspace no repository holds yet is walked instead, leaving out
    what a tool installed or built; the copy's own `git add` leaves out the
    rest its `.gitignore` names.
    """
    listed = proc.git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=ROOT, quiet=True)
    if listed.returncode == 0:
        named = [ROOT / name for name in listed.stdout.split("\0") if name]
    else:
        named = []
        for directory, subdirectories, files in os.walk(ROOT):
            subdirectories[:] = [name for name in subdirectories if name not in INSTALLED_DIRS]
            named.extend(Path(directory) / name for name in files)
    # A submodule is listed as its directory, and a deleted file not at all on disk.
    return [path.relative_to(ROOT) for path in named if path.is_file() and not path.is_symlink()]


def _install(checkout: Path) -> None:
    """Point each `node_modules` of the checkout at this workspace's."""
    for directory in INSTALLED:
        installed = ROOT / directory / "node_modules"
        if installed.is_dir():
            (checkout / directory / "node_modules").symlink_to(installed, target_is_directory=True)


@pytest.fixture(scope="module")
def checkouts(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    """A copy of this workspace, committed, and a worktree of it under its `.git`.

    The temporary directory sits under no `.git` of its own, so the one `.git`
    segment in the worktree's path is the one the worktree's layout puts there.
    """
    if not (ROOT / "node_modules").is_dir():
        pytest.skip("the npm workspace is not installed (npm ci), so the tools these gates run are absent")
    main = (tmp_path_factory.mktemp("checkouts") / "main").resolve()
    for relative in _files():
        target = main / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, target)
    _git(main.parent, "init", "--quiet", "--initial-branch", "master", str(main))
    _git(main, "add", "--all")
    _git(main, "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--no-verify", "-m", "copy")
    _git(main, "worktree", "add", "--quiet", "--detach", str(WORKTREE))
    worktree = main / WORKTREE
    _install(main)
    _install(worktree)
    return main, worktree


def _gate(checkout: Path, gate_id: str) -> subprocess.CompletedProcess[str]:
    """Run this workspace's gate in `checkout`, as the runner does, and collect its output."""
    environment = {name: value for name, value in os.environ.items() if name != "CI_GATE_ARTIFACTS"}
    return subprocess.run(
        [sys.executable, str(GATES_DIR / f"{gate_id}.py")],
        cwd=checkout,
        env=proc.git_environment(environment),
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
    )


def _checked(checkout: Path, gate_id: str) -> int:
    ran = _gate(checkout, gate_id)
    output = ran.stdout + ran.stderr
    assert ran.returncode == 0, output
    checked = proc.files_checked(output, COUNTS[gate_id])
    assert checked, output
    return checked


@pytest.mark.parametrize("gate_id", sorted(COUNTS))
def test_a_lint_gate_checks_the_same_files_in_a_worktree_under_git(checkouts: tuple[Path, Path], gate_id: str) -> None:
    main, worktree = checkouts
    assert _checked(worktree, gate_id) == _checked(main, gate_id)


def _cspell_files(checkout: Path) -> list[str]:
    """The files cspell reads in `checkout`, from the progress it reports for each."""
    ran = subprocess.run(
        [str(checkout / "node_modules" / ".bin" / "cspell"), "lint", "--no-cache", "--no-summary"],
        cwd=checkout,
        env=proc.git_environment(),
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
    )
    files = re.findall(r"^\s*\d+/\d+ (\S+)", ran.stdout + ran.stderr, re.MULTILINE)
    assert files, ran.stdout + ran.stderr
    return sorted(files)


def test_cspell_reads_the_same_files_in_a_worktree_under_git(checkouts: tuple[Path, Path]) -> None:
    main, worktree = checkouts
    assert _cspell_files(worktree) == _cspell_files(main)


@pytest.fixture
def scratch(checkouts: tuple[Path, Path], tmp_path: Path) -> Iterator[Path]:
    """A worktree under the copy's `.git` whose configuration a test may change."""
    main, _ = checkouts
    worktree = main / ".git" / "tool" / "worktrees" / tmp_path.name
    _git(main, "worktree", "add", "--quiet", "--detach", str(worktree))
    _install(worktree)
    yield worktree
    _git(main, "worktree", "remove", "--force", str(worktree))


def test_cspell_ignoring_every_git_path_fails_saying_why(scratch: Path) -> None:
    """The ignore every render carried before `/.git/**`: in a worktree under
    `.git` it leaves cspell no file, and the gate says so, without the usage
    text cspell prints in its place."""
    config = json.loads((scratch / "cspell.json").read_text(encoding="utf-8"))
    config["ignorePaths"] = ["**/.git/**", *config["ignorePaths"]]
    (scratch / "cspell.json").write_text(json.dumps(config), encoding="utf-8")

    ran = _gate(scratch, "cspell")

    assert ran.returncode != 0, ran.stdout + ran.stderr
    assert "cspell reported no count of the files it checked" in ran.stderr
    assert "`**/.git/**`" in ran.stderr
    assert "Usage:" not in ran.stdout + ran.stderr


def test_markdownlint_over_no_file_fails_saying_why(scratch: Path) -> None:
    """markdownlint-cli2 passes a run that lints nothing; the gate does not."""
    config = scratch / ".markdownlint-cli2.yaml"
    config.write_text(
        config.read_text(encoding="utf-8").replace("ignores:\n", 'ignores:\n  - "**"\n'), encoding="utf-8"
    )

    ran = _gate(scratch, "markdownlint")

    assert ran.returncode != 0, ran.stdout + ran.stderr
    assert "Linting: 0 file(s)" in ran.stdout
    assert "markdownlint-cli2 checked no file." in ran.stderr


def test_vitest_serves_the_checkout_under_a_git_path(checkouts: tuple[Path, Path]) -> None:
    """`web-test` and `web-browser-test` run vitest over `apps/web/vite.config.ts`,
    whose `server.fs.deny` has to let the checkout's own files through
    wherever the checkout stands. Under Vite's default, the suite's setup file
    is refused and every file fails with `Cannot find module
    '/src/test/setup.ts'`."""
    _, worktree = checkouts
    if not VITE_CONFIG.is_file():
        pytest.skip("the superrepo carries no web app; the console's suite runs in console.testcabinet.ai")
    if not (ROOT / "apps" / "web" / "node_modules").is_dir():
        pytest.skip("the web app's packages are not installed (npm ci)")
    environment = {
        name: value for name, value in os.environ.items() if name not in {"CI_GATE_ARTIFACTS", "BROWSER_INSTANCE"}
    }
    ran = subprocess.run(
        ["npm", "run", "--silent", "--workspace", "apps/web", "test", "--", VITEST_FILE],
        cwd=worktree,
        env=proc.git_environment(environment),
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
    )

    output = ran.stdout + ran.stderr
    assert "Cannot find module" not in output, output
    assert ran.returncode == 0, output
