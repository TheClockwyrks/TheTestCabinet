"""Reading a coverage report: istanbul's `json-summary`, or lcov.

Both come out as the same shape, percentages per metric for the whole and for
each file, with file paths relative to the repository root so that a report
made in one checkout compares with one made in another.
"""

from __future__ import annotations

import json
import os
from pathlib import Path, PurePosixPath

METRICS = ("lines", "branches", "functions", "statements")

SUMMARY_FILE = "coverage-summary.json"
LCOV_FILE = "lcov.info"

Percentages = dict[str, float]


class UnreadableCoverage(Exception):
    """The file is absent, or is not the report its name says it is."""


def relative_to_root(path: str, root: Path) -> str:
    """The path as the repository names it, when it is inside the repository.

    Anything else is returned as it came, with forward slashes: a relative path
    has no checkout in it to remove, and a path outside the checkout is not
    ours to rename.
    """
    if not Path(path).is_absolute():
        return PurePosixPath(Path(path)).as_posix()
    # The tool and git may disagree about a symlink on the way to the checkout,
    # so the path is tried as written and then resolved.
    for candidate in (Path(path), Path(os.path.realpath(path))):
        for base in (root, Path(os.path.realpath(root))):
            try:
                return candidate.relative_to(base).as_posix()
            except ValueError:
                continue
    return Path(path).as_posix()


def _report(total: Percentages, files: dict[str, Percentages]) -> dict[str, object]:
    return {"total": total, "files": dict(sorted(files.items()))}


def _summary_percentages(entry: object) -> Percentages:
    percentages: Percentages = {}
    if not isinstance(entry, dict):
        return percentages
    for metric in METRICS:
        figure = entry.get(metric)
        pct = figure.get("pct") if isinstance(figure, dict) else None
        # istanbul writes "Unknown" for a metric with nothing to cover.
        if isinstance(pct, (int, float)) and not isinstance(pct, bool):
            percentages[metric] = float(pct)
    return percentages


def parse_summary(path: Path, root: Path) -> dict[str, object]:
    """Read istanbul's `json-summary`: a `total` entry, then one per file."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise UnreadableCoverage(f"{path}: {error}") from error
    if not isinstance(data, dict):
        raise UnreadableCoverage(f"{path}: not a json-summary report")
    files = {
        relative_to_root(name, root): _summary_percentages(entry) for name, entry in data.items() if name != "total"
    }
    return _report(_summary_percentages(data.get("total")), files)


# The lcov record lines that carry a metric: found, then hit.
_LCOV_COUNTS = {
    "LF": ("lines", 0),
    "LH": ("lines", 1),
    "BRF": ("branches", 0),
    "BRH": ("branches", 1),
    "FNF": ("functions", 0),
    "FNH": ("functions", 1),
}


def _pct(found: int, hit: int) -> float:
    # Nothing to cover counts as covered, which is how istanbul reports it.
    return 100.0 if found <= 0 else round(hit * 100.0 / found, 2)


def parse_lcov(path: Path, root: Path) -> dict[str, object]:
    """Read an lcov tracefile. It has no statement metric, so none is reported.

    A metric is reported for a file only when the record names it: a tool that
    collects no branch data writes no `BRF`, and that is absence, not 100%.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise UnreadableCoverage(f"{path}: {error}") from error

    files: dict[str, Percentages] = {}
    totals: dict[str, list[int]] = {}
    name: str | None = None
    counts: dict[str, list[int]] = {}
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("SF:"):
            name, counts = line[3:], {}
        elif line == "end_of_record":
            if name is not None:
                files[relative_to_root(name, root)] = {m: _pct(*counts[m]) for m in METRICS if m in counts}
                for metric, (found, hit) in counts.items():
                    total = totals.setdefault(metric, [0, 0])
                    total[0] += found
                    total[1] += hit
            name = None
        elif name is not None and ":" in line:
            tag, _, value = line.partition(":")
            if tag in _LCOV_COUNTS:
                metric, index = _LCOV_COUNTS[tag]
                try:
                    counts.setdefault(metric, [0, 0])[index] = int(value)
                except ValueError:
                    raise UnreadableCoverage(f"{path}: bad count in {line!r}") from None
    if not files:
        raise UnreadableCoverage(f"{path}: no lcov records")
    return _report({m: _pct(*totals[m]) for m in METRICS if m in totals}, files)


def parse_dir(artifacts: Path, root: Path) -> dict[str, object] | None:
    """The coverage a gate left in its artifact directory, or None for none."""
    summary = artifacts / SUMMARY_FILE
    if summary.is_file():
        return parse_summary(summary, root)
    lcov = artifacts / LCOV_FILE
    if lcov.is_file():
        return parse_lcov(lcov, root)
    return None
