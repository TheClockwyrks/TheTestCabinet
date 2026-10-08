"""A whole report, from `gate run --report-dir` to the `SUMMARY.md` it ends with."""

from __future__ import annotations

import json
from pathlib import Path

# A gate that writes what a test gate writes: the first case takes the time it
# is told to, the second fails when told to, and the coverage is what it is told.
TESTS = '''
    """Pretends to run tests."""
    import os
    import sys
    from the_test_cabinet_ci import artifacts_dir, enter_repo_root
    root = enter_repo_root()
    print("GATE-OUTPUT")
    failing = os.environ.get("FAKE_FAIL") == "1"
    failure = "<failure>FAILURE-OUTPUT</failure>" if failing else ""
    artifacts = artifacts_dir()
    (artifacts / "junit.xml").write_text(
        '<testsuites><testsuite name="s">'
        f'<testcase classname="suite" name="timed" time="{os.environ["FAKE_SECONDS"]}"/>'
        f'<testcase classname="suite" name="fragile" time="0.1">{failure}</testcase>'
        '</testsuite></testsuites>'
    )
    (artifacts / "lcov.info").write_text(
        f"SF:{root}/src/a.ts\\nLF:100\\nLH:{os.environ['FAKE_LINES']}\\nend_of_record\\n"
    )
    sys.exit(1 if failing else 0)
'''

NO_JUNIT = '''
    """Checks something that is not a test."""
    print("LINT-OUTPUT")
'''

BASE = {"FAKE_SECONDS": "1.0", "FAKE_LINES": "90"}
WORSE = {"FAKE_SECONDS": "7.0", "FAKE_LINES": "74", "FAKE_FAIL": "1"}


def _json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_a_report_without_a_baseline(gate, add_gate, tmp_path: Path) -> None:
    add_gate("fake-tests", TESTS)
    add_gate("lint", NO_JUNIT)
    report_dir = (tmp_path / "run").resolve()
    ran = gate("run", "fake-tests", "lint", "--report-dir", str(report_dir), env=BASE)
    assert ran.returncode == 0, ran.stderr
    assert ran.stderr == ""

    printed = json.loads(ran.stdout)
    assert printed == _json(report_dir / "results.json")
    assert printed["summary"] == str(report_dir / "SUMMARY.md")
    assert printed["metrics"] == str(report_dir / "metrics.json")
    assert "compare" not in printed
    assert sorted(path.name for path in report_dir.iterdir()) == [
        "SUMMARY.md", "fake-tests", "lint", "metrics.json", "results.json",
    ]  # fmt: skip
    assert sorted(path.name for path in (report_dir / "fake-tests").iterdir()) == [
        "junit.xml", "lcov.info", "output.log",
    ]  # fmt: skip

    assert _json(report_dir / "metrics.json")["tests"] == {
        "fake-tests::suite::fragile": {"seconds": 0.1, "status": "passed"},
        "fake-tests::suite::timed": {"seconds": 1.0, "status": "passed"},
    }
    summary = (report_dir / "SUMMARY.md").read_text(encoding="utf-8")
    assert "**Passed.**\nChecks passed: 2 of 2." in summary
    assert f"| 2 | 0 | `{report_dir / 'fake-tests' / 'output.log'}` |" in summary
    assert f"| - | - | `{report_dir / 'lint' / 'output.log'}` |" in summary
    assert "The run was compared with no baseline." in summary


def test_a_failing_report_against_a_baseline(gate, add_gate, tmp_path: Path) -> None:
    add_gate("fake-tests", TESTS)
    add_gate("lint", NO_JUNIT)
    base_dir, head_dir = (tmp_path / "base").resolve(), (tmp_path / "head").resolve()
    assert gate("run", "fake-tests", "lint", "--report-dir", str(base_dir), env=BASE).returncode == 0

    ran = gate(
        "run", "fake-tests", "lint", "--report-dir", str(head_dir), "--baseline", str(base_dir / "metrics.json"),
        env=WORSE,
    )  # fmt: skip
    assert ran.returncode == 1
    printed = json.loads(ran.stdout)
    assert printed == _json(head_dir / "results.json")
    assert printed["compare"] == str(head_dir / "compare.json")
    assert [(entry["id"], entry["ok"]) for entry in printed["gates"]] == [("fake-tests", False), ("lint", True)]

    comparison = _json(head_dir / "compare.json")
    assert [entry["name"] for entry in comparison["slower"]] == ["fake-tests::suite::timed"]
    assert [entry["scope"] for entry in comparison["coverage"]] == ["total", "src/a.ts"]

    summary = (head_dir / "SUMMARY.md").read_text(encoding="utf-8")
    assert "**Failed.**\nChecks passed: 1 of 2." in summary
    assert "### `fake-tests`\n\nFailing tests: 1.\n\n| Test |\n| --- |\n| `suite::fragile` |\n" in summary
    assert "| test | `fake-tests::suite::timed` | 1.00 | 7.00 | 7.00 |" in summary
    assert "| `fake-tests` | `total` | lines | 90.00 | 74.00 |" in summary
    assert f"| `compare.json` | `{head_dir / 'compare.json'}` |" in summary
    # What a gate or a test printed stays in its folder.
    for output in ("GATE-OUTPUT", "LINT-OUTPUT", "FAILURE-OUTPUT"):
        assert output not in summary
        assert output not in ran.stdout
    assert "GATE-OUTPUT" in (head_dir / "fake-tests" / "output.log").read_text(encoding="utf-8")


