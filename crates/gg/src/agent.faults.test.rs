//! **gg's own faults**: the status they end an agent on, and the run they take down with them.
//!
//! A run's output is attribution data: it is scored against the model that produced it. So a
//! failure of gg's own machinery has to end the agent under gg's status, `internal_error`, and
//! never under the model's, `model_error`. A fault of ours filed in the model's column is not a
//! degraded result — it is a wrong one that reads like a real one, and nothing downstream can tell
//! the difference.
//!
//! The second half of the file holds the other consequence of the same rule. A defect that stopped
//! an agent **anywhere** in the tree ends the whole run, because the tree that comes back from a
//! run gg broke is not the tree that configuration produces: work is missing from it, or the rest
//! of the run built around the hole, and a run like that cannot be compared with a clean one. The
//! interesting cases are therefore the non-root ones, since a host fault strikes whichever agent
//! was taking a turn and most agents are not the root.
//!
//! The last section is the one fault an agent cannot report for itself: a task that **panicked**,
//! whose frame is being unwound rather than arriving at a turn boundary to read the latch. Its
//! tests are therefore about what happens *around* the agent — the run's status, and whoever was
//! waiting on it.
//!
//! Every [fatal fault](FatalFault) is driven through the live loop, since that is where the
//! classification is: the sandbox's own suite proves which failures are gg's, and only the loop can
//! prove what the session then says it ended as. None can be provoked honestly — a released build's
//! guest artifact compiles and instantiates, the wasm host's configuration is a constant, and gg's
//! generated surface is checked in CI — so each is armed through the
//! [seam](crate::sandbox::force_next_program_fault) that exists for exactly this, and no test here
//! pays a component compile.

use std::any::Any;

use super::*;
use test_cabinet_core::gg::{CAPABILITY_AGENT_PERSISTENCE, GgTurnErrorType, GgTurnOutcome};

/// Responses-as-code on, over the [tool-calling default](no_code): these tests need a turn that
/// reaches the sandbox, and nothing else about the mode.
fn code_on() -> CodeSetup {
    CodeSetup {
        enabled: true,
        ..no_code()
    }
}

/// Drive a root agent whose first program hits `fault`, and hand back how its loop ended together
/// with the `error` lines the operator was given.
///
/// The client's script is three programs long and only the first is ever asked for: a fatal fault
/// ends the agent on the turn it lands on, so a script that could keep going is what makes that
/// observable rather than assumed.
async fn drive_into(fault: SandboxError) -> (LoopEnd, Vec<String>) {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    crate::sandbox::force_next_program_fault(fault);

    let end = drive_root(
        &MockClient::new(
            "mock/primary",
            vec![code_reply("fs.writeFile(\"a.txt\", \"hi\");"); 3],
        ),
        dir.path(),
        &registry,
        &emitter,
        no_limits(10),
        code_on(),
    )
    .await;

    let errors = sink
        .events()
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::Log { level, message } if level == "error" => Some(message.clone()),
            _ => None,
        })
        .collect();
    (end, errors)
}

/// **A guest artifact that will not run ends the agent as gg's defect.**
///
/// The model's program was never judged: the committed component could not be instantiated, so
/// nothing read what the model wrote. Recording that as a failed model turn would attribute
/// artifact drift in gg's own build to whichever model happened to be bound to the run.
#[tokio::test]
async fn an_artifact_defect_ends_the_agent_with_internal_error() {
    let (end, errors) = drive_into(SandboxError::Instantiate(
        "the component could not be instantiated: missing import `gg:sandbox/host`".to_string(),
    ))
    .await;

    assert_eq!(
        end.status, STATUS_INTERNAL_ERROR,
        "artifact drift is gg's own defect, not a model turn that failed"
    );
    assert!(
        is_failure_status(end.status),
        "an agent gg's defect stopped has failed, whoever's fault it is"
    );
    assert_eq!(end.turns, 1, "the turn the fault landed on still happened");
    assert!(
        errors
            .iter()
            .any(|message| message.contains("artifact drift")),
        "the operator must be told which fault it was: {errors:?}"
    );
}

/// **A host fault ends the agent as gg's defect.**
///
/// The other half of [`FatalFault`], and the one that lands *after* a model call the provider
/// served perfectly well: the model answered with a program and gg's own plumbing could not run it.
#[tokio::test]
async fn a_host_fault_ends_the_agent_with_internal_error() {
    let (end, errors) = drive_into(SandboxError::Host(
        "the code sandbox task did not complete: task panicked".to_string(),
    ))
    .await;

    assert_eq!(
        end.status, STATUS_INTERNAL_ERROR,
        "a fault in gg's own plumbing is not the model's failure"
    );
    assert_eq!(end.turns, 1, "the turn the fault landed on still happened");
    assert!(
        errors
            .iter()
            .any(|message| message.contains("gg's own plumbing")),
        "the operator must be told which fault it was: {errors:?}"
    );
    assert!(
        end.final_text
            .as_deref()
            .is_some_and(|text| text.contains(STATUS_INTERNAL_ERROR)),
        "the agent hands its spawner the ending it actually had: {:?}",
        end.final_text
    );
}

