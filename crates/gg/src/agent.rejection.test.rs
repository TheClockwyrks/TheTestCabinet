//! The model-call **rejection loop** through the live session: a timed-out call and a
//! length-capped reply are recorded as error turns, kept out of the run's context and its
//! metrics, and retried **on the same turn** — bounded by the error ceilings and by nothing else.
//!
//! These hold the owner rulings from the killed five-model pong batch: a stalled provider must
//! cost the run one bounded error turn per stall rather than the whole run (or twenty hung
//! minutes), and a reply that hit the provider's output cap is presumed degenerate — recorded
//! with the spend it burned, excluded from the run's cost and turn count, and never shown to the
//! model's next turn.

use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;
use crate::model::Role;

/// A [`CodeSetup`] with responses-as-code on — the mode both rejections live in. Duplicated from
/// the sibling test files, which keep their helpers module-private on purpose.
fn code_on() -> CodeSetup {
    CodeSetup {
        enabled: true,
        language: GgProgramLanguage::TypeScript,
        limits: SandboxLimits::AMPLE,
        doc_view_types: crate::docs::DocViewTypes::RETURN_AND_ERRORS,
    }
}

/// A [`LimitsSetup`] over `declared`, resolved through the real resolver — see
/// `agent.limits.test.rs`, whose helper this mirrors.
fn setup_from(declared: GgRunLimits) -> LimitsSetup {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.limits = declared;
    let mut report = crate::validate::LaunchReport::collecting();
    let mut warnings = Vec::new();
    let limits = resolve_run_limits(&set, &mut report, &mut warnings);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unarmable ceiling: {defects:?}");
    assert!(warnings.is_empty(), "unusable declaration: {warnings:?}");
    LimitsSetup {
        limits,
        deadline: limits.max_runtime.map(|budget| Instant::now() + budget),
        spend: Arc::new(RunSpend::default()),
        cancel: CancelWatch::disabled(),
        fault: FaultLatch::default(),
        ceiling: CeilingLatch::default(),
    }
}

/// How many turns the loop actually started.
fn turns_started(events: &[GgTelemetryEvent]) -> usize {
    events
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .count()
}

/// The status the stream's terminal `SessionEnded` reports.
fn ended_with(events: &[GgTelemetryEvent]) -> String {
    match &events.last().expect("a terminal event").kind {
        GgTelemetryKind::SessionEnded { status } => status.clone(),
        other => panic!("the stream must end with SessionEnded, got {other:?}"),
    }
}

/// A distinctive truncated reply, standing in for the 222k-character degenerate generation the
/// provider cut at its output cap. If any request ever carries this marker, the rejected reply
/// leaked into the context.
const CAPPED_MARKER: &str = "const DEGENERATE_REPEATED_LINE = 0;";

/// The reply the provider cut at its output cap: `finish_reason: length`, with the usage and cost
/// the provider billed for it and the provider's own name — everything the rejection must record
/// and the run's metrics must exclude.
fn length_capped_reply() -> ModelResponse {
    ModelResponse {
        text: Some(CAPPED_MARKER.repeat(40)),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Length,
        usage: TokenCounts {
            uncached_input: Some(54_000),
            cached_input: Some(2_000),
            output: Some(65_000),
            reasoning: Some(536),
        },
        cost: Some(Cost {
            comparable: Some(1.25),
            actual: Some(1.25),
        }),
        provider: Some("cap-provider".to_string()),
        loop_aborts: LoopAborts::none(),
        usage_wire: None,
        usage_reconciled: false,
    }
}

/// The finishing program with real usage on it, so the run has exactly one accountable turn: its
/// spend is what the run's own metrics must show once the rejected call's is excluded, and its
/// completion tokens (output plus reasoning) are the maximum the summary must report.
fn finishing_reply_with_usage() -> ModelResponse {
    ModelResponse {
        usage: TokenCounts {
            uncached_input: Some(900),
            cached_input: None,
            output: Some(42),
            reasoning: Some(8),
        },
        cost: Some(Cost {
            comparable: Some(0.01),
            actual: Some(0.01),
        }),
        provider: Some("good-provider".to_string()),
        ..code_reply(FINISHING_PROGRAM)
    }
}

/// One [`ResponseRejected`](GgTelemetryKind::ResponseRejected) event's payload, as its
/// assertions read it.
type RejectedEvent = (String, u64, TokenCounts, Option<Cost>, Option<String>);

