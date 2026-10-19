"""Fail when rustdoc reports anything, warnings denied (broken intra-doc links).

This guards the doc-comment half of the workspace that neither clippy nor the
test suite can see. The workspace denies `warnings` ([workspace.lints.rust] in
the root Cargo.toml) and that group covers rustdoc's own lints, so a broken
intra-doc link is a hard error, but only when something actually runs
`cargo doc`. This gate is what does.

Note this is NOT doctests, which `rust-doctest` beside this file runs.
Compiling and running the code examples inside doc comments says nothing about
whether the links in those comments resolve, so the two catch disjoint
problems.

`--no-deps` documents only workspace crates, not the dependency graph, which is
what makes this cheap enough to sit on every commit, and it reuses the same
`cargo check` artifacts the clippy gate beside it just built.

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
    passed = succeeded(["cargo", "doc", *locked_arguments(root), "--workspace", "--no-deps"])
if not passed:
    fail(
        "",
        "rustdoc found issues. Fix them, then commit again.",
        "(If a commit is genuinely fine, 'git commit --no-verify' bypasses the hook.)",
    )
