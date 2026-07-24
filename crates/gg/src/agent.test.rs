use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::json;
use tempfile::TempDir;

use std::collections::HashMap;

use super::*;
use crate::board::BoardRuntime;
use crate::client::MockClient;
use crate::client::{
    ClientFactory, DEFAULT_MOCK_MEMORY, DEFAULT_MOCK_SKILL, DEFAULT_MOCK_TASK_MOVEMENT,
    DEFAULT_MOCK_TASK_SCAFFOLD, MOCK_CODE_REVIEW_ISSUE_ID, MOCK_FSM_IMPL_FILE, MOCK_FSM_TEST_FILE,
    MOCK_RAC_LEVEL_FILES, MOCK_REVIEW_FIX_FILE, MOCK_REVIEW_FIX_SENTINEL, MOCK_REVIEW_WORKER_FILE,
    MOCK_SPECULATE_ATTEMPT_PREFIX, MOCK_SUBAGENT_FILE, MOCK_SUBAGENT_RETURN,
};
use crate::compaction::CompactionSetup;
use crate::config::GgInvocation;
use crate::context::HeuristicTokenEstimator;
use crate::fsm::FsmRuntime;
use crate::memories::MemoriesRuntime;
use crate::model::{
    FinishReason, Message, ModelClient, ModelError, ModelResponse, ToolCall, ToolDefinition,
};
use crate::planning::PlanningRuntime;
use crate::skills::{SkillLibrary, SkillsRuntime};
use crate::tasks::TasksRuntime;
use crate::telemetry::{CollectingSink, Emitter};
use crate::tools::{RuntimeSet, ToolContext, ToolRegistry};
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_CODE_REVIEWS, CAPABILITY_CONTEXT_VISIBILITY,
    CAPABILITY_EPICS_ISSUES, CAPABILITY_FSM, CAPABILITY_MULTI_MODEL, CAPABILITY_PLANNING,
    CAPABILITY_RESPONSES_AS_CODE, CAPABILITY_SKILLS, CAPABILITY_SPECULATIVE, CAPABILITY_SUBAGENTS,
    CAPABILITY_WORKFLOWS, CAPABILITY_WORKTREES, GgAgentStatus, GgCapabilityConfig, GgCapabilitySet,
    GgCodeReviewPhase, GgContextAction, GgContextSource, GgIssueStatus, GgPlanPhase,
    GgSessionSummary, GgSlotBinding, GgSpeculationPhase, GgTelemetryEvent, GgTelemetryKind,
    GgWorkflowPhase, PRIMARY_SLOT,
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

/// A [`ModelClient`] that returns a single `write_file` tool call on its first turn, then fails
/// every subsequent turn with a fatal model error — so an agent driving it writes one file and then
/// ends in `model_error` (a non-clean completion), for the worktree-discard e2e.
struct WriteThenFailClient {
    path: String,
    contents: String,
    cursor: std::sync::atomic::AtomicUsize,
}

impl WriteThenFailClient {
    fn new(path: &str, contents: &str) -> Self {
        Self {
            path: path.to_string(),
            contents: contents.to_string(),
            cursor: std::sync::atomic::AtomicUsize::new(0),
        }
    }
}

#[async_trait::async_trait]
impl ModelClient for WriteThenFailClient {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        let turn = self
            .cursor
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if turn == 0 {
            Ok(ModelResponse {
                text: Some("Writing throwaway work in my worktree.".to_string()),
                tool_calls: vec![ToolCall {
                    id: "call_child_write".to_string(),
                    name: "write_file".to_string(),
                    arguments: json!({ "path": self.path, "contents": self.contents }),
                }],
                finish_reason: FinishReason::ToolCalls,
                usage: TokenCounts::default(),
                cost: None,
            })
        } else {
            Err(ModelError::Fatal {
                status: 500,
                message: "the subagent's model failed mid-task".to_string(),
            })
        }
    }

    fn model_id(&self) -> &str {
        "mock/subagent"
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
    let agent = Agent::root("primary");
    let end = agent
        .drive(
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
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
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
    let agent = Agent::root("primary");
    let end = agent
        .drive(
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
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
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
    let agent = Agent::root("primary");
    let end = agent
        .drive(
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
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
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
    let agent = Agent::root("primary");
    let end = agent
        .drive(
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
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
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
        &PlanningRuntime::disabled(),
        &FsmRuntime::disabled(),
        false,
        false,
        false,
    );
    assert!(full.contains("write_file"));
    assert!(full.contains("shell"));

    let empty_set = GgCapabilitySet {
        preset: None,
        capabilities: Vec::new(),
        slots: Vec::new(),
        disabled_tools: Vec::new(),
    };
    let empty = system_prompt(
        &ToolRegistry::from_capabilities(&empty_set),
        &SkillsRuntime::disabled(),
        &MemoriesRuntime::disabled(),
        &TasksRuntime::disabled(),
        &BoardRuntime::disabled(),
        &PlanningRuntime::disabled(),
        &FsmRuntime::disabled(),
        false,
        false,
        false,
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

    let agent = Agent::root("primary");
    let end = agent
        .drive(
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
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
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

    let agent = Agent::root("primary");
    let end = agent
        .drive(
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
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
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

    let agent = Agent::root("primary");
    let end = agent
        .drive(
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
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
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
    let agent = Agent::root("primary");
    let end = agent
        .drive(
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
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
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

    let agent = Agent::root("primary");
    let end = agent
        .drive(
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
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
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
    let agent = Agent::root("primary");
    let end = agent
        .drive(
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
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
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
    let agent = Agent::root("primary");
    let end = agent
        .drive(
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
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
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

// ---------------------------------------------------------------------------
// Planning: the read-only plan-then-implement cycle, and the off arm
// ---------------------------------------------------------------------------

/// `minimal`, plus the (opt-in) planning capability enabled.
fn minimal_with_planning(model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_PLANNING));
    set
}

/// The tokens a breakdown attributes to `source`, or 0.
fn source_band(
    by_source: &[test_cabinet_core::gg::GgContextSourceUsage],
    source: GgContextSource,
) -> u64 {
    by_source
        .iter()
        .find(|b| b.source == source)
        .map(|b| b.tokens)
        .unwrap_or(0)
}

/// The full planning cycle end to end: the model enters read-only plan mode, a mutating call is
/// refused while planning, it submits a plan, gg clears the exploration and seeds the plan into a
/// fresh context, and the model implements (writes the file) with its full toolset restored.
#[tokio::test]
async fn drive_plans_then_implements_from_a_fresh_context() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-plan".to_string()), Box::new(sink.clone()));

    let set = minimal_with_planning("mock/echo");
    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(&set, &RuntimeSet::new(&library));

    let client = MockClient::with_planning_script("mock/echo");
    let agent = Agent::root("primary");
    let end = agent
        .drive(
            &client,
            "build the game",
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
            PlanningRuntime::resolve(&set),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
        )
        .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();

    // (a) The three planning transitions fired, in order: entered (no plan), submitted (plan),
    //     implementing (same plan).
    let phases: Vec<(GgPlanPhase, Option<String>)> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Planning { phase, plan } => Some((*phase, plan.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(phases.len(), 3, "entered, submitted, implementing");
    assert_eq!(phases[0].0, GgPlanPhase::Entered);
    assert!(phases[0].1.is_none(), "no plan text on entry");
    assert_eq!(phases[1].0, GgPlanPhase::Submitted);
    assert_eq!(phases[2].0, GgPlanPhase::Implementing);
    let plan = phases[2]
        .1
        .clone()
        .expect("the implementing phase carries the plan");
    assert!(
        plan.contains("index.html"),
        "the submitted plan text survived"
    );
    assert_eq!(
        phases[1].1.as_deref(),
        Some(plan.as_str()),
        "submitted and implementing carry the same plan"
    );

    // (b) enter_plan_mode succeeded; list_dir (read-only) was allowed while planning; the
    //     mutating write to premature.txt was REFUSED in plan mode and never written.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: true, .. } if name == "enter_plan_mode"
        )),
        "enter_plan_mode succeeded"
    );
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: true, .. } if name == "list_dir"
        )),
        "list_dir is allowed in plan mode"
    );
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, summary: Some(s) }
                if name == "write_file" && s.contains("plan mode")
        )),
        "the mutating write_file was refused in plan mode"
    );
    assert!(
        !dir.path().join("premature.txt").exists(),
        "the plan-mode write was blocked, so premature.txt was never created"
    );

    // (c) submit_plan succeeded and the implementation write actually wrote index.html with the
    //     full toolset restored.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: true, .. } if name == "submit_plan"
        )),
        "submit_plan succeeded"
    );
    assert!(
        dir.path().join("index.html").exists(),
        "the model implemented from the fresh context"
    );

    // (d) The reset kept the pinned prefix, cleared the exploration, and seeded the plan: the
    //     breakdown right after the Implementing transition shows the pinned original prompt and
    //     the pinned plan present, and the plan-phase assistant/tool-output bands cleared.
    let impl_pos = events
        .iter()
        .position(|e| {
            matches!(
                &e.kind,
                GgTelemetryKind::Planning {
                    phase: GgPlanPhase::Implementing,
                    ..
                }
            )
        })
        .unwrap();
    let post = events[impl_pos..]
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(by_source.clone()),
            _ => None,
        })
        .expect("a breakdown follows the implementing transition");
    assert!(
        source_band(&post, GgContextSource::Plan) > 0,
        "the submitted plan is pinned to the Plan source"
    );
    assert!(
        source_band(&post, GgContextSource::UserPrompt) > 0,
        "the original build prompt is kept across the reset"
    );
    assert_eq!(
        source_band(&post, GgContextSource::Assistant),
        0,
        "the plan-phase assistant turns were cleared"
    );
    assert_eq!(
        source_band(&post, GgContextSource::ToolOutput),
        0,
        "the plan-phase exploration output was cleared"
    );
}

/// With the planning capability off, no planning tools are offered and no Planning telemetry is
/// produced — the ablation off arm. Driving the same script, `enter_plan_mode`/`submit_plan` come
/// back as unknown-tool errors, no Plan-source tokens ever accumulate, and the run still completes.
#[tokio::test]
async fn drive_without_planning_offers_no_planning() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-no-plan".to_string()), Box::new(sink.clone()));

    // `minimal` does not include planning, so it is off.
    let set = GgCapabilitySet::minimal("mock/echo");
    let library = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(&set, &RuntimeSet::new(&library));

    let client = MockClient::with_planning_script("mock/echo");
    let agent = Agent::root("primary");
    let end = agent
        .drive(
            &client,
            "build the game",
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
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            false,
            false,
            false,
            RacLimits::default(),
            None,
        )
        .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();

    // No planning telemetry at all.
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::Planning { .. })),
        "planning off must not emit any Planning event"
    );
    // No Plan-source tokens ever accumulate.
    assert!(
        events.iter().all(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } =>
                source_band(by_source, GgContextSource::Plan) == 0,
            _ => true,
        }),
        "planning off must never account tokens to the Plan source"
    );
    // enter_plan_mode / submit_plan are unknown tools when the capability is off.
    for tool in ["enter_plan_mode", "submit_plan"] {
        assert!(
            events.iter().any(|e| matches!(
                &e.kind,
                GgTelemetryKind::ToolResult { name, ok, .. } if name == tool && !*ok
            )),
            "`{tool}` should be an unknown tool when planning is off"
        );
    }
    // The run still completes and implements the file (no read-only mode ever engaged).
    assert!(dir.path().join("index.html").exists());
}

// ---------------------------------------------------------------------------
// Phase 4: the agent abstraction, agent-tagged telemetry, and per-slot accounting
// ---------------------------------------------------------------------------

/// The single-agent run is tagged as the root agent end to end: every emitted event carries
/// `agentId: "root"` and no parent, an `AgentSpawned` announces the root (its slot, model, depth,
/// and no brief) before the loop runs, and a `SlotUsage` rollup for the primary slot is emitted at
/// the end — while the run still builds the artifact exactly as before.
#[tokio::test]
async fn run_tags_events_as_root_and_emits_agent_spawned_and_slot_usage() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-agent".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    // The single-agent run still produced the artifact (the refactor is behavior-preserving).
    assert!(dir.path().join("index.html").exists());

    let events = sink.events();

    // (a) Every event an agent emits carries that agent's id and (for the root) no parent — the
    //     attribution the subagent tree is reconstructed from.
    assert!(
        events
            .iter()
            .all(|e| e.agent_id.as_deref() == Some(ROOT_AGENT_ID) && e.parent_agent_id.is_none()),
        "every event must be tagged with the root agent id and no parent"
    );

    // (b) Exactly one AgentSpawned for the root: primary slot, the resolved mock model, depth 0,
    //     and no brief (the root is driven by the build prompt, not a delegated brief).
    let spawns: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::AgentSpawned {
                slot,
                model_id,
                depth,
                brief,
                worktree,
            } => Some((
                slot.clone(),
                model_id.clone(),
                *depth,
                brief.clone(),
                worktree.clone(),
            )),
            _ => None,
        })
        .collect();
    assert_eq!(spawns.len(), 1, "exactly one AgentSpawned for the root");
    let (slot, model_id, depth, brief, worktree) = &spawns[0];
    assert_eq!(slot, PRIMARY_SLOT);
    assert_eq!(model_id, "mock/echo");
    assert_eq!(*depth, 0);
    assert!(brief.is_none(), "the root carries no delegated brief");
    assert!(
        worktree.is_none(),
        "the root runs in the main tree, not a worktree"
    );

    // The spawn announces the agent before its first turn runs.
    let spawn_pos = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::AgentSpawned { .. }))
        .unwrap();
    let first_turn = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .unwrap();
    assert!(
        spawn_pos < first_turn,
        "AgentSpawned precedes the first turn"
    );

    // (c) A per-slot usage rollup for the primary slot, summing the run's usage and cost, emitted
    //     near the end (after the loop, before the terminal SessionEnded).
    let rollups: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::SlotUsage {
                slot,
                model_id,
                tokens,
                cost,
            } => Some((slot.clone(), model_id.clone(), *tokens, *cost)),
            _ => None,
        })
        .collect();
    assert_eq!(rollups.len(), 1, "one SlotUsage rollup for the one slot");
    let (slot, model_id, tokens, cost) = &rollups[0];
    assert_eq!(slot, PRIMARY_SLOT);
    assert_eq!(model_id, "mock/echo");
    assert!(
        tokens.total().is_some_and(|t| t > 0),
        "the primary-slot rollup sums the run's tokens"
    );
    assert!(
        cost.and_then(|c| c.comparable).is_some_and(|c| c > 0.0),
        "the primary-slot rollup sums the run's cost"
    );

    // The rollup sums the same tokens the per-turn Usage deltas report (it is a rollup, not an
    // extra delta — an ingester sums the deltas, so the two must agree).
    let summed: u64 = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Usage { tokens, .. } => tokens.total(),
            _ => None,
        })
        .sum();
    assert_eq!(
        tokens.total(),
        Some(summed),
        "the SlotUsage rollup equals the sum of the per-turn Usage deltas"
    );

    // The rollup is emitted after the loop (after the last TurnStarted) and before SessionEnded.
    let slot_usage_pos = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::SlotUsage { .. }))
        .unwrap();
    let last_turn = events
        .iter()
        .rposition(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .unwrap();
    let session_end = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::SessionEnded { .. }))
        .unwrap();
    assert!(last_turn < slot_usage_pos && slot_usage_pos < session_end);
}

