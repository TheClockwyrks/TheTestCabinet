//! The TypeScript toolchain a case declares, and what running it recorded.
//!
//! An end-to-end build is written in TypeScript, and the case ships the TypeScript,
//! lint, format and test configuration its produced implementation compiles under.
//! The manifest's `[toolchain]` table names the commands that check it — a required
//! `typecheck` and the optional `lint`, `format` and `test` — and this module owns
//! both halves of that contract: the [resolved commands](ToolchainCommands) a case
//! declares, and the [summary](ToolchainSummary) of what running them produced,
//! which rides on the run record.
//!
//! # The one gating command
//!
//! `typecheck` **gates**: a non-zero exit rates the run `broken` and scores it zero,
//! because code that does not compile is not reviewable. The other three are
//! *recorded* and leave the run's rating and score to validation and the reviewer.
//! The gate is a predicate on this summary ([`ToolchainSummary::gates`]) and is
//! applied where a run's overall rating and score are *aggregated*
//! ([`crate::review::gated_rating`] / [`crate::review::gated_score`]), never by
//! rewriting a reviewer's stored verdicts. That separation is deliberate: a
//! reviewer's own marks are what they wrote, and the gate is an automated verdict
//! layered over the aggregate, so an implementation that later typechecks re-derives
//! its real score from reviews that were never overwritten.
//!
//! # Figures come from files, never from what a command printed
//!
//! The `test` command's results and its coverage are read from the two report files
//! the case's own build `vitest.config.ts` writes —
//! [`TOOLCHAIN_TEST_REPORT_PATH`] and [`TOOLCHAIN_COVERAGE_SUMMARY_PATH`] — and never
//! from the command's terminal output. A printed table is a layout a runner is free
//! to restyle; a JSON report is a contract. Scraping made every recorded figure
//! hostage to that layout, so the same tree run under two vitest versions could
//! disagree about how many tests it had, for no reason a reader could see. Reading
//! the files also carries detail no table ever did: per-file results, per-file
//! coverage across all four istanbul metrics, and the failures themselves.
//!
//! The bounded [excerpt](ToolchainCommandResult::output) stays exactly as it was. It
//! is the transcript a reviewer reads to see what the command said, and it is no
//! longer a data source for anything.
//!
//! # Bounded by construction
//!
//! Every retained excerpt is capped at [`TOOLCHAIN_OUTPUT_LIMIT`] bytes per command.
//! A compiler that emits ten thousand errors, or a test runner that streams a
//! megabyte of progress dots, must not put that on a record deserialized on every
//! run listing. The full output is not kept anywhere: the excerpt *is* the record of
//! what the command said.

use serde::{Deserialize, Serialize};

/// The most output retained per toolchain command, in bytes.
///
/// 16 KiB is enough to carry a compiler's whole error list for a build that is
/// merely wrong, and small enough that a run record carrying all five excerpts
/// (install, typecheck, lint, format, test) stays well under a hundred kilobytes —
/// the record is deserialized on every run listing, so an unbounded field here would
/// be paid for on every page load of every console.
///
/// When output exceeds the cap the **head and the tail are both kept**, joined by a
/// marker line, rather than one end being dropped. Which end carries the signal
/// depends on the tool: `tsc` leads with its first errors, while `vitest` and
/// `eslint` close with the summary that says how many there were. Keeping both ends
/// means neither tool is the one that loses its message.
pub const TOOLCHAIN_OUTPUT_LIMIT: usize = 16 * 1024;

/// The marker written between the head and the tail of a truncated excerpt.
const TRUNCATION_MARKER: &str = "\n… output truncated …\n";

