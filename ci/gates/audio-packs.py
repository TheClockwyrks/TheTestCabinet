"""Hold every version's `[audio] packs` declaration to the pack registry.

Manifest resolution checks a declaration's shape, but it also runs at backend
ingest, where `containers/sample-packs/` is absent, so it cannot resolve a ref.
scripts/ci/audio-packs-check.mjs does, and it is the only place that requires
every non-frozen full-stack version and every game jam to declare the key. It
reads every version, not the staged files, because publishing or retiring a pack
re-judges every manifest.
"""

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, require_tool, run

enter_repo_root()
require_tool("node", "The devcontainer and the web CI image install it.")

if run(["node", "scripts/ci/audio-packs-check.mjs"], unset=GIT_LOCATION_VARIABLES).returncode != 0:
    fail(
        "",
        "A version's [audio] packs is missing, or names a pack that does not",
        "resolve against containers/sample-packs/.",
    )
