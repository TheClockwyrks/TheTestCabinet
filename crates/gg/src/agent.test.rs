use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::client::MockClient;
use crate::config::GgInvocation;
use crate::context::HeuristicTokenEstimator;
use crate::model::{
    FinishReason, Message, ModelClient, ModelError, ModelResponse, ToolCall, ToolDefinition,
};
use crate::telemetry::{CollectingSink, Emitter};
use crate::tools::{ToolContext, ToolRegistry};
use test_cabinet_core::gg::{
    CAPABILITY_CONTEXT_VISIBILITY, GgCapabilitySet, GgContextSource, GgTelemetryKind,
};
use test_cabinet_core::metrics::{Cost, TokenCounts};

/// An invocation over `dir` configured with `set`.
fn invocation(dir: &Path, set: GgCapabilitySet) -> GgInvocation {
    GgInvocation {
        session_id: "run-test".to_string(),
        workspace_dir: dir.to_path_buf(),
        prompt: "Build a tiny game.".to_string(),
        capability_set: set,
    }
}

/// A [`ContextSetup`] for the `drive` unit tests: the cheap heuristic estimator (so the
/// tests never build the BPE vocab), a fixed window, and breakdown emission per the
/// argument.
fn test_context_setup(emit_breakdown: bool) -> ContextSetup {
    ContextSetup {
        estimator: Arc::new(HeuristicTokenEstimator::new()),
        window_limit: Some(128_000),
        emit_breakdown,
    }
}

/// A model response that keeps asking for a harmless tool call, so a loop driving it
/// only ends by hitting a bound.
fn looping_response() -> ModelResponse {
    ModelResponse {
        text: Some("still working".to_string()),
        tool_calls: vec![ToolCall {
            id: "call_ls".to_string(),
            name: "list_dir".to_string(),
            arguments: json!({ "path": "." }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// A [`ModelClient`] whose every turn fails, for asserting the loop surfaces model
/// errors loudly rather than discarding the run.
struct FailingClient {
    retryable: bool,
}

#[async_trait::async_trait]
impl ModelClient for FailingClient {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        if self.retryable {
            Err(ModelError::RetryExhausted {
                attempts: 4,
                last: "429 too many requests".to_string(),
            })
        } else {
            Err(ModelError::Fatal {
                status: 401,
                message: "unauthorized".to_string(),
            })
        }
    }

    fn model_id(&self) -> &str {
        "mock/failing"
    }
}

// ---------------------------------------------------------------------------
// The full loop, end to end against the scripted mock
// ---------------------------------------------------------------------------

/// Driving the default mock through `run` writes `index.html` to the real workspace
/// and emits a well-formed, ordered telemetry stream that terminates.
#[tokio::test]
async fn run_drives_the_mock_end_to_end_and_writes_the_file() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-e2e".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    let outcome = run(&inv, &emitter).await;
    assert_eq!(outcome, SessionOutcome::Ran);

    // (a) the scripted write_file call actually created the file on disk.
    assert!(
        dir.path().join("index.html").exists(),
        "the mock's write_file call should have created index.html"
    );

    let events = sink.events();

    // (b) the stream is well-formed and ordered: SessionStarted first, a
    // write_file ToolCall before its successful ToolResult, and SessionEnded last.
    assert!(matches!(
        events.first().unwrap().kind,
        GgTelemetryKind::SessionStarted {}
    ));
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));

    let first_turn = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .expect("a turn started");
    let call = events
        .iter()
        .position(
            |e| matches!(&e.kind, GgTelemetryKind::ToolCall { name, .. } if name == "write_file"),
        )
        .expect("a write_file tool call");
    let result = events
        .iter()
        .position(|e| {
            matches!(&e.kind, GgTelemetryKind::ToolResult { name, ok, .. } if name == "write_file" && *ok)
        })
        .expect("a successful write_file result");
    assert!(first_turn < call, "the turn starts before the tool call");
    assert!(call < result, "the tool call precedes its result");

    // Usage was reported and every event is stamped with the session id.
    assert!(
        events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::Usage { .. }))
    );
    assert!(
        events
            .iter()
            .all(|e| e.session_id.as_deref() == Some("run-e2e"))
    );

    // (c) the loop terminated: exactly one SessionEnded, and it is the final event.
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e.kind, GgTelemetryKind::SessionEnded { .. }))
            .count(),
        1
    );
}