/// Where the case's build vitest config writes the JSON test report, relative to the
/// produced implementation's repository root.
///
/// The path is a contract between the seeded `vitest.config.ts` and this crate: the
/// config's `outputFile` names it and the [toolchain stage](crate::toolchain_stage)
/// reads it back. It sits under `coverage/`, the one directory the seeded workspace
/// both `.gitignore`s and `.prettierignore`s, so the report is invisible to git, to
/// the static analyzer's walk, and to the `format` command's `prettier --check`.
///
/// The stage owns this path outright while its `test` command runs: it clears the file
/// beforehand so a figure can only ever describe the invocation that just happened, and
/// removes it again once it has been read. The published `implementation/` tree is a
/// copy of what the model produced, and this file is the host's writing — it carries
/// istanbul's whole instrumentation map keyed by absolute host paths, and failure
/// messages with the stack frames the record itself strips.
pub const TOOLCHAIN_TEST_REPORT_PATH: &str = "coverage/test-report.json";

/// Where istanbul's `json-summary` reporter writes the coverage totals, relative to
/// the produced implementation's repository root. `coverage/` is the reporter's own
/// default directory, so this is where it lands with no override.
///
/// Cleared and removed around the `test` command for the same two reasons as
/// [`TOOLCHAIN_TEST_REPORT_PATH`]: every recorded figure describes the invocation that
/// produced it, and the published tree carries only the model's own files. Istanbul
/// keys this document by absolute host path too.
pub const TOOLCHAIN_COVERAGE_SUMMARY_PATH: &str = "coverage/coverage-summary.json";

/// The most per-file coverage rows retained on the record.
///
/// A produced implementation's `src/` is tens of files, not hundreds: the largest
/// reference solution in the repository carries well under thirty. 100 therefore
/// holds every real build whole, with enough headroom that truncation is a genuinely
/// exceptional event rather than a routine one — and the flag beside the array says
/// so when it happens, so a reader never mistakes a clipped list for a short one. The
/// bound exists because this rides on the run record, which is deserialized on every
/// run listing (see [`TOOLCHAIN_OUTPUT_LIMIT`]): at roughly 250 bytes of JSON per
/// row, 100 rows is ~25 KB, which keeps the whole toolchain block in the same order
/// of magnitude it already occupies.
pub const TOOLCHAIN_COVERAGE_FILE_LIMIT: usize = 100;

/// The most per-file test rows retained on the record. Same reasoning and the same
/// number as [`TOOLCHAIN_COVERAGE_FILE_LIMIT`]: the two lists are indexed by the same
/// tree, and a different cap on each would let the coverage list and the test list
/// disagree about how big the build is.
pub const TOOLCHAIN_TEST_FILE_LIMIT: usize = 100;

/// The most individual test failures retained on the record.
///
/// A reader looking at a red suite wants to know what broke first, not to read all
/// four hundred assertions a single broken import can fail. Ten failures is enough to
/// see the shape of the breakage; the totals beside the list say how many there
/// really were.
pub const TOOLCHAIN_TEST_FAILURE_LIMIT: usize = 10;

/// The most bytes retained of one failure message, after stack frames are stripped.
///
/// A vitest diff of two large objects runs to kilobytes. 1 KiB carries the assertion
/// and the head of its diff, and ten of them is 10 KB on a record every listing
/// deserializes. Truncation keeps the HEAD and appends `…`: an assertion message
/// leads with what it required, and the tail is the part that repeats.
pub const TOOLCHAIN_FAILURE_MESSAGE_LIMIT: usize = 1024;

/// The commands a case's `[toolchain]` table declares, resolved onto
/// [`TestCaseVersion`](crate::test_case::TestCaseVersion).
///
/// `typecheck` is required of any case that declares the table at all; the other
/// three are optional and simply absent when not declared. Each runs from the
/// produced implementation's repository root once its dependencies are installed.
///
/// The whole table is optional on a resolved version (`TestCaseVersion::toolchain`
/// is an `Option`) because every case version frozen before it existed declares
/// none, and a frozen version cannot be edited. A case that declares none is not
/// gated and records no toolchain results.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainCommands {
    /// The gating typecheck (conventionally `npx tsc --noEmit`). Required, non-empty.
    pub typecheck: String,
    /// The optional lint command. Recorded, never gating.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lint: Option<String>,
    /// The optional format check. Recorded, never gating.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    /// The optional test command. Recorded, never gating, together with the results
    /// and coverage read from the report files it writes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test: Option<String>,
}

