"""`SUMMARY.md`: what it says, what it leaves out, and that it lints."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from the_test_cabinet_ci import metrics, summary

REPOSITORY = Path(__file__).resolve().parents[2]
REPORT_DIR = Path("/report")
RECORDS = [REPORT_DIR / "results.json", REPORT_DIR / "metrics.json"]


def _check(check_id: str, seconds: float, ok: bool = True, exit_code: int | None = None) -> dict[str, object]:
    code = exit_code if exit_code is not None else (0 if ok else 1)
    return {"id": check_id, "ok": ok, "exit_code": code, "seconds": seconds}


def _results(*checks: dict[str, object]) -> dict[str, object]:
    return {"ok": all(check["ok"] for check in checks), "report_dir": "/somewhere/else", "gates": list(checks)}


def _tests(check_id: str, **statuses: str) -> dict[str, object]:
    return {f"{check_id}::suite::{name}": {"seconds": 0.5, "status": status} for name, status in statuses.items()}


def _figures(tests: dict[str, object] | None = None) -> dict[str, object]:
    return {"gates": {}, "tests": tests or {}, "coverage": {}}


def _render(results, figures=None, comparison=None, records=RECORDS) -> str:
    return summary.render(results, figures or _figures(), comparison, REPORT_DIR, records)


def _section(text: str, heading: str) -> str:
    """A section's text, from its heading to the next one of the same level."""
    level = heading.split(" ")[0]
    after = text.split(f"{heading}\n", 1)[1]
    return after.split(f"\n{level} ", 1)[0]


# what it says


def test_a_passing_run(tmp_path: Path) -> None:
    figures = _figures(_tests("web-test", a="passed", b="passed", c="skipped"))
    text = _render(_results(_check("web-test", 12.345), _check("rust-fmt", 0.2)), figures)
    assert text.startswith("# Gate run\n\n**Passed.**\nChecks passed: 2 of 2.\n")
    assert "| `web-test` | passed | 12.35 | 2 | 0 | `/report/web-test/output.log` |" in text
    # No JUnit report: nothing to count, which is not the same as none run.
    assert "| `rust-fmt` | passed | 0.20 | - | - | `/report/rust-fmt/output.log` |" in text
    assert "## Failed checks" not in text
    assert text.endswith("| `metrics.json` | `/report/metrics.json` |\n")


def test_the_log_is_where_the_report_is_read_from_and_not_where_it_was_written() -> None:
    text = _render(_results(_check("g", 1)))
    assert "/somewhere/else" not in text


def test_a_failed_check_names_its_failing_tests() -> None:
    figures = _figures(
        {
            **_tests("web-test", zeta="failed", alpha="failed", fine="passed"),
            # Another check's failure is not this one's.
            **_tests("web-test-more", other="failed"),
        }
    )
    text = _render(_results(_check("web-test", 3, ok=False), _check("web-test-more", 1)), figures)
    assert "**Failed.**\nChecks passed: 1 of 2." in text
    assert "| `web-test` | failed | 3.00 | 3 | 2 |" in text
    failed = _section(text, "## Failed checks")
    assert "### `web-test`\n\nFailing tests: 2.\n" in failed
    assert failed.index("`suite::alpha`") < failed.index("`suite::zeta`")
    assert "other" not in failed and "fine" not in failed
    assert "web-test-more" not in failed


def test_failing_tests_are_capped_and_counted() -> None:
    failing = {f"t{index:02}": "failed" for index in range(summary.FAILING_TESTS_LISTED + 5)}
    text = _render(_results(_check("g", 3, ok=False)), _figures(_tests("g", **failing)))
    failed = _section(text, "## Failed checks")
    assert f"Failing tests: 15, the first {summary.FAILING_TESTS_LISTED} listed." in failed
    assert failed.count("`suite::t") == summary.FAILING_TESTS_LISTED
    assert "`suite::t09`" in failed and "`suite::t10`" not in failed


def test_a_failed_check_with_no_junit_points_at_its_log() -> None:
    text = _render(_results(_check("rust-clippy", 9, ok=False, exit_code=101)))
    assert "| `rust-clippy` | failed | 9.00 | - | - |" in text
    assert "Exit code 101, and no failing test on record. The log has why." in _section(text, "### `rust-clippy`")


def test_a_name_cannot_break_the_table_it_sits_in() -> None:
    figures = _figures({"g::a | b::line\none `tick`": {"seconds": 1, "status": "failed"}})
    text = _render(_results(_check("g", 1, ok=False)), figures)
    assert "| `a \\| b::line one 'tick'` |" in text


# worth a look


def test_no_baseline_says_so() -> None:
    assert _section(_render(_results(_check("g", 1))), "## Worth a look").strip() == (
        "The run was compared with no baseline."
    )


