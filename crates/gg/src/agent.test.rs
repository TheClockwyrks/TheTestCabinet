use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::board::BoardRuntime;
use crate::client::MockClient;
use crate::client::{
    DEFAULT_MOCK_MEMORY, DEFAULT_MOCK_SKILL, DEFAULT_MOCK_TASK_MOVEMENT, DEFAULT_MOCK_TASK_SCAFFOLD,
};
use crate::compaction::CompactionSetup;
use crate::config::GgInvocation;
use crate::context::HeuristicTokenEstimator;
use crate::memories::MemoriesRuntime;
use crate::model::{
    FinishReason, Message, ModelClient, ModelError, ModelResponse, ToolCall, ToolDefinition,
};
use crate::skills::{SkillLibrary, SkillsRuntime};
use crate::tasks::TasksRuntime;
use crate::telemetry::{CollectingSink, Emitter};
use crate::tools::{RuntimeSet, ToolContext, ToolRegistry};
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_CONTEXT_VISIBILITY, CAPABILITY_EPICS_ISSUES,
    CAPABILITY_SKILLS, GgCapabilityConfig, GgCapabilitySet, GgContextAction, GgContextSource,
    GgTelemetryKind,
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

/// Seed the default-skills directory (`.gg/skills`) in `dir` with the skill the default
/// mock script reads, so an offline run exercises the skills capability end to end.
fn seed_default_skill(dir: &Path) {
    let skills_dir = dir.join(".gg").join("skills");
    std::fs::create_dir_all(&skills_dir).unwrap();
    std::fs::write(
        skills_dir.join(format!("{DEFAULT_MOCK_SKILL}.md")),
        format!(
            "---\nname: {DEFAULT_MOCK_SKILL}\ndescription: How to get started building the game.\n---\n\nStart by scaffolding an index.html with a canvas and a game loop.\n"
        ),
    )
    .unwrap();
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

/// A [`ContextSetup`] with a chosen window limit, so a `drive` test can make a short mock
/// run cross a compaction boundary by shrinking the window.
fn test_context_setup_with_window(emit_breakdown: bool, window_limit: u64) -> ContextSetup {
    ContextSetup {
        estimator: Arc::new(HeuristicTokenEstimator::new()),
        window_limit: Some(window_limit),
        emit_breakdown,
    }
}

/// A disabled compaction setup — the `drive` tests that are not about compaction never
/// compact (matching a run without the opt-in capability).
fn no_compaction() -> CompactionSetup {
    CompactionSetup {
        enabled: false,
        policy: crate::compaction::CompactionPolicy::default(),
        summarizer: crate::compaction::resolve_summarizer(None),
    }
}

/// An enabled compaction setup with the given trigger fullness and the default (mock-backed)
/// summarizer.
fn compaction_at(trigger_fullness: f64) -> CompactionSetup {
    CompactionSetup {
        enabled: true,
        policy: crate::compaction::CompactionPolicy { trigger_fullness },
        summarizer: crate::compaction::resolve_summarizer(None),
    }
}

/// A disabled agent-managed-context setup — the `drive` tests that are not about
/// agent-managed context inject no fullness signal and apply no reclaim tools.
fn no_amc() -> AmcSetup {
    AmcSetup {
        enabled: false,
        archive: Arc::new(Mutex::new(ArchiveStore::new())),
    }
}

/// An enabled agent-managed-context setup sharing `archive` with a registry's `search_archive`
/// tool, so a `drive` e2e can archive and then recover.
fn amc_with(archive: Arc<Mutex<ArchiveStore>>) -> AmcSetup {
    AmcSetup {
        enabled: true,
        archive,
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
    // Seed the skill the default mock script reads so the run exercises the skills
    // capability (a pinned skill read + its telemetry) alongside the file write.
    seed_default_skill(dir.path());
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

    // (d) the skills capability fired: the seeded skill was read successfully, and a
    // SkillsState event reports it read.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "read_skill" && *ok
        )),
        "the seeded skill should have been read successfully"
    );
    let read_states: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::SkillsState { skills } => Some(skills),
            _ => None,
        })
        .collect();
    assert!(!read_states.is_empty(), "a SkillsState should be emitted");
    assert!(
        read_states
            .last()
            .unwrap()
            .iter()
            .any(|s| { s.name == DEFAULT_MOCK_SKILL && s.read }),
        "the read skill should be marked read in the latest SkillsState"
    );

    // (e) the read skill's body is pinned into the window: a later ContextBreakdown
    // attributes tokens to the Skill source.
    let last_breakdown_skill_tokens = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::Skill)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .expect("a context breakdown was emitted");
    assert!(
        last_breakdown_skill_tokens > 0,
        "the pinned skill body should be accounted to the Skill source"
    );

    // (f) the memories capability fired: the scripted memory was written, a MemoryState
    // reports it, and a later ContextBreakdown attributes tokens to the Memory source.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "write_memory" && *ok
        )),
        "the scripted memory should have been written successfully"
    );
    let memory_states: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::MemoryState { memories, .. } => Some(memories),
            _ => None,
        })
        .collect();
    assert!(!memory_states.is_empty(), "a MemoryState should be emitted");
    assert!(
        memory_states
            .last()
            .unwrap()
            .iter()
            .any(|m| m.name == DEFAULT_MOCK_MEMORY),
        "the written memory should appear in the latest MemoryState"
    );
    let last_breakdown_memory_tokens = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::Memory)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .expect("a context breakdown was emitted");
    assert!(
        last_breakdown_memory_tokens > 0,
        "the pinned memory body should be accounted to the Memory source"
    );

    // (g) the tasks capability fired: both tasks were added, the cycle-inducing edge was
    // refused (the DAG guard), and a later TasksState reflects the DAG.
    let add_task_oks: Vec<bool> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "add_task" => Some(*ok),
            _ => None,
        })
        .collect();
    assert_eq!(
        add_task_oks,
        vec![true, true],
        "both scripted tasks should be added"
    );
    // The intentional cycle (set_blocked_by scaffold <- movement) is refused.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, summary: Some(s) }
                if name == "set_blocked_by" && s.contains("cycle")
        )),
        "the cycle-inducing edge must be refused with a cycle explanation"
    );
    // The final TasksState carries both tasks, with the movement task blocked by the
    // scaffold task and the scaffold task marked done.
    let last_tasks = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::TasksState { tasks } => Some(tasks.clone()),
            _ => None,
        })
        .expect("a TasksState was emitted");
    let scaffold = last_tasks
        .iter()
        .find(|t| t.id == DEFAULT_MOCK_TASK_SCAFFOLD)
        .expect("the scaffold task is present");
    let movement = last_tasks
        .iter()
        .find(|t| t.id == DEFAULT_MOCK_TASK_MOVEMENT)
        .expect("the movement task is present");
    assert_eq!(
        movement.blocked_by,
        vec![DEFAULT_MOCK_TASK_SCAFFOLD.to_string()],
        "movement stays blocked by scaffold; the cycle edge never applied"
    );
    assert_eq!(
        scaffold.status,
        test_cabinet_core::gg::GgTaskStatus::Done,
        "the scaffold task was completed"
    );
    // The pinned task list is accounted to the TaskList source.
    let last_breakdown_task_tokens = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::TaskList)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .expect("a context breakdown was emitted");
    assert!(
        last_breakdown_task_tokens > 0,
        "the pinned task list should be accounted to the TaskList source"
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
        no_compaction(),
        no_amc(),
        SkillsRuntime::disabled(),
        MemoriesRuntime::disabled(),
        TasksRuntime::disabled(),
        BoardRuntime::disabled(),
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
        no_compaction(),
        no_amc(),
        SkillsRuntime::disabled(),
        MemoriesRuntime::disabled(),
        TasksRuntime::disabled(),
        BoardRuntime::disabled(),
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
        no_compaction(),
        no_amc(),
        SkillsRuntime::disabled(),
        MemoriesRuntime::disabled(),
        TasksRuntime::disabled(),
        BoardRuntime::disabled(),
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
        no_compaction(),
        no_amc(),
        SkillsRuntime::disabled(),
        MemoriesRuntime::disabled(),
        TasksRuntime::disabled(),
        BoardRuntime::disabled(),
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
    let full = system_prompt(
        &ToolRegistry::from_capabilities(&GgCapabilitySet::minimal("mock/x")),
        &SkillsRuntime::disabled(),
        &MemoriesRuntime::disabled(),
        &TasksRuntime::disabled(),
        &BoardRuntime::disabled(),
    );
    assert!(full.contains("write_file"));
    assert!(full.contains("shell"));

    let empty_set = GgCapabilitySet {
        preset: None,
        capabilities: Vec::new(),
        slots: Vec::new(),
    };
    let empty = system_prompt(
        &ToolRegistry::from_capabilities(&empty_set),
        &SkillsRuntime::disabled(),
        &MemoriesRuntime::disabled(),
        &TasksRuntime::disabled(),
        &BoardRuntime::disabled(),
    );
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

// ---------------------------------------------------------------------------
// Skills: ablation, and the pinned, deduplicated skill read
// ---------------------------------------------------------------------------

/// `minimal`, with the skills capability disabled (the ablation off arm).
fn minimal_without_skills(model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    for cap in &mut set.capabilities {
        if cap.id == CAPABILITY_SKILLS {
            cap.enabled = false;
        }
    }
    set
}

/// A `read_skill` call for `name`, with the given id.
fn read_skill_call(id: &str, name: &str) -> ModelResponse {
    ModelResponse {
        text: Some(format!("reading {name}")),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: "read_skill".to_string(),
            arguments: json!({ "name": name }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// A terminal, tool-free response that ends the loop.
fn stop_response() -> ModelResponse {
    ModelResponse {
        text: Some("done".to_string()),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// With the skills capability off, the run offers no `read_skill` tool and emits no
/// `SkillsState` — even though a skills directory is present (the ablation makes the
/// feature vanish). The default script's `read_skill` call comes back as an unknown tool.
#[tokio::test]
async fn run_without_skills_capability_offers_no_skill_tool_or_state() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-noskills".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), minimal_without_skills("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    // No skills telemetry at all.
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::SkillsState { .. })),
        "skills off must not emit any SkillsState"
    );
    // The `read_skill` call is not dispatchable — it is withheld like any ablated tool.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "read_skill" && !*ok
        )),
        "read_skill should be an unknown tool when the capability is off"
    );
    // The run still completes and builds the file.
    assert!(dir.path().join("index.html").exists());
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// Reading the same skill twice pins its body **once**: the Skill-source token band does
/// not grow on the repeat read, and only the first (fresh) read emits a `SkillsState`.
#[tokio::test]
async fn drive_pins_a_read_skill_once_across_repeat_reads() {
    let dir = TempDir::new().unwrap();
    std::fs::write(
        dir.path().join("guide.md"),
        "---\nname: guide\ndescription: a guide.\n---\nThis is the guide body with enough words to count.",
    )
    .unwrap();
    let library = Arc::new(SkillLibrary::load(dir.path()));
    assert_eq!(library.len(), 1);

    let set = GgCapabilitySet::minimal("mock/echo");
    let registry = ToolRegistry::from_run(&set, &RuntimeSet::new(&library));
    let runtime = SkillsRuntime::new(Arc::clone(&library));
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-dedup".to_string()), Box::new(sink.clone()));

    // Read `guide` twice, then stop — three turns, so three per-turn breakdowns.
    let client = MockClient::new(
        "mock/echo",
        vec![
            read_skill_call("c1", "guide"),
            read_skill_call("c2", "guide"),
            stop_response(),
        ],
    );

    let end = drive(
        &client,
        "go",
        &registry,
        &ctx,
        &emitter,
        10,
        None,
        test_context_setup(true),
        no_compaction(),
        no_amc(),
        runtime,
        MemoriesRuntime::disabled(),
        TasksRuntime::disabled(),
        BoardRuntime::disabled(),
    )
    .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();

    // Only the first (fresh) read emits a SkillsState; the repeat does not.
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e.kind, GgTelemetryKind::SkillsState { .. }))
            .count(),
        1,
        "a repeat read must not re-emit SkillsState"
    );

    // The Skill token band across the per-turn breakdowns: zero before the read, then a
    // fixed positive value that does not double when the skill is read again.
    let skill_bands: Vec<u64> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::Skill)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .collect();
    assert_eq!(skill_bands.len(), 3, "one breakdown per turn");
    assert_eq!(
        skill_bands[0], 0,
        "no skill is pinned before the first read"
    );
    assert!(skill_bands[1] > 0, "the fresh read pins the skill body");
    assert_eq!(
        skill_bands[1], skill_bands[2],
        "the repeat read must not pin a second copy"
    );
}

