//! Integration test over **attributing an end**: a session the platform ended is recorded
//! `infrastructure`, never as the model's outcome.
//!
//! The exit status a gg exec reports is the platform's word for how the session ended, and
//! the platform can report a session it ended itself (a sandbox pod deleted or evicted, a
//! lost exec stream, a kill from outside) as gg's own exit. The driver reads the sandbox
//! and gg's own account of its end (its `session_ended` event) before it believes the exit
//! status, in the order the driver's execution page sets out under "Attributing an end".
//! An end the platform caused is `infrastructure`: the run is neither collected nor
//! validated, and its record keeps the metrics and events gathered so far.
//!
//! Each case drives a whole gg run through the engine with every external seam faked: the
//! container runtime streams a chosen telemetry, exits with a chosen code and reports a
//! chosen sandbox state. The harness's own ends are driven too, so the attribution is seen
//! to leave them alone: a breached ceiling (exit `3`) stays `limit_exceeded` and any other
//! failure with a live pod stays `harness_error`.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use test_cabinet_driver::{
    AgentHarness, ArtifactCollection, ArtifactCollector, Availability, ContainerHandle,
    ContainerRuntime, ContainerSpec, ContainerStart, CredFile, CredSource, EngineSelection,
    EventFormat, EventKind, EventSink, ExecOutput, FsRepoSeeder, HarnessEvent, HarnessInvocation,
    HarnessOutcome, HarnessRegistry, HarnessSlug, ManualClock, MapCreds, MediaKind,
    OrchestratorCatalog, OrchestratorSelection, OutputSink, OutputStream,
    PrerenderedReferenceRenderer, ProofFile, RenderedReference, Result as CoreResult,
    RunCancellation, RunEngine, RunRecord, RunRequest, RunState, RunStateExt, SandboxState,
    SubscriptionSpec, TestCaseCatalog, TestCaseVersion, Usage, ValidationSummary, Validator,
    Variant,
};

/// A copy of the frozen carom v2.1.0 under `testdata/definitions/test-cases/`, so the run
/// is seeded from a real case exactly as a launched run would be.
fn catalog_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata/definitions/test-cases")
}

/// The sandbox's runtime identifier the fake runtime hands out.
const SANDBOX: &str = "fake-container";

/// A billed turn carrying its own cost, so the run needs no price lookup.
const USAGE_LINE: &str = r#"{"timestamp":"2026-07-30T00:00:02Z","sessionId":"run-1","type":"usage","profileId":"root","modelId":"mock/echo","tokens":{"uncachedInput":100,"cachedInput":null,"output":20,"reasoning":null},"cost":{"comparable":0.01,"actual":0.01}}"#;

/// The `session_ended` event gg emits before every exit, with `status`.
fn session_ended(status: &str) -> String {
    format!(
        r#"{{"timestamp":"2026-07-30T00:00:03Z","sessionId":"run-1","type":"session_ended","status":"{status}"}}"#
    )
}

/// How a faked gg session ends: the telemetry it streams, the code its exec reports and
/// the state the runtime reports its sandbox in once the exec has returned.
#[derive(Clone)]
struct Ending {
    lines: Vec<String>,
    exit_code: i32,
    sandbox: SandboxState,
}

impl Ending {
    /// A session that billed one turn and closed with `status`, exiting `exit_code`
    /// against a sandbox in `sandbox`.
    fn closed(status: &str, exit_code: i32, sandbox: SandboxState) -> Self {
        Self {
            lines: vec![USAGE_LINE.to_string(), session_ended(status)],
            exit_code,
            sandbox,
        }
    }

    /// A session that billed one turn and never emitted `session_ended`.
    fn unclosed(exit_code: i32, sandbox: SandboxState) -> Self {
        Self {
            lines: vec![USAGE_LINE.to_string()],
            exit_code,
            sandbox,
        }
    }
}

/// A container runtime whose every setup call succeeds and whose gg session ends as its
/// [`Ending`] says.
struct EndingRuntime {
    ending: Ending,
}

#[async_trait::async_trait]
impl ContainerRuntime for EndingRuntime {
    async fn start(&self, _spec: &ContainerSpec) -> CoreResult<ContainerStart> {
        Ok(ContainerStart::ready(ContainerHandle {
            id: SANDBOX.to_string(),
        }))
    }

    async fn exec(
        &self,
        _container: &ContainerHandle,
        _command: &[String],
    ) -> CoreResult<ExecOutput> {
        Ok(ExecOutput {
            exit_code: 0,
            stdout: "gg 0.0.0-fake".to_string(),
            stderr: String::new(),
            idle_timed_out: false,
        })
    }

