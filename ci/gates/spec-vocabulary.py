"""Keep evaluation vocabulary out of the spec text seeded into a model's workspace.

Every non-frozen version's `prompt.hbs` and `specs/` is what a model receives,
and it must not learn that it is under test. scripts/ci/spec-vocabulary-check.mjs
reads every one of them, whatever was staged, so the gate takes no file
arguments. Frozen versions are counted but never fail it: nobody can fix them.
"""

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, require_tool, run

enter_repo_root()
require_tool("node", "The devcontainer and the web CI image install it.")

if run(["node", "scripts/ci/spec-vocabulary-check.mjs"], unset=GIT_LOCATION_VARIABLES).returncode != 0:
    fail(
        "",
        "A seeded spec or prompt names this project or how a run is judged.",
        "Reword it, or cut a new version when the hit is in a frozen one.",
    )
