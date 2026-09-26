//! Integration test over *where* each of a run's recorded durations is measured.
//!
//! `runTimeSeconds` covers the whole run — reference rendering, seeding, the
//! image pull, container start, the environment probe, the harness install, the
//! test case's `init` step, the session, collection and teardown. On a real run
//! the shared setup is most of that, so the run's wall clock says far more about
//! the fleet than about the model, and a surface that describes a model has to
//! read `sessionSeconds` instead.
//!
//! Which figure lands where is entirely a property of where the timers are read
//! in [`RunEngine::run_resolved`] and `RunEngine::execute`, so none of it can be
//! proven by a unit test over the partition arithmetic. This drives a whole run
//! through the engine with every external seam faked, and with each stage of the
//! lifecycle made to take a *different, known* amount of time: a slow container
//! start stands in for setup, a slow session for the model's own work, a slow
//! container stop for teardown, and a slow validator for validation. A boundary
//! that moves reattributes one of those spans to a neighbouring stage, and the
//! assertions below say so.
//!
//! The time is not slept. The engine reads a [`ManualClock`] that only the fakes
//! advance, each by its own stage's span, so every recorded figure is exactly the
//! sum of the spans its boundaries enclose and the assertions are equalities.
//!
//! Only the container, the harness, the collector and the validator are faked;
//! the catalog, the seeder, the prompt renderer, the orchestrator and the record
//! writer are the real ones, so the run walks the real lifecycle.
//!
//! Both of the engine's execution branches are driven, because the boundary sits
//! in a different place in each. A third-party run installs its harness through
//! the shared install stage; a gg run installs its own binary, writes the
//! invocation file and probes the version in gg's own setup stage. Either way the
//! install belongs to setup, so each branch has a test of its own.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use test_cabinet_core::{
    AgentHarness, ArtifactCollection, ArtifactCollector, Availability, ContainerHandle,
    ContainerRuntime, ContainerSpec, ContainerStart, CredFile, CredSource, EngineCatalog,
    EngineSelection, EventFormat, EventSink, ExecOutput, FsRepoSeeder, HarnessInvocation,
    HarnessOutcome, HarnessRegistry, HarnessSlug, ManualClock, MapCreds, MediaKind, NoopEventSink,
    OrchestratorCatalog, OrchestratorSelection, OutputSink, OutputStream,
    PrerenderedReferenceRenderer, ProofFile, RenderedReference, Result as CoreResult,
    RunCancellation, RunEngine, RunRequest, SubscriptionSpec, TestCaseCatalog, TestCaseVersion,
    TokenCounts, Usage, ValidationSummary, Validator, Variant,
};

/// The repository's `test-cases/` directory — the real catalog, so the run is
/// seeded from a real case exactly as a `tcab run` would be.
fn catalog_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-cases")
}

/// How long the container takes to start. Stands in for the shared setup a run
/// spends before the model works at all.
///
/// Every span differs from every other and from every sum of the others, so a
/// boundary drawn in the wrong place moves a recognisable amount into the wrong
/// figure.
const SETUP: Duration = Duration::from_millis(1200);
/// How long the harness session takes — the model's own working time.
const SESSION: Duration = Duration::from_millis(3000);
/// How long the container takes to stop.
const TEARDOWN: Duration = Duration::from_millis(500);
/// How long the validation pass takes. It runs after the run's wall clock is
/// frozen, so none of it may reach any of the three stages or their sum.
const VALIDATION: Duration = Duration::from_millis(1500);

/// The run's runtime cap. Nothing here waits in real time, so the cap is never
/// approached; it is set because a run request carries one.
const RUNTIME_CAP: u64 = 60;

/// A container runtime whose start, session and stop each take a known, distinct
/// amount of the engine's clock. Its `exec` (the environment probe, the harness
/// install and the case's `init` step) takes none, so all of the setup this test
/// measures came from `start`.
struct SlowRuntime {
    clock: ManualClock,
}

#[async_trait::async_trait]
impl ContainerRuntime for SlowRuntime {
    async fn start(&self, _spec: &ContainerSpec) -> CoreResult<ContainerStart> {
        self.clock.advance(SETUP);
        Ok(ContainerStart::ready(ContainerHandle {
            id: "fake-container".to_string(),
        }))
    }

