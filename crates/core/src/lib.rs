//! # test-cabinet-core
//!
//! The headless orchestration library for The Test Cabinet. It owns the full run
//! lifecycle: resolving a test case version, seeding a run's repository,
//! executing the run in a container, invoking the agent harness, collecting
//! metrics, running validation, writing the run record, and publishing.
//!
//! See `docs/application.md`. The command line interface and the services are
//! thin layers on top of this core; keeping orchestration here is what makes batch
//! runs and unattended sweeps possible.

pub mod accounts;
pub mod adversarial_validator;
pub mod asset_reference;
pub mod audio_stage;
pub mod auth;
pub mod backend_client;
pub mod browser;
pub mod cancel;
pub mod clock;
pub mod code_analysis;
pub mod cold_storage;
pub mod comparison;
pub mod comparison_aggregate;
pub mod comparison_stats;
pub mod container;
pub mod content_labels;
pub mod engine;
pub mod error;
pub mod event;
pub mod exec_stream;
pub mod execution;
pub mod gg;
pub mod gg_exec;
pub mod gg_query;
pub mod gg_reference;
pub mod gg_session_assembly;
pub mod gg_session_journal;
pub mod gg_session_record;
pub mod harness;
pub mod harness_registry;
pub mod harness_telemetry;
pub mod install;
pub mod job_api;
pub mod lockfile_check;
pub mod match_play;
pub mod metrics;
pub mod model_id;
pub mod orchestrator;
pub mod performance_validator;
pub mod playable;
pub mod post_run;
pub mod preview;
pub mod pricing;
pub mod prompt;
pub mod publish;
pub mod publish_job_api;
pub mod r2;
pub mod redact;
pub mod reference;
pub mod reference_lock;
pub mod review;
pub mod run_record;
pub mod salvage;
pub mod seeding;
pub mod test_case;
pub mod test_case_group;
pub mod toolchain;
pub mod toolchain_report;
pub mod toolchain_stage;
pub mod validation;
pub mod validator;
pub mod vitest_validator;

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;

/// The Test Cabinet commit this build was produced from, stamped at compile time
/// by `build.rs` into the `TEST_CABINET_COMMIT` environment variable and suffixed
/// with `-dirty` when the working tree was modified. `None` when the build could
/// not determine it (for example, a build with no git repository).
///
/// This is the single source of the build's provenance commit: the run record's
/// tooling stamp reads it.
pub const COMMIT: Option<&str> = option_env!("TEST_CABINET_COMMIT");

use std::collections::BTreeMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tracing::instrument;

pub use accounts::{Account, AccountsClient, AuthnResponse, LoginRequest, RegisterRequest};
pub use adversarial_validator::AdversarialValidator;
pub use auth::{
    AuthPlan, CredBytesSource, CredFile, CredSource, HostCreds, MapCreds, RequestedAuthMode,
    SubscriptionSpec, api_key_override_var, auth_readiness, resolve_auth, resolve_auth_with,
};
pub use backend_client::{
    BackendClient, HttpBackendClient, PrerenderedReferenceRenderer, PublishAck, PublishedReview,
    PublishedRun, ResolvedArtifact, ResolvedReference, RunPage, materialize_version,
};
pub use cancel::RunCancellation;
pub use clock::{Clock, ManualClock, SystemClock};
pub use code_analysis::{
    CODE_ANALYSIS_ARTIFACT, CODE_ANALYSIS_TREE_ARTIFACT, CODE_ANALYZER_VERSION, CODE_METRICS,
    CodeAnalysisDocument, CodeAnalysisNotes, CodeAnalysisSummary, CodeApiSummary,
    CodeAuthoredBasis, CodeCloneGroup, CodeCloneInstance, CodeComplexitySummary,
    CodeDuplicationSummary, CodeFileEntry, CodeGraphSummary, CodeImportEdge, CodeLanguage,
    CodeMetricDef, CodeMetricUnit, CodeRustSummary, CodeSizeSummary, CodeSymbolEntry,
    CodeTestSummary, CodeTreeBasis, CodeTruncationCap, CodeTypeScriptSummary,
};
pub use cold_storage::{COLD_STORAGE_DIR, COLD_STORAGE_DIR_ENV, ColdStorage};
pub use container::{CliArtifactCollector, CliContainerRuntime};
pub use engine::{
    BUILT_IN_SLUGS as BUILT_IN_ENGINE_SLUGS, EngineCatalog, EngineManifest, EngineSelection,
    NONE_SLUG, ResolvedEngine,
};
pub use error::{Error, Result};
pub use event::{
    EventFormat, EventKind, EventParser, EventSink, HarnessEvent, NoopEventSink,
    OrchestrationAction, SystemStage, SystemStatus,
};
pub use execution::{
    ArtifactCollection, ArtifactCollector, ContainerFile, ContainerHandle, ContainerRuntime,
    ContainerSpec, ContainerStart, ExecOutput, OutputSink, OutputStream, PreparedInstall,
    RawOutputLine, RepoSeeder, SeedRequest, SeededRepo, WORKSPACE_DIR,
};
pub use harness::{
    AgentHarness, Availability, HarnessInvocation, HarnessOutcome, HarnessRegistry, Usage,
    resolve_run_image,
};
pub use harness_registry::DefaultHarnessRegistry;
pub use install::{
    INSTALL_ATTEMPTS, INSTALL_RETRY_DELAY, INSTALL_TIMEOUT, InstallOutcome, install_with_retry,
    install_with_retry_blocking, run_command, run_command_blocking,
};
pub use job_api::{
    ActiveJobOut, ClaimedJob, DriverState, JobState, JobStatusOut, JobSummary, LaunchAck,
    LaunchBatchAck, LaunchBatchBody, LaunchBatchItem, LaunchBody, Notification, NotificationKind,
    NotificationOutcome, RunEvent, RunEventKind, StatusUpdate, StreamTopicsBody,
};
pub use lockfile_check::{LOCKFILE_CHECK_SCRIPT, LockfileCheck, check_tree, parse_report};
pub use metrics::{Cost, RunDurations, RunMetrics, TokenCounts, TokenPrices};
pub use orchestrator::{
    BUILT_IN_SLUGS, ONE_SHOT_SLUG, Orchestrator, OrchestratorCatalog, OrchestratorManifest,
    OrchestratorSelection,
};
pub use performance_validator::PerformanceValidator;
pub use playable::{
    BUILD_OUTPUTS, ServedAssetFile, ServedBuildFile, ServedProofFile, ServedShowcaseFile,
    ServedValidationFile, find_build_output, proof_labelled_name, proof_published_extension,
    proof_served_extension, serve_asset_file, serve_build_file, serve_proof_file,
    serve_showcase_file, serve_validation_file,
};
pub use post_run::{PostRunContext, PostRunReport, PostRunStage};
pub use preview::{AssetPreview, LivePreview, LivePreviewEndpoint, PreviewSink};
pub use pricing::{
    MODALITY_IMAGE, ModelDetails, ModelLaunchFacts, ModelListing, OpenRouterPrices, ProviderRoute,
};
pub use prompt::{render_prompt, render_prompt_from_template, render_spec_from_template};
pub use publish::{
    BackendPublisher, CommandOutput, CommandRunner, PublishConfig, Publisher, ReleaseRequest,
    SystemCommandRunner, deploy_pages_build, implementation_dir, parse_wrangler_url, run_slug,
};
pub use publish_job_api::{
    PublishClaim, PublishJobState, PublishProgress, PublishResult, PublishState,
};
pub use reference::{BrowserRenderer, ReferenceRenderer, RenderedReference};
pub use review::{
    AestheticRating, DomainRating, Rating, ReviewVerdict, Score, VerdictStatus, Writeup,
    effective_verdicts, missing_ratings, missing_verdicts, needs_aesthetic, parse_writeup, score,
    validator_aggregate_rating, validator_aggregate_score, validator_review_rating,
    validator_review_score,
};
pub use run_record::{
    AuthMode, HarnessSlug, PriorGameJamEntry, RunEnvironment, RunLinks, RunRecord, RunShowcase,
    RunState, RunStatus, RunSubject, RunTooling, ShowcaseMedia,
};
pub use seeding::FsRepoSeeder;
pub use test_case::{
    AssetDimension, AssetKind, CanvasSpec, Check, CheckAction, ContractSpec, Domain, EngineSupport,
    EngineWorkspaces, Instrumentation, MatchSpec, MediaKind, ModelSpec, OutputSpec, ProofFile,
    ReferenceKind, ReferenceView, ReplaySpec, ReviewItem, ReviewOutput, ReviewValidation,
    SandboxSpec, SheetSequence, SheetSpec, SimulationSpec, SpecFile, SpecKind, SubReviewItem,
    TestCase, TestCaseCatalog, TestCaseVersion, TestType, ToolSpec, Variant, VoxelSpec,
    WorkspaceFile, shippable_package_description,
};
pub use test_case_group::{TestCaseGroup, TestCaseGroupCatalog};
pub use toolchain::{
    CoverageFile, CoverageMetric, CoverageMetrics, TOOLCHAIN_COVERAGE_FILE_LIMIT,
    TOOLCHAIN_COVERAGE_SUMMARY_PATH, TOOLCHAIN_FAILURE_MESSAGE_LIMIT, TOOLCHAIN_OUTPUT_LIMIT,
    TOOLCHAIN_TEST_ENTRY_LIMIT, TOOLCHAIN_TEST_FAILURE_LIMIT, TOOLCHAIN_TEST_FILE_LIMIT,
    TOOLCHAIN_TEST_REPORT_PATH, ToolchainCommandResult, ToolchainCommands, ToolchainCoverage,
    ToolchainSmokeResult, ToolchainSummary, ToolchainTest, ToolchainTestFailure, ToolchainTestFile,
    ToolchainTestRun, ToolchainTestStatus, ToolchainTests,
};
pub use toolchain_report::{read_coverage_summary, read_test_report};
pub use toolchain_stage::ToolchainStage;
pub use validation::{
    AdversarialOutcome, AdversarialResult, AdversarialTeam, AssetGenResult, AutoVerdict,
    CapturedView, CheckResult, DebugScriptResult, ProofResult, StepResult, ValidationSummary,
    Validator,
};
pub use validator::{
    AssetGenValidator, BlenderGenValidator, BuildValidator, DispatchValidator, ScriptedItemDrive,
    ScriptedOutput, VALIDATION_BASELINE_DIR, VALIDATION_IMAGE_PREFIX, VALIDATION_SCRIPT_DIR,
    capture_baseline_media, drive_scripted_items, is_validation_image_name, validation_media_name,
    validation_published_extension,
};

/// What to run, with what, against which model.
///
/// This is the user-facing description of a run; the [`RunEngine`] turns it
/// into a [`RunRecord`].
///
/// A conventional (third-party harness) run is the flat `(harness, model,
/// orchestrator)` tuple. A **gg** run is different in kind: it is configured by a
/// declarative [`GgCapabilitySet`](crate::gg::GgCapabilitySet) carried in
/// [`Self::gg_capability_set`], and the orchestrator dimension does not apply
/// (gg is its own executor). The two shapes are kept coherent by the biconditional
/// invariant [`Self::validate`] enforces: the capability set is present **iff** the
/// harness is [`HarnessSlug::Gg`].
//
// Not `Eq`: `gg_capability_set` transitively holds a `serde_json::Value` (a
// capability's free-form `params`), which is `PartialEq` but not `Eq`.
#[derive(Debug, Clone, PartialEq)]
pub struct RunRequest {
    /// The test case slug to run.
    pub test_case_slug: String,
    /// The exact test case version, or `None` to use the latest.
    pub test_case_version: Option<String>,
    /// The variant of the test case to run. Selects which specs are seeded and is
    /// recorded in the run record.
    pub variant: String,
    /// The agent harness to drive.
    pub harness: HarnessSlug,
    /// The opaque model ID to pass to the harness.
    pub model_id: String,
    /// Which orchestrator conducts the harness sessions: a built-in by slug or an
    /// external `--orchestrator-dir`. Defaults to `one-shot` (a single session,
    /// reproducing the original single-session behaviour exactly). Selection is
    /// limited to the [end-to-end](crate::TestType::EndToEnd) test type; any other
    /// test type rejects a non-default orchestrator. The resolved slug is recorded
    /// on the run as [`RunSubject::orchestrator_slug`](crate::RunSubject).
    pub orchestrator: OrchestratorSelection,
    /// Which [`engine`] the produced build is written against — the
    /// runtime that supplies the frame loop and its delta time, the input
    /// actions, the audio bus, the asset loader, and the diagnostics overlay.
    /// Defaults to [`NONE_SLUG`]: nothing is vendored and the build supplies all
    /// of that itself, which is exactly what every run looked like before engines
    /// existed.
    ///
    /// Unlike [`Self::orchestrator`], which is gated by *test type*, this is gated
    /// by the **case**: a version declares the engines it supports, and a run
    /// naming one it does not is refused before any container is started (see
    /// [`TestCaseVersion::supports_engine`]). The resolved slug is recorded on the
    /// run as [`RunSubject::engine_slug`](crate::RunSubject), beside the version
    /// of the runtime that was actually vendored — the engine is a run dimension,
    /// so a result is only comparable with another result on the same engine.
    pub engine: EngineSelection,
    /// Optional override for the maximum harness runtime, in seconds. `None`
    /// uses the resolved test case's `max_runtime_seconds` default; `Some`
    /// replaces it for this run (for example `tcab run --max-runtime`). Either
    /// way the run is bounded, so a session can never continue unbounded.
    pub max_runtime_override: Option<u64>,
    /// An explicit per-run override for the run-container image: a full, pullable
    /// reference the runtime pulls. `None` — the usual case — resolves the image for
    /// the run's test type, asset kind and asset dimension from the environment via
    /// [`resolve_run_image`], which consults no backend. Whatever image actually
    /// runs is recorded (resolved to its registry digest where it has one) as
    /// [`RunEnvironment::container_image`].
    pub container_image: Option<String>,
    /// The declarative capability set that configures a **gg** run — which
    /// capabilities are on, their implementations/params, and the model-slot
    /// bindings — carried in place of the `(model, orchestrator)` dimensions a
    /// third-party harness run uses.
    ///
    /// Present **iff** [`Self::harness`] is
    /// [`HarnessSlug::Gg`]: a gg run requires
    /// one, and a non-gg run must not carry one. [`Self::validate`] enforces that
    /// biconditional so a mismatch is a clear error rather than a silent
    /// misconfiguration. This does **not** change the meaning of
    /// [`Self::model_id`] for a non-gg run; for a gg run the primary model is the
    /// [`PRIMARY_SLOT`](crate::gg::PRIMARY_SLOT) binding inside the set.
    pub gg_capability_set: Option<crate::gg::GgCapabilitySet>,
    /// The context window, in tokens, of each model a **gg** run may bind, as resolved
    /// from the model catalog by whoever triggered the run (the backend at enqueue, or
    /// the CLI against a configured backend). Passed straight through to
    /// [`GgInvocation::model_windows`](crate::gg::GgInvocation::model_windows).
    ///
    /// Empty is always legal — it simply means no catalog figure was available, and gg
    /// falls back to a conservative default. Meaningless for a non-gg run, which leaves
    /// it empty.
    pub gg_model_windows: BTreeMap<String, u64>,
    /// The ordered candidate list each model a **gg** run may be served by, resolved
    /// from the model catalog alongside [`gg_model_windows`](Self::gg_model_windows).
    /// Passed straight through to
    /// [`GgInvocation::model_providers`](crate::gg::GgInvocation::model_providers).
    ///
    /// Empty is legal only for a run that binds no model. A gg run missing a list for a
    /// bound model is refused before the container is pulled: the model has no candidate.
    pub gg_model_providers: BTreeMap<String, Vec<crate::gg::GgProviderCandidate>>,
    /// The input modalities each model a **gg** run may bind accepts, as resolved from
    /// the model catalog alongside [`gg_model_windows`](Self::gg_model_windows). Passed
    /// straight through to
    /// [`GgInvocation::model_modalities`](crate::gg::GgInvocation::model_modalities).
    ///
    /// A model absent from the map has **unknown** modalities, not text-only ones, and
    /// gg treats it optimistically (it will attempt an image and recover if the provider
    /// refuses it). Unlike the windows, this is never required: it decides whether one
    /// tool result may carry a picture, not how the run is measured.
    pub gg_model_modalities: BTreeMap<String, Vec<String>>,
    /// The curated **list price** (USD per token) of each model a **gg** run may bind,
    /// as resolved from the model catalog alongside
    /// [`gg_model_windows`](Self::gg_model_windows).
    ///
    /// Every bound model carries one, because a model with none is refused at
    /// enqueue; the run's comparable cost is computed from its primary model's entry
    /// (see [`list_prices`](Self::list_prices)).
    pub gg_model_prices: BTreeMap<String, TokenPrices>,
    /// The curated **list price** (USD per token) of a **non-gg** run's model, stamped
    /// by the backend at enqueue on the same terms as
    /// [`gg_model_prices`](Self::gg_model_prices).
    ///
    /// `None` only on a gg run, whose prices ride in `gg_model_prices`, or a run
    /// enqueued before the catalog carried list prices; such a run records an unknown
    /// comparable cost.
    pub model_prices: Option<TokenPrices>,
}

