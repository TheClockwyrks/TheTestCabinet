//! The **in-loop** compaction strategies, driven through the live loop.
//!
//! `compaction.test.rs` proves the trigger arithmetic and the rewrite with no loop behind them, and
//! `compaction.strategies.test.rs` proves how a strategy resolves and what it says. Neither can
//! prove the thing the three in-loop strategies actually are: a compaction that **spans a turn
//! boundary** — gg asks on one turn, the model answers on the next, and everything else is refused
//! in between. That only exists in [`Agent::drive`], so it is only testable here.
//!
//! Every test below drives the tool-calling path. It is the cheaper of the two modes (no component
//! compile) and it exercises the same loop state, the same gate and the same rewrite; the code
//! path's own half — a program's `context.compact` reaching the api — is held by the membrane and
//! sandbox suites.

use super::*;

/// A window small enough that the ballooned turn below crosses any threshold these tests set,
/// while the pinned prefix alone stays under it.
const NARROW_WINDOW: u64 = 4_000;

/// Drive `script` under `compaction` against a fresh workspace, returning the loop's end and the
/// emitted stream. The runtimes are the compaction suite's (a one-skill library, a memory store and
/// a task store, all bound into the toolset) so a boundary has real pinned state to retain.
async fn drive_compaction(
    dir: &TempDir,
    script: Vec<ModelResponse>,
    compaction: CompactionSetup,
) -> (LoopEnd, Vec<GgTelemetryEvent>) {
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-compact".to_string()), Box::new(sink.clone()));
    let (registry, skills, memories, tasks) = compaction_runtimes(dir.path());
    let client = MockClient::new("mock/echo", script);

    let end = Agent::root(ROOT_AGENT)
        .drive(
            &client,
            "go",
            &registry,
            &ctx,
            &emitter,
            &mut test_modules(
                test_context_setup_with_window(NARROW_WINDOW),
                no_code().enabled,
            )
            .with(ModuleHandle::Skills(skills))
            .with(ModuleHandle::Memories(memories))
            .with(ModuleHandle::Tasks(tasks))
            .with(ModuleHandle::Board(BoardRuntime::disabled())),
            DriveSetup {
                limits: no_limits(12),
                compaction,
                amc: no_amc(),
                autoload: no_autoload(),
                persistence: no_persistence(),
                read_policy: Some(ReadPolicy::Unlimited),
                shell_offload: OffloadPolicy::ample(),
                code: no_code(),
                discovery: DiscoveryWarning::default(),
                hooks: no_hooks(),
                ending_role: EndingRole::Standard,
                opening: Opening::Fresh,
                carried_programs: None,
                turn_base: 0,
                replay: None,
            },
            &[],
            &GgAgentConfig::root(),
            &GgCapabilitySet {
                agents: vec![GgAgentConfig::root()],
                ..GgCapabilitySet::default()
            },
            &mut None,
            None,
        )
        .await;
    (end, sink.events())
}

/// The `Compaction` events on a stream, as `(strategy, summary, fallback)`.
fn boundaries(events: &[GgTelemetryEvent]) -> Vec<(String, String, bool)> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::Compaction {
                strategy,
                summary,
                summary_fallback,
                ..
            } => Some((strategy.clone(), summary.clone(), *summary_fallback)),
            _ => None,
        })
        .collect()
}

/// Every `ToolResult` on a stream, as `(name, ok)`.
fn tool_results(events: &[GgTelemetryEvent]) -> Vec<(String, bool)> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::ToolResult { name, ok, .. } => Some((name.clone(), *ok)),
            _ => None,
        })
        .collect()
}

/// A prose reply with no tool call — under an ordinary run this ends the loop, and under a pending
/// self-summarization it is the summary instead. That difference is the whole of the strategy.
fn prose_reply(text: &str) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
        usage_wire: None,
        usage_reconciled: false,
    }
}

// ---------------------------------------------------------------------------
// self-summarization
// ---------------------------------------------------------------------------

