"""Refuse any change to a frozen test-case version.

A test-case version with runs recorded against it carries a `.frozen` marker
holding a digest of the directory's tracked contents (scripts/freeze.sh writes
it). Editing that directory silently invalidates every run already scored
against it, so this gate recomputes each digest with `frozen_verify` from
scripts/lib/frozen.sh and fails on any difference. The fix for a case that must
change is a new version directory, never an edit in place.

The digest is read from the git index, not the worktree, so the hook judges
exactly what is being committed. That is why this gate, unlike every other one,
keeps `GIT_INDEX_FILE`: a partial `git commit <path>` stages into a temporary
index that git names in that variable, and that index is the commit. The other
location variables are removed, as `git()` removes them, so the checkout
entered is the repository read.
"""

import os

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, run, say

enter_repo_root()

# pre-commit sets PRE_COMMIT for every hook it runs. Under a hook the report
# names the staged files under each changed directory; anywhere else it says
# how to inspect the difference.
context = "commit" if os.environ.get("PRE_COMMIT") else "ci"

keep = {"GIT_INDEX_FILE"}
unset = [name for name in GIT_LOCATION_VARIABLES if name not in keep]
if run(["bash", "-c", f"source scripts/lib/frozen.sh && frozen_verify {context}"], unset=unset).returncode != 0:
    fail(
        "",
        "A frozen test-case version changed. Put the change in a new version",
        "directory; see apps/docs/src/content/docs/development/frozen-versions.md.",
    )
say("Every frozen test-case version still matches the digest its marker records.")
