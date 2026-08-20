//! Runs an engine-backed case's validators as a vitest project over the collected
//! implementation tree.
//!
//! See `docs/validation.md`. A case that supports an [engine](crate::engine) ships
//! one validator per verdict unit as a TypeScript test file, and those files are a
//! vitest project of the case's own. This module is what makes the project real for
//! a run: it stages the project for the run's engine into the collected tree, runs
//! vitest over it with the JSON reporter, and turns each test file's outcome back
//! into the [`DebugScriptResult`] the browser path produces, so the run record, the
//! console, and the reviewer's checklist see one shape whichever path decided a
//! point.
//!
//! # The project is staged, not seeded
//!
//! A validator is reporter-side material and is never seeded into the run
//! container. The case's `validation/<engine>/` directory is copied into the
//! collected tree at [`VALIDATION_SCRIPT_DIR`] once the run's container is gone and
//! the code the model wrote has already been measured. The sibling layout is what
//! the case's own `vitest.config.ts` requires: the config derives its `root` from its
//! own location, so a suite resolves the build's modules by the same relative paths
//! the build itself uses.
//!
//! # Bounded by construction
//!
//! The whole suite run is capped at [`VITEST_TIMEOUT`] of wall clock and the output
//! retained per suite at [`VITEST_OUTPUT_LIMIT`] bytes, exactly as the
//! [toolchain stage](crate::toolchain_stage) bounds its commands. A suite that never
//! terminates costs the run the cap and nothing more.
//!
//! # Every negative answer says which kind it is
//!
//! A suite that ran and failed is the build's result. A suite the runner could not
//! execute at all — no vitest in the tree, no project for the run's engine, the cap
//! exceeded, a report that would not parse — is reported as not having run, with the
//! reason, and decides nothing: no verdict is synthesized and the reviewer decides
//! the point by hand. Between them sits the suite whose checks were all skipped,
//! which is how a validator says its scenario was not constructible against this
//! build (see [`DebugScriptResult::precondition_unmet`]).

#[cfg(test)]
#[path = "vitest_validator.test.rs"]
mod tests;

use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::engine::ResolvedEngine;
use crate::execution::ArtifactCollection;
use crate::test_case::{TestCaseVersion, Variant};
use crate::validation::{Assertion, AutoVerdict, DebugScriptResult};
use crate::validator::{DriveUnit, VALIDATION_SCRIPT_DIR, drive_units};

/// Wall-clock cap on the whole validator suite run.
///
/// A case's validators are a few dozen in-process suites that step a simulation for
/// thousands of frames, so minutes is the honest budget. The cap exists for the suite
/// that never terminates: a validator left waiting on something must cost the run this
/// much and no more.
pub const VITEST_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Wall-clock cap on the dependency install this runner falls back to when nothing
/// prepared the tree. Matches the toolchain stage's install budget, because it is the
/// same command over the same tree.
pub const VITEST_INSTALL_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// The most output retained per suite, in bytes.
///
/// A failing assertion's message carries a diff that can run to kilobytes, and a run
/// record is deserialized on every run listing, so the excerpt a suite contributes is
/// capped as a whole rather than per message.
pub const VITEST_OUTPUT_LIMIT: usize = 4 * 1024;

/// The most output retained for any single failing assertion, in bytes. The suite's
/// whole budget is [`VITEST_OUTPUT_LIMIT`]; this keeps one enormous diff from
/// consuming it before the later failures are reached.
pub const VITEST_ASSERTION_LIMIT: usize = 1024;

/// The vitest project file a case's validator directory must declare.
pub const VITEST_CONFIG_FILE: &str = "vitest.config.ts";

/// The local vitest binary a produced tree's install leaves behind.
const VITEST_BIN: &str = "node_modules/.bin/vitest";

/// How often a running suite is checked for completion while the cap runs down.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// The marker written between the head and the tail of a truncated excerpt.
const TRUNCATION_MARKER: &str = " … output truncated … ";

