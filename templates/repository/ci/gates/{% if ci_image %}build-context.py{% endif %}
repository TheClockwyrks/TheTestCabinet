"""Hold the Dockerfiles' COPY sources to the build context and their Rust pins to the toolchain.

The root `.dockerignore` is an allowlist, so a COPY of a path it leaves out
fails only when the image is next built, which is after the gates, on master
and staging. scripts/ci/build-context.sh reads each tracked Dockerfile against
the allowlists that can apply to it, and holds every Rust pin in one to the
channel `rust-toolchain.toml` names.
"""

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, run

enter_repo_root()

# The script lists tracked files with `git ls-files`, so it must not inherit a
# commit hook's GIT_DIR (see GIT_LOCATION_VARIABLES).
if run(["scripts/ci/build-context.sh"], unset=GIT_LOCATION_VARIABLES).returncode != 0:
    fail(
        "",
        "A Dockerfile copies what its build context leaves out, or pins a Rust other",
        "than rust-toolchain.toml's channel. The errors above name the file.",
    )