impl RunRequest {
    /// Whether this is a **gg** run — driven by the harness being
    /// [`HarnessSlug::Gg`]. The one seam the
    /// run pipeline uses to route a run down gg's own executor path instead of the
    /// orchestrated third-party-harness path.
    pub fn is_gg(&self) -> bool {
        self.harness == crate::run_record::HarnessSlug::Gg
    }

    /// The list price the run's comparable cost is computed from: the stamped
    /// [`model_prices`](Self::model_prices) of a third-party-harness run, or a gg
    /// run's [`gg_model_prices`](Self::gg_model_prices) entry for its primary model.
    ///
    /// A gg run's tokens are summed run-wide across every model its capability set
    /// binds, so the run is priced at the model it is published under. A run with no
    /// stamped price gets unknown prices, and so an unknown comparable cost, rather
    /// than a price looked up from a provider on the day it ran.
    pub fn list_prices(&self) -> TokenPrices {
        if self.is_gg() {
            self.gg_model_prices
                .get(&self.model_id)
                .copied()
                .unwrap_or_default()
        } else {
            self.model_prices.unwrap_or_default()
        }
    }

    /// Enforce the gg configuration invariants: a
    /// [capability set](crate::gg::GgCapabilitySet) is carried **iff** the harness
    /// is [`HarnessSlug::Gg`], and a gg run carries a
    /// [context window](Self::gg_model_windows) for every model it binds. Called at
    /// the top of a run so a mismatch fails fast, before any container work, with a
    /// clear message rather than a silent skip of the gg path (or a stray capability
    /// set on a third-party-harness run).
    pub fn validate(&self) -> Result<()> {
        match (self.is_gg(), self.gg_capability_set.is_some()) {
            (true, false) => {
                return Err(Error::GgConfiguration(
                    "a gg run requires a capability set, but none was supplied".to_string(),
                ));
            }
            (false, true) => {
                return Err(Error::GgConfiguration(format!(
                    "a gg capability set was supplied for a `{}` run, which is not a gg run",
                    self.harness.as_str(),
                )));
            }
            _ => {}
        }
        self.validate_model_windows()?;
        self.validate_model_providers()
    }

    /// Every model a gg run binds must carry the model catalog's
    /// [context window](Self::gg_model_windows) for it.
    ///
    /// gg measures window fullness — and triggers [compaction](crate::gg) — against that
    /// figure, and has no fallback to invent one with, so a run missing it would produce
    /// context accounting that is quietly wrong rather than absent. The launch path
    /// resolves the windows (the backend, at enqueue), so reaching here without one means
    /// the catalog could not answer: fail before the container is even pulled.
    fn validate_model_windows(&self) -> Result<()> {
        let Some(set) = self.gg_capability_set.as_ref() else {
            return Ok(());
        };
        let missing: Vec<&str> = set
            .bound_model_ids()
            .into_iter()
            .filter(|id| !self.gg_model_windows.contains_key(*id))
            .collect();
        if missing.is_empty() {
            return Ok(());
        }
        Err(Error::GgConfiguration(format!(
            "no context window resolved for model(s) {}",
            missing
                .iter()
                .map(|id| format!("`{id}`"))
                .collect::<Vec<_>>()
                .join(", "),
        )))
    }

    /// Every model a gg run binds must carry the ordered candidate list its requests are served
    /// by.
    ///
    /// The launch path resolves the list with the window, so reaching here without one means the
    /// catalog found no endpoint the run may use. A model with no candidate is not testable, so
    /// the run is refused before the container is pulled.
    fn validate_model_providers(&self) -> Result<()> {
        let Some(set) = self.gg_capability_set.as_ref() else {
            return Ok(());
        };
        let missing: Vec<&str> = set
            .bound_model_ids()
            .into_iter()
            .filter(|id| {
                !self.gg_model_providers.get(*id).is_some_and(|candidates| {
                    crate::gg::GgProviderCandidate::usable_list(candidates)
                })
            })
            .collect();
        if missing.is_empty() {
            return Ok(());
        }
        Err(Error::GgConfiguration(format!(
            "no provider candidate resolved for model(s) {}",
            missing
                .iter()
                .map(|id| format!("`{id}`"))
                .collect::<Vec<_>>()
                .join(", "),
        )))
    }

    /// The gg [capability set](crate::gg::GgCapabilitySet) for this run, or a clear
    /// error when this is not a gg run or the invariant does not hold. The gg
    /// executor calls this to obtain the set it launches from without re-checking
    /// the invariant by hand.
    pub fn gg_capability_set(&self) -> Result<&crate::gg::GgCapabilitySet> {
        self.validate()?;
        self.gg_capability_set.as_ref().ok_or_else(|| {
            Error::GgConfiguration(format!(
                "requested the gg capability set for a `{}` run, which carries none",
                self.harness.as_str(),
            ))
        })
    }

    /// The maximum harness runtime, in seconds, in effect for this run: the
    /// per-invocation [`Self::max_runtime_override`] when set, otherwise the
    /// resolved case's [`TestCaseVersion::max_runtime_seconds`] default. Always
    /// positive, so the harness session is always bounded.
    pub fn effective_max_runtime(&self, test_case: &TestCaseVersion) -> u64 {
        self.max_runtime_override
            .unwrap_or(test_case.max_runtime_seconds)
    }
}

/// Resolve the [engine] a run selected, and refuse a case that
/// does not support it.
///
/// The two halves are one step because both belong at the same place: the very
/// top of a run, before anything is rendered, seeded, pulled, or started. An
/// engine is a run dimension the (frozen) case cannot name for itself, so this
/// check is the only thing standing between a build written against a runtime the
/// case's specs and validation never contemplated and a spent harness session —
/// and a run refused after the container is up has already cost the money the
/// check exists to save.
///
/// The order within it matters too. The selection resolves against the catalogue
/// *first*, so a typo on `--engine` is reported as the unknown engine it is —
/// naming every engine that would have worked — rather than as an engine this
/// particular case happens not to support. [`NONE_SLUG`] then skips the support
/// check outright: every case supports the engineless run, whether or not its
/// manifest ever said so.
fn resolve_engine(
    engines: &EngineCatalog,
    request: &RunRequest,
    test_case: &TestCaseVersion,
) -> Result<ResolvedEngine> {
    let engine = engines.resolve(&request.engine)?;
    ensure_engine_supported(test_case, &engine)?;
    Ok(engine)
}

/// Hold an already-resolved engine against what `test_case` declares: first that
/// the case supports the engine at all, then that the version the host would stage
/// falls inside the range the case declared for it.
///
/// Split out of the run gate so the local commands (`tcab seed`,
/// `tcab validate`, `tcab prompt`), which resolve an engine for a case without a
/// [`RunRequest`], apply the *same* gate rather than a re-stated approximation of
/// it — a second copy is how the two drift and how a `tcab seed` starts producing
/// a tree a run would have refused.
///
/// [`NONE_SLUG`] is held to the case's declared set like any other slug — a
/// version built against a runtime does not support the engineless run, because
/// its workspace `package.json` depends on a package an engineless run vendors
/// nothing into, so admitting it would seed a tree whose install cannot succeed.
/// Only the VERSION half short-circuits for it: `none` supplies no package, so
/// there is nothing to compare. An engine declared with no range short-circuits
/// that half too — the case asked for no constraint, so an unreadable package
/// store costs it nothing.
pub fn ensure_engine_supported(test_case: &TestCaseVersion, engine: &ResolvedEngine) -> Result<()> {
    let Some(support) = test_case.engine_support(engine.slug()) else {
        return Err(Error::EngineUnsupportedForCase {
            slug: engine.slug().to_string(),
            test_case: test_case.slug.clone(),
            version: test_case.version.clone(),
            supported: test_case.engine_slugs(),
        });
    };
    if engine.slug() == NONE_SLUG || !support.is_bounded() {
        return Ok(());
    }
    match engine.version() {
        Some(version) if support.accepts(version) => Ok(()),
        Some(version) => Err(Error::EngineVersionUnsupportedForCase {
            slug: engine.slug().to_string(),
            engine_version: version.to_string(),
            test_case: test_case.slug.clone(),
            version: test_case.version.clone(),
            range: support.range_display(),
        }),
        None => Err(Error::EngineVersionUnknown {
            slug: engine.slug().to_string(),
            test_case: test_case.slug.clone(),
            version: test_case.version.clone(),
            range: support.range_display(),
        }),
    }
}

/// Convert a runtime cap expressed in **hours** — the unit test-case manifests
/// (`max_runtime_hours`) and the `--max-runtime` CLI flag are authored in — into
/// whole seconds, the unit the run pipeline (job API, backend, timeouts) carries
/// internally. Callers author durations in fractional hours (for example `0.5`)
/// because every cap is long enough that seconds add no useful precision; this
/// rounds to the nearest second at the single edge where the two units meet.
pub fn runtime_hours_to_seconds(hours: f64) -> u64 {
    (hours * 3600.0).round() as u64
}

/// Drives a single run through its full lifecycle.
///
/// The orchestrator wires together the swappable seams — test case catalog,
/// repo seeder, container runtime, harness registry, and validator — and
/// sequences them: resolve, seed, execute, collect metrics, validate, write
/// record. Releasing a finished run to the public gallery is a separate,
/// explicit backend operation (publish), not part of the run engine.
pub struct RunEngine<S, R, C, V>
where
    S: RepoSeeder,
    R: ContainerRuntime,
    C: ArtifactCollector,
    V: Validator,
{
    /// Resolves test case slugs and versions.
    pub catalog: TestCaseCatalog,
    /// Seeds fresh per-run repositories.
    pub seeder: S,
    /// Starts and drives run containers.
    pub runtime: R,
    /// Collects the produced working tree.
    pub collector: C,
    /// Looks up harness implementations by slug.
    pub harnesses: Box<dyn HarnessRegistry>,
    /// Resolves the orchestrator that drives the run's harness sessions. The
    /// built-in orchestrators are embedded, so this is stateless.
    pub orchestrators: OrchestratorCatalog,
    /// Resolves the [`engine`] the produced build is written
    /// against. The built-in engines are embedded — the catalogue is closed, with
    /// no external-directory arm — so this is stateless, and a backend-driven
    /// driver with no checkout resolves exactly what the CLI does.
    pub engines: EngineCatalog,
    /// Renders reference mockups to screenshots for seeding and validation.
    pub renderer: Box<dyn ReferenceRenderer>,
    /// Assembles a **gg** run's streamed capture journal into the run's session
    /// record, at the [post-run stage seam](crate::post_run).
    ///
    /// `None` — the default for every host that has no use for it, and for every
    /// test — runs no assembly, which simply leaves the run without a session
    /// artifact.
    pub session_assembler: Option<Box<dyn PostRunStage>>,
    /// Statically analyses the code the model wrote, at the [post-run stage
    /// seam](crate::post_run), after the record assembly has lifted gg's journal
    /// out of the tree.
    ///
    /// Injected rather than called directly because the analyzer crate depends on
    /// this one for its contract types — depending back would be a cycle — and
    /// because keeping it out of core keeps its parser dependencies out of every
    /// binary that links core. `None` runs no analysis.
    pub analyzer: Option<Box<dyn PostRunStage>>,
    /// Runs the case's [`[toolchain]`](crate::toolchain) commands over the produced
    /// implementation and smoke-checks the site they build, at the [post-run stage
    /// seam](crate::post_run) — **last**, after the analyzer, because it is the one
    /// stage that writes to the tree the others read (it installs dependencies and
    /// runs a build).
    ///
    /// Injected rather than always-on so that a host with no Node toolchain, and
    /// every test that does not care, simply runs none — a case's toolchain then
    /// goes unchecked, which the record's absent `toolchain` block reports honestly
    /// and which gates nothing.
    pub toolchain: Option<Box<dyn PostRunStage>>,
    /// Runs the validation pass.
    pub validator: V,
    /// Directory each run's record and collected implementation are written to.
    pub output_dir: PathBuf,
    /// An optional source of subscription credential bytes for the run.
    ///
    /// `None` (the CLI in-process path) reads any subscription
    /// credentials from the host filesystem, unchanged. The driver, which runs in
    /// an ephemeral pod with no such files, sets this to a [`MapCreds`] built from
    /// an operator-provided Secret mounted into the pod, so a subscription harness
    /// (including the subscription-only Antigravity) can run on the cluster path.
    /// See [`auth::resolve_auth_with`].
    //
    // The deferred per-account credential vault would slot in here as a different
    // `CredBytesSource` — one keyed to the enqueuing account — with no change to
    // this seam or the selection policy.
    pub creds: Option<Box<dyn auth::CredBytesSource + Send + Sync>>,
    /// Earlier game-jam entries to brief this run with: the gameplay READMEs of prior
    /// runs of the same jam with the same harness and model, so a repeated jam run
    /// builds something distinct rather than a near-copy. Seeded (git-ignored) and
    /// surfaced in the prompt's distinctness section; see [`RunEngine::run_resolved`].
    ///
    /// The engine does not fetch these itself — the caller supplies them. The driver
    /// populates them from the backend for a game-jam run; the in-process CLI path
    /// (and every non-game-jam run) leaves this empty, which simply seeds no
    /// prior entries and adds no distinctness section.
    pub prior_game_jam_entries: Vec<PriorGameJamEntry>,
    /// The monotonic clock every recorded stage duration is read from.
    ///
    /// Every host passes [`SystemClock`]. It is a field so a test can pass a [`ManualClock`] that
    /// its faked stages advance by known amounts, which makes where each timer is read an exact
    /// assertion rather than a reading of the machine.
    pub clock: Arc<dyn Clock>,
}