/// What one toolchain command did.
///
/// [`ran`](Self::ran) distinguishes *the command exited non-zero* from *the command
/// was never started* — a declared command whose prerequisite install failed did not
/// fail the check, it never got the chance, and reporting that as a failure would be
/// a fabricated verdict. Only a command that ran and exited non-zero can gate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ToolchainCommandResult {
    /// The command as the manifest declared it, run verbatim through `sh -c`.
    pub command: String,
    /// Whether the command was started at all. `false` when a prerequisite step
    /// failed, when no shell could be spawned, or when the stage ran out of time.
    pub ran: bool,
    /// The process exit status, or `None` when the command never ran (or was killed
    /// by a signal, which leaves no code).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub exit_code: Option<i32>,
    /// Whether the command ran and exited zero — and, for the [verified
    /// install](crate::install), left every package the lockfile declares for the
    /// host on disk.
    pub succeeded: bool,
    /// A bounded excerpt of the command's combined output, capped at
    /// [`TOOLCHAIN_OUTPUT_LIMIT`] bytes. Empty when the command produced none.
    pub output: String,
    /// Whether [`output`](Self::output) is an excerpt rather than the whole of what
    /// the command printed.
    pub truncated: bool,
    /// Why the command did not run, when it did not; or, for an install that ran
    /// and exited zero but still did not succeed, the lockfile packages it left
    /// uninstalled. `None` for any other command that ran, whatever it exited with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
    /// How many times the command was run before this result was final. Present on
    /// the [verified install](crate::install), which is retried; absent on every
    /// command that is run once.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub attempts: Option<u32>,
}

impl ToolchainCommandResult {
    /// A result for a command that was never started, and why.
    pub fn skipped(command: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            command: command.into(),
            ran: false,
            exit_code: None,
            succeeded: false,
            output: String::new(),
            truncated: false,
            detail: Some(detail.into()),
            attempts: None,
        }
    }

    /// A result for a command that ran, from its exit code and raw combined output.
    pub fn ran(command: impl Into<String>, exit_code: Option<i32>, raw_output: &str) -> Self {
        let (output, truncated) = bounded_output(raw_output);
        Self {
            command: command.into(),
            ran: true,
            exit_code,
            succeeded: exit_code == Some(0),
            output,
            truncated,
            detail: None,
            attempts: None,
        }
    }
}

impl From<&ToolchainCommandResult> for crate::validation::StepResult {
    /// Report a toolchain command as a validation build step.
    ///
    /// Validation reports the case's install as a [`StepResult`](crate::validation::StepResult),
    /// and the [toolchain stage](crate::toolchain_stage) runs that same install as a
    /// toolchain command. This is how the one recorded outcome reaches the validation
    /// summary when the stage got there first, so the summary carries the step that
    /// actually ran rather than a second one describing it. The validator's own
    /// steps go through the same conversion, so a step reads the same whichever
    /// path produced it.
    fn from(result: &ToolchainCommandResult) -> Self {
        // A failure says why: the reason it never started, the packages an install
        // left missing, or — for a command that ran and exited non-zero — the output
        // it printed, which is where the real error is. The first line of that detail
        // is always the reason on its own (the exit, or the reason it never ran), with
        // the output excerpt on the lines after it, so a reader that has room for one
        // line — a run's status — can take the reason alone. A step that succeeded
        // needs no detail.
        let detail = (!result.succeeded).then(|| {
            result.detail.clone().unwrap_or_else(|| {
                let output = result.output.trim();
                let how = match result.exit_code {
                    Some(code) => format!("exited {code}"),
                    None => "was killed by a signal".to_string(),
                };
                if output.is_empty() {
                    format!("`{}` {how}", result.command)
                } else {
                    format!("`{}` {how}:\n{output}", result.command)
                }
            })
        });
        Self {
            command: result.command.clone(),
            succeeded: result.succeeded,
            detail,
            output: result.ran.then(|| result.output.clone()),
            attempts: result.attempts,
        }
    }
}