    async fn exec_streamed(
        &self,
        _container: &ContainerHandle,
        _command: &[String],
        _idle_timeout: Option<Duration>,
        sink: &mut dyn OutputSink,
    ) -> CoreResult<ExecOutput> {
        for line in &self.ending.lines {
            sink.on_line(OutputStream::Stdout, line);
        }
        Ok(ExecOutput {
            exit_code: self.ending.exit_code,
            stdout: String::new(),
            stderr: String::new(),
            idle_timed_out: false,
        })
    }

    async fn sandbox_state(&self, _container: &ContainerHandle) -> SandboxState {
        self.ending.sandbox.clone()
    }

    async fn stop(&self, _container: &ContainerHandle) -> CoreResult<()> {
        Ok(())
    }
}

/// The harness the registry answers with. A gg run still resolves its slug's
/// authentication through the registry, so it authenticates by a subscription the test
/// supplies and probes as available; its session is never invoked.
struct UnusedHarness;

/// The one credential file the fake subscription declares.
static FAKE_CREDS: &[CredFile] = &[CredFile {
    source: CredSource::HomeRelative(".tcab-fake/credentials.json"),
    container_path: "/home/runner/.tcab-fake/credentials.json",
    mode: 0o600,
    required: true,
}];

#[async_trait::async_trait]
impl AgentHarness for UnusedHarness {
    fn slug(&self) -> HarnessSlug {
        HarnessSlug::Claude
    }

    fn api_key_env(&self) -> Option<&'static str> {
        None
    }

    fn subscription_spec(&self) -> Option<SubscriptionSpec> {
        Some(SubscriptionSpec { files: FAKE_CREDS })
    }

    fn session_argv(&self, _model_id: &str, _prompt: &str) -> Vec<String> {
        Vec::new()
    }

    fn event_format(&self) -> EventFormat {
        EventFormat::Generic
    }

    fn parse_session_usage(&self, _output: &ExecOutput) -> (Usage, Option<f64>) {
        (Usage::default(), None)
    }

    async fn probe(
        &self,
        _runtime: &dyn ContainerRuntime,
        _container: &ContainerHandle,
    ) -> CoreResult<Availability> {
        Ok(Availability {
            available: true,
            version: Some("0.0.0-fake".to_string()),
            detail: None,
        })
    }

    async fn invoke(
        &self,
        _runtime: &dyn ContainerRuntime,
        _container: &ContainerHandle,
        _invocation: &HarnessInvocation,
        _events: &mut dyn EventSink,
    ) -> CoreResult<HarnessOutcome> {
        unreachable!("a gg run invokes no third-party harness")
    }
}

/// A registry that answers with the unused harness whatever slug is asked for.
struct UnusedRegistry {
    harness: UnusedHarness,
}

impl HarnessRegistry for UnusedRegistry {
    fn get(&self, _slug: HarnessSlug) -> Option<&dyn AgentHarness> {
        Some(&self.harness)
    }
}

/// A collector that hands back a prepared tree and notes that it was asked to.
struct NotingCollector {
    repo_path: PathBuf,
    called: Arc<AtomicBool>,
}

#[async_trait::async_trait]
impl ArtifactCollector for NotingCollector {
    async fn collect(&self, _container: &ContainerHandle) -> CoreResult<ArtifactCollection> {
        self.called.store(true, Ordering::SeqCst);
        Ok(ArtifactCollection::new(self.repo_path.clone()))
    }
}

/// A validator that checks nothing and notes that it was asked to.
struct NotingValidator {
    called: Arc<AtomicBool>,
}

impl Validator for NotingValidator {
    fn validate(
        &self,
        _test_case: &TestCaseVersion,
        _variant: &Variant,
        _artifacts: &ArtifactCollection,
        _references: &[RenderedReference],
        _proofs: &[ProofFile],
    ) -> CoreResult<ValidationSummary> {
        self.called.store(true, Ordering::SeqCst);
        Ok(ValidationSummary::default())
    }
}

/// An event sink that keeps every event the run emitted.
#[derive(Default)]
struct Recording {
    events: Vec<HarnessEvent>,
}

impl EventSink for Recording {
    fn emit(&mut self, event: &HarnessEvent) {
        self.events.push(event.clone());
    }
}

/// The rendered references a run needs, taken from the case's own static media.
fn references(test_case: &TestCaseVersion, variant: &Variant) -> Vec<RenderedReference> {
    test_case
        .references_for(variant)
        .into_iter()
        .map(|view| RenderedReference {
            view: view.view.clone(),
            kind: MediaKind::Image,
            media_path: view.source_path.clone(),
        })
        .collect()
}

/// What a driven run left behind.
struct Driven {
    /// The record, or the error the session failed with.
    result: CoreResult<RunRecord>,
    /// Whether the produced tree was collected.
    collected: bool,
    /// Whether the produced tree was validated.
    validated: bool,
    /// Every event the run emitted.
    events: Vec<HarnessEvent>,
    /// The run's output directory, kept alive for the record files.
    out_dir: tempfile::TempDir,
}

