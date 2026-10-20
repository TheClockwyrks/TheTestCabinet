//! Integration test over the **container disruption** check: a run whose container the
//! platform took down while its session ran is recorded as our infrastructure's failure.
//!
//! The harness inside a drained or evicted container sees only that it was killed, and
//! reports a non-zero exit like any other harness failure. The engine asks the runtime
//! about the container as soon as the session returns, and a disrupted container turns
//! the outcome into [`Error::ContainerDisrupted`](test_cabinet_core::Error), which
//! classifies as [`RunState::Infrastructure`] and keeps what the session reported.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use test_cabinet_core::{
    AgentHarness, ArtifactCollection, ArtifactCollector, Availability, ContainerHandle,
    ContainerRuntime, ContainerSpec, ContainerStart, CredFile, CredSource, EngineCatalog,
    EngineSelection, Error as CoreError, EventFormat, ExecOutput, FsRepoSeeder, HarnessInvocation,
    HarnessOutcome, HarnessRegistry, HarnessSlug, MapCreds, MediaKind, NoopEventSink,
    OrchestratorCatalog, OrchestratorSelection, OutputSink, PrerenderedReferenceRenderer,
    ProofFile, RenderedReference, Result as CoreResult, RunCancellation, RunEngine, RunRequest,
    RunState, SubscriptionSpec, TestCaseCatalog, TestCaseVersion, Usage, ValidationSummary,
    Validator, Variant,
};

/// The repository's `test-cases/` directory, so the run is seeded from a real case.
fn catalog_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-cases")
}

/// The lifecycle steps the fakes record, in order.
type Steps = Arc<Mutex<Vec<&'static str>>>;

/// What the disruption the fake runtime reports reads like.
const EVICTION: &str = "run pod `fake-container` on node `aks-userpool3-0` was disrupted \
                        (EvictionByEvictionAPI: Eviction API: evicting)";

/// A container runtime whose gg session dies with a SIGKILL exit, as a harness in a
/// drained pod does, and which reports `disruption` when asked about the container.
struct KilledRuntime {
    steps: Steps,
    disruption: Option<&'static str>,
}

#[async_trait::async_trait]
impl ContainerRuntime for KilledRuntime {
    async fn start(&self, _spec: &ContainerSpec) -> CoreResult<ContainerStart> {
        Ok(ContainerStart::ready(ContainerHandle {
            id: "fake-container".to_string(),
        }))
    }

    async fn exec(
        &self,
        _container: &ContainerHandle,
        _command: &[String],
    ) -> CoreResult<ExecOutput> {
        // Every in-container setup step before the session succeeds.
        Ok(ExecOutput {
            exit_code: 0,
            stdout: "gg 0.7.0".to_string(),
            stderr: String::new(),
            idle_timed_out: false,
        })
    }

    async fn exec_streamed(
        &self,
        _container: &ContainerHandle,
        _command: &[String],
        _idle_timeout: Option<Duration>,
        _sink: &mut dyn OutputSink,
    ) -> CoreResult<ExecOutput> {
        self.steps.lock().expect("steps").push("session");
        Ok(ExecOutput {
            exit_code: 137,
            stdout: String::new(),
            stderr: String::new(),
            idle_timed_out: false,
        })
    }

    async fn stop(&self, _container: &ContainerHandle) -> CoreResult<()> {
        self.steps.lock().expect("steps").push("stop");
        Ok(())
    }

    async fn disruption(&self, _container: &ContainerHandle) -> Option<String> {
        self.steps.lock().expect("steps").push("disruption");
        self.disruption.map(str::to_string)
    }
}

/// A collector with nothing to hand over: a failed run never collects its tree, and the
/// salvage finds no journal.
struct EmptyCollector;

#[async_trait::async_trait]
impl ArtifactCollector for EmptyCollector {
    async fn collect(&self, _container: &ContainerHandle) -> CoreResult<ArtifactCollection> {
        unreachable!("a failed run never collects its tree")
    }

    async fn collect_file(
        &self,
        _container: &ContainerHandle,
        _container_path: &str,
        _dest: &std::path::Path,
    ) -> CoreResult<bool> {
        Ok(false)
    }
}

/// A harness that authenticates by subscription (so the test needs no environment
/// variable) and is never otherwise driven: a gg run is executed by the engine's own gg
/// path, not through this adapter.
struct FakeHarness;

/// The one credential file the fake subscription declares. Its bytes come from the
/// [`MapCreds`] the engine is given, never from the host.
static FAKE_CREDS: &[CredFile] = &[CredFile {
    source: CredSource::HomeRelative(".tcab-fake/credentials.json"),
    container_path: "/home/runner/.tcab-fake/credentials.json",
    mode: 0o600,
    required: true,
}];

#[async_trait::async_trait]
impl AgentHarness for FakeHarness {
    fn slug(&self) -> HarnessSlug {
        HarnessSlug::Gg
    }

