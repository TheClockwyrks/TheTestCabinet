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
    /// The optional test command. Recorded, never gating, together with the test
    /// count and coverage it reports.
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
    /// Whether the command ran and exited zero.
    pub succeeded: bool,
    /// A bounded excerpt of the command's combined output, capped at
    /// [`TOOLCHAIN_OUTPUT_LIMIT`] bytes. Empty when the command produced none.
    pub output: String,
    /// Whether [`output`](Self::output) is an excerpt rather than the whole of what
    /// the command printed.
    pub truncated: bool,
    /// Why the command did not run, when it did not. `None` for a command that ran,
    /// whatever it exited with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
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
    /// actually ran rather than a second one describing it.
    fn from(result: &ToolchainCommandResult) -> Self {
        // A failure says why: the reason it never started, or the output it printed
        // when it ran and exited non-zero. A step that succeeded needs no detail.
        let detail = (!result.succeeded)
            .then(|| {
                result
                    .detail
                    .clone()
                    .or_else(|| (!result.output.trim().is_empty()).then(|| result.output.clone()))
            })
            .flatten();
        Self {
            command: result.command.clone(),
            succeeded: result.succeeded,
            detail,
        }
    }
}

/// The optional `test` command's result, plus the figures its output reported.
///
/// The counts and the coverage are parsed **defensively** out of whatever the
/// command printed: a runner that reports neither is not a failure, it is a runner
/// that reports neither, and every figure here is therefore an `Option` whose
/// absence means *not reported* rather than *zero*. A zero here is only ever a zero
/// the tool actually printed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ToolchainTestRun {
    /// The command, its exit status and its bounded output.
    pub result: ToolchainCommandResult,
    /// How many tests ran in total, when the output said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub tests_total: Option<u32>,
    /// How many passed, when the output said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub tests_passed: Option<u32>,
    /// How many failed, when the output said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub tests_failed: Option<u32>,
    /// Line coverage as a percentage (`0.0..=100.0`), read from the coverage
    /// summary table's `All files` row, when the command printed one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub coverage_percent: Option<f64>,
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
fn floor_boundary(text: &str, index: usize) -> usize {
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

/// Strip ANSI SGR/CSI escape sequences from `raw`.
///
/// Test runners colorize by default even when their output is a pipe, so the
/// summary line the parsers below look for arrives wrapped in escapes. Stripping
/// them is what makes "the line starts with `Tests`" true of real output rather
/// than only of output captured with color forced off.
fn strip_ansi(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            out.push(ch);
            continue;
        }
        // `ESC [ … <final>`: consume up to and including the final byte in `@`..`~`.
        if chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if ('\u{40}'..='\u{7e}').contains(&next) {
                    break;
                }
            }
        } else {
            // A non-CSI escape: drop the escape and the single byte that follows.
            chars.next();
        }
    }
    out
}

/// The test counts a runner reported: `(total, passed, failed)`, each `None` when
/// the output did not say.
///
/// Recognizes the summary line vitest and jest both print — `Tests  12 passed | 1
/// failed (13)` — in any order of its `<n> <state>` pairs, with or without the
/// parenthesized total. **Every failure to parse is an absence**, never an error: a
/// runner that prints nothing recognizable leaves all three `None`, which the record
/// reports as *not reported*.
///
/// The last matching line wins, so a run that prints a per-file summary before its
/// final one is read from the final one.
pub fn parse_test_counts(raw: &str) -> (Option<u32>, Option<u32>, Option<u32>) {
    let clean = strip_ansi(raw);
    let mut found: Option<(Option<u32>, u32, u32)> = None;
    for line in clean.lines() {
        let line = line.trim();
        // `Tests` (vitest) / `Tests:` (jest). `Test Files` is a different figure —
        // how many files ran — and must not be read as a test count.
        let Some(rest) = line
            .strip_prefix("Tests:")
            .or_else(|| line.strip_prefix("Tests "))
        else {
            continue;
        };
        let mut passed = 0u32;
        let mut failed = 0u32;
        let mut saw_state = false;
        let mut total: Option<u32> = None;
        let tokens: Vec<&str> = rest.split_whitespace().collect();
        for (index, token) in tokens.iter().enumerate() {
            // `(13)` — the parenthesized grand total vitest closes the line with.
            if let Some(inner) = token.strip_prefix('(').and_then(|t| t.strip_suffix(')')) {
                if let Ok(value) = inner.parse::<u32>() {
                    total = Some(value);
                }
                continue;
            }
            let Ok(count) = token.trim_end_matches(',').parse::<u32>() else {
                continue;
            };
            match tokens.get(index + 1).map(|t| t.trim_end_matches(',')) {
                Some("passed") => {
                    passed += count;
                    saw_state = true;
                }
                Some("failed") => {
                    failed += count;
                    saw_state = true;
                }
                // `skipped` / `todo` are neither passed nor failed but do count
                // toward the total when no parenthesized one was printed.
                Some("skipped") | Some("todo") => saw_state = true,
                _ => {}
            }
        }
        if saw_state {
            found = Some((total, passed, failed));
        }
    }
    match found {
        // With no parenthesized total, the total is what the line accounted for.
        Some((total, passed, failed)) => (
            Some(total.unwrap_or(passed + failed)),
            Some(passed),
            Some(failed),
        ),
        None => (None, None, None),
    }
}

/// The line-coverage percentage a coverage reporter printed, or `None` when the
/// output carried no coverage table.
///
/// Reads the `All files` row of the istanbul-style text summary that vitest (v8 and
/// istanbul providers alike), jest and nyc all emit, taking the column the header
/// labels `% Lines`. When the header cannot be read, it falls back to the fourth
/// numeric cell, which is where `% Lines` sits in that table's fixed column order.
/// Anything unparseable is an absence.
pub fn parse_coverage_percent(raw: &str) -> Option<f64> {
    let clean = strip_ansi(raw);
    let cells = |line: &str| -> Vec<String> {
        line.split('|')
            .map(|cell| cell.trim().to_string())
            .collect()
    };
    let mut lines_column: Option<usize> = None;
    for line in clean.lines() {
        if !line.contains('|') {
            continue;
        }
        let row = cells(line);
        if lines_column.is_none()
            && let Some(index) = row
                .iter()
                .position(|cell| cell.eq_ignore_ascii_case("% Lines"))
        {
            lines_column = Some(index);
        }
        if !row.first().is_some_and(|first| first == "All files") {
            continue;
        }
        // Prefer the labelled column; fall back to the table's fixed fourth
        // numeric column (`% Stmts`, `% Branch`, `% Funcs`, `% Lines`).
        let value = lines_column
            .and_then(|index| row.get(index))
            .and_then(|cell| cell.parse::<f64>().ok())
            .or_else(|| {
                row.iter()
                    .skip(1)
                    .filter_map(|cell| cell.parse::<f64>().ok())
                    .nth(3)
            })?;
        return value.is_finite().then_some(value);
    }
    None
}

#[cfg(test)]
#[path = "toolchain.test.rs"]
mod tests;