    async fn exec(
        &self,
        _container: &ContainerHandle,
        _command: &[String],
    ) -> CoreResult<ExecOutput> {
        Ok(ExecOutput {
            exit_code: 0,
            stdout: "/home/runner".to_string(),
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
        // The harness session itself. Bracketed exactly as the `tcab-session`
        // wrapper is, so the orchestrator segments one session out of the stream
        // and reads its usage — including the reported cost, which is what keeps
        // this test off the network.
        self.clock.advance(SESSION);
        for line in ["__TCAB_SESSION_BEGIN__", "{}", "__TCAB_SESSION_END__"] {
            sink.on_line(OutputStream::Stdout, line);
        }
        Ok(ExecOutput {
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
            idle_timed_out: false,
        })
    }

    async fn stop(&self, _container: &ContainerHandle) -> CoreResult<()> {
        self.clock.advance(TEARDOWN);
        Ok(())
    }
}

/// How long each in-container call a gg run makes before its session takes: the
/// binary install, the invocation-file write and the version probe. Deliberately
/// long enough that a single one of them landing inside the session window is
/// visible in the recorded figure.
const GG_SETUP_CALL: Duration = Duration::from_millis(800);

/// A container runtime for the gg branch. Every `exec` — the environment probe
/// and each of gg's own setup calls — takes [`GG_SETUP_CALL`], and the streamed
/// session takes [`SESSION`], so a session figure that has swallowed any part of
/// gg's install reads at least [`GG_SETUP_CALL`] too large.
struct GgRuntime {
    clock: ManualClock,
    /// How many `exec` calls the run made, each of which took [`GG_SETUP_CALL`].
    execs: Arc<std::sync::atomic::AtomicU32>,
}

/// One telemetry line a gg session emits: a billed turn carrying its own cost, so
/// the run needs no OpenRouter price lookup and this test needs no network.
const GG_USAGE_LINE: &str = r#"{"timestamp":"2026-07-30T00:00:02Z","sessionId":"run-1","type":"usage","profileId":"root","modelId":"mock/echo","tokens":{"uncachedInput":100,"cachedInput":null,"output":20,"reasoning":null},"cost":{"comparable":0.01,"actual":0.01}}"#;

#[async_trait::async_trait]
impl ContainerRuntime for GgRuntime {
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
        self.clock.advance(GG_SETUP_CALL);
        self.execs.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
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
        self.clock.advance(SESSION);
        sink.on_line(OutputStream::Stdout, GG_USAGE_LINE);
        Ok(ExecOutput {
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
            idle_timed_out: false,
        })
    }

    async fn stop(&self, _container: &ContainerHandle) -> CoreResult<()> {
        self.clock.advance(TEARDOWN);
        Ok(())
    }
}

/// A harness that authenticates by subscription (so the test needs no environment
/// variable), probes as available, and reports a zero cost for its one session.
struct FakeHarness;

/// The one credential file the fake subscription declares.
static FAKE_CREDS: &[CredFile] = &[CredFile {
    source: CredSource::HomeRelative(".tcab-fake/credentials.json"),
    container_path: "/home/runner/.tcab-fake/credentials.json",
    mode: 0o600,
    required: true,
}];

#[async_trait::async_trait]
impl AgentHarness for FakeHarness {
    fn slug(&self) -> HarnessSlug {
        HarnessSlug::Claude
    }

    fn api_key_env(&self) -> Option<&'static str> {
        None
    }

    fn subscription_spec(&self) -> Option<SubscriptionSpec> {
        Some(SubscriptionSpec { files: FAKE_CREDS })
    }

    fn session_argv(&self, _model_id: &str, prompt: &str) -> Vec<String> {
        vec!["true".to_string(), prompt.to_string()]
    }

    fn event_format(&self) -> EventFormat {
        EventFormat::Generic
    }

