//! Running a suite version's [`validators/`](https://docs.testcabinet.ai/test-suites/validators/)
//! project against the implementation a run produced, and turning what it reports
//! into one outcome per requirement.
//!
//! This is the suite-shaped counterpart of [`crate::vitest_validator`], and it sits
//! beside it rather than inside it: an authored case decides checklist points whose
//! verdict unit is a staged test file, while a suite decides *requirements* whose
//! validators are exported functions the suite claims by module path. Both shapes of
//! test case therefore run side by side, and neither path branches on the other.
//!
//! # What is run
//!
//! A suite version's `validators/` directory is a complete Vitest project rooted at
//! itself. The run builds the produced tree with the definition's `[build]`
//! commands, serves the build output with [`StaticServer`], stages `validators/`
//! into the collected tree, and runs that project with the JSON reporter in browser
//! mode against the served URL.
//!
//! Staging follows the rule the case path already follows: the project is
//! reporter-side material, so it is staged once the container is gone and the code
//! the model wrote has already been measured, and it is taken back out again
//! whatever the outcome. The tree a run collects is published verbatim, and a
//! validator project is not something the model wrote.
//!
//! # Reaching the served build
//!
//! The served port is chosen at run time, so the runner names the base URL to the
//! project in [`VALIDATOR_BASE_URL_ENV`] and the project's own `vitest.config.ts`
//! reads it, falling back to a local development URL when the variable is absent.
//! That fallback is what lets an author run the project standalone from its own
//! directory against a build they are serving themselves.
//!
//! The runner only serves the build and names where. Loading it is the project's
//! own business, declared in its config: the build is reached through Vitest's
//! server and loaded into the document each test file runs in, so a validator
//! observes the implementation in the same document that hosts it. The runner runs
//! that project unchanged, which is what keeps a model's implementation and a
//! reference implementation verified in The Spec Cabinet decided the same way.
//!
//! The [debug API](https://docs.testcabinet.ai/test-suites/debug-apis/) root is
//! reached from that document's `globalThis` through the handle `debug-api.toml`
//! declares, and that handle travels the same way, in
//! [`DEBUG_API_HANDLE_ENV`]. The project therefore reads its suite's handle rather
//! than carrying a literal copy of it.
//!
//! # Mapping results onto requirements
//!
//! The unit Vitest reports is a test file driving one validator module against the
//! served build, so a reported `<path>.test.ts` maps back to the validator module
//! `<path>.ts` — which is exactly the string a requirement's `validators` key lists.
//! Each path is claimed by exactly one requirement across the whole suite (the
//! invariant [`validate`](super::validate) enforces), so the claim is the whole
//! mapping: a requirement collects the results of every validator path it lists.
//!
//! - A requirement passes when every validator it claims ran and every assertion
//!   those validators returned passed.
//! - A requirement fails when any validator it claims returned a failed assertion,
//!   raised, or reported no assertion.
//! - A project the runner could not execute, including one stopped at the cap,
//!   leaves every requirement it covers undecided and leaves the run standing.
//!
//! Only the requirements belonging to the specifications the definition selects are
//! run and recorded. A non-functional requirement declares no validators and is
//! judged by review, so it is recorded carrying no validator outcome at all.
//!
//! # Bounds
//!
//! The wall-clock cap, its environment override and the process-group kill are the
//! case path's, unchanged: a suite's validators finish quickly, so the cap that is
//! generous for an engine-backed case's suites is generous here too.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::browser::StaticServer;
use crate::execution::ArtifactCollection;
use crate::test_case::TestCaseVersion;
use crate::vitest_validator::{
    Caps, RunnerFailure, StagedProject, SuiteReport, TestOutcome, TestStatus,
    VITEST_ASSERTION_LIMIT, VITEST_BIN, VITEST_CONFIG_FILE, VITEST_OUTPUT_LIMIT, bounded,
    ensure_dependencies, exit_description, parse_report, quote, run_bounded,
};