/// The agent is asked for a summary in its own thread, and its next reply — plain prose, which
/// would otherwise **end the run** — becomes the summary the thread restarts from instead.
#[tokio::test]
async fn self_summarization_restarts_the_thread_from_the_models_own_reply() {
    const SUMMARY: &str = "I scaffolded index.html and a canvas loop; next is input handling.";
    let dir = TempDir::new().unwrap();
    let mut script = compaction_script();
    // The ballooning turn is the second-to-last of `compaction_script`; the stop response that
    // follows it is what the pending compaction claims as the summary. Another balloon-free turn
    // then proves the run carried on afterwards rather than ending on the summary.
    script.pop();
    script.push(prose_reply(SUMMARY));
    script.push(stop_response());

    let (end, events) = drive_compaction(
        &dir,
        script,
        compaction_with(CompactionStrategy::SelfSummarization, 0.6),
    )
    .await;

    assert_eq!(
        end.status, "completed",
        "the run continued past the boundary"
    );
    let boundaries = boundaries(&events);
    assert_eq!(boundaries.len(), 1, "exactly one boundary");
    assert_eq!(boundaries[0].0, "self-summarization");
    assert!(
        boundaries[0].1.contains(SUMMARY),
        "the model's own words are the summary, got {:?}",
        boundaries[0].1
    );
    assert!(!boundaries[0].2, "a real summary is not a fallback");
}

/// A model that answers the summary request with nothing usable still gets compacted — the window
/// is full either way, and a run that declined to compact would overflow on its next turn. The
/// fallback note is recorded as one so a study reads it as the failure it is.
#[tokio::test]
async fn self_summarization_falls_back_when_the_reply_is_empty() {
    let dir = TempDir::new().unwrap();
    let mut script = compaction_script();
    script.pop();
    script.push(ModelResponse {
        text: None,
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: TokenCounts::default(),
        cost: None,
        provider: None,
        loop_aborts: LoopAborts::none(),
        usage_wire: None,
        usage_reconciled: false,
    });
    script.push(stop_response());

    let (_, events) = drive_compaction(
        &dir,
        script,
        compaction_with(CompactionStrategy::SelfSummarization, 0.6),
    )
    .await;

    let boundaries = boundaries(&events);
    assert_eq!(boundaries.len(), 1, "the compaction still happened");
    assert!(boundaries[0].2, "it is recorded as a fallback");
}

// ---------------------------------------------------------------------------
// self-compaction
// ---------------------------------------------------------------------------

/// The agent compacts itself through the `compact` tool: until it calls it every other tool is
/// refused, and the call carries both the summary the thread restarts from and the file gg re-reads
/// back into the restarted window.
#[tokio::test]
async fn self_compaction_refuses_everything_until_compact_is_called() {
    const SUMMARY: &str = "the canvas loop is up; next is collision.";
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("main.ts"), "export const KEPT_FILE = 1;").unwrap();

    let mut script = compaction_script();
    script.pop();
    // The turn after the compaction is asked for reaches for an ordinary tool, which must be
    // refused; the one after that complies.
    script.push(tool_call_response(
        "c_ls2",
        "list_dir",
        json!({ "path": "." }),
    ));
    script.push(tool_call_response(
        "c_compact",
        "compact",
        json!({ "summary": SUMMARY, "files": ["main.ts"] }),
    ));
    script.push(stop_response());

    let (end, events) = drive_compaction(
        &dir,
        script,
        compaction_with(CompactionStrategy::SelfCompaction, 0.6),
    )
    .await;
    assert_eq!(end.status, "completed");

    // The `list_dir` reached for while the compaction was pending was refused, and the `compact`
    // that followed was accepted.
    let results = tool_results(&events);
    assert!(
        results.contains(&("list_dir".to_string(), false)),
        "a call made during a pending compaction is refused, got {results:?}"
    );
    assert!(
        results.contains(&("compact".to_string(), true)),
        "the compact call was accepted, got {results:?}"
    );

    let boundaries = boundaries(&events);
    assert_eq!(boundaries.len(), 1);
    assert_eq!(boundaries[0].0, "self-compaction");
    assert!(boundaries[0].1.contains(SUMMARY));

    // The file the model asked to keep was re-read into the restarted window, which the file-view
    // band being non-zero *after* the boundary is the proof of — every other file view was dropped.
    let after = events
        .iter()
        .skip_while(|event| !matches!(event.kind, GgTelemetryKind::Compaction { .. }))
        .find_map(|event| match &event.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(by_source.clone()),
            _ => None,
        })
        .expect("a breakdown follows the boundary");
    let file_views = after
        .iter()
        .find(|band| band.source == GgContextSource::FileView)
        .map(|band| band.tokens)
        .unwrap_or(0);
    assert!(
        file_views > 0,
        "the re-read file is in the restarted window, got {after:?}"
    );
}