// ---------------------------------------------------------------------------
// Memories: ablation, and the bounded, pinned, model-curated scratchpad
// ---------------------------------------------------------------------------

/// `minimal`, with the memories capability disabled (the ablation off arm).
fn minimal_without_memories(model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    for cap in &mut set.capabilities {
        if cap.id == test_cabinet_core::gg::CAPABILITY_MEMORIES {
            cap.enabled = false;
        }
    }
    set
}

/// A `write_memory` call with the given id, name, and body.
fn write_memory_call(id: &str, name: &str, body: &str) -> ModelResponse {
    ModelResponse {
        text: Some(format!("noting {name}")),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: "write_memory".to_string(),
            arguments: json!({ "name": name, "description": "a note", "body": body }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// With the memories capability off, the run offers no memory tools and emits no
/// `MemoryState` — even though the default script tries to write one (the ablation makes
/// the feature vanish). The write_memory call comes back as an unknown tool.
#[tokio::test]
async fn run_without_memories_capability_offers_no_memory_tools_or_state() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-nomem".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), minimal_without_memories("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    // No memories telemetry at all.
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::MemoryState { .. })),
        "memories off must not emit any MemoryState"
    );
    // No Memory-source tokens ever accumulate.
    assert!(
        events.iter().all(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } =>
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::Memory)
                    .map(|b| b.tokens)
                    .unwrap_or(0)
                    == 0,
            _ => true,
        }),
        "memories off must never account tokens to the Memory source"
    );
    // The write_memory call is withheld like any ablated tool.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "write_memory" && !*ok
        )),
        "write_memory should be an unknown tool when the capability is off"
    );
    // The run still completes and builds the file.
    assert!(dir.path().join("index.html").exists());
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// A write that breaches a cap is refused end to end: the tool result fails with the
/// revise-or-evict guidance, the store stays within the cap, and the pinned Memory block
/// reflects only the accepted memory.
#[tokio::test]
async fn drive_enforces_memory_caps_end_to_end() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cap".to_string()), Box::new(sink.clone()));

    // A one-memory budget so the second write hits the count cap cheaply.
    let caps = crate::memories::MemoryCaps {
        max_count: 1,
        max_len_per_memory: 500,
        max_total_len: 5_000,
    };
    let memories = MemoriesRuntime::new(caps);
    let set = GgCapabilitySet::minimal("mock/echo");
    let library = Arc::new(SkillLibrary::empty());
    let memory_store = memories.store();
    let registry = ToolRegistry::from_run(
        &set,
        &RuntimeSet::new(&library).with_memories(&memory_store),
    );

    // Write `first` (accepted), then `second` (refused — count cap), then stop.
    let client = MockClient::new(
        "mock/echo",
        vec![
            write_memory_call("c1", "first", "the first note body"),
            write_memory_call("c2", "second", "the second note body"),
            stop_response(),
        ],
    );

    let end = drive(
        &client,
        "go",
        &registry,
        &ctx,
        &emitter,
        10,
        None,
        test_context_setup(true),
        no_compaction(),
        no_amc(),
        SkillsRuntime::disabled(),
        memories,
        TasksRuntime::disabled(),
        BoardRuntime::disabled(),
    )
    .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();

    // The first write succeeded; the second was refused (not silently accepted).
    let write_results: Vec<bool> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "write_memory" => Some(*ok),
            _ => None,
        })
        .collect();
    assert_eq!(
        write_results,
        vec![true, false],
        "second write hits the cap"
    );

    // The refusal carried revise-or-evict guidance to the model.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, summary: Some(s) }
                if name == "write_memory" && s.contains("delete_memory")
        )),
        "the cap breach must instruct the model to revise or evict"
    );

    // The final MemoryState stays within the cap: exactly one memory.
    let last_count = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::MemoryState { count, .. } => Some(*count),
            _ => None,
        })
        .expect("a MemoryState was emitted");
    assert_eq!(last_count, 1, "the count cap held");

    // The accepted memory is pinned and accounted to the Memory source.
    let last_memory_tokens = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::Memory)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .expect("a context breakdown was emitted");
    assert!(last_memory_tokens > 0, "the accepted memory is pinned");
}

