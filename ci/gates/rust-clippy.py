"""Fail when Clippy reports anything, warnings denied.

Clippy compiles the workspace, so this is the slow gate. It operates on the
whole workspace, so it checks everything regardless of which files are staged.
If a crate is ever too expensive to compile on every commit (a GUI shell with
heavy system libraries, say), add `--exclude <package>` here.

Inside the superrepo the patch table makes cargo write the lock's
`[[patch.unused]]` block in an order that is not stable between runs, so the
build runs without `--locked` (`lockfile.locked_arguments`), the
`dependency-graph` gate is what holds the lock to the checkouts, and a lock
the build merely reordered is put back as it was (`lockfile.keep_lock_order`).
"""

from the_test_cabinet_ci import enter_repo_root, fail, succeeded
from the_test_cabinet_ci.lockfile import keep_lock_order, locked_arguments, superrepo_locks

# From the workspace root, so cargo resolves the workspace regardless of the
# caller's working directory.
root = enter_repo_root()

clippy = ["cargo", "clippy", *locked_arguments(root), "--workspace", "--all-targets"]
with keep_lock_order(superrepo_locks(root)):
    passed = succeeded([*clippy, "--", "-D", "warnings"])
if not passed:
    fail(
        "",
        "clippy found issues. Fix them, then commit again.",
        "(If a commit is genuinely fine, 'git commit --no-verify' bypasses the hook.)",
    )
