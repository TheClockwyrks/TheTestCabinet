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
//! It is staged for the length of the suite run and taken back out again, whatever
//! the run's outcome, so validation leaves the tree as it found it. The tree a run
//! collects is published verbatim, and the tree `tcab validate` and
//! `tcab capture-baselines` are pointed at is a case's committed reference
//! implementation.
//!
//! # The shared harness is staged beside the case's own
//!
//! The engineless (`none`) validators of every case that has them are written over one
//! shared harness — the browser lifecycle, the injected draw-command recorder, the
//! assertions, the replay format — which lives in the repository as the
//! `@test-cabinet/case-harness` npm package rather than as a copy per case. It is not
//! a dependency the produced tree installs: it is TypeScript source vitest transpiles,
//! so it is COPIED into the staged project as `validation/case-harness/`, a sibling of
//! the case's own `harness.ts`. That sibling placement is the whole trick — one import
//! line resolves both in the case's `validation/<engine>/` directory in the checkout
//! and in the staged `validation/` here.
//!
//! It is read from the host package store the seeder vendors engine runtimes out of
//! (see [`crate::seeding`]), with a repository-checkout fallback, and it is
//! deliberately NOT one of the [`crate::test_case::SHIPPABLE_PACKAGES`] a case may
//! request: nothing may vendor the validators into the run repository, where the model
//! would read them.
//!
//! # The whole directory is staged; only the run's own suites are run
//!
//! A case ships ONE validator directory per engine, holding the suites of every
//! variant, because the variants share nearly all of them. The staged directory is
//! therefore not the suite list: it is a superset of what this run's variant is
//! rated on, and a suite belonging to some OTHER variant would fail against a build
//! that was never asked to satisfy it — Carom's `gyre` suites reach for a debug
//! operation only `gyre`'s workspace seeds, so they fail every `base` build for a
//! reason that is not the build's.
//!
//! So the run is scoped by the CHECKLIST rather than by the directory. The resolved
//! variant's review items already name exactly the suites that decide its points
//! (the `drive_units` of the checklist), and those paths are handed to vitest as
//! its file filters. A
//! suite no item of this variant names is never loaded, so it costs nothing and
//! reports nothing. This needs no cooperation from the case: the manifest's
//! per-variant checklist is the single declaration of which validators apply, and a
//! variant-specific suite is skipped by not being named there.
//!
//! # The suites produce the media, and the runner collects it
//!
//! A browser drive captures its evidence from the outside: the driver screenshots the
//! page and records the tab, so the runner both asks for the media and takes it. A
//! validator suite is inside the build instead, holding the engine it is stepping, so
//! the evidence it can produce is better than a re-shoot — it can arm the engine's
//! [draw-command recorder](crate::test_case::MediaKind::Replay) around exactly the
//! stretch of the scenario its check is about and hand back the operations the build
//! itself issued. Nothing outside the suite knows when that stretch begins.
//!
//! So the suite writes and the runner collects. Before vitest starts, the runner
//! creates the run's media directory and names it to the suites in
//! [`VALIDATION_MEDIA_ENV`]; a suite writes each output the manifest declares for its
//! point to `$TCAB_VALIDATION_MEDIA_DIR/<its own staged path>/<output id>.<ext>`. The
//! per-suite directory is why nothing has to be escaped or flattened: a suite writes
//! under a path it already knows — its own — and two suites of the same name in
//! different directories cannot collide. Once vitest returns, the runner moves each
//! declared output to the flat `<verdict>__<output>.<ext>` name every consumer of
//! validation media addresses (see
//! [`validation_media_name`](crate::validator::validation_media_name)) and removes
//! the scaffolding.
//!
//! An output that is not there is recorded absent, never a failure. Media is the
//! evidence beside a verdict and the assertions are what decide the point, so a suite
//! that passed every check while failing to write its recording still earns its point
//! — and the reviewer sees that there is nothing to look at.
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

use crate::execution::ArtifactCollection;
use crate::test_case::{ReviewOutput, TestCaseVersion, Variant};
use crate::validation::{Assertion, AutoVerdict, DebugScriptOutput, DebugScriptResult};
use crate::validator::{DriveUnit, VALIDATION_SCRIPT_DIR, drive_units, relocate_outputs};

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

