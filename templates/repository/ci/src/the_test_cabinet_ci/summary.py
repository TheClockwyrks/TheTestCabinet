"""`SUMMARY.md`: a gate run, for a reviewer to read in a minute.

The summary is built from `results.json`, the collected figures and, when the
run was compared with a baseline, the comparison. It names things and points at
files. A gate's output is never in it: that is what the log beside it is for.

The same inputs always give the same text, and the text passes the
repository's markdownlint configuration. Everything of unbounded width (a path,
a test's name) sits in a table, which the line-length rule leaves alone.
"""

from __future__ import annotations

import re
from pathlib import Path

from the_test_cabinet_ci.runner import LOG_FILE

# A check that fails wholesale can fail hundreds of tests. The count says how
# bad it is; the first few say where to start, and `metrics.json` has them all.
FAILING_TESTS_LISTED = 10
# The comparison is sorted worst first, so the head of each list is what matters.
FLAGS_LISTED = 20

_WHITESPACE = re.compile(r"\s+")


def _code(text: object) -> str:
    """A table cell holding text as a code span, whatever the text contains."""
    # A code span cannot hold a backtick without a longer fence, and a cell
    # cannot hold a bare pipe or a line break.
    flat = _WHITESPACE.sub(" ", str(text)).strip().replace("`", "'").replace("|", "\\|")
    return f"`{flat}`" if flat else "-"


def _table(header: list[str], rows: list[list[str]]) -> list[str]:
    lines = [f"| {' | '.join(header)} |", f"| {' | '.join('---' for _ in header)} |"]
    lines += [f"| {' | '.join(row)} |" for row in rows]
    return [*lines, ""]


def _listed(noun: str, total: int, limit: int) -> str:
    if total > limit:
        return f"{noun}: {total}, the first {limit} listed."
    return f"{noun}: {total}."


def _number(value: object, digits: int = 2) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{value:.{digits}f}"
    return "-"


def _tests_of(check: str, tests: dict[str, object]) -> dict[str, str]:
    """A check's tests and how each ended, keyed without the check's prefix."""
    prefix = f"{check}::"
    return {
        key[len(prefix) :]: str(case.get("status"))
        for key, case in tests.items()
        if key.startswith(prefix) and isinstance(case, dict)
    }


def render(
    results: dict[str, object],
    figures: dict[str, object],
    comparison: dict[str, object] | None,
    report_dir: Path,
    records: list[Path],
) -> str:
    """The summary's text.

    `results` is the run's `results.json` and `figures` its collected
    `metrics.json`; `comparison` is the `compare.json` against a baseline, or
    None when the run had none. `report_dir` is where the run was written, so
    that a check's log can be named by its absolute path. `records` are the
    files holding everything in full, which the summary ends by pointing at.
    """
    checks = [entry for entry in results.get("gates", []) if isinstance(entry, dict)]
    tests = figures.get("tests") if isinstance(figures.get("tests"), dict) else {}
    failed_checks = [entry for entry in checks if not entry.get("ok")]

    lines = ["# Gate run", ""]
    lines += [f"**{'Failed' if failed_checks else 'Passed'}.**"]
    lines += [f"Checks passed: {len(checks) - len(failed_checks)} of {len(checks)}.", ""]

    lines += ["## Checks", ""]
    rows = []
    for entry in checks:
        check = str(entry.get("id"))
        statuses = list(_tests_of(check, tests).values())
        ran = [status for status in statuses if status != "skipped"]
        rows.append(
            [
                _code(check),
                "passed" if entry.get("ok") else "failed",
                _number(entry.get("seconds")),
                # A check with no JUnit report ran no tests anybody can count.
                str(len(ran)) if statuses else "-",
                str(ran.count("failed")) if statuses else "-",
                _code(report_dir / check / LOG_FILE),
            ]
        )
    lines += _table(["Check", "Status", "Seconds", "Tests run", "Tests failed", "Log"], rows)

    if failed_checks:
        lines += ["## Failed checks", ""]
    for entry in failed_checks:
        check = str(entry.get("id"))
        failing = sorted(name for name, status in _tests_of(check, tests).items() if status == "failed")
        lines += [f"### {_code(check)}", ""]
        if not failing:
            lines += [f"Exit code {entry.get('exit_code')}, and no failing test on record. The log has why.", ""]
            continue
        lines += [_listed("Failing tests", len(failing), FAILING_TESTS_LISTED), ""]
        lines += _table(["Test"], [[_code(name)] for name in failing[:FAILING_TESTS_LISTED]])

    lines += ["## Worth a look", ""]
    if comparison is None:
        lines += ["The run was compared with no baseline.", ""]
    else:
        slower = [entry for entry in comparison.get("slower", []) if isinstance(entry, dict)]
        drops = [entry for entry in comparison.get("coverage", []) if isinstance(entry, dict)]
        if not slower and not drops:
            lines += ["Against the baseline, nothing got slower by the threshold and no coverage fell.", ""]
        if slower:
            lines += [_listed("Slower than the baseline", len(slower), FLAGS_LISTED), ""]
            lines += _table(
                ["Kind", "Name", "Baseline seconds", "Seconds", "Ratio"],
                [
                    [
                        "check" if entry.get("kind") == "gate" else "test",
                        _code(entry.get("name")),
                        _number(entry.get("base_seconds")),
                        _number(entry.get("head_seconds")),
                        _number(entry.get("ratio")),
                    ]
                    for entry in slower[:FLAGS_LISTED]
                ],
            )
        if drops:
            lines += [_listed("Coverage decreases", len(drops), FLAGS_LISTED), ""]
            lines += _table(
                ["Check", "Scope", "Metric", "Baseline %", "%"],
                [
                    [
                        _code(entry.get("gate")),
                        _code(entry.get("scope")),
                        str(entry.get("metric")),
                        _number(entry.get("base")),
                        _number(entry.get("head")),
                    ]
                    for entry in drops[:FLAGS_LISTED]
                ],
            )

    lines += ["## Full records", ""]
    lines += _table(["File", "Path"], [[_code(path.name), _code(path)] for path in records])

    # One newline ends the file: every block above closed with a blank line.
    return "\n".join(lines[:-1]) + "\n"
