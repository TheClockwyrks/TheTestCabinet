"""Run the Rust test suite with cargo nextest.

nextest is the test runner here: `.config/nextest.toml` holds the retries, the
no-fail-fast rule and the per-test hard timeout, none of which the built-in
runner has.

Asked for artifacts, the run uses the `ci` profile, which inherits the default
one and also writes a JUnit report. Coverage is deliberately left alone: it
costs a second, instrumented compilation of the workspace.

Inside the superrepo the patch table makes cargo write the lock's
`[[patch.unused]]` block in an order that is not stable between runs, so the
build runs without `--locked` (`lockfile.locked_arguments`), the
`dependency-graph` gate is what holds the lock to the checkouts, and a lock
the build merely reordered is put back as it was (`lockfile.keep_lock_order`).
"""

import shutil

from the_test_cabinet_ci import artifacts_dir, enter_repo_root, fail, run
from the_test_cabinet_ci.lockfile import keep_lock_order, locked_arguments, superrepo_locks

# From the workspace root, so cargo resolves the workspace regardless of the
# caller's working directory.
root = enter_repo_root()

command = ["cargo", "nextest", "run", *locked_arguments(root), "--workspace"]
artifacts = artifacts_dir()
# nextest keeps its reports under the checkout (its `store.dir` is relative to
# the workspace root), and not under cargo's target directory.
report = root / "target" / "nextest" / "ci" / "junit.xml"
if artifacts is not None:
    command += ["--profile", "ci"]
    # A run that dies before its first test leaves the report of the run before
    # it in place, and that one must not be taken for this run's.
    report.unlink(missing_ok=True)

with keep_lock_order(superrepo_locks(root)):
    status = run(command).returncode

if artifacts is not None and report.is_file():
    shutil.copyfile(report, artifacts / "junit.xml")

if status != 0:
    fail("", "The Rust tests failed. Fix them, then run this gate again.")
