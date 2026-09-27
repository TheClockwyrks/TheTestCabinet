"""Coverage reports: istanbul's json-summary, lcov, and the paths in them."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from the_test_cabinet_ci import coverage


def _figure(pct: object) -> dict[str, object]:
    return {"total": 10, "covered": 8, "skipped": 0, "pct": pct}


def _entry(lines: object, branches: object, functions: object, statements: object) -> dict[str, object]:
    return {
        "lines": _figure(lines),
        "branches": _figure(branches),
        "functions": _figure(functions),
        "statements": _figure(statements),
    }


# paths


def test_an_absolute_path_inside_the_checkout_becomes_relative(tmp_path: Path) -> None:
    assert coverage.relative_to_root(str(tmp_path / "apps" / "web" / "src" / "x.ts"), tmp_path) == "apps/web/src/x.ts"


def test_a_relative_path_is_kept(tmp_path: Path) -> None:
    assert coverage.relative_to_root("apps/web/src/x.ts", tmp_path) == "apps/web/src/x.ts"


def test_a_path_outside_the_checkout_is_kept(tmp_path: Path) -> None:
    assert coverage.relative_to_root("/somewhere/else/x.ts", tmp_path / "checkout") == "/somewhere/else/x.ts"


def test_a_sibling_whose_name_starts_like_the_checkout_is_outside(tmp_path: Path) -> None:
    sibling = str(tmp_path / "checkout-two" / "x.ts")
    assert coverage.relative_to_root(sibling, tmp_path / "checkout") == sibling


def test_a_path_through_a_symlink_to_the_checkout_becomes_relative(tmp_path: Path) -> None:
    real = tmp_path / "real"
    (real / "src").mkdir(parents=True)
    (real / "src" / "x.ts").write_text("", encoding="utf-8")
    link = tmp_path / "link"
    link.symlink_to(real)
    # The tool saw the link, git the real folder; then the other way round.
    assert coverage.relative_to_root(str(link / "src" / "x.ts"), real) == "src/x.ts"
    assert coverage.relative_to_root(str(real / "src" / "x.ts"), link) == "src/x.ts"


# json-summary


def test_json_summary(tmp_path: Path) -> None:
    root = tmp_path / "checkout"
    report = tmp_path / "coverage-summary.json"
    report.write_text(
        json.dumps(
            {
                "total": _entry(81.2, 70.1, 77, 80.9),
                str(root / "apps" / "web" / "src" / "z.ts"): _entry(90, 50, 100, 90),
                str(root / "apps" / "web" / "src" / "a.ts"): _entry(100, "Unknown", 100, 100),
            }
        ),
        encoding="utf-8",
    )
    assert coverage.parse_summary(report, root) == {
        "total": {"lines": 81.2, "branches": 70.1, "functions": 77.0, "statements": 80.9},
        "files": {
            # A metric with nothing to cover has no figure, and is left out.
            "apps/web/src/a.ts": {"lines": 100.0, "functions": 100.0, "statements": 100.0},
            "apps/web/src/z.ts": {"lines": 90.0, "branches": 50.0, "functions": 100.0, "statements": 90.0},
        },
    }
    assert list(coverage.parse_summary(report, root)["files"]) == ["apps/web/src/a.ts", "apps/web/src/z.ts"]


@pytest.mark.parametrize("text", ["{", "[]", ""])
def test_a_summary_that_is_not_one_is_unreadable(tmp_path: Path, text: str) -> None:
    report = tmp_path / "coverage-summary.json"
    report.write_text(text, encoding="utf-8")
    with pytest.raises(coverage.UnreadableCoverage):
        coverage.parse_summary(report, tmp_path)


# lcov


def test_lcov(tmp_path: Path) -> None:
    root = tmp_path / "checkout"
    report = tmp_path / "lcov.info"
    report.write_text(
        "\n".join(
            [
                "TN:",
                f"SF:{root}/apps/web/src/a.ts",
                "FN:1,f",
                "FNDA:3,f",
                "FNF:4",
                "FNH:3",
                "DA:1,3",
                "BRDA:1,0,0,1",
                "BRF:10",
                "BRH:5",
                "LF:200",
                "LH:150",
                "end_of_record",
                "SF:apps/web/src/b.ts",
                "LF:0",
                "LH:0",
                "end_of_record",
                "",
            ]
        ),
        encoding="utf-8",
    )
    assert coverage.parse_lcov(report, root) == {
        "total": {"lines": 75.0, "branches": 50.0, "functions": 75.0},
        "files": {
            "apps/web/src/a.ts": {"lines": 75.0, "branches": 50.0, "functions": 75.0},
            # Nothing to cover counts as covered; a metric never named is absent.
            "apps/web/src/b.ts": {"lines": 100.0},
        },
    }


def test_lcov_percentages_are_rounded(tmp_path: Path) -> None:
    report = tmp_path / "lcov.info"
    report.write_text("SF:a.ts\nLF:3\nLH:1\nend_of_record\n", encoding="utf-8")
    assert coverage.parse_lcov(report, tmp_path)["total"] == {"lines": 33.33}


@pytest.mark.parametrize("text", ["", "not lcov at all\n", "SF:a.ts\nLF:many\nend_of_record\n"])
def test_an_lcov_file_that_is_not_one_is_unreadable(tmp_path: Path, text: str) -> None:
    report = tmp_path / "lcov.info"
    report.write_text(text, encoding="utf-8")
    with pytest.raises(coverage.UnreadableCoverage):
        coverage.parse_lcov(report, tmp_path)


# an artifact directory


def test_a_directory_prefers_the_summary_over_lcov(tmp_path: Path) -> None:
    (tmp_path / "coverage-summary.json").write_text(json.dumps({"total": _entry(50, 50, 50, 50)}), encoding="utf-8")
    (tmp_path / "lcov.info").write_text("SF:a.ts\nLF:1\nLH:1\nend_of_record\n", encoding="utf-8")
    assert coverage.parse_dir(tmp_path, tmp_path)["total"]["lines"] == 50.0


def test_a_directory_falls_back_to_lcov(tmp_path: Path) -> None:
    (tmp_path / "lcov.info").write_text("SF:a.ts\nLF:1\nLH:1\nend_of_record\n", encoding="utf-8")
    assert coverage.parse_dir(tmp_path, tmp_path)["total"] == {"lines": 100.0}


def test_a_directory_without_coverage_has_none(tmp_path: Path) -> None:
    assert coverage.parse_dir(tmp_path, tmp_path) is None
    assert coverage.parse_dir(tmp_path / "absent", tmp_path) is None