/// What one call to [`RunEngine::execute`] produced: the running container, the
/// harness's outcome, the environment probed from inside it, and the two
/// durations only that call can measure.
///
/// The durations are returned rather than measured by the caller because both
/// boundaries live inside `execute`. The caller owns [`Self::handle`] and must
/// stop it.
pub struct ExecutedSession {
    /// The still-running container the session ran in.
    pub handle: ContainerHandle,
    /// What the harness session produced.
    pub outcome: HarnessOutcome,
    /// The environment probed from inside the running container.
    pub environment: RunEnvironment,
    /// How long the container spent queued for capacity before startup began
    /// (see [`ContainerStart::scheduling_wait`]), so the caller can exclude it
    /// from the run's measured duration.
    pub scheduling_wait: Duration,
    /// How long the harness session itself took, measured around the capped
    /// drive. This is the model's own working time, and the only stage of a run
    /// whose duration describes the model rather than the fleet.
    pub session_elapsed: Duration,
}

impl<S, R, C, V> RunEngine<S, R, C, V>
where
    S: RepoSeeder,
    R: ContainerRuntime,
    C: ArtifactCollector,
    V: Validator,
{
    /// Resolve a [`RunRequest`] into an exact, immutable [`TestCaseVersion`].
    pub fn resolve(&self, request: &RunRequest) -> Result<TestCaseVersion> {
        match &request.test_case_version {
            Some(version) => self.catalog.resolve(&request.test_case_slug, version),
            None => self.catalog.resolve_latest(&request.test_case_slug),
        }
    }

    /// Render the selected variant's reference mockups to screenshots, used both
    /// as seeded visual targets and as validation baselines. The set rendered is
    /// the common references plus the variant's own; see
    /// [`TestCaseVersion::references_for`].
    #[instrument(
        name = "render_references",
        skip_all,
        fields(test_case.slug = %test_case.slug, variant = %variant.slug),
        err,
    )]
    pub fn render_references(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
    ) -> Result<Vec<RenderedReference>> {
        self.renderer.render_references(test_case, variant)
    }

    /// Seed a fresh git repository with the selected variant's starter
    /// workspace, its specs, the test case's assets, and the rendered reference
    /// screenshots. Obtain `specs` from [`TestCaseVersion::seeded_specs`] and
    /// `workspace` from [`TestCaseVersion::workspace_for`] for the chosen
    /// `variant`, which is also the context for rendering any `.hbs` spec.
    ///
    /// `engine` is the [engine](crate::engine) the run resolved, and seeding is
    /// where it becomes real: its runtime package is vendored into the repository,
    /// its own documentation is copied in beside the specs, and the seeded
    /// workspace `package.json` gains the matching `file:` dependency. It is also
    /// the context every `.hbs` spec is rendered against, so a spec can state what
    /// this case requires under the selected engine. The engineless engine seeds
    /// none of that, leaving the tree byte-for-byte what it was before engines
    /// existed.
    #[instrument(
        name = "seed",
        skip_all,
        fields(
            test_case.slug = %test_case.slug,
            test_case.version = %test_case.version,
            variant = %variant.slug,
            engine = %engine.slug(),
        ),
        err,
    )]
    #[allow(clippy::too_many_arguments)]
    pub fn seed(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
        specs: &[SpecFile],
        workspace: &[WorkspaceFile],
        references: &[RenderedReference],
        live_preview: Option<&LivePreviewEndpoint>,
        engine: &ResolvedEngine,
    ) -> Result<SeededRepo> {
        self.seeder.seed(&SeedRequest {
            test_case,
            variant,
            specs,
            workspace,
            references,
            live_preview,
            prior_game_jam_entries: &self.prior_game_jam_entries,
            engine: Some(engine),
        })
    }

    /// Start a container and drive the agent harness to completion against the
    /// seeded repository.
    ///
    /// The caller owns the [`ContainerHandle`] in the returned
    /// [`ExecutedSession`] and must stop it. On any failure after the container
    /// starts, it is stopped before returning.
    #[instrument(
        name = "execute",
        skip_all,
        fields(
            test_case.slug = %test_case.slug,
            variant = %variant.slug,
            harness = %request.harness.as_str(),
            model = %request.model_id,
            engine = %engine.slug(),
            // Recorded once the run's image is resolved (per-run override or the
            // resolved base image). Never carries a secret.
            container.image = tracing::field::Empty,
        ),
        err,
    )]
    #[allow(clippy::too_many_arguments)]
    pub async fn execute(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
        seeded: &SeededRepo,
        provided_files: &[PathBuf],
        request: &RunRequest,
        orchestrator: &Orchestrator,
        engine: &ResolvedEngine,
        events: &mut dyn EventSink,
        host_gateway: bool,
        run_id: &str,
        cancel: &RunCancellation,
    ) -> Result<ExecutedSession> {
        // gg is The Test Cabinet's own harness and is invoked *directly* — it is its
        // own executor, not a subprocess driven through the `AgentHarness` trait or
        // looped by an orchestrator (see `crate::gg_exec`). A gg run therefore shares
        // this method's setup — auth, image pull, container start, the environment
        // probe, and the test case's `init` step, all of which are test-case-level —
        // but must never reach the third-party-harness install / `probe` /
        // `drive_orchestrator` span: the `GgHarness` adapter's `probe`/`invoke` are
        // unimplemented stubs, and no orchestrator applies. The branches below are
        // gated on `request.is_gg()` at exactly those points.
        //
        // Resolve the invariant (and the capability set) up front so a misassembled
        // request fails before any container work, and resolve how gg's binary is
        // installed: a `Local` binary is copied into the container as a file at start
        // time (added to `spec.files` below), a `Release` is downloaded inside the
        // container by `gg_exec::prepare_gg`.
        let gg_install = if request.is_gg() {
            request.gg_capability_set()?;
            Some(gg_exec::resolve_install()?)
        } else {
            None
        };

        let slug = request.harness;
        let harness = self
            .harnesses
            .get(slug)
            .ok_or_else(|| Error::HarnessUnavailable {
                slug: slug.as_str().to_string(),
                // The registered set is the figure this layer holds: the outer clause
                // already names the harness that was asked for, so repeating it here
                // would say nothing, while the set says what could have been asked for.
                detail: format!("no adapter is registered (registered: {})", {
                    let registered: Vec<&str> = HarnessSlug::RUNNABLE
                        .iter()
                        .filter(|candidate| self.harnesses.get(**candidate).is_some())
                        .map(|candidate| candidate.as_str())
                        .collect();
                    if registered.is_empty() {
                        "none".to_string()
                    } else {
                        registered.join(", ")
                    }
                }),
            })?;

        // Resolve how this run authenticates: an API key injected as an
        // environment secret, or a subscription supplied as credential files
        // copied into the container. The mode is chosen from the harness's
        // declared capabilities and the host environment (preferring a
        // subscription when present, unless locked with `TCAB_AUTH_MODE`); see
        // [`auth::resolve_auth`]. The recorded mode is captured for the run. When
        // an explicit credential source is configured (the driver/cluster path,
        // which has no host credential files), the subscription bytes are drawn
        // from it instead of the host filesystem; the mode selection is identical.
        let auth = match &self.creds {
            Some(source) => auth::resolve_auth_with(harness, source.as_ref())?,
            None => auth::resolve_auth(harness)?,
        };
        let auth_mode = auth.mode();

        // The image is the run's explicit per-run override when it carries one, else
        // the image for the test case's test type, asset kind and asset dimension,
        // resolved from the environment (a registry reference, resolved without any
        // backend): end-to-end runs use the base image, full-stack runs use the
        // full-stack image of the dimension the case declares (the 2D six binaries,
        // plus `voxel`/`voxel-anim`/`particle-3d` for `asset_dimension = "3d"`),
        // single-sprite runs use the sprite image (the base plus the baked-in `draw`
        // binary), sprite-sheet runs use the sprite-sheet image (the base plus the
        // baked-in `draw-sheet` binary). The selected harness's CLI is installed into
        // the container below either way — there is no per-harness image — with one
        // exception, and it is why the slug is passed: a `gg` run resolves the gg
        // VARIANT of that image, the same image plus the language toolchains its
        // responses-as-code programs are compiled with. Those exist for one harness,
        // so every other run gets an image without them.
        let image = request.container_image.clone().unwrap_or_else(|| {
            resolve_run_image(
                test_case.test_type,
                test_case.asset_kind,
                test_case.asset_dimension,
                slug,
            )
        });
        tracing::Span::current().record("container.image", image.as_str());

        // Pull the base image up front so the run fails fast with a clear error
        // on an unreachable registry, and so its digest can be resolved below. It
        // is idempotent: an image already present, including a local build, is
        // left untouched (the same `--pull missing` policy `start` uses). This is
        // often the longest wait before any harness activity, so it is bracketed
        // by system events to show the run is making progress.
        events.emit(&HarnessEvent::system(
            SystemStage::PullImage,
            SystemStatus::Started,
        ));
        if let Err(err) = self.runtime.pull(&image).await {
            events.emit(&HarnessEvent::system(
                SystemStage::PullImage,
                SystemStatus::Failed,
            ));
            return Err(Error::HarnessUnavailable {
                slug: slug.as_str().to_string(),
                detail: err.to_string(),
            });
        }
        events.emit(&HarnessEvent::system(
            SystemStage::PullImage,
            SystemStatus::Completed,
        ));

        // Apply the resolved auth plan to the container: an API key becomes an
        // environment secret (injected under the variable the harness's CLI
        // actually reads, which can differ from the host one — Codex reads
        // `CODEX_API_KEY`, not `OPENAI_API_KEY`); a subscription becomes
        // credential files copied in at the paths the CLI reads under the run
        // user's home. Not injecting a key is what forces subscription auth: the
        // base container is clean, so there is no ambient key to unset.
        let mut secrets = BTreeMap::new();
        let mut files = Vec::new();
        match auth {
            auth::AuthPlan::ApiKey { container_env, key } => {
                secrets.insert(container_env, key);
            }
            auth::AuthPlan::Subscription { files: cred_files } => {
                files = cred_files;
            }
        }

        // Configure the harness's own OpenTelemetry export, when this deployment
        // exports telemetry at all and the harness supports it. This is resolved
        // outside the auth match above because it is independent of how the run
        // authenticates: a telemetry config file must be materialized for an
        // API-key run just as much as for a subscription run.
        //
        // Telemetry is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set, matching
        // the opt-in contract every other process follows, and a harness with no
        // configurable export path simply contributes nothing.
        let telemetry_subject = harness_telemetry::TelemetrySubject {
            harness: slug,
            test_case: &test_case.slug,
            variant: &variant.slug,
            model_id: &request.model_id,
            run_id,
        };
        let telemetry = harness_telemetry::TelemetryContext::from_env(&telemetry_subject)
            .and_then(|context| harness_telemetry::harness_telemetry(slug).plan(&context, slug));
        let mut env = BTreeMap::new();
        let mut telemetry_host_gateway = false;
        if let Some(plan) = telemetry {
            tracing::debug!(
                harness = %slug.as_str(),
                variables = plan.env.len(),
                files = plan.files.len(),
                "configured harness telemetry export",
            );
            env = plan.env;
            files.extend(plan.files);
            telemetry_host_gateway = plan.needs_host_gateway;
        }

        // A gg run installs its own binary rather than a third-party CLI. For a
        // `Local` install, copy the host-built binary into the container as a file at
        // start time (materialized via a host-temp-file `cp`, so a large binary is
        // handled fine) at the path `gg_exec::run_gg_session` invokes. A `Release`
        // install adds nothing here — it is downloaded inside the container by
        // `gg_exec::prepare_gg`.
        if let Some(gg_exec::GgInstall::Local {
            host_path,
            container_path,
        }) = &gg_install
        {
            let contents = std::fs::read(host_path).map_err(|err| Error::HarnessUnavailable {
                slug: slug.as_str().to_string(),
                detail: format!("local binary `{}` unreadable ({err})", host_path.display()),
            })?;
            files.push(crate::execution::ContainerFile {
                container_path: container_path.clone(),
                contents,
                mode: 0o755,
            });
        }

        // Stage the audio packs this case declares into the container, and nothing
        // else. The palette a run reaches is fixed by its manifest rather than by the
        // image it resolves, so the packs are resolved out of the host audio store
        // here — verified against the published-object lock — and materialized under
        // `/opt/audio` at start. A case declaring no packs stages nothing, which is
        // every end-to-end, adversarial, and performance run and every `sfx-synth`
        // one.
        //
        // The tree is assembled on the host and carried on the spec as a directory,
        // so the clips are copied into the container in one pass and no second copy
        // of the palette is held in the driver for the run's duration. `staged_audio`
        // owns that tree and outlives the container start below.
        let staged_audio = audio_stage::stage_audio(
            &seeding::audio_store_dir(),
            &test_case.audio_packs,
            test_case.asset_kind,
        )?;
        let stages_audio = staged_audio.is_some();
        let mut dirs = Vec::new();
        if let Some(staged) = &staged_audio {
            tracing::debug!(
                packs = staged.manifest.packs.len(),
                "staged the run's audio palette",
            );
            dirs.push(crate::execution::ContainerDir {
                host_path: staged.path().to_path_buf(),
                container_path: test_cabinet_audio_core::staged::AUDIO_ROOT.to_string(),
            });
        }

        let spec = ContainerSpec {
            image: image.clone(),
            repo_path: seeded.path.clone(),
            secrets,
            env,
            files,
            dirs,
            network_enabled: true,
            // Give the container a route to the run host when a viewer is
            // observing the run (the live asset preview), or when harness
            // telemetry is exported to a collector on the run host — both need
            // the same mapping, and a run that needs neither adds none.
            add_hosts: if host_gateway || telemetry_host_gateway {
                vec![crate::preview::HOST_GATEWAY_ADD_HOST.to_string()]
            } else {
                Vec::new()
            },
        };

        // A kill that landed during the setup above (the image pull is the long stage)
        // has nothing to wind down yet. Refuse to start a sandbox for it: the run ends
        // here, recorded nowhere, exactly as the session launch below refuses.
        if cancel.is_canceled() {
            return Err(Error::CanceledBeforeSession);
        }

        events.emit(&HarnessEvent::system(
            SystemStage::StartContainer,
            SystemStatus::Started,
        ));
        let ContainerStart {
            handle,
            scheduling_wait,
        } = match self.runtime.start(&spec).await {
            Ok(start) => start,
            Err(err) => {
                events.emit(&HarnessEvent::system(
                    SystemStage::StartContainer,
                    SystemStatus::Failed,
                ));
                return Err(err);
            }
        };
        events.emit(&HarnessEvent::system(
            SystemStage::StartContainer,
            SystemStatus::Completed,
        ));

        // Check the run image accepts staged audio, for a run that staged some.
        //
        // The writer of the staged tree ships here, in the driver and the CLI; the
        // reader ships in the run image, and the two are pinned separately
        // (`TCAB_DRIVER_IMAGE` and `TCAB_CONTAINER_TAG`) and have drifted for whole
        // release trains. An image predating staged delivery bakes its own palette
        // and would quietly ignore the packs the case declared, so the image states
        // which contract it accepts and a staging run reads that statement before it
        // spends a harness session. A run that stages nothing is never probed, so
        // every non-audio run is untouched by the handshake.
        if stages_audio && let Err(err) = self.check_audio_contract(&handle, &spec.image).await {
            let _ = self.runtime.stop(&handle).await;
            return Err(err);
        }
        // The staged tree has been copied into the container, so the host copy has
        // done its work and its disk goes back now rather than at the end of the run.
        drop(staged_audio);

        // Record the exact image bytes the run used. When the image was launched
        // by a mutable tag, resolve it to the registry digest now that it is
        // pulled, so the run record pins what actually ran; fall back to the
        // launch reference for a local build that has no registry digest.
        let recorded_image = self
            .runtime
            .image_digest(&image)
            .await
            .ok()
            .flatten()
            .unwrap_or(image);

        // Capture the container environment from inside the running container so
        // it reflects what the harness actually built in, not the host. Probes
        // are best-effort: a failure degrades to sensible defaults rather than
        // failing the run. The resolved image is recorded as the run's
        // `containerImage`.
        let environment = self
            .probe_environment(&handle, recorded_image, auth_mode)
            .await;

        // Bound every in-container setup step and the harness session by the
        // run's maximum runtime so nothing can run unbounded. The cap comes from
        // the test case manifest, possibly overridden on the request, and bounds
        // the harness install and the init step below as well as the session.
        let max_runtime = request.effective_max_runtime(test_case);

        // Install the harness's CLI into the running container before the
        // session. The CLI is not baked into the base image; installing it here
        // means a run always picks up the harness's latest published version. A
        // non-zero exit or a timeout aborts the run — a broken install would only
        // waste a harness session — and the container is torn down first.
        if let Some(install) = harness.install_command() {
            events.emit(&HarnessEvent::system(
                SystemStage::InstallHarness,
                SystemStatus::Started,
            ));
            // A non-login shell so the command runs with the container's own
            // environment (its `PATH` already carries the npm global prefix and
            // the user-level bin dirs); a login shell could reset `PATH` from
            // `/etc/profile` and drop them.
            let command = vec!["sh".to_string(), "-c".to_string(), install.to_string()];
            if let Err(err) = run_setup(
                &self.runtime,
                &handle,
                &command,
                Duration::from_secs(max_runtime),
            )
            .await
            {
                events.emit(&HarnessEvent::system(
                    SystemStage::InstallHarness,
                    SystemStatus::Failed,
                ));
                let _ = self.runtime.stop(&handle).await;
                return Err(match err {
                    SetupError::TimedOut => Error::HarnessInstallTimedOut {
                        slug: slug.as_str().to_string(),
                        seconds: max_runtime,
                    },
                    SetupError::Failed(detail) => Error::HarnessInstall {
                        slug: slug.as_str().to_string(),
                        detail,
                    },
                    SetupError::Runtime(err) => err,
                });
            }
            events.emit(&HarnessEvent::system(
                SystemStage::InstallHarness,
                SystemStatus::Completed,
            ));
        }

        // Confirm the install produced a working CLI, capturing the version for
        // the run record. A failed probe aborts the run before a session is spent.
        //
        // gg is not a third-party CLI: it has no `AgentHarness` probe (the `GgHarness`
        // adapter's `probe` is an unimplemented stub) and installs its own binary in the
        // gg branch below, which reports its own version. So the probe stage is skipped
        // for a gg run; `harness_version` is filled in by the gg branch instead.
        let harness_version = if request.is_gg() {
            None
        } else {
            events.emit(&HarnessEvent::system(
                SystemStage::ProbeHarness,
                SystemStatus::Started,
            ));
            let availability = match harness.probe(&self.runtime, &handle).await {
                Ok(availability) => availability,
                Err(err) => {
                    events.emit(&HarnessEvent::system(
                        SystemStage::ProbeHarness,
                        SystemStatus::Failed,
                    ));
                    return Err(err);
                }
            };
            if !availability.available {
                events.emit(&HarnessEvent::system(
                    SystemStage::ProbeHarness,
                    SystemStatus::Failed,
                ));
                let _ = self.runtime.stop(&handle).await;
                return Err(Error::HarnessUnavailable {
                    slug: slug.as_str().to_string(),
                    // A probe that reported nothing leaves this layer to supply the
                    // figure, and the run image is the one it holds: it is what the
                    // CLI was installed into and what a reader has to change.
                    detail: availability
                        .detail
                        .unwrap_or_else(|| format!("no working CLI in run image `{}`", spec.image)),
                });
            }
            events.emit(&HarnessEvent::system(
                SystemStage::ProbeHarness,
                SystemStatus::Completed,
            ));
            availability.version
        };

        // Run the test case's init command, if any, now that the seeded workspace
        // is mounted at the working directory. This is where a case installs its
        // dependencies or runs a setup script (for example `npm install`) before
        // the harness starts, so the workspace it shipped is fully prepared. It
        // runs as the container's unprivileged run user in the workspace and is
        // verified against the workspace's lockfile and retried the way the host's
        // install is (see [`run_init`]); an init that still has not succeeded
        // after its last attempt, or that times out, aborts the run — a broken
        // setup would only waste a harness session — and the container is torn
        // down first.
        if let Some(init) = &test_case.init {
            events.emit(&HarnessEvent::system(
                SystemStage::InitTestCase,
                SystemStatus::Started,
            ));
            if let Err(err) = run_init(
                &self.runtime,
                &handle,
                init,
                max_runtime,
                INSTALL_RETRY_DELAY,
                events,
            )
            .await
            {
                events.emit(&HarnessEvent::system(
                    SystemStage::InitTestCase,
                    SystemStatus::Failed,
                ));
                let _ = self.runtime.stop(&handle).await;
                return Err(match err {
                    SetupError::TimedOut => Error::InitTimedOut {
                        seconds: max_runtime,
                    },
                    SetupError::Failed(detail) => Error::Init(detail),
                    SetupError::Runtime(err) => err,
                });
            }
            events.emit(&HarnessEvent::system(
                SystemStage::InitTestCase,
                SystemStatus::Completed,
            ));
        }

        // Render the base prompt (the goal). The orchestrator that drives the
        // harness sessions was resolved by the caller and passed in. The runner is
        // handed the base prompt as `TCAB_PROMPT` and wraps it with its own
        // protocol before each session.
        //
        // The resolved engine goes in too: the prompt's engine section names the
        // runtime the build is written against and points at the documentation
        // seeded from its package, and a template branches on the slug — so the
        // engineless run renders the prompt it always did.
        let base_prompt = render_prompt(
            test_case,
            variant,
            &self.prior_game_jam_entries,
            Some(engine),
        )?;

        // The deadline a multi-session runner checks to stop gracefully: epoch
        // seconds after which the run's maximum runtime is exhausted (run start +
        // max_runtime). The hard cap below is the backstop.
        let deadline_epoch = unix_now().saturating_add(max_runtime);

        // gg's setup stage, the counterpart to the harness install and probe stages a
        // third-party run took above: the binary is put in place (a `Release` is
        // downloaded over the network here), the invocation file it reads is written,
        // and the version it reports is captured. It runs before the session's clock
        // starts because installing the harness is setup the run engine spends on the
        // model's behalf, and it is bounded by `max_runtime` from within, one bound per
        // container call, as every other in-container setup step is. A failure tears the
        // container down exactly as a failed session does.
        let prepared_gg = match &gg_install {
            Some(install) => {
                match gg_exec::prepare_gg(
                    &self.runtime,
                    &handle,
                    install,
                    request,
                    &base_prompt,
                    WORKSPACE_DIR,
                    provided_files,
                    max_runtime,
                    run_id,
                    events,
                )
                .await
                {
                    Ok(prepared) => Some(prepared),
                    Err(err) => {
                        self.abandon_container(
                            &handle, run_id, test_case, variant, seeded, request, cancel,
                        )
                        .await;
                        return Err(err);
                    }
                }
            }
            None => None,
        };

        // Drive the session, bounded by `max_runtime` exactly as a single session was;
        // on timeout the future is dropped (cancelling the in-flight exec) and the `Err`
        // arm tears the container down, as for any harness failure.
        //
        // A gg run takes its own executor (`gg_exec::run_gg_session`) rather than the
        // orchestrator: gg is launched directly and its first-party telemetry is
        // ingested, summing usage/cost into the outcome. A third-party run drives the
        // resolved orchestrator's runner inside the container through the shared
        // streaming translation (a one-shot run producing exactly what a direct `invoke`
        // would).
        //
        // The session's own clock, started here so it measures the drive and nothing
        // else. Everything above is setup the run engine spends on the model's
        // behalf, and everything below it is teardown; folding either into the
        // session would make one model's recorded working time a function of how
        // long a registry pull, an `npm install` or a harness download took.
        let session_started = self.clock.now();
        let outcome = if let Some(prepared) = prepared_gg {
            let drive = gg_exec::run_gg_session(&self.runtime, &handle, prepared, events, cancel);
            with_runtime_cap(drive, max_runtime, slug).await
        } else {
            let drive = orchestrator::drive_orchestrator(
                &self.runtime,
                &handle,
                harness,
                orchestrator,
                slug,
                &request.model_id,
                &base_prompt,
                WORKSPACE_DIR,
                deadline_epoch,
                max_runtime,
                events,
            );
            // gg reports its own version from its setup stage; a third-party run stamps
            // the version captured by the probe stage above.
            with_runtime_cap(drive, max_runtime, slug)
                .await
                .map(|mut outcome| {
                    outcome.harness_version = harness_version;
                    outcome
                })
        };
        let session_elapsed = self.clock.now().saturating_sub(session_started);
        match outcome {
            Ok(outcome) => Ok(ExecutedSession {
                handle,
                outcome,
                environment,
                scheduling_wait,
                session_elapsed,
            }),
            // The launch was refused against an already-raised latch: no session ran,
            // so there is no journal to salvage — just the container to stop.
            Err(err @ Error::CanceledBeforeSession) => {
                let _ = self.runtime.stop(&handle).await;
                Err(err)
            }
            Err(err) => {
                self.abandon_container(
                    &handle, run_id, test_case, variant, seeded, request, cancel,
                )
                .await;
                Err(err)
            }
        }
    }

    /// Give up on a run whose session produced no outcome, while the container it ran in
    /// still exists.
    ///
    /// Such a run never reaches artifact collection or the post-run seam — the caller
    /// returns straight out of [`run_resolved`](Self::run_resolved) with the error — so
    /// gg's capture journal is rescued first, because a run that hung or ran past its cap
    /// is exactly the run whose record is worth reading (see [`crate::salvage`]). Only
    /// the journal: the produced tree is deliberately left behind. The container is
    /// stopped last.
    #[allow(clippy::too_many_arguments)]
    async fn abandon_container(
        &self,
        handle: &ContainerHandle,
        run_id: &str,
        test_case: &TestCaseVersion,
        variant: &Variant,
        seeded: &SeededRepo,
        request: &RunRequest,
        cancel: &RunCancellation,
    ) {
        self.salvage_session_record(
            handle,
            run_id,
            test_case,
            variant,
            seeded,
            request,
            cancel.is_canceled(),
        )
        .await;
        let _ = self.runtime.stop(handle).await;
    }

    /// Assemble a session record for a run whose session ended in an error, from the
    /// journal [salvaged](crate::salvage) out of the container it is about to lose.
    ///
    /// This is the failure-path counterpart to the [post-run seam](crate::post_run) in
    /// [`run_resolved`](Self::run_resolved), and it runs the *same* wired stage against
    /// the *same* run directory — so a hung run's `replay.json.gz` is indistinguishable
    /// from a completed run's, except for the truncation the record itself reports. What
    /// differs is the tree the stage is pointed at: a scratch directory holding nothing
    /// but the journal, never the implementation, so nothing a hung run half-wrote can be
    /// mistaken for output it produced.
    ///
    /// Deliberately runs **only** the record assembler and not the code analyzer. Code
    /// analysis measures the code the model wrote, and there is no collected tree here to
    /// measure; a figure computed from an empty scratch directory would be a
    /// convincing-looking zero rather than an absence.
    ///
    /// Entirely best-effort, and silent about it: this is called while a run is already
    /// failing, and the failure being reported accurately outranks the diagnostic.
    #[allow(clippy::too_many_arguments)]
    async fn salvage_session_record(
        &self,
        handle: &ContainerHandle,
        run_id: &str,
        test_case: &TestCaseVersion,
        variant: &Variant,
        seeded: &SeededRepo,
        request: &RunRequest,
        canceled: bool,
    ) {
        // Nothing to assemble into, and nothing to assemble: a host that wires no
        // assembler wants no session record, and only gg writes a journal at all. Both
        // are checked before the copy so a failing third-party run is never asked to hand
        // over a file it could not have written.
        let Some(stage) = self.session_assembler.as_deref() else {
            return;
        };
        if !request.is_gg() {
            return;
        }
        // Staged under the output directory, not `/tmp`: the copy is a whole journal and
        // the only volume known to have room for one is the one the run tree is already
        // being written to (see [`crate::salvage`]).
        let Some(scratch) =
            salvage::salvage_journal_tree(&self.collector, handle, &self.output_dir).await
        else {
            return;
        };

        // The run directory the failed record will be written into by
        // `write_failed_record`, which builds the same `<output_dir>/<run_id>` path — the
        // reason `run_resolved` takes its id from the caller rather than minting one. The
        // stage writes its artifact at that tree's root, exactly where a completed run's
        // is, so the driver's mirror and the artifact-service upload find it unchanged.
        let run_dir = self.output_dir.join(run_id);
        if let Err(err) = std::fs::create_dir_all(&run_dir) {
            tracing::warn!(
                error = %err,
                run_dir = %run_dir.display(),
                "could not create the run directory to assemble a salvaged session record into",
            );
            return;
        }
        let artifacts = ArtifactCollection::new(scratch.path().to_path_buf());
        let report = post_run::run_stages(
            std::iter::once(stage),
            &post_run::PostRunContext {
                run_id,
                run_dir: &run_dir,
                artifacts: &artifacts,
                seed_commit: &seeded.initial_commit,
                test_case,
                variant,
                request,
                canceled,
            },
        )
        .await;
        if !report.artifacts.is_empty() {
            tracing::info!(
                artifacts = ?report.artifacts,
                "assembled a session record salvaged from the failed run's container",
            );
        }
    }

    /// Check that a started run container accepts the staged audio contract this
    /// build writes.
    ///
    /// A run image bakes the marker at
    /// [`CONTRACT_MARKER`](test_cabinet_audio_core::staged::CONTRACT_MARKER) holding
    /// the contract version it reads. An image built before audio delivery moved out
    /// of the image has no marker: it carries its own baked palette and resolves a
    /// pack out of that, so it would render the run against packs the case never
    /// declared while reporting nothing wrong. Failing here costs a container start;
    /// not failing here costs a whole harness session and produces a run whose audio
    /// silently came from somewhere else.
    ///
    /// Only called for a run that staged audio, so a mismatch can only ever fail a run
    /// whose result the mismatch would actually change.
    async fn check_audio_contract(&self, handle: &ContainerHandle, image: &str) -> Result<()> {
        let marker = format!(
            "{}/{}",
            test_cabinet_audio_core::staged::AUDIO_ROOT,
            test_cabinet_audio_core::staged::CONTRACT_MARKER
        );
        let stated = self
            .runtime
            .exec(handle, &as_command(["cat", marker.as_str()]))
            .await
            .ok()
            .filter(|out| out.exit_code == 0)
            .map(|out| out.stdout.trim().to_string());
        let expected = test_cabinet_audio_core::staged::CONTRACT_VERSION.to_string();
        if stated.as_deref() == Some(expected.as_str()) {
            return Ok(());
        }
        Err(Error::ContainerRuntime(format!(
            "run image `{image}` does not accept staged audio (`{marker}` is absent or is \
             not `{expected}`); pull a newer image or pin `TCAB_CONTAINER_TAG` to one that \
             stages it"
        )))
    }

    /// Probe a running container for its OS and Node.js version.
    ///
    /// Both probes are best-effort. A failed OS probe falls back to `unknown`
    /// and a failed Node.js probe to `None`; neither aborts the run. The
    /// container image is taken from the harness rather than probed.
    async fn probe_environment(
        &self,
        handle: &ContainerHandle,
        container_image: String,
        auth_mode: AuthMode,
    ) -> RunEnvironment {
        let os = self
            .runtime
            .exec(handle, &as_command(["cat", "/etc/os-release"]))
            .await
            .ok()
            .filter(|out| out.exit_code == 0)
            .and_then(|out| parse_pretty_name(&out.stdout))
            .unwrap_or_else(|| "unknown".to_string());

        let node_version = self
            .runtime
            .exec(handle, &as_command(["node", "--version"]))
            .await
            .ok()
            .filter(|out| out.exit_code == 0)
            .map(|out| out.stdout.trim().to_string())
            .filter(|version| !version.is_empty());

        RunEnvironment {
            os,
            container_image,
            node_version,
            auth_mode,
        }
    }

    /// Collect run metrics from the harness outcome and the run's measured
    /// [durations](RunDurations).
    ///
    /// The comparable cost is always computed from the supplied `prices` — the
    /// model's curated list prices — so two runs of one model compare on the
    /// same basis however each was billed. A harness-reported exact cost (see
    /// [`HarnessOutcome::reported_cost`]) is what the run was billed, so it
    /// lands in the actual cost only; a harness that reports none leaves the
    /// actual cost equal to the comparable one.
    pub fn collect_metrics(
        &self,
        outcome: &HarnessOutcome,
        durations: RunDurations,
        prices: &TokenPrices,
    ) -> Result<RunMetrics> {
        let tokens = outcome.usage.tokens;
        // `comparable_from` yields `None` when the model's prices are unknown,
        // leaving the figure null rather than a misleading $0. It never takes
        // the harness's own accounting: that is the billed figure, and only
        // the actual cost carries it.
        let comparable = Cost::comparable_from(&tokens, prices);
        let cost = Cost {
            comparable,
            actual: outcome.reported_cost.or(comparable),
        };
        Ok(RunMetrics {
            run_time_seconds: durations.run_time_seconds,
            session_seconds: Some(durations.session_seconds),
            setup_seconds: Some(durations.setup_seconds),
            teardown_seconds: Some(durations.teardown_seconds),
            validation_seconds: durations.validation_seconds,
            tokens,
            cost,
        })
    }

    /// Run the validation pass over the produced implementation, scoring each
    /// declared check against the rendered reference baselines.
    #[instrument(
        name = "validate",
        skip_all,
        fields(test_case.slug = %test_case.slug, test_case.version = %test_case.version),
        err,
    )]
    pub fn validate(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
        artifacts: &ArtifactCollection,
        references: &[RenderedReference],
        proofs: &[ProofFile],
    ) -> Result<ValidationSummary> {
        self.validator
            .validate(test_case, variant, artifacts, references, proofs)
    }

    /// Serialize the run record as camelCase JSON and store it, alongside a copy
    /// of the produced implementation, under the run's output directory.
    pub fn write_record(&self, record: &RunRecord, artifacts: &ArtifactCollection) -> Result<()> {
        let run_dir = self.output_dir.join(&record.id);
        std::fs::create_dir_all(&run_dir)?;

        let json = serde_json::to_string_pretty(record)?;
        std::fs::write(run_dir.join("run-record.json"), json)?;

        let implementation = run_dir.join("implementation");
        copy_tree(&artifacts.repo_path, &implementation)?;
        Ok(())
    }

    /// Drive an entire run end to end through every lifecycle stage.
    ///
    /// Normalized [events](crate::event) produced while the harness runs are
    /// emitted to `events` so callers can observe the run live. Pass
    /// [`NoopEventSink`] to ignore them. An asset-generation run also streams its
    /// live drawing [frames](crate::preview) to `preview` when one is supplied;
    /// pass `None` to ignore them.
    ///
    /// `cancel` is the run's [cancellation latch](RunCancellation): raise it and a
    /// [gg] session is asked to wind down, after which the run still finishes
    /// through its ordinary post-session path and produces a complete record of what it
    /// got through. Only gg observes it — a third-party harness has no wind-down protocol
    /// to ask for — so raising it is no way to stop one of those; that takes tearing the
    /// sandbox down. Pass a [`RunCancellation::default`] for a run nothing can cancel.
    pub async fn run(
        &self,
        request: &RunRequest,
        events: &mut dyn EventSink,
        preview: Option<Arc<dyn PreviewSink>>,
        cancel: &RunCancellation,
    ) -> Result<RunRecord> {
        let test_case = self.resolve(request)?;
        self.run_resolved(&mint_run_id(), request, &test_case, events, preview, cancel)
            .await
    }

    /// Drive a run end to end against an already-resolved [`TestCaseVersion`],
    /// skipping the catalog lookup [`Self::run`] performs.
    ///
    /// This is the entry point a backend-driven runner uses: it resolves the
    /// version through [`crate::BackendClient`] (materializing the served
    /// definition to disk via [`crate::materialize_version`]) and supplies the
    /// result here, rather than reading a local `test-cases/` checkout. The
    /// orchestrator's `renderer` should be a
    /// [`crate::PrerenderedReferenceRenderer`] over the backend's screenshots in
    /// that case, so this method reuses them instead of re-rendering mockup HTML
    /// the runner never receives.
    ///
    /// # Why the caller supplies the run id
    ///
    /// `run_id` is the identity **everything** about this run is keyed by: the record
    /// it produces, the `<output_dir>/<run_id>` tree it writes, the artifacts the
    /// [post-run stages](crate::post_run) drop at that tree's root, and the telemetry
    /// the harness stamps as it runs. [`Self::run`] mints one with [`mint_run_id`] and
    /// most callers should do the same — but a host that has to *report* a run this
    /// method never returns from cannot. A run that hangs or outruns its cap ends in an
    /// [`Err`], after the engine has already
    /// [salvaged](crate::salvage) its capture journal into `<output_dir>/<run_id>`; the
    /// host then builds the failure record itself with
    /// [`write_failed_record`]. Were the id minted privately here, that record would
    /// carry a *different* id, and everything the failing run left on disk — the
    /// salvaged session record above all — would be orphaned under an id nothing else knows.
    /// Taking it as a parameter is what keeps the failure path and the success path
    /// naming the same run.
    #[instrument(
        name = "run",
        skip_all,
        fields(
            test_case.slug = %test_case.slug,
            test_case.version = %test_case.version,
            variant = %request.variant,
            harness = %request.harness.as_str(),
            model = %request.model_id,
            // Recorded at the top of the run body, before anything is executed, so
            // every span the run emits can be tied back to the record it produces.
            run.id = tracing::field::Empty,
        ),
        err,
    )]
    pub async fn run_resolved(
        &self,
        run_id: &str,
        request: &RunRequest,
        test_case: &TestCaseVersion,
        events: &mut dyn EventSink,
        preview: Option<Arc<dyn PreviewSink>>,
        cancel: &RunCancellation,
    ) -> Result<RunRecord> {
        let started_at = OffsetDateTime::now_utc();
        let run_started = self.clock.now();

        // The run's identity is known before anything is executed rather than when the
        // record is built at the end. Nothing here depends on the run's outcome, and
        // having it before the harness starts is what lets the harness tag its OWN
        // telemetry with the run (see `harness_telemetry::TelemetrySubject`). Known
        // late, the harness's spans could not be correlated to the run that produced
        // them: they would land in Tempo describing tool calls and model turns with no
        // way to tie them back to anything.
        tracing::Span::current().record("run.id", run_id);

        // Enforce the gg configuration invariant before anything is set up: a gg run
        // must carry a capability set and a non-gg run must not. A mismatch here
        // means the request was assembled wrong (a gg harness with no capability
        // set, or a stray set on a third-party-harness run) — fail fast with a clear
        // message rather than silently taking the wrong execution path downstream.
        request.validate()?;

        // Orchestrator selection is limited to the types that build a program over a
        // working session — end-to-end and full-stack. The other types build a single
        // artifact in one pass and always run one-shot. Reject any non-default
        // orchestrator (a non-one-shot built-in slug, or an external
        // `--orchestrator-dir`, which is by definition not one-shot) for those types.
        // This fails fast — before any container is started — so a misconfigured
        // request never burns setup.
        let orchestrator_requested =
            request.orchestrator.slug != ONE_SHOT_SLUG || request.orchestrator.dir.is_some();
        if orchestrator_requested
            && !matches!(
                test_case.test_type,
                TestType::EndToEnd | TestType::FullStack | TestType::GameJam
            )
        {
            return Err(Error::OrchestratorUnsupportedForTestType {
                slug: request.orchestrator.slug.clone(),
                test_type: test_case.test_type,
            });
        }
        // Resolve the orchestrator once up front so its manifest's authoritative
        // slug is what the run record attributes the run to (an external dir
        // records its manifest's slug, not the empty request slug). Resolving here
        // also surfaces an unknown slug or unreadable directory before any setup.
        let orchestrator = self.orchestrators.resolve(&request.orchestrator)?;

        // The engine gate, beside the orchestrator's and for the same reason: the
        // selection must resolve, and the case must support what it names, before a
        // single container second is spent. Unlike the orchestrator the gate is the
        // *case's* — a version declares the engines its specs are written for and
        // its validation drives, so running it under any other would score the build
        // against checks meant for a different runtime. Resolving here also gives
        // the rest of the run the manifest itself, which the seeder vendors from,
        // the prompt and specs render against, and the record is attributed to.
        let engine = resolve_engine(&self.engines, request, test_case)?;

        // Select the variant up front so its specs are what gets seeded and its
        // slug is what the run record attributes the run to.
        let variant = test_case.variant(&request.variant)?.clone();
        let specs = test_case.seeded_specs(&variant);
        // The starter workspace seeded for this variant: its own when it overrides
        // the case's workspace, otherwise the common one. Cloned so it outlives the
        // borrow of `test_case` through the rest of the run.
        let workspace = test_case.workspace_for(&variant, engine.slug()).to_vec();
        // Render the selected variant's reference mockups once: the screenshots
        // are both seeded as visual targets and reused as validation baselines
        // below. A variant may add references of its own on top of the common set.
        let references = self.render_references(test_case, &variant)?;
        // A run is only meaningful if every declared reference rendered: those
        // screenshots are the visual targets the harness builds against and the
        // baselines validation scores against. Rendering degrades view-by-view
        // (a failure is logged and skipped, not raised), so detect a short render
        // here and refuse to start rather than seed an incomplete target set and
        // burn a harness session on it.
        let expected = test_case.references_for(&variant);
        if references.len() < expected.len() {
            let rendered: std::collections::HashSet<&str> =
                references.iter().map(|r| r.view.as_str()).collect();
            let missing = expected
                .iter()
                .map(|view| view.view.clone())
                .filter(|view| !rendered.contains(view.as_str()))
                .collect();
            return Err(Error::ReferenceRenderIncomplete {
                slug: test_case.slug.clone(),
                version: test_case.version.clone(),
                missing,
            });
        }
        // When a viewer supplied a preview sink and this is an asset-generation
        // run, open a host listener and seed its address so the drawing binary
        // streams each re-rendered frame to the viewer (see [`crate::preview`]).
        // The listener lives in `live` for the whole run and is torn down when it
        // drops at the end; a bind failure degrades to no live preview rather than
        // failing the run, since the preview is non-essential.
        let live = match preview {
            Some(sink) if test_case.test_type == TestType::AssetGeneration => {
                match LivePreview::start(sink).await {
                    Ok(live) => Some(live),
                    Err(err) => {
                        eprintln!(
                            "warning: could not start the live preview listener ({err}); proceeding without it"
                        );
                        None
                    }
                }
            }
            _ => None,
        };

        let seeded = self.seed(
            test_case,
            &variant,
            &specs,
            &workspace,
            &references,
            live.as_ref().map(LivePreview::endpoint),
            &engine,
        )?;
        // The workspace-relative paths of everything the test case provided — its specs
        // (in seeded order) then its rendered reference images (under `reference/`, the
        // layout `FsRepoSeeder::seed` writes) — for a gg run's autoload-specifications
        // capability. Computed here, where the seeded spec and reference lists are both in
        // hand, so gg is told exactly which seeded files are the test case's brief rather
        // than having to tell them apart from a starter-workspace scaffold. Unused by a
        // third-party-harness run.
        let provided_files: Vec<PathBuf> = specs
            .iter()
            .map(|spec| spec.dest.clone())
            .chain(
                references
                    .iter()
                    .map(|reference| Path::new("reference").join(reference.file_name())),
            )
            .collect();
        let ExecutedSession {
            handle,
            outcome,
            environment,
            scheduling_wait,
            session_elapsed,
        } = self
            .execute(
                test_case,
                &variant,
                &seeded,
                &provided_files,
                request,
                &orchestrator,
                &engine,
                events,
                live.is_some(),
                run_id,
                cancel,
            )
            .await?;
        // The run timer the instant the session ended. Everything the run engine did
        // before this point is setup and everything after it is teardown, so this
        // read plus `session_elapsed` is what separates the model's own working time
        // from the fleet's (see [`RunDurations::partition`]).
        let before_teardown = self.clock.now().saturating_sub(run_started);

        // Collect the working tree, then always tear the container down. The
        // teardown is bracketed by system events so the feed shows the run
        // wrapping up rather than going quiet once the harness session ends.
        events.emit(&HarnessEvent::system(
            SystemStage::Teardown,
            SystemStatus::Started,
        ));
        let artifacts = self.collector.collect(&handle).await;
        let _ = self.runtime.stop(&handle).await;
        events.emit(&HarnessEvent::system(
            SystemStage::Teardown,
            SystemStatus::Completed,
        ));
        let mut artifacts = artifacts?;

        // The run's wall clock, frozen here so nothing below can inflate what the
        // run is judged on. [`RunDurations::partition`] turns it into the recorded
        // durations, subtracting the time the run pod spent queued for cluster
        // capacity before it started: that is wall-clock the run was waiting its
        // turn, not running, so counting it would unfairly inflate a run's time
        // whenever the cluster was busy. `scheduling_wait` is zero for runtimes (a
        // local Docker/Podman) that admit the container immediately.
        let measured = self.clock.now().saturating_sub(run_started);
        // The comparable cost is computed from the list price the backend stamped
        // onto the request at enqueue, and nothing else. A harness-reported cost is
        // the billed figure and lands in the actual cost alone.
        let prices = request.list_prices();

        // The post-run stage seam: the single place any host-side analysis of a
        // finished run happens (see [`crate::post_run`]). Its position is the whole
        // point of it, and all three neighbours matter.
        //
        // *After collection*, so the tree it reads is on the host and the container
        // is already gone. *Before validation*, because the validator runs the case's
        // install and build commands **in the produced tree itself** — after it, the
        // tree carries build output, a rewritten lockfile and toolchain caches, and
        // carries different amounts of them depending on how far validation got, so
        // this is the only placement under which "the code the model wrote" is
        // literally true. And *outside the runtime cap*, which `execute` applies to
        // the harness session and to each in-container setup step, each on its own
        // — with the run's measured duration already frozen above, so no analysis
        // can ever eat into the test case's `max_runtime_hours` or inflate what the
        // run is scored on.
        //
        // Note this runs for a **canceled** run too, unlike the validation below.
        // Validation is skipped for a cancellation because it is fresh work that
        // judges output an operator chose to stop; analysis is not that — it reads
        // bytes that already exist and renders no verdict.
        let run_dir = self.output_dir.join(run_id);
        std::fs::create_dir_all(&run_dir)?;

        // The engine the tree was built on, stamped on the tree's own description
        // *before* anything reads it. The engine is vendored into the seeded tree, so
        // which runtime a build was written against is a property of the tree rather
        // than of the call that consumes it, and two readers ask: validation, to decide
        // whether the case's validators run as a vitest project or its instrumentation
        // is driven in a browser, and the code analysis, whose floor must know whether
        // `engine/` at the tree root is the engine's own documentation or the model's
        // work. The second is why the stamp is made here rather than after the seam.
        artifacts.engine = Some(engine.clone());

        let post_run = post_run::run_stages(
            [
                self.session_assembler.as_deref(),
                self.analyzer.as_deref(),
                // Last, and the ordering is load-bearing: this stage installs
                // dependencies and runs a build *in* the collected tree, so anything
                // that measures "the code the model wrote" must have measured it
                // already.
                self.toolchain.as_deref(),
            ]
            .into_iter()
            .flatten(),
            &post_run::PostRunContext {
                run_id,
                run_dir: &run_dir,
                artifacts: &artifacts,
                seed_commit: &seeded.initial_commit,
                test_case,
                variant: &variant,
                request,
                canceled: outcome.canceled,
            },
        )
        .await;
        if !post_run.artifacts.is_empty() {
            tracing::info!(
                artifacts = ?post_run.artifacts,
                "post-run analysis wrote the run's artifacts",
            );
        }

        // A stage that ran the case's install over this very tree says so here, and
        // the tree's description carries it into validation, which runs the same
        // install. A lockfile install clears `node_modules` and rebuilds it from the
        // lockfile, so a second one only reproduces the state the first left; the
        // recorded step is reported instead. The stamp is made here, on the value
        // about to be validated, so it can only ever describe the tree in hand.
        artifacts.prepared_install = post_run.prepared_install.clone();

        // The proof-of-implementation artifacts requested for this variant; the
        // validator records whether each turned up in the produced tree.
        let proofs = test_case.proofs_for(&variant);
        // Validation is the one post-session stage a canceled run **skips**, and the
        // reason is the distinction the whole cooperative path is built on: everything
        // else here reads state the run already produced, while validation is fresh work
        // — it installs, builds, serves and drives the model's output, minutes of it. A
        // run an operator stopped is meant to be frozen where it stood, and judging a
        // half-written implementation would be neither a freeze nor a fair result. Its
        // summary is therefore empty rather than failed: nothing was checked, so nothing
        // is reported as having failed a check.
        let (validation, validation_elapsed) = if outcome.canceled {
            (ValidationSummary::default(), None)
        } else {
            let validation_started = self.clock.now();
            let validation =
                self.validate(test_case, &variant, &artifacts, &references, &proofs)?;
            (
                validation,
                Some(self.clock.now().saturating_sub(validation_started)),
            )
        };
        let finished_at = OffsetDateTime::now_utc();

        // Every duration the run measured, partitioned so setup, session and
        // teardown sum to the run's frozen wall clock exactly. Built here because
        // the validation pass is the last stage that contributes one, and recorded
        // outside that sum because validation ran after the wall clock was frozen.
        let metrics = self.collect_metrics(
            &outcome,
            RunDurations::partition(
                measured,
                before_teardown,
                session_elapsed,
                scheduling_wait,
                validation_elapsed,
            ),
            &prices,
        )?;

        // A clean harness exit that produced nothing evaluable is a model
        // catastrophe, not a completion — unless the reason nothing was evaluable is
        // that the Test Cabinet's own dependency install never succeeded, which is
        // an infrastructure failure carrying the install's reason (computed before
        // `validation` is moved into the record). A canceled run is neither: an
        // operator ended it, so it is recorded as what it is rather than judged on
        // output it never finished.
        let status = if outcome.canceled {
            RunStatus {
                state: RunState::Canceled,
                detail: None,
            }
        } else {
            completed_status(test_case.test_type, &validation)
        };
        let record = RunRecord {
            id: run_id.to_string(),
            started_at: started_at.format(&Rfc3339).unwrap_or_default(),
            finished_at: finished_at.format(&Rfc3339).unwrap_or_default(),
            subject: RunSubject {
                test_case_slug: test_case.slug.clone(),
                test_case_version: test_case.version.clone(),
                test_type: test_case.test_type,
                variant: variant.slug.clone(),
                harness_slug: request.harness,
                harness_version: outcome.harness_version.clone(),
                orchestrator_slug: orchestrator.manifest.slug.clone(),
                // The *resolved* manifest's slug, exactly as the orchestrator's is:
                // what the run was actually built on, not what the request happened
                // to spell. `none` for a run that vendored no runtime.
                engine_slug: engine.slug().to_string(),
                // …and the version of the runtime that was actually vendored, read
                // out of the staged package while seeding. `None` when the engine
                // vendors none, which is the only honest answer — there is no
                // package to have a version.
                engine_version: seeded.engine_version.clone(),
                model_id: request.model_id.clone(),
                // Record the gg run's exact configuration on the run so a result is
                // traceable to it and result aggregation can slice by capability set.
                // `None` for every non-gg run (the invariant `validate` enforced up
                // front: a set is present iff the harness is gg).
                gg_capability_set: request.gg_capability_set.clone(),
                // Record the gg run's aggregatable outcome summary (the gg binary
                // computed it from its telemetry and emitted it just before ending, and
                // the ingest lifted it), so result aggregation can slice a run's outcome
                // by its capability set without re-parsing the event stream. `None` for
                // every non-gg run and for a gg run that ended before emitting one.
                gg_summary: outcome.gg_summary.clone(),
            },
            tooling: RunTooling::current(),
            environment,
            metrics,
            validation,
            links: RunLinks::default(),
            status,
            // For a game jam, capture the produced gameplay README so a later run of
            // the same jam by this model can be briefed on what was already built and
            // asked for something distinct. `None` for every other type, and for a jam
            // run that shipped no README.
            game_jam_readme: read_game_jam_readme(test_case.test_type, &artifacts.repo_path),
            // The per-tool invocation tally the parser accumulated over the run,
            // including consumed todo tools, for comparison diagnostics.
            tool_calls: outcome.tool_calls.clone(),
            // …and record the earlier entries this run was itself briefed with —
            // READMEs and all, since they are inputs the run was given and the Inputs
            // tab shows them inline like every other seeded file.
            game_jam_prior_entries: self.prior_game_jam_entries.clone(),
            // The seed commit computed when this run's workspace was seeded, carried
            // through so anything measuring the produced tree can tell the scaffolding
            // the run was given from the code the model actually wrote — exactly,
            // rather than by guessing at the tree's root commit.
            seed_commit: Some(seeded.initial_commit.clone()),
            // The bounded code-analysis summary the post-run seam produced, if a host
            // wired an analyzer. It is folded in here rather than written by the stage
            // because the record does not exist when the stage runs — and it must not,
            // since the whole point of the seam's placement is that the analysis
            // measures the tree *before* validation rewrites it. `None` leaves the
            // field off the record entirely, which is the honest encoding of "this run
            // was never analysed" as distinct from "this run measured nothing".
            code_analysis: post_run.code_analysis,
            // What the case's `[toolchain]` commands did, when it declares any. This
            // is the one post-run block a run's rating depends on: a `typecheck` that
            // ran and failed gates the run (see `RunRecord::gated_broken`). It is
            // still only *recorded* here — the engine renders no verdict from it, and
            // the terminal state below is decided exactly as it was before.
            toolchain: post_run.toolchain,
            // The model's own presentation of its game, captured from the produced
            // tree's `showcase/` directory so the Play page can render it around the
            // playable build. `None` when the tree carries no parseable showcase — a
            // showcase problem never fails the run and never degrades its status.
            showcase: read_showcase(&artifacts.repo_path),
        };

        self.write_record(&record, &artifacts)?;
        // Persist the harness's raw output and its translation beside the record
        // so a run's event classification can be inspected and re-checked.
        write_run_streams(
            &self.output_dir.join(&record.id),
            &outcome.raw_output,
            &outcome.translated_events,
        )?;
        Ok(record)
    }
}