use super::catalog::load_suite_manifest_of;
use super::lowering::{catalog_identity, flatten_specifications, select_specifications};
use super::model::{SuiteRequirementKind, SuiteTestCaseDefinition};
use super::version::{SpecificationFolder, SuiteVersion, VALIDATORS_DIR, VERSION_MANIFEST_FILE};

/// The environment variable naming the base URL the produced build is served at.
///
/// The port is bound at run time, so the project cannot know it in advance. A
/// project run standalone from its own directory finds the variable absent and falls
/// back to the local development URL its own config names, which is how an author
/// drives the same validators against a build they are serving themselves.
pub const VALIDATOR_BASE_URL_ENV: &str = "TCAB_VALIDATOR_BASE_URL";

/// The environment variable naming the `globalThis` property the debug API root is
/// reached by: the `handle` the version's `debug-api.toml` declares.
///
/// Passed rather than compiled in so the project reads its own suite's handle. A
/// version declaring no debug API sets nothing, and the variable is absent.
pub const DEBUG_API_HANDLE_ENV: &str = "TCAB_DEBUG_API_HANDLE";

/// How a requirement was decided for one run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum RequirementStatus {
    /// Every validator the requirement claims ran, and every assertion they
    /// returned passed.
    Passed,
    /// A validator the requirement claims returned a failed assertion, raised, or
    /// reported no assertion at all.
    Failed,
    /// Nothing decided the requirement. Either the runner could not execute the
    /// validator project — including a run stopped at its cap, which is a fact about
    /// the host rather than about the build — or the requirement is non-functional
    /// and is judged by review.
    Undecided,
}

/// One assertion a validator returned, as the validator stated it.
///
/// Retaining each assertion rather than a single verdict is what lets a console show
/// the conditions that ran: an implementation satisfying two of a validator's three
/// conditions is visibly different from one satisfying none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RequirementAssertion {
    /// What the assertion checks, phrased so it reads true when it passes.
    pub name: String,
    /// Whether the condition held.
    pub passed: bool,
    /// The explanation the validator supplied for a failure, when it supplied one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
}

/// What one requirement of the specifications a test case covers came to for one
/// run.
///
/// Keyed by the requirement's suite-wide identity, `<specification id>/<requirement
/// id>` — the same form the seeded specification document writes each requirement
/// under, so a reader of the document and a reader of a result name the same thing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RequirementOutcome {
    /// The requirement's suite-wide identity: `<specification id>/<requirement id>`.
    pub id: String,
    /// The id of the specification declaring the requirement.
    pub specification: String,
    /// The requirement's own id, unique within its specification.
    pub requirement: String,
    /// Whether the requirement is decided by validators or by review.
    pub kind: SuiteRequirementKind,
    /// What the validators decided, or that nothing did.
    pub status: RequirementStatus,
    /// The validator module paths the requirement claims, relative to `validators/`,
    /// in the order it lists them. Empty for a non-functional requirement, which
    /// claims none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub validators: Vec<String>,
    /// Every assertion the claimed validators returned, in validator order. Empty
    /// when nothing ran.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assertions: Vec<RequirementAssertion>,
    /// Why the requirement is not decided by its assertions alone: a validator that
    /// raised, a validator the project reported nothing for, the reason the project
    /// could not be run, or the note that review decides this one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
}

/// The note a non-functional requirement's outcome carries in place of a validator
/// result.
const REVIEWED_DETAIL: &str =
    "a non-functional requirement declares no validator and is judged by review";

/// Decide the requirement outcomes of a suite-defined run by running the suite
/// version's validator project over the build at `output_dir`.
///
/// Returns an empty vec for a test case that is not suite-defined, which is what
/// every authored case is: the case path decides those, and the two never both
/// report on one run.
pub(crate) fn run_suite_validators(
    test_case: &TestCaseVersion,
    artifacts: &ArtifactCollection,
    output_dir: &Path,
    install_command: &str,
) -> Vec<RequirementOutcome> {
    run_suite_validators_bounded(
        test_case,
        artifacts,
        output_dir,
        install_command,
        Caps::from_env(),
    )
}