/// A launch-failure diagnostic (no primary slot bound) is still tagged as the root agent — the
/// stream is agent-attributed from the very first event, before any model is resolved.
#[tokio::test]
async fn run_tags_launch_failure_events_as_root() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-lf".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::default());

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::LaunchFailed);

    let events = sink.events();
    assert!(!events.is_empty());
    assert!(
        events
            .iter()
            .all(|e| e.agent_id.as_deref() == Some(ROOT_AGENT_ID) && e.parent_agent_id.is_none()),
        "even launch-failure diagnostics are tagged as the root agent"
    );
    // No agent ever started running, so no AgentSpawned or SlotUsage is emitted.
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::AgentSpawned { .. }))
    );
    assert!(
        !events
            .iter()
            .any(|e| matches!(e.kind, GgTelemetryKind::SlotUsage { .. }))
    );
}

/// A capability set binding two slots, so slot resolution can be exercised across the
/// multi-model toggle.
fn two_slot_set(primary_model: &str, subagent_model: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(primary_model);
    set.slots
        .push(GgSlotBinding::new("subagent", subagent_model));
    set
}

/// The multi-model toggle decides which slot an agent runs on: on, it runs on the slot it
/// requested; off, every agent collapses to the primary slot (the ablation off arm).
#[test]
fn effective_slot_respects_the_multi_model_toggle() {
    // On: the requested slot is honored.
    assert_eq!(effective_slot("subagent", true), "subagent");
    assert_eq!(effective_slot(PRIMARY_SLOT, true), PRIMARY_SLOT);
    // Off: everything falls back to primary.
    assert_eq!(effective_slot("subagent", false), PRIMARY_SLOT);
    assert_eq!(effective_slot(PRIMARY_SLOT, false), PRIMARY_SLOT);
}

/// Slot resolution picks the binding for the effective slot: with multi-model on a `subagent`
/// request resolves to the subagent model, and with it off the same request collapses to the
/// primary model — one binding-set, two behaviors driven purely by the toggle.
#[test]
fn slot_resolution_picks_the_right_binding_per_toggle() {
    let set = two_slot_set("mock/primary-model", "mock/subagent-model");

    // Multi-model ON: a subagent request resolves to the subagent slot's model.
    let slot = effective_slot("subagent", true);
    assert_eq!(slot, "subagent");
    assert_eq!(
        slot_binding(&set, slot).unwrap().model_id,
        "mock/subagent-model"
    );

    // Multi-model OFF: the same request collapses to primary, resolving the primary model.
    let slot = effective_slot("subagent", false);
    assert_eq!(slot, PRIMARY_SLOT);
    assert_eq!(
        slot_binding(&set, slot).unwrap().model_id,
        "mock/primary-model"
    );

    // A request for an unbound slot is an error naming it.
    let err = slot_binding(&set, "reviewer").unwrap_err();
    assert!(err.contains("reviewer"), "the error names the missing slot");
}

/// Slot-binding validation rejects the launch-blocking misconfigurations and accepts a good set.
#[test]
fn validate_slots_enforces_the_binding_invariants() {
    // A good set (primary bound, unique, non-empty) validates.
    assert!(validate_slots(&GgCapabilitySet::minimal("mock/echo")).is_ok());
    assert!(validate_slots(&two_slot_set("mock/a", "mock/b")).is_ok());

    // No primary slot bound: nothing to run.
    let no_primary = GgCapabilitySet {
        preset: None,
        capabilities: Vec::new(),
        slots: vec![GgSlotBinding::new("subagent", "mock/b")],
        disabled_tools: Vec::new(),
    };
    assert!(
        validate_slots(&no_primary)
            .unwrap_err()
            .contains(PRIMARY_SLOT)
    );

    // A duplicate slot name is ambiguous.
    let dup = GgCapabilitySet {
        preset: None,
        capabilities: Vec::new(),
        slots: vec![
            GgSlotBinding::new(PRIMARY_SLOT, "mock/a"),
            GgSlotBinding::new(PRIMARY_SLOT, "mock/b"),
        ],
        disabled_tools: Vec::new(),
    };
    assert!(validate_slots(&dup).unwrap_err().contains("more than once"));

    // An empty model id or slot name is rejected.
    let empty_model = GgCapabilitySet {
        preset: None,
        capabilities: Vec::new(),
        slots: vec![GgSlotBinding::new(PRIMARY_SLOT, "")],
        disabled_tools: Vec::new(),
    };
    assert!(validate_slots(&empty_model).is_err());
    let empty_slot = GgCapabilitySet {
        preset: None,
        capabilities: Vec::new(),
        slots: vec![GgSlotBinding::new("", "mock/a")],
        disabled_tools: Vec::new(),
    };
    assert!(validate_slots(&empty_slot).is_err());
}

/// Per-slot accounting keys on `(slot, model)`: usage on the same slot/model accumulates, a
/// different model on the same slot is a separate rollup, and the emitted `SlotUsage` events
/// mirror the recorded entries in first-seen order.
#[test]
fn slot_accounting_sums_per_slot_and_model() {
    let counts = |input: u64, output: u64| TokenCounts {
        uncached_input: Some(input),
        cached_input: None,
        output: Some(output),
        reasoning: None,
    };
    let cost = |c: f64| {
        Some(Cost {
            comparable: Some(c),
            actual: Some(c),
        })
    };

    let mut acc = SlotAccounting::default();
    // Two records on the same (slot, model) accumulate.
    acc.record(PRIMARY_SLOT, "mock/opus", counts(100, 10), cost(0.01));
    acc.record(PRIMARY_SLOT, "mock/opus", counts(50, 5), cost(0.02));
    // A different model on the same slot is its own rollup (a re-pointed slot stays attributable).
    acc.record("subagent", "mock/haiku", counts(30, 3), cost(0.001));

    let events = acc.slot_usage_events();
    assert_eq!(events.len(), 2, "two (slot, model) rollups");

    match &events[0] {
        GgTelemetryKind::SlotUsage {
            slot,
            model_id,
            tokens,
            cost,
        } => {
            assert_eq!(slot, PRIMARY_SLOT);
            assert_eq!(model_id, "mock/opus");
            assert_eq!(tokens.uncached_input, Some(150));
            assert_eq!(tokens.output, Some(15));
            assert_eq!(tokens.total(), Some(165));
            assert_eq!(cost.unwrap().comparable, Some(0.03));
        }
        other => panic!("expected the primary/opus rollup first, got {other:?}"),
    }
    match &events[1] {
        GgTelemetryKind::SlotUsage {
            slot,
            model_id,
            tokens,
            ..
        } => {
            assert_eq!(slot, "subagent");
            assert_eq!(model_id, "mock/haiku");
            assert_eq!(tokens.total(), Some(33));
        }
        other => panic!("expected the subagent/haiku rollup second, got {other:?}"),
    }
}

/// With multi-model off, a run that also binds a non-primary slot still resolves the root to the
/// primary model — the toggle (default off) forces the primary slot, and the AgentSpawned reports
/// it. This is the ablation off arm at the `run` level.
#[tokio::test]
async fn run_forces_primary_slot_when_multi_model_off() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-mm-off".to_string()), Box::new(sink.clone()));
    // Two slots bound, but multi-model is not enabled (it is opt-in, absent from `minimal`).
    let set = two_slot_set("mock/primary-model", "mock/subagent-model");
    assert!(!set.is_enabled(CAPABILITY_MULTI_MODEL));
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let events = sink.events();
    let (slot, model_id) = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::AgentSpawned { slot, model_id, .. } => {
                Some((slot.clone(), model_id.clone()))
            }
            _ => None,
        })
        .expect("an AgentSpawned was emitted");
    assert_eq!(slot, PRIMARY_SLOT, "the root runs on the primary slot");
    assert_eq!(
        model_id, "mock/primary-model",
        "with multi-model off the root resolves the primary model"
    );
}

// ---------------------------------------------------------------------------
// Phase 4b: subagents — the scheduler, spawn/wait/return, messaging, recursion
// ---------------------------------------------------------------------------

/// A per-slot client producer: mints a fresh client for a binding (each subagent needs its own
/// script cursor).
type ClientProducer = Box<dyn Fn(&GgSlotBinding) -> Box<dyn ModelClient> + Send + Sync>;

/// A per-slot client factory for the subagent e2es: each bound slot maps to a
/// [producer](ClientProducer). An unmapped slot gets an empty-script mock (which finishes
/// immediately).
struct ScriptedFactory {
    producers: HashMap<String, ClientProducer>,
}

impl ScriptedFactory {
    fn new() -> Self {
        Self {
            producers: HashMap::new(),
        }
    }

    fn slot(
        mut self,
        slot: &str,
        producer: impl Fn(&GgSlotBinding) -> Box<dyn ModelClient> + Send + Sync + 'static,
    ) -> Self {
        self.producers.insert(slot.to_string(), Box::new(producer));
        self
    }
}

impl ClientFactory for ScriptedFactory {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        match self.producers.get(&binding.slot) {
            Some(producer) => Ok(producer(binding)),
            None => Ok(Box::new(MockClient::new(
                binding.model_id.clone(),
                Vec::new(),
            ))),
        }
    }
}

/// A capability set with subagents (`maxParallel`/`maxDepth`) and multi-model enabled on top of the
/// minimal defaults, plus a binding for each named `extra_slot` (`mock/<slot>`).
fn subagent_set(max_parallel: u64, max_depth: u64, extra_slots: &[&str]) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_MULTI_MODEL));
    let mut subagents = GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS);
    subagents.params = json!({ "maxParallel": max_parallel, "maxDepth": max_depth });
    set.capabilities.push(subagents);
    for slot in extra_slots {
        set.slots
            .push(GgSlotBinding::new(*slot, format!("mock/{slot}")));
    }
    set
}

/// Every `AgentSpawned` in the stream, as `(agentId, parentId, slot, depth, brief)`.
type Spawn = (Option<String>, Option<String>, String, u64, Option<String>);
fn agent_spawns(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<Spawn> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::AgentSpawned {
                slot, depth, brief, ..
            } => Some((
                e.agent_id.clone(),
                e.parent_agent_id.clone(),
                slot.clone(),
                *depth,
                brief.clone(),
            )),
            _ => None,
        })
        .collect()
}

/// The subagent tools are only offered when the capability is on — the ablation off arm.
#[test]
fn subagent_tools_are_gated_on_the_capability() {
    let names = ["spawn_subagent", "wait_for_subagents", "send_message"];

    // Off (minimal has no subagents): none offered.
    let off = ToolRegistry::from_capabilities(&GgCapabilitySet::minimal("mock/echo"));
    for name in names {
        assert!(
            !off.definitions().iter().any(|d| d.name == name),
            "`{name}` must not be offered when subagents is off"
        );
    }

    // On: all three offered.
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS));
    let on = ToolRegistry::from_capabilities(&set);
    for name in names {
        assert!(
            on.definitions().iter().any(|d| d.name == name),
            "`{name}` must be offered when subagents is on"
        );
    }
}

