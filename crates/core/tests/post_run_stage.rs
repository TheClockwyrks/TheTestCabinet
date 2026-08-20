//! Integration test over the post-run stage seam's *placement* in the run
//! lifecycle.
//!
//! The seam exists for one reason: post-run analysis of a finished run must
//! happen **after the tree is collected, before validation, and outside the
//! harness session's runtime cap**. Every one of those three is a property of
//! where the call sits in [`RunEngine::run_resolved`], so none of them can be
//! proven by a unit test over the stage driver itself — and all three are the kind
//! of thing an innocent-looking refactor silently undoes. So this drives a whole
//! run through the engine with every external seam faked, and a stage that takes
//! **longer than the run's entire runtime cap** to finish.
//!
//! If the stage were ever moved inside the cap, the run below would fail with
//! `RunTimedOut` instead of returning a record: the cap is one second and the
//! stage takes two. If it were moved after validation, or before collection, the
//! recorded call order would say so.
//!
//! Only the container, the harness, the collector and the validator are faked; the
//! catalog, the seeder, the prompt renderer, the orchestrator and the record
//! writer are the real ones, so the run walks the real lifecycle.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use test_cabinet_core::{
    AgentHarness, ArtifactCollection, ArtifactCollector, Availability, ContainerHandle,
    ContainerRuntime, ContainerSpec, ContainerStart, CredFile, CredSource, EngineCatalog,
    EngineSelection, EventFormat, EventSink, ExecOutput, FsRepoSeeder, HarnessInvocation,
    HarnessOutcome, HarnessRegistry, HarnessSlug, MapCreds, MediaKind, NoopEventSink,
    OpenRouterPrices, OrchestratorCatalog, OrchestratorSelection, OutputSink, OutputStream,
    PostRunContext, PostRunReport, PostRunStage, PrerenderedReferenceRenderer, ProofFile,
    RenderedReference, Result as CoreResult, RunCancellation, RunEngine, RunRequest,
    SubscriptionSpec, TestCaseCatalog, TestCaseVersion, TokenCounts, Usage, ValidationSummary,
    Validator, Variant,
};

/// The repository's `test-cases/` directory — the real catalog, so the run is
/// seeded from a real case exactly as a `tcab run` would be.
fn catalog_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-cases")
}

/// How long the post-run stage takes. Deliberately longer than [`RUNTIME_CAP`]:
/// the run must still succeed, which is only true if the stage runs outside the
/// cap.
const STAGE_DURATION: Duration = Duration::from_secs(2);

/// The run's entire runtime cap, in seconds. The faked harness session finishes
/// instantly, so this only ever bites something that is *inside* the cap.
const RUNTIME_CAP: u64 = 1;

/// The lifecycle steps the fakes record, in the order they happened. Proving the
/// seam sits between collection and validation is exactly proving this sequence.
type Steps = Arc<Mutex<Vec<&'static str>>>;

/// What the stage saw of the run it was handed, captured so the context the seam
/// builds can be asserted on after the run.
#[derive(Default)]
struct Observed {
    /// Whether the stage ran at all.
    ran: bool,
    /// The seed commit the seam passed through — the boundary between the seeded
    /// scaffolding and the code the model wrote.
    seed_commit: String,
    /// Whether the collected tree the stage was pointed at existed when it ran.
    tree_present: bool,
    /// Whether the run directory existed before the stage wrote into it.
    run_dir_present: bool,
}

/// A stage that takes [`STAGE_DURATION`] — longer than the whole run's cap — and
/// writes an artifact into the run directory, recording what it was given.
struct SlowStage {
    steps: Steps,
    observed: Arc<Mutex<Observed>>,
}

