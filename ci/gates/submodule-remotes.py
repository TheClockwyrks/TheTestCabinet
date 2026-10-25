"""Refuse a push whose commits pin a submodule commit no branch of the submodule's remote the push can target holds.

A commit that pins a submodule at a commit its remote lacks is a commit no
other checkout can check out, the pipeline's among them: `git submodule
update` fetches the submodule's remote and finds nothing at the pin. Nothing
before the push sees it, because the commit is whole and every gate passes in
the checkout that made it, where the submodule's commit sits in its own
checkout. So this gate runs as the pre-push hook, which
`.pre-commit-config.yaml` installs for the push stage alone.

For each commit the push would publish, it takes every submodule path whose
pin that commit moved, the pins a merge took from neither parent among them,
and checks that a branch of the submodule's remote the push can target
contains the pinned commit. For a push to the branch `<b>`, those are the
remote's branch of the same name `<b>`, and every branch of it whose name is
not a managed worktree branch's, `issue/*`, `task/*` or `filing/*`. A tag
alone admits no pin, nor does an `issue/*`, `task/*` or `filing/*` branch
other than `<b>`: a landing of `<b>` needs each pin on the submodule's branch
it targets, which never merges a tag or another worktree's branch, so a pin
those alone hold is one the landing stops on. A push that targets no branch,
a tag's, or one checked by hand, is held to the branches that are no
worktree's alone. A pinned commit that moved a pin of its own is held to the
same rule, down through every level of submodules. Each pin no such branch
holds is named, with the remote, the commits that pin it and the branches
considered, and fails the push.

The commits a push would publish are the ones the pushed commit reaches that
neither the commit the remote's branch stood at nor a remote-tracking branch
reaches. pre-commit hands the hook those two commits in `PRE_COMMIT_FROM_REF`
and `PRE_COMMIT_TO_REF`, the remote in `PRE_COMMIT_REMOTE_NAME` and the ref
it updates there in `PRE_COMMIT_REMOTE_BRANCH`; a push of
a history holding a root commit the remote lacks has no `PRE_COMMIT_FROM_REF`,
and states the pushed ref in `PRE_COMMIT_LOCAL_BRANCH` instead. Without a
commit the remote stood at, or to a remote that is an address rather than a
name, every remote-tracking branch is left out rather than that remote's
alone, so a push by address does not judge again history already published.
pre-commit reads the first ref a push updates and no other, so a push of
several branches at once is checked for the first.

Outside a push nothing is being published, so the gate has nothing to check,
and says so: `make gate` and the pipeline, which runs on commits already
pushed, pass it. `pre-commit run submodule-remotes --hook-stage pre-push
--from-ref <commit> --to-ref HEAD` checks a range by hand.

The remote of a submodule is the address the `.gitmodules` of the commit
pinning it names, which is the one every other checkout fetches, a relative
one read against the address of the repository holding it; a submodule that
file does not name falls back to the address configured for it, then to the
one its checkout was cloned by. An address opening with `-` is refused, as git
refuses it, since it would be read as an option. Its branches are listed with
`git ls-remote`, which answers at once for a pin a branch considered stands
at; otherwise the tips of those branches the submodule's repository lacks are
fetched into it, once per remote, writing no ref and no FETCH_HEAD, and the
pin is looked for among their ancestors. The submodule's repository is its
checkout, or the one git keeps for it under the holder's `modules/` when it is
not checked out; with neither, a pin passes only when a branch considered
stands at it. Both use the developer's own credentials, as every fetch of
theirs does.

A repository whose working tree and pushed commit hold no `.gitmodules`, and
whose push touches none, pins nothing, and the gate passes at once.
"""

from __future__ import annotations

import os
import posixpath
import re
from dataclasses import dataclass
from pathlib import Path

from the_test_cabinet_ci import enter_repo_root, fail, git, say, skip

# The mode git records a submodule's commit under: a gitlink.
GITLINK = "160000"
ZERO = "0" * 40
# A pin is a full commit id; anything else in a raw diff's sha column is not one.
COMMIT = re.compile(r"[0-9a-f]{40}")
# The refs of a remote that hold commits a landing can take: its branches.
BRANCHES = "refs/heads/"
# The branches of the managed worktrees, one per issue, task or filing, which
# admit a pin only to a push of the branch of the same name.
WORKTREE_BRANCHES = ("refs/heads/issue/", "refs/heads/task/", "refs/heads/filing/")
# A commit the message names, abbreviated as git would.
SHORT = 12
# What a pin's check found.
ON_REMOTE = "on its remote"
MISSING = "missing"
NOT_CHECKED_OUT = "not checked out"
UNLISTED = "remote not listed"
NO_ADDRESS = "no address"
OPTION_ADDRESS = "address read as an option"
NO_GITMODULES = "submodule-remotes: this repository has no .gitmodules, so it pins no submodule."


