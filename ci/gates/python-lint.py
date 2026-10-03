"""Lint and check the formatting of the Python every uv project is written in.

ruff is one tool doing the two jobs the Rust and the web trees split over
several: the lint (`ruff check`) and the format (`ruff format --check`). It is
a dev dependency of the `ci` project, so the interpreter running this gate has
it, and the settings it reads are in ci/pyproject.toml, which every other uv
project's own pyproject.toml extends. Every project is therefore held to the
same rules from one place.

The paths are named here rather than left to ruff's own discovery: the uv
projects are this workspace's Python, and a scratch checkout under `tmp/` or a
submodule with gates of its own is not. `ci/tests/test_gates.py` holds this
list to every uv project the workspace holds.
"""

import sys

from the_test_cabinet_ci import enter_repo_root, fail, succeeded

# From the workspace root, so ruff finds each project's pyproject.toml
# regardless of the caller's working directory.
enter_repo_root()

# `ci/` alone, as the template renders it. A project keeping Python in a uv
# project of its own adds its path here and to the hook's `files` in
# .pre-commit-config.yaml, and a template update carries both edits.
PROJECTS = ["ci"]

# The gate runs in the `ci` project's environment, which carries ruff, so the
# interpreter running this script runs it.
ruff = [sys.executable, "-m", "ruff"]

lint = succeeded([*ruff, "check", *PROJECTS])
# Both run before the verdict: a formatting complaint and a lint complaint are
# reported together rather than one commit at a time.
formatted = succeeded([*ruff, "format", "--check", *PROJECTS])

if not lint or not formatted:
    fail(
        "",
        "ruff is not satisfied with the Python. Fix it with:",
        "    uv run --project ci ruff check --fix " + " ".join(PROJECTS),
        "    uv run --project ci ruff format " + " ".join(PROJECTS),
    )