/// The environment variable naming the directory a suite writes its declared media
/// outputs into: an absolute host path, created before vitest starts.
///
/// A suite writes to `$TCAB_VALIDATION_MEDIA_DIR/<its own staged path>/<output
/// id>.<ext>` — the staged path being the same one this runner hands vitest as a
/// file filter, so a suite derives it from `import.meta.url` and needs no name of
/// its own. The runner then flattens what it finds there; see the module docs.
///
/// Absolute rather than relative because a vitest project sets its own `root` and a
/// suite may `process.chdir` for reasons of its own, so a relative path would name
/// different directories to the runner and to the suite.
pub const VALIDATION_MEDIA_ENV: &str = "TCAB_VALIDATION_MEDIA_DIR";

/// The local vitest binary a produced tree's install leaves behind.
const VITEST_BIN: &str = "node_modules/.bin/vitest";

/// Where a directory already standing at [`VALIDATION_SCRIPT_DIR`] is held while the
/// staged validator project needs that name, relative to the produced tree.
///
/// Inside the tree so the move is a rename, and under `.tcab/` because that is the
/// runner's own namespace in a produced tree.
const DISPLACED_PROJECT_DIR: &str = ".tcab/displaced-validation";

/// The directory inside the staged validator project the shared harness package is
/// staged at. Every case's suites reach it by a path relative to their own file, so
/// the name is fixed here rather than declared per case.
const CASE_HARNESS_DIR: &str = "case-harness";

/// The shared harness package's name in the host package store.
///
/// Deliberately absent from [`crate::test_case::SHIPPABLE_PACKAGES`]: that allowlist
/// is what a case manifest's `packages` key is validated against, and a case that
/// could name this one would vendor the validators into the run repository — handing
/// the model the tests it is being measured by.
const CASE_HARNESS_PACKAGE: &str = "@test-cabinet/case-harness";

/// Where the shared harness package's `src/` is looked for when the host package
/// store does not carry it, relative to the current directory. Mirrors
/// [`crate::browser::driver_path`]'s candidates, and for the same reason: runs are
/// launched from the repository root, where the npm workspace lives.
const CASE_HARNESS_CANDIDATES: [&str; 2] =
    ["packages/case-harness/src", "../packages/case-harness/src"];

/// How often a running suite is checked for completion while the cap runs down.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// The marker written between the head and the tail of a truncated excerpt.
const TRUNCATION_MARKER: &str = " … output truncated … ";

