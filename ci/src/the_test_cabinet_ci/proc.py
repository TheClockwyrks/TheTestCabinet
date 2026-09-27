"""What every gate script needs: the repository root, and a way to run a tool.

A gate is a plain script that exits 0 when it passes. These helpers keep each
one down to the commands it runs and the message it prints when they fail.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import NoReturn

# The variable the runner names a gate's artifact directory in. A gate that runs
# tests writes its machine-readable results there, and writes none without it.
ARTIFACTS_ENV = "CI_GATE_ARTIFACTS"

# The variables git uses to say which repository, index or object store a
# command acts on, whatever its working directory is. Git exports them to every
# hook, and a hook's children inherit them, so a gate started from a commit hook
# sees them set to the repository being committed to. They beat `cwd`: a git
# command run with `cwd=` somewhere else acts on that repository instead, which
# is how a test fixture's `git commit` can land on the branch it is gating.
#
# Every git call in this project means "the repository the working directory is
# in", so `git()` below removes them all and leaves the working directory
# authoritative. GIT_CEILING_DIRECTORIES is in the list for the same reason: it
# changes which repository discovery finds. The identity variables
# (GIT_AUTHOR_NAME and the rest) point at no repository and are left alone.
GIT_LOCATION_VARIABLES = (
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
    "GIT_PREFIX",
    "GIT_CEILING_DIRECTORIES",
    "GIT_DISCOVERY_ACROSS_FILESYSTEM",
)


class NotInRepository(RuntimeError):
    """The working directory is outside any workspace this project belongs to."""


# The file that says a directory is the top of this workspace. It is what finds
# the root of a workspace git knows nothing about: a workspace rendered from the
# template is a plain directory until `git init` makes it one, and `make gate`
# has to work there, which is how the template's own gate looks at what it
# renders.
WORKSPACE_MARKER = Path("ci") / "pyproject.toml"


def git_environment(env: Mapping[str, str] | None = None) -> dict[str, str]:
    """This process's environment minus the variables that redirect git.

    `env` is laid over the result, the way `run`'s is.
    """
    environment = {name: value for name, value in os.environ.items() if name not in GIT_LOCATION_VARIABLES}
    environment.update(env or {})
    return environment


def git(
    argv: Sequence[str | os.PathLike[str]],
    *,
    cwd: str | os.PathLike[str] | None = None,
    text: bool = True,
    quiet: bool = False,
) -> subprocess.CompletedProcess:
    """Run git on the checkout `cwd` is in, and return what it did.

    **This is the only way this project runs git**, production code and tests
    alike, so that no call site can inherit a hook's `GIT_DIR` and act on the
    wrong repository (see `GIT_LOCATION_VARIABLES`). A test greps the sources
    for a `["git", ...]` command built anywhere else.

    `argv` is git's arguments without the `git`. stdout is always captured;
    `quiet` discards stderr rather than letting it reach the gate's log. A git
    that is not installed raises FileNotFoundError, which the caller judges.
    """
    # As in `run`: this process's own buffered output has to be out before a
    # child writes to the same descriptor.
    sys.stdout.flush()
    sys.stderr.flush()
    return subprocess.run(
        ["git", *(os.fspath(part) for part in argv)],
        cwd=cwd,
        env=git_environment(),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL if quiet else None,
        text=text,
        check=False,
    )


def repo_root(start: str | os.PathLike[str] | None = None) -> Path:
    """The top of the workspace `start` (the working directory) is inside.

    git is asked first, and not the location of this file: the project is
    installed from one checkout, and a gate run inside a linked worktree has to
    act on that worktree's files.

    A directory git knows nothing about is then searched upwards for
    `WORKSPACE_MARKER`, which is how the gates run in a workspace that has no
    repository yet. A git that is not installed is the same case: the answer is
    the marker's directory or none.
    """
    where = Path(start) if start is not None else Path.cwd()
    try:
        found = git(["rev-parse", "--show-toplevel"], cwd=start, quiet=True)
    except FileNotFoundError:
        found = None
    if found is not None and found.returncode == 0 and found.stdout.strip():
        return Path(found.stdout.strip())
    resolved = where.resolve()
    for directory in (resolved, *resolved.parents):
        if (directory / WORKSPACE_MARKER).is_file():
            return directory
    raise NotInRepository(f"{where} is not inside a git checkout, and no {WORKSPACE_MARKER} stands above it")


def enter_repo_root() -> Path:
    """Make the workspace root the working directory, and return it.

    Every gate starts here, so its tools resolve the cargo and npm workspaces
    regardless of the directory the caller ran it from.
    """
    try:
        root = repo_root()
    except NotInRepository as error:
        fail(str(error))
    os.chdir(root)
    return root


def say(*lines: str, err: bool = False) -> None:
    """Print lines, flushed, so they stay in order with a child's output."""
    stream = sys.stderr if err else sys.stdout
    for line in lines:
        print(line, file=stream)
    stream.flush()


