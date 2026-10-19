"""Run every *.test.sh under scripts/, each driving its script through stubs.

Every `*.test.sh` under `scripts/`, `scripts/ci/` and `scripts/repos/` runs
(the last is this project's: the repository scripts), and so does the gg
checkout's `scripts/ci/gg-image-toolchains.test.sh` where `gg/` is checked out:
it holds the language-image tags this repository's devcontainer compose file
names to gg's pins, and gg's own pipeline never sees that file. A failure does
not stop the ones after it: a run names every test that failed rather than the
first one, which is what makes one run enough to see the whole picture. Each
test drives its script through stubs of the tools it calls, so none reaches a
container runtime, a registry or a cluster.
"""

from pathlib import Path

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, run, say, skip

# From the workspace root, so each test resolves its script beside it and the
# names printed below are the ones a developer types back.
enter_repo_root()

tests = [
    test
    for directory in ("scripts", "scripts/ci", "scripts/repos")
    for test in sorted(Path(directory).glob("*.test.sh"))
]
# The devcontainer's language images against gg's pins, from the gg checkout,
# which reads this repository's compose file beside it.
GG_IMAGE_TOOLCHAINS = Path("gg/scripts/ci/gg-image-toolchains.test.sh")
if GG_IMAGE_TOOLCHAINS.is_file():
    tests.append(GG_IMAGE_TOOLCHAINS)
else:
    say(f"gg/ is not checked out, so {GG_IMAGE_TOOLCHAINS} does not run")
if not tests:
    skip("No shell tests under scripts/.")

failed: list[str] = []
for test in tests:
    say("", f"=== {test} ===")
    # The path holds a slash, so it is executed relative to the workspace root
    # rather than looked up on PATH. The fixtures run git in throwaway
    # repositories, so a commit hook's GIT_DIR must not reach them: from a
    # linked worktree it names the real repository, which they would rewrite.
    if run([str(test)], unset=GIT_LOCATION_VARIABLES).returncode != 0:
        failed.append(str(test))

say("", "=== shell tests ===")
if failed:
    fail(
        f"failed: {' '.join(failed)}",
        "Run a failing test on its own to see its cases:",
        f"    {failed[0]}",
    )
say(f"all {len(tests)} shell tests passed")