    fn parse_session_usage(&self, _output: &ExecOutput) -> (Usage, Option<f64>) {
        (
            Usage {
                tokens: TokenCounts::default(),
            },
            Some(0.0),
        )
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
        unreachable!("the orchestrated path drives the runner, never `invoke`")
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

/// A collector that hands back a prepared tree instantly, so teardown's duration
/// is the container stop and nothing else.
struct FakeCollector {
    repo_path: PathBuf,
}

#[async_trait::async_trait]
impl ArtifactCollector for FakeCollector {
    async fn collect(&self, _container: &ContainerHandle) -> CoreResult<ArtifactCollection> {
        Ok(ArtifactCollection::new(self.repo_path.clone()))
    }
}

/// A validator that checks nothing but takes [`VALIDATION`] to do it.
struct SlowValidator {
    clock: ManualClock,
}

impl Validator for SlowValidator {
    fn validate(
        &self,
        _test_case: &TestCaseVersion,
        _variant: &Variant,
        _artifacts: &ArtifactCollection,
        _references: &[RenderedReference],
        _proofs: &[ProofFile],
    ) -> CoreResult<ValidationSummary> {
        self.clock.advance(VALIDATION);
        Ok(ValidationSummary::default())
    }
}

/// The rendered references a run of `test_case`/`variant` needs, taken straight
/// from the case's own static reference media so nothing has to be rendered.
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

/// The engine every test here drives: the real catalog, seeder, prompt renderer,
/// orchestrator and record writer, with `runtime` supplying the stage timings and
/// the collector and validator faked around it, all reading and advancing `clock`.
fn engine<R: ContainerRuntime>(
    clock: &ManualClock,
    runtime: R,
    produced: &Path,
    seed_dir: &Path,
    out_dir: &Path,
    test_case: &TestCaseVersion,
    variant: &Variant,
) -> RunEngine<FsRepoSeeder, R, FakeCollector, SlowValidator> {
    RunEngine {
        catalog: TestCaseCatalog::new(catalog_root()),
        seeder: FsRepoSeeder::new(seed_dir),
        runtime,
        collector: FakeCollector {
            repo_path: produced.to_path_buf(),
        },
        harnesses: Box::new(FakeRegistry {
            harness: FakeHarness,
        }),
        orchestrators: OrchestratorCatalog::new(),
        engines: EngineCatalog::new(),
        renderer: Box::new(PrerenderedReferenceRenderer::new(references(
            test_case, variant,
        ))),
        session_assembler: None,
        analyzer: None,
        toolchain: None,
        validator: SlowValidator {
            clock: clock.clone(),
        },
        output_dir: out_dir.to_path_buf(),
        creds: Some(Box::new(MapCreds::new(
            [(
                FAKE_CREDS[0].container_path.to_string(),
                b"{\"fake\":true}".to_vec(),
            )]
            .into_iter()
            .collect(),
        ))),
        prior_game_jam_entries: Vec::new(),
        clock: Arc::new(clock.clone()),
    }
}

/// A run of `test_case`/`variant` under `harness`. A gg run carries the capability
/// set its branch validates up front; every other harness carries none.
fn request(test_case: &TestCaseVersion, variant: &Variant, harness: HarnessSlug) -> RunRequest {
    RunRequest {
        test_case_slug: test_case.slug.clone(),
        test_case_version: Some(test_case.version.clone()),
        variant: variant.slug.clone(),
        harness,
        model_id: "fake-model".to_string(),
        orchestrator: OrchestratorSelection::default(),
        engine: EngineSelection::default(),
        max_runtime_override: Some(RUNTIME_CAP),
        container_image: None,
        gg_capability_set: (harness == HarnessSlug::Gg)
            .then(test_cabinet_core::gg::GgCapabilitySet::default),
        gg_model_windows: Default::default(),
        gg_model_providers: Default::default(),
        gg_model_modalities: Default::default(),
        gg_model_prices: Default::default(),
        model_prices: None,
    }
}

/// Drive a complete run whose four stages each take a different known time, and
/// assert each duration measured the stage it names.
#[tokio::test]
async fn each_recorded_duration_measures_the_stage_it_names() {
    let catalog = TestCaseCatalog::new(catalog_root());
    let test_case = catalog
        // Pinned to a FROZEN version rather than `resolve_latest`, so this test's
        // fixture cannot drift as the case is revised, and to a version that
        // supports the engineless run these fakes drive.
        .resolve("carom", "v2.1.0")
        .expect("resolve the bundled carom case");
    let variant = test_case.variant("base").expect("carom's base variant");

    let produced = tempfile::tempdir().expect("produced tree");
    std::fs::write(produced.path().join("index.html"), "<!doctype html>")
        .expect("write the produced tree");
    let seed_dir = tempfile::tempdir().expect("seed dir");
    let out_dir = tempfile::tempdir().expect("output dir");

    let clock = ManualClock::new();
    let engine = engine(
        &clock,
        SlowRuntime {
            clock: clock.clone(),
        },
        produced.path(),
        seed_dir.path(),
        out_dir.path(),
        &test_case,
        variant,
    );
    let request = request(&test_case, variant, HarnessSlug::Claude);

    let record = engine
        .run_resolved(
            &test_cabinet_core::mint_run_id(),
            &request,
            &test_case,
            &mut NoopEventSink,
            None,
            &RunCancellation::default(),
        )
        .await
        .expect("the run should finish");

    let metrics = record.metrics;
    let setup = metrics.setup_seconds.expect("a setup duration");
    let session = metrics.session_seconds.expect("a session duration");
    let teardown = metrics.teardown_seconds.expect("a teardown duration");
    let validation = metrics.validation_seconds.expect("a validation duration");

    // The load-bearing assertion, and the reason the issue exists: the session
    // duration is the session's own span. The container start sits immediately
    // before it, so a boundary drawn anywhere earlier — at the run timer, at the
    // container handle, at the harness install — reports `SETUP` more.
    assert_seconds(session, SESSION, "the session duration");

    // Setup is the mirror image: exactly the container start, and none of the
    // session.
    assert_seconds(setup, SETUP, "the setup duration");

    // Teardown is the run's remainder, and the container stop is what is in it.
    // Validation runs after the run's wall clock is frozen, so a teardown that
    // read `TEARDOWN + VALIDATION` would be the clock running on past it.
    assert_seconds(teardown, TEARDOWN, "the teardown duration");

    // The three partition the run's measured duration exactly, so no reader has
    // to reconcile them.
    assert_seconds(
        metrics.run_time_seconds,
        SETUP + SESSION + TEARDOWN,
        "the run time",
    );

    // Validation is measured, and measured on its own.
    assert_seconds(validation, VALIDATION, "the validation duration");
}

/// Assert a recorded figure is exactly `expected`, allowing only for the
/// floating-point subtraction the partition does.
fn assert_seconds(recorded: f64, expected: Duration, what: &str) {
    assert!(
        (recorded - expected.as_secs_f64()).abs() < 1e-9,
        "{what} was {recorded}s where the stage it names took {expected:?}",
    );
}

/// Drive a complete gg run and assert its install is measured as setup.
///
/// gg installs its own binary rather than going through the shared harness install
/// stage: a cluster run downloads a release over the network, writes the invocation
/// file and probes the version, all inside the run container. That work is shared by
/// every run of a configuration and says nothing about the model, so it belongs to
/// setup — and the only thing that puts it there is where the session's clock starts.
#[tokio::test]
async fn a_gg_run_measures_its_own_install_as_setup() {
    let catalog = TestCaseCatalog::new(catalog_root());
    let test_case = catalog
        .resolve("carom", "v2.1.0")
        .expect("resolve the bundled carom case");
    let variant = test_case.variant("base").expect("carom's base variant");

    let produced = tempfile::tempdir().expect("produced tree");
    std::fs::write(produced.path().join("index.html"), "<!doctype html>")
        .expect("write the produced tree");
    let seed_dir = tempfile::tempdir().expect("seed dir");
    let out_dir = tempfile::tempdir().expect("output dir");

    let clock = ManualClock::new();
    let execs = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let engine = engine(
        &clock,
        GgRuntime {
            clock: clock.clone(),
            execs: Arc::clone(&execs),
        },
        produced.path(),
        seed_dir.path(),
        out_dir.path(),
        &test_case,
        variant,
    );

    let record = engine
        .run_resolved(
            &test_cabinet_core::mint_run_id(),
            &request(&test_case, variant, HarnessSlug::Gg),
            &test_case,
            &mut NoopEventSink,
            None,
            &RunCancellation::default(),
        )
        .await
        .expect("the run should finish");

    let metrics = record.metrics;
    let setup = metrics.setup_seconds.expect("a setup duration");
    let session = metrics.session_seconds.expect("a session duration");

    // The load-bearing assertion: the session is the streamed session and nothing
    // else. gg's setup is container calls of its own — the invocation-file write
    // and the version probe, plus the release download when the binary is not
    // built locally — so a session window that starts before any of them reads at
    // least one `GG_SETUP_CALL` more.
    assert_seconds(session, SESSION, "the session duration");

    // Setup is where that work landed: every container call the run made — the
    // environment probe and gg's own setup stage — and nothing else.
    let execs = execs.load(std::sync::atomic::Ordering::SeqCst);
    assert!(
        execs >= 4,
        "the environment probe and gg's install, invocation file and version probe are \
         container calls, and only {execs} were made",
    );
    assert_seconds(setup, GG_SETUP_CALL * execs, "the setup duration");
}