/// **A lowering defect ends the agent as gg's, and is charged to the model nowhere.**
///
/// The fault that wears a compiler's clothes: gg read the model's program, accepted it, and then
/// could not turn it into something the guest runs. It was reported as a `transpile_lowering` turn
/// error, which put gg's bug in the model's error record, counted it against the error ceilings that
/// can end a session `limit_exceeded`, and handed the model gg's own diagnostic under `Compiler
/// error` to rewrite a program nothing was wrong with. All three are asserted against here: the
/// status, the absence of any recorded error type on the turn, and the operator's line saying whose
/// pipeline it was.
#[tokio::test]
async fn a_lowering_defect_ends_the_agent_with_internal_error() {
    let (end, errors) = drive_into(SandboxError::Lowering(
        "the generated declarations gg checks a program against were rejected by tsc".to_string(),
    ))
    .await;

    assert_eq!(
        end.status, STATUS_INTERNAL_ERROR,
        "gg's own preparation failing is not a model turn that failed"
    );
    assert_eq!(end.turns, 1, "the turn the fault landed on still happened");
    assert!(
        errors
            .iter()
            .any(|message| message.contains("gg's own pipeline")),
        "the operator must be told which fault it was: {errors:?}"
    );
}

/// **The turn a lowering defect landed on carries no error type at all.**
///
/// The half of the misattribution that outlives the run. A status is read once; the published turn
/// record is what a study groups by, and a `transpile_lowering` row in it says the model wrote a
/// program that would not compile.
#[tokio::test]
async fn a_lowering_defect_records_no_error_type_against_the_model() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    crate::sandbox::force_next_program_fault(SandboxError::Lowering(
        "the transform over the accepted program failed".to_string(),
    ));

    drive_root(
        &MockClient::new(
            "mock/primary",
            vec![code_reply("fs.writeFile(\"a.txt\", \"hi\");"); 3],
        ),
        dir.path(),
        &registry,
        &emitter,
        no_limits(10),
        code_on(),
    )
    .await;

    let outcomes: Vec<_> = sink
        .events()
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::TurnOutcome {
                outcome,
                error,
                error_type,
                ..
            } => Some((*outcome, *error, *error_type)),
            _ => None,
        })
        .collect();

    assert_eq!(
        outcomes,
        vec![(test_cabinet_core::gg::GgTurnOutcome::Fatal, None, None)],
        "the turn is published as gg's fault, with no error and no type under it: {outcomes:?}"
    );
}

// ---------------------------------------------------------------------------
// A gg defect anywhere in the tree ends the run
// ---------------------------------------------------------------------------

/// Every `error`-level log message in the stream, in order, each with the agent whose stream it was
/// said on.
///
/// The agent matters here: a fault is reported three times over — by the agent that met it, by each
/// agent that winds down because of it, and once at run level on the root's stream — and which of
/// those a message is decides whether an operator asking "why did this run fail?" is answered.
fn errors_by_agent(events: &[GgTelemetryEvent]) -> Vec<(Option<String>, String)> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::Log { level, message } if level == "error" => {
                Some((event.agent_id.clone(), message.clone()))
            }
            _ => None,
        })
        .collect()
}

/// The status of the session's terminal [`SessionEnded`](GgTelemetryKind::SessionEnded).
fn terminal_status(events: &[GgTelemetryEvent]) -> Option<String> {
    events.iter().rev().find_map(|event| match &event.kind {
        GgTelemetryKind::SessionEnded { status } => Some(status.clone()),
        _ => None,
    })
}

/// `set`'s profile named `profile`, switched to [responses as code](CAPABILITY_RESPONSES_AS_CODE).
///
/// Which is how a **non-root** agent is made to reach the sandbox at all: the forced fault is armed
/// once for the next program the process runs, so leaving the root on the tool-calling path is what
/// makes the child's first program the one that meets it.
fn code_mode(set: &mut GgCapabilitySet, profile: &str) {
    let agent = set
        .agents
        .iter_mut()
        .find(|agent| agent.name == profile)
        .expect("the set declares the profile put into code mode");
    crate::tools::grant(agent, CAPABILITY_RESPONSES_AS_CODE);
}

/// **A spawned child's host fault ends the whole run.**
///
/// The root here is a working agent in the middle of a working run: it delegates, waits, and has a
/// finishing turn scripted after the wait. Before this rule it would have taken that turn, the
/// session would have ended `completed` and exited 0, and `core` would have collected a tree with
/// the child's work missing from it and no way to know. There is no reading of that tree that says
/// anything true about the model.
#[tokio::test]
async fn a_spawned_childs_host_fault_ends_the_run() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-child-fault".to_string()), Box::new(sink.clone()));
    let mut set = subagent_set(2, 3, &["subagent"]);
    code_mode(&mut set, "subagent");
    let inv = invocation(dir.path(), set);

    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, |b| {
            Box::new(MockClient::with_subagent_parent_script(&b.model_id))
        })
        // The child's first reply is a program, and it is the program the armed fault lands on.
        .slot("subagent", |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![code_reply("fs.writeFile(\"a.txt\", \"hi\");"); 2],
            ))
        });

    crate::sandbox::force_next_program_fault(SandboxError::Host(
        "the code sandbox task did not complete: task panicked".to_string(),
    ));

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::HarnessError,
        "a run gg broke exits non-zero so `core` records a harness error instead of scoring it"
    );

    let events = sink.events();
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_INTERNAL_ERROR),
        "the session says whose fault it was, and it was ours"
    );

    // The diagnostic names the agent, its profile and what broke — and says so at run level, on the
    // root's own stream, where a reader starting from the run's failure is looking.
    let errors = errors_by_agent(&events);
    assert!(
        errors
            .iter()
            .any(|(agent, message)| agent.as_deref() == Some(ROOT_AGENT_ID)
                && message.contains("`agent-0`")
                && message.contains("`subagent`")
                && message.contains("gg's own plumbing")),
        "the run-level diagnostic must name the child, its profile and the fault: {errors:?}"
    );

    // The tree the run recorded is kept: the child is still in it, and so is its spawn.
    let spawns = agent_spawns(&events);
    assert_eq!(spawns.len(), 2, "the root and the child it spawned");
    assert!(
        spawns
            .iter()
            .any(|(id, _, slot, _, _)| id.as_deref() == Some("agent-0") && slot == "subagent"),
        "the wind-down keeps what the run recorded before the fault: {spawns:?}"
    );

    // ...as is the epilogue a killed run keeps, which is the whole reason the wind-down is
    // cooperative rather than a process the session tears down.
    assert!(
        events
            .iter()
            .any(|event| matches!(event.kind, GgTelemetryKind::SessionSummary { .. })),
        "the session summary is still emitted for the operator debugging the defect"
    );
}