// ---------------------------------------------------------------------------
// Launch failures (exit non-zero)
// ---------------------------------------------------------------------------

/// With no `primary` slot bound there is no model to run: the session ends with
/// `error` and reports a launch failure.
#[tokio::test]
async fn run_reports_launch_failure_when_no_slot_is_bound() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-x".to_string()), Box::new(sink.clone()));
    // The default set carries the Phase 0 capabilities but binds no slot.
    let inv = invocation(dir.path(), GgCapabilitySet::default());

    let outcome = run(&inv, &emitter).await;
    assert_eq!(outcome, SessionOutcome::LaunchFailed);

    let events = sink.events();
    assert!(matches!(
        events.first().unwrap().kind,
        GgTelemetryKind::SessionStarted {}
    ));
    assert!(
        events
            .iter()
            .any(|e| matches!(&e.kind, GgTelemetryKind::Log { level, .. } if level == "error"))
    );
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "error"
    ));
}

// ---------------------------------------------------------------------------
// Termination conditions of the driven loop
// ---------------------------------------------------------------------------

/// A model that never stops calling tools ends by hitting the turn ceiling.
#[tokio::test]
async fn drive_exhausts_the_turn_ceiling_when_the_model_never_stops() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let registry = ToolRegistry::from_capabilities(&GgCapabilitySet::minimal("mock/loop"));
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));

    let never_stops = MockClient::new("mock/loop", vec![looping_response(); 5]);
    let end = drive(
        &never_stops,
        "go",
        &registry,
        &ctx,
        &emitter,
        2,
        None,
        test_context_setup(false),
    )
    .await;

    assert_eq!(end.status, "exhausted");
    assert_eq!(end.turns, 2);
    // Two turns were actually run.
    assert_eq!(
        sink.events()
            .iter()
            .filter(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
            .count(),
        2
    );
}

/// A deadline already in the past ends the loop with `timed_out` before any model
/// call is made.
#[tokio::test]
async fn drive_times_out_at_a_passed_deadline() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let registry = ToolRegistry::from_capabilities(&GgCapabilitySet::minimal("mock/loop"));
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));

    let client = MockClient::with_default_script("mock/echo");
    let end = drive(
        &client,
        "go",
        &registry,
        &ctx,
        &emitter,
        50,
        Some(Instant::now()),
        test_context_setup(false),
    )
    .await;

    assert_eq!(end.status, "timed_out");
    assert_eq!(end.turns, 0);
    // No model turn ran.
    assert!(
        !sink
            .events()
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
    );
}

/// A fatal model turn ends the session loudly — an `error` log plus a `model_error`
/// status — not silently.
#[tokio::test]
async fn drive_ends_model_error_loudly_on_a_fatal_turn() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let registry = ToolRegistry::from_capabilities(&GgCapabilitySet::minimal("mock/x"));
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));

    let client = FailingClient { retryable: false };
    let end = drive(
        &client,
        "go",
        &registry,
        &ctx,
        &emitter,
        5,
        None,
        test_context_setup(false),
    )
    .await;

    assert_eq!(end.status, "model_error");
    assert_eq!(end.turns, 0);
    assert!(
        sink.events()
            .iter()
            .any(|e| matches!(&e.kind, GgTelemetryKind::Log { level, .. } if level == "error")),
        "a fatal turn must be logged at error level, not swallowed"
    );
}