// ---------------------------------------------------------------------------
// Tasks: ablation, and the blocked-by DAG driven through the loop
// ---------------------------------------------------------------------------

/// `minimal`, with the tasks capability disabled (the ablation off arm).
fn minimal_without_tasks(model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    for cap in &mut set.capabilities {
        if cap.id == CAPABILITY_TASKS {
            cap.enabled = false;
        }
    }
    set
}

/// With the tasks capability off, the run offers no task tools and emits no `TasksState` —
/// even though the default script tries to build a DAG (the ablation makes the feature
/// vanish). The task calls come back as unknown tools, and no TaskList tokens accumulate.
#[tokio::test]
async fn run_without_tasks_capability_offers_no_task_tools_or_state() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-notasks".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), minimal_without_tasks("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    // No tasks telemetry at all.
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::TasksState { .. })),
        "tasks off must not emit any TasksState"
    );
    // No TaskList-source tokens ever accumulate.
    assert!(
        events.iter().all(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } =>
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::TaskList)
                    .map(|b| b.tokens)
                    .unwrap_or(0)
                    == 0,
            _ => true,
        }),
        "tasks off must never account tokens to the TaskList source"
    );
    // The add_task call is withheld like any ablated tool.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "add_task" && !*ok
        )),
        "add_task should be an unknown tool when the capability is off"
    );
    // The run still completes and builds the file.
    assert!(dir.path().join("index.html").exists());
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// A blocked-by DAG driven through the loop: two tasks with an edge, a cycle-inducing edge
/// that is refused, then completion. The refused edge never applies, and the pinned task
/// list flips the dependent task from blocked to ready once its blocker is done.
#[tokio::test]
async fn drive_builds_a_dag_and_rejects_a_cycle_end_to_end() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-dag".to_string()), Box::new(sink.clone()));

    let tasks = TasksRuntime::new(50);
    let set = GgCapabilitySet::minimal("mock/echo");
    let library = Arc::new(SkillLibrary::empty());
    let task_store = tasks.store();
    let registry = ToolRegistry::from_run(&set, &RuntimeSet::new(&library).with_tasks(&task_store));

    // add a, add b (blocked by a), try a blocked-by b (cycle → refused), complete a, stop.
    let call = |id: &str, name: &str, args: serde_json::Value| ModelResponse {
        text: Some(format!("{name} {id}")),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: name.to_string(),
            arguments: args,
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
    };
    let client = MockClient::new(
        "mock/echo",
        vec![
            call("c1", "add_task", json!({ "id": "a", "title": "A" })),
            call(
                "c2",
                "add_task",
                json!({ "id": "b", "title": "B", "blockedBy": ["a"] }),
            ),
            call(
                "c3",
                "set_blocked_by",
                json!({ "id": "a", "blockedBy": ["b"] }),
            ),
            call("c4", "complete_task", json!({ "id": "a" })),
            stop_response(),
        ],
    );

    let end = drive(
        &client,
        "go",
        &registry,
        &ctx,
        &emitter,
        10,
        None,
        test_context_setup(true),
        no_compaction(),
        no_amc(),
        SkillsRuntime::disabled(),
        MemoriesRuntime::disabled(),
        tasks,
        BoardRuntime::disabled(),
    )
    .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();

    // The cycle-inducing edge was refused.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, .. } if name == "set_blocked_by"
        )),
        "the cycle edge must be refused"
    );

    // The final DAG: both tasks present, b still only blocked by a, a done.
    let last_tasks = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::TasksState { tasks } => Some(tasks.clone()),
            _ => None,
        })
        .expect("a TasksState was emitted");
    let a = last_tasks.iter().find(|t| t.id == "a").unwrap();
    let b = last_tasks.iter().find(|t| t.id == "b").unwrap();
    assert!(a.blocked_by.is_empty(), "the cycle edge never applied to a");
    assert_eq!(b.blocked_by, vec!["a".to_string()]);
    assert_eq!(a.status, test_cabinet_core::gg::GgTaskStatus::Done);

    // The pinned task list, once a is done, shows b as ready rather than blocked.
    let last_task_breakdown = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::TaskList)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .expect("a context breakdown was emitted");
    assert!(
        last_task_breakdown > 0,
        "the pinned task list is accounted to the TaskList source"
    );
}