def test_a_clean_comparison_says_so() -> None:
    comparison = {"slower": [], "coverage": [], "new_tests": 3, "removed_tests": 0}
    look = _section(_render(_results(_check("g", 1)), comparison=comparison), "## Worth a look")
    assert look.strip() == "Against the baseline, nothing got slower by the threshold and no coverage fell."


def test_each_kind_of_flag_carries_both_figures() -> None:
    comparison = {
        "slower": [
            {"kind": "test", "name": "g::suite::slow", "base_seconds": 1.0, "head_seconds": 7.0, "ratio": 7.0},
            {"kind": "gate", "name": "g", "base_seconds": 0.0, "head_seconds": 30.0, "ratio": None},
        ],
        "coverage": [
            {"gate": "g", "scope": "total", "metric": "lines", "base": 81.2, "head": 74.0},
            {"gate": "g", "scope": "src/a.ts", "metric": "branches", "base": 60.0, "head": 59.5},
        ],
        "new_tests": 0,
        "removed_tests": 0,
    }
    look = _section(_render(_results(_check("g", 30)), comparison=comparison), "## Worth a look")
    assert "Slower than the baseline: 2." in look
    assert "| test | `g::suite::slow` | 1.00 | 7.00 | 7.00 |" in look
    assert "| check | `g` | 0.00 | 30.00 | - |" in look
    assert "Coverage decreases: 2." in look
    assert "| `g` | `total` | lines | 81.20 | 74.00 |" in look
    assert "| `g` | `src/a.ts` | branches | 60.00 | 59.50 |" in look


def test_flags_are_capped_and_counted() -> None:
    slower = [
        {"kind": "test", "name": f"g::s::t{index:02}", "base_seconds": 1.0, "head_seconds": 9.0, "ratio": 9.0}
        for index in range(summary.FLAGS_LISTED + 1)
    ]
    look = _section(_render(_results(_check("g", 1)), comparison={"slower": slower, "coverage": []}), "## Worth a look")
    assert f"Slower than the baseline: 21, the first {summary.FLAGS_LISTED} listed." in look
    assert look.count("| test |") == summary.FLAGS_LISTED


# a report directory, finished


JUNIT = (
    '<testsuites><testsuite name="s">'
    '<testcase classname="suite" name="slow" time="{seconds}"/>'
    '<testcase classname="suite" name="broken" time="0.1">'
    "<failure>SECRET-ASSERTION-OUTPUT</failure><system-out>SECRET-STDOUT</system-out></testcase>"
    "</testsuite></testsuites>"
)


def _report(directory: Path, root: Path, seconds: float, lines: int, ok: bool = False) -> Path:
    (directory / "tests").mkdir(parents=True)
    (directory / "lint").mkdir()
    results = _results(_check("tests", seconds + 1, ok=ok), _check("lint", 0.3))
    results["root"] = str(root)
    (directory / "results.json").write_text(json.dumps(results), encoding="utf-8")
    (directory / "tests" / "output.log").write_text("SECRET-LOG-LINE\n", encoding="utf-8")
    (directory / "tests" / "junit.xml").write_text(JUNIT.format(seconds=seconds), encoding="utf-8")
    (directory / "tests" / "lcov.info").write_text(
        f"SF:{root}/src/a.ts\nLF:100\nLH:{lines}\nend_of_record\n", encoding="utf-8"
    )
    return directory


def _no_root() -> Path:
    raise AssertionError("the report names its checkout")


def test_write_report_without_a_baseline(tmp_path: Path) -> None:
    report_dir = _report(tmp_path / "run", tmp_path, 1.0, 90)
    files = metrics.write_report(report_dir, _no_root)
    assert files == {"summary": report_dir / "SUMMARY.md", "metrics": report_dir / "metrics.json"}
    assert not (report_dir / "compare.json").exists()
    text = files["summary"].read_text(encoding="utf-8")
    assert "| `suite::broken` |" in text
    assert "The run was compared with no baseline." in text
    assert "compare.json" not in text


def test_write_report_against_a_baseline_flags_every_kind(tmp_path: Path) -> None:
    base = metrics.write_report(_report(tmp_path / "base", tmp_path, 1.0, 90), _no_root)
    report_dir = _report(tmp_path / "head", tmp_path, 7.0, 74)
    files = metrics.write_report(report_dir, _no_root, baseline=metrics.load_metrics(base["metrics"]))
    assert files["compare"] == report_dir / "compare.json"
    comparison = json.loads(files["compare"].read_text(encoding="utf-8"))
    assert [(entry["kind"], entry["name"]) for entry in comparison["slower"]] == [
        ("test", "tests::suite::slow"),
        ("gate", "tests"),
    ]
    look = _section(files["summary"].read_text(encoding="utf-8"), "## Worth a look")
    assert "| test | `tests::suite::slow` | 1.00 | 7.00 | 7.00 |" in look
    assert "| check | `tests` | 2.00 | 8.00 | 4.00 |" in look
    assert "| `tests` | `total` | lines | 90.00 | 74.00 |" in look
    assert "| `tests` | `src/a.ts` | lines | 90.00 | 74.00 |" in look
    assert f"| `compare.json` | `{report_dir / 'compare.json'}` |" in files["summary"].read_text(encoding="utf-8")