/// [`run_suite_validators`] under explicit `caps`, so a test can prove what an
/// expired budget records without waiting one out.
fn run_suite_validators_bounded(
    test_case: &TestCaseVersion,
    artifacts: &ArtifactCollection,
    output_dir: &Path,
    install_command: &str,
    caps: Caps,
) -> Vec<RequirementOutcome> {
    let Some(binding) = SuiteBinding::resolve(test_case) else {
        return Vec::new();
    };
    // Nothing to run: the definition covers specifications whose requirements are
    // every one of them judged by review. They are still recorded, because a run
    // that decided nothing by validator is a different answer from a run that never
    // named the requirement at all.
    if binding.claims_nothing() {
        return binding.outcomes(|requirement| requirement.reviewed());
    }

    let outcomes = match execute(&binding, artifacts, output_dir, install_command, caps) {
        Ok(reports) => {
            let by_module = index_by_module(&reports);
            binding.outcomes(|requirement| requirement.decide(&by_module))
        }
        Err(failure) => {
            tracing::warn!(
                suite = binding.suite,
                version = binding.version,
                reason = failure.reason,
                outcome = failure.outcome_tag(),
                "the suite's validators could not be run; every requirement they decide is left \
                 undecided",
            );
            binding.outcomes(|requirement| requirement.undecided(&failure.reason))
        }
    };
    tracing::info!(
        suite = binding.suite,
        version = binding.version,
        requirements = outcomes.len(),
        passed = outcomes
            .iter()
            .filter(|outcome| outcome.status == RequirementStatus::Passed)
            .count(),
        failed = outcomes
            .iter()
            .filter(|outcome| outcome.status == RequirementStatus::Failed)
            .count(),
        "ran the suite's validators over the produced implementation",
    );
    outcomes
}

// --- What the run is measured against ---------------------------------------

/// One requirement of the specifications a definition selects, with the validator
/// modules it claims.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ClaimedRequirement {
    /// The id of the specification declaring it.
    specification: String,
    /// Its own id.
    requirement: String,
    /// Whether validators or review decide it.
    kind: SuiteRequirementKind,
    /// The validator module paths it claims, relative to `validators/`.
    validators: Vec<String>,
}

/// The suite version a run is measured against: where its validator project lives,
/// the handle its debug API is reached by, and the requirements the definition's
/// specifications declare.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SuiteBinding {
    /// The suite's slug, for the log line.
    suite: String,
    /// The version folder name, for the log line.
    version: String,
    /// The version folder on the host, which is the resolved case's root.
    root: PathBuf,
    /// The `globalThis` property the debug API root is set on, when the version
    /// declares a debug API.
    handle: Option<String>,
    /// Every requirement of the selected specifications, in specification order and
    /// then declaration order.
    requirements: Vec<ClaimedRequirement>,
}

impl SuiteBinding {
    /// Read the binding a resolved test case names, or `None` when the case is not
    /// suite-defined.
    ///
    /// A suite-defined case resolves with its `root` at the suite tree, so the
    /// version manifest standing there is what tells the two apart — an authored
    /// case's version folder holds a `test-case.toml` and never a `version.toml`. The
    /// definition itself is found by the identity lowering derived from it, which is
    /// the one string both sides agree on.
    fn resolve(test_case: &TestCaseVersion) -> Option<Self> {
        let root = test_case.root.clone();
        if !root.join(VERSION_MANIFEST_FILE).is_file() {
            return None;
        }
        let version = load_suite_manifest_of(&root)
            .and_then(|suite| SuiteVersion::load(&suite, &root))
            .map_err(|err| {
                tracing::warn!(
                    root = %root.display(),
                    %err,
                    "the suite version this run was resolved from could not be read; no \
                     requirement outcome is recorded",
                );
            })
            .ok()?;
        let definition = version
            .test_cases
            .iter()
            .find(|case| catalog_identity(&version.suite.slug, &case.slug) == test_case.slug)
            .map(|case| &case.definition)?;
        let mut specifications = Vec::new();
        flatten_specifications(&version.specifications, &mut specifications);
        Some(Self {
            suite: version.suite.slug.clone(),
            version: test_case.version.clone(),
            root,
            handle: version
                .debug_api
                .as_ref()
                .and_then(|api| api.root.handle.clone()),
            requirements: claimed_requirements(&specifications, definition),
        })
    }