/// Every [`ResponseRejected`](GgTelemetryKind::ResponseRejected) event on the stream, as
/// `(reason, chars, tokens, cost, provider)`.
fn rejected_events(events: &[GgTelemetryEvent]) -> Vec<RejectedEvent> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ResponseRejected {
                reason,
                chars,
                tokens,
                cost,
                provider,
            } => Some((reason.clone(), *chars, *tokens, *cost, provider.clone())),
            _ => None,
        })
        .collect()
}

/// Every turn-outcome error on the stream, as `(error type, consecutive count)`.
fn turn_error_types(events: &[GgTelemetryEvent]) -> Vec<(GgTurnErrorType, u64)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::TurnOutcome {
                error_type: Some(error_type),
                consecutive_errors,
                ..
            } => Some((*error_type, *consecutive_errors)),
            _ => None,
        })
        .collect()
}

/// A request's messages with gg's **trailing slots** — the context-usage signal and the contract
/// notice, the only trailing `system`-role messages a window renders — stripped, leaving the
/// append-only conversation the prompt cache reads.
fn without_trailing_slots(messages: &[Message]) -> &[Message] {
    let mut end = messages.len();
    while end > 1 && messages[end - 1].role == Role::System {
        end -= 1;
    }
    &messages[..end]
}

/// A reply that hit the provider's cap is rejected whole: it is recorded — a dedicated event with
/// the spend it burned, an error turn against the ceilings, the exchange in the message log — and
/// it reaches nothing else. Not the context (the retry's request is byte-identical), not the
/// run's usage (no `Usage` delta, no slot cost), and not the turn count (the retry reuses the
/// turn). The session then simply carries on.
#[tokio::test]
async fn a_length_capped_reply_is_rejected_recorded_and_retried_on_the_same_turn() {
    let dir = TempDir::new().unwrap();
    let capped = length_capped_reply();
    let capped_chars = capped.text.as_deref().unwrap().chars().count() as u64;
    let (outcome, events, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![capped, finishing_reply_with_usage()],
    )
    .await;

    // The run survived its degenerate reply and finished on the retry.
    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(ended_with(&events), "completed");

    // (c) the rejected reply never entered the context: the retry's request is byte-identical to
    // the rejected attempt's, and no request anywhere carries the truncated text.
    assert_eq!(requests.len(), 2, "one rejected attempt, one retry");
    assert_eq!(
        requests[0], requests[1],
        "nothing entered the context between the rejection and the retry"
    );
    assert!(
        !requests.iter().flatten().any(|message| message
            .content
            .as_deref()
            .is_some_and(|content| content.contains(CAPPED_MARKER))),
        "the rejected reply reached a later request"
    );

    // The retry reused the turn: one turn started, two outcomes recorded on it.
    assert_eq!(turns_started(&events), 1);
    assert_eq!(
        turn_error_types(&events),
        vec![(GgTurnErrorType::ModelLengthCapped, 1)],
        "the rejection is an error turn, spending the consecutive count"
    );

    // (a) the dedicated record: what came back, what it cost, and who served it.
    let rejected = rejected_events(&events);
    assert_eq!(rejected.len(), 1);
    let (reason, chars, tokens, cost, provider) = &rejected[0];
    assert_eq!(reason, "length");
    assert_eq!(*chars, capped_chars);
    assert_eq!(tokens.output, Some(65_000));
    assert_eq!(tokens.uncached_input, Some(54_000));
    assert_eq!(cost.and_then(|cost| cost.actual), Some(1.25));
    assert_eq!(provider.as_deref(), Some("cap-provider"));

    // (b) the run's own usage excludes the rejected call entirely: the only `Usage` delta is the
    // finishing turn's, attributed to the provider that served it.
    let usage: Vec<(TokenCounts, Option<String>)> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Usage {
                tokens, provider, ..
            } => Some((*tokens, provider.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(usage.len(), 1, "the rejected call emits no usage delta");
    assert_eq!(usage[0].0.output, Some(42));
    assert_eq!(usage[0].1.as_deref(), Some("good-provider"));

    // The message log still holds the rejected exchange — the record the owner reads a degenerate
    // reply out of — as a `Prompt` whose finish reason is the provider's own `length`.
    let finishes: Vec<(String, Option<String>)> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Prompt {
                finish_reason,
                provider,
                ..
            } => Some((finish_reason.clone(), provider.clone())),
            _ => None,
        })
        .collect();
    assert!(
        finishes
            .iter()
            .any(|(finish, provider)| finish == "length"
                && provider.as_deref() == Some("cap-provider")),
        "the rejected exchange is on the message log: {finishes:?}"
    );

    // The durable summary: the rejected bucket carries the excluded spend, the error rollup names
    // the type, and the run's cost/turn figures show only the turn that worked.
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.rejected_responses.count, 1);
    assert_eq!(summary.rejected_responses.tokens.output, Some(65_000));
    assert_eq!(
        summary.rejected_responses.cost.and_then(|cost| cost.actual),
        Some(1.25)
    );
    assert_eq!(summary.errors.errors, 1);
    assert_eq!(summary.errors.by_type.get("model_length_capped"), Some(&1));
    assert_eq!(
        summary.errors.turns, 2,
        "the error rollup's denominator counts model calls, the rejected one included"
    );
    // (item 6b) the maxima skip the length-capped turn, which the emitter records with no size at
    // all: what is left is the finishing program's characters, and its completion tokens as output
    // plus reasoning, never the rejected reply's 65k.
    assert_eq!(
        summary.max_response_chars,
        FINISHING_PROGRAM.chars().count() as u64
    );
    assert_eq!(summary.max_response_output_tokens, 42 + 8);
    // The per-slot rollup excludes the rejected call too.
    assert_eq!(summary.slot_costs.len(), 1);
    assert_eq!(summary.slot_costs[0].tokens.output, Some(42));
    assert_eq!(
        summary.slot_costs[0].cost.and_then(|cost| cost.actual),
        Some(0.01)
    );
}

