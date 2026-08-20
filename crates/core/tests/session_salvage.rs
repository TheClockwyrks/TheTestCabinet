//! Integration test over the **salvage** path: a gg run that hangs keeps its session record.
//!
//! A run whose harness session ends in an error never reaches artifact collection or the
//! [post-run seam](test_cabinet_core::post_run) — the engine's error path stops the
//! container and returns. That makes a `hung` or `timed_out` run the one run with no
//! record, which is exactly backwards: an unexplained stall is the outcome a record is
//! most worth having for.
//!
//! So the engine copies the journal out of the container *before* teardown and assembles
//! it through the ordinary stage. Four properties make that correct, and each is a
//! property of **where** the salvage sits rather than of any function it calls, so all
//! four are asserted here by driving a whole run through the engine with every external
//! seam faked:
//!
//! 1. the record is produced at all, at the run tree's root, for a run that errored;
//! 2. it reports itself truncated — a journal with no terminating line is a session that
//!    was killed, and the record says so rather than looking complete;
//! 3. the salvage happens while the container is still up, **before** `stop`;
//! 4. **only** the journal is rescued: `collect` is never called, so a hung run never
//!    comes back carrying a half-written implementation tree that a reviewer could open,
//!    score and publish.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use test_cabinet_core::gg_session_assembly::{GG_SESSION_TREE_ARTIFACT, GgSessionAssembler};
use test_cabinet_core::gg_session_journal::{GG_SESSION_JOURNAL_PATH, GgJournalLine};
use test_cabinet_core::gg_session_record::GG_SESSION_FORMAT_VERSION;
use test_cabinet_core::{
    AgentHarness, ArtifactCollection, ArtifactCollector, Availability, ContainerHandle,
    ContainerRuntime, ContainerSpec, ContainerStart, CredFile, CredSource, EngineCatalog,
    EngineSelection, Error as CoreError, EventFormat, ExecOutput, FsRepoSeeder, HarnessInvocation,
    HarnessOutcome, HarnessRegistry, HarnessSlug, MapCreds, MediaKind, NoopEventSink,
    OpenRouterPrices, OrchestratorCatalog, OrchestratorSelection, OutputSink,
    PrerenderedReferenceRenderer, ProofFile, RenderedReference, Result as CoreResult,
    RunCancellation, RunEngine, RunRequest, SubscriptionSpec, TestCaseCatalog, TestCaseVersion,
    Usage, ValidationSummary, Validator, Variant,
};

/// The repository's `test-cases/` directory — the real catalog, so the run is seeded from
/// a real case exactly as a `tcab run` would be.
fn catalog_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-cases")
}

/// The lifecycle steps the fakes record, in order. Proving the salvage happens while the
/// container is still up is exactly proving `salvage` precedes `stop` in this sequence.
type Steps = Arc<Mutex<Vec<&'static str>>>;

/// A container runtime whose harness session never responds: `exec_streamed` reports the
/// idle watchdog firing, which the gg executor classifies as
/// [`Error::HarnessHung`](test_cabinet_core::Error::HarnessHung).
struct HangingRuntime {
    steps: Steps,
}

#[async_trait::async_trait]
impl ContainerRuntime for HangingRuntime {
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
        // Every in-container setup step the gg executor takes before the session — the
        // binary install, the invocation file, the version probe — succeeds without
        // running anything.
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
        // The shape a wedged session takes: the watchdog detached from a process that
        // will never finish, so the exit code says nothing and `idle_timed_out` is what
        // the caller acts on.
        Ok(ExecOutput {
            exit_code: -1,
            stdout: String::new(),
            stderr: String::new(),
            idle_timed_out: true,
        })
    }

    async fn stop(&self, _container: &ContainerHandle) -> CoreResult<()> {
        self.steps.lock().expect("steps").push("stop");
        Ok(())
    }
}

/// A collector that hands over the journal — and nothing else.
///
/// [`collect`](ArtifactCollector::collect) is unreachable on purpose: rescuing the
/// implementation tree from a hung container was deliberately rejected, because it would
/// give a hung run a half-written build indistinguishable from one the model finished.
struct JournalOnlyCollector {
    steps: Steps,
    /// The bytes the container's journal is pretending to hold.
    journal: Vec<u8>,
    /// The in-container path the salvage asked for, captured for assertion.
    asked_for: Arc<Mutex<Option<String>>>,
}

#[async_trait::async_trait]
impl ArtifactCollector for JournalOnlyCollector {
    async fn collect(&self, _container: &ContainerHandle) -> CoreResult<ArtifactCollection> {
        self.steps.lock().expect("steps").push("collect");
        Err(CoreError::ArtifactCollection(
            "a failed run never collects its tree".to_string(),
        ))
    }

