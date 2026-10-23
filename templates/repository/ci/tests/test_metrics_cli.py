"""The `metrics` command, over what a real `gate run --report-dir` left behind."""

from __future__ import annotations

import json
from pathlib import Path

# A gate that writes what a test gate writes, with the duration it is told to.
TESTS = '''
    """Pretends to run tests."""
    import os
    from pathlib import Path
    from the_test_cabinet_ci import artifacts_dir, enter_repo_root
    root = enter_repo_root()
    seconds = os.environ["FAKE_SECONDS"]
    lines = os.environ["FAKE_LINES"]
    artifacts = artifacts_dir()
    (artifacts / "junit.xml").write_text(
        f'<testsuites><testsuite name="s"><testcase classname="suite" name="case" time="{seconds}"/>'
        '</testsuite></testsuites>'
    )
    (artifacts / "lcov.info").write_text(f"SF:{root}/src/a.ts\\nLF:100\\nLH:{lines}\\nend_of_record\\n")
'''


def _write(path: Path, data: object) -> Path:
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_collect_then_compare(gate, metrics_cli, add_gate, tmp_path: Path) -> None:
    add_gate("fake-tests", TESTS)
    base_dir, head_dir = tmp_path / "base", tmp_path / "head"
    for report_dir, seconds, lines in ((base_dir, "1.0", "90"), (head_dir, "7.0", "74")):
        ran = gate(
            "run", "fake-tests", "--report-dir", str(report_dir), env={"FAKE_SECONDS": seconds, "FAKE_LINES": lines}
        )
        assert ran.returncode == 0, ran.stderr

    # The run collected already. Collecting again answers the same.
    (base_dir / "metrics.json").unlink()
    collected = metrics_cli("collect", str(base_dir))
    assert collected.returncode == 0, collected.stderr
    # The path and nothing else: the figures stay in the file.
    assert collected.stdout.strip() == str((base_dir / "metrics.json").resolve())
    elsewhere = tmp_path / "out" / "head.json"
    assert metrics_cli("collect", str(head_dir), "-o", str(elsewhere)).stdout.strip() == str(elsewhere)
    assert json.loads(elsewhere.read_text(encoding="utf-8")) == json.loads(
        (head_dir / "metrics.json").read_text(encoding="utf-8")
    )

    base = json.loads((base_dir / "metrics.json").read_text(encoding="utf-8"))
    assert base["tests"] == {"fake-tests::suite::case": {"seconds": 1.0, "status": "passed"}}
    assert base["coverage"] == {"fake-tests": {"total": {"lines": 90.0}, "files": {"src/a.ts": {"lines": 90.0}}}}
    assert base["gates"]["fake-tests"]["ok"] is True

    written = tmp_path / "compare.json"
    compared = metrics_cli("compare", str(base_dir / "metrics.json"), str(elsewhere), "-o", str(written))
    assert compared.returncode == 0, compared.stderr
    comparison = json.loads(compared.stdout)
    assert comparison == json.loads(written.read_text(encoding="utf-8"))
    assert comparison["slower"] == [
        {"kind": "test", "name": "fake-tests::suite::case", "base_seconds": 1.0, "head_seconds": 7.0, "ratio": 7.0}
    ]
    assert comparison["coverage"] == [
        {"gate": "fake-tests", "scope": "total", "metric": "lines", "base": 90.0, "head": 74.0},
        {"gate": "fake-tests", "scope": "src/a.ts", "metric": "lines", "base": 90.0, "head": 74.0},
    ]
    assert (comparison["new_tests"], comparison["removed_tests"]) == (0, 0)


def test_compare_exits_zero_however_bad_the_figures(metrics_cli, tmp_path: Path) -> None:
    base = _write(tmp_path / "base.json", {"gates": {"g": {"seconds": 1.0, "ok": True}}, "tests": {}, "coverage": {}})
    head = _write(tmp_path / "head.json", {"gates": {"g": {"seconds": 99.0, "ok": False}}, "tests": {}, "coverage": {}})
    compared = metrics_cli("compare", str(base), str(head))
    assert compared.returncode == 0
    assert len(json.loads(compared.stdout)["slower"]) == 1


def test_compare_takes_its_thresholds_from_the_command_line(metrics_cli, tmp_path: Path) -> None:
    coverage = lambda lines: {"g": {"total": {"lines": lines}, "files": {}}}  # noqa: E731
    base = _write(tmp_path / "base.json", {"gates": {}, "tests": {"t": {"seconds": 0.2}}, "coverage": coverage(80.0)})
    head = _write(tmp_path / "head.json", {"gates": {}, "tests": {"t": {"seconds": 0.25}}, "coverage": coverage(79.0)})
    default = json.loads(metrics_cli("compare", str(base), str(head)).stdout)
    assert (len(default["slower"]), len(default["coverage"])) == (0, 1)
    tuned = metrics_cli(
        "compare", str(base), str(head), "--ratio", "1.2", "--min-seconds", "0.1", "--coverage-epsilon", "2"
    )
    tuned = json.loads(tuned.stdout)
    assert (len(tuned["slower"]), len(tuned["coverage"])) == (1, 0)


def test_a_sparse_metrics_file_compares(metrics_cli, tmp_path: Path) -> None:
    base, head = _write(tmp_path / "base.json", {}), _write(tmp_path / "head.json", {"tests": {"t": {"seconds": 1}}})
    compared = metrics_cli("compare", str(base), str(head))
    assert json.loads(compared.stdout) == {"slower": [], "coverage": [], "new_tests": 1, "removed_tests": 0}


def test_an_unreadable_file_exits_one(metrics_cli, tmp_path: Path) -> None:
    head = _write(tmp_path / "head.json", {})
    for base in (
        tmp_path / "absent.json",
        _write(tmp_path / "list.json", []),
        _write(tmp_path / "bad.json", {"tests": 3}),
    ):
        compared = metrics_cli("compare", str(base), str(head))
        assert compared.returncode == 1
        assert compared.stdout == ""
        assert compared.stderr.startswith("metrics: ")
    collected = metrics_cli("collect", str(tmp_path / "no-report"))
    assert collected.returncode == 1
    assert "results.json" in collected.stderr


def test_a_bad_threshold_is_a_usage_error(metrics_cli, tmp_path: Path) -> None:
    assert metrics_cli("compare", "a.json", "b.json", "--ratio", "-1").returncode == 2
    assert metrics_cli("compare", "a.json").returncode == 2