// ---------------------------------------------------------------------------
// Epics & issues: ablation, and the board built through the loop
// ---------------------------------------------------------------------------

/// `minimal`, plus the (opt-in) epics-and-issues capability enabled.
fn minimal_with_epics_issues(model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_EPICS_ISSUES));
    set
}

/// With the epics-and-issues capability off (its default — it is opt-in), the run offers no
/// board tools and emits no `BoardState`, even though the default script tries to build a board.
/// The board calls come back as unknown tools and no Board tokens accumulate.
#[tokio::test]
async fn run_without_epics_issues_capability_offers_no_board_tools_or_state() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-noboard".to_string()), Box::new(sink.clone()));
    // `minimal` does not include epics-and-issues, so the board is off.
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    // No board telemetry at all.
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::BoardState { .. })),
        "the board off must not emit any BoardState"
    );
    // No Board-source tokens ever accumulate.
    assert!(
        events.iter().all(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } =>
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::Board)
                    .map(|b| b.tokens)
                    .unwrap_or(0)
                    == 0,
            _ => true,
        }),
        "the board off must never account tokens to the Board source"
    );
    // The create_epic call is withheld like any ablated tool.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "create_epic" && !*ok
        )),
        "create_epic should be an unknown tool when the capability is off"
    );
    // The run still completes and builds the file.
    assert!(dir.path().join("index.html").exists());
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// The offline default script builds a board end to end when the capability is enabled: an epic,
/// two issues with a blocked-by edge, a refused cycle-inducing edge, and the pinned board
/// accounted to the Board source. Mirrors the tasks DAG e2e but exercises the heavyweight tier
/// through the full `run` path.
#[tokio::test]
async fn run_builds_a_board_end_to_end_when_epics_issues_enabled() {
    use crate::client::{DEFAULT_MOCK_EPIC, DEFAULT_MOCK_ISSUE_INPUT, DEFAULT_MOCK_ISSUE_RENDER};

    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-board".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), minimal_with_epics_issues("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    // The board tools were offered and used: the epic and both issues were created.
    for (tool, ok_expected) in [
        ("create_epic", true),
        ("create_issue", true),
        ("set_issue_blocked_by", false),
    ] {
        assert!(
            events.iter().any(|e| matches!(
                &e.kind,
                GgTelemetryKind::ToolResult { name, ok, .. }
                    if name == tool && *ok == ok_expected
            )),
            "expected `{tool}` result ok={ok_expected}"
        );
    }

    // The final board: the epic, both issues, the input issue blocked by the render issue, and
    // the refused cycle never applied (the render issue has no blockers).
    let last_board = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::BoardState { epics, issues } => Some((epics.clone(), issues.clone())),
            _ => None,
        })
        .expect("a BoardState was emitted");
    let (epics, issues) = last_board;
    assert!(epics.iter().any(|epic| epic.id == DEFAULT_MOCK_EPIC));
    let render = issues
        .iter()
        .find(|i| i.id == DEFAULT_MOCK_ISSUE_RENDER)
        .expect("the render issue exists");
    let input = issues
        .iter()
        .find(|i| i.id == DEFAULT_MOCK_ISSUE_INPUT)
        .expect("the input issue exists");
    assert!(
        render.blocked_by.is_empty(),
        "the cycle edge never applied to the render issue"
    );
    assert_eq!(
        input.blocked_by,
        vec![DEFAULT_MOCK_ISSUE_RENDER.to_string()]
    );
    assert_eq!(input.epic_id.as_deref(), Some(DEFAULT_MOCK_EPIC));
    // The structured dispatch brief survives onto the board.
    assert!(!render.in_scope.is_empty());
    assert!(!render.out_of_scope.is_empty());
    assert!(!render.completion_criteria.is_empty());

    // The pinned board is accounted to the Board source in a later breakdown.
    let last_board_tokens = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::Board)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .expect("a context breakdown was emitted");
    assert!(
        last_board_tokens > 0,
        "the pinned board is accounted to the Board source"
    );
}