/// Drive a whole gg run of carom v2.1.0 whose session ends as `ending` says.
async fn drive(ending: Ending) -> Driven {
    let catalog = TestCaseCatalog::new(
        catalog_root(),
        test_cabinet_driver::engine::built_in_catalog(),
    );
    let test_case = catalog
        .resolve("carom", "v2.1.0")
        .expect("the fixture copy of carom v2.1.0 resolves");
    let variant = test_case.variant("base").expect("carom's base variant");

    let produced = tempfile::tempdir().expect("produced tree");
    std::fs::write(produced.path().join("index.html"), "<!doctype html>")
        .expect("write the produced tree");
    let seed_dir = tempfile::tempdir().expect("seed dir");
    let out_dir = tempfile::tempdir().expect("output dir");
    let collected = Arc::new(AtomicBool::new(false));
    let validated = Arc::new(AtomicBool::new(false));

    let engine = RunEngine {
        catalog: TestCaseCatalog::new(
            catalog_root(),
            test_cabinet_driver::engine::built_in_catalog(),
        ),
        seeder: FsRepoSeeder::new(seed_dir.path()),
        runtime: EndingRuntime { ending },
        collector: NotingCollector {
            repo_path: produced.path().to_path_buf(),
            called: Arc::clone(&collected),
        },
        harnesses: Box::new(UnusedRegistry {
            harness: UnusedHarness,
        }),
        orchestrators: OrchestratorCatalog::new(),
        engines: test_cabinet_driver::engine::built_in_catalog(),
        renderer: Box::new(PrerenderedReferenceRenderer::new(references(
            &test_case, variant,
        ))),
        session_assembler: None,
        analyzer: None,
        toolchain: None,
        validator: NotingValidator {
            called: Arc::clone(&validated),
        },
        output_dir: out_dir.path().to_path_buf(),
        creds: Some(Box::new(MapCreds::new(
            [(
                FAKE_CREDS[0].container_path.to_string(),
                b"{\"fake\":true}".to_vec(),
            )]
            .into_iter()
            .collect(),
        ))),
        prior_game_jam_entries: Vec::new(),
        clock: Arc::new(ManualClock::new()),
    };
    let request = RunRequest {
        test_case_slug: test_case.slug.clone(),
        test_case_version: Some(test_case.version.clone()),
        variant: variant.slug.clone(),
        harness: HarnessSlug::Gg,
        model_id: "fake-model".to_string(),
        orchestrator: OrchestratorSelection::default(),
        engine: EngineSelection::default(),
        max_runtime_override: Some(60),
        container_image: None,
        gg_capability_set: Some(test_cabinet_driver::gg::GgCapabilitySet::default()),
        gg_model_windows: Default::default(),
        gg_model_providers: Default::default(),
        gg_model_modalities: Default::default(),
        gg_model_prices: Default::default(),
        model_prices: None,
    };

    let mut events = Recording::default();
    let result = engine
        .run_resolved(
            &test_cabinet_driver::mint_run_id(),
            &request,
            &test_case,
            &mut events,
            None,
            &RunCancellation::default(),
        )
        .await;
    Driven {
        result,
        collected: collected.load(Ordering::SeqCst),
        validated: validated.load(Ordering::SeqCst),
        events: events.events,
        out_dir,
    }
}

/// Assert `driven` is a run the platform ended: recorded `infrastructure` with a detail
/// containing every one of `names`, neither collected nor validated, its streamed usage
/// kept, and the detail on its event stream and in its written record.
fn assert_platform_end(driven: Driven, names: &[&str]) {
    let Driven {
        result,
        collected,
        validated,
        events,
        out_dir,
    } = driven;
    let record = result.expect("a platform end is recorded, not failed");
    assert_eq!(record.status.state, RunState::Infrastructure);
    let detail = record
        .status
        .detail
        .clone()
        .expect("an infrastructure record names its condition");
    assert!(
        detail.starts_with("run failed: gg harness session ended by the platform ("),
        "unexpected detail {detail:?}",
    );
    for name in names {
        assert!(detail.contains(name), "{detail:?} does not name {name:?}");
    }

    assert!(!collected, "a run the platform ended must not be collected");
    assert!(!validated, "a run the platform ended must not be validated");
    assert_eq!(record.validation, ValidationSummary::default());
    assert!(record.metrics.validation_seconds.is_none());

    // The metrics gathered before the end are kept.
    assert_eq!(record.metrics.tokens.uncached_input, Some(100));
    assert_eq!(record.metrics.tokens.output, Some(20));

    // The detail is on the run's live event stream and in the record's own events.
    let is_detail = |event: &HarnessEvent| matches!(&event.kind, EventKind::Error { message, .. } if *message == detail);
    assert!(
        events.iter().any(is_detail),
        "the platform end is emitted as an error event",
    );
    let run_dir = out_dir.path().join(&record.id);
    let written = std::fs::read_to_string(run_dir.join("events.jsonl")).expect("events.jsonl");
    assert!(
        written.lines().any(|line| {
            serde_json::from_str::<HarnessEvent>(line).is_ok_and(|event| is_detail(&event))
        }),
        "the record's events keep the platform end",
    );
}