    fn api_key_env(&self) -> Option<&'static str> {
        None
    }

    fn subscription_spec(&self) -> Option<SubscriptionSpec> {
        Some(SubscriptionSpec { files: FAKE_CREDS })
    }

    fn session_argv(&self, _model_id: &str, _prompt: &str) -> Vec<String> {
        unreachable!("gg is invoked directly, never through the harness adapter")
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
        unreachable!("a gg run never probes the harness adapter")
    }

    async fn invoke(
        &self,
        _runtime: &dyn ContainerRuntime,
        _container: &ContainerHandle,
        _invocation: &HarnessInvocation,
        _events: &mut dyn test_cabinet_core::EventSink,
    ) -> CoreResult<HarnessOutcome> {
        unreachable!("a gg run never invokes the harness adapter")
    }
}

/// A registry that answers with the fake harness whatever slug is asked for.
struct FakeRegistry {
    harness: FakeHarness,
}

impl HarnessRegistry for FakeRegistry {
    fn get(&self, _slug: HarnessSlug) -> Option<&dyn AgentHarness> {
        Some(&self.harness)
    }
}

/// A validator that must never run: validation is downstream of a successful session, and
/// these runs never have one.
struct UnreachableValidator;

impl Validator for UnreachableValidator {
    fn validate(
        &self,
        _test_case: &TestCaseVersion,
        _variant: &Variant,
        _artifacts: &ArtifactCollection,
        _references: &[RenderedReference],
        _proofs: &[ProofFile],
    ) -> CoreResult<ValidationSummary> {
        unreachable!("a disrupted run is never validated");
    }
}

/// The rendered references a run of `test_case`/`variant` needs, taken straight from the
/// case's own static reference media so nothing has to be rendered.
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

/// Drive a gg run against `runtime` and return the error it fails with.
async fn run_killed(runtime: KilledRuntime, cancel: &RunCancellation) -> CoreError {
    let catalog = TestCaseCatalog::new(catalog_root());
    let test_case = catalog
        .resolve("carom", "v2.1.0")
        .expect("resolve the bundled carom case");
    let variant = test_case.variant("base").expect("carom's base variant");
    let seed_dir = tempfile::tempdir().expect("seed dir");
    let out_dir = tempfile::tempdir().expect("output dir");

    let engine = RunEngine {
        catalog: TestCaseCatalog::new(catalog_root()),
        seeder: FsRepoSeeder::new(seed_dir.path()),
        runtime,
        collector: EmptyCollector,
        harnesses: Box::new(FakeRegistry {
            harness: FakeHarness,
        }),
        orchestrators: OrchestratorCatalog::new(),
        engines: EngineCatalog::new(),
        renderer: Box::new(PrerenderedReferenceRenderer::new(references(
            &test_case, variant,
        ))),
        session_assembler: None,
        analyzer: None,
        toolchain: None,
        validator: UnreachableValidator,
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
        clock: std::sync::Arc::new(test_cabinet_core::SystemClock),
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
        gg_capability_set: Some(test_cabinet_core::gg::GgCapabilitySet::default()),
        gg_model_windows: Default::default(),
        gg_model_providers: Default::default(),
        gg_model_modalities: Default::default(),
        gg_model_prices: Default::default(),
        model_prices: None,
    };

    engine
        .run_resolved(
            &test_cabinet_core::mint_run_id(),
            &request,
            &test_case,
            &mut NoopEventSink,
            None,
            cancel,
        )
        .await
        .expect_err("a killed session must fail the run")
}

#[tokio::test]
async fn a_session_killed_by_a_disruption_is_an_infrastructure_failure() {
    let steps: Steps = Arc::new(Mutex::new(Vec::new()));
    let error = run_killed(
        KilledRuntime {
            steps: Arc::clone(&steps),
            disruption: Some(EVICTION),
        },
        &RunCancellation::default(),
    )
    .await;

    let CoreError::ContainerDisrupted {
        slug,
        disruption,
        session,
    } = &error
    else {
        panic!("expected a disrupted container, got {error:?}");
    };
    assert_eq!(slug, "gg");
    assert_eq!(disruption, EVICTION);
    assert!(
        !session.is_empty(),
        "the session's own report must be kept: {error}"
    );
    assert_eq!(RunState::classify_failure(&error), RunState::Infrastructure);

    // The runtime is asked after the session returns and before the container is torn
    // down, which is the only point at which the pod still says what happened to it.
    assert_eq!(
        *steps.lock().expect("steps"),
        vec!["session", "disruption", "stop"],
    );
}

#[tokio::test]
async fn a_session_in_an_untouched_container_keeps_its_own_outcome() {
    let steps: Steps = Arc::new(Mutex::new(Vec::new()));
    let error = run_killed(
        KilledRuntime {
            steps: Arc::clone(&steps),
            disruption: None,
        },
        &RunCancellation::default(),
    )
    .await;
    assert!(
        !matches!(error, CoreError::ContainerDisrupted { .. }),
        "an untouched container must leave the session's outcome standing: {error:?}",
    );
    assert_ne!(RunState::classify_failure(&error), RunState::Infrastructure);
}
