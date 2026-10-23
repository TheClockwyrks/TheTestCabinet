"""Refuse a dependency the Repositories development page does not permit this repository.

A Rust dependency on another repository of The Test Cabinet, named by its git
source, and an npm dependency on one of the project's packages, named by its
package, are each held to the build edges the Repositories page of the
superrepo's documentation draws from this repository. A path dependency that
leaves the repository is refused too: a repository builds on its own, and
inside the superrepo the patch table and the package links point it at a
sibling checkout instead.

The repository is named in `.test-cabinet-repo.toml`, which the kit wrote when
it rendered the repository. The table itself is `the_test_cabinet_ci.edges`,
rendered here from the kit, so the superrepo's whole-graph gate and this one
read the same statement of the graph.
"""

import tomllib

from the_test_cabinet_ci import edges, enter_repo_root, fail, say

root = enter_repo_root()
record = root / ".test-cabinet-repo.toml"
if not record.is_file():
    fail(f"{record.name} is missing, so this repository, and with it its permitted edges, is unknown.")
recorded = tomllib.loads(record.read_text(encoding="utf-8"))
name = recorded.get("name")
if name not in edges.BUILD_EDGES:
    fail(f"{record.name} names the repository {name!r}; the repositories are {sorted(edges.BUILD_EDGES)}.")
found = edges.violations(root, name)
if found:
    fail(
        *found,
        "",
        f"{name} may depend on: {edges.describe(name)}. The Repositories development page of the superrepo's"
        " documentation draws the edges; this repository's copy of the table is ci/src/the_test_cabinet_ci/edges.py.",
    )
say(f"every dependency of {name} is one the edges permit")
