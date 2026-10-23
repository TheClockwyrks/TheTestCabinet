"""Run the tests of the gate runner and the metrics (pytest over ci/).

The gate already runs in the `ci` project's environment, which carries pytest
through the `dev` group, so the interpreter running this script runs the tests.
"""

import sys

from the_test_cabinet_ci import artifacts_dir, enter_repo_root, fail, succeeded

root = enter_repo_root()

command = [sys.executable, "-m", "pytest"]
artifacts = artifacts_dir()
if artifacts is not None:
    command.append(f"--junit-xml={artifacts / 'junit.xml'}")

# From the project's own folder, so pytest reads its pyproject.toml.
if not succeeded(command, cwd=root / "ci"):
    fail("", "The ci tests failed. Fix them, then run this gate again.")
