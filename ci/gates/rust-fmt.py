"""Fail when any Rust source is not rustfmt-clean.

rustfmt formats the whole workspace at once, so this checks everything
regardless of which files are staged.
"""

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so cargo resolves the workspace regardless of the
# caller's working directory.
enter_repo_root()

if not succeeded(["cargo", "fmt", "--all", "--", "--check"]):
    fail("", "rustfmt found unformatted code. Fix it with:", "    cargo fmt --all")