/// The headline offline e2e under a cap of **1**: the root spawns a child on a different slot,
/// blocks to wait on it (freeing its slot so the child can run — cap=1 could not run the child
/// otherwise), the child does a bit of work and returns a value, and the root collects it. This
/// exercises spawn → schedule → run → return and the blocked-frees-slot rule together.
#[tokio::test]
async fn run_spawns_a_subagent_that_runs_under_cap_one_and_returns() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-sub".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), subagent_set(1, 3, &["subagent"]));
    let factory = ScriptedFactory::new()
        .slot("primary", |b| {
            Box::new(MockClient::with_subagent_parent_script(&b.model_id))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::with_subagent_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    // The child actually ran in the shared workspace.
    assert!(
        dir.path().join(MOCK_SUBAGENT_FILE).exists(),
        "the subagent wrote its file, so it ran"
    );

    let events = sink.events();

    // Two agents spawned: the root (depth 0, no brief) and one child (depth 1, on the subagent
    // slot, parented at root, carrying a brief).
    let spawns = agent_spawns(&events);
    assert_eq!(spawns.len(), 2, "the root and exactly one child");
    assert!(
        spawns.iter().any(
            |(id, parent, slot, depth, brief)| id.as_deref() == Some(ROOT_AGENT_ID)
                && parent.is_none()
                && slot == PRIMARY_SLOT
                && *depth == 0
                && brief.is_none()
        ),
        "the root spawn is depth 0 on primary with no brief"
    );
    let (child_id, child_parent, child_slot, child_depth, child_brief) = spawns
        .iter()
        .find(|(_, _, _, depth, _)| *depth == 1)
        .expect("a depth-1 child spawn");
    assert_eq!(child_id.as_deref(), Some("agent-0"));
    assert_eq!(child_parent.as_deref(), Some(ROOT_AGENT_ID));
    assert_eq!(child_slot, "subagent");
    assert_eq!(*child_depth, 1);
    assert!(
        child_brief.is_some(),
        "the child carries its dispatched brief"
    );

    // The child returned its distinctive value on its own stream, attributed to it and its parent.
    let (ret_id, ret_parent, ret_summary) = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::AgentReturned { summary } => Some((
                e.agent_id.clone(),
                e.parent_agent_id.clone(),
                summary.clone(),
            )),
            _ => None,
        })
        .expect("the child emitted AgentReturned");
    assert_eq!(ret_id.as_deref(), Some("agent-0"));
    assert_eq!(ret_parent.as_deref(), Some(ROOT_AGENT_ID));
    assert_eq!(
        ret_summary, MOCK_SUBAGENT_RETURN,
        "its final message is the return value"
    );

    // The parent collected the result (a successful wait).
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: true, .. } if name == "wait_for_subagents"
        )),
        "the parent's wait_for_subagents succeeded"
    );

    // Blocked-frees-slot under cap=1: the child could only start after the parent freed its slot by
    // blocking, so the parent's Blocked transition precedes the child's spawn.
    let parent_blocked = events
        .iter()
        .position(|e| {
            e.agent_id.as_deref() == Some(ROOT_AGENT_ID)
                && matches!(
                    e.kind,
                    GgTelemetryKind::AgentStatus {
                        status: GgAgentStatus::Blocked
                    }
                )
        })
        .expect("the root blocked while waiting");
    let child_started = events
        .iter()
        .position(|e| {
            e.agent_id.as_deref() == Some("agent-0")
                && matches!(e.kind, GgTelemetryKind::AgentSpawned { .. })
        })
        .expect("the child started");
    assert!(
        parent_blocked < child_started,
        "under cap=1 the child starts only after the parent frees its slot by blocking"
    );

    // Per-slot accounting spans both models: a rollup for each of the primary and subagent slots.
    let rollups: Vec<_> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::SlotUsage { slot, model_id, .. } => {
                Some((slot.clone(), model_id.clone()))
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        rollups.len(),
        2,
        "one rollup per (slot, model) the run touched"
    );
    assert!(
        rollups
            .iter()
            .any(|(slot, model)| slot == PRIMARY_SLOT && model == "mock/primary")
    );
    assert!(
        rollups
            .iter()
            .any(|(slot, model)| slot == "subagent" && model == "mock/subagent")
    );

    // The session completed.
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// A spawn at the maximum depth is **refused** (a tool error to the model), not queued: with
/// `maxDepth = 1`, the root's child (depth 1) cannot spawn deeper, and no depth-2 agent appears.
#[tokio::test]
async fn spawn_is_refused_at_the_max_depth() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-depth".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), subagent_set(4, 1, &["subagent", "worker"]));

    // The child tries to spawn a grandchild on the `worker` slot — refused by the depth cap.
    let child_tries_to_spawn = || -> Box<dyn ModelClient> {
        let attempt = ModelResponse {
            text: Some("Trying to delegate deeper.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_deep".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({ "prompt": "do the sub-sub work", "slot": "worker" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        };
        Box::new(MockClient::new(
            "mock/subagent",
            vec![attempt, stop_response()],
        ))
    };
    let factory = ScriptedFactory::new()
        .slot("primary", |b| {
            Box::new(MockClient::with_subagent_parent_script(&b.model_id))
        })
        .slot("subagent", move |_| child_tries_to_spawn());

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();

    // Only the root (depth 0) and its one child (depth 1) were spawned — the grandchild was refused.
    let spawns = agent_spawns(&events);
    assert_eq!(spawns.len(), 2, "no agent spawns past the depth cap");
    assert!(
        !spawns.iter().any(|(_, _, _, depth, _)| *depth >= 2),
        "no depth-2 agent may exist under maxDepth=1"
    );

    // The child's spawn attempt was refused with a depth-cap error (on the child's stream).
    assert!(
        events
            .iter()
            .any(|e| e.agent_id.as_deref() == Some("agent-0")
                && matches!(
                    &e.kind,
                    GgTelemetryKind::ToolResult { name, ok: false, summary: Some(s) }
                        if name == "spawn_subagent" && s.contains("maximum delegation depth")
                )),
        "the deeper spawn is refused with a depth-cap message"
    );
}

/// Recursion: with a generous depth cap, a subagent can itself spawn a subagent. The root spawns a
/// child on `subagent`, which spawns a grandchild on `worker`, which does the work — three agents at
/// depths 0, 1, 2.
#[tokio::test]
async fn subagents_recurse_within_the_depth_cap() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-rec".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), subagent_set(4, 3, &["subagent", "worker"]));

    // The mid-level child spawns a grandchild on `worker`, waits for it, then finishes.
    let child_spawns_grandchild = || -> Box<dyn ModelClient> {
        let spawn = ModelResponse {
            text: Some("Delegating deeper to a worker.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_gspawn".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({ "prompt": "do the leaf work", "slot": "worker" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        };
        let wait = ModelResponse {
            text: Some("Waiting for the worker.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_gwait".to_string(),
                name: "wait_for_subagents".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        };
        Box::new(MockClient::new(
            "mock/subagent",
            vec![spawn, wait, stop_response()],
        ))
    };

    let factory = ScriptedFactory::new()
        .slot("primary", |b| {
            Box::new(MockClient::with_subagent_parent_script(&b.model_id))
        })
        .slot("subagent", move |_| child_spawns_grandchild())
        .slot("worker", |b| {
            Box::new(MockClient::with_subagent_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    // The leaf grandchild ran (wrote the file).
    assert!(
        dir.path().join(MOCK_SUBAGENT_FILE).exists(),
        "the depth-2 grandchild did the work"
    );

    let events = sink.events();
    let spawns = agent_spawns(&events);
    assert_eq!(spawns.len(), 3, "root, child, grandchild");
    let depths: HashSet<u64> = spawns.iter().map(|(_, _, _, depth, _)| *depth).collect();
    assert_eq!(
        depths,
        HashSet::from([0, 1, 2]),
        "one agent at each depth 0..=2"
    );

    // The grandchild (depth 2, on the worker slot) is parented at the mid-level child.
    let (gc_id, gc_parent, gc_slot, _, _) = spawns
        .iter()
        .find(|(_, _, _, depth, _)| *depth == 2)
        .expect("a depth-2 grandchild");
    assert_eq!(gc_slot, "worker");
    assert_eq!(
        gc_id.as_deref(),
        Some("agent-1"),
        "the second spawn minted agent-1"
    );
    assert_eq!(
        gc_parent.as_deref(),
        Some("agent-0"),
        "parented at the mid-level child"
    );
}

/// A client that reports, in its single final message, whether it saw a sentinel string in its
/// context — used to prove a `send_message` reached a running child and affected its output.
struct InboxProbeClient;

#[async_trait::async_trait]
impl ModelClient for InboxProbeClient {
    async fn complete(
        &self,
        messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        let saw_ping = messages.iter().any(|m| {
            m.content
                .as_deref()
                .is_some_and(|content| content.contains("PARENT_PING"))
        });
        let text = if saw_ping {
            "child received PARENT_PING from its parent".to_string()
        } else {
            "child received no message".to_string()
        };
        Ok(ModelResponse {
            text: Some(text),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: TokenCounts::default(),
            cost: None,
        })
    }

    fn model_id(&self) -> &str {
        "mock/subagent"
    }
}

/// A parent can message a running subagent, and the message reaches it: the child injects the
/// parent's message at its turn boundary, so its (message-sensitive) output reflects it.
#[tokio::test]
async fn send_message_reaches_a_running_subagent_and_affects_it() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-msg".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), subagent_set(2, 3, &["subagent"]));

    // The parent spawns a child, messages it (before it runs — the message buffers in the inbox),
    // then waits for it.
    let parent_messages_child = || -> Box<dyn ModelClient> {
        let spawn = ModelResponse {
            text: Some("Spawning a child to probe.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_spawn".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({ "prompt": "await instructions", "slot": "subagent" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        };
        let message = ModelResponse {
            text: Some("Guiding the child.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_msg".to_string(),
                name: "send_message".to_string(),
                arguments: json!({ "agentId": "agent-0", "message": "PARENT_PING: focus on X" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        };
        let wait = ModelResponse {
            text: Some("Waiting for the child.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_wait".to_string(),
                name: "wait_for_subagents".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        };
        Box::new(MockClient::new(
            "mock/primary",
            vec![spawn, message, wait, stop_response()],
        ))
    };

    let factory = ScriptedFactory::new()
        .slot("primary", move |_| parent_messages_child())
        .slot("subagent", |_| Box::new(InboxProbeClient));

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();

    // The send succeeded.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: true, .. } if name == "send_message"
        )),
        "send_message to the running child succeeded"
    );

    // The child saw the message and reflected it in its return value — proving the live channel.
    let summary = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::AgentReturned { summary }
                if e.agent_id.as_deref() == Some("agent-0") =>
            {
                Some(summary.clone())
            }
            _ => None,
        })
        .expect("the child returned");
    assert!(
        summary.contains("PARENT_PING"),
        "the child received and acted on the parent's message (got: {summary:?})"
    );
}

/// Messaging an agent that is not one of your subagents, or one that has already returned, is
/// refused with guidance rather than delivered.
#[tokio::test]
async fn send_message_refuses_unknown_and_finished_targets() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-msg-err".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), subagent_set(2, 3, &["subagent"]));

    // The parent spawns a child, waits for it to finish, THEN messages it (too late) and also
    // messages a never-spawned id.
    let parent = || -> Box<dyn ModelClient> {
        let spawn = ModelResponse {
            text: Some("spawn".to_string()),
            tool_calls: vec![ToolCall {
                id: "s".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({ "prompt": "quick work", "slot": "subagent" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        };
        let wait = ModelResponse {
            text: Some("wait".to_string()),
            tool_calls: vec![ToolCall {
                id: "w".to_string(),
                name: "wait_for_subagents".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        };
        let msg_finished = ModelResponse {
            text: Some("message the finished child".to_string()),
            tool_calls: vec![ToolCall {
                id: "m1".to_string(),
                name: "send_message".to_string(),
                arguments: json!({ "agentId": "agent-0", "message": "too late" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        };
        let msg_unknown = ModelResponse {
            text: Some("message a stranger".to_string()),
            tool_calls: vec![ToolCall {
                id: "m2".to_string(),
                name: "send_message".to_string(),
                arguments: json!({ "agentId": "agent-99", "message": "who are you" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        };
        Box::new(MockClient::new(
            "mock/primary",
            vec![spawn, wait, msg_finished, msg_unknown, stop_response()],
        ))
    };

    let factory = ScriptedFactory::new()
        .slot("primary", move |_| parent())
        .slot("subagent", |b| {
            Box::new(MockClient::with_subagent_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let refusals: Vec<String> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ToolResult {
                name,
                ok: false,
                summary: Some(s),
            } if name == "send_message" => Some(s.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(refusals.len(), 2, "both messages are refused");
    assert!(
        refusals.iter().any(|s| s.contains("already returned")),
        "messaging a finished child is refused"
    );
    assert!(
        refusals
            .iter()
            .any(|s| s.contains("not one of your subagents")),
        "messaging an unknown agent is refused"
    );
}

// ---------------------------------------------------------------------------
// Phase 4b: worktrees — isolated per-subagent copies, merged back or discarded
// ---------------------------------------------------------------------------

/// [`subagent_set`], plus the (opt-in) worktrees capability enabled — an isolated-worktree run.
fn worktree_subagent_set(
    max_parallel: u64,
    max_depth: u64,
    extra_slots: &[&str],
) -> GgCapabilitySet {
    let mut set = subagent_set(max_parallel, max_depth, extra_slots);
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_WORKTREES));
    set
}

/// The headline offline worktrees e2e: the worktrees capability commits a baseline, a subagent is
/// dispatched with `worktree: true` (so it runs in an isolated copy — its `AgentSpawned` carries a
/// worktree branch), mutates a file there, and on clean completion its branch is **merged back**
/// into the main tree, so the file appears in the workspace and a `WorktreeMerged{merged}` outcome
/// is emitted. The worktree checkout is torn down afterward.
#[tokio::test]
async fn run_spawns_a_worktree_subagent_that_isolates_then_merges_back() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-wt".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), worktree_subagent_set(1, 3, &["subagent"]));
    let factory = ScriptedFactory::new()
        .slot("primary", |b| {
            Box::new(MockClient::with_worktree_subagent_parent_script(
                &b.model_id,
            ))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::with_subagent_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    // The worktrees capability made the workspace a git repo with a baseline commit.
    assert!(
        dir.path().join(".git").exists(),
        "the worktrees capability commits a baseline, making the workspace a repo"
    );

    let events = sink.events();

    // The child ran in an isolated worktree: its AgentSpawned carries a worktree branch, and the
    // root's does not.
    let spawns = agent_spawns(&events);
    assert_eq!(spawns.len(), 2, "the root and one worktree child");
    let child_worktree = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::AgentSpawned {
                worktree, depth, ..
            } if *depth == 1 => Some(worktree.clone()),
            _ => None,
        })
        .expect("a depth-1 child was spawned");
    assert_eq!(
        child_worktree.as_deref(),
        Some("gg/agent-0"),
        "the worktree child announces its isolated branch"
    );
    let root_worktree = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::AgentSpawned {
                worktree, depth, ..
            } if *depth == 0 => Some(worktree.clone()),
            _ => None,
        })
        .expect("the root was spawned");
    assert_eq!(
        root_worktree, None,
        "the root runs in the main tree, not a worktree"
    );

    // Merge-back: the child mutated its isolated copy, and its work now appears in the main tree.
    assert_eq!(
        std::fs::read_to_string(dir.path().join(MOCK_SUBAGENT_FILE)).ok(),
        Some("hello from the subagent\n".to_string()),
        "the worktree child's file is merged back into the main tree"
    );

    // A clean merge outcome is observable on the child's own stream.
    let merge = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::WorktreeMerged {
                branch,
                merged,
                conflicts,
            } => Some((e.agent_id.clone(), branch.clone(), *merged, *conflicts)),
            _ => None,
        })
        .expect("a WorktreeMerged outcome was emitted");
    assert_eq!(merge.0.as_deref(), Some("agent-0"), "on the child's stream");
    assert_eq!(merge.1, "gg/agent-0");
    assert!(merge.2, "the clean completion merged back");
    assert!(!merge.3, "a clean merge has no conflicts");

    // The child still returned its distinctive value to the parent.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::AgentReturned { summary } if summary.contains(MOCK_SUBAGENT_RETURN)
        )),
        "the worktree child still returns its value"
    );

    // The worktree checkout was torn down: the per-agent checkout under the sibling root is gone.
    let root = worktrees_root_for(dir.path());
    assert!(
        !root.join("agent-0").exists(),
        "the worktree checkout is removed after the subagent finishes"
    );

    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// With the worktrees capability **off**, a `worktree: true` dispatch is **refused** (a tool error
/// to the model) rather than silently downgraded: no child is spawned, nothing is written, and the
/// run is otherwise unaffected. The ablation off arm.
#[tokio::test]
async fn worktree_dispatch_is_refused_without_the_capability() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-nowt".to_string()), Box::new(sink.clone()));
    // subagents + multi-model, but NOT worktrees.
    let inv = invocation(dir.path(), subagent_set(4, 3, &["subagent"]));
    let factory = ScriptedFactory::new()
        .slot("primary", |b| {
            Box::new(MockClient::with_worktree_subagent_parent_script(
                &b.model_id,
            ))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::with_subagent_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();

    // The spawn was refused with guidance naming the worktrees capability.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, summary: Some(s) }
                if name == "spawn_subagent" && s.contains("worktrees")
        )),
        "a worktree dispatch without the capability is refused, naming the capability"
    );

    // No child was ever spawned (only the root's AgentSpawned), and nothing was written.
    let spawns = agent_spawns(&events);
    assert_eq!(
        spawns.len(),
        1,
        "only the root — the worktree child was refused"
    );
    assert!(
        !dir.path().join(MOCK_SUBAGENT_FILE).exists(),
        "the refused child never ran, so it wrote nothing"
    );
    // No worktrees capability means no baseline repo is created.
    assert!(
        !dir.path().join(".git").exists(),
        "no baseline repo without the worktrees capability"
    );

    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// A worktree subagent that does **not** complete cleanly (here it writes work, then fails with a
/// model error) is **discarded**: its work is not merged back into the main tree, and a
/// `WorktreeMerged` outcome with neither merge nor conflict records the discard. The worktree is
/// still torn down.
#[tokio::test]
async fn worktree_subagent_work_is_discarded_when_it_does_not_complete() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-wt-discard".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), worktree_subagent_set(1, 3, &["subagent"]));

    // The child writes a file into its worktree on turn 0, then its model turn fails — a non-clean
    // completion (`model_error`) whose work must be discarded, not merged.
    let child_writes_then_fails = || -> Box<dyn ModelClient> {
        Box::new(WriteThenFailClient::new(
            MOCK_SUBAGENT_FILE,
            "unmerged work\n",
        ))
    };
    let factory = ScriptedFactory::new()
        .slot("primary", |b| {
            Box::new(MockClient::with_worktree_subagent_parent_script(
                &b.model_id,
            ))
        })
        .slot("subagent", move |_| child_writes_then_fails());

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();

    // The child's isolated work was discarded — it never reaches the main tree.
    assert!(
        !dir.path().join(MOCK_SUBAGENT_FILE).exists(),
        "a non-clean worktree subagent's work is discarded, not merged"
    );

    // The discard is observable: WorktreeMerged with neither merged nor conflicts.
    let merge = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::WorktreeMerged {
                merged, conflicts, ..
            } => Some((*merged, *conflicts)),
            _ => None,
        })
        .expect("a WorktreeMerged outcome was emitted for the discard");
    assert_eq!(
        merge,
        (false, false),
        "a discard neither merges nor conflicts"
    );

    // The worktree checkout was still torn down.
    let root = worktrees_root_for(dir.path());
    assert!(
        !root.join("agent-0").exists(),
        "the worktree is removed even on a discard"
    );
}

// ---------------------------------------------------------------------------
// Phase 4d: declared workflows — fan-out + sequencing over the same scheduler
// ---------------------------------------------------------------------------

/// [`subagent_set`], plus the (opt-in) workflows capability enabled — a declared-workflow run.
fn workflow_set(max_parallel: u64, max_depth: u64, extra_slots: &[&str]) -> GgCapabilitySet {
    let mut set = subagent_set(max_parallel, max_depth, extra_slots);
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_WORKFLOWS));
    set
}

/// A `worker`-slot client producer whose n-th client (minted in dispatch order) writes `part-N.txt`
/// and returns the distinctive value `part N built` — so a fan-out over N items leaves N distinct
/// files and N distinct return values, and a later stage's `{{prior}}` brief can be checked to
/// contain them (the sequencing proof). The counter increments when the factory mints the client,
/// which happens synchronously in dispatch order, so `N` is deterministic per dispatched agent
/// regardless of when the agents actually run.
fn counting_worker() -> impl Fn(&GgSlotBinding) -> Box<dyn ModelClient> + Send + Sync + 'static {
    let counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    move |_b: &GgSlotBinding| {
        let n = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let write = ModelResponse {
            text: Some(format!("building part {n}")),
            tool_calls: vec![ToolCall {
                id: format!("call_part_{n}"),
                name: "write_file".to_string(),
                arguments: json!({
                    "path": format!("part-{n}.txt"),
                    "contents": format!("component {n}\n"),
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        };
        let finish = ModelResponse {
            text: Some(format!("part {n} built")),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: TokenCounts::default(),
            cost: None,
        };
        Box::new(MockClient::new("mock/worker", vec![write, finish]))
    }
}

/// Every `WorkflowStage` in the stream, as `(workflowId, stage, stageIndex, itemCount, phase)`.
type StageEvent = (String, String, u64, u64, GgWorkflowPhase);
fn workflow_stages(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<StageEvent> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::WorkflowStage {
                workflow_id,
                stage,
                stage_index,
                item_count,
                phase,
            } => Some((
                workflow_id.clone(),
                stage.clone(),
                *stage_index,
                *item_count,
                *phase,
            )),
            _ => None,
        })
        .collect()
}

/// The `run_workflow` tool is only offered when the workflows capability is on — the ablation off
/// arm. It is gated independently of subagents (a run may declare workflows without ad-hoc spawn).
#[test]
fn run_workflow_tool_is_gated_on_the_workflows_capability() {
    // Off (minimal has no workflows): not offered.
    let off = ToolRegistry::from_capabilities(&GgCapabilitySet::minimal("mock/echo"));
    assert!(
        !off.definitions().iter().any(|d| d.name == "run_workflow"),
        "run_workflow must not be offered when workflows is off"
    );

    // On: offered — even without the subagents capability, since workflows carries its own runtime.
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_WORKFLOWS));
    let on = ToolRegistry::from_capabilities(&set);
    assert!(
        on.definitions().iter().any(|d| d.name == "run_workflow"),
        "run_workflow must be offered when workflows is on"
    );
}

/// The headline declared-workflow e2e: a two-stage workflow fans a subagent out over two items in
/// stage one, then **sequences** their results into a single consolidating subagent in stage two —
/// all driven over the same subagent scheduler. Proves fan-out (three depth-1 agents ran and left
/// three distinct files), sequencing (the stage-two brief carries stage one's two results), the
/// stage-boundary telemetry, and the final results returned to the caller.
#[tokio::test]
async fn run_workflow_fans_out_then_sequences_and_returns_final_results() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-wf".to_string()), Box::new(sink.clone()));
    // Cap of 2 so stage one's two subagents genuinely run in parallel under the global cap.
    let inv = invocation(dir.path(), workflow_set(2, 3, &["worker"]));
    let factory = ScriptedFactory::new()
        .slot("primary", |b| {
            Box::new(MockClient::with_workflow_parent_script(&b.model_id))
        })
        .slot("worker", counting_worker());

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();

    // Fan-out + sequencing left three distinct files: two from stage one, one from stage two.
    for n in 0..3 {
        assert!(
            dir.path().join(format!("part-{n}.txt")).exists(),
            "each workflow subagent (fan-out + the sequencing stage) ran and wrote its file"
        );
    }

    // Four agents spawned: the root plus three workflow subagents, all at depth 1 under the root.
    let spawns = agent_spawns(&events);
    assert_eq!(spawns.len(), 4, "the root and three workflow subagents");
    let depth_one: Vec<&Spawn> = spawns.iter().filter(|(_, _, _, d, _)| *d == 1).collect();
    assert_eq!(depth_one.len(), 3, "three fanned-out subagents at depth 1");
    assert!(
        depth_one
            .iter()
            .all(
                |(_, parent, slot, _, brief)| parent.as_deref() == Some(ROOT_AGENT_ID)
                    && slot == "worker"
                    && brief.is_some()
            ),
        "every workflow subagent is a depth-1 child of the root on the worker slot with a brief"
    );

    // Sequencing: the stage-two ("assemble") subagent's brief carries both stage-one results, so
    // stage A's results fed stage B.
    let assemble_brief = depth_one
        .iter()
        .find_map(|(_, _, _, _, brief)| {
            brief
                .clone()
                .filter(|b| b.contains("Assemble the finished components"))
        })
        .expect("the sequencing (assemble) subagent was dispatched");
    assert!(
        assemble_brief.contains("part 0 built") && assemble_brief.contains("part 1 built"),
        "the sequencing stage's brief threads stage one's results in (got: {assemble_brief:?})"
    );

    // Stage-boundary telemetry: each stage emits a Started and a Finished under one workflow id, in
    // order, with the right names and fan-out counts.
    let stages = workflow_stages(&events);
    assert_eq!(stages.len(), 4, "two stages, each a Started and a Finished");
    let workflow_id = &stages[0].0;
    assert!(
        stages.iter().all(|(id, ..)| id == workflow_id),
        "all stage events share one workflow id"
    );
    assert_eq!(
        stages[0],
        (
            workflow_id.clone(),
            "generate".to_string(),
            0,
            2,
            GgWorkflowPhase::Started
        )
    );
    assert_eq!(
        stages[1],
        (
            workflow_id.clone(),
            "generate".to_string(),
            0,
            2,
            GgWorkflowPhase::Finished
        )
    );
    assert_eq!(
        stages[2],
        (
            workflow_id.clone(),
            "assemble".to_string(),
            1,
            1,
            GgWorkflowPhase::Started
        )
    );
    assert_eq!(
        stages[3],
        (
            workflow_id.clone(),
            "assemble".to_string(),
            1,
            1,
            GgWorkflowPhase::Finished
        )
    );
    // The stage events all ride on the invoking (root) agent's stream.
    assert!(
        events
            .iter()
            .all(|e| !matches!(e.kind, GgTelemetryKind::WorkflowStage { .. })
                || e.agent_id.as_deref() == Some(ROOT_AGENT_ID)),
        "workflow stage events are attributed to the agent that ran the workflow"
    );

    // Ordering: stage one starts before its subagents spawn, and stage one finishes before stage
    // two starts (sequencing).
    let generate_started = events
        .iter()
        .position(|e| matches!(&e.kind, GgTelemetryKind::WorkflowStage { stage, phase: GgWorkflowPhase::Started, .. } if stage == "generate"))
        .unwrap();
    let first_child_spawn = events
        .iter()
        .position(|e| {
            e.agent_id.as_deref() == Some("agent-0")
                && matches!(e.kind, GgTelemetryKind::AgentSpawned { .. })
        })
        .unwrap();
    let generate_finished = events
        .iter()
        .position(|e| matches!(&e.kind, GgTelemetryKind::WorkflowStage { stage, phase: GgWorkflowPhase::Finished, .. } if stage == "generate"))
        .unwrap();
    let assemble_started = events
        .iter()
        .position(|e| matches!(&e.kind, GgTelemetryKind::WorkflowStage { stage, phase: GgWorkflowPhase::Started, .. } if stage == "assemble"))
        .unwrap();
    assert!(
        generate_started < first_child_spawn,
        "stage starts before its fan-out"
    );
    assert!(
        generate_finished < assemble_started,
        "stage one finishes before stage two begins"
    );

    // The workflow returned the final stage's result to the caller (a successful run_workflow whose
    // output names the consolidating subagent's return value).
    let workflow_result = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::ToolResult { name, ok, summary } if name == "run_workflow" => {
                Some((*ok, summary.clone()))
            }
            _ => None,
        })
        .expect("run_workflow returned a result");
    assert!(workflow_result.0, "the workflow completed successfully");

    // Per-slot accounting spans both models (primary parent + worker subagents).
    let slots: Vec<String> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::SlotUsage { slot, .. } => Some(slot.clone()),
            _ => None,
        })
        .collect();
    assert!(slots.iter().any(|s| s == PRIMARY_SLOT));
    assert!(slots.iter().any(|s| s == "worker"));

    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// A workflow reuses the **same** global scheduler cap — it gets no separate pool. Under a global
/// cap of **1**, the two stage-one subagents cannot run while the root holds the only slot; the
/// workflow completes only because the root frees its slot when it waits on each stage (exactly like
/// `wait_for_subagents`). A passing run proves both the cap reuse and the blocked-frees-slot rule.
#[tokio::test]
async fn workflow_reuses_the_global_cap_and_completes_under_cap_one() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-wf1".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), workflow_set(1, 3, &["worker"]));
    let factory = ScriptedFactory::new()
        .slot("primary", |b| {
            Box::new(MockClient::with_workflow_parent_script(&b.model_id))
        })
        .slot("worker", counting_worker());

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();

    // The whole workflow still ran to completion under cap=1 (all three subagents' files exist).
    for n in 0..3 {
        assert!(
            dir.path().join(format!("part-{n}.txt")).exists(),
            "under cap=1 every workflow subagent still ran (the parent freed its slot per stage)"
        );
    }
    // Never more than one agent running at a time: the root blocks (frees its slot) before its
    // stage-one subagents can spawn.
    let root_blocked = events
        .iter()
        .position(|e| {
            e.agent_id.as_deref() == Some(ROOT_AGENT_ID)
                && matches!(
                    e.kind,
                    GgTelemetryKind::AgentStatus {
                        status: GgAgentStatus::Blocked
                    }
                )
        })
        .expect("the root blocked while waiting on a stage");
    let first_child_spawn = events
        .iter()
        .position(|e| {
            e.agent_id.as_deref() == Some("agent-0")
                && matches!(e.kind, GgTelemetryKind::AgentSpawned { .. })
        })
        .expect("the first stage subagent spawned");
    assert!(
        root_blocked < first_child_spawn,
        "under cap=1 a workflow subagent starts only after the root frees its slot by blocking"
    );

    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// A workflow composes with worktrees: a stage dispatched with `worktree: true` runs each of its
/// fanned-out subagents in its own isolated worktree, and each subagent's work is merged back into
/// the main tree on clean completion. Proves the two Phase-4B mechanisms stack.
#[tokio::test]
async fn workflow_stage_runs_each_item_in_its_own_worktree() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-wf-wt".to_string()), Box::new(sink.clone()));
    // subagents + multi-model + workflows + worktrees, with the worker slot bound.
    let mut set = workflow_set(2, 3, &["worker"]);
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_WORKTREES));
    let inv = invocation(dir.path(), set);

    // A parent that runs a one-stage workflow fanning two items, each in its own worktree.
    let parent = || -> Box<dyn ModelClient> {
        let run = ModelResponse {
            text: Some("Running an isolated-worktree workflow stage.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_wf".to_string(),
                name: "run_workflow".to_string(),
                arguments: json!({
                    "stages": [
                        {
                            "name": "build",
                            "prompt": "Create the {{item}} part in isolation.",
                            "items": ["alpha", "beta"],
                            "slot": "worker",
                            "worktree": true
                        }
                    ]
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
        };
        Box::new(MockClient::new("mock/primary", vec![run, stop_response()]))
    };
    let factory = ScriptedFactory::new()
        .slot("primary", move |_| parent())
        .slot("worker", counting_worker());

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();

    // The worktrees capability made the workspace a repo.
    assert!(
        dir.path().join(".git").exists(),
        "worktrees committed a baseline"
    );

    // Each fanned-out subagent ran in its own worktree (its AgentSpawned carries a branch) and its
    // work merged back into the main tree.
    let worktree_branches: Vec<String> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::AgentSpawned {
                worktree: Some(b),
                depth,
                ..
            } if *depth == 1 => Some(b.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(
        worktree_branches.len(),
        2,
        "both workflow subagents ran in isolated worktrees"
    );

    // Both parts merged back (each stage subagent completed cleanly).
    for n in 0..2 {
        assert!(
            dir.path().join(format!("part-{n}.txt")).exists(),
            "each worktree subagent's work merged back into the main tree"
        );
    }
    let merges: Vec<bool> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::WorktreeMerged { merged, .. } => Some(*merged),
            _ => None,
        })
        .collect();
    assert_eq!(merges.len(), 2, "one merge outcome per worktree subagent");
    assert!(
        merges.iter().all(|m| *m),
        "both worktree stages merged cleanly"
    );

    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// The template renderer substitutes `{{item}}`/`{{prior}}` (tolerating inner whitespace) and
/// leaves an unknown placeholder verbatim, so a legitimate `{{…}}` in a brief is never mangled.
#[test]
fn render_template_substitutes_known_placeholders_only() {
    assert_eq!(
        render_template("build {{item}} using {{prior}}", "X", "prior-text"),
        "build X using prior-text"
    );
    assert_eq!(render_template("hi {{ item }}", "Y", ""), "hi Y");
    assert_eq!(
        render_template("keep {{unknown}} as is", "X", "P"),
        "keep {{unknown}} as is"
    );
    assert_eq!(
        render_template("no placeholders", "X", "P"),
        "no placeholders"
    );
}

/// A workflow declaration with no stages, a stage with no prompt, or a non-array `stages` is
/// refused with a model-facing error rather than silently doing nothing.
#[test]
fn parse_workflow_stages_rejects_malformed_declarations() {
    assert!(parse_workflow_stages(&json!({})).is_err(), "missing stages");
    assert!(
        parse_workflow_stages(&json!({ "stages": [] })).is_err(),
        "empty stages"
    );
    assert!(
        parse_workflow_stages(&json!({ "stages": [{ "items": ["a"] }] })).is_err(),
        "a stage needs a prompt"
    );
    assert!(
        parse_workflow_stages(&json!({ "stages": "nope" })).is_err(),
        "stages must be an array"
    );
    // A well-formed declaration parses, defaulting name/slot and reading items.
    let parsed = parse_workflow_stages(&json!({
        "stages": [{ "prompt": "do {{item}}", "items": ["a", "b"] }]
    }))
    .expect("a well-formed stage parses");
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].name, "stage-1");
    assert_eq!(parsed[0].slot, PRIMARY_SLOT);
    assert_eq!(
        parsed[0].items.as_deref(),
        Some(&["a".to_string(), "b".to_string()][..])
    );
}

// ---------------------------------------------------------------------------
// Phase 5a: Code Reviews — gate issue acceptance on a reviewer + a fix loop
// ---------------------------------------------------------------------------

/// The board issue the scripted Code Review e2es create, dispatch, and complete.
const REVIEW_ISSUE_ID: &str = "feat-1";

/// [`subagent_set`], plus the epics-and-issues and code-reviews capabilities — a review-gated run.
fn code_review_set(extra_slots: &[&str]) -> GgCapabilitySet {
    let mut set = subagent_set(4, 3, extra_slots);
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_EPICS_ISSUES));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_CODE_REVIEWS));
    set
}