@dataclass(frozen=True)
class Pin:
    """A submodule commit pinned at `path` of the repository checked out at `holder`.

    `label` is the path from the superrepository, so a nested pin reads as
    `outer/inner`. `holder_url` is the address of the repository holding the
    pin, which a relative address is read against, and `moved_from` holds the
    commits the pin stood at before, one per parent, which a nested pin is
    compared with.
    """

    holder: Path
    path: str
    label: str
    commit: str
    holder_commit: str
    holder_url: str | None
    moved_from: tuple[str, ...] = ()


@dataclass(frozen=True)
class Remote:
    """What `git ls-remote` listed for one address, read once per run.

    `tips` maps each branch the push can take a pin from to the commit it
    stands at; it is None when the remote could not be listed.
    """

    url: str
    tips: dict[str, str] | None = None


def _out(argv: list[str], cwd: Path, data: str | None = None) -> str | None:
    """git's output, or None when it failed.

    A byte that is no UTF-8, which a path may hold, is kept as the path it
    names rather than failing the gate.
    """
    done = git(argv, cwd=cwd, quiet=True, text=False, stdin=None if data is None else data.encode())
    return done.stdout.decode("utf-8", "surrogateescape") if done.returncode == 0 else None


def pushed_revisions(root: Path) -> list[str] | None:
    """The revision arguments naming the commits a push would publish, or None outside a push."""
    env = os.environ
    remote = env.get("PRE_COMMIT_REMOTE_NAME", "").strip()
    to_ref = env.get("PRE_COMMIT_TO_REF", "").strip()
    if not to_ref and remote:
        # A history with a root commit the remote lacks: pre-commit names the
        # ref being pushed and no range.
        to_ref = env.get("PRE_COMMIT_LOCAL_BRANCH", "").strip()
    if not to_ref:
        return None
    revisions = [to_ref]
    from_ref = env.get("PRE_COMMIT_FROM_REF", "").strip()
    if from_ref and from_ref != ZERO:
        revisions.append(f"^{from_ref}")
    named = bool(remote) and bool(_out(["config", "--get", f"remote.{remote}.url"], root))
    # With the commit the remote stood at, only that remote's branches are
    # left out besides it; without one, or for a push to an address, every
    # remote-tracking branch is, so history already published is not judged.
    revisions += ["--not", f"--remotes={remote}" if named and len(revisions) > 1 else "--remotes"]
    return revisions


def pushed_branch() -> str | None:
    """The branch of the remote the push updates, as `refs/heads/<b>`, or None when it updates no branch."""
    ref = os.environ.get("PRE_COMMIT_REMOTE_BRANCH", "").strip()
    return ref if ref.startswith(BRANCHES) and len(ref) > len(BRANCHES) else None


def admits(ref: str, target: str | None) -> bool:
    """Whether the remote's branch `ref` can admit a pin to a push of `target`."""
    return ref.startswith(BRANCHES) and (ref == target or not ref.startswith(WORKTREE_BRANCHES))


def _raw_pin(meta: str, path: str, holder: Path, commit: str, url: str | None) -> Pin | None:
    """The pin a raw diff line records, or None when it records no gitlink."""
    parents = len(meta) - len(meta.lstrip(":"))
    fields = meta.lstrip(":").split()
    # Modes and object ids, one per parent and one for the result, then the status.
    if len(fields) < 2 * (parents + 1):
        return None
    modes, shas = fields[: parents + 1], fields[parents + 1 : 2 * (parents + 1)]
    if modes[-1] != GITLINK or not COMMIT.fullmatch(shas[-1]) or shas[-1] == ZERO:
        return None
    before = tuple(sha for mode, sha in zip(modes[:-1], shas[:-1], strict=True) if mode == GITLINK and sha != ZERO)
    return Pin(holder, path, path, shas[-1], commit, url, before)


