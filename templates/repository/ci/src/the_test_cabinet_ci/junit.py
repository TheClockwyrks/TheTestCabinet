"""Reading a JUnit report, as nextest, vitest, pytest and node each write one.

They agree on the parts read here: `testcase` elements under `testsuite`
elements, each with a `name`, a `classname` and a `time` in seconds, and a child
element saying how a case that did not pass ended.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

PASSED = "passed"
FAILED = "failed"
SKIPPED = "skipped"

# When one key is reported twice, the status kept is the one that matters most
# to somebody reading the metrics.
_SEVERITY = {SKIPPED: 0, PASSED: 1, FAILED: 2}

# nextest records each earlier attempt of a retried test as one of these, under
# the case that holds the final attempt, each with a `time` of its own.
_ATTEMPTS = ("flakyFailure", "flakyError", "rerunFailure", "rerunError")


class UnreadableReport(Exception):
    """The file is absent, or is not a JUnit report."""


@dataclass(frozen=True)
class Case:
    seconds: float
    status: str

    def as_json(self) -> dict[str, object]:
        return {"seconds": self.seconds, "status": self.status}


def _seconds(text: str | None) -> float:
    if not text:
        return 0.0
    try:
        # A report written under some locales groups thousands with a comma.
        return max(float(text.replace(",", "")), 0.0)
    except ValueError:
        return 0.0


def _status(case: ET.Element) -> str:
    if case.find("failure") is not None or case.find("error") is not None:
        return FAILED
    if case.find("skipped") is not None:
        return SKIPPED
    return PASSED


def parse(path: Path) -> dict[str, Case]:
    """The report's cases, keyed `<classname>::<name>`.

    A key that appears more than once keeps its longest duration: that is the
    figure a slowdown shows in, and the one a retry would otherwise hide.

    A repeated key is therefore read as one test reported twice. Whether it is
    one is the test tool's to say, so a gate configures its tool to label each
    case with something that tells it apart from the rest of the run; see
    "Artifacts" in ci/README.md for the two that had to be told.
    """
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError) as error:
        raise UnreadableReport(f"{path}: {error}") from error

    cases: dict[str, Case] = {}
    # `iter` reaches the root itself, a lone `testsuite`, and suites nested in
    # suites alike; each case is then read once, from its own suite. node's
    # reporter also puts a test that is in no `describe` straight under the
    # `testsuites` root, which is read as one more suite.
    suites = list(root.iter("testsuite"))
    if root.tag == "testsuites":
        suites.append(root)
    for suite in suites:
        for element in suite.findall("testcase"):
            classname = element.get("classname") or suite.get("name") or ""
            key = f"{classname}::{element.get('name') or ''}"
            seconds = max(
                [_seconds(element.get("time"))]
                + [_seconds(attempt.get("time")) for tag in _ATTEMPTS for attempt in element.findall(tag)]
            )
            status = _status(element)
            seen = cases.get(key)
            if seen is not None:
                seconds = max(seconds, seen.seconds)
                status = max(status, seen.status, key=_SEVERITY.__getitem__)
            cases[key] = Case(round(seconds, 6), status)
    return cases
