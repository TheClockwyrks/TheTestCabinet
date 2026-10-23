"""JUnit reports as nextest, vitest and pytest each write them."""

from __future__ import annotations

from pathlib import Path

import pytest

from the_test_cabinet_ci import junit

NEXTEST = """<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="nextest-run" tests="4" failures="1" errors="0" uuid="0" timestamp="2026-01-01T00:00:00Z" time="9.5">
    <testsuite name="the-test-cabinet-backend" tests="3" disabled="0" errors="0" failures="1">
        <testcase name="config::tests::reads_the_file" classname="the-test-cabinet-backend" timestamp="t" time="0.412">
        </testcase>
        <testcase name="probe::tests::times_out" classname="the-test-cabinet-backend" timestamp="t" time="0.200">
            <flakyFailure timestamp="t" time="6.250" type="test failure">
                <system-out>first attempt</system-out>
            </flakyFailure>
            <flakyFailure timestamp="t" time="1.500" type="test failure"/>
        </testcase>
        <testcase name="probe::tests::is_broken" classname="the-test-cabinet-backend" timestamp="t" time="0.050">
            <failure type="test failure">assertion failed</failure>
            <rerunFailure timestamp="t" time="0.075" type="test failure"/>
        </testcase>
    </testsuite>
    <testsuite name="the-test-cabinet-backend::api" tests="1" disabled="0" errors="0" failures="0">
        <testcase name="serves_the_index" classname="the-test-cabinet-backend::api" timestamp="t" time="1.000"/>
    </testsuite>
</testsuites>
"""

VITEST = """<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="1" errors="0" time="1.2">
    <testsuite name="src/lib/format.test.ts" timestamp="t" hostname="h"
               tests="3" failures="1" errors="0" skipped="1" time="0.04">
        <testcase classname="src/lib/format.test.ts" name="format &gt; renders bytes" time="0.0021">
        </testcase>
        <testcase classname="src/lib/format.test.ts" name="format &gt; renders a date" time="0.013">
            <failure message="expected" type="AssertionError">at line 3</failure>
        </testcase>
        <testcase classname="src/lib/format.test.ts" name="format &gt; later" time="0">
            <skipped/>
        </testcase>
    </testsuite>
</testsuites>
"""

PYTEST = """<?xml version="1.0" encoding="utf-8"?>
<testsuites name="pytest tests">
<testsuite name="pytest" errors="1" failures="0" skipped="1" tests="4" time="0.5" timestamp="t" hostname="h">
<testcase classname="tests.test_runner" name="test_discovers[a-b]" time="0.003" />
<testcase classname="tests.test_runner" name="test_needs_a_fixture" time="0.001">
<error message="failed on setup">E</error></testcase>
<testcase classname="tests.test_runner" name="test_later" time="0.000">
<skipped type="pytest.skip" message="later">s</skipped></testcase>
<testcase classname="tests.test_metrics" name="test_compare" time="1,234.5" />
</testsuite>
</testsuites>
"""


def _write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "junit.xml"
    path.write_text(text, encoding="utf-8")
    return path


def test_nextest(tmp_path: Path) -> None:
    cases = junit.parse(_write(tmp_path, NEXTEST))
    assert {key: (case.seconds, case.status) for key, case in cases.items()} == {
        "the-test-cabinet-backend::config::tests::reads_the_file": (0.412, "passed"),
        # The retried test passed in 0.2 s, after an attempt that took 6.25 s.
        "the-test-cabinet-backend::probe::tests::times_out": (6.25, "passed"),
        "the-test-cabinet-backend::probe::tests::is_broken": (0.075, "failed"),
        "the-test-cabinet-backend::api::serves_the_index": (1.0, "passed"),
    }


def test_vitest(tmp_path: Path) -> None:
    cases = junit.parse(_write(tmp_path, VITEST))
    assert {key: (case.seconds, case.status) for key, case in cases.items()} == {
        "src/lib/format.test.ts::format > renders bytes": (0.0021, "passed"),
        "src/lib/format.test.ts::format > renders a date": (0.013, "failed"),
        "src/lib/format.test.ts::format > later": (0.0, "skipped"),
    }