/// **The root stops at its next turn boundary rather than running on.**
///
/// The other half of the rule above: a run that ended `internal_error` only because the root
/// happened to have nothing left to do would leave a long-running root spending the rest of the
/// run's budget on work nothing will ever score. The root's script here is twenty finishing turns
/// long and it takes none of them.
#[tokio::test]
async fn the_root_winds_down_at_its_next_boundary_after_a_childs_fault() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-child-winddown".to_string()),
        Box::new(sink.clone()),
    );
    let mut set = subagent_set(2, 3, &["subagent"]);
    code_mode(&mut set, "subagent");
    let inv = invocation(dir.path(), set);

    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, |b| {
            Box::new(MockClient::with_subagent_parent_script(&b.model_id))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![code_reply("fs.writeFile(\"a.txt\", \"hi\");"); 2],
            ))
        });

    crate::sandbox::force_next_program_fault(SandboxError::Instantiate(
        "the component could not be instantiated: missing import `gg:sandbox/host`".to_string(),
    ));

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::HarnessError
    );

    // The root said, on its own stream, that it stopped at a boundary because the run had faulted —
    // which is what a console reader standing on the root's timeline needs to see.
    let errors = errors_by_agent(&sink.events());
    assert!(
        errors
            .iter()
            .any(|(agent, message)| agent.as_deref() == Some(ROOT_AGENT_ID)
                && message.contains("stopped at a turn boundary")
                && message.contains("artifact drift")),
        "the root must report the run's fault as the reason it stopped: {errors:?}"
    );
}

/// **An issue agent's fault ends the run the root already finished.**
///
/// gg dispatches an issue's implementer itself, so this agent is nobody's child and the root is
/// under no obligation to wait for it. That is the case the session's terminal status cannot be
/// read off the root's ending for: the root can finish cleanly, and a defect in an agent still
/// working the board would leave a `completed` session exiting 0 with a board full of unfinished
/// work.
#[tokio::test]
async fn an_issue_agents_host_fault_ends_the_run() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-issue-fault".to_string()), Box::new(sink.clone()));
    let mut set = split_project_set();
    code_mode(&mut set, CODER_AGENT);
    let inv = invocation(dir.path(), set);

    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, |b| {
            // The root files the issue and finishes; gg dispatches the implementer.
            Box::new(MockClient::new(
                &b.model_id,
                vec![create_issue_for_coder(), stop_response()],
            ))
        })
        .slot(CODER_AGENT, |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![code_reply("fs.writeFile(\"a.txt\", \"hi\");"); 2],
            ))
        });

    crate::sandbox::force_next_program_fault(SandboxError::Host(
        "the code sandbox task did not complete: task panicked".to_string(),
    ));

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::HarnessError,
        "a defect in an agent gg dispatched is still gg's defect"
    );

    let events = sink.events();
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_INTERNAL_ERROR),
        "the run's status comes from the fault, not from whatever the root's loop did"
    );
    let errors = errors_by_agent(&events);
    assert!(
        errors
            .iter()
            .any(|(agent, message)| agent.as_deref() == Some(ROOT_AGENT_ID)
            && message.contains(&format!("`{CODER_AGENT}`"))
            && message.contains("gg's own plumbing")
            // The epilogue's own sentence, which no agent's wind-down line carries: the run-level
            // statement has to be there whether or not the root was still running to make one.
            && message.contains("exits non-zero")),
        "the run-level diagnostic must name the implementer and the fault: {errors:?}"
    );
}

// ---------------------------------------------------------------------------
// A faulted run starts no new work
// ---------------------------------------------------------------------------

