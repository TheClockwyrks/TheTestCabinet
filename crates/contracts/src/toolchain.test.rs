//! The toolchain contract: the bounded excerpt, the gate, and what the record says.
//!
//! There are no parser tests here any more. The test and coverage figures are no
//! longer scraped out of what a command printed — they are read from the report files
//! the runner wrote, which [`crate::toolchain_report`] owns and tests. What is left
//! is the contract itself: an excerpt that stays inside its cap without mangling a
//! character, and a gate that fires for exactly one command in exactly one state.

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
            tests: Some(ToolchainTests {
                total: 13,
                passed: 12,
                failed: 1,
                files_run: 2,
                files_failed: 1,
                ..Default::default()
            }),
            coverage: None,
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

/// A `test` block that is present with zeroes says the build shipped no tests, and a
/// block that is absent says nothing was reported. The two must not collapse into one
/// another: a consumer renders the first and renders nothing for the second.
///
/// Asserted on the JSON rather than on the struct, because the struct cannot tell them
/// apart in a way a consumer can see. `Option` is a Rust distinction; what reaches the
/// console is a document in which the key is either an object of zeroes or is not there
/// at all, and that difference exists only because of the `skip_serializing_if` on the
/// field. Dropping that attribute — or defaulting an unreported block to a present one —
/// would leave every field of this struct unchanged and every reader downstream wrong.
#[test]
fn a_reported_zero_is_not_the_same_as_nothing_reported() {
    let reported = ToolchainTestRun {
        result: ToolchainCommandResult::ran("npx vitest run --coverage", Some(0), ""),
        tests: Some(ToolchainTests {
            succeeded: true,
            ..Default::default()
        }),
        coverage: None,
    };
    let json = serde_json::to_value(&reported).expect("a reported run serializes");
    assert_eq!(
        json["tests"]["total"], 0,
        "a build that shipped no tests reports a zero, which is a figure: {json}"
    );
    assert_eq!(json["tests"]["succeeded"], true);
    assert!(
        json.get("coverage").is_none(),
        "a config that wrote no coverage summary reports no coverage, not zero coverage: {json}"
    );

    let unreported = ToolchainTestRun {
        result: ToolchainCommandResult::skipped("npx vitest run --coverage", "install failed"),
        tests: None,
        coverage: None,
    };
    let json = serde_json::to_value(&unreported).expect("an unreported run serializes");
    assert!(
        json.get("tests").is_none(),
        "nothing reported is an absent key, not a block of zeroes: {json}"
    );

    // And back, because a consumer of an older record reads the same absence: a document
    // that never carried the keys must not deserialize into zeroes either.
    let round_tripped: ToolchainTestRun =
        serde_json::from_value(json).expect("and an absence deserializes");
    assert_eq!(round_tripped, unreported);
}

/// The record's JSON keeps the coverage metrics beside the path rather than nested
/// under a `metrics` object — the flatten is part of the wire shape, and a consumer
/// reads `file.lines.pct`, not `file.metrics.lines.pct`.
#[test]
fn a_coverage_file_serializes_its_metrics_beside_its_path() {
    let file = CoverageFile {
        path: "src/game.ts".to_string(),
        metrics: CoverageMetrics {
            lines: CoverageMetric {
                covered: 41,
                total: 50,
                pct: Some(82.0),
            },
            ..Default::default()
        },
    };
    let json = serde_json::to_value(&file).expect("a coverage row serializes");
    assert_eq!(json["path"], "src/game.ts");
    assert_eq!(json["lines"]["covered"], 41);
    assert_eq!(json["lines"]["pct"], 82.0);
    assert!(
        json.get("metrics").is_none(),
        "the metrics are flattened onto the row: {json}"
    );
    // A metric istanbul declined to state carries no `pct` key at all, so a consumer
    // sees an absence rather than a zero it can mistake for a measurement.
    assert!(json["branches"].get("pct").is_none());

    let round_tripped: CoverageFile = serde_json::from_value(json).expect("and deserializes");
    assert_eq!(round_tripped, file);
}
