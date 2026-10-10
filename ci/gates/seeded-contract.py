"""Keep evaluation vocabulary out of the packages seeded into a model's workspace.

The engines and runtimes are vendored into a run's workspace with their whole
dependency closure, where the model building the case reads every byte.
scripts/ci/seeded-contract-check.sh greps them for this project's name and for
words about how a run is judged, and fails when the closure reaches the run-record
contract. The closure's generated `@clockwyrks/asset-contract` is the contracts
repository's, whose own tests hold it to the same vocabulary.
"""

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, run

enter_repo_root()

# The script finds the checkout with `git rev-parse`, so it must not inherit a
# commit hook's GIT_DIR (see GIT_LOCATION_VARIABLES).
if run(["scripts/ci/seeded-contract-check.sh"], unset=GIT_LOCATION_VARIABLES).returncode != 0:
    fail(
        "",
        "A seeded package names this project or how a run is judged. Reword the",
        "source (for the generated contract, the Rust doc comment) and regenerate.",
    )