/// Decide `variant`'s scripted review points by running the case's validator project
/// for `engine` over the tree `artifacts` describes, writing what the suites produce
/// into `media_dir`.
///
/// `media_dir` is a parameter rather than a fixed place inside the tree because the
/// same suites are run twice against two different builds: over a run's collected
/// tree, where the media travels with the published implementation, and over the
/// case's own reference implementation, where it lands in the version folder's
/// committed baseline (see [`crate::validator::capture_baseline_media`]).
///
/// Returns one [`DebugScriptResult`] per verdict unit the case declares a validator
/// for, in declared order, or an empty vec when the case declares none. Each result
/// carries one [`output`](DebugScriptResult::outputs) entry per output the manifest
/// declares for that point, recording whether the suite actually produced it — so an
/// empty list means the point declared no media, never that its media went missing.
pub(crate) fn run_vitest_suites(
    test_case: &TestCaseVersion,
    variant: &Variant,
    engine: &str,
    artifacts: &ArtifactCollection,
    install_command: &str,
    media_dir: &Path,
) -> Vec<DebugScriptResult> {
    let items = test_case.review_items_for_engine(variant, engine);
    let units = drive_units(&items);
    if units.is_empty() {
        return Vec::new();
    }
    let suites: Vec<Suite> = units.iter().map(|unit| Suite::of(unit, engine)).collect();
    let filters = suite_filters(&suites);

    let mut results = match execute(
        test_case,
        engine,
        artifacts,
        install_command,
        &filters,
        media_dir,
    ) {
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
                engine,
                reason,
                "the case's validators could not be run; every point they back is left for the reviewer",
            );
            suites.iter().map(|suite| suite.not_run(&reason)).collect()
        }
    };
    // Collected after the verdicts and regardless of how the run ended. A suite that
    // failed its checks is exactly the one whose recording a reviewer wants to look
    // at, and a run the runner had to abandon may still have suites that wrote their
    // evidence before it did — so what is on disk is kept either way, and the
    // per-suite scaffolding never survives into the collected tree.
    for (result, suite) in results.iter_mut().zip(&suites) {
        result.outputs = suite.collect_media(media_dir);
    }
    tracing::info!(
        engine,
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

/// The staged paths of the suites this variant's checklist names, in declared order.
///
/// These become vitest's file filters, which is what keeps a run to its own
/// variant's suites (see the module docs). No deduplication: a script drives exactly
/// one review item — a case naming the same one twice is refused when the manifest
/// is resolved — so the list is already distinct by construction.
///
/// A suite whose [`file`](Suite::file) is `None` names a validator of some other
/// engine and contributes no filter: there is no file for vitest to be pointed at,
/// and the suite is already reported as not having run.
fn suite_filters(suites: &[Suite]) -> Vec<String> {
    suites
        .iter()
        .filter_map(|suite| suite.file.clone())
        .collect()
}

/// The directory holding `engine`'s validator project inside the case's version
/// folder. A case declares its validators per engine, and this is where it puts
/// them.
pub(crate) fn project_dir(test_case: &TestCaseVersion, engine: &str) -> PathBuf {
    test_case.root.join(VALIDATION_SCRIPT_DIR).join(engine)
}

/// Whether the case ships a validator project for `engine`.
///
/// The presence of the project's own `vitest.config.ts` is the whole test: the
/// project is what makes the suites runnable, and a case that ships one has said
/// its points are decided in process rather than by driving a browser.
pub(crate) fn has_project(test_case: &TestCaseVersion, engine: &str) -> bool {
    project_dir(test_case, engine)
        .join(VITEST_CONFIG_FILE)
        .is_file()
}

/// Stage the case's validator project, run vitest over it, and return the parsed
/// per-file reports.
///
/// `media_dir` is the run's validation media directory: it is created here, before
/// vitest starts, and named to the suites in [`VALIDATION_MEDIA_ENV`] so each of them
/// can write the outputs its point declares. The runner collects what they wrote once
/// this returns.
///
/// `Err` is reserved for a failure of the runner itself, which is a fact about the
/// host or the case rather than about the build, and every suite is reported as not
/// having run because of it.
fn execute(
    test_case: &TestCaseVersion,
    engine: &str,
    artifacts: &ArtifactCollection,
    install_command: &str,
    filters: &[String],
    media_dir: &Path,
) -> Result<Vec<SuiteReport>, String> {
    let repo = &artifacts.repo_path;
    let project = project_dir(test_case, engine);
    if !project.join(VITEST_CONFIG_FILE).is_file() {
        return Err(format!(
            "the case declares no `{VALIDATION_SCRIPT_DIR}/{engine}/{VITEST_CONFIG_FILE}` \
             validator project",
        ));
    }
    // Nothing to point vitest at. Running it unfiltered would collect the whole
    // staged directory — every other variant's suites included — which is the one
    // thing the filters exist to prevent, so the run is refused instead and every
    // point is left for the reviewer.
    if filters.is_empty() {
        return Err(format!(
            "every validator this variant declares names a suite of some engine other than \
             `{engine}`, so there was nothing for the runner to run",
        ));
    }
    // Staged for the length of this run and no longer: the guard puts the tree back
    // as it was found on every path out of here, including the refusals below.
    let _staged = StagedProject::stage(&project, repo.join(VALIDATION_SCRIPT_DIR))?;
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
    let command = vitest_command(&report_path, filters);
    // The directory exists before the first suite loads, so a suite may write into it
    // without creating anything itself — and the media the run collects is only ever
    // under a directory this runner chose.
    std::fs::create_dir_all(media_dir).map_err(|err| {
        format!(
            "could not create the validation media directory `{}`: {err}",
            media_dir.display(),
        )
    })?;
    let ran = run_bounded(
        repo,
        &command,
        VITEST_TIMEOUT,
        scratch.path(),
        "vitest",
        &[(VALIDATION_MEDIA_ENV, absolute(media_dir))],
    )?;

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
///
/// `filters` are vitest's positional file filters — the staged path of every suite
/// this variant's checklist names. They are what keeps a run to its own variant's
/// suites.
///
/// Vitest's rule is a case-insensitive SUBSTRING test against the file's
/// project-relative path, not an exact match, so a filter is only as precise as the
/// path it is given. These are precise: a staged path is rooted at
/// [`VALIDATION_SCRIPT_DIR`] and carries the suite's own `.test.ts` name, so
/// containing it means being it — short of a validator project nesting a second
/// `validation/` directory, or shipping two suites whose paths differ only in case.
fn vitest_command(report_path: &Path, filters: &[String]) -> String {
    let mut command = format!(
        "npx vitest run --config {} --reporter=json --outputFile={}",
        quote(&format!("{VALIDATION_SCRIPT_DIR}/{VITEST_CONFIG_FILE}")),
        quote(&report_path.to_string_lossy()),
    );
    for filter in filters {
        command.push(' ');
        command.push_str(&quote(filter));
    }
    command
}

/// Single-quote `value` for `sh`.
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// The case's validator project, staged into a produced tree for the length of one
/// suite run and taken out again when this drops.
///
/// A validation run leaves the tree as it found it. The tree a run collects is
/// published verbatim — to the run's repository, its artifact tarball, and the
/// analysis of what the model authored — and the tree `tcab validate` and
/// `tcab capture-baselines` are pointed at is a case's committed reference
/// implementation. The staged project is what validation adds to either, so its
/// lifetime is the run's: the guard takes it out again whether the suites ran,
/// failed, or the runner refused them.
///
/// A directory already standing at the project's name is held aside while the run
/// needs it and put back afterwards, so a build that authored one of its own keeps
/// it.
struct StagedProject {
    /// Where the project is staged (the tree's [`VALIDATION_SCRIPT_DIR`]).
    at: PathBuf,
    /// Where whatever already stood at [`Self::at`] is held, or `None` when the name
    /// was free.
    displaced: Option<PathBuf>,
}

impl StagedProject {
    /// Hold aside whatever stands at `at`, then stage `project` there.
    ///
    /// A staging that fails part way through is undone as any other outcome is: the
    /// guard exists before the copy starts, so a host that cannot stage the shared
    /// harness leaves the tree with the case's files it had already copied in.
    fn stage(project: &Path, at: PathBuf) -> Result<Self, String> {
        let staged = Self {
            displaced: displace(&at)?,
            at,
        };
        stage_project(project, &staged.at)?;
        Ok(staged)
    }
}

impl Drop for StagedProject {
    fn drop(&mut self) {
        if let Err(err) = std::fs::remove_dir_all(&self.at)
            && err.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(
                at = %self.at.display(),
                %err,
                "the staged validator project could not be removed from the produced tree",
            );
        }
        let Some(held) = &self.displaced else {
            return;
        };
        if let Err(err) = std::fs::rename(held, &self.at) {
            tracing::warn!(
                held = %held.display(),
                at = %self.at.display(),
                %err,
                "the tree's own directory could not be put back where the validators were staged",
            );
            return;
        }
        // Only the directory this displacement created, and only while it is empty:
        // a tree that carries `.tcab/` for its own reasons keeps it.
        if let Some(parent) = held.parent() {
            let _ = std::fs::remove_dir(parent);
        }
    }
}

/// Move whatever stands at `at` into the tree's holding directory, returning where it
/// is held, or `None` when the name is free.
///
/// The holding directory is inside the tree so the move is a rename rather than a
/// copy, and under `.tcab/` because that is the runner's own namespace in a produced
/// tree. Anything left there by an earlier run that died mid-validation is cleared:
/// what the tree carries now is the only copy worth putting back.
fn displace(at: &Path) -> Result<Option<PathBuf>, String> {
    if !at.exists() {
        return Ok(None);
    }
    let Some(repo) = at.parent() else {
        return Ok(None);
    };
    let held = repo.join(DISPLACED_PROJECT_DIR);
    if held.exists() {
        // Whatever was held is whatever stood at the name, so it is a directory or a
        // file depending on what that tree carried.
        std::fs::remove_dir_all(&held)
            .or_else(|_| std::fs::remove_file(&held))
            .map_err(|err| format!("could not clear `{}`: {err}", held.display()))?;
    }
    if let Some(parent) = held.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("could not create `{}`: {err}", parent.display()))?;
    }
    std::fs::rename(at, &held).map_err(|err| {
        format!(
            "could not hold `{}` aside for the case's validator project: {err}",
            at.display(),
        )
    })?;
    Ok(Some(held))
}

