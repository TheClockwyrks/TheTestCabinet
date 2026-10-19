"""The superrepo's lock files under its patch table, and what a build does to them.

The superrepo's `.cargo/config.toml` carries a `[patch]` table per checked-out
repository, which replaces each project git source with the sibling checkout.
Every Cargo workspace beneath it, the root one and the ones nested under
`packages/`, records each patch its graph does not use under
`[[patch.unused]]`. Cargo writes that block grouped by patched source in an
order that is not stable between runs once more than one table is active, so
the same resolution is written in more than one order and `--locked` refuses
whichever order it did not happen to produce.

So, as the repository kit's own `lockfile` module rules for a checkout inside
the superrepo, a build here runs without `--locked` (`locked_arguments`), and
what holds a lock to the checkouts is the `dependency-graph` gate, which
compares the resolution with the unused patches taken as a set
(`same_resolution`). A gate that builds puts back a lock its build merely
reordered (`keep_lock_order`), bytes and modification time, so neither the
working tree nor a build script that names a lock as an input sees a change.

`patch_table_active` and `locked_arguments` are ported from the kit's
`templates/repository/ci/src/the_test_cabinet_ci/lockfile.py` and keep its
rule: `--locked` only where no `[patch]` table shapes the build.
"""

from __future__ import annotations

import json
import os
import tomllib
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from pathlib import Path

# The Cargo workspaces nested under the superrepo that commit a lock of their
# own: gg's guest and Rust library-set workspaces.
NESTED_LOCKS = ("packages/*/Cargo.lock", "packages/*/*/Cargo.lock")


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


def superrepo_locks(root: Path) -> list[Path]:
    """The root `Cargo.lock` and every nested one `NESTED_LOCKS` matches, those that exist."""
    candidates = [root / "Cargo.lock", *sorted(lock for pattern in NESTED_LOCKS for lock in root.glob(pattern))]
    return [lock for lock in candidates if lock.is_file()]


def _canonical(entry: object) -> str:
    return json.dumps(entry, sort_keys=True)


def resolution(text: str) -> dict[str, object] | None:
    """What a lock file records, with its unused patches as a set; None when it does not parse.

    Every other part of the lock is kept as cargo wrote it: the packages are
    written in a stable order, so an order change there is a change.
    """
    try:
        lock = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return None
    patch = dict(lock.pop("patch", {}))
    unused = patch.pop("unused", [])
    return {
        "lock": _canonical(lock),
        "patch": _canonical(patch),
        "unused": frozenset(_canonical(entry) for entry in unused),
        "unused_count": len(unused),
    }


def same_resolution(left: str, right: str) -> bool:
    """Whether two lock files record the same resolution, the order of their unused patches aside."""
    if left == right:
        return True
    parsed = resolution(left)
    return parsed is not None and parsed == resolution(right)


def restore_if_reordered(lock: Path, text: str, stat: os.stat_result) -> bool:
    """Put `text` back into `lock`, with its modification time, when cargo only reordered it.

    True when the lock was put back. A lock whose resolution changed is left
    as cargo wrote it.
    """
    try:
        now = lock.read_text(encoding="utf-8")
    except OSError:
        return False
    if now == text or not same_resolution(text, now):
        return False
    lock.write_text(text, encoding="utf-8")
    os.utime(lock, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    return True


@contextmanager
def keep_lock_order(locks: Iterable[Path]) -> Iterator[None]:
    """Run a build that may rewrite `locks`, and put back each one it only reordered."""
    snapshots = []
    for lock in locks:
        try:
            snapshots.append((lock, lock.read_text(encoding="utf-8"), lock.stat()))
        except OSError:
            continue
    try:
        yield
    finally:
        for lock, text, stat in snapshots:
            restore_if_reordered(lock, text, stat)