def moved_pins(root: Path, revisions: list[str], url: str | None) -> tuple[int, list[Pin]]:
    """How many commits the revisions name, and every pin one of them moved.

    The combined diff of a merge names a path only where the merge's own
    content differs from every parent's, so a pin a merge took whole from one
    parent, which that parent's own commit moved, is not counted twice. A
    submodule configured to be ignored is still read, since its pin is what is
    being published.
    """
    listed = _out(
        [
            "log",
            "-z",
            "--raw",
            "-c",
            "--no-abbrev",
            "--no-renames",
            "--root",
            "--ignore-submodules=none",
            "--no-show-signature",
            "--format=%x01%H",
            # The revisions are the gate's own, `--not` among them, so no
            # `--end-of-options`: a ref git names never opens with `-`.
            *revisions,
            "--",
        ],
        root,
    )
    if listed is None:
        fail(f"Could not list the commits the push would publish ({' '.join(revisions)}).")
    commits = 0
    pins: list[Pin] = []
    commit = ""
    tokens = iter(listed.split("\0"))
    for token in tokens:
        if "\x01" in token:
            commit = token.rpartition("\x01")[2].strip()
            commits += 1
            continue
        token = token.lstrip("\n")
        if not token.startswith(":"):
            continue
        pin = _raw_pin(token, next(tokens, ""), root, commit, url)
        if pin is not None:
            pins.append(pin)
    return commits, pins


def _modules(holder: Path, commit: str) -> dict[str, tuple[str, str | None]]:
    """Each submodule's name and `.gitmodules` address, by its path, as `commit` records them."""
    listed = _out(["config", "--blob", f"{commit}:.gitmodules", "--get-regexp", r"^submodule\..*\.(path|url)$"], holder)
    paths: dict[str, str] = {}
    urls: dict[str, str] = {}
    for line in (listed or "").splitlines():
        key, _, value = line.partition(" ")
        name, _, kind = key.removeprefix("submodule.").rpartition(".")
        (paths if kind == "path" else urls)[name] = value
    return {path: (name, urls.get(name)) for name, path in paths.items()}


def _resolve(url: str, base: str | None) -> str | None:
    """A `.gitmodules` address, a relative one read against the address of the repository holding it."""
    if not url.startswith(("./", "../")):
        return url
    if base is None:
        return None
    base = base.rstrip("/")
    head, separator, rest = base.partition("://")
    if separator:
        return f"{head}://{posixpath.normpath(posixpath.join(rest, url))}"
    if ":" in base and not base.startswith("/"):
        # An SCP-style address, `host:path`.
        host, _, rest = base.partition(":")
        return f"{host}:{posixpath.normpath(posixpath.join(rest, url))}"
    return posixpath.normpath(posixpath.join(base, url))


def repository_of(pin: Pin) -> tuple[Path | None, bool]:
    """Where the submodule's commits can be fetched into, and whether that is a checkout.

    A submodule that is not checked out is an empty directory, in which git
    would answer for the repository holding it, so its own `.git` is asked for
    first. Without one, the repository git keeps for it under the holder's
    `modules/`, which a `deinit` leaves, stands in.
    """
    checkout = pin.holder / pin.path
    if (checkout / ".git").exists():
        return checkout, True
    name = _modules(pin.holder, pin.holder_commit).get(pin.path, (pin.path, None))[0]
    kept = _out(["rev-parse", "--path-format=absolute", "--git-path", f"modules/{name}"], pin.holder)
    if kept and (Path(kept.strip()) / "HEAD").is_file():
        return Path(kept.strip()), False
    return None, False


def remote_url(pin: Pin) -> str | None:
    """The address the submodule at the pin's path is fetched from by every checkout."""
    name, written = _modules(pin.holder, pin.holder_commit).get(pin.path, (None, None))
    if written:
        return _resolve(written, pin.holder_url)
    if name is not None:
        configured = _out(["config", "--get", f"submodule.{name}.url"], pin.holder)
        if configured and configured.strip():
            return configured.strip()
    checkout = pin.holder / pin.path
    if (checkout / ".git").exists():
        origin = _out(["remote", "get-url", "origin"], checkout)
        if origin and origin.strip():
            return origin.strip()
    return None


def list_remote(url: str, cwd: Path, target: str | None) -> Remote:
    """The branches of the remote at `url` that admit a pin to a push of `target`, and the commits they stand at.

    A tag is not listed: a landing merges branches, so a commit a tag alone
    holds is one the branch it targets lacks.
    """
    listed = _out(["ls-remote", "--heads", "--end-of-options", url], cwd)
    if listed is None:
        return Remote(url)
    tips: dict[str, str] = {}
    for line in listed.splitlines():
        sha, _, ref = line.partition("\t")
        if admits(ref, target) and COMMIT.fullmatch(sha):
            tips[ref] = sha
    return Remote(url, tips)