/// A malformed `compact` is not a compaction: the call is refused with the usage error, the
/// compaction stays pending, and the next turn is asked again — so a model that fumbles the
/// arguments once is not left in a window it can never reclaim.
#[tokio::test]
async fn a_malformed_compact_leaves_the_compaction_pending() {
    let dir = TempDir::new().unwrap();
    let mut script = compaction_script();
    script.pop();
    script.push(tool_call_response(
        "c_bad",
        "compact",
        json!({ "files": [] }),
    ));
    script.push(tool_call_response(
        "c_good",
        "compact",
        json!({ "summary": "recovered" }),
    ));
    script.push(stop_response());

    let (_, events) = drive_compaction(
        &dir,
        script,
        compaction_with(CompactionStrategy::SelfCompaction, 0.6),
    )
    .await;

    let results = tool_results(&events);
    assert!(
        results.contains(&("compact".to_string(), false)),
        "the malformed call failed, got {results:?}"
    );
    let boundaries = boundaries(&events);
    assert_eq!(boundaries.len(), 1, "the retry compacted");
    assert!(boundaries[0].1.contains("recovered"));
}

// ---------------------------------------------------------------------------
// memory-compaction
// ---------------------------------------------------------------------------

/// The agent carries its working state across the boundary as **memories** rather than a summary:
/// only memory calls are accepted, and the compaction lands once one whole reply's calls succeed.
#[tokio::test]
async fn memory_compaction_lands_once_a_whole_reply_of_memory_writes_succeeds() {
    let dir = TempDir::new().unwrap();
    let mut script = compaction_script();
    script.pop();
    // A non-memory call first, which must be refused and must not satisfy the compaction.
    script.push(tool_call_response(
        "c_ls3",
        "list_dir",
        json!({ "path": "." }),
    ));
    script.push(write_memory_call(
        "c_mem2",
        "state",
        "the canvas loop is up; next is collision",
    ));
    script.push(stop_response());

    let (end, events) = drive_compaction(
        &dir,
        script,
        compaction_with(CompactionStrategy::Memory, 0.6),
    )
    .await;
    assert_eq!(end.status, "completed");

    let results = tool_results(&events);
    assert!(
        results.contains(&("list_dir".to_string(), false)),
        "a non-memory call is refused while a memory compaction is pending, got {results:?}"
    );
    assert!(results.contains(&("write_memory".to_string(), true)));

    let boundaries = boundaries(&events);
    assert_eq!(boundaries.len(), 1);
    assert_eq!(boundaries[0].0, "memory-compaction");
    assert!(
        boundaries[0].1.contains("Session compaction completed"),
        "the thread restarts from a bare note that a boundary was crossed, got {:?}",
        boundaries[0].1
    );
    assert!(!boundaries[0].2, "a memory compaction is not a fallback");

    // The memories the model wrote are what crossed the boundary — the band is still accounted
    // after the drop.
    let after = events
        .iter()
        .skip_while(|event| !matches!(event.kind, GgTelemetryKind::Compaction { .. }))
        .find_map(|event| match &event.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(by_source.clone()),
            _ => None,
        })
        .expect("a breakdown follows the boundary");
    let memories = after
        .iter()
        .find(|band| band.source == GgContextSource::Memory)
        .map(|band| band.tokens)
        .unwrap_or(0);
    assert!(memories > 0, "the memories survived the boundary");
}

// ---------------------------------------------------------------------------
// The handoff strategies, out of band
// ---------------------------------------------------------------------------

/// A handoff strategy never interrupts the agent: the boundary is crossed between turns, the
/// scripted client's cursor is untouched (the mock answers a marked compaction request off-script),
/// and the run simply continues against a smaller window.
#[tokio::test]
async fn handoff_summarization_compacts_without_taking_a_turn_from_the_agent() {
    let dir = TempDir::new().unwrap();
    let (end, events) = drive_compaction(
        &dir,
        compaction_script(),
        compaction_with(CompactionStrategy::HandoffSummarization, 0.6),
    )
    .await;
    assert_eq!(end.status, "completed");

    let boundaries = boundaries(&events);
    assert_eq!(boundaries.len(), 1);
    assert_eq!(boundaries[0].0, "handoff-summarization");
    assert_eq!(boundaries[0].1, crate::client::MOCK_COMPACTION_SUMMARY);
    // No tool was refused: the agent was never asked to do anything, which is the difference
    // between a handoff and the three in-loop strategies.
    assert!(
        tool_results(&events).iter().all(|(_, ok)| *ok),
        "a handoff refuses none of the agent's calls"
    );
}