fn gone() -> SandboxState {
    SandboxState::Gone {
        reason: "deleted".to_string(),
    }
}

fn disrupted() -> SandboxState {
    SandboxState::Disrupted {
        reason: "EvictionByEvictionAPI".to_string(),
    }
}

#[tokio::test]
async fn a_gg_exit_0_without_session_ended_is_an_infrastructure_end() {
    let driven = drive(Ending::unclosed(0, SandboxState::Running)).await;
    assert_platform_end(driven, &["exit code 0", "no `session_ended`"]);
}

#[tokio::test]
async fn a_gg_exit_0_without_session_ended_is_an_infrastructure_end_whatever_the_sandbox_read() {
    // A runtime that cannot observe its sandbox leaves the attribution to gg's account.
    let driven = drive(Ending::unclosed(0, SandboxState::Unknown)).await;
    assert_platform_end(driven, &["no `session_ended`"]);
}

#[tokio::test]
async fn a_deleted_sandbox_is_an_infrastructure_end_at_exit_0() {
    let driven = drive(Ending::closed("completed", 0, gone())).await;
    assert_platform_end(driven, &[SANDBOX, "gone: deleted", "exit code 0"]);
}

#[tokio::test]
async fn a_deleted_sandbox_is_an_infrastructure_end_at_exit_1() {
    let driven = drive(Ending::closed("model_error", 1, gone())).await;
    assert_platform_end(driven, &[SANDBOX, "gone: deleted", "exit code 1"]);
}

#[tokio::test]
async fn a_disrupted_sandbox_is_an_infrastructure_end_at_exit_0() {
    let driven = drive(Ending::closed("completed", 0, disrupted())).await;
    assert_platform_end(
        driven,
        &[SANDBOX, "disrupted: EvictionByEvictionAPI", "exit code 0"],
    );
}

#[tokio::test]
async fn a_disrupted_sandbox_is_an_infrastructure_end_at_exit_1() {
    let driven = drive(Ending::closed("model_error", 1, disrupted())).await;
    assert_platform_end(
        driven,
        &[SANDBOX, "disrupted: EvictionByEvictionAPI", "exit code 1"],
    );
}

#[tokio::test]
async fn a_gg_killed_by_a_signal_is_an_infrastructure_end() {
    for code in [137, 143] {
        let driven = drive(Ending::unclosed(code, SandboxState::Running)).await;
        assert_platform_end(driven, &[&format!("exit code {code}")]);
    }
}

#[tokio::test]
async fn an_exec_with_no_status_is_an_infrastructure_end() {
    let driven = drive(Ending::unclosed(-1, SandboxState::Running)).await;
    assert_platform_end(driven, &["exec stream lost", "exit code -1"]);
}

#[tokio::test]
async fn a_breached_ceiling_with_a_live_pod_stays_limit_exceeded() {
    let driven = drive(Ending::closed("limit_exceeded", 3, SandboxState::Running)).await;
    let error = driven
        .result
        .expect_err("a breached ceiling fails the session");
    assert_eq!(RunState::classify_failure(&error), RunState::LimitExceeded);
    assert!(!driven.validated);
}

#[tokio::test]
async fn a_harness_failure_with_a_live_pod_stays_harness_error() {
    let driven = drive(Ending::closed("model_error", 1, SandboxState::Running)).await;
    let error = driven
        .result
        .expect_err("a harness failure fails the session");
    assert_eq!(RunState::classify_failure(&error), RunState::HarnessError);
    assert!(!driven.validated);
}

#[tokio::test]
async fn a_closed_session_with_a_live_pod_is_validated() {
    // The control: nothing the platform did, so the run walks the whole lifecycle.
    let driven = drive(Ending::closed("completed", 0, SandboxState::Running)).await;
    let record = driven.result.expect("a clean run is recorded");
    assert_ne!(record.status.state, RunState::Infrastructure);
    assert!(driven.collected, "a clean run is collected");
    assert!(driven.validated, "a clean run is validated");
    assert!(
        !driven
            .events
            .iter()
            .any(|event| matches!(&event.kind, EventKind::Error { .. })),
        "a clean run raises no error event",
    );
}