/// A one-tool-call assistant turn.
fn tool_call_response(id: &str, name: &str, args: serde_json::Value) -> ModelResponse {
    ModelResponse {
        text: Some(format!("calling {name}")),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: name.to_string(),
            arguments: args,
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// The scripted **root** for a Code Review e2e: build one issue, dispatch its work to a `worker`
/// subagent, wait, then `complete_issue` — which (code-reviews on) triggers the review.
fn code_review_root_mock(model_id: &str) -> MockClient {
    MockClient::new(
        model_id,
        vec![
            tool_call_response(
                "epic",
                "create_epic",
                json!({ "id": "e1", "title": "Build", "description": "the build" }),
            ),
            tool_call_response(
                "issue",
                "create_issue",
                json!({
                    "id": REVIEW_ISSUE_ID,
                    "title": "Add the widget",
                    "inScope": "Implement the widget.",
                    "outOfScope": "Unrelated changes.",
                    "completionCriteria": "The widget is fully implemented.",
                    "epicId": "e1",
                }),
            ),
            tool_call_response(
                "dispatch",
                "spawn_subagent",
                json!({ "issueId": REVIEW_ISSUE_ID, "slot": "worker" }),
            ),
            tool_call_response("wait", "wait_for_subagents", json!({})),
            tool_call_response(
                "complete",
                "complete_issue",
                json!({ "id": REVIEW_ISSUE_ID }),
            ),
            stop_response(),
        ],
    )
}

/// A reviewer that returns a clean, parseable verdict in one turn — APPROVED, or CHANGES REQUESTED
/// with one actionable item.
fn reviewer_verdict_mock(model_id: &str, approved: bool) -> MockClient {
    let text = if approved {
        "The work satisfies the completion criteria.\n\nCODE REVIEW: APPROVED".to_string()
    } else {
        "Not finished.\n\nCODE REVIEW: CHANGES REQUESTED\n1. Add the missing widget to the game."
            .to_string()
    };
    MockClient::new(
        model_id,
        vec![ModelResponse {
            text: Some(text),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: TokenCounts::default(),
            cost: None,
        }],
    )
}

/// A `worker`-slot producer whose Nth dispatch writes `work-N.txt` then finishes — so the initial
/// worker and each fix agent leave a distinct, countable trace, and the reviewer's diff has real
/// content to review.
fn counting_worker_producer(
    counter: Arc<AtomicUsize>,
) -> impl Fn(&GgSlotBinding) -> Box<dyn ModelClient> + Send + Sync + 'static {
    move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        Box::new(MockClient::new(
            &b.model_id,
            vec![
                tool_call_response(
                    "write",
                    "write_file",
                    json!({ "path": format!("work-{n}.txt"), "contents": "work\n" }),
                ),
                stop_response(),
            ],
        ))
    }
}