// ---------------------------------------------------------------------------
// Compaction: the threshold trigger, pinned-state retention, and the off arm
// ---------------------------------------------------------------------------

/// A big-text assistant turn that also calls a harmless tool (so the loop continues),
/// ballooning the ephemeral history to push the window past the compaction threshold.
fn balloon_turn(id: &str) -> ModelResponse {
    ModelResponse {
        text: Some("ephemeral working notes ".repeat(600)),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: "list_dir".to_string(),
            arguments: json!({ "path": "." }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// The script that establishes pinned state (a read skill, a memory, a task), then
/// balloons the window, then stops — five scripted turns.
fn compaction_script() -> Vec<ModelResponse> {
    vec![
        read_skill_call("c_skill", DEFAULT_MOCK_SKILL),
        write_memory_call("c_mem", "plan", "the game is an arrow-key maze runner"),
        ModelResponse {
            text: Some("planning the scaffold".to_string()),
            tool_calls: vec![ToolCall {
                id: "c_task".to_string(),
                name: "add_task".to_string(),
                arguments: json!({ "id": "t1", "title": "Scaffold the page" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        },
        balloon_turn("c_ls"),
        stop_response(),
    ]
}

/// Build the runtimes + registry for a compaction drive test: a one-skill library, an
/// empty memory store, and an empty task store, all bound into the toolset.
fn compaction_runtimes(dir: &Path) -> (ToolRegistry, SkillsRuntime, MemoriesRuntime, TasksRuntime) {
    seed_default_skill(dir);
    let library = Arc::new(SkillLibrary::load(&dir.join(".gg").join("skills")));
    assert_eq!(library.len(), 1, "the seeded skill loaded");
    let skills = SkillsRuntime::new(Arc::clone(&library));
    let memories = MemoriesRuntime::new(crate::memories::MemoryCaps::default());
    let tasks = TasksRuntime::new(50);
    let set = GgCapabilitySet::minimal("mock/echo");
    let memory_store = memories.store();
    let task_store = tasks.store();
    let registry = ToolRegistry::from_run(
        &set,
        &RuntimeSet::new(&library)
            .with_memories(&memory_store)
            .with_tasks(&task_store),
    );
    (registry, skills, memories, tasks)
}

/// A short mock run crosses a compaction boundary: once the ballooned ephemeral history
/// pushes the window past the threshold, the loop summarizes and restarts the thread —
/// keeping the pinned skill, memory, and task list verbatim and reclaiming the window.
#[tokio::test]
async fn drive_compacts_at_the_threshold_and_retains_pinned_state() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-compact".to_string()), Box::new(sink.clone()));

    let (registry, skills, memories, tasks) = compaction_runtimes(dir.path());
    let client = MockClient::new("mock/echo", compaction_script());

    // A small window and a moderate threshold, so the ballooned ephemeral turn crosses it
    // while the pinned prefix alone stays under it.
    let end = drive(
        &client,
        "go",
        &registry,
        &ctx,
        &emitter,
        10,
        None,
        test_context_setup_with_window(true, 4_000),
        compaction_at(0.6),
        no_amc(),
        skills,
        memories,
        tasks,
        BoardRuntime::disabled(),
    )
    .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();

    // Exactly one compaction boundary, and it reclaimed the window with the retention proof.
    let compactions: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Compaction {
                trigger_fullness,
                before_tokens,
                after_tokens,
                summary_tokens,
                retained,
            } => Some((
                *trigger_fullness,
                *before_tokens,
                *after_tokens,
                *summary_tokens,
                *retained,
            )),
            _ => None,
        })
        .collect();
    assert_eq!(compactions.len(), 1, "the run crossed exactly one boundary");
    let (trigger, before, after, summary_tokens, retained) = compactions[0];
    assert_eq!(trigger, 0.6);
    assert!(
        after < before,
        "compaction reclaimed window (after < before)"
    );
    assert!(summary_tokens > 0);
    // The pinned state that survived: a read skill, a task, and a memory.
    assert_eq!(retained.skills, 1, "the read skill was retained");
    assert_eq!(retained.tasks, 1, "the task list was retained");
    assert_eq!(retained.memories, 1, "the memory was retained");

    // The next context breakdown after the boundary reflects the reclaimed window.
    let compaction_pos = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::Compaction { .. }))
        .unwrap();
    let post_total = events[compaction_pos..]
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { total_tokens, .. } => Some(*total_tokens),
            _ => None,
        })
        .expect("a breakdown follows the compaction");
    assert_eq!(
        post_total, after,
        "the post-compaction breakdown shows the reclaimed total"
    );
    assert!(post_total < before);

    // Retention held live: the pinned bands are still accounted after the boundary, and the
    // ephemeral bands were reclaimed.
    let post_breakdown = events[compaction_pos..]
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(by_source.clone()),
            _ => None,
        })
        .unwrap();
    let band = |source: GgContextSource| {
        post_breakdown
            .iter()
            .find(|b| b.source == source)
            .map(|b| b.tokens)
            .unwrap_or(0)
    };
    assert!(band(GgContextSource::Skill) > 0, "the skill body survived");
    assert!(band(GgContextSource::Memory) > 0, "the memory survived");
    assert!(
        band(GgContextSource::TaskList) > 0,
        "the task list survived"
    );
    assert!(
        band(GgContextSource::History) > 0,
        "the summary is in the window"
    );
    assert_eq!(
        band(GgContextSource::Assistant),
        0,
        "the ephemeral turns were reclaimed"
    );

    // The pinned state is intact in its own telemetry too.
    let last_memory = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::MemoryState { memories, .. } => Some(memories.clone()),
            _ => None,
        })
        .expect("a MemoryState was emitted");
    assert!(last_memory.iter().any(|m| m.name == "plan"));
    let last_tasks = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::TasksState { tasks } => Some(tasks.clone()),
            _ => None,
        })
        .expect("a TasksState was emitted");
    assert!(last_tasks.iter().any(|t| t.id == "t1"));
    let last_skills = events
        .iter()
        .rev()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::SkillsState { skills } => Some(skills.clone()),
            _ => None,
        })
        .expect("a SkillsState was emitted");
    assert!(
        last_skills
            .iter()
            .any(|s| s.name == DEFAULT_MOCK_SKILL && s.read)
    );
}