/// Handoff **compaction** is answered with a `compact` call rather than prose, and the summary it
/// carries is what the thread restarts from. The working model is never offered the tool.
#[tokio::test]
async fn handoff_compaction_reads_the_compaction_models_compact_call() {
    let dir = TempDir::new().unwrap();
    let (end, events) = drive_compaction(
        &dir,
        compaction_script(),
        compaction_with(CompactionStrategy::HandoffCompaction, 0.6),
    )
    .await;
    assert_eq!(end.status, "completed");

    let boundaries = boundaries(&events);
    assert_eq!(boundaries.len(), 1);
    assert_eq!(boundaries[0].0, "handoff-compaction");
    assert_eq!(boundaries[0].1, crate::client::MOCK_COMPACTION_SUMMARY);
    assert!(
        !tool_results(&events)
            .iter()
            .any(|(name, _)| name == "compact"),
        "the working model never calls `compact` under a handoff"
    );
}

/// A factory that builds every client but the **compaction** one.
///
/// The only honest way to reach the handoff's failure arm: the model id is one of the set's bound
/// models, so the launch pass has already proved the catalog knows it, and what is left is a
/// credential or a provider that will not answer at run time.
struct NoCompactionClient;

impl ClientFactory for NoCompactionClient {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        if binding.slot == COMPACTION_SLOT {
            return Err(ModelError::Fatal {
                status: 500,
                message: "the compaction provider could not be built".to_string(),
            });
        }
        Ok(Box::new(MockClient::new(
            &binding.model_id,
            vec![stop_response()],
        )))
    }
}

/// **A handoff model that will not resolve ends the run.**
///
/// gg used to warn and leave the second client unset, after which `CompactionSetup::client` handed
/// back the agent's *own* client: the run then condensed on the working model while its capability
/// set, its record and its per-slot cost split all named the handoff arm — and "which model
/// condensed the thread" is the entire question a handoff study asks. There is no answer here that
/// is the run that was configured, so there is no answer: the agent's loop ends, and the run with
/// it, under gg's own status.
#[tokio::test]
async fn a_handoff_model_that_will_not_resolve_ends_the_run() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-handoff-unresolved".to_string()),
        Box::new(sink.clone()),
    );

    let mut set = GgCapabilitySet::minimal("mock/echo");
    crate::tools::grant_configured(
        &mut set.agents[0],
        GgCapabilityConfig {
            implementation: Some(
                test_cabinet_core::gg::COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION.to_string(),
            ),
            ..crate::tools::configured(
                CAPABILITY_COMPACTION,
                json!({ test_cabinet_core::gg::COMPACTION_PARAM_MODEL: "mock/compactor" }),
            )
        },
    );
    let inv = invocation(dir.path(), set);
    // The handoff model is one of the run's bound models, so the launch pass required — and got —
    // a context window for it. That is the static half of this failure, and it passed.
    assert!(inv.model_windows.contains_key("mock/compactor"));

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(NoCompactionClient)).await,
        SessionOutcome::HarnessError,
    );

    let events = sink.events();
    let terminal = events.iter().rev().find_map(|event| match &event.kind {
        GgTelemetryKind::SessionEnded { status } => Some(status.clone()),
        _ => None,
    });
    assert_eq!(
        terminal.as_deref(),
        Some(STATUS_INTERNAL_ERROR),
        "gg's defect, not the model's"
    );
    let errors: Vec<&String> = events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::Log { level, message } if level == "error" => Some(message),
            _ => None,
        })
        .collect();
    assert!(
        errors
            .iter()
            .any(|message| message.contains("mock/compactor")
                && message.contains("could not be resolved")),
        "the run says which model it could not reach: {errors:?}"
    );
    // No boundary was crossed on the working model, which is the substitution that used to happen.
    assert!(boundaries(&events).is_empty());
}

/// A factory that records every binding it builds a client for, and builds each a mock that stops.
struct BindingRecorder {
    seen: std::sync::Mutex<Vec<GgSlotBinding>>,
}

impl ClientFactory for BindingRecorder {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        self.seen
            .lock()
            .expect("binding lock")
            .push(binding.clone());
        Ok(Box::new(MockClient::new(
            &binding.model_id,
            vec![stop_response()],
        )))
    }
}