def fail(*lines: str, code: int = 1) -> NoReturn:
    """Print the lines on stderr and fail the gate."""
    say(*lines, err=True)
    sys.exit(code)


def skip(*lines: str) -> NoReturn:
    """Print why the gate has nothing to check, and pass."""
    say(*lines)
    sys.exit(0)


def run(
    argv: Sequence[str | os.PathLike[str]],
    *,
    cwd: str | os.PathLike[str] | None = None,
    env: Mapping[str, str] | None = None,
    unset: Sequence[str] = (),
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Run a tool and return what it did. A failure is the caller's to judge.

    The tool inherits this process's streams, so under the runner its output
    lands in the gate's log. `capture` collects stdout as text instead. `env`
    is laid over the inherited environment, and `unset` names the inherited
    variables the tool must not see.

    A tool that is absent is reported the way a shell does, with status 127, so
    a gate handles it like any other failure.
    """
    # Python buffers what this process printed when its output is a file, and
    # the child writes straight to the descriptor: without this the log shows
    # the child's output ahead of the lines that introduced it.
    sys.stdout.flush()
    sys.stderr.flush()
    command = [os.fspath(part) for part in argv]
    environment = {name: value for name, value in os.environ.items() if name not in unset}
    environment.update(env or {})
    try:
        return subprocess.run(
            command,
            cwd=cwd,
            env=environment,
            stdout=subprocess.PIPE if capture else None,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        say(f"{command[0]}: command not found", err=True)
        return subprocess.CompletedProcess(command, 127, "" if capture else None)


def succeeded(
    argv: Sequence[str | os.PathLike[str]],
    *,
    cwd: str | os.PathLike[str] | None = None,
    env: Mapping[str, str] | None = None,
    unset: Sequence[str] = (),
) -> bool:
    """Run a tool; true when it exited 0."""
    return run(argv, cwd=cwd, env=env, unset=unset).returncode == 0


def uv_project(
    project: Path,
    argv: Sequence[str | os.PathLike[str]],
    *,
    cwd: str | os.PathLike[str] | None = None,
) -> bool:
    """Run a command in another uv project's environment; true when it exited 0.

    A gate runs inside this project's environment, which uv names in
    VIRTUAL_ENV. Left in place, the inner uv reports on every run that it does
    not match the project it was pointed at.
    """
    if not (project / "pyproject.toml").is_file():
        fail(f"{project} is not a uv project: it has no pyproject.toml.")
    require_tool("uv", "The devcontainer installs it (.devcontainer/tools/uv.sh).")
    return succeeded(["uv", "run", "--quiet", "--project", project, *argv], cwd=cwd, unset=("VIRTUAL_ENV",))


def require_tool(name: str, *hint: str) -> str:
    """The path of a tool on PATH, or fail the gate with how to get it."""
    found = shutil.which(name)
    if found is None:
        fail(f"{name} is not installed.", *hint)
    return found


def artifacts_dir() -> Path | None:
    """Where this gate's machine-readable results go, or None for none.

    The directory is created. Without the variable a gate writes no report and
    collects no coverage: a commit hook pays for neither.
    """
    named = os.environ.get(ARTIFACTS_ENV)
    if not named:
        return None
    directory = Path(named).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    return directory
