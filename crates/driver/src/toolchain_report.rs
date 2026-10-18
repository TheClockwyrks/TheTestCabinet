//! Reading the report files the case's build test runner wrote.
//!
//! This module is the **one place** a recorded test or coverage figure comes from.
//! The [toolchain stage](crate::toolchain_stage) runs the case's declared `test`
//! command, the case's own build `vitest.config.ts` writes
//! [`TOOLCHAIN_TEST_REPORT_PATH`] and [`TOOLCHAIN_COVERAGE_SUMMARY_PATH`] into the
//! produced implementation's tree, and these two readers turn those files into the
//! bounded blocks that ride on the run record. Nothing here reads a command's
//! terminal output, and nothing may be added that does: a figure derived from a
//! printed table moves when a runner restyles the table, which makes two runs of the
//! same tree incomparable for a reason nobody can see.
//!
//! # Whose tests, whose code
//!
//! Everything read here describes **the model's own tests over the model's own
//! code**. The reports come from the build project (`name: "build"`,
//! `include: ["src/**/*.test.ts"]`, coverage over `src/`), which is the project the
//! model wrote. The case's own validator project — The Test Cabinet's graders, run by
//! [`crate::vitest_validator`] with its own explicit config and its coverage
//! deliberately disabled — writes nothing this module reads and must never contribute
//! a figure to it.
//!
//! # Every failure to read is an absence
//!
//! A missing file, an unreadable file, malformed JSON, a document missing the fields
//! that matter, or a file so large it must be refused: each returns `None`, logs, and
//! fails nothing. That is the whole error contract. The distinction the record needs
//! is *reported* versus *not reported* — a case whose configuration writes no reports
//! at all is the normal state of every case version predating this contract — and a
//! reader that could turn a run red for a report it could not parse would be reading
//! more authority into these files than they have.
//!
//! # The two paths belong to the stage, not to the tree
//!
//! [`discard_reports`] removes both files, and the stage calls it on either side of the
//! `test` command. Before, so a figure can only describe the invocation that just
//! happened: the model runs its own suite inside the container and the collected tree
//! arrives carrying whatever that left behind, and a command that fails to start, or
//! dies before writing, would otherwise have another run's numbers read as its own.
//! After, because the published `implementation/` tree is a copy of what the model
//! produced and these two files are the host's writing — istanbul's whole
//! instrumentation map keyed by absolute host paths, and failure messages carrying the
//! stack frames this module takes care to strip out of the record.
//!
//! # Bounded before it is stored
//!
//! Both readers cap what they retain ([`TOOLCHAIN_COVERAGE_FILE_LIMIT`],
//! [`TOOLCHAIN_TEST_FILE_LIMIT`], [`TOOLCHAIN_TEST_ENTRY_LIMIT`],
//! [`TOOLCHAIN_TEST_FAILURE_LIMIT`], [`TOOLCHAIN_FAILURE_MESSAGE_LIMIT`]) and set the
//! flag that says they did. The test
//! report also embeds istanbul's entire `coverageMap` when coverage is on —
//! `statementMap`, `fnMap`, `branchMap` and the per-file hit counters — which is why
//! no struct here names that field and why the coverage figures are taken from the
//! small, already-aggregated summary file instead.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Deserializer};

use crate::toolchain::{
    CoverageFile, CoverageMetric, CoverageMetrics, TOOLCHAIN_COVERAGE_FILE_LIMIT,
    TOOLCHAIN_COVERAGE_SUMMARY_PATH, TOOLCHAIN_FAILURE_MESSAGE_LIMIT, TOOLCHAIN_TEST_ENTRY_LIMIT,
    TOOLCHAIN_TEST_FAILURE_LIMIT, TOOLCHAIN_TEST_FILE_LIMIT, TOOLCHAIN_TEST_REPORT_PATH,
    ToolchainCoverage, ToolchainTest, ToolchainTestFailure, ToolchainTestFile, ToolchainTestStatus,
    ToolchainTests,
};

