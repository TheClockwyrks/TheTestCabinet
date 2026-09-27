"""Lint the TypeScript with the workspace's own locked ESLint configuration.

It runs the root `lint` script through the npm workspace rather than a copy
pre-commit installs, so the commit gate and a clean checkout run the same
locked ESLint against the same configuration. ESLint reads the root
`eslint.config.js` for its file set, so no path is passed.
"""

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so npm finds the workspace regardless of the
# caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")

if not succeeded(["npm", "run", "--silent", "lint"]):
    fail("", "ESLint found problems. Fix them, or run:", "    npm run lint -- --fix")