/// The agent's reasoning setting is tuned to the agent's own model, so it reaches that model's
/// client and not the client of a handoff summarizer bound to a second model, which runs at its
/// provider's default.
#[tokio::test]
async fn a_handoff_model_runs_without_the_agents_reasoning_setting() {
    use test_cabinet_core::gg::{GgReasoning, GgReasoningEffort};
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let emitter = Emitter::with_sink(
        Some("run-handoff-reasoning".to_string()),
        Box::new(CollectingSink::new()),
    );

    let mut set = GgCapabilitySet::minimal("mock/echo");
    let reasoning = GgReasoning {
        effort: Some(GgReasoningEffort::Low),
        max_tokens: None,
    };
    set.agents[0].reasoning = Some(reasoning);
    crate::tools::grant_configured(
        &mut set.agents[0],
        GgCapabilityConfig {
            implementation: Some(
                test_cabinet_core::gg::COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION.to_string(),
            ),
            ..crate::tools::configured(
                CAPABILITY_COMPACTION,
                json!({ test_cabinet_core::gg::COMPACTION_PARAM_MODEL: "mock/compactor" }),
            )
        },
    );
    let inv = invocation(dir.path(), set);
    let factory = Arc::new(BindingRecorder {
        seen: std::sync::Mutex::new(Vec::new()),
    });

    assert_eq!(
        run_with_factory(
            &inv,
            &emitter,
            Arc::clone(&factory) as Arc<dyn ClientFactory>
        )
        .await,
        SessionOutcome::Ran,
    );

    let seen = factory.seen.lock().expect("binding lock").clone();
    let own = seen
        .iter()
        .find(|binding| binding.slot == ROOT_PROFILE_ID)
        .expect("the agent's own client was built");
    assert_eq!(own.reasoning, Some(reasoning));
    let handoff = seen
        .iter()
        .find(|binding| binding.slot == COMPACTION_SLOT)
        .expect("the handoff client was built");
    assert_eq!(handoff.model_id, "mock/compactor");
    assert_eq!(handoff.reasoning, None);
}

// ---------------------------------------------------------------------------
// A compaction that cannot give the window back
// ---------------------------------------------------------------------------

/// A trigger so low that even the compacted window — the pinned prefix plus the summary — is over
/// it, which is what a compaction that reclaimed nothing looks like from the loop's side.
const UNREACHABLE_TRIGGER: f64 = 0.01;

/// The `error` lines on a stream.
fn errors(events: &[GgTelemetryEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::Log { level, message } if level == "error" => Some(message.clone()),
            _ => None,
        })
        .collect()
}

/// **An agent whose compaction cannot relieve its window is failed, not compacted round in
/// circles.**
///
/// With no retry allowance — which is what an absent `maxRetries` gives every configuration — one
/// boundary fires, comes back over the trigger, and the agent ends there. Without this the loop
/// would ask for the same compaction at every boundary until the run's turn ceiling stopped it,
/// with nothing to show for any of them.
#[tokio::test]
async fn a_compaction_that_cannot_relieve_the_window_fails_the_agent() {
    let dir = TempDir::new().unwrap();
    let (end, events) = drive_compaction(
        &dir,
        compaction_script(),
        compaction_retrying(
            CompactionStrategy::HandoffSummarization,
            UNREACHABLE_TRIGGER,
            0,
        ),
    )
    .await;

    assert_eq!(end.status, STATUS_COMPACTION_FAILED);
    assert!(end.status.is_failure(), "it is a failure, not a ceiling");
    assert_eq!(end.limit, None, "no ceiling of the operator's was crossed");
    assert_eq!(
        boundaries(&events).len(),
        1,
        "one compaction was tried, and no more"
    );
    let errors = errors(&events);
    assert!(
        errors
            .iter()
            .any(|message| message.contains("maxRetries") && message.contains("threshold")),
        "the ending says what failed and which figure to move: {errors:?}"
    );
}

/// A written allowance buys further attempts before the same ending. Out of band the retry is
/// immediate — gg condenses at the boundary itself, so both attempts happen without spending a
/// model turn on a window the agent cannot work in.
#[tokio::test]
async fn an_armed_allowance_is_spent_before_the_agent_is_failed() {
    let dir = TempDir::new().unwrap();
    let (end, events) = drive_compaction(
        &dir,
        compaction_script(),
        compaction_retrying(
            CompactionStrategy::HandoffSummarization,
            UNREACHABLE_TRIGGER,
            1,
        ),
    )
    .await;

    assert_eq!(end.status, STATUS_COMPACTION_FAILED);
    assert_eq!(
        boundaries(&events).len(),
        2,
        "the first attempt and the retry it was allowed"
    );
}
