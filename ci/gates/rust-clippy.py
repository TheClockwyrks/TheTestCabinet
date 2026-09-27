"""Fail when Clippy reports anything, warnings denied.

Clippy compiles the workspace, so this is the slow gate. It operates on the
whole workspace, so it checks everything regardless of which files are staged.
If a crate is ever too expensive to compile on every commit (a GUI shell with
heavy system libraries, say), add `--exclude <package>` here.

`--locked` holds the build to Cargo.lock, so a manifest out of step with it
fails here rather than resolving something new.
"""

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so cargo resolves the workspace regardless of the
# caller's working directory.
enter_repo_root()

clippy = ["cargo", "clippy", "--locked", "--workspace", "--all-targets"]
if not succeeded([*clippy, "--", "-D", "warnings"]):
    fail(
        "",
        "clippy found issues. Fix them, then commit again.",
        "(If a commit is genuinely fine, 'git commit --no-verify' bypasses the hook.)",
    )