/// A `reviewer`-slot producer that requests changes for its first `approve_after` dispatches, then
/// approves — the scripted "approve-after-N" that terminates the (otherwise unbounded) fix loop.
fn approve_after_producer(
    counter: Arc<AtomicUsize>,
    approve_after: usize,
) -> impl Fn(&GgSlotBinding) -> Box<dyn ModelClient> + Send + Sync + 'static {
    move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        Box::new(reviewer_verdict_mock(&b.model_id, n >= approve_after))
    }
}

/// Every `CodeReview` event in the stream, as `(issueId, phase, items, baseline)`. The issue id
/// rides on the event envelope (`issue_id`), not the payload.
type Review = (
    Option<String>,
    GgCodeReviewPhase,
    Option<Vec<String>>,
    Option<String>,
);
fn code_reviews(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<Review> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::CodeReview {
                phase,
                items,
                baseline,
            } => Some((e.issue_id.clone(), *phase, items.clone(), baseline.clone())),
            _ => None,
        })
        .collect()
}

/// The most recent status reported for `issue_id` on any `BoardState`.
fn last_issue_status(
    events: &[test_cabinet_core::gg::GgTelemetryEvent],
    issue_id: &str,
) -> Option<GgIssueStatus> {
    events.iter().rev().find_map(|e| match &e.kind {
        GgTelemetryKind::BoardState { issues, .. } => {
            issues.iter().find(|i| i.id == issue_id).map(|i| i.status)
        }
        _ => None,
    })
}

/// Completing an issue with the capability on triggers a **Code Review** rather than accepting the
/// issue: a reviewer is dispatched against the baseline diff, one round requests changes (a fix
/// agent runs with the original brief plus the items), and a re-review approves — only then is the
/// issue marked done. Exercises the whole review → fix → approve cycle end to end.
#[tokio::test]
async fn completing_an_issue_triggers_a_code_review_and_accepts_on_approval() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cr".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), code_review_set(&["worker", "reviewer"]));

    let worker_counter = Arc::new(AtomicUsize::new(0));
    let review_counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new()
        .slot("primary", |b| Box::new(code_review_root_mock(&b.model_id)))
        .slot(
            "worker",
            counting_worker_producer(Arc::clone(&worker_counter)),
        )
        .slot(
            "reviewer",
            // Approve on the 2nd review (one changes-requested round first).
            approve_after_producer(Arc::clone(&review_counter), 1),
        );

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let reviews = code_reviews(&events);

    // The lifecycle: requested → changes_requested (with items) → approved, all scoped to the issue.
    let phases: Vec<GgCodeReviewPhase> = reviews.iter().map(|(_, p, _, _)| *p).collect();
    assert_eq!(
        phases,
        vec![
            GgCodeReviewPhase::Requested,
            GgCodeReviewPhase::ChangesRequested,
            GgCodeReviewPhase::Approved,
        ],
        "a Code Review runs requested → changes_requested → approved"
    );
    assert!(
        reviews
            .iter()
            .all(|(id, _, _, _)| id.as_deref() == Some(REVIEW_ISSUE_ID)),
        "every CodeReview event is scoped to the issue under review"
    );
    // The changes-requested round carries the reviewer's actionable items.
    let (_, _, items, baseline) = reviews
        .iter()
        .find(|(_, p, _, _)| *p == GgCodeReviewPhase::ChangesRequested)
        .expect("a changes_requested phase");
    assert!(
        items
            .as_ref()
            .is_some_and(|items| items.iter().any(|i| i.contains("missing widget"))),
        "the changes_requested event carries the reviewer's items"
    );
    // The review diffed against a real git baseline (worktrees off, but code-reviews established one).
    assert!(
        baseline.is_some(),
        "the Code Review records the baseline it diffed against"
    );

    // Not immediate acceptance: the issue was accepted only via the review's approval, and the
    // `complete_issue` result reports the approval rather than a plain completion.
    let complete_ok = events.iter().any(|e| {
        matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: true, summary: Some(s) }
                if name == "complete_issue" && s.contains("code review approved")
        )
    });
    assert!(
        complete_ok,
        "complete_issue is gated: it succeeds only once the Code Review approves"
    );
    assert_eq!(
        last_issue_status(&events, REVIEW_ISSUE_ID),
        Some(GgIssueStatus::Done),
        "the issue is accepted (marked done) after approval"
    );

    // The reviewer ran twice (round 1 + re-review) and a fix agent ran once, all as subagents.
    let spawns = agent_spawns(&events);
    let reviewer_spawns = spawns
        .iter()
        .filter(|(_, _, slot, _, _)| slot == "reviewer");
    assert_eq!(
        reviewer_spawns.count(),
        2,
        "a reviewer is dispatched for the first review and the re-review"
    );
    // The reviewer's brief carries the diff against the baseline (the initial worker's file appears
    // in it), so the review is genuinely of the work, diffed against the baseline.
    assert!(
        spawns
            .iter()
            .any(|(_, _, slot, _, brief)| slot == "reviewer"
                && brief.as_deref().is_some_and(
                    |b| b.contains("work-0.txt") && b.contains("diff against the baseline")
                )),
        "the reviewer is given the baseline diff of the work"
    );
    // A fix agent ran on the work slot with the ORIGINAL issue brief plus the review's items.
    let fix_spawns: Vec<_> = spawns
        .iter()
        .filter(|(_, _, slot, _, brief)| {
            slot == "worker"
                && brief
                    .as_deref()
                    .is_some_and(|b| b.contains("Requested changes from Code Review"))
        })
        .collect();
    assert_eq!(
        fix_spawns.len(),
        1,
        "one fix agent for the one changes round"
    );
    let fix_brief = fix_spawns[0].4.as_deref().unwrap();
    assert!(
        fix_brief.contains("Implement the widget."),
        "the fix agent gets the original issue brief (its in-scope)"
    );
    assert!(
        fix_brief.contains("missing widget"),
        "the fix agent gets the reviewer's actionable items"
    );

    // The fix agent actually ran (the initial worker wrote work-0, the fix agent work-1).
    assert!(
        dir.path().join("work-0.txt").exists(),
        "the initial worker ran"
    );
    assert!(dir.path().join("work-1.txt").exists(), "the fix agent ran");

    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// The fix → re-review loop has **no cycle limit**: it runs as many rounds as the reviewer keeps
/// requesting changes and terminates only on approval. Scripted with approve-after-3: three
/// changes-requested rounds, three fix agents, then approval accepts the issue.
#[tokio::test]
async fn code_review_fix_loop_has_no_cycle_limit_and_terminates_on_approval() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cr-n".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), code_review_set(&["worker", "reviewer"]));

    let worker_counter = Arc::new(AtomicUsize::new(0));
    let review_counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new()
        .slot("primary", |b| Box::new(code_review_root_mock(&b.model_id)))
        .slot(
            "worker",
            counting_worker_producer(Arc::clone(&worker_counter)),
        )
        .slot(
            "reviewer",
            approve_after_producer(Arc::clone(&review_counter), 3),
        );

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let reviews = code_reviews(&events);

    // Three changes-requested rounds before the single approval — no limit shy of it.
    let changes = reviews
        .iter()
        .filter(|(_, p, _, _)| *p == GgCodeReviewPhase::ChangesRequested)
        .count();
    let approvals = reviews
        .iter()
        .filter(|(_, p, _, _)| *p == GgCodeReviewPhase::Approved)
        .count();
    assert_eq!(
        changes, 3,
        "three changes-requested rounds ran (no cycle limit)"
    );
    assert_eq!(approvals, 1, "the loop terminates on the single approval");

    // Four reviewer dispatches (three changes + the approving one) and three fix agents.
    let spawns = agent_spawns(&events);
    assert_eq!(
        spawns
            .iter()
            .filter(|(_, _, slot, _, _)| slot == "reviewer")
            .count(),
        4,
        "a reviewer ran for each of the four review rounds"
    );
    assert_eq!(
        spawns
            .iter()
            .filter(|(_, _, slot, _, brief)| slot == "worker"
                && brief
                    .as_deref()
                    .is_some_and(|b| b.contains("Requested changes from Code Review")))
            .count(),
        3,
        "a fix agent ran for each of the three changes rounds"
    );

    // The issue is accepted only after the loop terminates on approval.
    assert_eq!(
        last_issue_status(&events, REVIEW_ISSUE_ID),
        Some(GgIssueStatus::Done),
        "the issue is accepted once the fix loop terminates on approval"
    );
}

/// With the capability **off**, `complete_issue` accepts the issue directly — no Code Review is
/// triggered, no reviewer is dispatched, and no git baseline is established. The ablation off arm.
#[tokio::test]
async fn code_review_off_completes_the_issue_directly() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cr-off".to_string()), Box::new(sink.clone()));

    // Subagents + a board, but NOT code-reviews.
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_EPICS_ISSUES));
    let inv = invocation(dir.path(), set);

    // A root that files an issue and completes it directly (no dispatch — no review to run).
    let factory = ScriptedFactory::new().slot("primary", |b| {
        Box::new(MockClient::new(
            &b.model_id,
            vec![
                tool_call_response(
                    "epic",
                    "create_epic",
                    json!({ "id": "e1", "title": "Build", "description": "the build" }),
                ),
                tool_call_response(
                    "issue",
                    "create_issue",
                    json!({
                        "id": REVIEW_ISSUE_ID,
                        "title": "Add the widget",
                        "inScope": "Implement the widget.",
                        "outOfScope": "Unrelated changes.",
                        "completionCriteria": "The widget is fully implemented.",
                    }),
                ),
                tool_call_response(
                    "complete",
                    "complete_issue",
                    json!({ "id": REVIEW_ISSUE_ID }),
                ),
                stop_response(),
            ],
        ))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();

    // No Code Review at all, and no reviewer subagent.
    assert!(
        code_reviews(&events).is_empty(),
        "no CodeReview telemetry when the capability is off"
    );
    assert_eq!(
        agent_spawns(&events).len(),
        1,
        "only the root runs — no reviewer or fix subagents"
    );
    // `complete_issue` accepted the issue directly (the plain tool confirmation, not a review).
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: true, summary: Some(s) }
                if name == "complete_issue" && s.contains("completed issue")
        )),
        "complete_issue accepts the issue directly when code-reviews is off"
    );
    assert_eq!(
        last_issue_status(&events, REVIEW_ISSUE_ID),
        Some(GgIssueStatus::Done),
        "the issue is done immediately"
    );
    // No git machinery engaged (no worktrees, no code-reviews → no baseline committed).
    assert!(
        !dir.path().join(".git").exists(),
        "no baseline is committed when neither worktrees nor code-reviews is on"
    );
}