    async fn collect_file(
        &self,
        _container: &ContainerHandle,
        container_path: &str,
        dest: &std::path::Path,
    ) -> CoreResult<bool> {
        self.steps.lock().expect("steps").push("salvage");
        *self.asked_for.lock().expect("asked_for") = Some(container_path.to_string());
        std::fs::write(dest, &self.journal).expect("write the salvaged journal");
        Ok(true)
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
/// this run never has one.
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
        unreachable!("a hung run is never validated");
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

/// A capture journal for a session that died mid-flight: a header line and nothing else.
///
/// The **absent** terminating line is the whole point — it is the only signal a killed gg
/// can leave, and what the assembled record must report as a truncation.
fn killed_session_journal() -> Vec<u8> {
    let header = GgJournalLine::Header {
        format_version: GG_SESSION_FORMAT_VERSION,
        session_id: "salvaged".to_string(),
        capability_set: Box::new(test_cabinet_core::gg::GgCapabilitySet::default()),
        recorder: test_cabinet_core::gg_session_record::GgSessionRecorder {
            gg_version: Some("0.7.0".to_string()),
            commit: None,
        },
    };
    let mut journal = serde_json::to_vec(&header).expect("serialize the header line");
    journal.push(b'\n');
    journal
}

/// Read the assembled record back out of its gzipped artifact.
fn read_record(path: &std::path::Path) -> serde_json::Value {
    let bytes = std::fs::read(path).expect("read the assembled record artifact");
    let mut json = String::new();
    std::io::Read::read_to_string(&mut flate2::read::GzDecoder::new(&bytes[..]), &mut json)
        .expect("the artifact should be gzip");
    serde_json::from_str(&json).expect("the artifact should be JSON")
}

/// Drive a gg run whose session hangs and assert the four properties of the salvage.
#[tokio::test]
async fn a_hung_gg_run_keeps_the_capture_journal_it_had_written() {
    let catalog = TestCaseCatalog::new(catalog_root());
    let test_case = catalog
        .resolve_latest("carom")
        .expect("resolve the bundled carom case");
    let variant = test_case.variant("base").expect("carom's base variant");

    let steps: Steps = Arc::new(Mutex::new(Vec::new()));
    let asked_for = Arc::new(Mutex::new(None));
    let seed_dir = tempfile::tempdir().expect("seed dir");
    let out_dir = tempfile::tempdir().expect("output dir");

    let engine = RunEngine {
        catalog: TestCaseCatalog::new(catalog_root()),
        seeder: FsRepoSeeder::new(seed_dir.path()),
        runtime: HangingRuntime {
            steps: Arc::clone(&steps),
        },
        collector: JournalOnlyCollector {
            steps: Arc::clone(&steps),
            journal: killed_session_journal(),
            asked_for: Arc::clone(&asked_for),
        },
        harnesses: Box::new(FakeRegistry {
            harness: FakeHarness,
        }),
        orchestrators: OrchestratorCatalog::new(),
        engines: EngineCatalog::new(),
        renderer: Box::new(PrerenderedReferenceRenderer::new(references(
            &test_case, variant,
        ))),
        // The real assembler, not a fake: what is under test is that a hung run reaches
        // the same stage a completed one does, producing the same artifact.
        session_assembler: Some(Box::new(GgSessionAssembler)),
        analyzer: None,
        toolchain: None,
        validator: UnreachableValidator,
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
        harness: HarnessSlug::Gg,
        model_id: "fake-model".to_string(),
        orchestrator: OrchestratorSelection::default(),
        engine: EngineSelection::default(),
        max_runtime_override: Some(60),
        container_image: None,
        gg_capability_set: Some(test_cabinet_core::gg::GgCapabilitySet::default()),
        gg_model_windows: Default::default(),
        gg_model_modalities: Default::default(),
    };

    // The id the *host* would drive this run under and would then file its own failure
    // record under. Asserting the artifact lands here — rather than discovering whatever
    // directory the engine happened to create — is what pins the property the driver
    // depends on: the salvaged record is reachable from the id the failure is reported
    // with. An engine that minted its own id would leave it orphaned.
    let run_id = test_cabinet_core::mint_run_id();
    let error = engine
        .run_resolved(
            &run_id,
            &request,
            &test_case,
            &mut NoopEventSink,
            None,
            &RunCancellation::default(),
        )
        .await
        .expect_err("a session that never responds must fail the run");
    assert!(
        matches!(error, CoreError::HarnessHung { .. }),
        "expected a hung run, got {error:?}",
    );

    // (3) and (4): the journal is copied while the container is still up, and the
    // implementation tree is never collected. Both are properties of where the salvage
    // sits on the error path, which no unit test over the copy itself can show.
    assert_eq!(
        *steps.lock().expect("steps"),
        vec!["session", "salvage", "stop"],
        "the journal must be salvaged after the session fails and before teardown, and \
         the implementation tree must never be collected",
    );
    assert_eq!(
        asked_for.lock().expect("asked_for").as_deref(),
        Some(format!("/work/{GG_SESSION_JOURNAL_PATH}").as_str()),
    );

    // (1): the artifact exists, at the run tree's root, for a run that produced no
    // record of its own — under the id the caller supplied, which is the only id the
    // failure path knows.
    let run_dir = out_dir.path().join(&run_id);
    let artifact = run_dir.join(GG_SESSION_TREE_ARTIFACT);
    assert!(
        artifact.is_file(),
        "a hung run's salvaged record should be assembled at {}",
        artifact.display(),
    );

    // (2): the record admits what it is. A journal with no terminating line is the only
    // signal a killed gg leaves, and a record that did not report it would look complete.
    let record = read_record(&artifact);
    assert_eq!(
        record["truncation"]["reason"], "session_killed",
        "a salvaged journal has no terminating line, so its record must say the session \
         was killed: {record}",
    );
    assert_eq!(
        record["entries"].as_array().map(Vec::len),
        Some(0),
        "the fixture journal carries no entries",
    );
}