/// Decide `variant`'s scripted review points by running the case's validator project
/// for `engine` over the collected tree.
///
/// Returns one [`DebugScriptResult`] per verdict unit the case declares a validator
/// for, in declared order, or an empty vec when the case declares none. Every result
/// carries an empty [`outputs`](DebugScriptResult::outputs) list: a validator captures
/// no media, and an empty list is the absence of declared outputs rather than a
/// declared output that went missing.
pub(crate) fn run_vitest_suites(
    test_case: &TestCaseVersion,
    variant: &Variant,
    engine: &ResolvedEngine,
    artifacts: &ArtifactCollection,
    install_command: &str,
) -> Vec<DebugScriptResult> {
    let items = test_case.review_items_for(variant);
    let units = drive_units(&items);
    if units.is_empty() {
        return Vec::new();
    }
    let suites: Vec<Suite> = units
        .iter()
        .map(|unit| Suite::of(unit, engine.slug()))
        .collect();

    let results = match execute(test_case, engine, artifacts, install_command) {
        Ok(reports) => suites
            .iter()
            .map(|suite| {
                suite.result(
                    reports
                        .iter()
                        .find(|report| Some(&report.file) == suite.file.as_ref()),
                )
            })
            .collect::<Vec<_>>(),
        Err(reason) => {
            tracing::warn!(
                engine = engine.slug(),
                reason,
                "the case's validators could not be run; every point they back is left for the reviewer",
            );
            suites.iter().map(|suite| suite.not_run(&reason)).collect()
        }
    };
    tracing::info!(
        engine = engine.slug(),
        points = results.len(),
        decided = results.iter().filter(|result| result.ran).count(),
        passed = results
            .iter()
            .filter(|result| {
                result.ran
                    && !result.verdicts.is_empty()
                    && result.verdicts.iter().all(|verdict| verdict.pass)
            })
            .count(),
        "ran the case's validators over the produced implementation",
    );
    results
}

/// Stage the case's validator project, run vitest over it, and return the parsed
/// per-file reports.
///
/// `Err` is reserved for a failure of the runner itself, which is a fact about the
/// host or the case rather than about the build, and every suite is reported as not
/// having run because of it.
fn execute(
    test_case: &TestCaseVersion,
    engine: &ResolvedEngine,
    artifacts: &ArtifactCollection,
    install_command: &str,
) -> Result<Vec<SuiteReport>, String> {
    let repo = &artifacts.repo_path;
    let project = test_case
        .root
        .join(VALIDATION_SCRIPT_DIR)
        .join(engine.slug());
    if !project.join(VITEST_CONFIG_FILE).is_file() {
        return Err(format!(
            "the case declares no `{VALIDATION_SCRIPT_DIR}/{}/{VITEST_CONFIG_FILE}` validator project",
            engine.slug(),
        ));
    }
    stage_project(&project, &repo.join(VALIDATION_SCRIPT_DIR))?;
    ensure_dependencies(repo, artifacts, install_command)?;
    if !repo.join(VITEST_BIN).exists() {
        return Err(format!(
            "`{VITEST_BIN}` is not present in the produced tree, so the validators could not be run",
        ));
    }

    let scratch = tempfile::Builder::new()
        .prefix("tcab-vitest")
        .tempdir()
        .map_err(|err| format!("could not create a scratch directory: {err}"))?;
    let report_path = scratch.path().join("report.json");
    let command = vitest_command(&report_path);
    let ran = run_bounded(repo, &command, VITEST_TIMEOUT, scratch.path(), "vitest")?;

    let json = std::fs::read_to_string(&report_path).map_err(|_| {
        format!(
            "vitest wrote no JSON report ({}): {}",
            exit_description(ran.code),
            bounded(&ran.combined(), VITEST_OUTPUT_LIMIT),
        )
    })?;
    parse_report(&json, repo)
}

