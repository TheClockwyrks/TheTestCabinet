"""The library under the gates: process helpers, the runner, the metrics.

A gate script under ``ci/gates/`` imports what it needs from here:

    from the_test_cabinet_ci import artifacts_dir, enter_repo_root, fail, run, succeeded

The runner (``gate``) and the metrics (``metrics``) are the two commands the
project installs; see ``gate_cli`` and ``metrics_cli``.
"""

from the_test_cabinet_ci.proc import (
    ARTIFACTS_ENV,
    GIT_LOCATION_VARIABLES,
    artifacts_dir,
    enter_repo_root,
    fail,
    git,
    git_environment,
    repo_root,
    require_tool,
    run,
    say,
    skip,
    succeeded,
)

__all__ = [
    "ARTIFACTS_ENV",
    "GIT_LOCATION_VARIABLES",
    "artifacts_dir",
    "enter_repo_root",
    "fail",
    "git",
    "git_environment",
    "repo_root",
    "require_tool",
    "run",
    "say",
    "skip",
    "succeeded",
]