/// One istanbul coverage metric: how many of a thing there are and how many the tests
/// reached.
///
/// [`covered`](Self::covered) and [`total`](Self::total) are the authority and
/// [`pct`](Self::pct) is what istanbul itself printed, carried so a stored figure and
/// the report it came from cannot disagree by a rounding rule. `pct` is an `Option`
/// because istanbul does not always emit a number: a metric with a zero total is
/// reported as the STRING `"Unknown"`, which is an absence, not a zero. A consumer
/// that wants a percentage for a metric whose `pct` is `None` derives it from
/// `covered`/`total`, or renders nothing when `total` is zero.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageMetric {
    /// How many of this thing the tests reached.
    pub covered: u32,
    /// How many of this thing there are in the measured source.
    pub total: u32,
    /// The percentage istanbul reported, when it reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub pct: Option<f64>,
}

/// The four istanbul metrics, for one file or for the whole measured source.
///
/// All four are carried rather than one headline percentage, because branch and
/// function coverage answer questions line coverage cannot: a suite that calls every
/// function once and takes no `else` reads as well-covered on lines alone. Istanbul's
/// `branchesTrue` extra is deliberately not carried — it is a diagnostic of
/// istanbul's own branch bookkeeping, not a figure about the code.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageMetrics {
    /// Executable lines.
    pub lines: CoverageMetric,
    /// Statements, which a single line may hold several of.
    pub statements: CoverageMetric,
    /// Function declarations, including methods and arrow functions.
    pub functions: CoverageMetric,
    /// Branch arms: each side of an `if`, a ternary, a logical operator, a default
    /// parameter and a `switch` case.
    pub branches: CoverageMetric,
}

/// One measured source file's coverage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageFile {
    /// The file's path relative to the implementation's repository root, forward
    /// slashed. Istanbul keys its report by ABSOLUTE host path; storing that would
    /// leak the host's filesystem layout into a published record and would not join
    /// to the static analysis, whose `CodeFileEntry.path` is repo-relative. The
    /// relativisation happens once, when the report is read.
    pub path: String,
    /// What the four metrics said for this file.
    #[serde(flatten)]
    pub metrics: CoverageMetrics,
}

/// What the coverage reporter measured, read from
/// [`TOOLCHAIN_COVERAGE_SUMMARY_PATH`].
///
/// The presence of this whole block is the signal that coverage was reported at all.
/// A case whose config writes no summary file, a command that never ran, and a runner
/// that produced an unreadable file all leave it absent — never present with zeroes
/// in it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ToolchainCoverage {
    /// The `total` row: every measured file rolled up.
    pub totals: CoverageMetrics,
    /// Per-file rows, sorted by path, capped at [`TOOLCHAIN_COVERAGE_FILE_LIMIT`].
    pub files: Vec<CoverageFile>,
    /// How many files the report actually measured, before the cap.
    pub files_measured: u32,
    /// Whether [`files`](Self::files) was cut short by the cap.
    pub files_truncated: bool,
}

/// One test file the runner reported on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ToolchainTestFile {
    /// The file's path relative to the implementation's repository root, forward
    /// slashed. The reporter names it absolutely, for the same reason and with the
    /// same fix as [`CoverageFile::path`].
    pub path: String,
    /// Tests in this file that passed.
    pub passed: u32,
    /// Tests in this file that failed.
    pub failed: u32,
    /// Tests in this file that were skipped, pending or todo — neither passed nor
    /// failed, and counted separately so a suite that skipped half of itself cannot
    /// read as a suite that passed all of itself.
    pub skipped: u32,
    /// The file-level message, when the file failed to load and so ran no tests at
    /// all. Stack frames stripped and bounded, like every other message here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub message: Option<String>,
}