/// The shell line the validators are run with.
///
/// The JSON reporter is written to a file rather than read off stdout so a suite that
/// prints on its own cannot corrupt the report, and the config is named explicitly
/// because the build's own `vitest.config.ts` at the workspace root is a different
/// project entirely.
fn vitest_command(report_path: &Path) -> String {
    format!(
        "npx vitest run --config {} --reporter=json --outputFile={}",
        quote(&format!("{VALIDATION_SCRIPT_DIR}/{VITEST_CONFIG_FILE}")),
        quote(&report_path.to_string_lossy()),
    )
}

/// Single-quote `value` for `sh`.
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// Copy the case's validator project for the run's engine into `dest`, replacing
/// whatever stands there.
///
/// The destination is the project's required location, so a tree that already carries
/// a directory of that name has it replaced: the case's validators are what decides
/// the case's points. Everything that measures the code the model wrote has already
/// run by this point.
fn stage_project(project: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        std::fs::remove_dir_all(dest)
            .map_err(|err| format!("could not clear `{}`: {err}", dest.display()))?;
    }
    crate::copy_tree(project, dest)
        .map_err(|err| format!("could not stage the case's validator project: {err}"))
}

/// Make sure the tree's dependencies are installed, installing only when nothing has.
///
/// The tree reaching validation is normally installed already: the
/// [toolchain stage](crate::toolchain_stage) records the install it completed on the
/// [collection](ArtifactCollection::prepared_install) and the validator reuses or
/// repeats that install before any stage that needs dependencies. Reinstalling would
/// be minutes spent reproducing a state already on disk, so the command runs only for
/// a tree nothing prepared and whose `node_modules` is absent.
fn ensure_dependencies(
    repo: &Path,
    artifacts: &ArtifactCollection,
    install_command: &str,
) -> Result<(), String> {
    if artifacts.prepared_install_for(install_command).is_some()
        || repo.join("node_modules").is_dir()
    {
        return Ok(());
    }
    let scratch = tempfile::Builder::new()
        .prefix("tcab-vitest-install")
        .tempdir()
        .map_err(|err| format!("could not create a scratch directory: {err}"))?;
    let ran = run_bounded(
        repo,
        install_command,
        VITEST_INSTALL_TIMEOUT,
        scratch.path(),
        "install",
    )?;
    if ran.code == Some(0) {
        return Ok(());
    }
    Err(format!(
        "`{}` did not succeed ({}): {}",
        install_command.trim(),
        exit_description(ran.code),
        bounded(&ran.combined(), VITEST_OUTPUT_LIMIT),
    ))
}

/// A finished command's exit status and captured output.
#[derive(Debug)]
struct Ran {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

impl Ran {
    /// The command's output, stdout first, for the one excerpt a reader wants.
    fn combined(&self) -> String {
        let mut combined = self.stdout.clone();
        if !self.stderr.trim().is_empty() {
            if !combined.is_empty() && !combined.ends_with('\n') {
                combined.push('\n');
            }
            combined.push_str(&self.stderr);
        }
        combined
    }
}

/// A human phrase for an exit status, for the reason a runner failure carries.
fn exit_description(code: Option<i32>) -> String {
    match code {
        Some(code) => format!("exit {code}"),
        None => "killed by a signal".to_string(),
    }
}

/// Run one shell line from `repo`, bounded by `timeout`.
///
/// Output is written to files under `scratch` rather than pipes so a suite that prints
/// more than a pipe buffer holds cannot deadlock the runner while it waits. A command
/// that outlives the cap is killed and reported as timed out, never as a failure it
/// earned.
fn run_bounded(
    repo: &Path,
    command: &str,
    timeout: Duration,
    scratch: &Path,
    tag: &str,
) -> Result<Ran, String> {
    let out_path = scratch.join(format!("{tag}.stdout"));
    let err_path = scratch.join(format!("{tag}.stderr"));
    let stdout =
        File::create(&out_path).map_err(|err| format!("could not capture output: {err}"))?;
    let stderr =
        File::create(&err_path).map_err(|err| format!("could not capture output: {err}"))?;

    let mut child = Command::new("sh")
        .arg("-c")
        .arg(command)
        .current_dir(repo)
        // `CI` is what makes a test runner run once and exit instead of dropping into
        // watch mode, and `NO_COLOR` keeps the excerpt readable.
        .env("CI", "1")
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        // Nothing may prompt: a tool waiting on stdin would otherwise burn the whole
        // cap on a question no one is there to answer.
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|err| format!("could not start `sh`: {err}"))?;

