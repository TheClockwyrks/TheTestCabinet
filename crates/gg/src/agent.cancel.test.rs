//! The turn loop under an **operator cancellation** — that a killed run stops at a clean
//! boundary, keeps everything it accumulated, and still emits the session epilogue that is
//! the whole reason a killed run is worth retaining.
//!
//! Split out of `agent.test.rs` rather than added to it because these drive a distinct
//! condition (the host's kill, not a configured ceiling) and the file is already long.

use super::*;
use crate::cancel::CancelWatch;
use std::sync::atomic::{AtomicUsize, Ordering};

/// A [`LimitsSetup`] with no ceiling armed at all except a turn bound, whose cancellation
/// watch reads `sentinel`. The shape every test here wants: the only thing that can stop
/// the loop is the host.
fn cancelable(max_turns: usize, sentinel: PathBuf) -> LimitsSetup {
    LimitsSetup {
        limits: RunLimits {
            max_turns: Some(max_turns),
            max_runtime: None,
            max_consecutive_errors: None,
            error_rate: None,
            max_cost: None,
            replay_max_bytes: None,
        },
        deadline: None,
        spend: Arc::new(RunSpend::default()),
        cancel: CancelWatch::new(sentinel),
        fault: FaultLatch::default(),
        ceiling: CeilingLatch::default(),
    }
}

/// A client that replays a looping script and raises the cancellation `sentinel` once it
/// has answered `after` turns — the host killing a run mid-flight, made deterministic.
struct CancelingClient {
    inner: MockClient,
    sentinel: PathBuf,
    after: usize,
    answered: AtomicUsize,
}

impl CancelingClient {
    fn new(sentinel: PathBuf, after: usize, script: Vec<ModelResponse>) -> Self {
        Self {
            inner: MockClient::new("mock/primary", script),
            sentinel,
            after,
            answered: AtomicUsize::new(0),
        }
    }
}

#[async_trait::async_trait]
impl ModelClient for CancelingClient {
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        let reply = self.inner.complete(messages, tools).await;
        if self.answered.fetch_add(1, Ordering::SeqCst) + 1 == self.after {
            std::fs::write(&self.sentinel, b"").expect("raise the cancellation sentinel");
        }
        reply
    }

    fn model_id(&self) -> &str {
        self.inner.model_id()
    }
}

/// A tokens-and-cost-bearing looping reply, so a cancellation can be shown to keep what the
/// run had already spent rather than reporting a run that cost nothing.
fn billed_looping_response() -> ModelResponse {
    let mut reply = looping_response();
    reply.usage = TokenCounts {
        uncached_input: Some(100),
        output: Some(20),
        ..TokenCounts::default()
    };
    reply.cost = Some(Cost {
        actual: Some(0.01),
        comparable: Some(0.01),
    });
    reply
}

#[tokio::test]
async fn a_run_canceled_before_its_first_turn_stops_immediately() {
    // The kill can land before the loop has done anything. The boundary check is at the
    // top of the turn, so the run must stop without making a model call at all.
    let dir = TempDir::new().expect("temp dir");
    let sentinel = dir.path().join("gg-cancel");
    std::fs::write(&sentinel, b"").expect("raise the sentinel");

    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cancel".to_string()), Box::new(sink.clone()));
    let client = MockClient::new("mock/primary", vec![looping_response(); 4]);
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        cancelable(10, sentinel),
        no_code(),
    )
    .await;

    assert_eq!(end.status, STATUS_CANCELED);
    assert_eq!(end.turns, 0, "no turn should have been started");
    assert_eq!(
        client.turns_taken(),
        0,
        "a canceled run must not pay for a model call it will not use",
    );
}

#[tokio::test]
async fn a_cancellation_stops_the_run_at_the_next_turn_boundary() {
    // The kill lands mid-run. The turn in flight completes — a turn is the loop's atomic
    // unit — and the loop stops at the boundary after it, not part-way through.
    let dir = TempDir::new().expect("temp dir");
    let sentinel = dir.path().join("gg-cancel");

    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cancel".to_string()), Box::new(sink.clone()));
    let client = CancelingClient::new(sentinel.clone(), 2, vec![looping_response(); 20]);
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        cancelable(20, sentinel),
        no_code(),
    )
    .await;

    assert_eq!(end.status, STATUS_CANCELED);
    assert_eq!(
        end.turns, 2,
        "the two turns that ran are recorded; the third never started",
    );
    assert!(
        end.turns < 20,
        "the run must stop on the cancellation, not fall through its turn bound",
    );
}