/// One failing test, named and explained.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ToolchainTestFailure {
    /// The test file's repo-relative path.
    pub file: String,
    /// The test's full name — its `describe` chain and its own title, as the reporter
    /// joined them.
    pub name: String,
    /// Why it failed: the reporter's failure messages joined by a blank line, with
    /// every stack frame dropped and the result capped at
    /// [`TOOLCHAIN_FAILURE_MESSAGE_LIMIT`] bytes. Frames carry host paths and line
    /// numbers that mean nothing to a reader of a published record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub message: Option<String>,
}

/// What the runner reported, read from [`TOOLCHAIN_TEST_REPORT_PATH`].
///
/// Present only when that file was written and parsed. A suite that ran and found no
/// tests reports zeroes here — that is a figure the runner actually produced, and it
/// is exactly the signal that a build shipped no tests. The difference between "no
/// tests" and "not reported" is the difference between this block being present with
/// zeroes and being absent.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ToolchainTests {
    /// Every test the runner ran, in every file.
    pub total: u32,
    /// How many of them passed.
    pub passed: u32,
    /// How many of them failed.
    pub failed: u32,
    /// Skipped, pending and todo together.
    pub skipped: u32,
    /// Test FILES the runner loaded.
    pub files_run: u32,
    /// How many of those files had a failure in them, counting a file that failed to
    /// load at all as one.
    pub files_failed: u32,
    /// Whether the runner called the whole invocation a success.
    pub succeeded: bool,
    /// Per-file rows, sorted by path, capped at [`TOOLCHAIN_TEST_FILE_LIMIT`].
    pub files: Vec<ToolchainTestFile>,
    /// Whether [`files`](Self::files) was cut short by the cap.
    pub files_truncated: bool,
    /// The first [`TOOLCHAIN_TEST_FAILURE_LIMIT`] failures, in the reporter's own
    /// order, so the list reads as "what broke" rather than an arbitrary sample.
    pub failures: Vec<ToolchainTestFailure>,
    /// Whether [`failures`](Self::failures) was cut short by the cap.
    /// [`failed`](Self::failed) is always the true count regardless.
    pub failures_truncated: bool,
}

/// The optional `test` command's result, plus the figures its REPORT FILES carried.
///
/// Nothing here is read from what the command printed. The case's build vitest config
/// writes a JSON test report and an istanbul coverage summary into `coverage/`, and
/// these two blocks are those files, parsed and bounded. A figure that no longer
/// moves when a reporter changes its terminal layout is a figure that can be compared
/// across runs; a scraped one is not.
///
/// Both blocks are `Option` and **absence means not reported, never zero**. A case
/// whose config writes no report files — every case version predating this contract,
/// and any case not on the v0.7.0 shape — leaves both absent, and every consumer is
/// required to render nothing at all rather than an empty widget. A zero inside a
/// present block is only ever a zero the runner actually reported.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ToolchainTestRun {
    /// The command, its exit status and its bounded output.
    pub result: ToolchainCommandResult,
    /// What the runner's JSON report said, when it wrote one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub tests: Option<ToolchainTests>,
    /// What the coverage summary said, when one was written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub coverage: Option<ToolchainCoverage>,
}

/// The build smoke check: does the site the build produced actually boot?
///
/// Distinct from — and weaker than — validation's load check, which decides review
/// points. This one answers a single question at the moment the toolchain ran: the
/// built site was served, opened in headless Chromium, and either painted a first
/// frame with a clean console or it did not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ToolchainSmokeResult {
    /// Whether the check could be performed at all: the build produced an output
    /// directory and a browser was available to open it. `false` degrades — a host
    /// with no Node, Playwright or Chromium reports *not checked*, never *failed*.
    pub ran: bool,
    /// Whether the page loaded and its scripts got as far as a first animation
    /// frame.
    pub booted: bool,
    /// Whether that first frame drew anything — a canvas with more than one distinct
    /// pixel, or a laid-out DOM.
    pub painted: bool,
    /// Console errors and uncaught page errors observed while the page booted, each
    /// truncated to a readable length and capped in number. Empty is the clean case.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub console_errors: Vec<String>,
    /// Why the check could not run, or what went wrong while it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
}

