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
//! A third-party harness is driven through its orchestrator's runner, whose
//! `tcab-session` wrapper writes a session log inside the container. A session that log
//! holds without its closing marker was still running when the exec returned, so it is the
//! platform's end whatever the exit status; a session only the stream leaves open is not,
//! since the stream can lose its last lines as a session exits.
//!
//! Each case drives a whole run through the engine with every external seam faked: the
//! container runtime streams a chosen output, exits with a chosen code, holds a chosen
//! session log and reports a chosen sandbox state. The harness's own ends are driven too,
//! so the attribution is seen to leave them alone: a breached ceiling (gg's exit `3`) stays
//! `limit_exceeded` and any other failure with a live pod stays `harness_error`.

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

/// The usage line the fake third-party harness reports at the end of its session.
const THIRD_PARTY_USAGE: &str = r#"{"input_tokens":100,"output_tokens":20}"#;

/// The sentinels the `tcab-session` wrapper brackets each session with.
const SESSION_BEGIN: &str = "__TCAB_SESSION_BEGIN__";
const SESSION_END: &str = "__TCAB_SESSION_END__";

/// The run user's home the fake runtime reports to the orchestrator.
const HOME: &str = "/home/runner";

/// How a faked session ends: the harness it runs, the output it streams, the code its
/// exec reports, the session log a third-party runner left in the container and the
/// state the runtime reports its sandbox in once the exec has returned.
#[derive(Clone)]
struct Ending {
    slug: HarnessSlug,
    lines: Vec<String>,
    exit_code: i32,
    /// The session log's contents, or `None` when it cannot be read.
    session_log: Option<String>,
    sandbox: SandboxState,
}

/// One third-party session's stdout as the wrapper brackets it: closed with its
/// sentinel, or cut off before it.
fn third_party_session(closed: bool) -> Vec<String> {
    let mut lines = vec![SESSION_BEGIN.to_string(), THIRD_PARTY_USAGE.to_string()];
    if closed {
        lines.push(SESSION_END.to_string());
    }
    lines
}

/// The session log the wrapper writes for `lines`.
fn log_of(lines: &[String]) -> String {
    let mut log = lines.join("\n");
    log.push('\n');
    log
}

impl Ending {
    /// A session that billed one turn and closed with `status`, exiting `exit_code`
    /// against a sandbox in `sandbox`.
    fn closed(status: &str, exit_code: i32, sandbox: SandboxState) -> Self {
        Self {
            slug: HarnessSlug::Gg,
            lines: vec![USAGE_LINE.to_string(), session_ended(status)],
            exit_code,
            session_log: None,
            sandbox,
        }
    }

    /// A session that billed one turn and never emitted `session_ended`.
    fn unclosed(exit_code: i32, sandbox: SandboxState) -> Self {
        Self {
            slug: HarnessSlug::Gg,
            lines: vec![USAGE_LINE.to_string()],
            exit_code,
            session_log: None,
            sandbox,
        }
    }

    /// A third-party session whose stream and session log both hold it as `closed`
    /// says, exiting `exit_code` against a sandbox in `sandbox`.
    fn third_party(closed: bool, exit_code: i32, sandbox: SandboxState) -> Self {
        let lines = third_party_session(closed);
        Self {
            slug: HarnessSlug::Claude,
            session_log: Some(log_of(&lines)),
            lines,
            exit_code,
            sandbox,
        }
    }

    /// The same session, with a session log that cannot be read back.
    fn without_log(self) -> Self {
        Self {
            session_log: None,
            ..self
        }
    }