/// **An issue whose agent the fault stopped is failed, not tried again.**
///
/// The run above with the board's retry budget in view: the implementer did not finish, one retry
/// remains, and the ordinary reading of that is "re-dispatch it". Under a fault it is the wrong
/// reading — the fresh agent creates or reuses the issue's worktree, reads the latch at its first
/// turn boundary and stops there — so the board would record `maxRetries` attempts at work nothing
/// ever attempted, which reads as a model that could not finish it.
#[tokio::test]
async fn a_faulted_run_does_not_re_dispatch_the_issue_it_stopped() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-issue-retry".to_string()), Box::new(sink.clone()));
    let mut set = split_project_set();
    code_mode(&mut set, CODER_AGENT);
    let inv = invocation(dir.path(), set);

    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![create_issue_for_coder(), stop_response()],
            ))
        })
        // Long enough to work the issue twice over, so a second attempt would be a working agent
        // rather than one that ran out of script.
        .slot(CODER_AGENT, |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![code_reply("fs.writeFile(\"a.txt\", \"hi\");"); 4],
            ))
        });

    crate::sandbox::force_next_program_fault(SandboxError::Host(
        "the code sandbox task did not complete: task panicked".to_string(),
    ));

    assert_eq!(
        timeout(&inv, &emitter, factory).await,
        SessionOutcome::HarnessError
    );

    let events = sink.events();
    let attempts = agent_spawns(&events)
        .iter()
        .filter(|(_, _, slot, _, _)| slot == CODER_AGENT)
        .count();
    assert_eq!(
        attempts,
        1,
        "the issue is attempted once and not re-dispatched under a raised fault: {:?}",
        agent_spawns(&events)
    );
    assert_eq!(
        last_issue_status(&events, UNGROUPED_ISSUE_ID),
        Some(GgIssueStatus::Failed),
        "the board must say the work did not happen rather than leaving it in progress for ever"
    );
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_INTERNAL_ERROR),
        "a failed issue is the board's account of it; the run's is that gg broke"
    );
}

/// **An issue the fault reached first is never claimed at all.**
///
/// The other half of the same rule, one step earlier: an issue that is dispatchable when the board
/// is pumped would be claimed, moved to `in_progress` and given an agent — an account of a run in
/// which the issue was never reached. Left unclaimed it stays `open`, which is what happened.
///
/// Driven against the board directly rather than through a session, because the pump that can run
/// after a fault is the one an agent's tool call makes from inside a turn that was already under way
/// when the fault landed. A test that raced a session for it would be a test that sometimes proves
/// nothing.
#[tokio::test]
async fn a_faulted_run_claims_no_further_issue() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-board-fault".to_string()), Box::new(sink.clone()));
    let mut warnings = Vec::new();
    let orch = Arc::new(
        Orchestrator::build(
            &invocation(dir.path(), split_project_set()),
            &emitter,
            Arc::new(ScriptedFactory::new()),
            crate::tools::real_shell(),
            WorktreesSetup {
                baseline_commit: None,
                root: None,
            },
            &mut warnings,
        )
        .expect("a board set builds an orchestrator"),
    );
    let issue_id = orch
        .board
        .store()
        .lock()
        .expect("board store lock")
        .create_issue(crate::board::NewIssue {
            title: "Add the widget",
            description: None,
            in_scope: "Implement the widget.",
            out_of_scope: "Nothing else.",
            completion_criteria: "The widget works.",
            blocked_by: &[],
            epic_id: None,
            agent: CODER_AGENT,
            reviewers: &[],
        })
        .expect("the store files the issue");

    orch.fault.in_agent(
        "agent-0",
        "subagent",
        "the code sandbox host would not start",
    );
    orch.on_issue_progress(&emitter);

    let events = sink.events();
    assert!(
        agent_spawns(&events).is_empty(),
        "a faulted run stands no agent up for an issue it never reached: {:?}",
        agent_spawns(&events)
    );
    assert_eq!(
        last_issue_status(&events, &issue_id),
        Some(GgIssueStatus::Open),
        "an issue nothing was ever dispatched for is open, not in progress"
    );
}

// ---------------------------------------------------------------------------
// A panicked agent task
// ---------------------------------------------------------------------------

/// What the panicking client below says, so a test can prove the message reached the run record
/// rather than merely that *something* panicked.
const PANIC_SITE: &str = "the agent roster lock is poisoned";

/// A client whose turn panics instead of answering.
///
/// The mechanism is not the point and any panic under the agent's loop would do; a poisoned lock is
/// simply the one gg would actually meet, since it reads every one of its own with `.expect`. What
/// makes it the right injection point is where it lands: inside the frame that drives the agent,
/// which is the frame that can never reach another turn boundary to read the run's fault latch.
///
/// Shared with the [wait tests](super::wait_tests), which need the same defect under a *suspended*
/// agent rather than a running one. There is one way to raise a real fault in a test and this is it.
pub(super) struct PanickingClient {
    model_id: String,
}

impl PanickingClient {
    pub(super) fn new(model_id: impl Into<String>) -> Self {
        Self {
            model_id: model_id.into(),
        }
    }
}

#[async_trait::async_trait]
impl ModelClient for PanickingClient {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        panic!("{PANIC_SITE}");
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }
}