/// (d) a model that only ever answers at the cap is stopped by the **error ceilings**, exactly as
/// a model whose calls keep failing is — otherwise a looping model would retry unbounded, burning
/// a full capped generation per attempt. The run ends `limit_exceeded` on the ceiling's own
/// terms, never `model_error`, and the turn count shows the rejected attempts never became turns.
#[tokio::test]
async fn length_capped_replies_alone_stop_the_run_on_the_error_ceilings() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cap".to_string()), Box::new(sink.clone()));
    let mut set = code_set("mock/primary", json!({}));
    set.limits = GgRunLimits {
        max_turns: Some(20),
        max_consecutive_errors: Some(2),
        ..GgRunLimits::authored()
    };
    let inv = invocation(dir.path(), set);
    let client = Arc::new(MockClient::new(
        "mock/primary",
        vec![
            length_capped_reply(),
            length_capped_reply(),
            length_capped_reply(),
        ],
    ));
    let shared = Arc::clone(&client);
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |_| {
        Box::new(SharedMockClient(Arc::clone(&shared)))
    });

    let outcome = run_with_factory(&inv, &emitter, Arc::new(factory)).await;
    let events = sink.events();

    assert_eq!(outcome, SessionOutcome::LimitExceeded);
    assert!(matches!(
        &events.last().expect("a terminal event").kind,
        GgTelemetryKind::SessionEnded { status } if status == "limit_exceeded"
    ));
    // The liveness proof: the ceiling of two stopped the loop after exactly two capped replies.
    assert_eq!(client.turns_taken(), 2);
    // Both rejections happened inside one never-completed turn — the retry reuses the turn.
    assert_eq!(turns_started(&events), 1);
    let breaches = limit_breaches(&events);
    assert_eq!(breaches.len(), 1);
    assert_eq!(breaches[0].limit, GgLimitKind::ConsecutiveErrors);
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.rejected_responses.count, 2);
    assert_eq!(summary.errors.by_type.get("model_length_capped"), Some(&2));
}

/// A client whose first `n` calls time out — the shape of a stalled provider endpoint the
/// [per-call ceiling](crate::limits::RunLimits::model_call_timeout) cuts off — and which then answers from
/// its inner script. The error is exactly what the [`OpenRouterClient`](crate::client) surfaces
/// for a stall, provider and all.
struct StalledThenScripted {
    timeouts: AtomicUsize,
    inner: MockClient,
}

impl StalledThenScripted {
    fn new(timeouts: usize, script: Vec<ModelResponse>) -> Self {
        Self {
            timeouts: AtomicUsize::new(timeouts),
            inner: MockClient::new("mock/primary", script),
        }
    }
}

#[async_trait::async_trait]
impl ModelClient for StalledThenScripted {
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        if self
            .timeouts
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                left.checked_sub(1)
            })
            .is_ok()
        {
            return Err(ModelError::Timeout {
                after: crate::client::DEFAULT_MODEL_CALL_TIMEOUT,
                provider: Some("stalled-provider".to_string()),
            });
        }
        self.inner.complete(messages, tools).await
    }

    fn model_id(&self) -> &str {
        self.inner.model_id()
    }
}