    /// The same session, its log holding `lines` rather than what was streamed.
    fn with_log(self, lines: &[String]) -> Self {
        Self {
            session_log: Some(log_of(lines)),
            ..self
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
        command: &[String],
    ) -> CoreResult<ExecOutput> {
        if self.ending.slug != HarnessSlug::Gg {
            let script = command.last().map(String::as_str).unwrap_or_default();
            // The orchestrator resolves the run user's home, and reads the session log
            // back once the runner has exited.
            if script == "printf %s \"$HOME\"" {
                return Ok(ExecOutput {
                    exit_code: 0,
                    stdout: HOME.to_string(),
                    stderr: String::new(),
                    idle_timed_out: false,
                });
            }
            if script.starts_with("cat ") && script.contains("sessions.log") {
                return Ok(match &self.ending.session_log {
                    Some(log) => ExecOutput {
                        exit_code: 0,
                        stdout: log.clone(),
                        stderr: String::new(),
                        idle_timed_out: false,
                    },
                    None => ExecOutput {
                        exit_code: 1,
                        stdout: String::new(),
                        stderr: "cat: sessions.log: No such file or directory".to_string(),
                        idle_timed_out: false,
                    },
                });
            }
        }
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
/// supplies and probes as available; its session is never invoked. A third-party run
/// drives it through the orchestrator's `tcab-session` wrapper, reading its usage off the
/// session's [`THIRD_PARTY_USAGE`] line.
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

    fn session_argv(&self, _model_id: &str, prompt: &str) -> Vec<String> {
        vec!["fake-cli".to_string(), prompt.to_string()]
    }

    fn event_format(&self) -> EventFormat {
        EventFormat::Generic
    }

    fn parse_session_usage(&self, output: &ExecOutput) -> (Usage, Option<f64>) {
        let mut usage = Usage::default();
        for line in output.stdout.lines() {
            if let Ok(reported) = serde_json::from_str::<serde_json::Value>(line) {
                usage.tokens.uncached_input = reported["input_tokens"].as_u64();
                usage.tokens.output = reported["output_tokens"].as_u64();
            }
        }
        (usage, None)
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
        unreachable!("a run drives a third-party harness through its orchestrator")
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

/// Drive a whole run of carom v2.1.0 whose session ends as `ending` says.
async fn drive(ending: Ending) -> Driven {
    let slug = ending.slug;
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
        harness: slug,
        model_id: "fake-model".to_string(),
        orchestrator: OrchestratorSelection::default(),
        engine: EngineSelection::default(),
        max_runtime_override: Some(60),
        container_image: None,
        gg_capability_set: (slug == HarnessSlug::Gg)
            .then(test_cabinet_driver::gg::GgCapabilitySet::default),
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

/// The detail every gg platform end opens with.
const GG_ENDED: &str = "run failed: gg harness session ended by the platform (";

/// The detail every third-party platform end but a lost session opens with.
const CLAUDE_ENDED: &str = "run failed: claude harness session ended by the platform (";

/// Assert `driven` is a gg run the platform ended; see [`assert_ended`].
fn assert_platform_end(driven: Driven, names: &[&str]) {
    assert_ended(driven, GG_ENDED, names);
}

/// Assert `driven` is a run the platform ended: recorded `infrastructure` with a detail
/// opening with `prefix` and containing every one of `names`, neither collected nor
/// validated, its usage kept, and the detail on its event stream and in its written
/// record.
fn assert_ended(driven: Driven, prefix: &str, names: &[&str]) {
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
    assert!(detail.starts_with(prefix), "unexpected detail {detail:?}");
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

// --- a third-party harness, driven through its orchestrator -----------------

#[tokio::test]
async fn a_session_the_log_leaves_open_is_an_infrastructure_end_despite_a_clean_exit() {
    // The connection carrying the runner's exec was lost while the harness was still
    // running, and the platform reported the runner as finished.
    let driven = drive(Ending::third_party(false, 0, SandboxState::Running)).await;
    assert_ended(
        driven,
        "run failed: claude harness session lost before the harness exited (",
        &["1 of 1 logged sessions unclosed", "exit code 0"],
    );
}

#[tokio::test]
async fn a_session_the_log_leaves_open_is_an_infrastructure_end_at_a_failing_exit() {
    // The log is believed over the exit status, whichever it reads.
    let driven = drive(Ending::third_party(false, 1, SandboxState::Running)).await;
    assert_ended(
        driven,
        "run failed: claude harness session lost before the harness exited (",
        &["1 of 1 logged sessions unclosed", "exit code 1"],
    );
}

#[tokio::test]
async fn a_session_only_the_stream_leaves_open_is_the_harnesss_own_end() {
    // The stream lost its closing sentinel, but the log closed the session: the
    // harness exited, and the run is collected and validated.
    let stream = third_party_session(false);
    let driven = drive(
        Ending {
            lines: stream,
            ..Ending::third_party(true, 0, SandboxState::Running)
        }
        .with_log(&third_party_session(true)),
    )
    .await;
    let record = driven.result.expect("a clean run is recorded");
    assert_ne!(record.status.state, RunState::Infrastructure);
    assert!(driven.collected && driven.validated);
    assert_eq!(record.metrics.tokens.uncached_input, Some(100));
}

#[tokio::test]
async fn an_unread_log_leaves_an_open_stream_session_a_warning() {
    // With the log unreadable, the stream is no account of the session's end: the
    // sandbox and the exit status decide, and here both are the harness's own.
    let driven = drive(Ending::third_party(false, 0, SandboxState::Running).without_log()).await;
    let record = driven.result.expect("the run stands");
    assert_ne!(record.status.state, RunState::Infrastructure);
    assert!(driven.collected && driven.validated);
    assert!(
        driven
            .events
            .iter()
            .any(|event| matches!(&event.kind, EventKind::Warning { message, .. } if message.contains("incomplete"))),
        "the incomplete usage is a warning on the run's events",
    );
}

#[tokio::test]
async fn a_deleted_third_party_sandbox_is_an_infrastructure_end_at_exit_0_and_1() {
    for code in [0, 1] {
        // A deleted pod's session log cannot be read back.
        let driven = drive(Ending::third_party(true, code, gone()).without_log()).await;
        assert_ended(
            driven,
            CLAUDE_ENDED,
            &[SANDBOX, "gone: deleted", &format!("exit code {code}")],
        );
    }
}

#[tokio::test]
async fn a_disrupted_third_party_sandbox_is_an_infrastructure_end_at_exit_0_and_1() {
    for code in [0, 1] {
        let driven = drive(Ending::third_party(true, code, disrupted())).await;
        assert_ended(
            driven,
            CLAUDE_ENDED,
            &[
                SANDBOX,
                "disrupted: EvictionByEvictionAPI",
                &format!("exit code {code}"),
            ],
        );
    }
}

#[tokio::test]
async fn a_third_party_runner_killed_by_a_signal_is_an_infrastructure_end() {
    for (code, signal) in [(137, "signal 9"), (143, "signal 15")] {
        let driven = drive(Ending::third_party(true, code, SandboxState::Running)).await;
        assert_ended(
            driven,
            CLAUDE_ENDED,
            &[signal, &format!("exit code {code}")],
        );
    }
}

#[tokio::test]
async fn a_third_party_exec_with_no_status_is_an_infrastructure_end() {
    let driven = drive(Ending::third_party(true, -1, SandboxState::Running)).await;
    assert_ended(driven, CLAUDE_ENDED, &["exec stream lost", "exit code -1"]);
}

#[tokio::test]
async fn a_third_party_failure_with_a_live_pod_stays_harness_error() {
    let driven = drive(Ending::third_party(true, 1, SandboxState::Running)).await;
    let error = driven
        .result
        .expect_err("a harness failure fails the session");
    assert_eq!(RunState::classify_failure(&error), RunState::HarnessError);
    assert!(!driven.validated);
}

#[tokio::test]
async fn a_closed_third_party_session_with_a_live_pod_is_validated() {
    let driven = drive(Ending::third_party(true, 0, SandboxState::Running)).await;
    let record = driven.result.expect("a clean run is recorded");
    assert_ne!(record.status.state, RunState::Infrastructure);
    assert!(driven.collected, "a clean run is collected");
    assert!(driven.validated, "a clean run is validated");
    assert_eq!(record.metrics.tokens.uncached_input, Some(100));
    assert_eq!(record.metrics.tokens.output, Some(20));
}