    /// Whether no requirement of the selected specifications claims a validator, so
    /// there is no project to run.
    fn claims_nothing(&self) -> bool {
        self.requirements
            .iter()
            .all(|requirement| requirement.validators.is_empty())
    }

    /// One outcome per selected requirement, in declared order, with a functional
    /// requirement's decided by `decide` and a non-functional one's recorded as
    /// review's.
    fn outcomes(
        &self,
        decide: impl Fn(&ClaimedRequirement) -> RequirementOutcome,
    ) -> Vec<RequirementOutcome> {
        self.requirements
            .iter()
            .map(|requirement| match requirement.kind {
                SuiteRequirementKind::NonFunctional => requirement.reviewed(),
                SuiteRequirementKind::Functional => decide(requirement),
            })
            .collect()
    }

    /// The test file that drives each claimed validator, as paths relative to the
    /// collected tree — which is what Vitest is handed as its file filters.
    fn filters(&self) -> Vec<String> {
        self.requirements
            .iter()
            .flat_map(|requirement| requirement.validators.iter())
            .map(|module| staged_test_file(module))
            .collect()
    }
}

/// Every requirement of the specifications `definition` selects, in specification
/// order and then declaration order.
///
/// An absent `specifications` key covers every specification the suite declares,
/// which is why it is not the same value as an empty list. A named specification the
/// suite does not declare is skipped: lowering already refused such a definition, so
/// reaching here means the two reads disagree and the honest answer is to record
/// what the suite actually holds.
fn claimed_requirements(
    specifications: &[&SpecificationFolder],
    definition: &SuiteTestCaseDefinition,
) -> Vec<ClaimedRequirement> {
    // The selector is shared with lowering and prompt rendering, so the requirements
    // recorded here are the requirements of the documents the run was seeded with and
    // the prompt pointed at. Ids the suite does not declare are dropped rather than
    // refused: see the doc comment above.
    let (selected, _missing) = select_specifications(specifications, definition);
    selected
        .into_iter()
        .flat_map(|folder| {
            folder
                .manifest
                .requirements
                .iter()
                .map(|requirement| ClaimedRequirement {
                    specification: folder.manifest.id.clone(),
                    requirement: requirement.id.clone(),
                    kind: requirement.kind,
                    validators: requirement.validators.clone(),
                })
        })
        .collect()
}

impl ClaimedRequirement {
    /// The requirement's suite-wide identity.
    fn id(&self) -> String {
        format!("{}/{}", self.specification, self.requirement)
    }

    /// The outcome shell every answer for this requirement carries.
    fn shell(&self, status: RequirementStatus) -> RequirementOutcome {
        RequirementOutcome {
            id: self.id(),
            specification: self.specification.clone(),
            requirement: self.requirement.clone(),
            kind: self.kind,
            status,
            validators: self.validators.clone(),
            assertions: Vec::new(),
            detail: None,
        }
    }

    /// The outcome of a requirement review decides: no validator, no assertion, and
    /// the note saying so.
    fn reviewed(&self) -> RequirementOutcome {
        RequirementOutcome {
            detail: Some(REVIEWED_DETAIL.to_string()),
            ..self.shell(RequirementStatus::Undecided)
        }
    }

    /// The outcome of a requirement nothing decided, for `reason`.
    ///
    /// No pass and no failure is synthesized: a project the runner could not execute
    /// says nothing about the build, so the run stands and the requirement stays
    /// unanswered.
    fn undecided(&self, reason: &str) -> RequirementOutcome {
        RequirementOutcome {
            detail: Some(bounded(reason, VITEST_OUTPUT_LIMIT)),
            ..self.shell(RequirementStatus::Undecided)
        }
    }

