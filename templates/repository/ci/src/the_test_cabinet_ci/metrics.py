"""Turning a gate report into figures, and comparing two sets of figures.

`collect` reads what `gate run --report-dir` left behind. `compare` sets a
branch's figures beside its baseline's and lists what got slower and what lost
coverage. The list is input for a reviewer: nothing here passes or fails.
`write_report` does both for a report directory and ends with its `SUMMARY.md`.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from the_test_cabinet_ci import coverage, junit, summary
from the_test_cabinet_ci.runner import RESULTS_FILE

JUNIT_FILE = "junit.xml"
METRICS_FILE = "metrics.json"
COMPARE_FILE = "compare.json"
SUMMARY_FILE = "SUMMARY.md"


class UnreadableMetrics(Exception):
    """A report directory or a metrics file that cannot be read."""


def _load(path: Path) -> dict[str, object]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise UnreadableMetrics(f"{path}: {error}") from error
    if not isinstance(data, dict):
        raise UnreadableMetrics(f"{path}: expected a JSON object")
    return data


def collect(
    report_dir: Path,
    root: Callable[[], Path],
    warn: Callable[[str], None] = lambda message: None,
) -> dict[str, object]:
    """The figures in a report directory: gate times, test times, coverage.

    Coverage paths are made relative to the checkout the gates ran in, which
    the report records; `root` answers for a report that does not.

    A gate that died while writing its results leaves a file nobody can read.
    That gate has already failed in `results.json`, so its file is warned about
    and left out rather than costing every other gate its figures.
    """
    report_dir = report_dir.resolve()
    results = _load(report_dir / RESULTS_FILE)
    entries = results.get("gates")
    if not isinstance(entries, list):
        raise UnreadableMetrics(f"{report_dir / RESULTS_FILE}: no list of gates")

    gates: dict[str, object] = {}
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
            raise UnreadableMetrics(f"{report_dir / RESULTS_FILE}: a gate entry has no id")
        gates[entry["id"]] = {"seconds": float(entry.get("seconds") or 0.0), "ok": bool(entry.get("ok"))}

    recorded = results.get("root")
    checkout = Path(recorded) if isinstance(recorded, str) and recorded else root()

    tests: dict[str, object] = {}
    covered: dict[str, object] = {}
    for gate in sorted(gates):
        # A gate's folder is found by name under the report, and not by the
        # absolute path `results.json` holds, so a report that was moved or
        # downloaded still reads.
        directory = report_dir / gate
        report = directory / JUNIT_FILE
        if report.is_file():
            try:
                for key, case in junit.parse(report).items():
                    tests[f"{gate}::{key}"] = case.as_json()
            except junit.UnreadableReport as error:
                warn(str(error))
        try:
            figures = coverage.parse_dir(directory, checkout)
        except coverage.UnreadableCoverage as error:
            warn(str(error))
        else:
            if figures is not None:
                covered[gate] = figures

    return {"gates": gates, "tests": dict(sorted(tests.items())), "coverage": covered}


def load_metrics(path: Path) -> dict[str, object]:
    data = _load(path)
    for section in ("gates", "tests", "coverage"):
        if not isinstance(data.setdefault(section, {}), dict):
            raise UnreadableMetrics(f"{path}: `{section}` is not an object")
    return data


def _number(value: object) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def _slower(kind: str, base: dict, head: dict, ratio: float, min_seconds: float) -> list[dict[str, object]]:
    flagged = []
    for name, now in head.items():
        before = base.get(name)
        # No baseline, nothing to be slower than.
        if not isinstance(before, dict) or not isinstance(now, dict):
            continue
        # A skipped test took no time, so on either side it says nothing.
        if "skipped" in (before.get("status"), now.get("status")):
            continue
        base_seconds, head_seconds = _number(before.get("seconds")), _number(now.get("seconds"))
        if base_seconds is None or head_seconds is None:
            continue
        if head_seconds >= min_seconds and head_seconds >= base_seconds * ratio:
            flagged.append(
                {
                    "kind": kind,
                    "name": name,
                    "base_seconds": base_seconds,
                    "head_seconds": head_seconds,
                    # A baseline of zero has no ratio; it sorts as the worst.
                    "ratio": round(head_seconds / base_seconds, 3) if base_seconds > 0 else None,
                }
            )
    return flagged


def _drops(gate: str, scope: str, base: object, head: object, epsilon: float) -> list[dict[str, object]]:
    if not isinstance(base, dict) or not isinstance(head, dict):
        return []
    flagged = []
    for metric in coverage.METRICS:
        before, now = _number(base.get(metric)), _number(head.get(metric))
        # Rounded, so that 81.2 against 81.1 is the 0.1 it reads as and not the
        # hair more that binary floats make of it.
        if before is not None and now is not None and round(before - now, 6) > epsilon:
            flagged.append({"gate": gate, "scope": scope, "metric": metric, "base": before, "head": now})
    return flagged


def compare(
    base: dict[str, object],
    head: dict[str, object],
    *,
    ratio: float = 1.5,
    min_seconds: float = 1.0,
    coverage_epsilon: float = 0.1,
) -> dict[str, object]:
    """What got slower and what lost coverage between two sets of figures.

    Slower: at least `min_seconds` now, and at least `ratio` times the
    baseline. The floor keeps the noise of a fast test out. Coverage: down by
    more than `coverage_epsilon` percentage points, for the whole and for each
    file both sides have. Both lists are sorted worst first.
    """
    base_tests, head_tests = base["tests"], head["tests"]
    slower = _slower("gate", base["gates"], head["gates"], ratio, min_seconds)
    slower += _slower("test", base_tests, head_tests, ratio, min_seconds)
    slower.sort(
        key=lambda entry: (
            -(entry["ratio"] if entry["ratio"] is not None else float("inf")),
            -entry["head_seconds"],
            entry["kind"],
            entry["name"],
        )
    )

    drops: list[dict[str, object]] = []
    for gate, now in head["coverage"].items():
        before = base["coverage"].get(gate)
        if not isinstance(before, dict) or not isinstance(now, dict):
            continue
        drops += _drops(gate, "total", before.get("total"), now.get("total"), coverage_epsilon)
        base_files, head_files = before.get("files") or {}, now.get("files") or {}
        for name in head_files:
            if name in base_files:
                drops += _drops(gate, name, base_files[name], head_files[name], coverage_epsilon)
    # The largest fall first. Among equal falls a gate's total leads its files.
    drops.sort(
        key=lambda entry: (
            round(entry["head"] - entry["base"], 6),
            entry["gate"],
            entry["scope"] != "total",
            entry["scope"],
            entry["metric"],
        )
    )

    return {
        "slower": slower,
        "coverage": drops,
        "new_tests": sum(1 for name in head_tests if name not in base_tests),
        "removed_tests": sum(1 for name in base_tests if name not in head_tests),
    }


def report_files(report_dir: Path, *, compared: bool) -> dict[str, Path]:
    """What `write_report` leaves in a report directory, by its key in `results.json`."""
    report_dir = report_dir.resolve()
    files = {"summary": report_dir / SUMMARY_FILE, "metrics": report_dir / METRICS_FILE}
    if compared:
        files["compare"] = report_dir / COMPARE_FILE
    return files


def _write_json(path: Path, data: dict[str, object]) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def write_report(
    report_dir: Path,
    root: Callable[[], Path],
    warn: Callable[[str], None] = lambda message: None,
    *,
    baseline: dict[str, object] | None = None,
    keep_comparison: bool = False,
) -> dict[str, Path]:
    """Finish a report directory: `metrics.json`, `compare.json`, `SUMMARY.md`.

    The comparison is made against `baseline`, a loaded set of figures. With
    none, a comparison found in the directory is some earlier run's and is
    removed, unless `keep_comparison` says the summary is being written again
    for the run that made it. Returns what the directory holds afterwards.
    """
    report_dir = report_dir.resolve()
    results = _load(report_dir / RESULTS_FILE)
    figures = collect(report_dir, root, warn)
    _write_json(report_dir / METRICS_FILE, figures)

    written = report_dir / COMPARE_FILE
    comparison: dict[str, object] | None = None
    if baseline is not None:
        comparison = compare(baseline, load_metrics(report_dir / METRICS_FILE))
        _write_json(written, comparison)
    elif keep_comparison and written.is_file():
        comparison = _load(written)
    else:
        written.unlink(missing_ok=True)

    files = report_files(report_dir, compared=comparison is not None)
    records = [report_dir / RESULTS_FILE, *(path for key, path in files.items() if key != "summary")]
    files["summary"].write_text(summary.render(results, figures, comparison, report_dir, records), encoding="utf-8")
    return files
