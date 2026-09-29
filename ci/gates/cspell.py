"""Spell-check the prose (shares cspell.json and the project dictionary).

It runs the workspace's own locked cspell instead of letting pre-commit install
one through `additional_dependencies`. That isolated install resolves cspell's
transitive dictionary packages fresh at hook-install time, so it drifts from
what package-lock.json pins, and a @cspell/dict-en_us that knows one word more
than the locked one is enough for this gate to disagree with a clean checkout.
Running the locked binary keeps both verdicts identical, and deferring to the
`spell` npm script keeps the flags in one place.
"""

import os

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so npm finds package.json and cspell finds
# cspell.json regardless of the caller's working directory.
root = enter_repo_root()

if not os.access(root / "node_modules" / ".bin" / "cspell", os.X_OK):
    fail("cspell is not installed. Install the npm workspace first:", "    npm ci")

# No file arguments: cspell.json's `files` globs already scope the check.
if not succeeded(["npm", "run", "--silent", "spell"]):
    fail(
        "",
        "cspell found unknown words. Fix the typo, or, if the word is a real",
        "domain term, add it to .cspell/project-words.txt.",
    )