def _held(repository: Path, commits: set[str]) -> set[str]:
    """The commits the repository holds."""
    asked = "".join(f"{sha}\n" for sha in sorted(commits))
    answered = _out(["cat-file", "--batch-check=%(objectname) %(objecttype)"], repository, asked) or ""
    return {line.split()[0] for line in answered.splitlines() if line.endswith(" commit")}


def on_remote(pin: Pin, remote: Remote, repository: Path | None, fetched: set[tuple[str, Path]]) -> bool:
    """Whether a branch of the remote the push can take it from holds the pinned commit.

    A branch standing at the pin answers at once. Otherwise the repository
    fetches each such branch whose commit it lacks, once per remote, which
    writes no ref and no FETCH_HEAD, and the pin has to be an ancestor of one
    of them.
    """
    assert remote.tips is not None
    tips = set(remote.tips.values())
    if pin.commit in tips:
        return True
    if repository is None or not tips:
        return False
    if (remote.url, repository) not in fetched:
        fetched.add((remote.url, repository))
        lacking = tips - _held(repository, tips)
        wanted = "".join(f"{ref}\n" for ref, sha in sorted(remote.tips.items()) if sha in lacking)
        if wanted:
            fetch = ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--recurse-submodules=no", "--stdin"]
            _out([*fetch, "--end-of-options", remote.url], repository, wanted)
    if not _held(repository, {pin.commit}):
        return False
    # Every commit the pin reaches that no tip reaches: none when a tip holds
    # the pin. A tip the fetch did not bring is left out rather than failing
    # the count.
    asked = f"{pin.commit}\n--not\n" + "".join(f"{sha}\n" for sha in sorted(tips))
    beyond = _out(["rev-list", "--count", "--ignore-missing", "--stdin"], repository, asked)
    return beyond is not None and beyond.strip() == "0"


def _links(repository: Path, commit: str) -> dict[str, str] | None:
    """The gitlinks a commit's tree holds, by path, or None when the commit cannot be read."""
    listed = _out(["ls-tree", "-r", "-z", "--end-of-options", commit], repository)
    if listed is None:
        return None
    found: dict[str, str] = {}
    for entry in listed.split("\0"):
        meta, _, path = entry.partition("\t")
        parts = meta.split()
        if len(parts) == 3 and parts[0] == GITLINK:
            found[path] = parts[2]
    return found


def nested_pins(pin: Pin, checkout: Path, url: str) -> list[Pin]:
    """The pins the pinned commit moved in its own submodules, against the commits the pin moved from."""
    now = _links(checkout, pin.commit)
    if not now:
        return []
    known = [found for found in (_links(checkout, commit) for commit in pin.moved_from) if found is not None]
    nested: list[Pin] = []
    for path, commit in sorted(now.items()):
        # A pin each earlier commit already held was checked when that commit was.
        if known and all(found.get(path) == commit for found in known):
            continue
        olds = tuple(found[path] for found in known if path in found)
        nested.append(Pin(checkout, path, f"{pin.label}/{path}", commit, pin.commit, url, olds))
    return nested


def _short(commit: str) -> str:
    return commit[:SHORT]


def _considered(branches: tuple[str, ...]) -> str:
    """The branches a pin was looked for on, by name."""
    return ", ".join(ref.removeprefix(BRANCHES) for ref in branches) if branches else "none"


def _problem(verdict: str, label: str, commit: str, url: str, branches: tuple[str, ...], holders: set[str]) -> str:
    """What is wrong with one pin, naming the commits that pin it and the branches it was looked for on."""
    pinned = f"{label} {commit}, pinned by {', '.join(sorted(_short(holder) for holder in holders))}"
    considered = f"the branches considered: {_considered(branches)}"
    if verdict == MISSING:
        return (
            f"{pinned}, is on no branch of {url} the push can take it from ({considered}). A tag, or an issue/, "
            f"task/ or filing/ branch other than the one pushed, does not admit it: merge it to such a branch of "
            f"the submodule and push that first."
        )
    if verdict == NOT_CHECKED_OUT:
        return (
            f"{pinned}, is not the tip of a branch of {url} the push can take it from ({considered}), and the "
            f"submodule is not checked out here to fetch the rest into. Check it out "
            f"(`git submodule update --init {label}`) and push again."
        )
    if verdict == UNLISTED:
        return f"{pinned}: the branches of {url} could not be listed, so whether it is there is unknown."
    if verdict == OPTION_ADDRESS:
        return f"{pinned}: the submodule's address {url!r} opens with '-', which git would read as an option."
    return f"{pinned}: no address is configured for the submodule, so whether its remote holds it is unknown."