/// A root turn that delegates to the `subagent` profile.
fn spawn_the_subagent() -> ModelResponse {
    ModelResponse {
        text: Some("Delegating the work.".to_string()),
        tool_calls: vec![ToolCall {
            id: "call_spawn".to_string(),
            name: "spawn_subagent".to_string(),
            arguments: json!({ "prompt": "Do the work.", "agent": "subagent" }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        loop_aborts: 0,
    }
}

/// **An agent whose task panics ends the run, and the run says which agent it was.**
///
/// The panic is the one gg defect that cannot be reported by the agent it strikes: the frame that
/// reads the [fault latch](crate::fault) at the next turn boundary is the frame being unwound. So
/// nothing latched it, the task simply stopped, and this run — whose root delegates and then
/// finishes without waiting for anybody — ended `completed`, exited 0, and was scored against the
/// model with the child's work missing and nothing in the record saying so.
#[tokio::test]
async fn a_panicking_agent_task_ends_the_run_with_internal_error() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-child-panic".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), subagent_set(2, 3, &["subagent"]));

    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, |b| {
            // Spawn and finish: nothing is ever waiting on the child, which is the shape that used
            // to produce a scored run.
            Box::new(MockClient::new(
                &b.model_id,
                vec![spawn_the_subagent(), stop_response()],
            ))
        })
        .slot("subagent", |b| Box::new(PanickingClient::new(&b.model_id)));

    assert_eq!(
        timeout(&inv, &emitter, factory).await,
        SessionOutcome::HarnessError,
        "a run an agent panicked in exits non-zero rather than handing over a tree to score"
    );

    let events = sink.events();
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_INTERNAL_ERROR),
        "a panic is gg's own defect, whatever the root went on to do"
    );

    // The run-level statement, on the root's stream, naming the agent, its profile and what the
    // panic said.
    let errors = errors_by_agent(&events);
    assert!(
        errors.iter().any(|(agent, message)| {
            agent.as_deref() == Some(ROOT_AGENT_ID)
                && message.contains("`agent-0`")
                && message.contains("`subagent`")
                && message.contains("panicked")
                && message.contains(PANIC_SITE)
        }),
        "the run-level diagnostic must name the panicked agent and carry the panic: {errors:?}"
    );
    // ...and the panicked agent's own node in the tree says so too, since that is where a reader
    // who starts from the failed agent rather than from the run is standing.
    assert!(
        errors.iter().any(|(agent, message)| {
            agent.as_deref() == Some("agent-0") && message.contains(PANIC_SITE)
        }),
        "the panicked agent reports the panic on its own stream: {errors:?}"
    );
    assert!(
        events
            .iter()
            .any(|event| event.agent_id.as_deref() == Some("agent-0")
                && matches!(
                    event.kind,
                    GgTelemetryKind::AgentStatus {
                        status: GgAgentStatus::Failed,
                        ..
                    }
                )),
        "the console must show the panicked agent as failed rather than as still running"
    );
}

/// **A parent blocked on a child that panics is woken by the panic, not by the run's deadline.**
///
/// The half of the defect that turns gg's fault into the model's: a `wait_for_subagents` resolves
/// when the child signals its spawner, and a panicked task signalled nothing. The parent waited out
/// the wall-clock ceiling and the session ended `timed_out` — a ceiling status, read as a model
/// that took too long, on a run gg had already broken.
///
/// The parallelism cap of one is what makes the wait deterministic rather than raced: the child can
/// only start once the parent has blocked and freed the only slot.
#[tokio::test]
async fn a_parent_blocked_on_a_panicking_child_is_woken() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-wait-panic".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), subagent_set(1, 3, &["subagent"]));

    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, |b| {
            Box::new(MockClient::with_subagent_parent_script(&b.model_id))
        })
        .slot("subagent", |b| Box::new(PanickingClient::new(&b.model_id)));

    assert_eq!(
        timeout(&inv, &emitter, factory).await,
        SessionOutcome::HarnessError
    );

    let events = sink.events();
    let root_status = |wanted: GgAgentStatus, from: usize| {
        events.iter().skip(from).position(|event| {
            event.agent_id.as_deref() == Some(ROOT_AGENT_ID)
                && matches!(event.kind, GgTelemetryKind::AgentStatus { status, .. } if status == wanted)
        })
    };
    // The root announces itself `Running` when it starts, so the resume is the *next* one after it
    // blocked — which is the transition the panicked child's teardown is responsible for.
    let blocked = root_status(GgAgentStatus::Blocked, 0).expect("the root blocked on its child");
    root_status(GgAgentStatus::Running, blocked + 1)
        .expect("the root must resume rather than wait out the run's deadline");

    // Woken, the root reads the fault at its next boundary and stops there rather than taking the
    // finishing turn its script still holds.
    let errors = errors_by_agent(&events);
    assert!(
        errors.iter().any(|(agent, message)| {
            agent.as_deref() == Some(ROOT_AGENT_ID)
                && message.contains("stopped at a turn boundary")
        }),
        "the woken root winds the run down instead of carrying on: {errors:?}"
    );
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_INTERNAL_ERROR),
        "the run is gg's defect, not a ceiling the model ran into"
    );
}

/// Run a session, failing the test rather than hanging if it does not end.
///
/// Every assertion in this section is about a wait that must not be left outstanding, and the
/// failure mode of the bug they cover is a run that waits out its wall-clock ceiling — hours, in a
/// real run. A bound here turns that into a failed test in a minute.
async fn timeout(
    inv: &GgInvocation,
    emitter: &Emitter,
    factory: ScriptedFactory,
) -> SessionOutcome {
    tokio::time::timeout(
        std::time::Duration::from_secs(60),
        run_with_factory(inv, emitter, Arc::new(factory)),
    )
    .await
    .expect("the session must end on the panic rather than on a deadline")
}