def test_pytest(tmp_path: Path) -> None:
    cases = junit.parse(_write(tmp_path, PYTEST))
    assert {key: (case.seconds, case.status) for key, case in cases.items()} == {
        "tests.test_runner::test_discovers[a-b]": (0.003, "passed"),
        "tests.test_runner::test_needs_a_fixture": (0.001, "failed"),
        "tests.test_runner::test_later": (0.0, "skipped"),
        "tests.test_metrics::test_compare": (1234.5, "passed"),
    }


def test_a_lone_testsuite_root(tmp_path: Path) -> None:
    text = '<testsuite name="s"><testcase classname="c" name="n" time="2"/></testsuite>'
    assert junit.parse(_write(tmp_path, text))["c::n"].seconds == 2.0


def test_nested_suites_read_each_case_once(tmp_path: Path) -> None:
    text = """<testsuites><testsuite name="outer">
        <testcase classname="c" name="outer-case" time="1"/>
        <testsuite name="inner"><testcase classname="c" name="inner-case" time="3"/></testsuite>
    </testsuite></testsuites>"""
    cases = junit.parse(_write(tmp_path, text))
    assert {key: case.seconds for key, case in cases.items()} == {"c::outer-case": 1.0, "c::inner-case": 3.0}


def test_a_case_without_a_classname_takes_its_suite_name(tmp_path: Path) -> None:
    text = '<testsuites><testsuite name="suite"><testcase name="n" time="1"/></testsuite></testsuites>'
    assert list(junit.parse(_write(tmp_path, text))) == ["suite::n"]


def test_duplicates_keep_the_longest_time_and_the_worst_status(tmp_path: Path) -> None:
    text = """<testsuites>
      <testsuite name="a">
        <testcase classname="c" name="n" time="0.5"/>
        <testcase classname="c" name="n" time="4.0"><failure/></testcase>
      </testsuite>
      <testsuite name="b">
        <testcase classname="c" name="n" time="2.0"/>
        <testcase classname="c" name="quiet" time="1.0"><skipped/></testcase>
        <testcase classname="c" name="quiet" time="0.5"/>
      </testsuite>
    </testsuites>"""
    cases = junit.parse(_write(tmp_path, text))
    assert (cases["c::n"].seconds, cases["c::n"].status) == (4.0, "failed")
    assert (cases["c::quiet"].seconds, cases["c::quiet"].status) == (1.0, "passed")


@pytest.mark.parametrize("time", ["", "soon", "-3"])
def test_a_time_that_is_no_duration_reads_as_zero(tmp_path: Path, time: str) -> None:
    text = f'<testsuite name="s"><testcase classname="c" name="n" time="{time}"/></testsuite>'
    assert junit.parse(_write(tmp_path, text))["c::n"].seconds == 0.0


def test_an_empty_report_has_no_cases(tmp_path: Path) -> None:
    assert junit.parse(_write(tmp_path, "<testsuites/>")) == {}


# A report in node's own shape, with each case's file in place of the literal
# `test` node's JUnit reporter labels them all with.
NODE = """<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="a test in no describe" time="0.25" classname="a.test.ts" file="/repo/a.test.ts"/>
	<testsuite name="a describe" time="0.5" disabled="0" errors="0" tests="1" failures="1" skipped="0" hostname="h">
		<testcase name="fails" time="0.125" classname="a.test.ts" file="/repo/a.test.ts">
			<failure type="testCodeFailure" message="no">no</failure>
		</testcase>
	</testsuite>
	<testsuite name="a describe" time="0.5" disabled="0" errors="0" tests="1" failures="0" skipped="0" hostname="h">
		<testcase name="fails" time="0.5" classname="b.test.ts" file="/repo/b.test.ts"/>
	</testsuite>
</testsuites>
"""