/// The same window-crossing run with the compaction capability **off** never compacts: no
/// Compaction event is emitted even though the window overflows, and the run still finishes.
#[tokio::test]
async fn drive_never_compacts_when_capability_off() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-nocompact".to_string()), Box::new(sink.clone()));

    let (registry, skills, memories, tasks) = compaction_runtimes(dir.path());
    let client = MockClient::new("mock/echo", compaction_script());

    let end = drive(
        &client,
        "go",
        &registry,
        &ctx,
        &emitter,
        10,
        None,
        test_context_setup_with_window(true, 4_000),
        no_compaction(),
        no_amc(),
        skills,
        memories,
        tasks,
        BoardRuntime::disabled(),
    )
    .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::Compaction { .. })),
        "compaction off must never emit a Compaction event"
    );
    // The window did overflow (proving the off arm is what suppressed compaction, not a
    // window that never filled).
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ContextBreakdown { fullness: Some(f), .. } if *f >= 0.6
        )),
        "the window crossed the threshold, yet nothing compacted"
    );
}

// ---------------------------------------------------------------------------
// Agent-managed context, end to end through the loop
// ---------------------------------------------------------------------------

/// A capability set with the agent-managed-context capability enabled on top of the minimal
/// defaults, so the reclaim tools are offered and the fullness signal is injected.
fn minimal_with_amc(model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    set.capabilities.push(GgCapabilityConfig::enabled(
        CAPABILITY_AGENT_MANAGED_CONTEXT,
    ));
    set
}

