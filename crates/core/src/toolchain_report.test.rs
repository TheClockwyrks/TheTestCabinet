//! Reading the two report files, over documents shaped exactly as vitest 3 and
//! `@vitest/coverage-istanbul` actually write them.
//!
//! The fixtures below are trimmed from real reporter output, keys and quirks intact:
//! absolute per-file paths, a `branchesTrue` row whose `pct` is the string
//! `"Unknown"`, an empty file-level `message`, and failure messages carrying the deep
//! stack the reporter appends. Each of those is a trap that would otherwise produce a
//! wrong figure or a failed parse, so each is exercised rather than assumed.
//!
//! **Absence is the other half of the contract.** A missing file, an empty file and a
//! truncated one must each read as *not reported*, never as an error and never as a
//! zero, because a run must not turn on whether a report could be parsed.

use super::*;

/// A tree to read reports out of, with the `coverage/` directory the runner writes
/// them into.
fn tree() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("produced tree");
    std::fs::create_dir_all(dir.path().join("coverage")).expect("coverage directory");
    dir
}

/// Write one report file into `repo`, verbatim.
fn write_report(repo: &Path, relative: &str, json: &str) {
    std::fs::write(repo.join(relative), json).expect("write the report");
}

/// An absolute path inside `repo`, spelled the way a reporter spells it.
fn inside(repo: &Path, relative: &str) -> String {
    repo.join(relative).to_string_lossy().into_owned()
}

/// A suite that ran and found nothing is a *present* report of zeroes — the signal
/// that the build shipped no tests. Collapsing it into an absence would make "wrote
/// no tests" indistinguishable from "this case reports nothing", which is the one
/// distinction the block exists to draw.
#[test]
fn a_report_with_no_tests_parses_to_a_present_block_of_zeroes() {
    let repo = tree();
    write_report(
        repo.path(),
        TOOLCHAIN_TEST_REPORT_PATH,
        r#"{"numTotalTestSuites":0,"numTotalTests":0,"numPassedTests":0,"numFailedTests":0,
            "numPendingTests":0,"numTodoTests":0,"success":true,"testResults":[]}"#,
    );

    let tests = read_test_report(repo.path()).expect("a report that parsed is reported");
    assert_eq!(tests.total, 0);
    assert_eq!(tests.files_run, 0);
    assert!(tests.succeeded);
    assert!(tests.files.is_empty() && tests.failures.is_empty());
    assert!(!tests.files_truncated && !tests.failures_truncated);
}

/// The populated case: two files, a pass, a failure, a skip — and the failure's stack
/// frames gone from the recorded message. The frames carry absolute host paths, which
/// must never reach a published record.
#[test]
fn a_populated_report_records_its_files_failures_and_strips_stacks() {
    let repo = tree();
    let game = inside(repo.path(), "src/game.test.ts");
    let hud = inside(repo.path(), "src/hud.test.ts");
    let json = format!(
        r#"{{"numTotalTestSuites":3,"numFailedTestSuites":1,"numTotalTests":3,
            "numPassedTests":1,"numFailedTests":1,"numPendingTests":1,"numTodoTests":0,
            "success":false,
            "testResults":[
              {{"name":{game},"message":"","assertionResults":[
                {{"ancestorTitles":["the engine"],"fullName":"the engine advances",
                  "title":"advances","status":"passed","failureMessages":[]}},
                {{"ancestorTitles":["the engine"],"fullName":"the engine settles",
                  "title":"settles","status":"skipped","failureMessages":[]}}]}},
              {{"name":{hud},"message":"","assertionResults":[
                {{"ancestorTitles":["the hud"],"fullName":"the hud draws a score",
                  "title":"draws a score","status":"failed","failureMessages":[
                    "AssertionError: expected 0 to be 7\n    at run ({hud_frame}:12:3)\n    at file:///x/y.js:1:1\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at new Promise (<anonymous>)"]}}]}}]}}"#,
        game = serde_json::to_string(&game).unwrap(),
        hud = serde_json::to_string(&hud).unwrap(),
        hud_frame = hud,
    );
    write_report(repo.path(), TOOLCHAIN_TEST_REPORT_PATH, &json);

    let tests = read_test_report(repo.path()).expect("a report that parsed is reported");
    // The totals are the document's own counters, not a re-addition of the rows.
    assert_eq!(
        (tests.total, tests.passed, tests.failed, tests.skipped),
        (3, 1, 1, 1)
    );
    // `numTotalTestSuites` counts `describe` blocks and is deliberately unread: two
    // files ran, whatever the suite counters say.
    assert_eq!(tests.files_run, 2);
    assert_eq!(tests.files_failed, 1);
    assert!(!tests.succeeded);

    // Sorted by path, keyed relative to the repository root, and never by the host
    // path the reporter actually wrote.
    let paths: Vec<&str> = tests.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, ["src/game.test.ts", "src/hud.test.ts"]);
    assert_eq!(
        (tests.files[0].passed, tests.files[0].skipped),
        (1, 1),
        "a skipped test is neither passed nor failed"
    );
    assert!(
        tests.files[0].message.is_none(),
        "an empty file-level message is an absence, not a `Some(\"\")`"
    );

    let failure = tests.failures.first().expect("the failure is recorded");
    assert_eq!(failure.file, "src/hud.test.ts");
    assert_eq!(failure.name, "the hud draws a score");
    let message = failure.message.as_deref().expect("with its assertion");
    assert_eq!(message, "AssertionError: expected 0 to be 7");
    assert!(
        !message.contains("at ") && !message.contains(repo.path().to_string_lossy().as_ref()),
        "no stack frame and no host path may survive: {message:?}"
    );
    assert!(!tests.failures_truncated);
}

