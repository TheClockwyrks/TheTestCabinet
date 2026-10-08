"""Check every checked-out repository against the edges, the patch table and the package links.

The superrepo holds each repository of The Test Cabinet as a submodule, and
joins them inside it through the `[patch]` tables of `.cargo/config.toml` and
the package links of `.package-links.json`. This gate holds the three
together, and each checked-out repository's manifests to the edges the
Repositories development page draws (see `the_test_cabinet_ci.graph` for
what is asked). The edge table is the repository kit's own,
`templates/repository/ci/src/the_test_cabinet_ci/edges.py`, imported by path,
so the superrepo judges by the same table each repository's
`dependency-edges` gate does.

A submodule that is not checked out, or one the kit renders nothing into,
such as cold-storage, is skipped with a notice. While the repositories are
still the monorepo's directories, no submodule is one, and the gate holds the
patch table and the link table alone.
"""

from the_test_cabinet_ci import enter_repo_root, fail, say
from the_test_cabinet_ci.graph import check

root = enter_repo_root()
report = check(root)
for notice in report.notices:
    say(f"note: {notice}")
if report.checked:
    say(f"checked {', '.join(report.checked)} against the edge table")
if not report.ok:
    fail(
        *report.problems,
        "",
        "The Repositories development page states the edges; .cargo/config.toml holds the patch table and "
        ".package-links.json the package links.",
    )
say("the dependency graph is what the edges permit")
