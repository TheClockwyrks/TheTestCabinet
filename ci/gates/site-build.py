"""gallery build (vite build).

The public gallery (`apps/site`) is a static build of the shared UI over the
published runs, and nothing else here runs its production build. The root
`build:site` script builds the workspace packages the gallery imports from
their `dist/` first (`build:packages`), then runs the site's own `build`, which
is `vite build` into `apps/site/dist`. A gallery that no longer builds is a
defect no typecheck sees, and the next release could not publish it.

A build writes no JUnit, so this gate leaves `CI_GATE_ARTIFACTS` alone.
"""

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, run, say

# From the workspace root, so npm finds the workspaces regardless of the
# caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")

if run(["npm", "run", "--silent", "build:site"], unset=GIT_LOCATION_VARIABLES).returncode != 0:
    fail(
        "",
        "The gallery does not build. Reproduce it with:",
        "    npm run build:site",
    )

say("The gallery builds.")
