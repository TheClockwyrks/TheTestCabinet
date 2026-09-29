"""validator projects typecheck (tsc).

Every test case that supports engines ships one validator project per engine
under `<version>/validation/<engine>/`, each with a `tsconfig.json` of its own.
The root `typecheck:validators` script (`scripts/typecheck-validators.mjs`)
finds every one of them and runs `tsc --noEmit` over each, so a validator that
does not compile fails here rather than in a run, where a broken suite costs the
run every point it decides.

The projects resolve the build's `../src/*` and the harness's `./case-harness/*`
through the `rootDirs` their configs declare, but an engine's validators and the
engine builds they import read each engine package (`@clockwyrks/simple-2d` and
the rest) from its `dist/`, which a fresh checkout does not have. So the
workspace packages are built first, which `build:packages` does incrementally.
tsc writes no JUnit, so this gate leaves `CI_GATE_ARTIFACTS` alone.
"""

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, run, say

# From the workspace root, so npm finds the workspace and the script finds the
# test cases regardless of the caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")

if run(["npm", "run", "--silent", "build:packages"], unset=GIT_LOCATION_VARIABLES).returncode != 0:
    fail(
        "",
        "The workspace packages do not build, so no validator can import them. Reproduce it with:",
        "    npm run build:packages",
    )

if run(["npm", "run", "--silent", "typecheck:validators"], unset=GIT_LOCATION_VARIABLES).returncode != 0:
    fail(
        "",
        "A test case's validator project does not typecheck. Reproduce it with:",
        "    npm run typecheck:validators",
    )

say("Every validator project typechecks.")
