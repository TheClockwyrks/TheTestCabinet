"""The push gate's verdict on submodule pins, against throwaway repositories.

Every remote is a local repository: an `inner` repository, an `outer` one
holding `inner` as a submodule, and a superrepository holding `outer`, each
cloned into a checkout the way a developer's is. The gate is run the way
pre-commit runs it as the pre-push hook, with the push's range in its
environment, so no test reaches a network and none pushes.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest

from the_test_cabinet_ci import proc

GATE = Path(__file__).resolve().parents[1] / "gates" / "submodule-remotes.py"
# What every commit a fixture makes is made with, whatever the machine's own
# configuration says. A submodule cloned from a local path needs the file
# protocol, which git refuses to a submodule by default.
IDENTITY = [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "tag.gpgsign=false",
    "-c",
    "protocol.file.allow=always",
]
# The variables pre-commit hands a pre-push hook, kept out of every run but
# the one a test makes, so the shell that runs these tests decides nothing.
PUSH = (
    "PRE_COMMIT_FROM_REF",
    "PRE_COMMIT_TO_REF",
    "PRE_COMMIT_LOCAL_BRANCH",
    "PRE_COMMIT_REMOTE_BRANCH",
    "PRE_COMMIT_REMOTE_NAME",
    "PRE_COMMIT_REMOTE_URL",
)


def _git(cwd: Path, *args: str) -> str:
    done = proc.git([*IDENTITY, *args], cwd=cwd)
    assert done.returncode == 0, f"git {' '.join(args)} failed in {cwd}"
    return done.stdout.strip()


def _commit(repo: Path, message: str, name: str = "change") -> str:
    """Commit a change to the file `name`, and return the commit."""
    (repo / name).write_text(message, encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", message)
    return _git(repo, "rev-parse", "HEAD")


def _bare(where: Path, name: str) -> Path:
    """An empty remote."""
    remote = where / f"{name}.git"
    _git(where, "init", "-q", "--bare", "-b", "master", str(remote))
    return remote


def _clone(remote: Path, into: Path) -> Path:
    _git(into.parent, "clone", "-q", str(remote), str(into))
    return into


@dataclass
class Repos:
    """The remotes, and the developer's checkout of the superrepository."""

    remotes: Path
    root: Path
    inner: Path
    outer: Path

    def remote(self, name: str) -> Path:
        return self.remotes / f"{name}.git"

    def published(self) -> str:
        """The superrepository's master as its remote holds it."""
        return _git(self.root, "rev-parse", "origin/master")


@pytest.fixture
def repos(tmp_path: Path) -> Repos:
    """A superrepository whose master, on its remote, pins `outer`, which pins `inner`, all published."""
    remotes = tmp_path / "remotes"
    remotes.mkdir()
    for name in ("inner", "outer", "super"):
        _bare(remotes, name)

    seed = _clone(remotes / "inner.git", tmp_path / "seed-inner")
    _commit(seed, "inner's first commit")
    _git(seed, "push", "-q", "origin", "HEAD:master")

    seed = _clone(remotes / "outer.git", tmp_path / "seed-outer")
    _git(seed, "submodule", "add", "-q", str(remotes / "inner.git"), "inner")
    _commit(seed, "outer pins inner")
    _git(seed, "push", "-q", "origin", "HEAD:master")

    root = _clone(remotes / "super.git", tmp_path / "super")
    _git(root, "submodule", "add", "-q", str(remotes / "outer.git"), "outer")
    _git(root, "submodule", "update", "-q", "--init", "--recursive")
    _commit(root, "super pins outer")
    _git(root, "push", "-q", "origin", "HEAD:master")
    return Repos(remotes, root.resolve(), root.resolve() / "outer" / "inner", root.resolve() / "outer")