/// **An agent suspended on an issue whose implementer panics is woken too.**
///
/// The board's version of the wait above, and the one with no handle behind it: nobody holds an
/// issue agent, so nothing but the board says whether its work happened. A panicked implementer
/// left its issue `InProgress` for ever, and every agent suspended in a `wait_for_issue` on it
/// waited out the run's ceiling. The teardown fails the issue instead, which is the honest board
/// state.
///
/// What releases the wait is the fault the teardown latched a moment earlier, and that is what the
/// call reports — not the issue's failure, which is a consequence of the panic rather than the
/// cause. The waits nothing on the board could reach are covered by
/// [their own file](super::wait_tests).
#[tokio::test]
async fn an_agent_waiting_on_a_panicking_issue_agent_is_woken() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-issue-panic".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), split_project_set());

    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    create_issue_for_coder(),
                    tool_call_response(
                        "wait",
                        "wait_for_issue",
                        json!({ "issueId": UNGROUPED_ISSUE_ID }),
                    ),
                    stop_response(),
                ],
            ))
        })
        .slot(CODER_AGENT, |b| Box::new(PanickingClient::new(&b.model_id)));

    assert_eq!(
        timeout(&inv, &emitter, factory).await,
        SessionOutcome::HarnessError
    );

    let events = sink.events();
    assert!(
        events.iter().any(|event| matches!(
            &event.kind,
            GgTelemetryKind::ToolResult { name, .. } if name == "wait_for_issue"
        )),
        "the root's wait resolved rather than outlasting the run"
    );
    assert_eq!(
        last_issue_status(&events, UNGROUPED_ISSUE_ID),
        Some(GgIssueStatus::Failed),
        "an issue whose implementer panicked did not get done, and the board must say so"
    );
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_INTERNAL_ERROR),
        "a failed issue is the board's account of it; the run's is that gg broke"
    );
}

/// **An issue whose worktree checkout panicked is failed, and takes the run with it.**
///
/// The one piece of an agent's task that runs *before* its [teardown](AgentTeardown) exists: an
/// issue's isolated checkout is made inside the spawned task, so that an `npm install`-sized tree is
/// paid for by the agent about to use it rather than by whichever agent's tool call made the issue
/// actionable. A panic there has no teardown to catch it, and the issue it was preparing stays
/// `InProgress` for the rest of the run — the board claiming work is under way that nobody is doing,
/// with every `wait_for_issue` on it suspended behind the claim.
///
/// The panic is a **poisoned lock**, which is not a stand-in: gg reads every one of its own with
/// `.expect`, so one panic anywhere leaves the next reader of that lock panicking, and the map of
/// issue worktrees is read on the first line of the checkout. Poisoning it here is the same defect
/// this catch exists for, arriving the way it really arrives.
#[tokio::test]
async fn an_issue_whose_worktree_checkout_panicked_fails_rather_than_hanging() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-worktree-panic".to_string()),
        Box::new(sink.clone()),
    );
    let mut warnings = Vec::new();
    let orch = Arc::new(
        Orchestrator::build(
            &invocation(dir.path(), split_project_set()),
            &emitter,
            Arc::new(ScriptedFactory::new()),
            crate::tools::real_shell(),
            WorktreesSetup {
                baseline_commit: None,
                root: None,
            },
            &mut warnings,
        )
        .expect("a board set builds an orchestrator"),
    );
    let issue_id = orch
        .board
        .store()
        .lock()
        .expect("board store lock")
        .create_issue(crate::board::NewIssue {
            title: "Add the widget",
            description: None,
            in_scope: "Implement the widget.",
            out_of_scope: "Nothing else.",
            completion_criteria: "The widget works.",
            blocked_by: &[],
            epic_id: None,
            agent: CODER_AGENT,
            reviewers: &[],
        })
        .expect("the store files the issue");

    // Some earlier agent panicked holding this lock. Every reader of it panics from here on.
    let poisoner = Arc::clone(&orch);
    std::thread::spawn(move || {
        let _guard = poisoner
            .issue_worktrees
            .lock()
            .expect("issue worktrees lock");
        panic!("{PANIC_SITE}");
    })
    .join()
    .expect_err("the helper thread panics on purpose, which is what poisons the lock");

    orch.spawn_issue_agent(
        "agent-0".to_string(),
        issue_id.clone(),
        "Implement it.".to_string(),
        0,
        &emitter,
    );
    let task = orch
        .tasks
        .lock()
        .expect("subagent tasks lock")
        .pop()
        .expect("the dispatch spawned the issue's task");
    task.handle
        .await
        .expect("the checkout's panic is caught inside the task rather than escaping it");

    assert_eq!(
        orch.board.issue_status(&issue_id),
        Some(crate::board::IssueStatus::Failed),
        "an issue nobody could stand an agent up for is failed, not left claiming to be under way"
    );
    let fault = orch
        .fault
        .raised()
        .expect("a checkout gg could not make is gg's defect and ends the run");
    assert!(
        fault.contains(&issue_id) && fault.contains("preparing its worktree panicked"),
        "the run-level diagnostic must name the issue and what happened to it: {fault}"
    );
    assert!(
        fault.contains("issue worktrees lock"),
        "and carry what the panic said, which for a poisoned lock is the only thing naming it — \
         the message of the panic that poisoned it is long gone: {fault}"
    );
}