def _modules_anywhere(root: Path, revisions: list[str]) -> bool:
    """Whether the working tree, the pushed commit or any commit the push publishes holds a `.gitmodules`."""
    if (root / ".gitmodules").is_file():
        return True
    if _out(["cat-file", "-e", f"{revisions[0]}:.gitmodules"], root) is not None:
        return True
    touched = _out(["log", "--format=%H", "-1", *revisions, "--", ".gitmodules"], root)
    return bool(touched and touched.strip())


def main() -> None:
    root = enter_repo_root()
    if _out(["rev-parse", "--is-inside-work-tree"], root) is None:
        if not (root / ".gitmodules").is_file():
            skip(NO_GITMODULES)
        skip("submodule-remotes: this workspace is not a git checkout yet, so nothing is pushed from it.")
    revisions = pushed_revisions(root)
    if revisions is None:
        if not (root / ".gitmodules").is_file():
            skip(NO_GITMODULES)
        skip(
            "submodule-remotes: nothing is being pushed, so no pin is about to be published. It runs as the pre-push",
            "hook; `pre-commit run submodule-remotes --hook-stage pre-push --from-ref <commit> --to-ref HEAD`",
            "checks a range by hand.",
        )
    if not _modules_anywhere(root, revisions):
        skip(NO_GITMODULES)

    # A relative address is read against the superrepository's own remote, as
    # `git submodule init` reads it, and against the address pushed to without one.
    origin = (_out(["remote", "get-url", "origin"], root) or "").strip()
    base = origin or os.environ.get("PRE_COMMIT_REMOTE_URL", "").strip() or None
    commits, pending = moved_pins(root, revisions, base)
    target = pushed_branch()
    remotes: dict[str, Remote] = {}
    fetched: set[tuple[str, Path]] = set()
    verdicts: dict[tuple[str, str, Path | None], str] = {}
    # Each pin that fails, by what is wrong with it and the branches it was
    # looked for on, with the commits pinning it.
    failing: dict[tuple[str, str, str, str, tuple[str, ...]], set[str]] = {}
    passed = 0
    while pending:
        pin = pending.pop(0)
        url = remote_url(pin)
        if url is None or url.startswith("-"):
            verdict = NO_ADDRESS if url is None else OPTION_ADDRESS
            failing.setdefault((verdict, pin.label, pin.commit, url or "", ()), set()).add(pin.holder_commit)
            continue
        repository, checked_out = repository_of(pin)
        key = (url, pin.commit, repository)
        if key not in verdicts:
            remote = remotes.get(url)
            if remote is None:
                remote = remotes[url] = list_remote(url, repository or root, target)
            if remote.tips is None:
                verdicts[key] = UNLISTED
            elif on_remote(pin, remote, repository, fetched):
                verdicts[key] = ON_REMOTE
                passed += 1
                if repository is not None and checked_out:
                    pending.extend(nested_pins(pin, repository, url))
            else:
                verdicts[key] = MISSING if repository is not None else NOT_CHECKED_OUT
        if verdicts[key] != ON_REMOTE:
            branches = tuple(sorted(remotes[url].tips or ()))
            failing.setdefault((verdicts[key], pin.label, pin.commit, url, branches), set()).add(pin.holder_commit)

    if failing:
        fail(
            *(
                _problem(verdict, label, commit, url, branches, holders)
                for (verdict, label, commit, url, branches), holders in sorted(failing.items())
            ),
            "",
            "A commit pinning a submodule commit that no branch of its remote the push can target holds is one a",
            "landing of the push's branch stops on: the submodule's branch it lands on lacks the pin. For a push to",
            "<b>, the submodule's branch <b> admits a pin, and so does any branch of it that is no issue/, task/ or",
            "filing/ branch; a tag alone does not. Push each submodule's branch first, then the repository pinning it.",
        )
    branch = f" to {target.removeprefix(BRANCHES)}" if target else ""
    say(
        f"submodule-remotes: {commits} commit(s) to publish{branch}, {passed} pin(s) they moved, each on a branch",
        "of its remote the push can take it from.",
    )


main()