def _gate(root: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    environment = {key: value for key, value in proc.git_environment().items() if key not in PUSH}
    environment.update(env or {})
    return subprocess.run(
        [sys.executable, str(GATE)],
        cwd=root,
        env=environment,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
    )


def _push(
    repos: Repos, *, to_ref: str = "HEAD", from_ref: str | None = None, branch: str = "master"
) -> subprocess.CompletedProcess[str]:
    """Run the gate as pre-commit runs it for a push of `to_ref` to the remote's `branch`, over its master."""
    env = {
        "PRE_COMMIT_TO_REF": _git(repos.root, "rev-parse", to_ref),
        "PRE_COMMIT_FROM_REF": from_ref or repos.published(),
        "PRE_COMMIT_LOCAL_BRANCH": f"refs/heads/{branch}",
        "PRE_COMMIT_REMOTE_BRANCH": f"refs/heads/{branch}",
        "PRE_COMMIT_REMOTE_NAME": "origin",
        "PRE_COMMIT_REMOTE_URL": str(repos.remote("super")),
    }
    return _gate(repos.root, env)


def _move(holder: Path, path: str) -> str:
    """Stage the submodule at `path` of `holder` at the commit its checkout is at, and commit that."""
    _git(holder, "add", path)
    return _commit(holder, f"move {path}")


def test_a_repository_without_submodules_passes_at_once(tmp_path: Path) -> None:
    plain = tmp_path / "plain"
    _git(tmp_path, "init", "-q", "-b", "master", str(plain))
    _commit(plain, "no submodule")
    done = _gate(plain, {"PRE_COMMIT_TO_REF": "HEAD", "PRE_COMMIT_REMOTE_NAME": "origin"})
    assert done.returncode == 0, done.stderr
    assert "no .gitmodules" in done.stdout


def test_nothing_is_checked_outside_a_push(repos: Repos) -> None:
    _commit(repos.outer, "outer's commit nobody pushed")
    _move(repos.root, "outer")
    done = _gate(repos.root)
    assert done.returncode == 0, done.stderr
    assert "nothing is being pushed" in done.stdout


def test_a_pin_a_remote_branch_stands_at_passes(repos: Repos) -> None:
    _commit(repos.outer, "outer's next commit")
    _git(repos.outer, "push", "-q", "origin", "HEAD:refs/heads/feature")
    _move(repos.root, "outer")
    done = _push(repos)
    assert done.returncode == 0, done.stderr
    assert "1 pin(s)" in done.stdout


def test_a_pin_behind_a_remote_branch_passes(repos: Repos) -> None:
    pinned = _commit(repos.outer, "outer's next commit")
    _commit(repos.outer, "a commit after it")
    _git(repos.outer, "push", "-q", "origin", "HEAD:refs/heads/feature")
    _git(repos.outer, "checkout", "-q", pinned)
    _move(repos.root, "outer")
    # The checkout knows nothing of the branch, so the gate fetches it.
    _git(repos.outer, "update-ref", "-d", "refs/remotes/origin/feature")
    done = _push(repos)
    assert done.returncode == 0, done.stderr


def test_a_pin_only_a_tag_holds_fails(repos: Repos) -> None:
    pinned = _commit(repos.outer, "outer's tagged commit")
    _git(repos.outer, "tag", "-a", "-m", "a release", "v1.0.0")
    _git(repos.outer, "push", "-q", "origin", "refs/tags/v1.0.0")
    _move(repos.root, "outer")
    done = _push(repos)
    assert done.returncode == 1
    assert f"outer {pinned}" in done.stderr
    assert "the branches considered: master)" in done.stderr


def test_a_pin_behind_a_tag_and_a_branch_passes(repos: Repos) -> None:
    _commit(repos.outer, "outer's tagged commit")
    _git(repos.outer, "tag", "-a", "-m", "a release", "v1.0.0")
    _git(repos.outer, "push", "-q", "origin", "refs/tags/v1.0.0", "HEAD:refs/heads/nightly")
    _move(repos.root, "outer")
    done = _push(repos)
    assert done.returncode == 0, done.stderr


@pytest.mark.parametrize("worktree", ["issue/one", "task/one", "filing/one"])
def test_a_pin_only_a_worktree_branch_holds_fails_a_push_to_another_branch(repos: Repos, worktree: str) -> None:
    pinned = _commit(repos.outer, "outer's commit on a worktree's branch")
    _git(repos.outer, "push", "-q", "origin", f"HEAD:refs/heads/{worktree}")
    _git(repos.outer, "push", "-q", "origin", "origin/master:refs/heads/nightly")
    _move(repos.root, "outer")
    done = _push(repos)
    assert done.returncode == 1
    assert f"outer {pinned}" in done.stderr
    # The branches looked at are named, and the worktree's is not among them.
    assert "the branches considered: master, nightly)" in done.stderr
    assert worktree not in done.stderr
    done = _push(repos, branch="nightly")
    assert done.returncode == 1


@pytest.mark.parametrize("worktree", ["issue/one", "task/one", "filing/one"])
def test_a_pin_a_worktree_branch_holds_passes_a_push_to_the_branch_of_its_name(repos: Repos, worktree: str) -> None:
    _commit(repos.outer, "outer's commit on a worktree's branch")
    _git(repos.outer, "push", "-q", "origin", f"HEAD:refs/heads/{worktree}")
    _move(repos.root, "outer")
    done = _push(repos, branch=worktree)
    assert done.returncode == 0, done.stderr
    assert f"to {worktree}" in done.stdout


def test_a_pin_another_worktree_branch_holds_fails_a_push_to_a_worktree_branch(repos: Repos) -> None:
    pinned = _commit(repos.outer, "outer's commit on another issue's branch")
    _git(repos.outer, "push", "-q", "origin", "HEAD:refs/heads/issue/other")
    _move(repos.root, "outer")
    done = _push(repos, branch="issue/one")
    assert done.returncode == 1
    assert f"outer {pinned}" in done.stderr
    assert "issue/other" not in done.stderr


def test_a_push_to_no_branch_takes_a_pin_from_no_worktree_branch(repos: Repos) -> None:
    pinned = _commit(repos.outer, "outer's commit on an issue's branch")
    _git(repos.outer, "push", "-q", "origin", "HEAD:refs/heads/issue/one")
    _move(repos.root, "outer")
    done = _push(repos, branch="issue/one")
    assert done.returncode == 0, done.stderr
    env = {
        "PRE_COMMIT_TO_REF": _git(repos.root, "rev-parse", "HEAD"),
        "PRE_COMMIT_FROM_REF": repos.published(),
        "PRE_COMMIT_REMOTE_NAME": "origin",
    }
    done = _gate(repos.root, env)
    assert done.returncode == 1
    assert f"outer {pinned}" in done.stderr


def test_a_pin_the_remote_lacks_fails_naming_it(repos: Repos) -> None:
    pinned = _commit(repos.outer, "outer's commit nobody pushed")
    pinning = _move(repos.root, "outer")
    done = _push(repos)
    assert done.returncode == 1
    remote = repos.remote("outer")
    assert (
        f"outer {pinned}, pinned by {pinning[:12]}, is on no branch of {remote} the push can take it from"
        in done.stderr
    )
    assert "(the branches considered: master)" in done.stderr


def test_a_pin_the_remote_lacks_is_named_once_for_every_commit_pinning_it(repos: Repos) -> None:
    pinned = _commit(repos.outer, "outer's commit nobody pushed")
    first = _move(repos.root, "outer")
    second = _commit(repos.root, "another commit, the pin unmoved")
    done = _push(repos)
    assert done.returncode == 1
    assert done.stderr.count(pinned) == 1
    assert first[:12] in done.stderr
    # A commit that left the pin where it was moved no pin.
    assert second[:12] not in done.stderr


def test_a_pin_already_published_is_not_checked_again(repos: Repos) -> None:
    _commit(repos.outer, "outer's commit nobody pushed")
    _move(repos.root, "outer")
    # The remote has taken the superrepository's commit, by whatever means,
    # so this push publishes only what follows it.
    _git(repos.root, "push", "-q", "--no-verify", "origin", "HEAD:master")
    _git(repos.root, "fetch", "-q", "origin")
    _commit(repos.root, "a commit moving nothing")
    done = _push(repos)
    assert done.returncode == 0, done.stderr


def test_a_nested_pin_the_remote_lacks_fails_naming_its_path(repos: Repos) -> None:
    inner = _commit(repos.inner, "inner's commit nobody pushed")
    _move(repos.outer, "inner")
    # outer itself is pushed: only the pin it carries is missing.
    _git(repos.outer, "push", "-q", "origin", "HEAD:refs/heads/feature")
    _move(repos.root, "outer")
    done = _push(repos)
    assert done.returncode == 1
    assert f"outer/inner {inner}" in done.stderr
    assert str(repos.remote("inner")) in done.stderr


def test_a_nested_pin_on_its_remote_passes(repos: Repos) -> None:
    _commit(repos.inner, "inner's next commit")
    _git(repos.inner, "push", "-q", "origin", "HEAD:refs/heads/feature")
    _move(repos.outer, "inner")
    _git(repos.outer, "push", "-q", "origin", "HEAD:refs/heads/feature")
    _move(repos.root, "outer")
    done = _push(repos)
    assert done.returncode == 0, done.stderr
    assert "2 pin(s)" in done.stdout


def test_a_merge_checks_only_the_pin_it_made_itself(repos: Repos) -> None:
    base = repos.published()
    _git(repos.root, "checkout", "-q", "-b", "side")
    _commit(repos.root, "a side commit moving nothing", "side")
    _git(repos.root, "checkout", "-q", "master")
    _commit(repos.outer, "outer's commit nobody pushed")
    _move(repos.root, "outer")
    _git(repos.root, "merge", "-q", "--no-edit", "side")
    done = _push(repos, from_ref=base)
    assert done.returncode == 1
    # The merge took the pin from its first parent, which is the commit named.
    assert done.stderr.count("pinned by") == 1


def test_a_new_history_is_checked_from_the_ref_pushed(repos: Repos, tmp_path: Path) -> None:
    pinned = _commit(repos.outer, "outer's commit nobody pushed")
    _move(repos.root, "outer")
    # A history holding a root the remote lacks: pre-commit names the ref and no range.
    env = {
        "PRE_COMMIT_LOCAL_BRANCH": "refs/heads/master",
        "PRE_COMMIT_REMOTE_BRANCH": "refs/heads/master",
        "PRE_COMMIT_REMOTE_NAME": str(_bare(tmp_path, "elsewhere")),
        "PRE_COMMIT_REMOTE_URL": str(tmp_path / "elsewhere.git"),
    }
    done = _gate(repos.root, env)
    assert done.returncode == 1
    assert f"outer {pinned}" in done.stderr


def _modules_dir(repos: Repos, name: str) -> Path:
    return Path(_git(repos.root, "rev-parse", "--path-format=absolute", "--git-path", f"modules/{name}"))


def test_a_submodule_deinitialized_is_fetched_into_the_repository_git_keeps(repos: Repos) -> None:
    pinned = _commit(repos.outer, "outer's next commit")
    _commit(repos.outer, "a commit after it")
    _git(repos.outer, "push", "-q", "origin", "HEAD:refs/heads/feature")
    _git(repos.outer, "checkout", "-q", pinned)
    _move(repos.root, "outer")
    _git(repos.root, "submodule", "deinit", "-q", "--force", "outer")
    assert _modules_dir(repos, "outer").is_dir()
    done = _push(repos)
    assert done.returncode == 0, done.stderr


def test_a_submodule_with_no_repository_here_passes_only_at_a_tip(repos: Repos) -> None:
    pinned = _commit(repos.outer, "outer's commit nobody pushed")
    _move(repos.root, "outer")
    _git(repos.root, "submodule", "deinit", "-q", "--force", "outer")
    shutil.rmtree(_modules_dir(repos, "outer"))
    done = _push(repos)
    assert done.returncode == 1
    assert f"outer {pinned}" in done.stderr
    assert "not checked out" in done.stderr


def test_a_submodule_configured_to_be_ignored_is_still_checked(repos: Repos) -> None:
    pinned = _commit(repos.outer, "outer's commit nobody pushed")
    _git(repos.root, "config", "-f", ".gitmodules", "submodule.outer.ignore", "all")
    _git(repos.root, "config", "diff.ignoreSubmodules", "all")
    _git(repos.root, "add", ".gitmodules")
    _git(repos.root, "add", "outer")
    _commit(repos.root, "move outer, ignored")
    done = _push(repos)
    assert done.returncode == 1
    assert f"outer {pinned}" in done.stderr


def test_the_address_every_checkout_fetches_is_the_one_held_to(repos: Repos, tmp_path: Path) -> None:
    pinned = _commit(repos.outer, "outer's commit pushed to a fork alone")
    fork = _bare(tmp_path, "fork")
    _git(repos.outer, "remote", "set-url", "origin", str(fork))
    _git(repos.outer, "push", "-q", "origin", "HEAD:refs/heads/feature")
    _move(repos.root, "outer")
    done = _push(repos)
    assert done.returncode == 1
    assert f"outer {pinned}" in done.stderr
    assert str(repos.remote("outer")) in done.stderr


def test_an_address_read_as_an_option_is_refused_and_never_run(repos: Repos, tmp_path: Path) -> None:
    witness = tmp_path / "ran"
    _commit(repos.outer, "outer's next commit")
    _git(repos.root, "config", "-f", ".gitmodules", "submodule.outer.url", f"--upload-pack=touch {witness};false")
    _git(repos.root, "config", "--unset", "submodule.outer.url")
    _move(repos.root, "outer")
    done = _push(repos)
    assert done.returncode == 1
    assert "opens with '-'" in done.stderr
    assert not witness.exists()


def test_a_path_that_is_no_utf8_is_read(repos: Repos) -> None:
    (repos.root / os.fsdecode(b"caf\xe9.txt")).write_text("a name in Latin-1", encoding="utf-8")
    _commit(repos.root, "a file whose name is no UTF-8")
    done = _push(repos)
    assert done.returncode == 0, done.stderr


def test_a_push_by_address_judges_no_published_history(repos: Repos) -> None:
    # The published master pins outer at a commit whose branch is gone, which
    # a push to an address must not judge again.
    _commit(repos.outer, "outer's commit on a branch since deleted")
    _git(repos.outer, "push", "-q", "origin", "HEAD:refs/heads/doomed")
    _move(repos.root, "outer")
    _git(repos.root, "push", "-q", "--no-verify", "origin", "HEAD:master")
    _git(repos.root, "fetch", "-q", "origin")
    _git(repos.outer, "push", "-q", "origin", ":refs/heads/doomed")
    _commit(repos.root, "a commit moving nothing", "other")
    url = str(repos.remote("super"))
    env = {
        "PRE_COMMIT_LOCAL_BRANCH": "refs/heads/master",
        "PRE_COMMIT_REMOTE_BRANCH": "refs/heads/new",
        "PRE_COMMIT_REMOTE_NAME": url,
        "PRE_COMMIT_REMOTE_URL": url,
    }
    done = _gate(repos.root, env)
    assert done.returncode == 0, done.stderr


@pytest.mark.skipif(os.name != "posix", reason="the fixture's paths are POSIX paths")
def test_a_relative_address_is_read_against_the_superrepository(repos: Repos) -> None:
    _commit(repos.outer, "outer's next commit")
    _git(repos.outer, "push", "-q", "origin", "HEAD:refs/heads/feature")
    _git(repos.root, "config", "-f", ".gitmodules", "submodule.outer.url", "../outer.git")
    _git(repos.root, "add", ".gitmodules")
    _move(repos.root, "outer")
    done = _push(repos)
    assert done.returncode == 0, done.stderr
    pinned = _commit(repos.outer, "outer's commit nobody pushed")
    _move(repos.root, "outer")
    done = _push(repos)
    assert done.returncode == 1
    assert f"outer {pinned}" in done.stderr