/// Copy the case's validator project for the run's engine into `dest`, replacing
/// whatever stands there, and stage the shared harness package beside it.
///
/// The destination is the project's required location, so a tree that already carries
/// a directory of that name has it replaced: the case's validators are what decides
/// the case's points. Everything that measures the code the model wrote has already
/// run by this point, and [`StagedProject`] is what puts the tree back afterwards.
fn stage_project(project: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        std::fs::remove_dir_all(dest)
            .map_err(|err| format!("could not clear `{}`: {err}", dest.display()))?;
    }
    crate::copy_tree(project, dest)
        .map_err(|err| format!("could not stage the case's validator project: {err}"))?;
    stage_case_harness(dest)
}

/// Copy the shared validator harness into the staged project, so every case's suites
/// resolve it at one relative path.
///
/// The package is SOURCE-only — vitest transpiles the TypeScript in it exactly as it
/// transpiles the case's own, and there is no build step — so what is staged is its
/// `src/` directory and nothing else. It lands as a sibling of the case's own
/// `harness.ts`, which is what makes one import line resolve both in the case's
/// `validation/<engine>/` in the checkout and in the staged `validation/` here.
///
/// It is copied AFTER the case's tree and over the top of anything standing at that
/// name: the package is what decides the case's points, and a case must not be able
/// to shadow it with a stale copy of its own.
///
/// A host with no staged copy is a failure of the runner rather than of the build, so
/// it is reported as such — every point the validators back is left for the reviewer
/// — and the message names both ways to fix it.
fn stage_case_harness(dest: &Path) -> Result<(), String> {
    let source = case_harness_source().ok_or_else(|| {
        format!(
            "the shared validator harness `{CASE_HARNESS_PACKAGE}` was not found in the package \
             store at `{}` — the driver image bakes it there; for a local checkout run \
             `node scripts/stage-tcab-packages.mjs` or point `TCAB_PACKAGE_STORE` at a staged copy",
            crate::seeding::package_store_dir().display(),
        )
    })?;
    let at = dest.join(CASE_HARNESS_DIR);
    if at.exists() {
        std::fs::remove_dir_all(&at)
            .map_err(|err| format!("could not clear `{}`: {err}", at.display()))?;
    }
    crate::copy_tree(&source, &at)
        .map_err(|err| format!("could not stage `{CASE_HARNESS_PACKAGE}`: {err}"))
}

