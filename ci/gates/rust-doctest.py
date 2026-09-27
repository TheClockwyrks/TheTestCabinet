"""Run the Rust doctests, which nextest does not execute.

This is the one use of `cargo test` in the workspace: the code examples inside
doc comments are compiled and run by rustdoc's own harness, and nextest has no
way to reach them. `rust-doc` beside this file checks that those comments'
links resolve, which says nothing about whether their examples compile, so the
two catch disjoint problems. Stable cargo has no JUnit report to give for
doctests, so the gate writes none.
"""

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so cargo resolves the workspace regardless of the
# caller's working directory.
enter_repo_root()

if not succeeded(["cargo", "test", "--locked", "--workspace", "--doc"]):
    fail("", "A doctest failed. Fix it, then run this gate again.")