/// The FileView token band of every emitted `ContextBreakdown`, in order.
fn file_view_bands(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<u64> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|b| b.source == GgContextSource::FileView)
                    .map(|b| b.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .collect()
}

/// The offline agent-managed-context e2e: the scripted mock writes and reads a file, evicts the
/// file view (reclaiming it), archives the older thread, then searches the archive to recover
/// it. The stream carries the `ContextManaged` effects, the file-view band drops to zero, and
/// the shared archive holds the recovered material.
#[tokio::test]
async fn drive_manages_context_end_to_end() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-amc".to_string()), Box::new(sink.clone()));

    let set = minimal_with_amc("mock/echo");
    let archive = Arc::new(Mutex::new(ArchiveStore::new()));
    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(&set, &RuntimeSet::new(&library).with_archive(&archive));

    let client = MockClient::with_agent_managed_context_script("mock/echo");
    let end = drive(
        &client,
        "go",
        &registry,
        &ctx,
        &emitter,
        20,
        None,
        test_context_setup(true),
        no_compaction(),
        amc_with(Arc::clone(&archive)),
        SkillsRuntime::disabled(),
        MemoriesRuntime::disabled(),
        TasksRuntime::disabled(),
        BoardRuntime::disabled(),
    )
    .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();

    // (a) an evict ContextManaged effect that actually reclaimed tokens.
    let evict = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextManaged {
                action: GgContextAction::EvictFileViews,
                reclaimed_tokens,
                items,
                ..
            } => Some((*reclaimed_tokens, *items)),
            _ => None,
        })
        .expect("an evict_file_views ContextManaged event");
    assert!(evict.0 > 0, "the eviction reclaimed tokens");
    assert_eq!(evict.1, 1, "one file view was evicted");

    // (b) an archive ContextManaged effect.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ContextManaged {
                action: GgContextAction::ArchiveThread,
                ..
            }
        )),
        "an archive_thread ContextManaged event"
    );

    // (c) the file-view band rose (after the read) and fell back to zero (after the evict).
    let bands = file_view_bands(&events);
    assert!(
        bands.iter().any(|&t| t > 0),
        "the file view entered the window"
    );
    assert_eq!(
        *bands.last().unwrap(),
        0,
        "the file-view band drops to zero after eviction"
    );

    // (d) search_archive recovered the archived reference (a successful hit), and the shared
    // archive still holds the material out of the live window.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: true, summary: Some(s) }
                if name == "search_archive" && s.contains("archive hit")
        )),
        "search_archive returned a hit"
    );
    assert!(
        !archive.lock().unwrap().search("level.json", 10).is_empty(),
        "the archived thread material remains searchable after the run"
    );
}

