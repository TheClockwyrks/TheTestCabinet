"""Typecheck the web app against its own tsconfig.

It runs the app's own `typecheck` script through the npm workspace, which is
`tsc -b` over `apps/web/tsconfig.json`. That configuration decides the file
set, so no path is passed.
"""

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so npm finds the workspace regardless of the
# caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")

if not succeeded(["npm", "run", "--silent", "--workspace", "apps/web", "typecheck"]):
    fail(
        "",
        "TypeScript reported errors in the web app. Reproduce them with:",
        "    npm run --workspace apps/web typecheck",
    )