/// A retry-exhausted transient failure ends the same way — the client already
/// exhausted its own retries, so the loop ends the session rather than discarding it.
#[tokio::test]
async fn drive_ends_model_error_on_exhausted_retries() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let registry = ToolRegistry::from_capabilities(&GgCapabilitySet::minimal("mock/x"));
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));

    let client = FailingClient { retryable: true };
    let end = drive(
        &client,
        "go",
        &registry,
        &ctx,
        &emitter,
        5,
        None,
        test_context_setup(false),
    )
    .await;

    assert_eq!(end.status, "model_error");
    assert!(
        sink.events()
            .iter()
            .any(|e| matches!(&e.kind, GgTelemetryKind::Log { level, .. } if level == "error"))
    );
}

// ---------------------------------------------------------------------------
// Bounds, prompt, and accounting helpers
// ---------------------------------------------------------------------------

/// Bounds come from capability params when present, else the defaults; a zero turn
/// count is ignored.
#[test]
fn resolve_bounds_reads_params_or_defaults() {
    let default = resolve_bounds(&GgCapabilitySet::minimal("mock/x"));
    assert_eq!(default.max_turns, DEFAULT_MAX_TURNS);
    assert_eq!(default.max_runtime_secs, None);

    let mut set = GgCapabilitySet::minimal("mock/x");
    set.capabilities[0].params = json!({ "maxTurns": 7, "maxRuntimeSecs": 30 });
    let tuned = resolve_bounds(&set);
    assert_eq!(tuned.max_turns, 7);
    assert_eq!(tuned.max_runtime_secs, Some(30));

    set.capabilities[0].params = json!({ "maxTurns": 0 });
    assert_eq!(resolve_bounds(&set).max_turns, DEFAULT_MAX_TURNS);
}

/// The system prompt lists the enabled tools, and notes when none are available.
#[test]
fn system_prompt_reflects_the_offered_tools() {
    let full = system_prompt(&ToolRegistry::from_capabilities(&GgCapabilitySet::minimal(
        "mock/x",
    )));
    assert!(full.contains("write_file"));
    assert!(full.contains("shell"));

    let empty_set = GgCapabilitySet {
        preset: None,
        capabilities: Vec::new(),
        slots: Vec::new(),
    };
    let empty = system_prompt(&ToolRegistry::from_capabilities(&empty_set));
    assert!(empty.contains("no tools"));
}

/// Running totals sum reported classes and keep a class unknown only when neither
/// side reported it.
#[test]
fn add_counts_sums_reported_classes() {
    let a = TokenCounts {
        uncached_input: Some(10),
        cached_input: None,
        output: Some(5),
        reasoning: None,
    };
    let b = TokenCounts {
        uncached_input: Some(3),
        cached_input: Some(2),
        output: None,
        reasoning: None,
    };
    let sum = add_counts(a, b);
    assert_eq!(sum.uncached_input, Some(13));
    assert_eq!(sum.cached_input, Some(2));
    assert_eq!(sum.output, Some(5));
    assert_eq!(sum.reasoning, None);
}

/// Costs accumulate, and an absent side is treated as the other.
#[test]
fn add_cost_accumulates_optionally() {
    assert_eq!(add_cost(None, None), None);
    let one = Some(Cost {
        comparable: Some(0.01),
        actual: Some(0.01),
    });
    assert_eq!(add_cost(None, one), one);
    let summed = add_cost(one, one).unwrap();
    assert_eq!(summed.comparable, Some(0.02));
    assert_eq!(summed.actual, Some(0.02));
}

// ---------------------------------------------------------------------------
// Context visibility: the per-turn breakdown and its gating
// ---------------------------------------------------------------------------

/// `minimal`, but with the context-visibility capability disabled (kept present so the
/// ablation's off arm records what it turned off).
fn minimal_without_context_visibility(model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    for cap in &mut set.capabilities {
        if cap.id == CAPABILITY_CONTEXT_VISIBILITY {
            cap.enabled = false;
        }
    }
    set
}