/// A file that failed to *load* ran no tests at all, so its failure lives in the
/// file-level message — and it still counts as a failing file.
#[test]
fn a_file_that_failed_to_load_is_a_failing_file_with_a_message() {
    let repo = tree();
    let broken = inside(repo.path(), "src/broken.test.ts");
    let json = format!(
        r#"{{"numTotalTests":0,"success":false,"testResults":[
            {{"name":{broken},"message":"Error: Cannot find module './missing'\n    at ({frame}:1:1)",
              "assertionResults":[]}}]}}"#,
        broken = serde_json::to_string(&broken).unwrap(),
        frame = broken,
    );
    write_report(repo.path(), TOOLCHAIN_TEST_REPORT_PATH, &json);

    let tests = read_test_report(repo.path()).expect("a report that parsed is reported");
    assert_eq!((tests.files_run, tests.files_failed), (1, 1));
    assert_eq!(
        tests.files[0].message.as_deref(),
        Some("Error: Cannot find module './missing'"),
    );
}

/// More failures than the cap keeps the first ones — the reporter's own order, so the
/// list reads as "what broke" — flags the truncation, and leaves the true count alone.
#[test]
fn more_failures_than_the_cap_are_truncated_with_their_true_count_intact() {
    let repo = tree();
    let file = inside(repo.path(), "src/game.test.ts");
    let assertions: Vec<String> = (0..TOOLCHAIN_TEST_FAILURE_LIMIT + 5)
        .map(|index| {
            format!(
                r#"{{"fullName":"case {index}","title":"case {index}","status":"failed",
                    "failureMessages":["AssertionError: case {index}"]}}"#
            )
        })
        .collect();
    let json = format!(
        r#"{{"numTotalTests":{count},"numFailedTests":{count},"success":false,
            "testResults":[{{"name":{file},"message":"","assertionResults":[{assertions}]}}]}}"#,
        count = TOOLCHAIN_TEST_FAILURE_LIMIT + 5,
        file = serde_json::to_string(&file).unwrap(),
        assertions = assertions.join(","),
    );
    write_report(repo.path(), TOOLCHAIN_TEST_REPORT_PATH, &json);

    let tests = read_test_report(repo.path()).expect("a report that parsed is reported");
    assert_eq!(tests.failures.len(), TOOLCHAIN_TEST_FAILURE_LIMIT);
    assert!(tests.failures_truncated);
    assert_eq!(tests.failures[0].name, "case 0", "the first ones are kept");
    assert_eq!(
        tests.failed as usize,
        TOOLCHAIN_TEST_FAILURE_LIMIT + 5,
        "the count is the truth even when the list is not the whole of it"
    );
}