def test_a_run_without_a_baseline_drops_the_comparison_it_finds(gate, add_gate, tmp_path: Path) -> None:
    add_gate("fake-tests", TESTS)
    report_dir = tmp_path / "run"
    assert gate("run", "fake-tests", "--report-dir", str(report_dir), env=BASE).returncode == 0
    baseline = ["--baseline", str(report_dir / "metrics.json")]
    assert gate("run", "fake-tests", "--report-dir", str(report_dir), *baseline, env=BASE).returncode == 0
    assert (report_dir / "compare.json").is_file()
    printed = json.loads(gate("run", "fake-tests", "--report-dir", str(report_dir), env=BASE).stdout)
    assert "compare" not in printed
    assert not (report_dir / "compare.json").exists()


def test_an_unreadable_baseline_fails_before_any_gate_runs(gate, add_gate, checkout: Path, tmp_path: Path) -> None:
    marker = checkout / "ran"
    add_gate("ok", f'"""Leaves a mark."""\nopen({str(marker)!r}, "w")\n')
    not_metrics = tmp_path / "list.json"
    not_metrics.write_text("[]", encoding="utf-8")
    for baseline in (tmp_path / "absent.json", not_metrics):
        ran = gate("run", "ok", "--report-dir", str(tmp_path / "report"), "--baseline", str(baseline))
        assert ran.returncode == 2
        assert ran.stdout == ""
        assert ran.stderr.startswith(f"gate: --baseline: {baseline}")
    assert not marker.exists()
    assert not (tmp_path / "report").exists()


def test_a_baseline_needs_a_report_dir(gate, add_gate, tmp_path: Path) -> None:
    add_gate("ok", '"""Ok."""\n')
    ran = gate("run", "ok", "--baseline", str(tmp_path / "metrics.json"))
    assert ran.returncode == 2
    assert "--report-dir" in ran.stderr


def test_an_unreadable_artifact_is_warned_about_beside_the_json(gate, add_gate, tmp_path: Path) -> None:
    add_gate(
        "died",
        '"""Dies mid-report."""\nimport sys\nfrom the_test_cabinet_ci import artifacts_dir\n'
        '(artifacts_dir() / "junit.xml").write_text("<testsuites><testsuite")\nsys.exit(3)\n',
    )
    ran = gate("run", "died", "--report-dir", str(tmp_path / "run"))
    assert ran.returncode == 1
    assert json.loads(ran.stdout)["ok"] is False
    assert ran.stderr.startswith("gate: ") and "junit.xml" in ran.stderr
    summary = (tmp_path / "run" / "SUMMARY.md").read_text(encoding="utf-8")
    assert "Exit code 3, and no failing test on record. The log has why." in summary


# metrics summary


def test_metrics_summary_writes_the_same_summary_again(gate, metrics_cli, add_gate, tmp_path: Path) -> None:
    add_gate("fake-tests", TESTS)
    base_dir, head_dir = (tmp_path / "base").resolve(), (tmp_path / "head").resolve()
    gate("run", "fake-tests", "--report-dir", str(base_dir), env=BASE)
    gate("run", "fake-tests", "--report-dir", str(head_dir), "--baseline", str(base_dir / "metrics.json"), env=WORSE)
    written = (head_dir / "SUMMARY.md").read_bytes()
    (head_dir / "SUMMARY.md").unlink()
    (head_dir / "metrics.json").unlink()

    # With no baseline named, the comparison the run made is kept.
    again = metrics_cli("summary", str(head_dir))
    assert again.returncode == 0, again.stderr
    assert again.stdout.strip() == str(head_dir / "SUMMARY.md")
    assert (head_dir / "SUMMARY.md").read_bytes() == written
    assert (head_dir / "metrics.json").is_file()

    # Against itself nothing is worse, and the comparison on disk says so too.
    against_itself = metrics_cli("summary", str(head_dir), "--baseline", str(head_dir / "metrics.json"))
    assert against_itself.returncode == 0, against_itself.stderr
    assert _json(head_dir / "compare.json")["slower"] == []
    assert "nothing got slower" in (head_dir / "SUMMARY.md").read_text(encoding="utf-8")


def test_metrics_summary_adds_a_baseline_to_a_run_that_had_none(gate, metrics_cli, add_gate, tmp_path: Path) -> None:
    add_gate("fake-tests", TESTS)
    base_dir, head_dir = tmp_path / "base", tmp_path / "head"
    gate("run", "fake-tests", "--report-dir", str(base_dir), env=BASE)
    gate("run", "fake-tests", "--report-dir", str(head_dir), env=WORSE)
    assert "no baseline" in (head_dir / "SUMMARY.md").read_text(encoding="utf-8")
    assert metrics_cli("summary", str(head_dir), "--baseline", str(base_dir / "metrics.json")).returncode == 0
    assert "| test | `fake-tests::suite::timed` | 1.00 | 7.00 | 7.00 |" in (head_dir / "SUMMARY.md").read_text(
        encoding="utf-8"
    )


def test_metrics_summary_of_what_is_not_a_report_exits_one(metrics_cli, tmp_path: Path) -> None:
    summarised = metrics_cli("summary", str(tmp_path / "no-report"))
    assert summarised.returncode == 1
    assert summarised.stdout == ""
    assert "results.json" in summarised.stderr
