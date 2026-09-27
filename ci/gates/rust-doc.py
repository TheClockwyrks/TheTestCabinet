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
"""

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so cargo resolves the workspace regardless of the
# caller's working directory.
enter_repo_root()

if not succeeded(["cargo", "doc", "--locked", "--workspace", "--no-deps"]):
    fail(
        "",
        "rustdoc found issues. Fix them, then commit again.",
        "(If a commit is genuinely fine, 'git commit --no-verify' bypasses the hook.)",
    )