/// (item 1) a timed-out model call is a logged **error turn** that the loop retries — it flows
/// through the same machinery as any failed call (error type, consecutive count, the summary's
/// rollup) and the session then finishes normally. The turn count excludes the attempt that never
/// produced a turn.
#[tokio::test]
async fn a_timed_out_model_call_is_an_error_turn_and_the_turn_is_retried() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    let client = StalledThenScripted::new(1, vec![code_reply(FINISHING_PROGRAM)]);

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(10),
            ..GgRunLimits::authored()
        }),
        code_on(),
    )
    .await;

    assert_eq!(end.status, "completed", "a timeout must not kill the run");
    assert_eq!(
        end.turns, 1,
        "the timed-out attempt is excluded from the turn count"
    );
    let events = sink.events();
    assert_eq!(
        turn_error_types(&events),
        vec![(GgTurnErrorType::ModelTimeout, 1)],
        "the timeout is recorded as an error turn against the ceilings"
    );
    // The operator's line says what happened, naming the provider. That the turn is retried is
    // what gg does about it rather than the failure, and is read off the turn record instead.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::Log { level, message }
                if level == "error"
                    && message.contains("timed out")
                    && message.contains("stalled-provider")
        )),
        "the timeout is a logged error naming the provider"
    );
}

/// (item 1) a provider that stalls forever ends the run **only** through the error ceilings — the
/// run dies `limit_exceeded` on the configured ceiling, never `model_error` on the timeout
/// itself, and having completed no turn at all.
#[tokio::test]
async fn timeouts_end_the_run_only_through_the_error_ceilings() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    let client = StalledThenScripted::new(usize::MAX, Vec::new());

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(10),
            max_consecutive_errors: Some(3),
            ..GgRunLimits::authored()
        }),
        code_on(),
    )
    .await;

    assert_eq!(end.status, "limit_exceeded");
    assert_eq!(end.turns, 0, "no turn ever completed");
    let breach = end.limit.expect("a breach");
    assert_eq!(breach.limit, GgLimitKind::ConsecutiveErrors);
    assert_eq!(breach.observed, 3.0);
    assert_eq!(
        turn_error_types(&sink.events())
            .into_iter()
            .map(|(error_type, _)| error_type)
            .collect::<Vec<_>>(),
        vec![GgTurnErrorType::ModelTimeout; 3],
        "each timed-out attempt spent the ceiling once"
    );
}

/// (item 3) gg's prompts are **append-only**. Driven across turns that open, re-open (supersede)
/// and text-view their way through the window — the shapes that retag items in place — each
/// request's conversation must be a strict prefix-extension of the one before it, with the
/// trailing slot (the context-usage signal, when it renders) re-rendered after the new tail.
#[tokio::test]
async fn every_request_extends_the_previous_one() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("a.ts"), "the first file").unwrap();
    std::fs::write(dir.path().join("b.ts"), "the second file").unwrap();

    let (outcome, _, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![
            code_reply(
                "import * as gg from \"gg\";\ngg.views.openFile(\"a.ts\");\n\
                 gg.views.openFile(\"b.ts\");",
            ),
            // Re-opening `a.ts` supersedes the earlier copy — the in-place retag whose whole
            // design is that the rendered prompt does not change behind its end.
            code_reply(
                "import * as gg from \"gg\";\ngg.views.openFile(\"a.ts\");\n\
                 gg.views.openText(\"progress\", \"read both files\");",
            ),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);
    assert!(requests.len() >= 3, "three model calls were made");

    // The append-only invariant: with the trailing slots stripped, every request's message list
    // extends the previous one — nothing is ever inserted or edited before the tail. (The one
    // documented in-place mutation, an image being stripped out of a superseded view, has no
    // image here to trigger on, so equality is exact.)
    for pair in requests.windows(2) {
        let previous = without_trailing_slots(&pair[0]);
        let next = without_trailing_slots(&pair[1]);
        assert!(
            next.len() > previous.len(),
            "each turn extends the window: {} -> {}",
            previous.len(),
            next.len()
        );
        for (index, (before, after)) in previous.iter().zip(next.iter()).enumerate() {
            assert_eq!(
                before, after,
                "message {index} changed between consecutive requests"
            );
        }
    }
}
