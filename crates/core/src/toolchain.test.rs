//! The toolchain contract's bounded excerpt and its two defensive parsers.
//!
//! The parsers exist to read figures out of output the tools were never asked to
//! format for us, so the tests below run them over output shaped exactly as vitest
//! and jest print it — colorized, boxed and all — and over output that carries no
//! such figures at all. **Absence must be an absence**: a runner that reports no
//! coverage is not a runner that reports zero coverage.

use super::*;

/// Output within the cap is kept whole (trailing whitespace aside) and reports
/// itself untruncated.
#[test]
fn short_output_is_kept_verbatim() {
    let (output, truncated) = bounded_output("src/main.ts(3,7): error TS2322\n");
    assert_eq!(output, "src/main.ts(3,7): error TS2322");
    assert!(!truncated);
}

/// A runaway compiler cannot put megabytes on the record: the excerpt is capped,
/// and it keeps BOTH ends, because `tsc` leads with its errors while `vitest` closes
/// with its summary.
#[test]
fn long_output_is_capped_and_keeps_both_ends() {
    let mut raw = String::from("FIRST-LINE\n");
    raw.push_str(&"x".repeat(TOOLCHAIN_OUTPUT_LIMIT * 4));
    raw.push_str("\nLAST-LINE");

    let (output, truncated) = bounded_output(&raw);
    assert!(
        truncated,
        "output past the cap must report itself truncated"
    );
    assert!(
        output.len() <= TOOLCHAIN_OUTPUT_LIMIT + 64,
        "the excerpt must stay within the cap (plus the marker), got {}",
        output.len()
    );
    assert!(output.starts_with("FIRST-LINE"), "the head must survive");
    assert!(output.ends_with("LAST-LINE"), "the tail must survive");
    assert!(output.contains("truncated"), "the cut must be marked");
}

/// Splitting a capped excerpt must never land mid-character.
#[test]
fn the_cap_splits_on_character_boundaries() {
    let raw = "é".repeat(TOOLCHAIN_OUTPUT_LIMIT);
    let (output, truncated) = bounded_output(&raw);
    assert!(truncated);
    // Round-tripping through `String` already proves the excerpt is valid UTF-8; what
    // this asserts is that no half-character survived either cut — everything outside
    // the truncation marker is a whole `é`.
    let content: String = output.replace(TRUNCATION_MARKER, "");
    assert!(!content.is_empty());
    assert!(content.chars().all(|c| c == 'é'), "{content:?}");
}

/// A command's result carries the exit code and the excerpt, and `succeeded` is
/// exactly "ran and exited zero".
#[test]
fn a_command_result_records_its_exit_status() {
    let ok = ToolchainCommandResult::ran("npx tsc --noEmit", Some(0), "");
    assert!(ok.ran && ok.succeeded && ok.detail.is_none());

    let bad = ToolchainCommandResult::ran("npx tsc --noEmit", Some(2), "error TS2322");
    assert!(bad.ran && !bad.succeeded);
    assert_eq!(bad.output, "error TS2322");

    let skipped = ToolchainCommandResult::skipped("npx tsc --noEmit", "not run: install failed");
    assert!(!skipped.ran && !skipped.succeeded);
    assert_eq!(skipped.exit_code, None);
    assert!(skipped.detail.is_some());
}

/// A vitest run reporting passes and failures, colorized the way it colorizes a
/// pipe, and preceded by the `Test Files` line that must NOT be read as a test
/// count.
#[test]
fn vitest_counts_are_parsed_from_real_output() {
    let raw = concat!(
        " \u{1b}[32m✓\u{1b}[0m src/game.test.ts (12)\n",
        " \u{1b}[31m✗\u{1b}[0m src/hud.test.ts (1)\n",
        "\n",
        " Test Files  1 failed | 1 passed (2)\n",
        "      \u{1b}[1mTests\u{1b}[0m  12 passed | 1 failed (13)\n",
        "   Start at  12:00:00\n",
        "   Duration  1.42s\n",
    );
    assert_eq!(parse_test_counts(raw), (Some(13), Some(12), Some(1)));
}

/// A clean vitest run: everything passed, nothing failed.
#[test]
fn a_clean_vitest_run_reports_zero_failures() {
    let raw = " Test Files  3 passed (3)\n      Tests  27 passed (27)\n";
    assert_eq!(parse_test_counts(raw), (Some(27), Some(27), Some(0)));
}