impl ToolchainSmokeResult {
    /// A smoke result for a check that could not be performed, and why.
    pub fn not_run(detail: impl Into<String>) -> Self {
        Self {
            ran: false,
            booted: false,
            painted: false,
            console_errors: Vec::new(),
            detail: Some(detail.into()),
        }
    }

    /// Whether the build booted, painted, and logged nothing to the error console.
    pub fn clean(&self) -> bool {
        self.ran && self.booted && self.painted && self.console_errors.is_empty()
    }
}

/// Everything the [toolchain stage](crate::toolchain_stage) recorded for a run,
/// destined for [`RunRecord::toolchain`](crate::run_record::RunRecord::toolchain).
///
/// Absent from a run whose case declares no `[toolchain]` table, and from a run
/// whose tree never reached the host — absence means *not checked*, which the
/// record's `Option` is what encodes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ToolchainSummary {
    /// The dependency install the stage ran before the commands, so that each
    /// command had the dependencies it needs. Reported in its own right because a
    /// failed install is why every command below it reports `ran: false`.
    pub install: ToolchainCommandResult,
    /// The gating typecheck. Always present when the case declares a toolchain,
    /// even when it never ran — *why* it did not run is the whole point of
    /// [`ToolchainCommandResult::ran`].
    pub typecheck: ToolchainCommandResult,
    /// The optional lint command's result, when the case declared one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub lint: Option<ToolchainCommandResult>,
    /// The optional format check's result, when the case declared one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub format: Option<ToolchainCommandResult>,
    /// The optional test command's result and figures, when the case declared one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub test: Option<ToolchainTestRun>,
    /// The build the smoke check served, and the check itself. `None` when the stage
    /// did not get as far as building.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub smoke: Option<ToolchainSmokeResult>,
}

impl ToolchainSummary {
    /// **The gate.** Whether this run is disqualified: the typecheck ran and exited
    /// non-zero.
    ///
    /// A typecheck that never *ran* does not gate. That asymmetry is the important
    /// one — the gate exists to catch code that does not compile, and a stage that
    /// could not install dependencies has learned nothing about whether it compiles.
    /// Failing a run on the strength of a broken host would be exactly the silent,
    /// unearned `broken` this predicate is written to avoid.
    pub fn gates(&self) -> bool {
        self.typecheck.ran && !self.typecheck.succeeded
    }
}

/// Bound `raw` to [`TOOLCHAIN_OUTPUT_LIMIT`] bytes, keeping its head and its tail.
///
/// Returns the excerpt and whether anything was dropped. Splits are moved back to
/// char boundaries, so the result is always valid UTF-8 and never a mangled
/// multi-byte character.
pub fn bounded_output(raw: &str) -> (String, bool) {
    let trimmed = raw.trim_end();
    if trimmed.len() <= TOOLCHAIN_OUTPUT_LIMIT {
        return (trimmed.to_string(), false);
    }
    let half = TOOLCHAIN_OUTPUT_LIMIT / 2;
    let head_end = floor_boundary(trimmed, half);
    let tail_start = ceil_boundary(trimmed, trimmed.len() - (TOOLCHAIN_OUTPUT_LIMIT - half));
    let mut excerpt = String::with_capacity(TOOLCHAIN_OUTPUT_LIMIT + TRUNCATION_MARKER.len());
    excerpt.push_str(&trimmed[..head_end]);
    excerpt.push_str(TRUNCATION_MARKER);
    excerpt.push_str(&trimmed[tail_start..]);
    (excerpt, true)
}

/// The largest char boundary at or below `index`.
pub(crate) fn floor_boundary(text: &str, index: usize) -> usize {
    let mut index = index.min(text.len());
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

/// The smallest char boundary at or above `index`.
fn ceil_boundary(text: &str, index: usize) -> usize {
    let mut index = index.min(text.len());
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

#[cfg(test)]
#[path = "toolchain.test.rs"]
mod tests;
