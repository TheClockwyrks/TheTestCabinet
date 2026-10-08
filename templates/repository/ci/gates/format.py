"""Check formatting with Prettier across everything .prettierignore leaves in.

Like its markdownlint and cspell siblings it runs the npm workspace's own
locked Prettier through the `format:check` script rather than a copy pre-commit
installs through `additional_dependencies`, so the version that judges a commit
is the one package-lock.json pins. A formatter that disagrees with itself
between the commit gate and a clean checkout is worse than none: every
developer would rewrite the previous one's files.
"""

import os

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so npm finds package.json and Prettier finds
# .prettierrc.yaml and .prettierignore regardless of the caller's working
# directory.
root = enter_repo_root()

if not os.access(root / "node_modules" / ".bin" / "prettier", os.X_OK):
    fail("Prettier is not installed. Install the npm workspace first:", "    npm ci")

# No file arguments: .prettierignore is the whole of this gate's scope, and
# Prettier applies it to the paths it is given. Passing staged paths would
# narrow that scope per commit rather than replacing it, so what the gate covers
# would depend on what happened to be staged.
if not succeeded(["npm", "run", "--silent", "format:check"]):
    fail("", "Prettier found formatting differences. Fix them with:", "    npm run format")