    let deadline = Instant::now() + timeout;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {}
            Err(err) => return Err(format!("could not wait on `{}`: {err}", command.trim())),
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "the validators exceeded the {} second cap and were stopped",
                timeout.as_secs(),
            ));
        }
        std::thread::sleep(POLL_INTERVAL);
    };
    Ok(Ran {
        code,
        stdout: std::fs::read_to_string(&out_path).unwrap_or_default(),
        stderr: std::fs::read_to_string(&err_path).unwrap_or_default(),
    })
}

// --- The report ------------------------------------------------------------

/// Vitest's JSON reporter document, narrowed to the fields a verdict is decided from.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReporterDocument {
    #[serde(default)]
    test_results: Vec<ReporterFile>,
}

/// One test file in the JSON reporter's document.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReporterFile {
    /// The test file's absolute path.
    name: String,
    /// The file-level message, which carries the error when a file failed to load at
    /// all and so ran no tests.
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    assertion_results: Vec<ReporterTest>,
}

/// One test within a file.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReporterTest {
    #[serde(default)]
    full_name: String,
    #[serde(default)]
    title: String,
    status: String,
    #[serde(default)]
    failure_messages: Vec<String>,
}

/// What one test did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TestStatus {
    Passed,
    Failed,
    /// Skipped, pending, or todo: the validator declined to decide.
    Skipped,
}

/// One test's outcome, normalized off the reporter document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TestOutcome {
    /// What the test asserts, phrased so it reads true when it passes.
    pub(crate) label: String,
    pub(crate) status: TestStatus,
    /// The failure message vitest reported, unbounded; the excerpt is taken when the
    /// assertion is built.
    pub(crate) failure: Option<String>,
}

/// One test file's outcome, keyed by its tree-relative path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SuiteReport {
    /// The file's path relative to the implementation's repository root, forward
    /// slashed — the key a review item's declared validator is matched on.
    pub(crate) file: String,
    /// The file-level error, present when the file failed before running any test.
    pub(crate) message: Option<String>,
    pub(crate) tests: Vec<TestOutcome>,
}

/// Parse vitest's JSON reporter document into one report per test file.
///
/// Paths are rewritten relative to `repo` so a file matches the review item that
/// declared it regardless of where the tree happens to live on the host.
pub(crate) fn parse_report(json: &str, repo: &Path) -> Result<Vec<SuiteReport>, String> {
    let document: ReporterDocument = serde_json::from_str(json)
        .map_err(|err| format!("vitest's JSON report could not be read: {err}"))?;
    // Vitest reports the file's real path, which is not the path the tree was reached
    // by when any component of it is a symlink, so both spellings of the root are
    // offered and the first that matches decides the key.
    let canonical = repo.canonicalize().ok();
    let roots: Vec<&Path> = std::iter::once(repo).chain(canonical.as_deref()).collect();
    Ok(document
        .test_results
        .into_iter()
        .map(|file| SuiteReport {
            file: relative_to(&file.name, &roots),
            message: file
                .message
                .map(|message| message.trim().to_string())
                .filter(|message| !message.is_empty()),
            tests: file
                .assertion_results
                .into_iter()
                .map(|test| TestOutcome {
                    label: if test.full_name.trim().is_empty() {
                        test.title
                    } else {
                        test.full_name
                    },
                    status: match test.status.as_str() {
                        "passed" => TestStatus::Passed,
                        "failed" => TestStatus::Failed,
                        _ => TestStatus::Skipped,
                    },
                    failure: (!test.failure_messages.is_empty())
                        .then(|| test.failure_messages.join("\n")),
                })
                .collect(),
        })
        .collect())
}