/// **A task that panicked where no teardown could see it is caught by the join.**
///
/// [`AgentTeardown`] covers the frame that drives an agent, which is nearly all of an agent's life
/// and not the whole of it: the sliver before the teardown exists, and the teardown's own work, are
/// outside it. A panic there leaves a task that never returned, no fault, no diagnostic — and the
/// session goes on to read the latch, find nothing, and report whatever the root's own loop said.
/// The root usually said `completed`, so the shape this closes is a scored run with an agent missing
/// from its tree.
///
/// Driven against the join directly, with a task that panics immediately, because there is no way to
/// *aim* a panic at that sliver from a model script — which is the same reason the sliver had no
/// test.
#[tokio::test]
async fn a_task_that_panicked_outside_its_loop_is_caught_by_the_join() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-join-panic".to_string()), Box::new(sink.clone()));
    let mut warnings = Vec::new();
    let orch = Arc::new(
        Orchestrator::build(
            &invocation(dir.path(), subagent_set(2, 3, &["subagent"])),
            &emitter,
            Arc::new(ScriptedFactory::new()),
            crate::tools::real_shell(),
            WorktreesSetup {
                baseline_commit: None,
                root: None,
            },
            &mut warnings,
        )
        .expect("a set with no machines builds an orchestrator"),
    );
    orch.tasks
        .lock()
        .expect("subagent tasks lock")
        .push(AgentTask::spawned("agent-0", "subagent", async {
            panic!("{PANIC_SITE}");
        }));

    join_spawned_agents(&orch).await;

    let fault = orch
        .fault
        .raised()
        .expect("a task that never came back is a run that cannot be scored");
    assert!(
        fault.contains("`agent-0`") && fault.contains("`subagent`"),
        "the join is the only thing left that knows which agent it was: {fault}"
    );
    assert!(
        fault.contains("outside its turn loop") && fault.contains(PANIC_SITE),
        "and it must say what it was, or the operator has a disqualified run and no bug report: \
         {fault}"
    );
}

/// The profile the slot case below runs as: [persistent](CAPABILITY_AGENT_PERSISTENCE), so its
/// instances hold their running slot under an
/// [exclusivity key](crate::subagents::ExclusiveKey) and a release of one instance's slot is
/// visible as a release of the *profile*.
const PERSISTENT: &str = "Owner";

/// A run whose second profile is persistent, capped at two running agents.
fn persistent_subagent_set() -> GgCapabilitySet {
    let mut set = subagent_set(2, 3, &[PERSISTENT]);
    let profile = set
        .agents
        .iter_mut()
        .find(|agent| agent.name == PERSISTENT)
        .expect("the set declares the profile it was built with");
    crate::tools::grant_configured(
        profile,
        GgCapabilityConfig::enabled(CAPABILITY_AGENT_PERSISTENCE),
    );
    set
}

/// **An agent that panics while suspended gives back nothing, because it was holding nothing.**
///
/// The teardown returns the running slot of the agent it is ending, which is right for an agent that
/// was *running*. An agent gg has suspended is not: a `wait_for_subagents` and a `wait_for_issue`
/// both hand the slot back for the length of the wait, and the agent that took it is somebody else.
/// Returning it again decrements the run's running count on that agent's behalf — letting the run
/// exceed the parallelism cap it declared — and frees the [exclusivity key](crate::persistence) a
/// second instance of a persistent profile is running under, which is the one thing that key exists
/// to prevent. It can only happen on a run that has already faulted, so it fails no healthy run; it
/// corrupts the wind-down of a broken one, which is the run somebody is trying to read.
///
/// Driven against the teardown rather than through a session because the panic has to land in the
/// window between the release and the resume — a few instructions inside a suspended agent — and a
/// session that raced for it would be a test that usually proves nothing.
#[tokio::test]
async fn a_panic_during_a_wait_gives_back_no_slot() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-wait-slot".to_string()), Box::new(sink.clone()));
    let mut warnings = Vec::new();
    let orch = Arc::new(
        Orchestrator::build(
            &invocation(dir.path(), persistent_subagent_set()),
            &emitter,
            Arc::new(ScriptedFactory::new()),
            crate::tools::real_shell(),
            WorktreesSetup {
                baseline_commit: None,
                root: None,
            },
            &mut warnings,
        )
        .expect("a set with no machines builds an orchestrator"),
    );

    // One instance of the persistent profile, spawned and running.
    let agent = Agent {
        id: "agent-0".to_string(),
        parent_id: Some(ROOT_AGENT_ID.to_string()),
        depth: 1,
        slot: PERSISTENT.to_string(),
        fsm: None,
    };
    let (result_tx, _result_rx) = oneshot::channel();
    let mut role = AgentRole::Sub {
        brief: "Do the work.".to_string(),
        issue_id: None,
        worktree: None,
        ending: EndingRole::Standard,
        inherited: InheritedModules::default(),
        seed: None,
        link: Some(SpawnerLink {
            parent_wait: Arc::new(ParentWait::new()),
            result: result_tx,
            finished: Arc::new(AtomicBool::new(false)),
        }),
    };
    let origin = GgSessionAgentOrigin::Spawn {
        parent: ROOT_AGENT_ID.to_string(),
        ordinal: 0,
    };
    let mut teardown = AgentTeardown::new(&orch, &agent, &origin, &mut role);
    assert_eq!(
        teardown.exclusive(),
        Some(PERSISTENT),
        "a persistent profile's slot is held under its own name, which is what makes the second \
         release observable"
    );
    orch.scheduler
        .acquire_start(teardown.exclusive(), teardown.hold())
        .await;

    // It suspends. Which wait it is does not matter and the teardown cannot tell: every one of them
    // goes through this single release.
    let (_token, _rx) = orch
        .scheduler
        .block_and_release(teardown.exclusive(), teardown.hold());

    // Which is what lets the next instance of the profile run — the whole point of releasing the key
    // with the slot.
    let successor = SlotHold::default();
    orch.scheduler
        .acquire_start(Some(PERSISTENT), &successor)
        .await;
    assert!(orch.scheduler.holds(PERSISTENT));

    // Now the suspended agent's task panics.
    let payload: Box<dyn Any + Send> = Box::new(PANIC_SITE);
    let end = teardown.panicked(payload.as_ref());

    assert_eq!(
        end.status, STATUS_INTERNAL_ERROR,
        "the panic is still gg's defect and still ends the agent"
    );
    assert!(
        orch.fault.raised().is_some(),
        "and still ends the run: what the slot is about is what happens around that"
    );
    assert_eq!(
        orch.scheduler.running(),
        1,
        "the run has exactly one agent running, and a second release would say it has none — \
         which is a slot the wind-down hands to an agent the cap should have held back"
    );
    assert!(
        orch.scheduler.holds(PERSISTENT),
        "the profile belongs to the instance that is running it; freeing it here would let a third \
         instance start beside that one"
    );
    assert!(
        successor.held(),
        "and the instance that holds the slot must still believe it does"
    );
}