/// The most bytes of a report file that will be read at all.
///
/// The test report carries the whole istanbul `coverageMap` inline, and how big that
/// gets is a function of the build's source, not of anything this crate controls. 32
/// MiB is far past any honest report — the probe's was kilobytes — and short of a
/// size that would have the host read a pathological file into memory to learn
/// nothing from it. A file past the guard is refused whole and reported as an
/// absence, because a partial parse of a report is not a figure anyone should record.
const REPORT_SIZE_LIMIT: u64 = 32 * 1024 * 1024;

/// The key `coverage-summary.json` rolls every measured file up under. It is not a
/// file and must never appear among the per-file rows.
const COVERAGE_TOTAL_KEY: &str = "total";

/// Remove both report files from `repo`, if they are there.
///
/// Best-effort and silent about an absent file, which is the ordinary case: most trees
/// have never had one written. A file that exists and cannot be removed is logged and
/// left, because nothing here may fail a run — the `ran` gate on the reads is what keeps
/// a leftover from being recorded even then.
pub fn discard_reports(repo: &Path) {
    for relative in [TOOLCHAIN_TEST_REPORT_PATH, TOOLCHAIN_COVERAGE_SUMMARY_PATH] {
        let path = repo.join(relative);
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => tracing::debug!(
                path = %path.display(),
                error = %err,
                "could not remove a toolchain report file",
            ),
        }
    }
}

/// Read the runner's JSON report out of `repo`, or `None` when there is nothing to
/// read.
///
/// A report that parsed is returned even when it says nothing ran: `total: 0` is the
/// runner stating that the build shipped no tests, which is a finding. Only a report
/// that could not be read at all is an absence.
pub fn read_test_report(repo: &Path) -> Option<ToolchainTests> {
    let json = read_report(repo, TOOLCHAIN_TEST_REPORT_PATH)?;
    let document: TestReportDocument = match serde_json::from_str(&json) {
        Ok(document) => document,
        Err(err) => {
            tracing::debug!(
                path = TOOLCHAIN_TEST_REPORT_PATH,
                error = %err,
                "the test report could not be parsed",
            );
            return None;
        }
    };

    let roots = report_roots(repo);
    let mut files = Vec::new();
    let mut tests = Vec::new();
    let mut tests_truncated = false;
    let mut failures = Vec::new();
    let mut failures_truncated = false;
    let mut files_failed = 0u32;

    for file in document.test_results {
        // A file the reporter names outside the tree is not the model's work — a
        // stray absolute path from a runner run somewhere else — so it is dropped
        // rather than stored with a host path nobody can join anything to.
        let Some(path) = relative_under(&file.name, &roots) else {
            tracing::debug!(
                name = %file.name,
                "the test report named a file outside the implementation",
            );
            continue;
        };
        let mut passed = 0u32;
        let mut failed = 0u32;
        let mut skipped = 0u32;
        for test in file.assertion_results {
            let status = test.status();
            match status {
                ToolchainTestStatus::Passed => passed += 1,
                ToolchainTestStatus::Failed => {
                    failed += 1;
                    // The reporter's own order is kept: a reader wants what broke
                    // first, not the alphabetically first thing that broke.
                    if failures.len() < TOOLCHAIN_TEST_FAILURE_LIMIT {
                        failures.push(ToolchainTestFailure {
                            file: path.clone(),
                            name: test.label(),
                            message: bounded_message(
                                &test
                                    .failure_messages
                                    .iter()
                                    .map(|message| {
                                        crate::vitest_validator::sanitize_failure(message)
                                    })
                                    .collect::<Vec<_>>()
                                    .join("\n\n"),
                            ),
                        });
                    } else {
                        failures_truncated = true;
                    }
                }
                ToolchainTestStatus::Skipped => skipped += 1,
            }
            // Capped on the way in and in the reporter's order, so what is retained is
            // the head of the suite as it ran rather than whichever entries a later
            // pass happened to keep.
            if tests.len() < TOOLCHAIN_TEST_ENTRY_LIMIT {
                tests.push(ToolchainTest {
                    file: path.clone(),
                    name: test.label(),
                    status,
                    duration_ms: test.duration,
                });
            } else {
                tests_truncated = true;
            }
        }
        // A file that failed to load ran no tests at all, so its failure lives in the
        // file-level message rather than in any assertion — and it still counts as a
        // failing file.
        let message = bounded_message(&crate::vitest_validator::sanitize_failure(
            file.message.as_deref().unwrap_or_default(),
        ));
        if failed > 0 || message.is_some() {
            files_failed += 1;
        }
        files.push(ToolchainTestFile {
            path,
            passed,
            failed,
            skipped,
            message,
        });
    }

    let files_run = files.len() as u32;
    // Sorted before capping, so the retained rows are a pure function of the report
    // and two runs over the same tree store the same ones.
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let files_truncated = files.len() > TOOLCHAIN_TEST_FILE_LIMIT;
    files.truncate(TOOLCHAIN_TEST_FILE_LIMIT);

    Some(ToolchainTests {
        // The totals are the document's own counters rather than a re-addition of the
        // rows above, so a report clipped by the file cap still states the truth.
        total: document.num_total_tests,
        passed: document.num_passed_tests,
        failed: document.num_failed_tests,
        // Saturating, not wrapping: a nonsense report must not be able to panic a
        // reader whose whole contract is that it cannot fail the run.
        skipped: document
            .num_pending_tests
            .saturating_add(document.num_todo_tests),
        files_run,
        files_failed,
        succeeded: document.success,
        files,
        files_truncated,
        failures,
        failures_truncated,
        tests,
        tests_truncated,
    })
}