/// The shared harness package's `src/` on this host.
///
/// The package store first — what the driver image bakes and what `TCAB_PACKAGE_STORE`
/// overrides, the SAME store the seeder vendors engine runtimes out of, so the two can
/// never disagree about what a run was validated against — then the repository
/// checkout a `tcab` invoked from the repo root sits in. The checkout candidates are
/// relative to the current directory, exactly as
/// [`crate::browser::driver_path`]'s are: a run is launched from the repository root,
/// which is also where the npm workspace lives.
fn case_harness_source() -> Option<PathBuf> {
    let stored = crate::seeding::package_store_dir()
        .join(CASE_HARNESS_PACKAGE)
        .join("src");
    if stored.is_dir() {
        return Some(stored);
    }
    CASE_HARNESS_CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_dir())
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
        &[],
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
///
/// `env` is set on top of the runner's own inherited environment — the one channel the
/// runner has to a suite it never calls directly.
fn run_bounded(
    repo: &Path,
    command: &str,
    timeout: Duration,
    scratch: &Path,
    tag: &str,
    env: &[(&str, String)],
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
        .envs(env.iter().map(|(name, value)| (*name, value)))
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
    /// The failure message vitest reported, unbounded, with every stack frame
    /// stripped; the excerpt is taken when the assertion is built.
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
                .map(|message| sanitize_failure(&message))
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
                    failure: (!test.failure_messages.is_empty()).then(|| {
                        test.failure_messages
                            .iter()
                            .map(|message| sanitize_failure(message))
                            .collect::<Vec<_>>()
                            .join("\n")
                    }),
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
    /// The media outputs the manifest declares for this point, in declared order —
    /// what the suite is expected to write and what the runner then collects.
    outputs: Vec<ReviewOutput>,
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
            outputs: unit.validation.outputs.clone(),
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
            // Every declared output, recorded absent. That is the honest answer for a
            // run that never reached the suites at all, and the caller replaces it
            // with what the suite actually wrote when there was a run to collect
            // from. An empty list here means the point declares no media.
            outputs: self.declared_media(),
        }
    }

    /// This suite's declared outputs, each recorded as not produced.
    fn declared_media(&self) -> Vec<DebugScriptOutput> {
        self.outputs
            .iter()
            .map(|output| DebugScriptOutput {
                id: output.id.clone(),
                name: output.name.clone(),
                kind: output.kind,
                actual_present: false,
            })
            .collect()
    }

    /// Move whatever the suite wrote for its declared outputs out of its own
    /// directory under `media_dir` and into the flat names the run serves them
    /// under, reporting which of them arrived.
    ///
    /// The suite wrote to `<media_dir>/<its staged path>/<output id>.<ext>`, which is
    /// precisely the shape [`relocate_outputs`] already flattens for a browser drive
    /// — the browser driver's per-drive temp directory is named by output id in the
    /// same way — so the two paths share one implementation and cannot drift into
    /// naming a run's media differently.
    fn collect_media(&self, media_dir: &Path) -> Vec<DebugScriptOutput> {
        // No staged file is a validator of some other engine: nothing ran, and no
        // directory was ever named to a suite, so every declared output is absent.
        let Some(file) = self.file.as_deref() else {
            return self.declared_media();
        };
        let produced = media_dir.join(file);
        let collected = relocate_outputs(&self.outputs, &self.verdict_id, media_dir, &produced);
        prune(&produced, media_dir);
        collected
            .into_iter()
            .map(|output| DebugScriptOutput {
                id: output.id,
                name: output.name,
                kind: output.kind,
                actual_present: output.present,
            })
            .collect()
    }
}