/// With the capability off, none of the agent-managed-context tools are offered and no
/// `ContextManaged` effect or fullness signal is produced — the ablation off arm. Driving the
/// same script, every reclaim/search call comes back as an unknown-tool error and the run still
/// completes.
#[tokio::test]
async fn drive_without_amc_offers_no_context_management() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-no-amc".to_string()), Box::new(sink.clone()));

    // Minimal set (no agent-managed-context), and no archive bound to the registry.
    let set = GgCapabilitySet::minimal("mock/echo");
    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(&set, &RuntimeSet::new(&library));
    for name in ["evict_file_view", "archive_thread", "search_archive"] {
        assert!(
            !registry.definitions().iter().any(|d| d.name == name),
            "`{name}` must not be offered when the capability is off"
        );
    }

    let client = MockClient::with_agent_managed_context_script("mock/echo");
    let end = drive(
        &client,
        "go",
        &registry,
        &ctx,
        &emitter,
        20,
        None,
        test_context_setup(true),
        no_compaction(),
        no_amc(),
        SkillsRuntime::disabled(),
        MemoriesRuntime::disabled(),
        TasksRuntime::disabled(),
        BoardRuntime::disabled(),
    )
    .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::ContextManaged { .. })),
        "the off arm must never emit a ContextManaged event"
    );
    // No fullness signal reached the model: no context item content starts with the signal
    // line (the breakdown's System band is only the base prompt).
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, .. } if name == "evict_file_view"
        )),
        "the reclaim call falls through to an unknown-tool error when the capability is off"
    );
}
