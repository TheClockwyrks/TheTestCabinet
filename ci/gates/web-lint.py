"""Lint the TypeScript with the workspace's own locked ESLint configuration.

It runs the root `lint` script through the npm workspace rather than a copy
pre-commit installs, so the commit gate and a clean checkout run the same
locked ESLint against the same configuration. ESLint reads the root
`eslint.config.js` for its file set, so no path is passed.

The script applies the ratchet: ESLint reads `eslint-suppressions.json`, the
baseline of the errors the code had when it came under the gate, and fails only
on an error past it. The Linting section of the building page in the
documentation describes the baseline and the commands that maintain it.
"""

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so npm finds the workspace regardless of the
# caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")

if not succeeded(["npm", "run", "--silent", "lint"]):
    fail(
        "",
        "ESLint found errors past the baseline in eslint-suppressions.json.",
        "Fix them, or apply ESLint's automatic fixes with:",
        "    npm run lint -- --fix",
    )