/// The largest game-jam README captured into a run record, in bytes. A gameplay
/// README is a short how-to-play blurb; this cap keeps a pathological one from
/// bloating the record blob (and, once served back, a later run's prompt). A longer
/// README is truncated on a char boundary with a trailing marker.
const MAX_GAME_JAM_README_BYTES: usize = 16 * 1024;

/// Capture a game-jam run's produced gameplay `README.md` from the collected tree,
/// or `None` when the type is not a game jam, no README was produced, or it could
/// not be read. Whitespace-only content is treated as absent, and an oversized
/// README is truncated to [`MAX_GAME_JAM_README_BYTES`] on a char boundary.
///
/// The README is the model's own file at the produced tree's root (the game-jam
/// prompt asks for one describing what the game is and how to play); it is the
/// single input a later run of the same jam is briefed with to build something
/// distinct.
fn read_game_jam_readme(test_type: TestType, repo_path: &Path) -> Option<String> {
    if test_type != TestType::GameJam {
        return None;
    }
    let readme = std::fs::read_to_string(repo_path.join("README.md")).ok()?;
    if readme.trim().is_empty() {
        return None;
    }
    if readme.len() <= MAX_GAME_JAM_README_BYTES {
        return Some(readme);
    }
    // Truncate on a char boundary so the stored string stays valid UTF-8.
    let mut end = MAX_GAME_JAM_README_BYTES;
    while end > 0 && !readme.is_char_boundary(end) {
        end -= 1;
    }
    Some(format!("{}\n\n…(README truncated)", &readme[..end]))
}