    /// Decide this requirement from the reports of the validators it claims.
    fn decide(&self, reports: &BTreeMap<String, &SuiteReport>) -> RequirementOutcome {
        let mut assertions = Vec::new();
        let mut notes: Vec<String> = Vec::new();
        let mut budget = VITEST_OUTPUT_LIMIT;
        let mut failed = false;
        for module in &self.validators {
            let Some(report) = reports.get(module) else {
                // The suite claims a validator the project reported no unit for. The
                // requirement is claimed by that validator and nothing decided it, so
                // the requirement is not satisfied.
                failed = true;
                notes.push(format!(
                    "the validator project reported no result for `{module}`",
                ));
                continue;
            };
            let returned: Vec<&TestOutcome> = report
                .tests
                .iter()
                .filter(|test| test.status != TestStatus::Skipped)
                .collect();
            if returned.is_empty() {
                // Either the module raised before returning anything — a file-level
                // message is what Vitest reports for that — or every one of its
                // checks declined to decide. Both are a validator that returned no
                // assertion, which fails the requirement claiming it.
                failed = true;
                notes.push(format!(
                    "`{module}` returned no assertion: {}",
                    report
                        .message
                        .as_deref()
                        .unwrap_or("the validator reported nothing"),
                ));
                continue;
            }
            for test in returned {
                let passed = test.status == TestStatus::Passed;
                failed |= !passed;
                let detail = (!passed)
                    .then_some(test.failure.as_deref())
                    .flatten()
                    .and_then(|failure| excerpt(failure, &mut budget));
                assertions.push(RequirementAssertion {
                    name: test.label.clone(),
                    passed,
                    detail,
                });
            }
        }
        let status = if failed {
            RequirementStatus::Failed
        } else {
            RequirementStatus::Passed
        };
        RequirementOutcome {
            assertions,
            detail: (!notes.is_empty()).then(|| bounded(&notes.join("\n"), VITEST_OUTPUT_LIMIT)),
            ..self.shell(status)
        }
    }
}

/// A failure message as the detail one assertion carries, drawn from the outcome's
/// remaining output `budget`.
///
/// A run record is deserialized on every run listing, so what one requirement
/// contributes is capped as a whole rather than per message — one enormous diff
/// cannot consume the budget the later failures need.
fn excerpt(failure: &str, budget: &mut usize) -> Option<String> {
    if *budget == 0 {
        return None;
    }
    let detail = bounded(failure, VITEST_ASSERTION_LIMIT.min(*budget));
    *budget = budget.saturating_sub(detail.len());
    (!detail.is_empty()).then_some(detail)
}

// --- Running the project ----------------------------------------------------