/// Remove the directory a suite wrote its outputs into, along with every parent it
/// leaves empty, stopping at `media_dir`.
///
/// The nesting is scaffolding: it exists so a suite can be told where to write using
/// a path it already knows — its own — rather than a flat name it would have to
/// escape. Once the outputs are relocated it is a second copy of the validator
/// project's directory shape sitting inside the collected run, so it goes. A parent
/// that is not empty belongs to a suite that has not been collected yet, and the
/// walk stops there.
fn prune(produced: &Path, media_dir: &Path) {
    if std::fs::remove_dir_all(produced).is_err() {
        // The suite wrote nothing, so there is nothing above it to have emptied
        // either.
        return;
    }
    let mut parent = produced.parent();
    while let Some(dir) = parent {
        if dir == media_dir || !dir.starts_with(media_dir) || std::fs::remove_dir(dir).is_err() {
            return;
        }
        parent = dir.parent();
    }
}

/// `path` as an absolute path, without requiring it to exist.
///
/// [`std::path::absolute`] is lexical: it prepends the process's working directory
/// and normalizes, touching the filesystem only for the working directory itself. A
/// path it cannot resolve is handed back as it stands, which for a runner whose repo
/// path is already absolute — every caller's, in practice — is the same string.
fn absolute(path: &Path) -> String {
    std::path::absolute(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

/// The collected tree's path for a validator declared at `script_rel`.
///
/// A case ships one validator project per engine under
/// `validation/<engine>/`, and the project for the run's engine is staged into the
/// tree at `validation/`. So a declaration relative to the project — which is what
/// a case declaring its validators per engine writes — simply gains that one level,
/// and it names the same suite whichever engine ran.
///
/// A case that instead names the whole version-folder path has the engine level
/// dropped: `validation/<engine>/<rest>` staged at `validation/` is
/// `validation/<rest>`. `None` when such a path names a validator of some **other**
/// engine, which is a case that declared a script the run's engine has none of.
pub(crate) fn staged_path(script_rel: &str, engine_slug: &str) -> Option<String> {
    let Some(rest) = script_rel.strip_prefix(&format!("{VALIDATION_SCRIPT_DIR}/")) else {
        return Some(format!("{VALIDATION_SCRIPT_DIR}/{script_rel}"));
    };
    rest.strip_prefix(&format!("{engine_slug}/"))
        .map(|rest| format!("{VALIDATION_SCRIPT_DIR}/{rest}"))
}

/// The assertion one test contributes, drawing its failure excerpt from the suite's
/// remaining output `budget`.
///
/// A failure that states a comparison — the case's own assertion helpers, or a
/// chai matcher's message — is stored as the real pair: `expected` carries the
/// bound the check set ("at most 8") and `actual` the value the build produced.
/// Anything else falls back to the whole (stack-stripped) message as the actual,
/// against the generic "the check holds".
fn assertion(test: &TestOutcome, budget: &mut usize) -> Assertion {
    let pass = test.status == TestStatus::Passed;
    let pair = (!pass).then(|| match test.failure.as_deref() {
        Some(failure) if *budget > 0 => {
            let limit = VITEST_ASSERTION_LIMIT.min(*budget);
            let (expected, actual) = match parse_expectation(failure) {
                Some((expected, actual)) => (
                    bounded(&expected, VITEST_ASSERTION_LIMIT),
                    bounded(&actual, limit),
                ),
                None => ("the check holds".to_string(), bounded(failure, limit)),
            };
            *budget = budget.saturating_sub(actual.len());
            (expected, actual)
        }
        Some(_) => (
            "the check holds".to_string(),
            TRUNCATION_MARKER.trim().to_string(),
        ),
        None => (
            "the check holds".to_string(),
            "the check failed".to_string(),
        ),
    });
    let (expected, actual) = pair.map_or((None, None), |(e, a)| (Some(e), Some(a)));
    Assertion {
        label: test.label.clone(),
        pass,
        expected,
        actual,
    }
}

/// `message` with every stack frame dropped: the lines V8 appends beneath an
/// error's own text (`    at run (/…/window-fit.test.ts:175:21)`). Frames carry
/// file paths and line numbers that mean nothing to a reviewer, so they never
/// reach a stored assertion or detail.
pub(crate) fn sanitize_failure(message: &str) -> String {
    message
        .lines()
        .filter(|line| !is_stack_frame(line))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// Whether `line` is a V8 stack frame rather than a line of the error's own
/// message. A frame is indented, opens with `at `, and points somewhere: a
/// `file:line:column`, a `node:` internal, a `file://` URL, or a parenthesized
/// call site. An error's own prose that happens to open with "at" is unindented
/// and points nowhere, so it stays.
fn is_stack_frame(line: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.len() == line.len() {
        return false;
    }
    let Some(site) = trimmed.strip_prefix("at ") else {
        return false;
    };
    site.contains("node:")
        || site.contains("file://")
        || has_line_column(site)
        || (site.contains('(') && site.ends_with(')'))
}

/// Whether `text` contains a `:line:column` locator (`:12:34`), the tail every
/// pathful stack frame ends in.
fn has_line_column(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b':' && bytes.get(i + 1).is_some_and(u8::is_ascii_digit) {
            let mut j = i + 1;
            while bytes.get(j).is_some_and(u8::is_ascii_digit) {
                j += 1;
            }
            if bytes.get(j) == Some(&b':') && bytes.get(j + 1).is_some_and(u8::is_ascii_digit) {
                return true;
            }
            i = j;
        } else {
            i += 1;
        }
    }
    false
}

/// The expected/actual pair a failure message states, when it states one.
///
/// Two formats are read. A case's own assertion helpers throw exactly
///
/// ```text
/// Error: Expected: at most 8
/// Actual: 9.097252332435328
/// ```
///
/// and chai's comparison matchers say the same pair in prose ("expected
/// 9.097252332435328 to be less than or equal to 8"). Anything else — a diff, a
/// negated matcher, a thrown non-assertion — is left to the excerpt fallback.
fn parse_expectation(message: &str) -> Option<(String, String)> {
    helper_expectation(message).or_else(|| chai_expectation(message))
}

/// The pair the `Expected:` / `Actual:` lines of an assertion helper's message
/// carry: the `Expected:` line first, the `Actual:` line after it.
fn helper_expectation(message: &str) -> Option<(String, String)> {
    let mut lines = message.lines();
    let expected = lines.find_map(|line| after_marker(line, "Expected: "))?;
    let actual = lines.find_map(|line| after_marker(line, "Actual: "))?;
    (!expected.is_empty() && !actual.is_empty()).then(|| (expected.to_string(), actual.to_string()))
}

/// The text after `marker` at the head of `line`, tolerating the one-word error
/// name vitest serializes ahead of the first line (`Error: Expected: at most 8`).
fn after_marker<'a>(line: &'a str, marker: &str) -> Option<&'a str> {
    let line = line.trim_start();
    if let Some(rest) = line.strip_prefix(marker) {
        return Some(rest.trim());
    }
    let (name, rest) = line.split_once(": ")?;
    if name.contains(' ') {
        return None;
    }
    rest.trim_start().strip_prefix(marker).map(str::trim)
}