/// The largest showcase description, in bytes. The description is a store-page
/// blurb; this cap keeps a pathological one from bloating every store downstream.
/// The run-side capture truncates a longer one on a char boundary with a trailing
/// marker; the case-side resolution (an authored, committed showcase — see
/// `test_case::Variant::showcase`) hard-fails instead.
pub(crate) const MAX_SHOWCASE_DESCRIPTION_BYTES: usize = 64 * 1024;

/// The most media entries a showcase carousel may hold. The run-side capture
/// drops the excess with a warning — the carousel is a highlight reel, not an
/// archive — while the case-side resolution hard-fails on it.
pub(crate) const MAX_SHOWCASE_MEDIA_ENTRIES: usize = 10;

/// The largest media file a showcase carousel entry may name, in bytes. An entry
/// naming a larger file is dropped with a warning, since the file travels the
/// per-run media path and a pathological one would bloat every store downstream.
/// Public because the driver's backend-store mirror applies the same cap to the
/// directory it uploads, so a file the capture refused never ships either.
pub const MAX_SHOWCASE_MEDIA_FILE_BYTES: u64 = 25 * 1024 * 1024;

/// The shape of a `showcase.toml`: the ordered carousel, one `[[media]]` table
/// per entry. Shared by the run-side capture (a model-written
/// `showcase/showcase.toml` in the produced tree) and the case-side resolution
/// (an authored showcase directory a variant declares — see
/// `test_case::Variant::showcase`), so the two showcases stay one format.
/// Deliberately lenient about unknown keys — the run-side manifest is
/// model-written, and a stray extra key is not worth losing the whole showcase.
#[derive(serde::Deserialize)]
pub(crate) struct ShowcaseManifest {
    #[serde(default)]
    pub(crate) media: Vec<ShowcaseManifestEntry>,
}

