"""Build the documentation site (astro build).

Building is what tells a working set of pages from one whose configuration,
content schema or links no longer compile: the typecheck beside this gate reads
each page on its own, and only the build resolves the sidebar, the routes and
every internal link between them. The output is build output `make clean`
removes.
"""

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so npm finds the workspace regardless of the
# caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")

if not succeeded(["npm", "run", "--silent", "--workspace", "apps/docs", "build"]):
    fail(
        "",
        "The documentation site does not build. Reproduce it with:",
        "    npm run --workspace apps/docs build",
    )