#[tokio::test]
async fn a_canceled_run_keeps_the_tokens_and_cost_it_accumulated() {
    // The point of stopping cooperatively: a killed run reports what it actually spent, so
    // the operator can see what the run cost them before they stopped it.
    let dir = TempDir::new().expect("temp dir");
    let sentinel = dir.path().join("gg-cancel");

    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cancel".to_string()), Box::new(sink.clone()));
    let client = CancelingClient::new(sentinel.clone(), 3, vec![billed_looping_response(); 20]);
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        cancelable(20, sentinel),
        no_code(),
    )
    .await;

    assert_eq!(end.status, STATUS_CANCELED);
    assert_eq!(end.turns, 3);
    assert_eq!(
        end.tokens.uncached_input,
        Some(300),
        "every answered turn's input tokens are kept",
    );
    assert_eq!(end.tokens.output, Some(60));
    let cost = end.cost.expect("a run that spent money reports a cost");
    assert!(
        cost.actual.is_some_and(|actual| actual > 0.0),
        "the accumulated spend must survive the cancellation, got {cost:?}",
    );
}

#[tokio::test]
async fn a_cancellation_records_no_limit_breach() {
    // Every breach names a ceiling that was measured and crossed. A cancellation crossed
    // nothing, so recording one would put a fabricated ceiling into the field a study reads
    // to find out why runs stop.
    let dir = TempDir::new().expect("temp dir");
    let sentinel = dir.path().join("gg-cancel");
    std::fs::write(&sentinel, b"").expect("raise the sentinel");

    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cancel".to_string()), Box::new(sink.clone()));
    let client = MockClient::new("mock/primary", vec![looping_response(); 4]);
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        cancelable(10, sentinel),
        no_code(),
    )
    .await;

    assert!(end.limit.is_none(), "got {:?}", end.limit);
    assert!(
        limit_breaches(&sink.events()).is_empty(),
        "a cancellation must emit no LimitExceeded event",
    );
    // It is still announced, so the operator log says why the run stopped.
    assert!(
        warn_messages(&sink.events())
            .iter()
            .any(|m| m.contains("canceled by its host")),
        "the cancellation must be named on the stream: {:?}",
        warn_messages(&sink.events()),
    );
}

#[tokio::test]
async fn a_canceled_session_still_emits_its_summary_and_session_end() {
    // The whole reason cancellation is cooperative rather than a kill: the epilogue runs.
    // A killed run's console view is rebuilt from this stream, so the summary and the
    // terminal event have to be on it — and both have to say `canceled`, because that is
    // what a reader of a frozen view needs to know about the run in front of them.
    let dir = TempDir::new().expect("temp dir");
    let sentinel = dir.path().join("gg-cancel");
    std::fs::write(&sentinel, b"").expect("raise the sentinel");

    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cancel".to_string()), Box::new(sink.clone()));
    let mut inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/primary"));
    inv.cancel_file = Some(sentinel);

    let script = vec![looping_response(); 4];
    let client = Arc::new(RecordingClient::new("mock/primary", script));
    let shared = Arc::clone(&client);
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |_| {
        Box::new(SharedRecordingClient(Arc::clone(&shared)))
    });

    let outcome = run_with_factory(&inv, &emitter, Arc::new(factory)).await;
    let events = sink.events();

    // The process still exits successfully: a session that ran and was stopped is not a
    // launch failure, and the real outcome is in the stream.
    assert_eq!(outcome, SessionOutcome::Ran);

    let summary = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::SessionSummary { summary } => Some(summary.clone()),
            _ => None,
        })
        .expect("a canceled session still emits its aggregatable summary");
    assert_eq!(summary.terminal_status, STATUS_CANCELED);

    assert!(
        matches!(
            events.last().map(|e| &e.kind),
            Some(GgTelemetryKind::SessionEnded { status }) if status == STATUS_CANCELED
        ),
        "the stream must close on a canceled SessionEnded: {:?}",
        events.last(),
    );
}