/// One `[[media]]` table of a `showcase.toml`.
#[derive(serde::Deserialize)]
pub(crate) struct ShowcaseManifestEntry {
    /// The media file's name in the showcase directory itself (no subdirectories).
    pub(crate) file: String,
    /// The short caption for the entry.
    pub(crate) name: String,
}

/// Capture a run's [showcase](RunShowcase) from the collected tree's `showcase/`
/// directory, or `None` when none was produced or it could not be parsed.
///
/// The showcase is the model's own presentation of its game — `showcase.md` (the
/// description) plus `showcase.toml` (the ordered media carousel) — instructed
/// through the case's prompt and specs rather than declared by any manifest key,
/// so the same capture applies to every test type that asks for one. Capture is
/// bounded: the description is truncated to [`MAX_SHOWCASE_DESCRIPTION_BYTES`] on
/// a char boundary, the carousel is capped at [`MAX_SHOWCASE_MEDIA_ENTRIES`], and
/// an entry whose file is not a plain readable file within
/// [`MAX_SHOWCASE_MEDIA_FILE_BYTES`] — or whose extension names no known
/// [`MediaKind`] — is dropped with a warning.
///
/// A showcase problem never fails a run and never degrades its status: the
/// showcase is presentation, so the worst a malformed one costs is itself.
fn read_showcase(repo_path: &Path) -> Option<RunShowcase> {
    let dir = repo_path.join("showcase");
    if !dir.is_dir() {
        // No showcase was produced — the ordinary case for a run that was never
        // asked for one, so not worth a warning.
        return None;
    }
    let description = match std::fs::read_to_string(dir.join("showcase.md")) {
        Ok(text) => text,
        Err(err) => {
            tracing::warn!(
                error = %err,
                "the produced showcase/ has no readable showcase.md; recording no showcase",
            );
            return None;
        }
    };
    if description.trim().is_empty() {
        tracing::warn!("the produced showcase.md is blank; recording no showcase");
        return None;
    }
    let manifest = match std::fs::read_to_string(dir.join("showcase.toml")) {
        Ok(text) => text,
        Err(err) => {
            tracing::warn!(
                error = %err,
                "the produced showcase/ has no readable showcase.toml; recording no showcase",
            );
            return None;
        }
    };
    let manifest: ShowcaseManifest = match toml::from_str(&manifest) {
        Ok(manifest) => manifest,
        Err(err) => {
            tracing::warn!(
                error = %err,
                "the produced showcase.toml could not be parsed; recording no showcase",
            );
            return None;
        }
    };

    let description = if description.len() <= MAX_SHOWCASE_DESCRIPTION_BYTES {
        description
    } else {
        // Truncate on a char boundary so the stored string stays valid UTF-8.
        let mut end = MAX_SHOWCASE_DESCRIPTION_BYTES;
        while end > 0 && !description.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}\n\n…(description truncated)", &description[..end])
    };

    let mut entries = manifest.media;
    if entries.len() > MAX_SHOWCASE_MEDIA_ENTRIES {
        tracing::warn!(
            declared = entries.len(),
            kept = MAX_SHOWCASE_MEDIA_ENTRIES,
            "the produced showcase.toml declares more media than the carousel cap; dropping the excess",
        );
        entries.truncate(MAX_SHOWCASE_MEDIA_ENTRIES);
    }
    let mut media = Vec::new();
    for entry in entries {
        // An entry names a plain file in `showcase/` itself — no subdirectories —
        // which is also the invariant that keeps the served
        // `/runs/<id>/showcase/<file>` route a flat namespace. The `..` check
        // matches the serve side (`playable::serve_showcase_file` refuses any name
        // *containing* `..`), so a name capture records is a name every route
        // serves.
        if entry.file.is_empty() || entry.file.contains(['/', '\\']) || entry.file.contains("..") {
            tracing::warn!(
                file = %entry.file,
                "a showcase media entry does not name a plain file in showcase/; dropping it",
            );
            continue;
        }
        let metadata = match std::fs::metadata(dir.join(&entry.file)) {
            Ok(metadata) if metadata.is_file() => metadata,
            _ => {
                tracing::warn!(
                    file = %entry.file,
                    "a showcase media entry names a file missing from showcase/; dropping it",
                );
                continue;
            }
        };
        if metadata.len() > MAX_SHOWCASE_MEDIA_FILE_BYTES {
            tracing::warn!(
                file = %entry.file,
                bytes = metadata.len(),
                "a showcase media entry names a file over the size cap; dropping it",
            );
            continue;
        }
        let Some(kind) = MediaKind::from_path(Path::new(&entry.file)) else {
            tracing::warn!(
                file = %entry.file,
                "a showcase media entry's extension names no known media kind; dropping it",
            );
            continue;
        };
        media.push(ShowcaseMedia {
            file: entry.file,
            name: entry.name,
            kind,
        });
    }
    Some(RunShowcase { description, media })
}

