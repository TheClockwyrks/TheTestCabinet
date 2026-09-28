"""npm workspace tests (vitest).

Every npm workspace with a `test` script runs its suite here, except two that
have gates of their own: `apps/web`, whose jsdom and browser projects are
`web-test` and `web-browser-test`, and `apps/docs`, which `docs-typecheck` and
`docs-build` answer for. The shared UI library, the engines, the runtimes, the
statistics, the case harness and the lattice designer are all in it, and so is
the recording parity suite in `packages/ui`, which holds the console's copy of
each engine's recording contract to what that engine writes.

The workspace packages are consumed from their builds, so `build:packages` runs
first: a suite importing `@clockwyrks/run-record` or an engine reads its
`dist/`, which a fresh checkout does not have.

Every workspace runs even after one fails, and each failure is named at the
end. Asked for artifacts, each suite adds vitest's JUnit report, and the reports
are merged into the one `junit.xml` the metrics read. vitest labels a case with
its file's path inside its own workspace, where two workspaces can hold the same
path, so each case is prefixed with its workspace's directory as it is merged.
"""

import json
import xml.etree.ElementTree as ET
from pathlib import Path

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, artifacts_dir, enter_repo_root, fail, run, say

# The workspaces whose suites belong to other gates, named above.
OWN_GATES = {"apps/web", "apps/docs"}

# From the workspace root, so npm finds the workspaces regardless of the
# caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")


def workspaces() -> list[str]:
    """The workspace directories with a `test` script, in a stable order."""
    patterns = json.loads((root / "package.json").read_text(encoding="utf-8"))["workspaces"]
    found = []
    for pattern in patterns:
        for manifest in sorted(root.glob(f"{pattern}/package.json")):
            directory = manifest.parent.relative_to(root).as_posix()
            scripts = json.loads(manifest.read_text(encoding="utf-8")).get("scripts", {})
            if directory not in OWN_GATES and "test" in scripts:
                found.append(directory)
    return found


def merge(reports: dict[str, Path], into: Path) -> None:
    """One `testsuites` report of every workspace's, each case under its workspace."""
    merged = ET.Element("testsuites", name="workspace-test")
    for directory, report in reports.items():
        if not report.is_file():
            continue
        parsed = ET.parse(report).getroot()
        suites = [parsed] if parsed.tag == "testsuite" else parsed.findall("testsuite")
        for suite in suites:
            for case in suite.iter("testcase"):
                case.set("classname", f"{directory}/{case.get('classname') or suite.get('name') or ''}")
            merged.append(suite)
        report.unlink()
    ET.ElementTree(merged).write(into, encoding="utf-8", xml_declaration=True)


if run(["npm", "run", "--silent", "build:packages"], unset=GIT_LOCATION_VARIABLES).returncode != 0:
    fail(
        "",
        "The workspace packages do not build, so no suite can import them. Reproduce it with:",
        "    npm run build:packages",
    )

artifacts = artifacts_dir()
reports: dict[str, Path] = {}
failed: list[str] = []
for directory in workspaces():
    say("", f"== {directory}")
    extra: list[str] = []
    if artifacts is not None:
        reports[directory] = artifacts / f"junit.{directory.replace('/', '-')}.xml"
        extra = ["--", "--reporter=default", "--reporter=junit", f"--outputFile.junit={reports[directory]}"]
    ran = run(["npm", "run", "--silent", "--workspace", directory, "test", *extra], unset=GIT_LOCATION_VARIABLES)
    if ran.returncode != 0:
        failed.append(directory)

if artifacts is not None:
    merge(reports, artifacts / "junit.xml")

if failed:
    fail(
        "",
        "These workspaces' tests failed. Reproduce each with:",
        *(f"    npm run --workspace {directory} test" for directory in failed),
    )

say("", "Every workspace's tests pass.")