/// Stage the suite's validator project, serve the build, run Vitest over it, and
/// return the parsed per-file reports.
///
/// `Err` is reserved for a failure of the runner itself, which is a fact about the
/// host or the suite rather than about the build: every requirement the project
/// would have decided is left undecided because of it.
fn execute(
    binding: &SuiteBinding,
    artifacts: &ArtifactCollection,
    output_dir: &Path,
    install_command: &str,
    caps: Caps,
) -> Result<Vec<SuiteReport>, RunnerFailure> {
    let repo = &artifacts.repo_path;
    let project = binding.root.join(VALIDATORS_DIR);
    if !project.join(VITEST_CONFIG_FILE).is_file() {
        return Err(RunnerFailure::not_run(format!(
            "the suite version declares no `{VALIDATORS_DIR}/{VITEST_CONFIG_FILE}` validator \
             project",
        )));
    }
    // Staged for the length of this run and no longer: the guard puts the tree back
    // as it was found on every path out of here, including the refusals below.
    let _staged = StagedProject::stage_plain(&project, repo.join(VALIDATORS_DIR))
        .map_err(RunnerFailure::not_run)?;
    ensure_dependencies(repo, artifacts, install_command, caps.install)?;
    if !repo.join(VITEST_BIN).exists() {
        return Err(RunnerFailure::not_run(format!(
            "`{VITEST_BIN}` is not present in the produced tree, so the suite's validators could \
             not be run",
        )));
    }
    // The build is served for the length of the suite run. The port is bound here, so
    // it is named to the project through the environment rather than baked into the
    // project's config.
    let server = StaticServer::start(output_dir.to_path_buf()).map_err(|err| {
        RunnerFailure::not_run(format!(
            "could not serve the build for the suite's validators: {err}",
        ))
    })?;

    let scratch = tempfile::Builder::new()
        .prefix("tcab-suite-validators")
        .tempdir()
        .map_err(|err| {
            RunnerFailure::not_run(format!("could not create a scratch directory: {err}"))
        })?;
    let report_path = scratch.path().join("report.json");
    let command = vitest_command(&report_path, &binding.filters());
    let mut env = vec![(VALIDATOR_BASE_URL_ENV, server.url())];
    if let Some(handle) = &binding.handle {
        env.push((DEBUG_API_HANDLE_ENV, handle.clone()));
    }
    let ran = run_bounded(repo, &command, caps.suite, scratch.path(), "vitest", &env)?;

    let json = std::fs::read_to_string(&report_path).map_err(|_| {
        RunnerFailure::not_run(format!(
            "vitest wrote no JSON report ({}): {}",
            exit_description(ran.code),
            bounded(&ran.combined(), VITEST_OUTPUT_LIMIT),
        ))
    })?;
    parse_report(&json, repo).map_err(RunnerFailure::not_run)
}

/// The shell line the suite's validators are run with.
///
/// The JSON reporter is written to a file rather than read off stdout so a validator
/// that prints on its own cannot corrupt the report, and the project's own config is
/// named explicitly because the produced tree's `vitest.config.ts` is a different
/// project entirely — the implementation's own tests, which the toolchain stage
/// already ran.
///
/// `filters` are Vitest's positional file filters: the staged path of the test file
/// driving each validator the selected specifications claim. A validator of some
/// other specification is never loaded, so it costs nothing and reports nothing.
fn vitest_command(report_path: &Path, filters: &[String]) -> String {
    let mut command = format!(
        "npx vitest run --config {} --reporter=json --outputFile={}",
        quote(&format!("{VALIDATORS_DIR}/{VITEST_CONFIG_FILE}")),
        quote(&report_path.to_string_lossy()),
    );
    for filter in filters {
        command.push(' ');
        command.push_str(&quote(filter));
    }
    command
}

/// The collected tree's path of the test file driving the validator module at
/// `module`, a path relative to `validators/`.
///
/// The project is staged at the tree's `validators/`, so the module keeps the path
/// the suite claims it by, and the file driving it is that module's own `.test.ts`
/// beside it.
fn staged_test_file(module: &str) -> String {
    let stem = module.strip_suffix(".ts").unwrap_or(module);
    format!("{VALIDATORS_DIR}/{stem}.test.ts")
}

/// The validator module a reported test file drives, as a path relative to
/// `validators/`, or `None` for a reported file that is not one.
///
/// The inverse of [`staged_test_file`]: the unit Vitest reports is a test file
/// driving one validator module, and the module's path is what a requirement claims.
fn module_of(file: &str) -> Option<String> {
    let rest = file.strip_prefix(&format!("{VALIDATORS_DIR}/"))?;
    let stem = rest.strip_suffix(".test.ts")?;
    Some(format!("{stem}.ts"))
}

/// The reports keyed by the validator module each drives, dropping anything the
/// project reported that is not a validator's test file.
fn index_by_module(reports: &[SuiteReport]) -> BTreeMap<String, &SuiteReport> {
    reports
        .iter()
        .filter_map(|report| Some((module_of(&report.file)?, report)))
        .collect()
}

#[cfg(test)]
#[path = "validators.test.rs"]
mod tests;

// The staged project reaches the workspace install through a symlink.
#[cfg(all(test, unix))]
#[path = "validators.served.test.rs"]
mod served_tests;
