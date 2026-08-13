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

use super::*;

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
struct PanickingClient {
    model_id: String,
}

impl PanickingClient {
    fn new(model_id: impl Into<String>) -> Self {
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
/// waited out the run's ceiling. The teardown fails the issue instead, which is both the honest
/// board state and what resolves those waits.
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