def test_nodes_cases_straight_under_the_root_are_read(tmp_path: Path) -> None:
    assert junit.parse(_write(tmp_path, NODE)) == {
        "a.test.ts::a test in no describe": junit.Case(0.25, junit.PASSED),
        # Two tests of one name, in two files and under two describes of one
        # name: the file is the only thing that tells them apart.
        "a.test.ts::fails": junit.Case(0.125, junit.FAILED),
        "b.test.ts::fails": junit.Case(0.5, junit.PASSED),
    }


# The same run, as node's own JUnit reporter writes it: every case is labelled
# `test`, so the two `fails` become one and the failure swallows the pass.
NODE_UNLABELLED = NODE.replace('classname="a.test.ts"', 'classname="test"').replace(
    'classname="b.test.ts"', 'classname="test"'
)


def test_a_tool_that_labels_every_case_alike_loses_one_of_two_tests(tmp_path: Path) -> None:
    """The defect a classname per file is what keeps out."""
    assert junit.parse(_write(tmp_path, NODE_UNLABELLED)) == {
        "test::a test in no describe": junit.Case(0.25, junit.PASSED),
        "test::fails": junit.Case(0.5, junit.FAILED),
    }


def _browser(classname: str) -> str:
    """One vitest suite: the browser project's file, run under one instance."""
    return f"""
    <testsuite name="src/app/shell.browser.test.tsx" timestamp="t" hostname="h" tests="1" time="0.4">
        <testcase classname="{classname}" name="the shell &gt; fits its width" time="0.06"/>
    </testsuite>"""


INSTANCES = ("chromium", "firefox", "webkit")
VIEWPORTS = ("desktop", "phone")
FILE = "src/app/shell.browser.test.tsx"


def _report(suites: str) -> str:
    return f"<testsuites name='vitest tests'>{suites}</testsuites>"


# The browser gate's report: one file, six instances, one case each.
VITEST_BROWSER = _report(
    "".join(_browser(f"{engine}-{viewport}/{FILE}") for engine in INSTANCES for viewport in VIEWPORTS)
)

# The same run before the classname template: the suites, the classnames and
# the case names are all identical, so six timings become one.
VITEST_BROWSER_UNQUALIFIED = _report(_browser(FILE) * (len(INSTANCES) * len(VIEWPORTS)))


def test_each_browser_instance_is_a_test_of_its_own(tmp_path: Path) -> None:
    cases = junit.parse(_write(tmp_path, VITEST_BROWSER))
    assert sorted(cases) == [
        f"{engine}-{viewport}/{FILE}::the shell > fits its width"
        for engine in sorted(INSTANCES)
        for viewport in sorted(VIEWPORTS)
    ]


def test_the_browser_instances_collide_without_the_classname_template(tmp_path: Path) -> None:
    """The defect `classnameTemplate` exists to keep out: six real tests, one
    key, and five engines' figures merged into it."""
    assert list(junit.parse(_write(tmp_path, VITEST_BROWSER_UNQUALIFIED))) == [f"{FILE}::the shell > fits its width"]


def test_a_retry_merges_where_two_instances_do_not(tmp_path: Path) -> None:
    """The two shapes a repeated name has are told apart by the classname: a
    retried test keeps one key on purpose, two distinct cases get two."""
    retried = """<testsuites><testsuite name="s">
        <testcase classname="c" name="n" time="0.5"/>
        <testcase classname="c" name="n" time="4.0"/>
    </testsuite></testsuites>"""
    assert junit.parse(_write(tmp_path, retried)) == {"c::n": junit.Case(4.0, junit.PASSED)}

    distinct = retried.replace('classname="c" name="n" time="4.0"', 'classname="d" name="n" time="4.0"')
    assert junit.parse(_write(tmp_path, distinct)) == {
        "c::n": junit.Case(0.5, junit.PASSED),
        "d::n": junit.Case(4.0, junit.PASSED),
    }


def test_a_truncated_report_is_unreadable(tmp_path: Path) -> None:
    with pytest.raises(junit.UnreadableReport):
        junit.parse(_write(tmp_path, NEXTEST[:300]))


def test_an_absent_report_is_unreadable(tmp_path: Path) -> None:
    with pytest.raises(junit.UnreadableReport):
        junit.parse(tmp_path / "absent.xml")
