"""Hold every project Dockerfile's COPY sources to the build context it is given.

The root `.dockerignore` is an allowlist, so a COPY of a path it keeps out fails
only when the image is next built, long after the commit. scripts/ci/build-context.sh
reads each of this project's Dockerfiles (`deployments/images/`, `containers/`)
against the allowlist that applies to it, COPY sources and RUN bind mounts alike,
checks the inputs no COPY names (the workspace's `include_str!` paths, the staged
packages, the toolchain installers' pins), and holds each Rust pin under
`containers/` to `rust-toolchain.toml`, which the template decides.
"""

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, run

enter_repo_root()

# The script lists tracked files with `git ls-files`, so it must not inherit a
# commit hook's GIT_DIR (see GIT_LOCATION_VARIABLES).
if run(["scripts/ci/build-context.sh"], unset=GIT_LOCATION_VARIABLES).returncode != 0:
    fail(
        "",
        "A Dockerfile copies what its build context leaves out, or a Rust pin under",
        "containers/ differs from rust-toolchain.toml. The errors above name the file.",
    )
