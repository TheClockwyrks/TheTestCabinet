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
            no_limits(12),
            test_context_setup_with_window(NARROW_WINDOW),
            compaction,
            no_amc(),
            no_autoload(),
            &[],
            skills,
            memories,
            tasks,
            BoardRuntime::disabled(),
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            ReadPolicy::default(),
            OffloadPolicy::default(),
            false,
            no_code(),
            no_completion(),
            &GgAgentConfig::root(),
            None,
            None,
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