/// The full review → fix → approve cycle driven **offline through the real binary path** (the
/// `DefaultClientFactory` + the `mock/…` model-id scripts), not the in-crate scripted factory: the
/// reviewer requests the fix marker, the fixer writes it, and the re-review approves.
#[tokio::test]
async fn code_review_offline_e2e_through_the_default_factory() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cr-mock".to_string()), Box::new(sink.clone()));

    let mut set = GgCapabilitySet::minimal("mock/demo-code-review-parent");
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_MULTI_MODEL));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_EPICS_ISSUES));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_CODE_REVIEWS));
    set.slots
        .push(GgSlotBinding::new("worker", "mock/demo-review-worker"));
    set.slots
        .push(GgSlotBinding::new("reviewer", "mock/demo-review-reviewer"));
    let inv = invocation(dir.path(), set);

    // `run` uses the production DefaultClientFactory, which selects the mock scripts by model id.
    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    // The worker did the initial work, then a fix agent wrote the review fix marker.
    assert!(
        dir.path().join(MOCK_REVIEW_WORKER_FILE).exists(),
        "the initial worker did its work"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join(MOCK_REVIEW_FIX_FILE))
            .ok()
            .as_deref()
            .map(str::trim),
        Some(MOCK_REVIEW_FIX_SENTINEL),
        "the fix agent applied the reviewer's requested change"
    );

    let events = sink.events();
    let reviews = code_reviews(&events);
    assert!(
        reviews
            .iter()
            .any(|(_, p, _, _)| *p == GgCodeReviewPhase::ChangesRequested),
        "the first review requested changes"
    );
    assert!(
        reviews
            .iter()
            .any(|(_, p, _, _)| *p == GgCodeReviewPhase::Approved),
        "the re-review approved"
    );
    assert_eq!(
        last_issue_status(&events, MOCK_CODE_REVIEW_ISSUE_ID),
        Some(GgIssueStatus::Done),
        "the issue is accepted after the offline review→fix→approve cycle"
    );
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

// ---------------------------------------------------------------------------
// Stage P6a: the aggregatable session summary computed + emitted by the binary
// ---------------------------------------------------------------------------

/// The single `SessionSummary` a run emits (its payload), or `None` when the run emitted none.
fn session_summary(events: &[GgTelemetryEvent]) -> Option<GgSessionSummary> {
    events.iter().find_map(|e| match &e.kind {
        GgTelemetryKind::SessionSummary { summary } => Some((**summary).clone()),
        _ => None,
    })
}

/// The `(slot, model)` keys of the `SlotUsage` rollups the stream carried, in emission order.
fn slot_usage_keys(events: &[GgTelemetryEvent]) -> Vec<(String, String)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::SlotUsage { slot, model_id, .. } => {
                Some((slot.clone(), model_id.clone()))
            }
            _ => None,
        })
        .collect()
}

/// A run emits exactly one `SessionSummary`, **immediately before** the terminal `SessionEnded`,
/// and — for a plain single-agent run — it summarizes a lone root agent whose per-slot cost rollup
/// matches the `SlotUsage` the run streamed.
#[tokio::test]
async fn run_emits_a_session_summary_immediately_before_session_ended() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-summary".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();

    // Exactly one summary, and it sits directly before the (final) SessionEnded.
    let summary_pos = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::SessionSummary { .. }))
        .expect("a session summary was emitted");
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e.kind, GgTelemetryKind::SessionSummary { .. }))
            .count(),
        1,
        "exactly one session summary"
    );
    let ended_pos = events.len() - 1;
    assert!(matches!(
        events[ended_pos].kind,
        GgTelemetryKind::SessionEnded { .. }
    ));
    assert_eq!(
        summary_pos + 1,
        ended_pos,
        "the summary immediately precedes SessionEnded"
    );

    let summary = session_summary(&events).unwrap();
    assert_eq!(summary.terminal_status, "completed");
    // A single-agent run: one AgentSpawned (the root), no subagents, depth 0.
    let spawned = events
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::AgentSpawned { .. }))
        .count() as u64;
    assert_eq!(summary.agents_spawned, spawned);
    assert_eq!(summary.agents_spawned, 1);
    assert_eq!(summary.subagent_count, 0);
    assert_eq!(summary.max_subagent_depth, 0);
    assert_eq!(summary.compactions, 0);
    assert!(!summary.ran_out_of_context);
    // Context visibility is on by default, so the run reported a final fullness.
    assert!(
        summary.final_fullness.is_some(),
        "a fullness was reported by the default context visibility"
    );
    // No board, reviews, or speculation in a minimal run.
    assert_eq!(summary.code_reviews, 0);
    assert_eq!(summary.speculations, 0);
    assert_eq!(summary.issues_created, 0);
    assert_eq!(summary.issues_completed, 0);
    // The per-slot rollup matches the SlotUsage the run streamed (one `primary` slot).
    let slot_keys = slot_usage_keys(&events);
    assert_eq!(
        summary
            .slot_costs
            .iter()
            .map(|c| (c.slot.clone(), c.model_id.clone()))
            .collect::<Vec<_>>(),
        slot_keys
    );
    assert_eq!(summary.slot_costs.len(), 1);
    assert_eq!(summary.slot_costs[0].slot, PRIMARY_SLOT);
    // The effective toolset is recorded on the summary: the exact set of tools the run offered its
    // agent (shell + the filesystem tools among them), so the toolset is a durable, slice-by
    // ablation variable.
    assert!(
        !summary.effective_tools.is_empty(),
        "the run recorded its effective toolset"
    );
    for tool in ["shell", "read_file", "write_file", "edit_file", "list_dir"] {
        assert!(
            summary.effective_tools.iter().any(|t| t == tool),
            "expected `{tool}` in the recorded effective toolset"
        );
    }
}

/// A per-tool override recorded on the capability set is honored end to end: the withheld tool is
/// absent from the effective toolset the summary records, while the rest of its capability's tools
/// remain — the finest-grained toolset-ablation lever, observable on the run's durable outcome.
#[tokio::test]
async fn a_per_tool_override_is_reflected_in_the_recorded_effective_toolset() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-ablate".to_string()), Box::new(sink.clone()));
    // Filesystem stays on, but `edit_file` is individually withheld (the apply-patch-vs-write lever).
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.disabled_tools = vec!["edit_file".to_string()];
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let summary = session_summary(&sink.events()).unwrap();

    // The withheld tool is absent from the recorded effective toolset...
    assert!(
        !summary.effective_tools.iter().any(|t| t == "edit_file"),
        "edit_file was withheld by the per-tool override"
    );
    // ...while the rest of the filesystem capability's tools (and shell) remain offered.
    for tool in ["read_file", "write_file", "list_dir", "shell"] {
        assert!(
            summary.effective_tools.iter().any(|t| t == tool),
            "expected `{tool}` to remain offered"
        );
    }
}

/// A multi-agent, review-gated run's summary counts each aggregatable figure exactly as the stream
/// carried it: every spawned agent, each Code Review phase, the board's issues, and the per-slot
/// rollups — so an aggregate query can trust the recorded summary without replaying the stream.
#[tokio::test]
async fn session_summary_counts_match_a_code_review_run_stream() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-cr-summary".to_string()), Box::new(sink.clone()));

    let mut set = GgCapabilitySet::minimal("mock/demo-code-review-parent");
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_MULTI_MODEL));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_EPICS_ISSUES));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_CODE_REVIEWS));
    set.slots
        .push(GgSlotBinding::new("worker", "mock/demo-review-worker"));
    set.slots
        .push(GgSlotBinding::new("reviewer", "mock/demo-review-reviewer"));
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
    let events = sink.events();
    let summary = session_summary(&events).expect("a session summary was emitted");

    // The summary sits immediately before the terminal SessionEnded.
    let summary_pos = events
        .iter()
        .position(|e| matches!(e.kind, GgTelemetryKind::SessionSummary { .. }))
        .unwrap();
    assert_eq!(summary_pos + 1, events.len() - 1);
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
    assert_eq!(summary.terminal_status, "completed");

    // Agents: the summary's count equals the AgentSpawned events (root + worker + reviewer(s) +
    // fixer(s)), and the run delegated, so there was more than just the root.
    let spawned = events
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::AgentSpawned { .. }))
        .count() as u64;
    assert_eq!(summary.agents_spawned, spawned);
    assert!(summary.subagent_count >= 1, "the run spawned subagents");
    assert_eq!(summary.subagent_count, summary.agents_spawned - 1);
    let deepest = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::AgentSpawned { depth, .. } => Some(*depth),
            _ => None,
        })
        .max()
        .unwrap();
    assert_eq!(summary.max_subagent_depth, deepest);

    // Code Reviews: the three figures match the phases the stream carried.
    let reviews = code_reviews(&events);
    let requested = reviews
        .iter()
        .filter(|(_, p, _, _)| *p == GgCodeReviewPhase::Requested)
        .count() as u64;
    let changes = reviews
        .iter()
        .filter(|(_, p, _, _)| *p == GgCodeReviewPhase::ChangesRequested)
        .count() as u64;
    let approved = reviews
        .iter()
        .filter(|(_, p, _, _)| *p == GgCodeReviewPhase::Approved)
        .count() as u64;
    assert_eq!(summary.code_reviews, requested);
    assert_eq!(summary.review_cycles, changes + approved);
    assert_eq!(summary.issues_reopened, changes);
    // This mock does a review → changes → approve cycle, so all three are exercised.
    assert!(summary.code_reviews >= 1);
    assert!(summary.issues_reopened >= 1);
    assert!(summary.review_cycles >= 2);

    // Issues: the review issue was created and accepted (done) by the end.
    assert!(summary.issues_created >= 1);
    assert_eq!(
        summary.issues_completed, summary.issues_created,
        "every created issue was completed in this scripted run"
    );

    // No speculation in this run.
    assert_eq!(summary.speculations, 0);

    // Per-slot rollup matches the SlotUsage rollups the run streamed.
    let slot_keys = slot_usage_keys(&events);
    assert_eq!(
        summary
            .slot_costs
            .iter()
            .map(|c| (c.slot.clone(), c.model_id.clone()))
            .collect::<Vec<_>>(),
        slot_keys
    );
    assert!(
        summary.slot_costs.len() >= 2,
        "the run spent on more than one slot (worker + reviewer)"
    );
}

/// The verdict parser: an explicit approval marker approves; anything else is changes-requested with
/// the message's list items (a generic item when it lists none); the last marker wins.
#[test]
fn parse_review_verdict_reads_the_contract() {
    // Approval.
    let approved = parse_review_verdict("Looks good.\n\nCODE REVIEW: APPROVED");
    assert!(approved.approved);
    assert!(approved.items.is_empty());

    // Changes with numbered items.
    let changes = parse_review_verdict(
        "CODE REVIEW: CHANGES REQUESTED\n1. Fix the score.\n2. Add a restart button.",
    );
    assert!(!changes.approved);
    assert_eq!(
        changes.items,
        vec![
            "Fix the score.".to_string(),
            "Add a restart button.".to_string()
        ]
    );

    // Changes with bullet items.
    let bullets = parse_review_verdict("CODE REVIEW: CHANGES REQUESTED\n- Do X\n- Do Y");
    assert_eq!(bullets.items, vec!["Do X".to_string(), "Do Y".to_string()]);

    // No clear verdict → conservatively not approved, with a synthesized item so a fixer has work.
    let unclear = parse_review_verdict("I looked at it and I have some thoughts.");
    assert!(!unclear.approved);
    assert_eq!(unclear.items.len(), 1);

    // The last marker wins (a reviewer that discusses then concludes).
    let concludes =
        parse_review_verdict("I might request changes... but actually: CODE REVIEW: APPROVED");
    assert!(concludes.approved);
}

// ---------------------------------------------------------------------------
// Phase 5b: FSM-driven processes — the built-in machines, order enforced
// ---------------------------------------------------------------------------

/// A capability set with the `fsm` capability selecting `machine`, on top of the minimal defaults,
/// plus a binding for each named `extra_slot` (`mock/<slot>`). `review-gated` additionally needs
/// delegation + a distinct reviewer model, so callers add `subagents`/`multi-model` themselves.
fn fsm_set(machine: &str) -> GgCapabilitySet {
    fsm_set_for(machine, "mock/primary")
}

/// A capability set with the `fsm` capability selecting `machine`, bound to `model_id` on the primary
/// slot (so the offline `DefaultClientFactory` selects a specific mock script by id).
fn fsm_set_for(machine: &str, model_id: &str) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model_id);
    let mut cap = GgCapabilityConfig::enabled(CAPABILITY_FSM);
    cap.params = json!({ "machine": machine });
    set.capabilities.push(cap);
    set
}

/// Every `FsmState` transition in the stream, as `(machine, state, stateIndex)`, in order.
fn fsm_states(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<(String, String, u64)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::FsmState {
                machine,
                state,
                state_index,
            } => Some((machine.clone(), state.clone(), *state_index)),
            _ => None,
        })
        .collect()
}

/// The `ok` flag of every `advance_state` tool result, in order.
fn advance_results(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<bool> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ToolResult { name, ok, .. } if name == "advance_state" => Some(*ok),
            _ => None,
        })
        .collect()
}

/// The headline TDD proof: the machine **enforces** write tests → implement → verify. A first
/// `advance_state` (before any test exists) is **refused** — the agent cannot jump to implementing —
/// and only after a test file is written does the advance succeed and the machine move to
/// `implement`, then `verify`. The order is a property of the process, not the model's discretion.
#[tokio::test]
async fn fsm_tdd_cannot_advance_to_implement_before_tests_exist() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-tdd".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), fsm_set("tdd"));

    // The scripted agent *tries* to advance before writing any test — the engine must refuse it.
    let factory = ScriptedFactory::new().slot("primary", |b| {
        Box::new(MockClient::new(
            &b.model_id,
            vec![
                // 1. Jump straight to advancing — no test exists yet. Refused.
                tool_call_response("adv1", "advance_state", json!({})),
                // 2. Now write the tests.
                tool_call_response(
                    "wt",
                    "write_file",
                    json!({ "path": "game.test.js", "contents": "// a test\n" }),
                ),
                // 3. Advance — tests exist, so this is allowed → implement.
                tool_call_response("adv2", "advance_state", json!({})),
                // 4. Implement.
                tool_call_response(
                    "impl",
                    "write_file",
                    json!({ "path": "game.js", "contents": "// the implementation\n" }),
                ),
                // 5. Advance → verify.
                tool_call_response("adv3", "advance_state", json!({})),
                stop_response(),
            ],
        ))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );
    let events = sink.events();

    // The machine drove the states in order, never skipping.
    assert_eq!(
        fsm_states(&events),
        vec![
            ("tdd".to_string(), "write_tests".to_string(), 0),
            ("tdd".to_string(), "implement".to_string(), 1),
            ("tdd".to_string(), "verify".to_string(), 2),
        ],
        "tdd is driven write_tests → implement → verify, in order"
    );

    // The first advance (no tests) was REFUSED; the two after the test file was written succeeded.
    assert_eq!(
        advance_results(&events),
        vec![false, true, true],
        "the advance before any test exists is refused, not honored"
    );
    // ...and the refusal explains why (tests must exist first).
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, summary: Some(s) }
                if name == "advance_state" && s.contains("test file")
        )),
        "the refusal tells the agent it must write tests first"
    );

    // The enforcement is temporal: the machine only entered `implement` AFTER the refusal — the agent
    // could not reach the implement state before tests existed.
    let refusal_at = events
        .iter()
        .position(|e| matches!(&e.kind, GgTelemetryKind::ToolResult { name, ok: false, .. } if name == "advance_state"))
        .expect("a refused advance");
    let implement_at = events
        .iter()
        .position(
            |e| matches!(&e.kind, GgTelemetryKind::FsmState { state, .. } if state == "implement"),
        )
        .expect("an implement transition");
    assert!(
        refusal_at < implement_at,
        "the machine refused to implement before tests existed"
    );

    // Both files landed, in their phases.
    assert!(
        dir.path().join("game.test.js").exists(),
        "tests were written"
    );
    assert!(
        dir.path().join("game.js").exists(),
        "the implementation was written"
    );
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// The TDD order enforced **offline through the real binary path** (the `DefaultClientFactory` + the
/// `mock/…-fsm-tdd` script), not the in-crate scripted factory: the machine drives write_tests →
/// implement → verify and refuses the premature advance.
#[tokio::test]
async fn fsm_tdd_offline_e2e_through_the_default_factory() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-tdd-mock".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), fsm_set_for("tdd", "mock/demo-fsm-tdd"));

    // `run` uses the production DefaultClientFactory, which selects the tdd script by model id.
    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let events = sink.events();
    assert_eq!(
        fsm_states(&events)
            .iter()
            .map(|(_, s, _)| s.clone())
            .collect::<Vec<_>>(),
        vec!["write_tests", "implement", "verify"],
        "the machine drives the states in order through the real binary path"
    );
    assert_eq!(
        advance_results(&events),
        vec![false, true, true],
        "the premature advance (before tests) is refused offline too"
    );
    assert!(dir.path().join(MOCK_FSM_TEST_FILE).exists());
    assert!(dir.path().join(MOCK_FSM_IMPL_FILE).exists());
}

