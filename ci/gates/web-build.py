"""Build the web app's bundle, which is what the server's image embeds.

It runs the app's own `build` script through the npm workspace, which is
`tsc -b` and then `vite build` into `apps/web/dist`. A bundle that no longer
builds is a defect the typecheck cannot see, and nothing else here runs Vite's
production build. The output is build output `make clean` removes.
"""

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so npm finds the workspace regardless of the
# caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")

if not succeeded(["npm", "run", "--silent", "--workspace", "apps/web", "build"]):
    fail(
        "",
        "The web app does not build. Reproduce it with:",
        "    npm run --workspace apps/web build",
    )
