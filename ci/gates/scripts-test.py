"""script library tests (node --test).

The repository's Node scripts keep their logic in `scripts/lib/`, and each
module there has a `*.test.mjs` beside it; a script at `scripts/` with a test of
its own (stage-tcab-packages.mjs) has one beside it too. The root `test:scripts`
script runs them all with Node's own test runner, which needs no install beyond
Node.

Asked for artifacts, the runner also writes a JUnit report. The reporters are
handed to it through `NODE_OPTIONS`, because the script names its files before
any flag npm could append, and Node reads a flag after the files as the tests'
own argument. Node's JUnit reporter labels every case `test`, so two files with a
test of the same name would read as one test run twice: each case is relabelled
with the file it is in and the suites it is nested in before the report is kept.
"""

import os
import xml.etree.ElementTree as ET
from pathlib import Path

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, artifacts_dir, enter_repo_root, fail, run, say

# From the workspace root, so the script's file pattern finds the tests
# regardless of the caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")


def relabel(report: Path) -> None:
    """Name each case's `classname` after its file and its enclosing suites."""
    tree = ET.parse(report)

    def visit(element: ET.Element, suites: list[str]) -> None:
        for child in element:
            if child.tag == "testsuite":
                visit(child, [*suites, child.get("name") or ""])
            elif child.tag == "testcase":
                file = child.get("file") or ""
                where = os.path.relpath(file, root) if file else "scripts"
                child.set("classname", "/".join([Path(where).as_posix(), *suites]))

    visit(tree.getroot(), [])
    tree.write(report, encoding="utf-8", xml_declaration=True)


artifacts = artifacts_dir()
environment: dict[str, str] = {}
if artifacts is not None:
    reporters = (
        "--test-reporter=spec --test-reporter-destination=stdout "
        f"--test-reporter=junit --test-reporter-destination={artifacts / 'junit.xml'}"
    )
    environment["NODE_OPTIONS"] = f"{os.environ.get('NODE_OPTIONS', '')} {reporters}".strip()

ran = run(["npm", "run", "--silent", "test:scripts"], env=environment, unset=GIT_LOCATION_VARIABLES)

if artifacts is not None and (artifacts / "junit.xml").is_file():
    relabel(artifacts / "junit.xml")

if ran.returncode != 0:
    fail(
        "",
        "The script library's tests failed. Reproduce them with:",
        "    npm run test:scripts",
    )

say("The script library's tests pass.")