/// The terminal status for a run whose harness exited cleanly, given the test type
/// and its validation summary.
///
/// A clean exit means the model claimed completion. For a **human-reviewed** type
/// (end-to-end, full-stack, game-jam, asset-generation) this splits three ways.
/// An output whose [dependency install](crate::install) did not succeed — after
/// every attempt the verified install makes — was never given a chance to build,
/// so nothing about the model can be concluded: the run is
/// [`RunState::Infrastructure`], with a [`RunStatus::detail`] naming the install's
/// reason. Otherwise an output that never loaded leaves nothing to review — the
/// model's output is broken (a tree with no `package.json`, or a build or load
/// that failed after its install succeeded) — so the run is
/// [`RunState::Catastrophic`]; anything that loaded is [`RunState::Completed`]
/// and goes to review, however badly it validated. A validation script that could
/// not be driven fails the individual checklist point it backs (see
/// [`crate::validation::DebugScriptResult`]) rather than diverting the whole run
/// out of review, so a build with a broken debug API is scored down by a reviewer
/// who can see exactly which checks it cost. The **auto-scored** types
/// (adversarial, performance) carry their authoritative result in the validation
/// summary even when `loaded` is false (a forfeit or an incorrect engine is a real,
/// low score, not a catastrophe), so they stay [`RunState::Completed`]; a per-type
/// catastrophic tier for them is deferred.
///
/// Only the infrastructure outcome carries a detail: the other two are read from
/// the validation summary itself.
fn completed_status(test_type: TestType, validation: &ValidationSummary) -> RunStatus {
    let state = |state: RunState| RunStatus {
        state,
        detail: None,
    };

    // Only the human-reviewed types gate this way; the auto-scored types carry
    // their result even on a bad load, and none of them declare debug scripts.
    if !matches!(
        test_type,
        TestType::EndToEnd | TestType::FullStack | TestType::GameJam | TestType::AssetGeneration
    ) {
        return state(RunState::Completed);
    }

    if validation.loaded {
        return state(RunState::Completed);
    }

    // The install ran and did not succeed: the tree was never built, so the
    // failure is the Test Cabinet's, and the reason is the install's own — the
    // packages it left uninstalled, the exit that failed, or why it never ran. A
    // tree that never reached the install (no `package.json`) has no install step
    // at all and stays a catastrophe below.
    //
    // The status detail is what a run list and a run's header show, so it carries
    // the reason alone: the first line of the step's detail, which is the reason
    // on its own, and never the output excerpt behind it, which the install step
    // itself records in full.
    if let Some(install) = validation.install.as_ref().filter(|step| !step.succeeded) {
        let reason = install
            .detail
            .as_deref()
            .and_then(|detail| detail.lines().next())
            .map(|line| line.trim().trim_end_matches(':').trim_end())
            .filter(|line| !line.is_empty())
            .unwrap_or("the install did not succeed");
        let attempts = match install.attempts {
            Some(attempts) if attempts > 1 => format!(" after {attempts} attempts"),
            _ => String::new(),
        };
        return RunStatus {
            state: RunState::Infrastructure,
            detail: Some(format!("dependency install failed: {reason}{attempts}")),
        };
    }

    // Nothing was produced that runs: no build to host, nothing to review.
    state(RunState::Catastrophic)
}

/// Mint a fresh run id.
///
/// One place, so every host names runs the same way. A host that drives a run through
/// [`RunEngine::run_resolved`] mints the id *before* the run and keeps it: it is what the
/// engine writes the run tree under, and what the host must reuse when it has to
/// [record the run's failure itself](write_failed_record) — otherwise the two halves of a
/// failed run are filed under different ids and everything the engine salvaged is
/// orphaned.
pub fn mint_run_id() -> String {
    cuid2::create_id()
}

/// Build and persist the record for a run that failed before producing an
/// implementation, under `output_dir`, and return it.
///
/// The `id` must be the same one the run was driven under (see [`mint_run_id`]) whenever
/// the run reached the engine at all: the engine may already have written into
/// `<output_dir>/<id>` — a hung gg run's [salvaged](crate::salvage) session record lands
/// there — and a record filed under a different id leaves all of it unreachable.
///
/// A run that errors before [`RunEngine::run_resolved`] reaches its success path
/// never writes a [`RunRecord`], so it vanishes from the produced-runs listing
/// the consoles read — leaving no way to see that it ran or why it stopped. This
/// records such a run carrying the classified terminal `state` ([`RunState::TimedOut`]
/// for a model that ran past the runtime cap, [`RunState::Infrastructure`] for a
/// Test-Cabinet fault — see [`RunState::classify_failure`]) and the failure
/// `detail`, plus whatever `events` were captured before the failure, written as
/// `events.jsonl` beside it so a reviewer can inspect the timeline. Metrics,
/// validation, and the container environment are left at their empty/unknown
/// defaults — a failed run produced none.
///
/// This is a free function rather than a [`RunEngine`] method because the
/// failures that most need recording happen *before* an engine exists — the
/// container runtime cannot be found, or the definition will not resolve from the
/// backend — so the runner has only the request, an output directory, and the
/// reason. `test_case` is the resolved version when the failure happened after
/// resolution (so the record carries its real version and test type), or `None`
/// before it could be resolved; the subject then falls back to the request.
#[allow(clippy::too_many_arguments)]
pub fn write_failed_record(
    output_dir: &std::path::Path,
    id: &str,
    request: &RunRequest,
    test_case: Option<&TestCaseVersion>,
    started_at: OffsetDateTime,
    state: RunState,
    detail: impl Into<String>,
    events: &[HarnessEvent],
) -> Result<RunRecord> {
    let record = build_failed_record(
        id,
        request,
        test_case,
        started_at,
        OffsetDateTime::now_utc(),
        state,
        detail,
    );
    let run_dir = output_dir.join(&record.id);
    std::fs::create_dir_all(&run_dir)?;
    let json = serde_json::to_string_pretty(&record)?;
    std::fs::write(run_dir.join("run-record.json"), json)?;
    // The captured events make the failure auditable; an empty backlog (a failure
    // before any event arrived) simply writes nothing.
    if !events.is_empty() {
        write_jsonl(&run_dir.join("events.jsonl"), events)?;
    }
    Ok(record)
}

/// Build the [`RunRecord`] for a run that failed before producing an
/// implementation. See [`write_failed_record`] for the rationale; this is its
/// pure record-building half, split out so the mapping from a failed run's known
/// context to its record can be unit-tested without touching the filesystem.
fn build_failed_record(
    id: &str,
    request: &RunRequest,
    test_case: Option<&TestCaseVersion>,
    started_at: OffsetDateTime,
    finished_at: OffsetDateTime,
    state: RunState,
    detail: impl Into<String>,
) -> RunRecord {
    let orchestrator_slug = if request.orchestrator.slug.is_empty() {
        ONE_SHOT_SLUG.to_string()
    } else {
        request.orchestrator.slug.clone()
    };
    // The engine the run was *launched* with, since a failure record is built from
    // the request alone — there is no resolved manifest here, and the failure may
    // well be that the engine would not resolve at all. An empty slug means the
    // request never named one, which is the engineless run.
    let engine_slug = if request.engine.slug.is_empty() {
        NONE_SLUG.to_string()
    } else {
        request.engine.slug.clone()
    };
    RunRecord {
        id: id.to_string(),
        started_at: started_at.format(&Rfc3339).unwrap_or_default(),
        finished_at: finished_at.format(&Rfc3339).unwrap_or_default(),
        subject: RunSubject {
            // The case's identity is its resolved, manifest-declared slug — which can
            // differ from the slug the run was *requested* by (a folder name, or an
            // alias). Prefer it so a failed run is recorded against the same identity a
            // successful one is; fall back to the request slug only when resolution
            // itself failed, so there is no resolved case to read it from.
            test_case_slug: test_case
                .map(|tc| tc.slug.clone())
                .unwrap_or_else(|| request.test_case_slug.clone()),
            test_case_version: test_case
                .map(|tc| tc.version.clone())
                .or_else(|| request.test_case_version.clone())
                .unwrap_or_default(),
            test_type: test_case.map(|tc| tc.test_type).unwrap_or_default(),
            variant: request.variant.clone(),
            harness_slug: request.harness,
            harness_version: None,
            orchestrator_slug,
            engine_slug,
            // A run that failed before (or while) seeding vendored no runtime, and
            // the version is read out of the staged package at seed time — so there
            // is nothing to record. Absent, never a guess from the slug: the slug is
            // stable while the runtime behind it moves.
            engine_version: None,
            model_id: request.model_id.clone(),
            // A gg run that failed before producing a record still records the
            // configuration it was launched with, so even a failed gg attempt is
            // traceable to its exact capability set. `None` for every non-gg run.
            gg_capability_set: request.gg_capability_set.clone(),
            // A run that failed before producing a record ran no gg session, so it has
            // no outcome summary to record.
            gg_summary: None,
        },
        tooling: RunTooling::current(),
        // A failed run probed no container, so the environment is unknown.
        environment: RunEnvironment {
            os: "unknown".to_string(),
            container_image: String::new(),
            node_version: None,
            auth_mode: AuthMode::ApiKey,
        },
        metrics: RunMetrics::default(),
        validation: ValidationSummary::default(),
        links: RunLinks::default(),
        status: RunStatus {
            state,
            detail: Some(detail.into()),
        },
        // A run that failed before producing a tree has no README to capture, and a
        // failure record is built without the engine that knows what it was seeded
        // with, so it claims no prior entries.
        game_jam_readme: None,
        // A run that failed before (or without) a translated session recorded no
        // tool activity.
        tool_calls: std::collections::BTreeMap::new(),
        game_jam_prior_entries: Vec::new(),
        // A failed record is built from the request alone — the seeded workspace, when
        // there even was one, belongs to the engine call that failed — so there is no
        // seed commit to name. Left absent rather than empty so a consumer can tell "no
        // seed was recorded" from "the seed was the empty hash".
        seed_commit: None,
        // A run that failed before producing a tree has no code to analyse, and the
        // post-run seam it would have been analysed at is downstream of the failure.
        // Absent, never an empty measurement.
        code_analysis: None,
        toolchain: None,
        // A run that failed before producing a tree has no showcase to capture.
        showcase: None,
    }
}

