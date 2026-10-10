"""Lint the TypeScript with the workspace's own locked ESLint configuration.

It runs the root `lint` script through the npm workspace rather than a copy
pre-commit installs, so the commit gate and a clean checkout run the same
locked ESLint against the same configuration. ESLint reads the root
`eslint.config.js` for its file set, so no path is passed.

The script applies the ratchet: ESLint reads `eslint-suppressions.json`, the
baseline of the errors the code had when it came under the gate, and fails only
on an error past it. The Linting section of the building page in the
documentation describes the baseline and the commands that maintain it.

ESLint runs with a larger heap than Node's default. The type-checked rules hold
each project's whole TypeScript program in memory, and `packages/ui` alone
peaks at about 3.5 GB, past the limit Node derives on CI's hosted agents.
"""

import os

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

#: The heap, in MiB, ESLint is given: room above the measured peak, and under
#: the memory of the hosted agent the web job runs on.
HEAP_MIB = 5120

# From the workspace root, so npm finds the workspace regardless of the
# caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")

heap = f"--max-old-space-size={HEAP_MIB}"
environment = {"NODE_OPTIONS": f"{os.environ.get('NODE_OPTIONS', '')} {heap}".strip()}
if not succeeded(["npm", "run", "--silent", "lint"], env=environment):
    fail(
        "",
        "ESLint found errors past the baseline in eslint-suppressions.json.",
        "Fix them, or apply ESLint's automatic fixes with:",
        "    npm run lint -- --fix",
    )
