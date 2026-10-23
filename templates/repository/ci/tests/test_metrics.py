"""Collecting a report's figures, and every rule `compare` applies."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from the_test_cabinet_ci import metrics


def _report(tmp_path: Path, root: Path | None, gates: list[dict[str, object]]) -> Path:
    report_dir = tmp_path / "report"
    report_dir.mkdir()
    results: dict[str, object] = {"ok": all(g["ok"] for g in gates), "report_dir": str(report_dir), "gates": gates}
    if root is not None:
        results["root"] = str(root)
    (report_dir / "results.json").write_text(json.dumps(results), encoding="utf-8")
    return report_dir


def _gate(gate_id: str, seconds: float, ok: bool = True) -> dict[str, object]:
    # The paths of another machine: collecting must not depend on them.
    return {
        "id": gate_id,
        "ok": ok,
        "exit_code": 0 if ok else 1,
        "seconds": seconds,
        "log": f"/elsewhere/{gate_id}/output.log",
        "artifacts": f"/elsewhere/{gate_id}",
    }


def _no_root() -> Path:
    raise AssertionError("the report names its checkout, so nothing should ask for one")


# collect


def test_collect(tmp_path: Path) -> None:
    root = tmp_path / "checkout"
    report_dir = _report(tmp_path, root, [_gate("rust-test", 84.2), _gate("web-test", 12.5, ok=False), _gate("fmt", 1)])
    rust = report_dir / "rust-test"
    rust.mkdir()
    (rust / "junit.xml").write_text(
        '<testsuites><testsuite name="crate"><testcase classname="crate" name="mod::name" time="0.41"/>'
        "</testsuite></testsuites>",
        encoding="utf-8",
    )
    web = report_dir / "web-test"
    web.mkdir()
    (web / "junit.xml").write_text(
        '<testsuites><testsuite name="s"><testcase classname="src/x.test.ts" name="x &gt; works" time="0.002">'
        "<failure/></testcase></testsuite></testsuites>",
        encoding="utf-8",
    )
    figure = {"total": 1, "covered": 1, "skipped": 0, "pct": 90}
    (web / "coverage-summary.json").write_text(
        json.dumps({"total": {"lines": figure}, str(root / "apps/web/src/x.ts"): {"lines": figure}}),
        encoding="utf-8",
    )
    (report_dir / "fmt").mkdir()

    assert metrics.collect(report_dir, _no_root) == {
        "gates": {
            "rust-test": {"seconds": 84.2, "ok": True},
            "web-test": {"seconds": 12.5, "ok": False},
            "fmt": {"seconds": 1.0, "ok": True},
        },
        "tests": {
            "rust-test::crate::mod::name": {"seconds": 0.41, "status": "passed"},
            "web-test::src/x.test.ts::x > works": {"seconds": 0.002, "status": "failed"},
        },
        "coverage": {"web-test": {"total": {"lines": 90.0}, "files": {"apps/web/src/x.ts": {"lines": 90.0}}}},
    }


def test_collect_asks_for_the_checkout_when_the_report_names_none(tmp_path: Path) -> None:
    root = tmp_path / "checkout"
    report_dir = _report(tmp_path, None, [_gate("web-test", 3)])
    artifacts = report_dir / "web-test"
    artifacts.mkdir()
    (artifacts / "lcov.info").write_text(f"SF:{root}/src/a.ts\nLF:4\nLH:1\nend_of_record\n", encoding="utf-8")
    collected = metrics.collect(report_dir, lambda: root)
    assert collected["coverage"] == {"web-test": {"total": {"lines": 25.0}, "files": {"src/a.ts": {"lines": 25.0}}}}


def test_collect_warns_about_an_unreadable_artifact_and_keeps_the_rest(tmp_path: Path) -> None:
    report_dir = _report(tmp_path, tmp_path, [_gate("died", 2, ok=False), _gate("fine", 1)])
    died = report_dir / "died"
    died.mkdir()
    (died / "junit.xml").write_text("<testsuites><testsuite", encoding="utf-8")
    (died / "coverage-summary.json").write_text("{", encoding="utf-8")
    fine = report_dir / "fine"
    fine.mkdir()
    (fine / "junit.xml").write_text(
        '<testsuite name="s"><testcase classname="c" name="n" time="1"/></testsuite>', encoding="utf-8"
    )
    warnings: list[str] = []
    collected = metrics.collect(report_dir, _no_root, warnings.append)
    assert list(collected["tests"]) == ["fine::c::n"]
    assert collected["coverage"] == {}
    assert len(warnings) == 2 and all("died" in warning for warning in warnings)


@pytest.mark.parametrize("results", [None, "{", "[]", '{"gates": 3}', '{"gates": [{"ok": true}]}'])
def test_collect_without_readable_results_fails(tmp_path: Path, results: str | None) -> None:
    if results is not None:
        (tmp_path / "results.json").write_text(results, encoding="utf-8")
    with pytest.raises(metrics.UnreadableMetrics):
        metrics.collect(tmp_path, _no_root)


# compare


def _figures(
    tests: dict[str, object] | None = None,
    gates: dict[str, float] | None = None,
    coverage: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "gates": {name: {"seconds": seconds, "ok": True} for name, seconds in (gates or {}).items()},
        "tests": {
            name: value if isinstance(value, dict) else {"seconds": value, "status": "passed"}
            for name, value in (tests or {}).items()
        },
        "coverage": coverage or {},
    }


def _names(comparison: dict[str, object]) -> list[str]:
    return [entry["name"] for entry in comparison["slower"]]


def test_slower_needs_both_the_ratio_and_the_floor() -> None:
    base = _figures({"at-ratio": 2.0, "under-ratio": 2.0, "fast": 0.01, "at-floor": 0.5, "faster": 9.0, "same": 5.0})
    head = _figures({"at-ratio": 3.0, "under-ratio": 2.99, "fast": 0.9, "at-floor": 1.0, "faster": 1.0, "same": 5.0})
    comparison = metrics.compare(base, head)
    assert comparison["slower"] == [
        {"kind": "test", "name": "at-floor", "base_seconds": 0.5, "head_seconds": 1.0, "ratio": 2.0},
        {"kind": "test", "name": "at-ratio", "base_seconds": 2.0, "head_seconds": 3.0, "ratio": 1.5},
    ]


def test_the_ratio_and_the_floor_are_the_callers() -> None:
    base, head = _figures({"a": 1.0, "b": 0.1}), _figures({"a": 1.2, "b": 0.3})
    assert _names(metrics.compare(base, head)) == []
    assert _names(metrics.compare(base, head, ratio=1.2)) == ["a"]
    assert _names(metrics.compare(base, head, min_seconds=0.2)) == ["b"]
    assert _names(metrics.compare(base, head, ratio=1.1, min_seconds=0.0)) == ["b", "a"]


def test_gates_are_compared_like_tests() -> None:
    comparison = metrics.compare(
        _figures(gates={"rust-test": 40.0, "fmt": 1.0}), _figures(gates={"rust-test": 80.0, "fmt": 1.1})
    )
    assert comparison["slower"] == [
        {"kind": "gate", "name": "rust-test", "base_seconds": 40.0, "head_seconds": 80.0, "ratio": 2.0}
    ]


def test_nothing_without_a_baseline_is_flagged() -> None:
    base = _figures({"kept": 1.0, "dropped": 1.0})
    head = _figures(
        {"kept": 1.0, "new-and-slow": 600.0},
        gates={"new-gate": 900.0},
        coverage={"new-gate": {"total": {"lines": 1.0}, "files": {"a.ts": {"lines": 1.0}}}},
    )
    assert metrics.compare(base, head) == {"slower": [], "coverage": [], "new_tests": 1, "removed_tests": 1}


def test_a_skipped_test_is_no_baseline_and_no_slowdown() -> None:
    skipped = {"seconds": 0.0, "status": "skipped"}
    base = _figures({"was-skipped": skipped, "now-skipped": 5.0})
    head = _figures({"was-skipped": 30.0, "now-skipped": {"seconds": 9.0, "status": "skipped"}})
    assert metrics.compare(base, head)["slower"] == []


def test_a_baseline_of_zero_has_no_ratio_and_sorts_first() -> None:
    comparison = metrics.compare(_figures({"zero": 0.0, "big": 1.0}), _figures({"zero": 2.0, "big": 100.0}))
    assert [(entry["name"], entry["ratio"]) for entry in comparison["slower"]] == [("zero", None), ("big", 100.0)]
    json.dumps(comparison)


def test_slower_is_sorted_worst_first() -> None:
    base = _figures({"x3": 1.0, "x10": 1.0, "x2-long": 50.0, "x2-short": 1.0}, gates={"x4": 10.0})
    head = _figures({"x3": 3.0, "x10": 10.0, "x2-long": 100.0, "x2-short": 2.0}, gates={"x4": 40.0})
    # By ratio, then by the time it takes now.
    assert _names(metrics.compare(base, head)) == ["x10", "x4", "x3", "x2-long", "x2-short"]


def _covered(total: dict[str, float], files: dict[str, dict[str, float]] | None = None) -> dict[str, object]:
    return {"web-test": {"total": total, "files": files or {}}}


def test_coverage_is_flagged_past_the_epsilon_only() -> None:
    base = _figures(coverage=_covered({"lines": 81.2, "branches": 70.0, "functions": 77.0, "statements": 80.0}))
    head = _figures(coverage=_covered({"lines": 81.1, "branches": 69.89, "functions": 78.0, "statements": 80.0}))
    # 81.2 to 81.1 is a fall of exactly the epsilon, which is within it.
    assert metrics.compare(base, head)["coverage"] == [
        {"gate": "web-test", "scope": "total", "metric": "branches", "base": 70.0, "head": 69.89}
    ]
    assert metrics.compare(base, head, coverage_epsilon=0.5)["coverage"] == []
    assert [entry["metric"] for entry in metrics.compare(base, head, coverage_epsilon=0.0)["coverage"]] == [
        "branches",
        "lines",
    ]


def test_coverage_per_file_only_for_files_on_both_sides() -> None:
    base = _figures(coverage=_covered({"lines": 80.0}, {"kept.ts": {"lines": 90.0}, "removed.ts": {"lines": 90.0}}))
    head = _figures(coverage=_covered({"lines": 80.0}, {"kept.ts": {"lines": 60.0}, "added.ts": {"lines": 0.0}}))
    assert metrics.compare(base, head)["coverage"] == [
        {"gate": "web-test", "scope": "kept.ts", "metric": "lines", "base": 90.0, "head": 60.0}
    ]


def test_a_metric_one_side_lacks_is_not_a_fall() -> None:
    base = _figures(coverage=_covered({"lines": 80.0, "statements": 80.0}))
    head = _figures(coverage=_covered({"lines": 80.0}))
    assert metrics.compare(base, head)["coverage"] == []


def test_coverage_is_sorted_by_the_size_of_the_fall() -> None:
    base = _figures(
        coverage={
            "web-test": {"total": {"lines": 80.0}, "files": {"a.ts": {"lines": 100.0}, "b.ts": {"lines": 50.0}}},
            "ci-tests": {"total": {"lines": 60.0}, "files": {}},
        }
    )
    head = _figures(
        coverage={
            "web-test": {"total": {"lines": 75.0}, "files": {"a.ts": {"lines": 40.0}, "b.ts": {"lines": 49.0}}},
            "ci-tests": {"total": {"lines": 55.0}, "files": {}},
        }
    )
    assert [(entry["gate"], entry["scope"]) for entry in metrics.compare(base, head)["coverage"]] == [
        ("web-test", "a.ts"),
        # Equal falls: by gate.
        ("ci-tests", "total"),
        ("web-test", "total"),
        ("web-test", "b.ts"),
    ]


def test_new_and_removed_tests_are_counted() -> None:
    comparison = metrics.compare(_figures({"a": 1, "b": 1, "c": 1}), _figures({"c": 1, "d": 1}))
    assert (comparison["new_tests"], comparison["removed_tests"]) == (1, 2)