def test_the_summary_never_holds_a_gates_output(tmp_path: Path) -> None:
    base = metrics.write_report(_report(tmp_path / "base", tmp_path, 1.0, 90), _no_root)
    report_dir = _report(tmp_path / "head", tmp_path, 7.0, 74)
    files = metrics.write_report(report_dir, _no_root, baseline=metrics.load_metrics(base["metrics"]))
    assert "SECRET" not in files["summary"].read_text(encoding="utf-8")


def test_the_same_inputs_give_the_same_summary(tmp_path: Path) -> None:
    base = metrics.write_report(_report(tmp_path / "base", tmp_path, 1.0, 90), _no_root)
    baseline = metrics.load_metrics(base["metrics"])
    report_dir = _report(tmp_path / "head", tmp_path, 7.0, 74)
    first = metrics.write_report(report_dir, _no_root, baseline=baseline)["summary"].read_bytes()
    assert metrics.write_report(report_dir, _no_root, baseline=baseline)["summary"].read_bytes() == first
    # Rendering is a function of what it is given, whatever order that came in.
    results = json.loads((report_dir / "results.json").read_text(encoding="utf-8"))
    figures = metrics.load_metrics(report_dir / "metrics.json")
    comparison = json.loads((report_dir / "compare.json").read_text(encoding="utf-8"))
    shuffled = {**figures, "tests": dict(reversed(figures["tests"].items()))}
    records = [report_dir / name for name in ("results.json", "metrics.json", "compare.json")]
    assert summary.render(results, shuffled, comparison, report_dir, records).encode() == first


def test_a_comparison_left_by_another_run_is_removed(tmp_path: Path) -> None:
    report_dir = _report(tmp_path / "run", tmp_path, 1.0, 90)
    (report_dir / "compare.json").write_text('{"slower": [], "coverage": []}', encoding="utf-8")
    assert "compare" not in metrics.write_report(report_dir, _no_root)
    assert not (report_dir / "compare.json").exists()


def test_a_summary_written_again_keeps_its_comparison(tmp_path: Path) -> None:
    base = metrics.write_report(_report(tmp_path / "base", tmp_path, 1.0, 90), _no_root)
    report_dir = _report(tmp_path / "head", tmp_path, 7.0, 74)
    first = metrics.write_report(report_dir, _no_root, baseline=metrics.load_metrics(base["metrics"]))
    text = first["summary"].read_bytes()
    first["summary"].unlink()
    again = metrics.write_report(report_dir, _no_root, keep_comparison=True)
    assert again == first
    assert again["summary"].read_bytes() == text


# markdownlint


def _samples(tmp_path: Path) -> list[Path]:
    """One summary of each shape: failing with flags, passing with no baseline, clean against a baseline."""
    base = metrics.write_report(_report(tmp_path / "base", tmp_path, 1.0, 90, ok=True), _no_root)
    baseline = metrics.load_metrics(base["metrics"])
    flagged = metrics.write_report(_report(tmp_path / "head", tmp_path, 7.0, 74), _no_root, baseline=baseline)
    clean = metrics.write_report(_report(tmp_path / "same", tmp_path, 1.0, 90), _no_root, baseline=baseline)
    awkward = tmp_path / "awkward" / "SUMMARY.md"
    awkward.parent.mkdir()
    long_name = "a test whose name | runs well past `ninety` characters, " + "and on " * 12 + "<b>to the end</b>"
    figures = _figures({f"g::{long_name}": {"seconds": 1, "status": "failed"}})
    checks = _results(_check("g", 1, ok=False), _check("no-junit", 2, ok=False, exit_code=3))
    awkward.write_text(_render(checks, figures), encoding="utf-8")
    return [base["summary"], flagged["summary"], clean["summary"], awkward]


def test_every_shape_of_summary_passes_the_repositorys_markdownlint(tmp_path: Path) -> None:
    linter = REPOSITORY / "node_modules" / ".bin" / "markdownlint-cli2"
    config = REPOSITORY / ".markdownlint-cli2.yaml"
    if not linter.is_file() or not config.is_file():
        pytest.skip("markdownlint-cli2 is not installed in this checkout")
    samples = _samples(tmp_path)
    linted = subprocess.run(
        [str(linter), "--config", str(config), "--no-globs", *(str(sample) for sample in samples)],
        # The configuration ignores what git ignores, relative to where it runs.
        cwd=tmp_path,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
    )
    assert linted.returncode == 0, linted.stdout + linted.stderr