/// Read istanbul's coverage summary out of `repo`, or `None` when there is nothing to
/// read.
///
/// A summary with no `total` row is not a coverage summary — istanbul always writes
/// one, zeroes and all — so a document without it is treated as unreadable rather
/// than as coverage of nothing.
pub fn read_coverage_summary(repo: &Path) -> Option<ToolchainCoverage> {
    let json = read_report(repo, TOOLCHAIN_COVERAGE_SUMMARY_PATH)?;
    let document: BTreeMap<String, SummaryRow> = match serde_json::from_str(&json) {
        Ok(document) => document,
        Err(err) => {
            tracing::debug!(
                path = TOOLCHAIN_COVERAGE_SUMMARY_PATH,
                error = %err,
                "the coverage summary could not be parsed",
            );
            return None;
        }
    };

    let totals = document.get(COVERAGE_TOTAL_KEY).map(SummaryRow::metrics)?;
    let roots = report_roots(repo);
    let mut files: Vec<CoverageFile> = document
        .iter()
        .filter(|(key, _)| key.as_str() != COVERAGE_TOTAL_KEY)
        .filter_map(|(key, row)| {
            relative_under(key, &roots).map(|path| CoverageFile {
                path,
                metrics: row.metrics(),
            })
        })
        .collect();

    // What the reporter measured, which is not the number of files matching the
    // config's `include`: istanbul omits a source file it found nothing to
    // instrument in, and the two can legitimately differ.
    let files_measured = files.len() as u32;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let files_truncated = files.len() > TOOLCHAIN_COVERAGE_FILE_LIMIT;
    files.truncate(TOOLCHAIN_COVERAGE_FILE_LIMIT);

    Some(ToolchainCoverage {
        totals,
        files,
        files_measured,
        files_truncated,
    })
}