/// A reported path as a forward-slashed path relative to the first of `roots` it lies
/// under, or the path itself when it lies under none of them.
fn relative_to(path: &str, roots: &[&Path]) -> String {
    let path = PathBuf::from(path);
    let relative = roots
        .iter()
        .find_map(|root| path.strip_prefix(root).ok())
        .unwrap_or(&path);
    relative.to_string_lossy().replace('\\', "/")
}

// --- The verdict -----------------------------------------------------------

/// One verdict unit's validator: the identity carried onto its result, and the tree
/// path of the test file that decides it.
pub(crate) struct Suite {
    item_id: String,
    sub_item_id: Option<String>,
    verdict_id: String,
    title: String,
    category_title: String,
    /// The declared validator path, version-folder-relative, for display.
    script_rel: String,
    gates: bool,
    /// The test file's path in the collected tree, or `None` when the declared path
    /// does not name a validator of the run's engine.
    file: Option<String>,
}

impl Suite {
    /// The suite that decides `unit` under `engine_slug`.
    pub(crate) fn of(unit: &DriveUnit<'_>, engine_slug: &str) -> Self {
        Self {
            item_id: unit.item_id.clone(),
            sub_item_id: unit.sub_item_id.clone(),
            verdict_id: unit.verdict_id.clone(),
            title: unit.title.clone(),
            category_title: unit.category_title.clone(),
            script_rel: unit.validation.script_rel.clone(),
            gates: unit.gates,
            file: staged_path(&unit.validation.script_rel, engine_slug),
        }
    }

    /// The result for this suite, given the report of the file that decides it.
    pub(crate) fn result(&self, report: Option<&SuiteReport>) -> DebugScriptResult {
        let Some(report) = report else {
            // The case names a validator vitest did not collect. That is a statement
            // about the case's project, never about the build, so the point is left
            // for the reviewer rather than failed.
            return self.not_run(&format!(
                "the validator project contains no suite at `{}`",
                self.file.as_deref().unwrap_or(&self.script_rel),
            ));
        };
        if report.tests.is_empty() {
            // The file raised before any test ran, which for a validator means the
            // module contract it imports is not there. The case mandates that
            // contract, so this fails the point it backs.
            return DebugScriptResult {
                ran: false,
                precondition_unmet: false,
                detail: Some(bounded(
                    report
                        .message
                        .as_deref()
                        .unwrap_or("the suite ran no checks"),
                    VITEST_OUTPUT_LIMIT,
                )),
                verdicts: vec![contract_failure(
                    &self.verdict_id,
                    report.message.as_deref(),
                )],
                ..self.shell()
            };
        }

        let skipped = report
            .tests
            .iter()
            .filter(|test| test.status == TestStatus::Skipped)
            .count();
        if skipped == report.tests.len() {
            // Every check declined to decide: the validator could not construct its
            // scenario against the world this build invented. Inconclusive about the
            // build, so no verdict is synthesized.
            return self.not_run(
                "every check in the suite was skipped: the scenario was not constructible against this build",
            );
        }

        let mut budget = VITEST_OUTPUT_LIMIT;
        let assertions: Vec<Assertion> = report
            .tests
            .iter()
            .filter(|test| test.status != TestStatus::Skipped)
            .map(|test| assertion(test, &mut budget))
            .collect();
        let pass = assertions.iter().all(|assertion| assertion.pass);
        let detail = (skipped > 0)
            .then(|| format!("{skipped} of the suite's checks were skipped and decided nothing"));
        DebugScriptResult {
            ran: true,
            precondition_unmet: false,
            detail,
            verdicts: vec![AutoVerdict {
                id: self.verdict_id.clone(),
                pass,
                assertions,
            }],
            ..self.shell()
        }
    }

    /// A result recording that this suite did not run, for `reason`, and decided
    /// nothing. No verdict is synthesized, so the point stays unanswered and the
    /// reviewer decides it by hand.
    pub(crate) fn not_run(&self, reason: &str) -> DebugScriptResult {
        DebugScriptResult {
            ran: false,
            precondition_unmet: true,
            detail: Some(bounded(reason, VITEST_OUTPUT_LIMIT)),
            verdicts: Vec::new(),
            ..self.shell()
        }
    }