/// The pair a chai comparison message carries, read off its first line:
/// `expected {actual} {relation} {bound}`. A negated matcher is not a pair this
/// can state honestly, so it is left to the fallback.
fn chai_expectation(message: &str) -> Option<(String, String)> {
    let line = message.lines().next()?.trim();
    let line = line.strip_prefix("AssertionError: ").unwrap_or(line);
    let rest = line.strip_prefix("expected ")?;
    // `toBe` closes with the comparator it used; the pair reads without it.
    let rest = rest.strip_suffix(" // Object.is equality").unwrap_or(rest);
    if rest.contains(" not ") || rest.starts_with("not ") {
        return None;
    }
    // Longest relation first, so "less than or equal to" is never split at its
    // own "less than".
    const RELATIONS: [(&str, Option<&str>); 9] = [
        (
            " to be less than or equal to ",
            Some("less than or equal to"),
        ),
        (
            " to be greater than or equal to ",
            Some("greater than or equal to"),
        ),
        (" to be less than ", Some("less than")),
        (" to be greater than ", Some("greater than")),
        (" to be close to ", Some("close to")),
        (" to deeply equal ", None),
        (" to strictly equal ", None),
        (" to equal ", None),
        (" to be ", None),
    ];
    for (relation, phrase) in RELATIONS {
        let Some(index) = rest.find(relation) else {
            continue;
        };
        let actual = rest[..index].trim();
        let bound = rest[index + relation.len()..].trim();
        if actual.is_empty() || bound.is_empty() {
            continue;
        }
        // `toBeCloseTo` narrates its arithmetic ("expected 9 to be close to 5,
        // received difference is 4, but expected 0.005"); the pair is the target
        // and its tolerance.
        if relation == " to be close to "
            && let Some((target, tail)) = bound.split_once(", received difference is ")
            && let Some((_, tolerance)) = tail.split_once("but expected ")
        {
            return Some((
                format!("within {} of {}", tolerance.trim(), target.trim()),
                actual.to_string(),
            ));
        }
        let expected = match phrase {
            Some(phrase) => format!("{phrase} {bound}"),
            None => bound.to_string(),
        };
        return Some((expected, actual.to_string()));
    }
    None
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
