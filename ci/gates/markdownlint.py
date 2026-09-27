"""Lint the Markdown style (shares .markdownlint-cli2.yaml).

Like its cspell sibling it runs the workspace's own locked markdownlint-cli2
rather than a copy pre-commit installs through `additional_dependencies`, so
the rules this gate enforces are the ones package-lock.json pins rather than
whatever the transitive `markdownlint` range happens to resolve to today.
"""

import os
import sys

from the_test_cabinet_ci import enter_repo_root, fail, run

# From the workspace root, so npm finds package.json and markdownlint-cli2
# finds .markdownlint-cli2.yaml regardless of the caller's working directory.
root = enter_repo_root()

if not os.access(root / "node_modules" / ".bin" / "markdownlint-cli2", os.X_OK):
    fail("markdownlint-cli2 is not installed. Install the npm workspace first:", "    npm ci")

# No file arguments: .markdownlint-cli2.yaml's globs already scope the lint, and
# CLI paths would be *added* to those globs rather than replacing them.
sys.exit(run(["npm", "run", "--silent", "lint:md"]).returncode)
