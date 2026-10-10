"""The lock file of an application, and what a checkout does to it.

An application commits its `Cargo.lock`: it is the record of the project's
revisions that build together. Cargo writes that record from the sources the
manifests name, which are public git sources, and a pipeline building the
repository on its own holds every build to it with `--locked`.

A checkout inside the superrepo is a different case. Its `.cargo/config.toml`
carries a `[patch]` table that replaces every project git source with the
sibling checkout, and cargo rewrites the lock file to say so: the replaced
crates lose their `source`, and every patch the graph did not use is recorded
under `[[patch.unused]]`, in an order that is not stable between runs. That
lock file is neither portable nor steady under `--locked`, so inside the
superrepo a gate builds without the flag and instead refuses a commit that
would carry the rewritten lock file. `scripts/resolve-lock.sh` writes the
standalone one back.

Any package a lock file lists without a source that is not a member of the
workspace is a mark of the rewrite: every crate a standalone build takes comes
from a git source or a registry, and only a patch to a path drops it.
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path

from the_test_cabinet_ci.proc import git


def _config_files(root: Path) -> list[Path]:
    """Every cargo configuration file that applies to a build in `root`.

    Cargo reads `.cargo/config.toml` (and the older `.cargo/config`) in the
    working directory and every ancestor, then the one under `CARGO_HOME`.
    """
    files: list[Path] = []
    for directory in (root.resolve(), *root.resolve().parents):
        for name in ("config.toml", "config"):
            candidate = directory / ".cargo" / name
            if candidate.is_file():
                files.append(candidate)
    home = Path(os.environ.get("CARGO_HOME", Path.home() / ".cargo"))
    for name in ("config.toml", "config"):
        candidate = home / name
        if candidate.is_file() and candidate not in files:
            files.append(candidate)
    return files


def patch_table_active(root: Path) -> bool:
    """Whether a `[patch]` table shapes a build in `root`."""
    for config in _config_files(root):
        try:
            table = tomllib.loads(config.read_text(encoding="utf-8"))
        except (tomllib.TOMLDecodeError, OSError):
            continue
        if table.get("patch"):
            return True
    return False


def locked_arguments(root: Path) -> list[str]:
    """`--locked` where the committed lock file can hold, nothing where it cannot."""
    return [] if patch_table_active(root) else ["--locked"]


def workspace_members(root: Path) -> set[str]:
    """The names of the crates the workspace itself holds, which a lock file lists without a source."""
    names: set[str] = set()
    for manifest in sorted(root.rglob("Cargo.toml")):
        if {"target", ".git", "node_modules"} & set(manifest.relative_to(root).parts):
            continue
        try:
            table = tomllib.loads(manifest.read_text(encoding="utf-8"))
        except (tomllib.TOMLDecodeError, OSError):
            continue
        name = table.get("package", {}).get("name")
        if name:
            names.add(str(name))
    return names


def rewritten_lock_problems(text: str, members: set[str] = frozenset()) -> list[str]:
    """What marks a lock file as one cargo rewrote under a patch table.

    `members` are the workspace's own crates, which a lock file lists without
    a source in every checkout.
    """
    try:
        lock = tomllib.loads(text)
    except tomllib.TOMLDecodeError as error:
        return [f"Cargo.lock does not parse: {error}"]
    problems: list[str] = []
    unused = lock.get("patch", {}).get("unused", [])
    if unused:
        problems.append(f"it records {len(unused)} unused patch entries under [[patch.unused]]")
    for package in lock.get("package", []):
        name = str(package.get("name", ""))
        if name not in members and "source" not in package:
            problems.append(f"{name} has no source, so it was resolved to a sibling checkout")
    return problems


def committed_lock_text(root: Path) -> str | None:
    """The lock file as the next commit would carry it: staged, else HEAD's."""
    for revision in (":Cargo.lock", "HEAD:Cargo.lock"):
        result = git(["show", revision], cwd=root, quiet=True)
        if result.returncode == 0:
            return result.stdout
    return None


def committed_lock_problems(root: Path) -> list[str]:
    """Why the lock file the next commit carries is not the standalone one."""
    text = committed_lock_text(root)
    if text is None:
        return ["no Cargo.lock is committed or staged, and an application commits one"]
    return rewritten_lock_problems(text, workspace_members(root))