#[async_trait::async_trait]
impl PostRunStage for SlowStage {
    fn name(&self) -> &'static str {
        "slow-test-stage"
    }

    async fn run(&self, context: &PostRunContext<'_>) -> CoreResult<PostRunReport> {
        self.steps.lock().expect("steps").push("post-run");
        {
            let mut observed = self.observed.lock().expect("observed");
            observed.ran = true;
            observed.seed_commit = context.seed_commit.to_string();
            observed.tree_present = context.artifacts.repo_path.is_dir();
            observed.run_dir_present = context.run_dir.is_dir();
        }
        // Sleep rather than spin: an analysis stage is IO- and CPU-bound work of
        // unbounded duration, and what is under test is that nothing bounds it.
        tokio::time::sleep(STAGE_DURATION).await;
        let artifact = context.run_dir.join("test-stage.json");
        std::fs::write(&artifact, b"{}").expect("write the stage's artifact");
        Ok(PostRunReport::artifact(artifact))
    }
}

/// A container runtime that answers every command successfully without running
/// anything. Its stdout is a plausible home directory because the orchestrator
/// resolves the run user's home with an `exec` before it writes its scripts.
struct FakeRuntime;

#[async_trait::async_trait]
impl ContainerRuntime for FakeRuntime {
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
        // Bracket a single session exactly as the `tcab-session` wrapper does, so
        // the orchestrator segments one session out of the stream and reads its
        // usage — including the reported cost, which is what keeps this test off
        // the network (a run with a reported cost needs no OpenRouter lookup).
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
        Ok(())
    }
}

/// A harness that authenticates by subscription (so the test needs no environment
/// variable), probes as available, and reports a zero cost for its one session.
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

/// A collector that hands back a prepared tree, recording that collection
/// happened — the step the seam must run *after*.
struct FakeCollector {
    steps: Steps,
    repo_path: PathBuf,
}

#[async_trait::async_trait]
impl ArtifactCollector for FakeCollector {
    async fn collect(&self, _container: &ContainerHandle) -> CoreResult<ArtifactCollection> {
        self.steps.lock().expect("steps").push("collect");
        Ok(ArtifactCollection::new(self.repo_path.clone()))
    }
}

/// A validator that checks nothing, recording that validation happened — the step
/// the seam must run *before*, because validation rewrites the very tree an
/// analysis is meant to measure.
struct FakeValidator {
    steps: Steps,
}

