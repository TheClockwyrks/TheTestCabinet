"""Fail when a committed, generated data-contract artifact is stale.

The TypeScript bindings in `packages/run-record/src/` and `packages/asset-contract/src/`
and the JSON Schemas in `apps/docs/public/schema/` are generated from the Rust
types, and committed because their readers cannot run the generator.
scripts/ci/contract-drift.sh regenerates them and fails on any difference. It
needs cargo and Node, so it runs on the rust track, whose setup steps provide
Node.
"""

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, require_tool, run

enter_repo_root()
require_tool("cargo", "The devcontainer and the Rust CI image install it.")
require_tool("node", "The devcontainer installs it, and so do the rust job's setup steps.")

if run(["scripts/ci/contract-drift.sh"], unset=GIT_LOCATION_VARIABLES).returncode != 0:
    fail(
        "",
        "A generated contract artifact is stale. Regenerate it and commit the result:",
        "    npm run gen:contract",
    )