/// Jest's summary is a different shape — comma-separated, with an explicit `total`
/// word — and is read just as well.
#[test]
fn jest_counts_are_parsed_from_real_output() {
    let raw = concat!(
        "Test Suites: 1 failed, 2 passed, 3 total\n",
        "Tests:       1 failed, 12 passed, 13 total\n",
        "Snapshots:   0 total\n",
    );
    assert_eq!(parse_test_counts(raw), (Some(13), Some(12), Some(1)));
}

/// A runner that prints no summary at all reports nothing, not zero. A count of
/// zero here would be a fabricated figure claiming the suite ran and found nothing.
#[test]
fn output_without_a_summary_reports_no_counts() {
    assert_eq!(
        parse_test_counts("npm ERR! Missing script: \"test\"\n"),
        (None, None, None)
    );
    assert_eq!(parse_test_counts(""), (None, None, None));
    // `Test Files` alone is a file count, never a test count.
    assert_eq!(
        parse_test_counts(" Test Files  3 passed (3)\n"),
        (None, None, None)
    );
}

/// The istanbul-style coverage table every provider prints, read from the labelled
/// `% Lines` column of the `All files` row.
#[test]
fn coverage_is_parsed_from_a_real_coverage_table() {
    let raw = concat!(
        " % Coverage report from v8\n",
        "-----------|---------|----------|---------|---------|-------------------\n",
        "File       | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s\n",
        "-----------|---------|----------|---------|---------|-------------------\n",
        "All files  |   85.71 |    72.22 |     100 |   84.13 |\n",
        " game.ts   |   90.00 |    80.00 |     100 |   88.00 | 41-47\n",
        "-----------|---------|----------|---------|---------|-------------------\n",
    );
    assert_eq!(parse_coverage_percent(raw), Some(84.13));
}

/// A genuine zero is a zero: the parser reports what the tool printed.
#[test]
fn zero_coverage_is_reported_as_zero() {
    let raw = concat!(
        "File       | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s\n",
        "All files  |       0 |        0 |       0 |       0 |\n",
    );
    assert_eq!(parse_coverage_percent(raw), Some(0.0));
}

/// A test command run without `--coverage` prints no table, and that is an absence.
#[test]
fn output_without_a_coverage_table_reports_no_coverage() {
    assert_eq!(
        parse_coverage_percent(" Test Files  3 passed (3)\n      Tests  27 passed (27)\n"),
        None
    );
    assert_eq!(parse_coverage_percent(""), None);
}

/// The gate is exactly "the typecheck ran and exited non-zero". A typecheck that
/// never ran does not gate — the run learned nothing about whether it compiles.
#[test]
fn only_a_typecheck_that_ran_and_failed_gates() {
    let base = |typecheck: ToolchainCommandResult| ToolchainSummary {
        install: ToolchainCommandResult::ran("npm ci", Some(0), ""),
        typecheck,
        lint: None,
        format: None,
        test: None,
        smoke: None,
    };

    assert!(!base(ToolchainCommandResult::ran("tsc", Some(0), "")).gates());
    assert!(base(ToolchainCommandResult::ran("tsc", Some(2), "error")).gates());
    assert!(!base(ToolchainCommandResult::skipped("tsc", "install failed")).gates());
}

/// A failing lint, format or test command records a failure and gates nothing.
#[test]
fn the_recorded_commands_never_gate() {
    let summary = ToolchainSummary {
        install: ToolchainCommandResult::ran("npm ci", Some(0), ""),
        typecheck: ToolchainCommandResult::ran("tsc", Some(0), ""),
        lint: Some(ToolchainCommandResult::ran(
            "eslint .",
            Some(1),
            "3 problems",
        )),
        format: Some(ToolchainCommandResult::ran("prettier -c .", Some(1), "")),
        test: Some(ToolchainTestRun {
            result: ToolchainCommandResult::ran("vitest run", Some(1), ""),
            tests_total: Some(13),
            tests_passed: Some(12),
            tests_failed: Some(1),
            coverage_percent: Some(84.13),
        }),
        smoke: Some(ToolchainSmokeResult::not_run("no browser")),
    };
    assert!(!summary.gates());
}

/// A smoke result is only clean when it ran, booted, painted and logged nothing.
#[test]
fn a_smoke_result_is_clean_only_when_every_part_held() {
    let mut smoke = ToolchainSmokeResult {
        ran: true,
        booted: true,
        painted: true,
        console_errors: Vec::new(),
        detail: None,
    };
    assert!(smoke.clean());
    smoke
        .console_errors
        .push("TypeError: x is not a function".to_string());
    assert!(!smoke.clean());
    assert!(!ToolchainSmokeResult::not_run("no browser").clean());
}
