"""Run the web app's tests (vitest under jsdom).

The app's tests are split across two vitest projects, and a test's file name is
what assigns it to one of them. This gate runs the `jsdom` project, which holds
what a screen renders and what it does when it is used; `web-browser-test.py`
beside this file runs the `browser` project, which holds what a real engine has
to answer.

It runs the app's own `test` script through the npm workspace, which is
`vitest run` over that project. `apps/web/vite.config.ts` decides the file set
from the project name the script passes, so no path is passed.

Asked for artifacts, the same configuration adds vitest's JUnit report and a v8
coverage summary: it reads `CI_GATE_ARTIFACTS`, which the suite inherits from
this gate, so the run with a report and the run without one are one command.
"""

from the_test_cabinet_ci import artifacts_dir, enter_repo_root, fail, succeeded

# From the workspace root, so npm finds the workspace regardless of the
# caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")

# The variable may name a relative path, and npm runs the suite from the app's
# folder: the absolute form means the same directory there.
artifacts = artifacts_dir()
environment = {} if artifacts is None else {"CI_GATE_ARTIFACTS": str(artifacts)}

if not succeeded(["npm", "run", "--silent", "--workspace", "apps/web", "test"], env=environment):
    fail(
        "",
        "The web app's tests failed. Reproduce them with:",
        "    npm run --workspace apps/web test",
    )