/// A vitest diff of two large objects runs to kilobytes, and the record keeps the
/// head of it: the assertion leads with what it required.
#[test]
fn a_vast_failure_message_is_cut_at_a_character_boundary() {
    let repo = tree();
    let file = inside(repo.path(), "src/game.test.ts");
    let long = format!(
        "AssertionError: {}",
        "é".repeat(TOOLCHAIN_FAILURE_MESSAGE_LIMIT)
    );
    let json = format!(
        r#"{{"numTotalTests":1,"numFailedTests":1,"success":false,"testResults":[
            {{"name":{file},"message":"","assertionResults":[
              {{"fullName":"vast","title":"vast","status":"failed",
                "failureMessages":[{long}]}}]}}]}}"#,
        file = serde_json::to_string(&file).unwrap(),
        long = serde_json::to_string(&long).unwrap(),
    );
    write_report(repo.path(), TOOLCHAIN_TEST_REPORT_PATH, &json);

    let message = read_test_report(repo.path())
        .expect("a report that parsed is reported")
        .failures
        .remove(0)
        .message
        .expect("with its assertion");
    assert!(message.starts_with("AssertionError: é"));
    assert!(message.ends_with('…'), "the cut is marked");
    // The cut lands on a char boundary, so no half-`é` survived: the string round
    // trips as text at all, and everything before the marker is whole.
    assert!(message.len() <= TOOLCHAIN_FAILURE_MESSAGE_LIMIT + '…'.len_utf8());
    assert!(
        message
            .trim_end_matches('…')
            .trim_start_matches("AssertionError: ")
            .chars()
            .all(|c| c == 'é')
    );
}

/// More test files than the cap keeps the lowest paths and says it clipped the list —
/// sorted first, so the retained rows are a pure function of the report.
#[test]
fn more_test_files_than_the_cap_are_sorted_and_truncated() {
    let repo = tree();
    let files: Vec<String> = (0..TOOLCHAIN_TEST_FILE_LIMIT + 3)
        .map(|index| {
            let name = inside(repo.path(), &format!("src/f{index:03}.test.ts"));
            format!(
                r#"{{"name":{name},"message":"","assertionResults":[]}}"#,
                name = serde_json::to_string(&name).unwrap()
            )
        })
        .collect();
    let json = format!(
        r#"{{"numTotalTests":0,"success":true,"testResults":[{}]}}"#,
        files.join(",")
    );
    write_report(repo.path(), TOOLCHAIN_TEST_REPORT_PATH, &json);

    let tests = read_test_report(repo.path()).expect("a report that parsed is reported");
    assert_eq!(tests.files.len(), TOOLCHAIN_TEST_FILE_LIMIT);
    assert!(tests.files_truncated);
    assert_eq!(
        tests.files_run as usize,
        TOOLCHAIN_TEST_FILE_LIMIT + 3,
        "the file count is what ran, not what was retained"
    );
    assert_eq!(tests.files[0].path, "src/f000.test.ts");
}

/// A report naming a file outside the tree is not describing the model's code, so the
/// row is dropped rather than stored under a host path that joins to nothing.
#[test]
fn a_test_file_outside_the_repository_is_dropped() {
    let repo = tree();
    let inside_path = inside(repo.path(), "src/game.test.ts");
    let json = format!(
        r#"{{"numTotalTests":1,"numPassedTests":1,"success":true,"testResults":[
            {{"name":{inside_path},"message":"","assertionResults":[
              {{"fullName":"ok","title":"ok","status":"passed","failureMessages":[]}}]}},
            {{"name":"/somewhere/else/src/other.test.ts","message":"","assertionResults":[
              {{"fullName":"stray","title":"stray","status":"failed",
                "failureMessages":["AssertionError: stray"]}}]}}]}}"#,
        inside_path = serde_json::to_string(&inside_path).unwrap(),
    );
    write_report(repo.path(), TOOLCHAIN_TEST_REPORT_PATH, &json);

    let tests = read_test_report(repo.path()).expect("a report that parsed is reported");
    assert_eq!(tests.files_run, 1, "the outside file does not count");
    assert_eq!(tests.files[0].path, "src/game.test.ts");
    assert!(
        tests.failures.is_empty(),
        "and neither does anything that failed in it"
    );
}