/// `review-gated` composes P5a: entering the `review` state triggers a **Code Review** of the run's
/// work, and the machine reaches `accept` only when the review approves — else it loops **back to
/// `develop`** with the reviewer's items. Scripted so the first review requests changes and the
/// re-review approves.
#[tokio::test]
async fn fsm_review_gated_accepts_only_after_a_code_review_approves() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-rg".to_string()), Box::new(sink.clone()));

    // review-gated needs delegation (to dispatch the reviewer) and a distinct reviewer model.
    let mut set = fsm_set("review-gated");
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_MULTI_MODEL));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS));
    set.slots
        .push(GgSlotBinding::new("reviewer", "mock/reviewer"));
    let inv = invocation(dir.path(), set);

    let review_counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new()
        .slot("primary", |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    // develop: do the work.
                    tool_call_response(
                        "w1",
                        "write_file",
                        json!({ "path": "feature.txt", "contents": "v1\n" }),
                    ),
                    // advance → review (Code Review requests changes → back to develop).
                    tool_call_response("adv1", "advance_state", json!({})),
                    // develop again: address the change.
                    tool_call_response(
                        "w2",
                        "write_file",
                        json!({ "path": "feature.txt", "contents": "v2 (fixed)\n" }),
                    ),
                    // advance → review (approves) → accept.
                    tool_call_response("adv2", "advance_state", json!({})),
                    stop_response(),
                ],
            ))
        })
        // Approve on the 2nd review (one changes-requested round first).
        .slot(
            "reviewer",
            approve_after_producer(Arc::clone(&review_counter), 1),
        );

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );
    let events = sink.events();

    // The machine's path: develop → review → (changes) back to develop → review → accept.
    assert_eq!(
        fsm_states(&events)
            .iter()
            .map(|(_, state, index)| (state.clone(), *index))
            .collect::<Vec<_>>(),
        vec![
            ("develop".to_string(), 0),
            ("review".to_string(), 1),
            ("develop".to_string(), 0),
            ("review".to_string(), 1),
            ("accept".to_string(), 2),
        ],
        "review-gated loops back to develop on changes and only reaches accept on approval"
    );

    // It composed the Code Review capability: a review was requested each round, one requested
    // changes, and the last approved — accept came only after approval.
    let phases: Vec<GgCodeReviewPhase> = code_reviews(&events)
        .iter()
        .map(|(_, p, _, _)| *p)
        .collect();
    assert_eq!(
        phases,
        vec![
            GgCodeReviewPhase::Requested,
            GgCodeReviewPhase::ChangesRequested,
            GgCodeReviewPhase::Requested,
            GgCodeReviewPhase::Approved,
        ],
        "each review round is a Code Review; accept follows the approval"
    );
    // `accept` is reached strictly after the approval.
    let approved_at = events
        .iter()
        .position(|e| {
            matches!(
                &e.kind,
                GgTelemetryKind::CodeReview {
                    phase: GgCodeReviewPhase::Approved,
                    ..
                }
            )
        })
        .expect("an approval");
    let accept_at = events
        .iter()
        .position(
            |e| matches!(&e.kind, GgTelemetryKind::FsmState { state, .. } if state == "accept"),
        )
        .expect("an accept transition");
    assert!(
        approved_at <= accept_at,
        "accept follows the Code Review approval"
    );

    // Two reviewer subagents ran (the changes round + the approving re-review); the reviewer saw the
    // run's diff.
    let spawns = agent_spawns(&events);
    assert_eq!(
        spawns
            .iter()
            .filter(|(_, _, slot, _, _)| slot == "reviewer")
            .count(),
        2,
        "a reviewer ran for the initial review and the re-review"
    );
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// `plan-first` reuses the planning capability's plan → implement flow as its two states: the `plan`
/// state is **read-only** (a mutating call is refused), advancing performs the plan → implement reset
/// (emitting the planning telemetry), and the `implement` state has the full toolset back. The
/// planning capability itself is off — plan-first is self-contained.
#[tokio::test]
async fn fsm_plan_first_reuses_the_planning_flow() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-pf".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), fsm_set("plan-first"));
    assert!(
        !inv.capability_set.is_enabled(CAPABILITY_PLANNING),
        "plan-first works without the standalone planning capability"
    );

    let factory = ScriptedFactory::new().slot("primary", |b| {
        Box::new(MockClient::new(
            &b.model_id,
            vec![
                // plan state (read-only): a read is allowed.
                tool_call_response("ls", "list_dir", json!({ "path": "." })),
                // plan state: a mutating call is REFUSED (read-only) — premature.txt is never written.
                tool_call_response(
                    "bad",
                    "write_file",
                    json!({ "path": "premature.txt", "contents": "too soon" }),
                ),
                // advance with the plan → implement.
                tool_call_response(
                    "adv",
                    "advance_state",
                    json!({ "note": "1. create index.html 2. add a player 3. draw each frame" }),
                ),
                // implement: now allowed.
                tool_call_response(
                    "impl",
                    "write_file",
                    json!({ "path": "index.html", "contents": "<!doctype html>\n" }),
                ),
                stop_response(),
            ],
        ))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );
    let events = sink.events();

    // The two states, in order.
    assert_eq!(
        fsm_states(&events),
        vec![
            ("plan-first".to_string(), "plan".to_string(), 0),
            ("plan-first".to_string(), "implement".to_string(), 1),
        ],
        "plan-first is plan → implement"
    );

    // The read-only plan state refused the mutating write (the file was never created).
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, .. } if name == "write_file"
        )),
        "a mutating call in the read-only plan state is refused"
    );
    assert!(
        !dir.path().join("premature.txt").exists(),
        "the refused write never touched the workspace"
    );

    // It reused the planning plan → implement flow: the planning telemetry fired.
    let plan_phases: Vec<GgPlanPhase> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Planning { phase, .. } => Some(*phase),
            _ => None,
        })
        .collect();
    assert!(
        plan_phases.contains(&GgPlanPhase::Submitted)
            && plan_phases.contains(&GgPlanPhase::Implementing),
        "the plan → implement reset reused the planning flow (submitted + implementing)"
    );

    // The implement phase wrote the real file.
    assert!(
        dir.path().join("index.html").exists(),
        "the implement state wrote the game with its full toolset back"
    );
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// With no machine selected the run behaves exactly as before: no `FsmState` telemetry, no
/// `advance_state` offered, and the default build proceeds. An `fsm` capability naming an unknown
/// machine warns and drives nothing.
#[tokio::test]
async fn fsm_absent_or_unknown_machine_leaves_behavior_unchanged() {
    // No fsm capability at all: the default mock run is untouched.
    {
        let dir = TempDir::new().unwrap();
        seed_default_skill(dir.path());
        let sink = CollectingSink::new();
        let emitter = Emitter::with_sink(Some("run-nofsm".to_string()), Box::new(sink.clone()));
        let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));
        assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);
        let events = sink.events();
        assert!(
            fsm_states(&events).is_empty(),
            "no machine → no FsmState telemetry"
        );
        assert!(
            dir.path().join("index.html").exists(),
            "the default build still runs unchanged"
        );
    }

    // An fsm capability naming a machine gg does not ship: a warning, and nothing drives the run.
    {
        let dir = TempDir::new().unwrap();
        let sink = CollectingSink::new();
        let emitter = Emitter::with_sink(Some("run-bogus".to_string()), Box::new(sink.clone()));
        // Give it a benign one-shot script so the run completes.
        let inv = invocation(dir.path(), fsm_set("does-not-exist"));
        let factory = ScriptedFactory::new().slot("primary", |b| {
            Box::new(MockClient::new(&b.model_id, vec![stop_response()]))
        });
        assert_eq!(
            run_with_factory(&inv, &emitter, Arc::new(factory)).await,
            SessionOutcome::Ran
        );
        let events = sink.events();
        assert!(
            fsm_states(&events).is_empty(),
            "an unknown machine drives nothing"
        );
        assert!(
            events.iter().any(|e| matches!(
                &e.kind,
                GgTelemetryKind::Log { level, message }
                    if level == "warn" && message.contains("unknown machine")
            )),
            "an unrecognized machine is warned about, loudly"
        );
    }
}

// ---------------------------------------------------------------------------
// Phase 5c: speculative execution — best-of-K over isolated worktrees + a judge
// ---------------------------------------------------------------------------

/// [`subagent_set`] (subagents + multi-model), plus the worktrees and speculative-execution
/// capabilities — a best-of-K run. Every attempt needs its own worktree, so worktrees is required.
fn speculative_set(extra_slots: &[&str]) -> GgCapabilitySet {
    let mut set = subagent_set(4, 3, extra_slots);
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_WORKTREES));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_SPECULATIVE));
    set
}

/// Every `Speculation` event in the stream, as `(agentId, attempts, phase, winner, rationale)`.
type Speculation = (
    Option<String>,
    u64,
    GgSpeculationPhase,
    Option<String>,
    Option<String>,
);
fn speculations(events: &[test_cabinet_core::gg::GgTelemetryEvent]) -> Vec<Speculation> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Speculation {
                attempts,
                phase,
                winner,
                rationale,
            } => Some((
                e.agent_id.clone(),
                *attempts,
                *phase,
                winner.clone(),
                rationale.clone(),
            )),
            _ => None,
        })
        .collect()
}

/// An `attempt`-slot producer whose Nth dispatch writes `attempt-N.txt` then finishes — so each
/// parallel attempt leaves a distinct, countable trace in its own worktree and the judge's diff of
/// each has real content.
fn speculation_attempt_producer(
    counter: Arc<AtomicUsize>,
) -> impl Fn(&GgSlotBinding) -> Box<dyn ModelClient> + Send + Sync + 'static {
    move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        Box::new(MockClient::new(
            &b.model_id,
            vec![
                tool_call_response(
                    "write",
                    "write_file",
                    json!({ "path": format!("attempt-{n}.txt"), "contents": format!("attempt {n}\n") }),
                ),
                ModelResponse {
                    text: Some(format!("Attempt {n} complete.")),
                    tool_calls: Vec::new(),
                    finish_reason: FinishReason::Stop,
                    usage: TokenCounts::default(),
                    cost: None,
                },
            ],
        ))
    }
}

/// A `judge`-slot producer that picks the given 1-based candidate as the winner.
fn judge_producer(
    winner: usize,
) -> impl Fn(&GgSlotBinding) -> Box<dyn ModelClient> + Send + Sync + 'static {
    move |b| {
        Box::new(MockClient::new(
            &b.model_id,
            vec![ModelResponse {
                text: Some(format!(
                    "Attempt {winner} is the most complete.\n\nSPECULATION JUDGE: WINNER {winner}"
                )),
                tool_calls: Vec::new(),
                finish_reason: FinishReason::Stop,
                usage: TokenCounts::default(),
                cost: None,
            }],
        ))
    }
}