    /// The identity every result for this suite carries, with the outcome left at its
    /// neutral value for the caller to fill in.
    fn shell(&self) -> DebugScriptResult {
        DebugScriptResult {
            item_id: self.item_id.clone(),
            sub_item_id: self.sub_item_id.clone(),
            title: self.title.clone(),
            category_title: self.category_title.clone(),
            script: self.script_rel.clone(),
            gates: self.gates,
            ran: false,
            precondition_unmet: false,
            detail: None,
            verdicts: Vec::new(),
            // A validator captures no media. The empty list is the absence of any
            // declared output, which the console reads as nothing to show rather than
            // as a declared output that went missing.
            outputs: Vec::new(),
        }
    }
}

/// The collected tree's path for a validator declared at `script_rel`.
///
/// A case declares its validators per engine at
/// `validation/<engine>/<category>/<item>.test.ts`, and the directory for the run's
/// engine is staged into the tree at `validation/`, so the engine level is exactly
/// what the staged path drops. `None` when the declared path names no validator of
/// this engine, which is a case that declared a script the run's engine has none of.
pub(crate) fn staged_path(script_rel: &str, engine_slug: &str) -> Option<String> {
    let prefix = format!("{VALIDATION_SCRIPT_DIR}/{engine_slug}/");
    script_rel
        .strip_prefix(&prefix)
        .map(|rest| format!("{VALIDATION_SCRIPT_DIR}/{rest}"))
}

/// The assertion one test contributes, drawing its failure excerpt from the suite's
/// remaining output `budget`.
fn assertion(test: &TestOutcome, budget: &mut usize) -> Assertion {
    let pass = test.status == TestStatus::Passed;
    let actual = (!pass).then(|| match test.failure.as_deref() {
        Some(failure) if *budget > 0 => {
            let limit = VITEST_ASSERTION_LIMIT.min(*budget);
            let excerpt = bounded(failure, limit);
            *budget = budget.saturating_sub(excerpt.len());
            excerpt
        }
        Some(_) => TRUNCATION_MARKER.trim().to_string(),
        None => "the check failed".to_string(),
    });
    Assertion {
        label: test.label.clone(),
        pass,
        expected: (!pass).then(|| "the check holds".to_string()),
        actual,
    }
}

/// The failed verdict a suite that could not run against a conformant build
/// synthesizes for the point it backs.
fn contract_failure(verdict_id: &str, message: Option<&str>) -> AutoVerdict {
    AutoVerdict {
        id: verdict_id.to_string(),
        pass: false,
        assertions: vec![Assertion {
            label: "the build exposes the module contract this validator imports".to_string(),
            pass: false,
            expected: Some("the suite runs to completion".to_string()),
            actual: Some(bounded(
                message.unwrap_or("the suite ran no checks"),
                VITEST_ASSERTION_LIMIT,
            )),
        }],
    }
}

/// `text` capped at `limit` bytes, keeping both the head and the tail. The result is
/// never longer than `limit`, so a caller spending from a budget can subtract what it
/// got back and stay inside it.
///
/// Which end carries the signal depends on the message: an assertion error leads with
/// what it required, while a stack trace closes with the frame that matters, so
/// neither end is the one that is always dropped.
fn bounded(text: &str, limit: usize) -> String {
    let text = text.trim();
    if text.len() <= limit {
        return text.to_string();
    }
    if limit <= TRUNCATION_MARKER.len() {
        let marker = TRUNCATION_MARKER.trim();
        return marker[..floor_boundary(marker, limit)].to_string();
    }
    let keep = limit - TRUNCATION_MARKER.len();
    let head = floor_boundary(text, keep.div_ceil(2));
    let tail = ceil_boundary(text, text.len() - (keep - head));
    format!("{}{TRUNCATION_MARKER}{}", &text[..head], &text[tail..])
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