/// The coverage summary, read whole: the `total` row becomes the totals, the per-file
/// rows are keyed relative to the tree, and `branchesTrue`'s `"Unknown"` percentage —
/// which istanbul really does emit as a string — fails nothing.
#[test]
fn a_coverage_summary_parses_its_totals_and_its_files() {
    let repo = tree();
    let json = format!(
        r#"{{"total":{{
              "lines":{{"total":50,"covered":41,"skipped":0,"pct":82}},
              "statements":{{"total":52,"covered":42,"skipped":0,"pct":80.77}},
              "functions":{{"total":10,"covered":9,"skipped":0,"pct":90}},
              "branches":{{"total":8,"covered":5,"skipped":0,"pct":62.5}},
              "branchesTrue":{{"total":0,"covered":0,"skipped":0,"pct":"Unknown"}}}},
            {game}:{{
              "lines":{{"total":40,"covered":36,"skipped":0,"pct":90}},
              "statements":{{"total":41,"covered":36,"skipped":0,"pct":87.8}},
              "functions":{{"total":8,"covered":8,"skipped":0,"pct":100}},
              "branches":{{"total":6,"covered":4,"skipped":0,"pct":66.66}}}},
            {hud}:{{
              "lines":{{"total":10,"covered":5,"skipped":0,"pct":50}},
              "statements":{{"total":11,"covered":6,"skipped":0,"pct":54.54}},
              "functions":{{"total":2,"covered":1,"skipped":0,"pct":50}},
              "branches":{{"total":2,"covered":1,"skipped":0,"pct":"Unknown"}}}}}}"#,
        game = serde_json::to_string(&inside(repo.path(), "src/game.ts")).unwrap(),
        hud = serde_json::to_string(&inside(repo.path(), "src/hud.ts")).unwrap(),
    );
    write_report(repo.path(), TOOLCHAIN_COVERAGE_SUMMARY_PATH, &json);

    let coverage = read_coverage_summary(repo.path()).expect("a summary that parsed is reported");
    assert_eq!(coverage.totals.lines.covered, 41);
    assert_eq!(coverage.totals.lines.total, 50);
    assert_eq!(coverage.totals.lines.pct, Some(82.0));
    assert_eq!(coverage.totals.branches.pct, Some(62.5));

    assert_eq!(coverage.files_measured, 2);
    assert!(!coverage.files_truncated);
    let paths: Vec<&str> = coverage.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, ["src/game.ts", "src/hud.ts"]);
    assert!(
        !paths.contains(&"total"),
        "the roll-up row is not a file and must never appear among them"
    );
    assert_eq!(coverage.files[0].metrics.functions.pct, Some(100.0));
    // A per-file `"Unknown"` is an absence, not a zero: a consumer derives its own
    // figure from `covered`/`total` or renders nothing.
    assert_eq!(coverage.files[1].metrics.branches.pct, None);
    assert_eq!(coverage.files[1].metrics.branches.covered, 1);
}

/// A coverage row for a file outside the tree is dropped, and does not count toward
/// what the report measured.
#[test]
fn a_coverage_row_outside_the_repository_is_dropped() {
    let repo = tree();
    let json = format!(
        r#"{{"total":{{"lines":{{"total":1,"covered":1,"pct":100}}}},
            {game}:{{"lines":{{"total":1,"covered":1,"pct":100}}}},
            "/somewhere/else/src/other.ts":{{"lines":{{"total":9,"covered":0,"pct":0}}}}}}"#,
        game = serde_json::to_string(&inside(repo.path(), "src/game.ts")).unwrap(),
    );
    write_report(repo.path(), TOOLCHAIN_COVERAGE_SUMMARY_PATH, &json);

    let coverage = read_coverage_summary(repo.path()).expect("a summary that parsed is reported");
    assert_eq!(coverage.files_measured, 1);
    assert_eq!(coverage.files[0].path, "src/game.ts");
}

/// More measured files than the cap keeps the lowest paths, flags it, and still
/// reports how many there really were.
#[test]
fn more_coverage_files_than_the_cap_are_sorted_and_truncated() {
    let repo = tree();
    let rows: Vec<String> = (0..TOOLCHAIN_COVERAGE_FILE_LIMIT + 7)
        .map(|index| {
            let key = inside(repo.path(), &format!("src/f{index:03}.ts"));
            format!(
                r#"{}:{{"lines":{{"total":1,"covered":1,"pct":100}}}}"#,
                serde_json::to_string(&key).unwrap()
            )
        })
        .collect();
    let json = format!(
        r#"{{"total":{{"lines":{{"total":1,"covered":1,"pct":100}}}},{}}}"#,
        rows.join(",")
    );
    write_report(repo.path(), TOOLCHAIN_COVERAGE_SUMMARY_PATH, &json);

    let coverage = read_coverage_summary(repo.path()).expect("a summary that parsed is reported");
    assert_eq!(coverage.files.len(), TOOLCHAIN_COVERAGE_FILE_LIMIT);
    assert!(coverage.files_truncated);
    assert_eq!(
        coverage.files_measured as usize,
        TOOLCHAIN_COVERAGE_FILE_LIMIT + 7
    );
    assert_eq!(coverage.files[0].path, "src/f000.ts");
}