/// Read one report file under `repo`, refusing anything past [`REPORT_SIZE_LIMIT`].
///
/// The size is taken from the directory entry before the read, so an implausible file
/// is never held in memory at all.
fn read_report(repo: &Path, relative: &str) -> Option<String> {
    let path = repo.join(relative);
    let size = std::fs::metadata(&path).ok()?.len();
    if size > REPORT_SIZE_LIMIT {
        tracing::warn!(
            path = %path.display(),
            size,
            limit = REPORT_SIZE_LIMIT,
            "a toolchain report file is implausibly large",
        );
        return None;
    }
    match std::fs::read_to_string(&path) {
        // Both reports are JSON OBJECTS, and the check is not pedantry: every field
        // below defaults, and serde will happily fill an all-defaulting struct from a
        // JSON *array*, so a `[]` left by something else entirely would otherwise
        // parse into a confident report of zero tests. A document that does not open
        // with `{` is not one of these files.
        Ok(json) if json.trim_start().starts_with('{') => Some(json),
        Ok(_) => {
            tracing::debug!(
                path = %path.display(),
                "a toolchain report file is not a JSON object",
            );
            None
        }
        Err(err) => {
            // The overwhelmingly common case is a case whose config writes no report,
            // which is not worth a louder level than debug.
            tracing::debug!(
                path = %path.display(),
                error = %err,
                "no toolchain report file to read",
            );
            None
        }
    }
}

/// The spellings of the implementation's root a report may have used.
///
/// Both reporters name a file by its real path, which is not the path the tree was
/// reached by when any component of it is a symlink (a `/tmp` that resolves to
/// `/private/tmp`, a collected tree behind a link). Offering both spellings and taking
/// the first that matches is what keeps a report readable in either case.
fn report_roots(repo: &Path) -> Vec<PathBuf> {
    let mut roots = vec![repo.to_path_buf()];
    if let Ok(canonical) = repo.canonicalize()
        && canonical != roots[0]
    {
        roots.push(canonical);
    }
    roots
}

/// `path` relative to the first of `roots` it lies under, forward slashed, or `None`
/// when it lies under none of them.
///
/// The `None` is load-bearing: an entry outside the implementation is dropped rather
/// than stored under its absolute key, which would leak the host's filesystem layout
/// onto a published record and would join to nothing.
fn relative_under(path: &str, roots: &[PathBuf]) -> Option<String> {
    let path = PathBuf::from(path);
    let relative = roots.iter().find_map(|root| path.strip_prefix(root).ok())?;
    let rendered = relative.to_string_lossy().replace('\\', "/");
    (!rendered.is_empty()).then_some(rendered)
}

/// Bound a stack-stripped message to [`TOOLCHAIN_FAILURE_MESSAGE_LIMIT`] bytes,
/// keeping its head, or `None` when nothing survived the stripping.
///
/// An empty result must be an absence and not `Some("")`: the reporter writes `""`
/// for a file that loaded cleanly, and a `Some("")` on every passing file would read
/// as a message nobody wrote.
fn bounded_message(message: &str) -> Option<String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.len() <= TOOLCHAIN_FAILURE_MESSAGE_LIMIT {
        return Some(trimmed.to_string());
    }
    let end = crate::toolchain::floor_boundary(trimmed, TOOLCHAIN_FAILURE_MESSAGE_LIMIT);
    Some(format!("{}…", &trimmed[..end]))
}

// --- The reporter documents ------------------------------------------------

/// Vitest's JSON reporter document, narrowed to the fields the record carries.
///
/// Every field defaults, so a reporter that omits one leaves a zero rather than
/// failing the whole document. `coverageMap` is deliberately **not** named: serde
/// skips an unnamed key instead of materialising it, which is what keeps istanbul's
/// entire instrumentation map out of this process's memory and off the record.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestReportDocument {
    #[serde(default)]
    num_total_tests: u32,
    #[serde(default)]
    num_passed_tests: u32,
    #[serde(default)]
    num_failed_tests: u32,
    /// Skipped tests, which the document counts as *pending* even though each test
    /// reports its own status as `"skipped"`.
    #[serde(default)]
    num_pending_tests: u32,
    #[serde(default)]
    num_todo_tests: u32,
    #[serde(default)]
    success: bool,
    /// One entry per test FILE. The document's `num*TestSuites` counters are not a
    /// file count — they count `describe` blocks — so the file figures are taken from
    /// the length of this list instead.
    #[serde(default)]
    test_results: Vec<TestReportFile>,
}