impl Validator for FakeValidator {
    fn validate(
        &self,
        _test_case: &TestCaseVersion,
        _variant: &Variant,
        _artifacts: &ArtifactCollection,
        _references: &[RenderedReference],
        _proofs: &[ProofFile],
    ) -> CoreResult<ValidationSummary> {
        self.steps.lock().expect("steps").push("validate");
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

/// Drive a complete run whose post-run stage takes longer than the run's entire
/// runtime cap, and assert the three placement properties the seam exists for.
#[tokio::test]
async fn the_post_run_stage_runs_after_collection_before_validation_and_outside_the_runtime_cap() {
    let catalog = TestCaseCatalog::new(catalog_root());
    let test_case = catalog
        // Pinned to a FROZEN version rather than `resolve_latest`, so this test's
        // fixture cannot drift as the case is revised. It also has to be a version
        // that supports the engineless run, which is what these fakes drive: a
        // version built against an engine refuses `EngineSelection::default()`
        // before any of the ordering below happens.
        .resolve("carom", "v2.1.0")
        .expect("resolve the bundled carom case");
    let variant = test_case.variant("base").expect("carom's base variant");

    // The "produced" tree the collector hands back, standing in for what the
    // harness left behind in the container.
    let produced = tempfile::tempdir().expect("produced tree");
    std::fs::write(produced.path().join("index.html"), "<!doctype html>")
        .expect("write the produced tree");

    let steps: Steps = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::new(Mutex::new(Observed::default()));
    let seed_dir = tempfile::tempdir().expect("seed dir");
    let out_dir = tempfile::tempdir().expect("output dir");

    let engine = RunEngine {
        catalog: TestCaseCatalog::new(catalog_root()),
        seeder: FsRepoSeeder::new(seed_dir.path()),
        runtime: FakeRuntime,
        collector: FakeCollector {
            steps: Arc::clone(&steps),
            repo_path: produced.path().to_path_buf(),
        },
        harnesses: Box::new(FakeRegistry {
            harness: FakeHarness,
        }),
        orchestrators: OrchestratorCatalog::new(),
        engines: EngineCatalog::new(),
        renderer: Box::new(PrerenderedReferenceRenderer::new(references(
            &test_case, variant,
        ))),
        session_assembler: Some(Box::new(SlowStage {
            steps: Arc::clone(&steps),
            observed: Arc::clone(&observed),
        })),
        analyzer: None,
        toolchain: None,
        validator: FakeValidator {
            steps: Arc::clone(&steps),
        },
        prices: OpenRouterPrices::new(),
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
    };

    let request = RunRequest {
        test_case_slug: test_case.slug.clone(),
        test_case_version: Some(test_case.version.clone()),
        variant: variant.slug.clone(),
        harness: HarnessSlug::Claude,
        model_id: "fake-model".to_string(),
        orchestrator: OrchestratorSelection::default(),
        engine: EngineSelection::default(),
        // One second for the entire run — the session, and anything the cap wraps.
        max_runtime_override: Some(RUNTIME_CAP),
        container_image: None,
        gg_capability_set: None,
        gg_model_windows: Default::default(),
        gg_model_modalities: Default::default(),
    };

    let wall_clock = Instant::now();
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
        // The load-bearing assertion: a stage that takes twice the run's whole
        // runtime cap must not turn the run into a timeout. Moving the seam inside
        // `with_runtime_cap` fails here with `RunTimedOut`.
        .expect("the run should finish despite a stage that outlasts the runtime cap");
    let wall_clock = wall_clock.elapsed();

    let observed = observed.lock().expect("observed");
    assert!(observed.ran, "the stage should have been invoked");
    assert_eq!(
        *steps.lock().expect("steps"),
        vec!["collect", "post-run", "validate"],
        "the stage must run after the tree is collected and before validation \
         rewrites that tree",
    );

    // The run's measured duration is frozen before the seam, so a stage cannot
    // inflate what the run is judged on. Comparing against the wall clock rather
    // than a constant keeps this honest on a slow machine: whatever the run itself
    // took, the stage's time is not part of it.
    let unmeasured = wall_clock.as_secs_f64() - record.metrics.run_time_seconds;
    assert!(
        unmeasured >= STAGE_DURATION.as_secs_f64(),
        "the stage's {STAGE_DURATION:?} should sit outside the recorded run time \
         (wall clock {wall_clock:?}, recorded {}s)",
        record.metrics.run_time_seconds,
    );

    // The context the seam builds: the seeded boundary the analysis measures
    // against, a collected tree to read, and a run directory to write into that
    // already exists.
    assert_eq!(
        Some(observed.seed_commit.clone()),
        record.seed_commit,
        "the stage should see the same seed commit the record carries",
    );
    assert!(
        !observed.seed_commit.is_empty(),
        "the seed commit should be a real hash",
    );
    assert!(observed.tree_present, "the collected tree should exist");
    assert!(
        observed.run_dir_present,
        "the run directory should be created before a stage writes into it",
    );

    // The artifact the stage wrote sits at the root of the run tree, beside the
    // run record and outside `implementation/` — where a host-written file cannot
    // be mistaken for code the model wrote.
    let run_dir: &Path = &out_dir.path().join(&record.id);
    assert!(
        run_dir.join("test-stage.json").is_file(),
        "the stage's artifact should be at the run tree's root",
    );
    assert!(
        run_dir.join("run-record.json").is_file(),
        "the run record should have been written to the same run directory",
    );
    assert!(
        !run_dir.join("implementation/test-stage.json").exists(),
        "a stage's artifact must not land inside the produced implementation",
    );
}
