"""Fail when a committed, generated API-contract artifact is stale.

The TypeScript bindings in `packages/backend-api/src/` and the JSON Schemas in
`apps/docs/public/schema/` (every directory but `core/` and `gg/`) are generated
from the Rust types by `api-codegen` and committed because their readers cannot
run the generator. scripts/ci/contract-drift.sh regenerates them and fails on any
difference, or on a generated file that was never committed. The data contract
is the contracts repository's, whose own contract-drift gate checks it. This one
needs cargo and Node, so it runs on the rust track, whose setup steps provide
Node."""

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