/// Write a run's raw harness output and its translated events as two JSONL files
/// in the run directory: `raw.jsonl` carries one stream-tagged line per entry in
/// arrival order, and `events.jsonl` carries one normalized event per line.
///
/// Together they make a run's translation auditable: replaying `raw.jsonl`
/// through an [`EventParser`] reproduces `events.jsonl`, so the parsing logic can
/// be checked against real harness output captured from an actual run.
fn write_run_streams(
    run_dir: &std::path::Path,
    raw: &[RawOutputLine],
    events: &[HarnessEvent],
) -> Result<()> {
    write_jsonl(&run_dir.join("raw.jsonl"), raw)?;
    write_jsonl(&run_dir.join("events.jsonl"), events)?;
    Ok(())
}

/// Serialize each item as its own JSON line and write them to `path`.
fn write_jsonl<T: serde::Serialize>(path: &std::path::Path, items: &[T]) -> Result<()> {
    let mut contents = String::new();
    for item in items {
        contents.push_str(&serde_json::to_string(item)?);
        contents.push('\n');
    }
    std::fs::write(path, contents)?;
    Ok(())
}

/// Why a bounded in-container setup command (a harness install or a test case's
/// init) did not succeed. Callers map this onto their own error — the install
/// step onto [`Error::HarnessInstall`]/[`Error::HarnessInstallTimedOut`], the
/// init step onto [`Error::Init`]/[`Error::InitTimedOut`] — so each failure
/// reads in terms of the step that produced it.
#[derive(Debug)]
enum SetupError {
    /// The command did not finish within the wall-clock cap.
    TimedOut,
    /// The command exited non-zero, or — for the init step's last attempt — exited
    /// zero but left lockfile packages uninstalled; the string summarizes the
    /// captured output, or names the missing packages.
    Failed(String),
    /// The container runtime itself failed to run the command.
    Runtime(Error),
}

/// Run a setup command inside the run container under a wall-clock cap, returning
/// a [`SetupError`] if it exits non-zero or does not finish in time.
///
/// The command is bounded by `cap` — the harness install by the run's maximum
/// runtime, an init attempt by what is left of it — so a hung setup step can
/// never run unbounded. On a non-zero exit the captured output is summarized so a
/// broken setup can be diagnosed; the caller tears the container down on any
/// error this returns.
async fn run_setup(
    runtime: &impl ContainerRuntime,
    handle: &ContainerHandle,
    command: &[String],
    cap: Duration,
) -> std::result::Result<(), SetupError> {
    let exec = runtime.exec(handle, command);
    let output = match tokio::time::timeout(cap, exec).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => return Err(SetupError::Runtime(err)),
        Err(_elapsed) => return Err(SetupError::TimedOut),
    };
    if output.exit_code != 0 {
        return Err(SetupError::Failed(init_failure_detail(&output)));
    }
    Ok(())
}

/// Run a test case's `init` command inside the run container as a verified,
/// retried install.
///
/// An init is almost always a dependency install (`npm ci`, `npm install && npx
/// playwright install chromium`), and an install that exits zero is not
/// necessarily complete: a registry blip makes npm drop a platform-specific
/// optional package and exit zero regardless, and the run then fails minutes
/// later in a way that reads as the model's fault. So an attempt that exits zero
/// is checked against the workspace's lockfile with the very same script the host
/// runs over a collected tree ([`LOCKFILE_CHECK_SCRIPT`]), executed through the
/// runtime's exec in the workspace. An attempt that exits non-zero, or that exits
/// zero and leaves a package the install should have placed absent, is retried
/// after `delay` — a warning event naming the attempt and the reason goes out
/// first — up to [`INSTALL_ATTEMPTS`] attempts in all.
///
/// The whole of it — every attempt, every check, and the delays between them — is
/// bounded by `seconds`, the run's maximum runtime, as one budget: each attempt
/// runs under whatever the earlier ones left. An attempt that outruns the budget
/// is a timeout and is not retried; an attempt that fails with too little budget
/// left for the delay and another attempt fails there, saying so. A runtime error
/// is not retried either. After the last attempt a non-zero exit fails with the
/// output summary it always did, and a zero exit with packages still missing fails
/// with a detail naming them. A workspace that cannot be checked — no lockfile, no
/// `node` in the image, the script not running — is accepted as it stands,
/// exactly as the host accepts an uncheckable tree.
async fn run_init(
    runtime: &impl ContainerRuntime,
    handle: &ContainerHandle,
    init: &str,
    seconds: u64,
    delay: Duration,
    events: &mut dyn EventSink,
) -> std::result::Result<(), SetupError> {
    // A non-login shell, for the same reason the harness install uses one: the
    // container's own `PATH` already carries what the init needs.
    let command = vec!["sh".to_string(), "-c".to_string(), init.to_string()];
    // Measured on tokio's clock, the one the caps below run on, so the budget and
    // the timeouts charged against it agree (and a paused test clock drives both).
    let budget = Duration::from_secs(seconds);
    let started = tokio::time::Instant::now();
    let remaining = || budget.saturating_sub(started.elapsed());
    let mut attempt = 0;
    loop {
        attempt += 1;
        let cap = remaining();
        if cap.is_zero() {
            return Err(SetupError::TimedOut);
        }
        let reason = match run_setup(runtime, handle, &command, cap).await {
            Ok(()) => {
                let check = check_workspace_lockfile(runtime, handle, init, remaining()).await;
                match check {
                    LockfileCheck::Checked { missing } if !missing.is_empty() => {
                        install::missing_detail(&missing)
                    }
                    LockfileCheck::Checked { .. } => return Ok(()),
                    LockfileCheck::NotChecked { reason } => {
                        tracing::debug!(
                            init,
                            reason,
                            "the init's workspace was accepted unchecked"
                        );
                        return Ok(());
                    }
                }
            }
            // An attempt that spent the budget has left nothing for another; and a
            // runtime that cannot run the command at all will not run it on a retry
            // either.
            Err(err @ (SetupError::TimedOut | SetupError::Runtime(_))) => return Err(err),
            Err(SetupError::Failed(detail)) => detail,
        };
        if attempt >= INSTALL_ATTEMPTS {
            return Err(SetupError::Failed(reason));
        }
        // The delay is charged against the same budget. A retry that could not
        // start until the budget was gone would only time out, so the attempt that
        // just failed is the last, and its reason says why no other was made.
        if remaining() <= delay {
            return Err(SetupError::Failed(format!(
                "{reason} (no time remained in the run's maximum runtime for another attempt)"
            )));
        }
        let message = format!(
            "init attempt {attempt} of {INSTALL_ATTEMPTS} did not complete ({reason}); retrying in {} seconds",
            delay.as_secs()
        );
        tracing::warn!(
            init,
            attempt,
            reason,
            delay_secs = delay.as_secs_f64(),
            "{message}"
        );
        events.emit(&HarnessEvent {
            timestamp: crate::event::now_timestamp(),
            session_id: None,
            kind: EventKind::Warning {
                message,
                code: None,
            },
        });
        tokio::time::sleep(delay).await;
    }
}

/// How long the in-container lockfile check may take. It walks the lockfile's
/// dependency graph and stats one directory per package, so a real run is well
/// under a second; the cap keeps a wedged `node` from holding the init open, and
/// a check that outruns it counts as not checked rather than as a verdict.
const CONTAINER_CHECK_TIMEOUT: Duration = Duration::from_secs(60);

/// Run the [lockfile check](crate::lockfile_check) over the run container's
/// workspace, through the runtime's exec.
///
/// Every runtime execs in the workspace ([`WORKSPACE_DIR`]) as the run user, which
/// is where and as whom the init ran, so the script sees the tree the init left.
/// The script is handed to `node` inline, as it is on the host, so the workspace is
/// never left carrying a file of the Test Cabinet's. `init` is passed as the
/// script's install command so the dependency classes its flags omit are left out
/// of the check. The check runs under [`CONTAINER_CHECK_TIMEOUT`] or what is left
/// of the init's budget, whichever is shorter. Anything that keeps the script from
/// reporting — no `node` in the image, a runtime error, the cap — reads as *not
/// checked*, never as a failure.
async fn check_workspace_lockfile(
    runtime: &impl ContainerRuntime,
    handle: &ContainerHandle,
    init: &str,
    remaining: Duration,
) -> LockfileCheck {
    let command = vec![
        "node".to_string(),
        "--input-type=module".to_string(),
        "-e".to_string(),
        LOCKFILE_CHECK_SCRIPT.to_string(),
        "--".to_string(),
        init.to_string(),
    ];
    let cap = CONTAINER_CHECK_TIMEOUT.min(remaining);
    let output = match tokio::time::timeout(cap, runtime.exec(handle, &command)).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => {
            return LockfileCheck::NotChecked {
                reason: format!("the lockfile check could not be run in the container: {err}"),
            };
        }
        Err(_elapsed) => {
            return LockfileCheck::NotChecked {
                reason: format!(
                    "the lockfile check did not finish within {} seconds",
                    cap.as_secs()
                ),
            };
        }
    };
    if output.exit_code != 0 {
        // `node` absent from the image (127), or the script crashing: the check
        // could not see into the tree, and the tree is accepted as it stands.
        return LockfileCheck::NotChecked {
            reason: format!(
                "the lockfile check exited {}: {}",
                output.exit_code,
                output.stderr.trim().lines().last().unwrap_or_default()
            ),
        };
    }
    parse_report(&output.stdout)
}

/// Summarize a failed init command's output into a single-line-ish detail: the
/// exit code plus the tail of stderr (falling back to stdout), trimmed so an
/// error message stays readable while still pointing at the cause.
fn init_failure_detail(output: &execution::ExecOutput) -> String {
    const TAIL: usize = 2000;
    let stream = if output.stderr.trim().is_empty() {
        output.stdout.trim_end()
    } else {
        output.stderr.trim_end()
    };
    let tail = if stream.len() > TAIL {
        let start = stream.len() - TAIL;
        // Start at a char boundary so slicing never splits a UTF-8 sequence.
        let start = (start..stream.len())
            .find(|&i| stream.is_char_boundary(i))
            .unwrap_or(stream.len());
        format!("…{}", &stream[start..])
    } else {
        stream.to_string()
    };
    if tail.is_empty() {
        format!("exited with code {}", output.exit_code)
    } else {
        format!("exited with code {}: {tail}", output.exit_code)
    }
}

/// Drive a harness session future under a wall-clock cap.
///
/// Returns the session's own result if it finishes within `seconds`. Otherwise
/// the future is dropped — cancelling the in-flight container exec — and an
/// [`Error::RunTimedOut`] for `slug` is returned so the caller can tear the
/// container down. This is what keeps a run from continuing unbounded; the cap
/// is always positive, so a session is always bounded.
async fn with_runtime_cap<F>(session: F, seconds: u64, slug: HarnessSlug) -> Result<HarnessOutcome>
where
    F: Future<Output = Result<HarnessOutcome>>,
{
    match tokio::time::timeout(Duration::from_secs(seconds), session).await {
        Ok(result) => result,
        Err(_elapsed) => Err(Error::RunTimedOut {
            slug: slug.as_str().to_string(),
            seconds,
        }),
    }
}

/// The current time as whole epoch seconds, used to compute the run's deadline
/// (run start + maximum runtime) handed to an orchestrator's runner.
fn unix_now() -> u64 {
    OffsetDateTime::now_utc().unix_timestamp().max(0) as u64
}

/// Collect a fixed list of string slices into the owned `Vec<String>` the
/// [`ContainerRuntime`] exec methods take.
fn as_command<const N: usize>(parts: [&str; N]) -> Vec<String> {
    parts.iter().map(|p| p.to_string()).collect()
}

/// Extract the `PRETTY_NAME` value from the contents of an `/etc/os-release`
/// file, stripping the surrounding quotes the field is conventionally written
/// with. Returns `None` when no `PRETTY_NAME` line is present.
fn parse_pretty_name(os_release: &str) -> Option<String> {
    os_release.lines().find_map(|line| {
        line.strip_prefix("PRETTY_NAME=")
            .map(|value| value.trim().trim_matches('"').to_string())
    })
}

/// Directory names that are never part of a run's collected implementation.
///
/// `node_modules` is regenerated from the lockfile by a fresh install, so
/// keeping it only bloats the artifact and risks shipping platform-specific
/// binaries — or the broken tool shims a dereferencing copy would leave behind,
/// since a package manager's `.bin/*` entries are symlinks whose relative
/// imports only resolve from their real location.
///
/// This list is applied twice, for the same reason: `copy_tree` omits these
/// directories when copying the collected tree into the published
/// implementation, and the Kubernetes artifact collector excludes them at
/// `tar` pack time so they never enter the streamed archive in the first place
/// — packing then unpacking a `node_modules` full of native binaries and
/// `.bin/*` symlinks is both wasteful and a source of host-side unpack
/// failures, given the tree is dropped by `copy_tree` immediately afterward.
pub const SKIPPED_DIRS: &[&str] = &["node_modules"];

/// Recursively copy a directory tree from `from` to `to`.
///
/// Symlinks are recreated as symlinks rather than dereferenced, so any links the
/// run produced keep pointing at their original targets instead of being
/// flattened into copies of the target's contents. Dependency directories listed
/// in [`SKIPPED_DIRS`] are omitted entirely.
fn copy_tree(from: &std::path::Path, to: &std::path::Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if SKIPPED_DIRS.contains(&name.to_str().unwrap_or_default()) {
            continue;
        }
        let dest = to.join(&name);
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            copy_symlink(&entry.path(), &dest)?;
        } else if file_type.is_dir() {
            copy_tree(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), &dest)?;
        }
    }
    Ok(())
}

/// Recreate the symlink at `from` at the new location `to`, preserving its
/// target verbatim. The target is kept as-is (typically relative to the link's
/// own directory) so the recreated link resolves the same way the original did.
fn copy_symlink(from: &std::path::Path, to: &std::path::Path) -> Result<()> {
    let target = std::fs::read_link(from)?;
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, to)?;
    #[cfg(windows)]
    if from.is_dir() {
        std::os::windows::fs::symlink_dir(&target, to)?;
    } else {
        std::os::windows::fs::symlink_file(&target, to)?;
    }
    Ok(())
}