/// The headline best-of-K proof: `speculate` fans out K attempts, EACH IN ITS OWN WORKTREE (so they
/// cannot collide), a judge picks a winner against the task, and ONLY the winner's changes are merged
/// back into the main tree — the losers are discarded. The full `fan-out → judge → merge` lifecycle
/// streams as `Speculation` telemetry, and the K attempts + the judge appear in the agent tree.
#[tokio::test]
async fn speculate_runs_best_of_k_over_worktrees_and_merges_only_the_winner() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-spec".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), speculative_set(&["attempt", "judge"]));

    // The root speculates: two attempts on the `attempt` slot, then stops.
    let attempt_counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new()
        .slot("primary", |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    tool_call_response(
                        "spec",
                        "speculate",
                        json!({
                            "prompt": "Implement the widget as well as you can.",
                            "attempts": 2,
                            "slots": ["attempt", "attempt"],
                        }),
                    ),
                    stop_response(),
                ],
            ))
        })
        .slot("attempt", speculation_attempt_producer(Arc::clone(&attempt_counter)))
        // The judge picks the 2nd candidate — so the winner is the second attempt (agent-1), which
        // wrote attempt-1.txt.
        .slot("judge", judge_producer(2));

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();

    // The worktrees capability committed a baseline (the repo exists).
    assert!(
        dir.path().join(".git").exists(),
        "best-of-K commits a baseline and runs each attempt in a worktree"
    );

    // Two attempts, each in its OWN isolated worktree (a distinct branch), plus one judge — all
    // subagents at depth 1.
    let spawns = agent_spawns(&events);
    let attempt_branches: Vec<Option<String>> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::AgentSpawned {
                slot,
                worktree,
                depth,
                ..
            } if slot == "attempt" && *depth == 1 => Some(worktree.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(attempt_branches.len(), 2, "two attempts were fanned out");
    assert_eq!(
        attempt_branches,
        vec![
            Some("gg/agent-0".to_string()),
            Some("gg/agent-1".to_string())
        ],
        "each attempt ran in its own isolated worktree branch"
    );
    let judge_spawns: Vec<_> = spawns
        .iter()
        .filter(|(_, _, slot, _, _)| slot == "judge")
        .collect();
    assert_eq!(judge_spawns.len(), 1, "one judge was dispatched");

    // The judge was given each candidate's diff (so it judged the real work against the task).
    let judge_brief = judge_spawns[0].4.as_deref().unwrap();
    assert!(
        judge_brief.contains("attempt-0.txt") && judge_brief.contains("attempt-1.txt"),
        "the judge sees both attempts' diffs to compare"
    );
    assert!(
        judge_brief.contains("Implement the widget"),
        "the judge is given the task the attempts were judged against"
    );

    // The lifecycle: fanned_out → judged(winner) → merged(winner), all on the speculating (root) stream.
    let specs = speculations(&events);
    let phases: Vec<GgSpeculationPhase> = specs.iter().map(|(_, _, p, _, _)| *p).collect();
    assert_eq!(
        phases,
        vec![
            GgSpeculationPhase::FannedOut,
            GgSpeculationPhase::Judged,
            GgSpeculationPhase::Merged,
        ],
        "a speculation streams fanned_out → judged → merged"
    );
    assert!(
        specs
            .iter()
            .all(|(agent, attempts, _, _, _)| agent.as_deref() == Some("root") && *attempts == 2),
        "every Speculation event names the speculating agent and K=2"
    );
    // The winner (the 2nd attempt, agent-1) is named on judged and merged, with a rationale on judged.
    let (_, _, _, judged_winner, rationale) = specs
        .iter()
        .find(|(_, _, p, _, _)| *p == GgSpeculationPhase::Judged)
        .expect("a judged phase");
    assert_eq!(
        judged_winner.as_deref(),
        Some("agent-1"),
        "the judge's pick (candidate 2 = the second attempt) is the winner"
    );
    assert!(
        rationale.is_some(),
        "the judged phase carries the judge's rationale"
    );
    let (_, _, _, merged_winner, _) = specs
        .iter()
        .find(|(_, _, p, _, _)| *p == GgSpeculationPhase::Merged)
        .expect("a merged phase");
    assert_eq!(
        merged_winner.as_deref(),
        Some("agent-1"),
        "the merged winner matches the judged winner"
    );

    // ONLY the winner's changes are in the main tree: attempt-1.txt (the winner) is present, and
    // attempt-0.txt (the discarded loser) is not.
    assert!(
        dir.path().join("attempt-1.txt").exists(),
        "the winning attempt's work is merged into the main tree"
    );
    assert!(
        !dir.path().join("attempt-0.txt").exists(),
        "the losing attempt's work is discarded, not merged"
    );

    // Every attempt's worktree checkout was torn down (nothing left behind).
    let root = worktrees_root_for(dir.path());
    assert!(
        !root.join("agent-0").exists() && !root.join("agent-1").exists(),
        "the attempts' worktree checkouts are removed after the speculation"
    );

    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// The `speculate` tool is only offered when the capability is on — the ablation off arm. With it
/// off, best-of-K is unavailable and the run does ordinary single-attempt work (no fan-out).
#[test]
fn speculate_tool_is_gated_on_the_capability() {
    // Off (subagents + worktrees on, but not speculative): not offered.
    let mut off = GgCapabilitySet::minimal("mock/echo");
    off.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS));
    off.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_WORKTREES));
    assert!(
        !ToolRegistry::from_capabilities(&off)
            .definitions()
            .iter()
            .any(|d| d.name == "speculate"),
        "`speculate` must not be offered when speculative-execution is off"
    );

    // On: offered.
    let mut on = off.clone();
    on.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_SPECULATIVE));
    assert!(
        ToolRegistry::from_capabilities(&on)
            .definitions()
            .iter()
            .any(|d| d.name == "speculate"),
        "`speculate` is offered when speculative-execution is on"
    );
}

/// A `speculate` call is **refused** when worktree isolation is unavailable (the capability needs
/// worktrees to isolate the attempts): no attempts are fanned out, no `Speculation` telemetry fires,
/// and the workspace is untouched.
#[tokio::test]
async fn speculate_is_refused_without_worktrees() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-spec-nowt".to_string()), Box::new(sink.clone()));

    // subagents + multi-model + speculative, but NOT worktrees.
    let mut set = subagent_set(4, 3, &["attempt", "judge"]);
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_SPECULATIVE));
    let inv = invocation(dir.path(), set);

    let factory = ScriptedFactory::new().slot("primary", |b| {
        Box::new(MockClient::new(
            &b.model_id,
            vec![
                tool_call_response(
                    "spec",
                    "speculate",
                    json!({ "prompt": "Do the thing.", "attempts": 2 }),
                ),
                stop_response(),
            ],
        ))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();

    // The tool was refused (a tool error to the model), not run.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::ToolResult { name, ok: false, summary: Some(s) }
                if name == "speculate" && s.contains("worktree")
        )),
        "speculate is refused with a worktree message when isolation is unavailable"
    );
    // No fan-out, no judge, no Speculation telemetry, no attempt files.
    assert_eq!(
        agent_spawns(&events).len(),
        1,
        "only the root runs — no attempts or judge were spawned"
    );
    assert!(
        speculations(&events).is_empty(),
        "no Speculation telemetry when the call is refused"
    );
    assert!(
        !dir.path().join(".git").exists(),
        "no baseline is committed for a speculative run without worktrees"
    );
}

/// Best-of-K driven **offline through the real binary path** (the `DefaultClientFactory` + the
/// `mock/…` model-id scripts): three attempts each write a distinctly-named file in their own
/// worktree, the judge picks the first, and only that attempt's file is merged.
#[tokio::test]
async fn speculate_offline_e2e_through_the_default_factory() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-spec-offline".to_string()), Box::new(sink.clone()));

    let mut set = GgCapabilitySet::minimal("mock/x-speculate-parent");
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_MULTI_MODEL));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_WORKTREES));
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_SPECULATIVE));
    set.slots
        .push(GgSlotBinding::new("attempt", "mock/x-speculate-attempt"));
    set.slots
        .push(GgSlotBinding::new("judge", "mock/x-speculate-judge"));
    let inv = invocation(dir.path(), set);

    // The real production path: `run` with the DefaultClientFactory, selecting scripts by model id.
    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let events = sink.events();

    // Three attempts (each in its own worktree) plus one judge.
    let spawns = agent_spawns(&events);
    assert_eq!(
        spawns
            .iter()
            .filter(|(_, _, slot, _, _)| slot == "attempt")
            .count(),
        3,
        "three attempts were fanned out"
    );
    assert_eq!(
        spawns
            .iter()
            .filter(|(_, _, slot, _, _)| slot == "judge")
            .count(),
        1,
        "one judge was dispatched"
    );

    // The judge picked the first attempt (WINNER 1), whose brief said "attempt 1 of 3" → it wrote
    // speculate-attempt-1.txt. Only that file is merged; the other two attempts are discarded.
    assert!(
        dir.path()
            .join(format!("{MOCK_SPECULATE_ATTEMPT_PREFIX}1.txt"))
            .exists(),
        "the winning attempt's file is merged into the workspace"
    );
    for loser in [2, 3] {
        assert!(
            !dir.path()
                .join(format!("{MOCK_SPECULATE_ATTEMPT_PREFIX}{loser}.txt"))
                .exists(),
            "the losing attempts' files are discarded"
        );
    }

    // The lifecycle completed with a merged winner.
    let specs = speculations(&events);
    assert!(
        specs
            .iter()
            .any(|(_, attempts, phase, winner, _)| *attempts == 3
                && *phase == GgSpeculationPhase::Merged
                && winner.is_some()),
        "the offline speculation merged a winner of the three attempts"
    );

    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// The judge verdict contract: `parse_judge_verdict` reads the 1-based winner (last marker wins,
/// case-insensitive), and treats a missing or non-positive winner as an error so an unclear judge
/// never causes a silent or arbitrary merge.
#[test]
fn parse_judge_verdict_reads_the_winner_and_rejects_no_verdict() {
    let verdict =
        parse_judge_verdict("Attempt 2 wins.\n\nSPECULATION JUDGE: WINNER 2\nIt is more complete.")
            .expect("a clean verdict parses");
    assert_eq!(verdict.winner, 2);
    assert!(!verdict.rationale.is_empty(), "a rationale is captured");

    // Case-insensitive, and the last marker wins.
    let verdict = parse_judge_verdict("speculation judge: winner 1\nspeculation judge: winner 3")
        .expect("the last marker wins");
    assert_eq!(verdict.winner, 3);

    // No marker at all → error (never guess a winner).
    assert!(
        parse_judge_verdict("I think the second attempt is best, honestly.").is_err(),
        "a message with no verdict marker is an error"
    );
    // A zero (or non-numeric) winner → error (attempts are 1-based).
    assert!(
        parse_judge_verdict("SPECULATION JUDGE: WINNER 0").is_err(),
        "winner 0 is rejected"
    );
    assert!(
        parse_judge_verdict("SPECULATION JUDGE: WINNER none").is_err(),
        "a non-numeric winner is rejected"
    );
}

// ---------------------------------------------------------------------------
// Responses as code: the code-shaped turn runs a program in the sandbox
// ---------------------------------------------------------------------------

/// A capability set with responses-as-code enabled on top of the minimal defaults, optionally with
/// the given params (for example a low `fuel` ceiling), bound to `model_id`.
fn rac_set(model_id: &str, params: serde_json::Value) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model_id);
    let mut cap = GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE);
    cap.params = params;
    set.capabilities.push(cap);
    set
}

/// The single `CodeExecution` payload a code-mode turn emits, or `None`.
fn first_code_execution(
    events: &[GgTelemetryEvent],
) -> Option<(bool, u64, Option<u64>, Option<String>)> {
    events.iter().find_map(|e| match &e.kind {
        GgTelemetryKind::CodeExecution {
            ok,
            tool_calls,
            fuel_used,
            error,
        } => Some((*ok, *tool_calls, *fuel_used, error.clone())),
        _ => None,
    })
}

/// The headline offline e2e: with responses-as-code on, the turn is driven through the code engine —
/// the model emits a program (a loop + a conditional + composed tool calls), gg runs it in the
/// wasmtime sandbox, its tool calls fire against the real toolset, and the program's result feeds
/// back so the loop continues to a clean finish.
#[tokio::test]
async fn responses_as_code_routes_the_turn_through_the_code_engine() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-rac".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), rac_set("mock/primary", json!({})));
    let factory = ScriptedFactory::new().slot("primary", |b| {
        Box::new(MockClient::with_responses_as_code_script(&b.model_id))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    // (a) the program's composed `write_file` calls really wrote the `.txt` level files, and its
    // conditional skipped the `.md` name — proof the loop + conditional ran in the sandbox.
    for level in MOCK_RAC_LEVEL_FILES {
        assert!(
            dir.path().join(level).exists(),
            "the program should have written {level}"
        );
    }
    assert!(
        !dir.path().join("notes.md").exists(),
        "the conditional should have skipped the .md name"
    );

    let events = sink.events();

    // (b) exactly one code execution, successful, with the four composed tool calls counted
    // (list_dir + three write_file).
    let (ok, tool_calls, fuel_used, error) =
        first_code_execution(&events).expect("a CodeExecution event");
    assert!(ok, "the program ran successfully");
    assert_eq!(tool_calls, 4, "list_dir + three write_file were composed");
    assert!(
        fuel_used.is_some_and(|f| f > 0),
        "a successful run reports the fuel it consumed"
    );
    assert!(error.is_none(), "a clean run carries no error");

    // (c) the composed calls stay visible as ordinary tool telemetry: a write_file ToolCall before
    // its successful ToolResult.
    let call = events.iter().position(
        |e| matches!(&e.kind, GgTelemetryKind::ToolCall { name, .. } if name == "write_file"),
    );
    let result = events.iter().position(|e| {
        matches!(&e.kind, GgTelemetryKind::ToolResult { name, ok, .. } if name == "write_file" && *ok)
    });
    assert!(
        call.is_some() && result.is_some() && call < result,
        "a write_file ToolCall precedes its ToolResult"
    );

    // (d) the session completed, and its summary records the code-shaped mode + one execution.
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.execution_mode, "responses_as_code");
    assert_eq!(summary.code_executions, 1);
}

/// The off arm is unchanged: a run **without** responses-as-code drives the ordinary tool-calling
/// path, emits no `CodeExecution`, and records the tool-calling execution mode.
#[tokio::test]
async fn tool_calling_mode_is_unchanged_and_records_its_mode() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-tc".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let events = sink.events();
    // The tool-calling path still wrote the default script's file...
    assert!(dir.path().join("index.html").exists());
    // ...and emitted no code execution.
    assert!(
        first_code_execution(&events).is_none(),
        "a tool-calling run runs no program"
    );
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.execution_mode, "tool_calling");
    assert_eq!(summary.code_executions, 0);
}

/// A program that exhausts the sandbox's fuel ceiling surfaces cleanly: the failed execution is fed
/// back as the turn's outcome (a `CodeExecution { ok: false }`) and the run continues to a clean
/// finish rather than crashing.
#[tokio::test]
async fn responses_as_code_fuel_exhaustion_surfaces_cleanly() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-fuel".to_string()), Box::new(sink.clone()));
    // A low fuel ceiling trips the runaway `while true` program quickly.
    let inv = invocation(
        dir.path(),
        rac_set("mock/primary", json!({ "fuel": 200000 })),
    );
    let factory = ScriptedFactory::new().slot("primary", |b| {
        Box::new(MockClient::with_responses_as_code_runaway_script(
            &b.model_id,
        ))
    });

    // The run did not crash — it ran to a terminal session.
    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let (ok, _tool_calls, _fuel, error) =
        first_code_execution(&events).expect("a CodeExecution event");
    assert!(!ok, "a fuel-exhausted program is not a clean execution");
    assert!(error.is_some(), "the sandbox failure is reported");
    // The loop continued past the failed program to a clean session end.
    assert!(matches!(
        &events.last().unwrap().kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}

/// A program that calls a delegation tool still goes through the scheduler: the code-mode parent's
/// program spawns a subagent (also code-driven) and waits for it, the child runs and writes its
/// file, and the agent tree records the spawn — exactly as a tool-calling delegation would.
#[tokio::test]
async fn responses_as_code_program_subagent_honors_the_scheduler() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-rac-sub".to_string()), Box::new(sink.clone()));
    // Subagents + multi-model + responses-as-code, under a cap of 1 (so the child only runs once the
    // waiting parent frees its slot — the scheduler's blocked-frees-slot rule).
    let mut set = subagent_set(1, 3, &["subagent"]);
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE));
    let inv = invocation(dir.path(), set);
    let factory = ScriptedFactory::new()
        .slot("primary", |b| {
            Box::new(MockClient::with_responses_as_code_parent_script(
                &b.model_id,
            ))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::with_responses_as_code_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    // The child actually ran (its program wrote the greeting file in the shared workspace).
    assert!(
        dir.path().join(MOCK_SUBAGENT_FILE).exists(),
        "the code-driven subagent wrote its file, so it ran under the scheduler"
    );

    let events = sink.events();
    // A subagent was spawned at depth 1 on the `subagent` slot — the spawn went through the tree.
    let spawns = agent_spawns(&events);
    assert!(
        spawns
            .iter()
            .any(|(_, parent, slot, depth, _)| parent.is_some()
                && slot == "subagent"
                && *depth == 1),
        "a subagent was spawned from the program at depth 1: {spawns:?}"
    );
    // Both agents ran code-shaped turns (the parent's and the child's programs).
    let code_execs = events
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::CodeExecution { .. }))
        .count();
    assert!(
        code_execs >= 2,
        "both the parent and the subagent ran a program, got {code_execs}"
    );
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.execution_mode, "responses_as_code");
}