/// One test file in the reporter's document.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestReportFile {
    /// The test file's absolute path.
    #[serde(default)]
    name: String,
    /// The file-level message, carrying the error when the file failed to load at all
    /// and so ran no tests. `""` for a file that loaded cleanly.
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    assertion_results: Vec<TestReportAssertion>,
}

/// One test within a file.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestReportAssertion {
    /// The `describe` chain and the title joined, which is what a reader recognises.
    #[serde(default)]
    full_name: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    status: String,
    /// How long the test took, in milliseconds. Vitest writes the test's own
    /// `duration`, which it omits for a test that produced no result at all — a
    /// skipped or todo one — so the field is absent as often as it is present.
    #[serde(default, deserialize_with = "lenient_duration")]
    duration: Option<f64>,
    #[serde(default)]
    failure_messages: Vec<String>,
}

impl TestReportAssertion {
    /// The test's name, falling back to its bare title when the reporter joined no
    /// chain — a top-level `it` has no ancestors to join.
    fn label(&self) -> String {
        if self.full_name.trim().is_empty() {
            self.title.clone()
        } else {
            self.full_name.clone()
        }
    }

    /// The test's status. `skipped`, `pending` and `todo` are the same thing seen from
    /// three spellings — a test the runner declined to decide — and so is any spelling
    /// a future reporter invents: the two decided states are the ones that must be
    /// recognised by name.
    fn status(&self) -> ToolchainTestStatus {
        match self.status.as_str() {
            "passed" => ToolchainTestStatus::Passed,
            "failed" => ToolchainTestStatus::Failed,
            _ => ToolchainTestStatus::Skipped,
        }
    }
}

/// One row of `coverage-summary.json`: the `total` roll-up or one measured file.
///
/// The two rows are not quite the same shape — `total` carries a fifth
/// `branchesTrue` metric that the per-file rows do not — so both are modelled with
/// the four metrics the record keeps and serde ignores the extra.
#[derive(Debug, Default, Deserialize)]
struct SummaryRow {
    #[serde(default)]
    lines: SummaryMetric,
    #[serde(default)]
    statements: SummaryMetric,
    #[serde(default)]
    functions: SummaryMetric,
    #[serde(default)]
    branches: SummaryMetric,
}

impl SummaryRow {
    /// This row as the four metrics the record stores.
    fn metrics(&self) -> CoverageMetrics {
        CoverageMetrics {
            lines: self.lines.metric(),
            statements: self.statements.metric(),
            functions: self.functions.metric(),
            branches: self.branches.metric(),
        }
    }
}

/// One metric of one row.
#[derive(Debug, Default, Deserialize)]
struct SummaryMetric {
    #[serde(default)]
    covered: u32,
    #[serde(default)]
    total: u32,
    #[serde(default, deserialize_with = "lenient_pct")]
    pct: Option<f64>,
}

impl SummaryMetric {
    /// This metric as the record's own type.
    fn metric(&self) -> CoverageMetric {
        CoverageMetric {
            covered: self.covered,
            total: self.total,
            pct: self.pct,
        }
    }
}

/// Istanbul reports a percentage it cannot compute as the string `"Unknown"` rather
/// than omitting the field, so a plain `Option<f64>` fails the whole document on a
/// metric with a zero total. Anything that is not a finite number is an absence.
fn lenient_pct<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<f64>, D::Error> {
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value
        .as_ref()
        .and_then(serde_json::Value::as_f64)
        .filter(|pct| pct.is_finite()))
}

/// A duration a runner omits, nulls, or writes as something other than a number is an
/// absence, not a zero, and must not fail the document around it: one unreadable
/// figure on one test would otherwise cost the record every figure in the report. A
/// negative duration is not a measurement either.
fn lenient_duration<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<f64>, D::Error> {
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value
        .as_ref()
        .and_then(serde_json::Value::as_f64)
        .filter(|duration| duration.is_finite() && *duration >= 0.0))
}

#[cfg(test)]
#[path = "toolchain_report.test.rs"]
mod tests;
