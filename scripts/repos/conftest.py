"""What the tests of the repository scripts share: a small superrepo to render from.

Copier clones the superrepo it renders, and this superrepo is the whole of The
Test Cabinet while the monorepo still sits at its root, so a render from it
takes as long as a checkout does. The tests render from a superrepo of their
own instead, holding what a render reads and nothing else: the template
configuration, the kit, these scripts and the CI image pins. It is committed
once per session, and a test that changes the kit commits to a copy.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

import render

GIT_IDENTITY = ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false"]
# What a render reads from the superrepo, relative to its root.
SOURCES = ("copier.yml", "templates/repository", "scripts/repos", "ci/images")
CACHES = shutil.ignore_patterns(
    "__pycache__", ".pytest_cache", ".ruff_cache", ".venv", "node_modules", "target", "*.pyc"
)


def git(args: list[str], cwd: Path) -> str:
    """Run git in `cwd` with no inherited variable pointing it at another repository."""
    env = {key: value for key, value in os.environ.items() if key not in render.GIT_LOCATING}
    done = subprocess.run(["git", *GIT_IDENTITY, *args], cwd=cwd, env=env, capture_output=True, text=True, check=True)
    return done.stdout.strip()


def commit(root: Path, message: str) -> None:
    git(["add", "-A"], root)
    git(["commit", "--quiet", "--no-verify", "--allow-empty", "-m", message], root)


def make_superrepo(directory: Path) -> Path:
    """A committed superrepo holding what a render reads, copied from this checkout."""
    directory.mkdir(parents=True)
    for relative in SOURCES:
        source = render.SUPERREPO / relative
        if source.is_dir():
            shutil.copytree(source, directory / relative, ignore=CACHES)
        else:
            (directory / relative).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, directory / relative)
    git(["init", "--quiet", "--initial-branch=master"], directory)
    commit(directory, "the superrepo")
    return directory


@pytest.fixture(autouse=True)
def _no_inherited_repository(monkeypatch: pytest.MonkeyPatch) -> None:
    """A test run from a commit hook inherits variables naming the repository being committed to."""
    for key in render.GIT_LOCATING:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(scope="session")
def mini_superrepo(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """The session's superrepo to render from, which no test changes."""
    return make_superrepo(tmp_path_factory.mktemp("mini") / "super")


@pytest.fixture
def own_superrepo(tmp_path: Path) -> Path:
    """A superrepo of the test's own, which it may change and commit to."""
    return make_superrepo(tmp_path / "super")


@pytest.fixture(scope="session")
def rendered(mini_superrepo: Path, tmp_path_factory: pytest.TempPathFactory) -> Callable[[str], Path]:
    """A repository rendered from the session's superrepo, once per name, committed as bootstrap would."""
    done: dict[str, Path] = {}
    base = tmp_path_factory.mktemp("rendered")

    def render_one(name: str) -> Path:
        if name not in done:
            root = base / name
            render.render(root, name, render.repositories()[name], f"The {name} repository", source=mini_superrepo)
            git(["init", "--quiet", "--initial-branch=master"], root)
            commit(root, "chore: scaffold")
            done[name] = root
        return done[name]

    return render_one


@pytest.fixture
def chdir_back() -> Iterator[None]:
    """Restore the working directory a test's render moves through."""
    here = Path.cwd()
    yield
    os.chdir(here)