/// Nothing to read is not a failure. A case whose config writes no reports — every
/// case version predating this contract — must record an absence and nothing else.
#[test]
fn a_missing_report_is_an_absence() {
    let repo = tree();
    assert!(read_test_report(repo.path()).is_none());
    assert!(read_coverage_summary(repo.path()).is_none());

    // Not even a tree, which is what a run whose collection never landed looks like.
    let missing = repo.path().join("never-collected");
    assert!(read_test_report(&missing).is_none());
    assert!(read_coverage_summary(&missing).is_none());
}

/// A report a runner half-wrote, or wrote as something else entirely, is unreadable —
/// and unreadable is an absence, never an error and never a zero. Recording zeroes
/// here would claim the build shipped no tests on the strength of a broken file.
#[test]
fn an_unreadable_report_is_an_absence() {
    for body in ["", "{", "null", "[]", "not json at all"] {
        let repo = tree();
        write_report(repo.path(), TOOLCHAIN_TEST_REPORT_PATH, body);
        write_report(repo.path(), TOOLCHAIN_COVERAGE_SUMMARY_PATH, body);
        assert!(
            read_test_report(repo.path()).is_none(),
            "a test report of {body:?} must read as an absence"
        );
        assert!(
            read_coverage_summary(repo.path()).is_none(),
            "a coverage summary of {body:?} must read as an absence"
        );
    }
}

/// A coverage document with no `total` row is not a coverage summary: istanbul always
/// writes one, zeroes and all, so its absence means the file is something else.
#[test]
fn a_coverage_summary_without_a_total_row_is_an_absence() {
    let repo = tree();
    let json = format!(
        r#"{{{game}:{{"lines":{{"total":1,"covered":1,"pct":100}}}}}}"#,
        game = serde_json::to_string(&inside(repo.path(), "src/game.ts")).unwrap(),
    );
    write_report(repo.path(), TOOLCHAIN_COVERAGE_SUMMARY_PATH, &json);
    assert!(read_coverage_summary(repo.path()).is_none());
}

/// The test report embeds istanbul's whole `coverageMap` when coverage is on. It is
/// read past and never stored: the figures come from the summary file, and no part of
/// the map may reach the record.
#[test]
fn the_embedded_coverage_map_is_ignored() {
    let repo = tree();
    let game = inside(repo.path(), "src/game.ts");
    let json = format!(
        r#"{{"numTotalTests":1,"numPassedTests":1,"success":true,
            "testResults":[{{"name":{test_file},"message":"","assertionResults":[
              {{"fullName":"ok","title":"ok","status":"passed","failureMessages":[]}}]}}],
            "coverageMap":{{{game}:{{"path":{game},
              "statementMap":{{"0":{{"start":{{"line":1,"column":0}},"end":{{"line":1,"column":null}}}}}},
              "fnMap":{{}},"branchMap":{{"0":{{"locations":[{{"start":{{}},"end":{{}}}}]}}}},
              "s":{{"0":3}},"f":{{}},"b":{{}}}}}}}}"#,
        test_file = serde_json::to_string(&inside(repo.path(), "src/game.test.ts")).unwrap(),
        game = serde_json::to_string(&game).unwrap(),
    );
    write_report(repo.path(), TOOLCHAIN_TEST_REPORT_PATH, &json);

    let tests = read_test_report(repo.path()).expect("the map does not stop the report parsing");
    assert_eq!(tests.total, 1);
    let stored = serde_json::to_string(&tests).expect("the block serializes");
    assert!(
        !stored.contains("statementMap") && !stored.contains("branchMap"),
        "no part of the instrumentation map may reach the record: {stored}"
    );
}

/// A report past the size guard is refused unread. The guard exists because the
/// embedded map's size is a function of the build's source, not of anything this
/// crate controls, and a partial parse of a report is not a figure worth recording.
#[test]
fn a_report_past_the_size_guard_is_refused() {
    let repo = tree();
    // Valid JSON that would otherwise parse, padded past the guard.
    let padding = " ".repeat(REPORT_SIZE_LIMIT as usize + 1);
    write_report(
        repo.path(),
        TOOLCHAIN_TEST_REPORT_PATH,
        &format!(r#"{{"numTotalTests":0,"success":true,"testResults":[]}}{padding}"#),
    );
    assert!(read_test_report(repo.path()).is_none());
}