// ---------------------------------------------------------------------------------------------
// The turn a gg defect *failed*, as opposed to the turn it ended
// ---------------------------------------------------------------------------------------------

/// A factory that refuses one slot's client with a failure that is **not** a refused credential.
///
/// The one honest way to make [`dispatch_child`] meet a defect: launch validation has already
/// accepted the profile, the spawner's roster already names it, and the provider then cannot be
/// built for it. A refused credential takes the other branch on purpose — a key is supplied rather
/// than fixed — so the status here is a `500`, which [`ModelError::is_auth_failure`] declines.
struct RefusingFactory {
    /// The profile whose client will not build.
    slot: String,
}

impl ClientFactory for RefusingFactory {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        if binding.slot == self.slot {
            return Err(ModelError::Fatal {
                status: 500,
                message: "the provider could not be built for this profile".to_string(),
            });
        }
        Ok(Box::new(MockClient::new(
            &binding.model_id,
            vec![
                // Uncaught on purpose: a program is expected to anticipate a call failing, and the
                // point of this test is the turn where one does not.
                code_reply(
                    "agents.spawnSubagent({ agent: \"subagent\", prompt: \"Do the work.\" });",
                ),
                code_reply(FINISHING_PROGRAM),
            ],
        )))
    }
}

/// Every turn outcome on `agent`'s stream, as the pair this section reads: how it ended, and the
/// specific error type it was recorded under.
fn outcomes_for(
    events: &[GgTelemetryEvent],
    agent: &str,
) -> Vec<(GgTurnOutcome, Option<GgTurnErrorType>)> {
    events
        .iter()
        .filter(|event| event.agent_id.as_deref() == Some(agent))
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::TurnOutcome {
                outcome,
                error_type,
                ..
            } => Some((*outcome, *error_type)),
            _ => None,
        })
        .collect()
}

/// **A turn that failed because gg broke under it is not recorded against the model.**
///
/// The defect does not only end a turn, it fails one. gg refused a spawn it had already validated,
/// the refusal threw into the program that made it, and an uncaught throw is a `program_tool_error`
/// — so gg's own defect entered the published record as a fault the model committed, spent the
/// model's error ceilings, and showed up in a console's failed-call panels under this agent's name.
///
/// The class of the refusal is chosen carefully at the spawn site and is right; what that site
/// cannot fix from where it stands is the turn one layer up. So the assertion here is on the
/// record: this run's root must publish no error turn and no error type at all.
#[tokio::test]
async fn a_turn_gg_broke_under_is_recorded_as_ggs_rather_than_the_models() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-spawn-defect".to_string()), Box::new(sink.clone()));
    let mut set = subagent_set(2, 3, &["subagent"]);
    code_mode(&mut set, ROOT_AGENT);
    // The tightest error ceiling there is, so a turn charged to the model would stop the run under
    // `limit_exceeded` — the status this defect used to be able to produce.
    set.limits.max_consecutive_errors = Some(1);
    let inv = invocation(dir.path(), set);

    assert_eq!(
        run_with_factory(
            &inv,
            &emitter,
            Arc::new(RefusingFactory {
                slot: "subagent".to_string(),
            }),
        )
        .await,
        SessionOutcome::HarnessError,
        "a spawn gg could not carry out leaves the tree missing what that agent was for"
    );

    let events = sink.events();
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_INTERNAL_ERROR),
        "the run ends under gg's status rather than a ceiling's"
    );
    assert_eq!(
        outcomes_for(&events, ROOT_AGENT_ID),
        vec![(GgTurnOutcome::Fatal, None)],
        "the turn is counted, and it is counted as gg's"
    );
    // The other half of the same rule, and the half the spawn family had only ever been proved to
    // *latch*: the epilogue reads the latch and says on the record which profile gg could not stand
    // up. A status with no attribution is barely better than a run that lied — an operator reading
    // it has a disqualified run and nothing to fix.
    let errors = errors_by_agent(&events);
    assert!(
        errors.iter().any(|(agent, message)| {
            agent.as_deref() == Some(ROOT_AGENT_ID)
                && message.contains("`subagent`")
                && message.contains("exits non-zero")
        }),
        "the run-level diagnostic must name the profile gg could not spawn: {errors:?}"
    );
    let summary = session_summary(&events).expect("the session summary is emitted");
    assert_eq!(
        (summary.errors.errors, summary.errors.program_fault),
        (0, 0),
        "gg's defect must not appear in the model's error rollup: {:?}",
        summary.errors
    );
    assert!(
        summary.errors.turns > 0,
        "the turn is still counted in the denominator so the accounting stays whole: {:?}",
        summary.errors
    );
}