/// With context visibility on (the default), the loop emits a `ContextBreakdown` each
/// turn — after the turn starts and before the turn's tool call — accounting the window
/// by source with a total, a window limit, and a fullness ratio.
#[tokio::test]
async fn run_emits_context_breakdown_each_turn_when_visibility_enabled() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cv".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    let breakdowns: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown {
                by_source,
                total_tokens,
                window_limit,
                fullness,
            } => Some((by_source, *total_tokens, *window_limit, *fullness)),
            _ => None,
        })
        .collect();

    // The default mock scripts two turns; a breakdown is emitted at the top of each.
    assert!(
        !breakdowns.is_empty(),
        "context visibility on should emit a breakdown per turn"
    );
    let turns = events
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .count();
    assert_eq!(breakdowns.len(), turns, "one breakdown per turn");

    let (by_source, total, window_limit, fullness) = &breakdowns[0];
    // A stable band per source, in ALL order, present even at zero.
    assert_eq!(by_source.len(), GgContextSource::ALL.len());
    for (band, &source) in by_source.iter().zip(GgContextSource::ALL.iter()) {
        assert_eq!(band.source, source);
    }
    // The pinned system + user prompt are in the window from the first turn.
    let tokens_for = |source: GgContextSource| {
        by_source
            .iter()
            .find(|b| b.source == source)
            .map(|b| b.tokens)
            .unwrap()
    };
    assert!(tokens_for(GgContextSource::System) > 0);
    assert!(tokens_for(GgContextSource::UserPrompt) > 0);
    assert!(*total > 0);
    assert_eq!(
        *total,
        by_source.iter().map(|b| b.tokens).sum::<u64>(),
        "the total equals the sum of the bands"
    );
    // An unrecognized model id falls back to the default window; fullness follows.
    assert_eq!(*window_limit, Some(DEFAULT_CONTEXT_WINDOW));
    let f = fullness.expect("fullness is known when the window is");
    assert!(f > 0.0 && f < 1.0);

    // Ordering: the first breakdown sits after the first TurnStarted and before the
    // write_file tool call it accounted for.
    let first_turn = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .unwrap();
    let first_breakdown = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::ContextBreakdown { .. }))
        .unwrap();
    let first_call = events
        .iter()
        .position(|e| matches!(&e.kind, GgTelemetryKind::ToolCall { .. }))
        .unwrap();
    assert!(first_turn < first_breakdown && first_breakdown < first_call);
}

/// With context visibility off, no `ContextBreakdown` is emitted — but the run is
/// otherwise unchanged (the accounting is still computed internally; only the telemetry
/// is gated), so the file is still produced and the session completes.
#[tokio::test]
async fn run_omits_context_breakdown_when_visibility_disabled() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-nocv".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), minimal_without_context_visibility("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::ContextBreakdown { .. })),
        "context visibility off must not emit any breakdown"
    );
    // The rest of the run is intact.
    assert!(dir.path().join("index.html").exists());
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// The window limit prefers an explicit capability param, then the built-in per-model
/// table, then the default.
#[test]
fn resolve_window_limit_prefers_param_then_table_then_default() {
    // An explicit param on the context-visibility capability wins over the table.
    let mut set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    for cap in &mut set.capabilities {
        if cap.id == CAPABILITY_CONTEXT_VISIBILITY {
            cap.params = json!({ "windowLimit": 42_000 });
        }
    }
    assert_eq!(
        resolve_window_limit(&set, "anthropic/claude-opus-4.8"),
        Some(42_000)
    );

    // No param: the built-in table resolves by a model-id substring.
    let set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    assert_eq!(
        resolve_window_limit(&set, "anthropic/claude-opus-4.8"),
        Some(200_000)
    );

    // An unrecognized id (and a zero param, which is ignored) falls back to the default.
    assert_eq!(
        resolve_window_limit(&set, "mock/echo"),
        Some(DEFAULT_CONTEXT_WINDOW)
    );
}
