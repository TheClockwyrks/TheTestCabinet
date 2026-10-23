"""Run the Rust doctests, which nextest does not execute.

This is the one use of `cargo test` in the workspace: the code examples inside
doc comments are compiled and run by rustdoc's own harness, and nextest has no
way to reach them. `rust-doc` beside this file checks that those comments'
links resolve, which says nothing about whether their examples compile, so the
two catch disjoint problems. Stable cargo has no JUnit report to give for
doctests, so the gate writes none.

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

with keep_lock_order(superrepo_locks(root)):
    passed = succeeded(["cargo", "test", *locked_arguments(root), "--workspace", "--doc"])
if not passed:
    fail("", "A doctest failed. Fix it, then run this gate again.")
