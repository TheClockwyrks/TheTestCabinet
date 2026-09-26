//! **FSM agents driven end to end** — the machine, the incarnation loop, and the transfer between
//! states, exercised offline through the real binary.
//!
//! `fsm.test.rs` proves the *table*: that a machine parses, that a structurally broken one is
//! refused at launch, that a position knows its legal targets. What it cannot reach is the half that
//! only exists inside [`run_agent`] — that a transition actually tears one agent instance down and
//! stands another up, on the same scheduler slot, carrying exactly the modules the edge names and
//! nothing else. That is what these guard, and they guard it the only way it is worth guarding: by
//! running a whole machine with scripted models and asserting on the telemetry a console would see.
//!
//! The task list is the observable throughout, because it is the one piece of state whose *contents*
//! say unambiguously whether a module was carried or rebuilt: a successor holding two tasks it never
//! wrote can only have been handed them.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::client::{
    MOCK_FSM_HANDOFF_NOTE, MOCK_FSM_RETURN, MOCK_FSM_TASK_ONE, MOCK_FSM_TASK_TWO,
    MOCK_FSM_UNDECLARED_STATE, MockClient,
};
use crate::model::ModelClient;
use crate::telemetry::{CollectingSink, Emitter};
use test_cabinet_core::gg::{
    CAPABILITY_FSM, CAPABILITY_TASKS, FSM_PARAM_STATES, GgAgentConfig, GgAgentModule,
    GgAgentTransitionKind, GgCapabilityConfig, GgCapabilitySet, GgContextSource,
    GgModuleDisposition, GgModuleKind, GgModuleOrigin, GgSlotBinding, GgTelemetryEvent,
    GgTelemetryKind, GgTransitionModule, ROOT_PROFILE_ID,
};

use super::tests::{ScriptedFactory, invocation};

/// The three state agents every machine here is built from: each bound to the mock model whose
/// [script](MockClient::with_fsm_explore_script) drives that state, and each carrying the task
/// capability (so a transferred task list has somewhere to land, and a *non*-transferred one is
/// visibly empty rather than merely absent).
///
/// The id and the display name deliberately differ: a state names its agent by
/// [slug](GgAgentConfig::slug), and the telemetry every assertion below reads keys on the same, so a
/// fixture whose two halves matched would hide which of them the run is actually using.
fn state_agent(id: &str, name: &str, script: &str) -> GgAgentConfig {
    GgAgentConfig {
        slug: id.to_string(),
        name: name.to_string(),
        model_id: format!("mock/{script}"),
        capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_TASKS)],
        ..GgAgentConfig::root()
    }
}

/// A capability set whose **root is an FSM shell** driving `states`, over the three state agents.
///
/// The shell binds **no model**, which is the point: a machine takes no turns, so there is nothing
/// for a model on it to do — the run resolves its client through the entry state's profile instead.
/// A set that pinned one here would launch just as well and prove nothing, since the value would
/// never be read.
fn machine_set(states: serde_json::Value) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/shell");
    set.agents[0].model_id = String::new();
    set.agents[0].capabilities = vec![GgCapabilityConfig {
        params: json!({ FSM_PARAM_STATES: states }),
        ..GgCapabilityConfig::enabled(CAPABILITY_FSM)
    }];
    set.agents
        .push(state_agent("explorer", "Explorer", "fsm-explore"));
    set.agents
        .push(state_agent("builder", "Builder", "fsm-build"));
    set.agents
        .push(state_agent("verifier", "Verifier", "fsm-verify"));
    set
}

/// The three-state machine most of these tests run: `explore → build → verify`, carrying `transfer`
/// on the first edge and the window plus the task list on the second.
fn three_state(transfer: serde_json::Value) -> serde_json::Value {
    json!([
        {
            "name": "explore",
            "agentId": "explorer",
            "transitions": [
                { "to": "build", "transfer": transfer, "description": "when the plan is ready" }
            ]
        },
        {
            "name": "build",
            "agentId": "builder",
            "transitions": [{ "to": "verify", "transfer": ["history", "tasks"] }]
        },
        { "name": "verify", "agentId": "verifier" }
    ])
}

/// Run `set` offline against the three FSM scripts, keyed by the profile each state runs.
async fn run_machine(dir: &Path, set: GgCapabilitySet) -> (SessionOutcome, Vec<GgTelemetryEvent>) {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-fsm".to_string()), Box::new(sink.clone()));
    let scripted = |binding: &GgSlotBinding| -> Box<dyn ModelClient> {
        Box::new(match binding.model_id.as_str() {
            "mock/fsm-explore" => MockClient::with_fsm_explore_script(&binding.model_id),
            "mock/fsm-build" => MockClient::with_fsm_build_script(&binding.model_id),
            "mock/fsm-verify" => MockClient::with_fsm_verify_script(&binding.model_id),
            other => MockClient::new(other.to_string(), Vec::new()),
        })
    };
    let factory = ScriptedFactory::new()
        .slot("explorer", scripted)
        .slot("builder", scripted)
        .slot("verifier", scripted);
    let outcome = run_with_factory(&invocation(dir, set), &emitter, Arc::new(factory)).await;
    (outcome, sink.events())
}

/// The task titles each agent's **last** `TaskState` reports, keyed by agent id — what that
/// incarnation was holding when it stopped, which is the whole observable of a transfer.
fn tasks_by_agent(events: &[GgTelemetryEvent]) -> HashMap<String, Vec<String>> {
    let mut held: HashMap<String, Vec<String>> = HashMap::new();
    for event in events {
        if let GgTelemetryKind::TasksState { tasks, .. } = &event.kind {
            held.insert(
                event.agent_id.clone().unwrap_or_default(),
                tasks.iter().map(|task| task.title.clone()).collect(),
            );
        }
    }
    held
}

/// Every `FsmState` event in stream order, as `(agent id, state, agent profile id, from)`.
fn fsm_states(events: &[GgTelemetryEvent]) -> Vec<(String, String, String, Option<String>)> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::FsmState {
                fsm_id,
                state,
                profile_id,
                from,
            } => {
                assert_eq!(
                    fsm_id, ROOT_PROFILE_ID,
                    "every state belongs to the shell's machine, named by its profile id"
                );
                Some((
                    event.agent_id.clone().unwrap_or_default(),
                    state.clone(),
                    profile_id.clone(),
                    from.clone(),
                ))
            }
            _ => None,
        })
        .collect()
}

/// The module kinds a transition's per-module list reports with `disposition`, as the wire spells
/// them — the shape the assertions below were written against before dispositions replaced three
/// flat name lists.
fn kinds_with(modules: &[GgTransitionModule], disposition: GgModuleDisposition) -> Vec<String> {
    modules
        .iter()
        .filter(|entry| entry.disposition == disposition)
        .map(|entry| entry.kind.to_string())
        .collect()
}

/// Every `AgentTransition` event in stream order, as `(emitting agent, successor id, transferred)`.
fn transitions(events: &[GgTelemetryEvent]) -> Vec<(String, String, Vec<String>, Vec<String>)> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::AgentTransition {
                kind,
                to_agent_id,
                modules,
                ..
            } => {
                assert_eq!(*kind, GgAgentTransitionKind::Fsm);
                Some((
                    event.agent_id.clone().unwrap_or_default(),
                    to_agent_id.clone(),
                    kinds_with(modules, GgModuleDisposition::Carried),
                    kinds_with(modules, GgModuleDisposition::Initialized),
                ))
            }
            _ => None,
        })
        .collect()
}

/// A three-state machine runs to its terminal state as **one agent**: three incarnations in
/// succession, each announcing the state it stands in, the first with no predecessor and each later
/// one naming where it came from.
///
/// This is the multi-hop case, and it is also the shape assertion for everything below: one
/// `run_agent`, one scheduler slot, one return value, and a lineage the console can walk.
#[tokio::test]
async fn a_machine_runs_through_every_state_as_one_agent() {
    let dir = TempDir::new().unwrap();
    let (outcome, events) =
        run_machine(dir.path(), machine_set(three_state(json!(["tasks"])))).await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let states = fsm_states(&events);
    assert_eq!(
        states,
        vec![
            (
                ROOT_AGENT_ID.to_string(),
                "explore".to_string(),
                "explorer".to_string(),
                None
            ),
            (
                "agent-0".to_string(),
                "build".to_string(),
                "builder".to_string(),
                Some("explore".to_string())
            ),
            (
                "agent-1".to_string(),
                "verify".to_string(),
                "verifier".to_string(),
                Some("build".to_string())
            ),
        ],
        "each incarnation announces its state, and names the one it came from"
    );

    // Succession is not delegation: every incarnation stands at the same depth, and each parents to
    // the one before it so the lineage is walkable.
    let spawned: Vec<(String, Option<String>, String, u64)> = events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::AgentSpawned {
                profile_id, depth, ..
            } => Some((
                event.agent_id.clone().unwrap_or_default(),
                event.parent_agent_id.clone(),
                profile_id.clone(),
                *depth,
            )),
            _ => None,
        })
        .collect();
    assert_eq!(
        spawned,
        vec![
            (ROOT_AGENT_ID.to_string(), None, "explorer".to_string(), 0),
            (
                "agent-0".to_string(),
                Some(ROOT_AGENT_ID.to_string()),
                "builder".to_string(),
                0
            ),
            (
                "agent-1".to_string(),
                Some("agent-0".to_string()),
                "verifier".to_string(),
                0
            ),
        ],
        "a succession keeps its depth and parents to its predecessor"
    );

    // And the machine's ending is the machine's return value: the terminal state's `finish`.
    let summary = events.iter().rev().find_map(|event| match &event.kind {
        GgTelemetryKind::SessionSummary { summary } => Some(summary.clone()),
        _ => None,
    });
    assert!(summary.is_some(), "the run produced a session summary");
    assert!(
        events.iter().any(|event| matches!(
            &event.kind,
            GgTelemetryKind::AssistantMessage { text } if text == MOCK_FSM_RETURN
        )),
        "the terminal state's ending is what the machine returns"
    );
}

/// A transition that names `tasks` hands the successor the **task list itself**, in the state it was
/// in — not a summary of it, and not a fresh one.
///
/// This is the requirement in one assertion: the builder never called `add_task`, and it is holding
/// both of the explorer's tasks, by title, in order.
#[tokio::test]
async fn a_transferred_task_list_arrives_intact() {
    let dir = TempDir::new().unwrap();
    let (outcome, events) =
        run_machine(dir.path(), machine_set(three_state(json!(["tasks"])))).await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let held = tasks_by_agent(&events);
    assert_eq!(
        held.get(ROOT_AGENT_ID),
        Some(&vec![
            MOCK_FSM_TASK_ONE.to_string(),
            MOCK_FSM_TASK_TWO.to_string()
        ]),
        "the entry state built the list"
    );
    assert_eq!(
        held.get("agent-0"),
        Some(&vec![
            MOCK_FSM_TASK_ONE.to_string(),
            MOCK_FSM_TASK_TWO.to_string()
        ]),
        "and the successor is holding that very list, having written none of it"
    );

    // What the transfer did is on the wire, on the outgoing instance's own stream, so a console can
    // render a handoff as a handoff rather than as an unexplained second agent.
    let moves = transitions(&events);
    assert_eq!(moves.len(), 2, "two transitions: {moves:?}");
    assert_eq!(moves[0].0, ROOT_AGENT_ID, "emitted by the outgoing agent");
    assert_eq!(moves[0].1, "agent-0", "and it names its successor");
    assert_eq!(moves[0].2, vec!["tasks".to_string()], "carrying the tasks");
    assert!(
        moves[0].3.contains(&"history".to_string()),
        "and starting the window fresh, since the edge did not name it: {:?}",
        moves[0].3
    );
}

/// An edge that names **nothing** carries nothing: the successor's task list is empty even though
/// its own profile very much has one.
///
/// This is the deliberate hard reset the design chose over an implicit default, and it is the half
/// of "explicit transfer" that a passing transfer test cannot demonstrate.
#[tokio::test]
async fn a_transition_that_carries_nothing_starts_the_successor_fresh() {
    let dir = TempDir::new().unwrap();
    let (outcome, events) = run_machine(dir.path(), machine_set(three_state(json!([])))).await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let held = tasks_by_agent(&events);
    assert_eq!(
        held.get(ROOT_AGENT_ID),
        Some(&vec![
            MOCK_FSM_TASK_ONE.to_string(),
            MOCK_FSM_TASK_TWO.to_string()
        ]),
        "the entry state still built its list"
    );
    assert_eq!(
        held.get("agent-0"),
        Some(&Vec::<String>::new()),
        "and the successor starts with an empty one"
    );

    let moves = transitions(&events);
    assert!(
        moves[0].2.is_empty(),
        "nothing was transferred: {:?}",
        moves[0].2
    );
    assert!(
        moves[0].3.contains(&"tasks".to_string()),
        "the successor's own task module was initialized fresh: {:?}",
        moves[0].3
    );

    // **And it is still told what the run is for.** A successor handed no window opens exactly as a
    // fresh agent does — its own system prompt, then the run's build prompt — with the handoff note
    // on top. Without that it would hold a system prompt and a note about a state change, and no
    // statement of the task anywhere.
    let opening = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. }
                if event.agent_id.as_deref() == Some("agent-0") =>
            {
                Some(by_source.clone())
            }
            _ => None,
        })
        .expect("the successor reported its window");
    let band = |source: GgContextSource| {
        opening
            .iter()
            .find(|usage| usage.source == source)
            .map(|usage| usage.tokens)
            .unwrap_or(0)
    };
    assert!(
        band(GgContextSource::UserPrompt) > 0,
        "the successor holds a build prompt: {opening:?}"
    );
    assert_eq!(
        band(GgContextSource::Assistant),
        0,
        "and none of its predecessor's conversation, which is what the empty list asked for"
    );
    let briefed = events.iter().any(|event| match &event.kind {
        GgTelemetryKind::ContextMessage { content, .. } => {
            event.agent_id.as_deref() == Some("agent-0")
                && content
                    .as_deref()
                    .is_some_and(|text| text.contains("Build a tiny game."))
        }
        _ => false,
    });
    assert!(briefed, "and it is the run's own prompt");
}

/// A successor that was **not** handed a window is seeded like a fresh agent — and a successor that
/// *was* opens on a note saying what it received, what it did not, and whatever its predecessor
/// wanted it to know.
#[tokio::test]
async fn a_successor_is_told_what_it_inherited() {
    let dir = TempDir::new().unwrap();
    let (outcome, events) = run_machine(
        dir.path(),
        machine_set(three_state(json!(["history", "tasks"]))),
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    // The opening note reaches the successor's window as an ordinary context message.
    let notes: Vec<String> = events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::ContextMessage { content, .. } => content.clone(),
            _ => None,
        })
        .filter(|text| text.contains("This process has moved from `explore` to `build`"))
        .collect();
    assert!(!notes.is_empty(), "the successor opens on a handoff note");
    let note = &notes[0];
    assert!(
        note.contains("the conversation") && note.contains("the task list"),
        "it names what was carried: {note}"
    );
    assert!(
        note.contains(MOCK_FSM_HANDOFF_NOTE),
        "and carries the predecessor's own message: {note}"
    );
}

/// A target the current state does not declare is a **tool refusal**, not a stopped run: the agent
/// stays where it is, is told the states it may actually name, and takes the legal edge on its next
/// turn.
#[tokio::test]
async fn an_undeclared_target_is_refused_and_the_machine_carries_on() {
    let dir = TempDir::new().unwrap();
    let (outcome, events) =
        run_machine(dir.path(), machine_set(three_state(json!(["tasks"])))).await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let refusals: Vec<String> = events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::ToolResult {
                name,
                ok: false,
                summary,
                ..
            } if name == TRANSITION_STATE_TOOL => summary.clone(),
            _ => None,
        })
        .collect();
    assert_eq!(refusals.len(), 1, "exactly one refusal: {refusals:?}");
    assert!(
        refusals[0].contains(MOCK_FSM_UNDECLARED_STATE),
        "the refusal names what was asked for: {}",
        refusals[0]
    );
    assert!(
        refusals[0].contains("`verify`"),
        "and lists what may be named instead: {}",
        refusals[0]
    );

    // The machine still reached its terminal state, on the very next turn.
    assert_eq!(
        fsm_states(&events).len(),
        3,
        "a refused move costs a turn, not the run"
    );
}

/// A machine gg cannot build is a **launch failure**, not a run that quietly behaves like an
/// ordinary agent — the whole reason the built-in machines' `machine` param is a hard break.
#[tokio::test]
async fn a_structurally_broken_machine_fails_to_launch() {
    let dir = TempDir::new().unwrap();
    let mut set = machine_set(three_state(json!(["tasks"])));
    // An edge that leads nowhere.
    set.agents[0].capabilities[0].params = json!({
        FSM_PARAM_STATES: [
            { "name": "explore", "agentId": "explorer", "transitions": [{ "to": "nowhere" }] }
        ]
    });
    let (outcome, events) = run_machine(dir.path(), set).await;
    assert_eq!(
        outcome,
        SessionOutcome::HarnessError,
        "an unrunnable machine does not run"
    );
    assert!(
        events.iter().any(|event| matches!(
            &event.kind,
            GgTelemetryKind::Log { message, .. } if message.contains("nowhere")
        )),
        "and says which edge it could not follow"
    );
}

/// A transition reports the module instance on **both** sides of the boundary, per kind — which is
/// what turns "the successor has a task list" into "the successor has *this* task list, the one its
/// predecessor built".
///
/// The three flat name lists this replaced could not say it: they named kinds, and a kind is not an
/// instance. A carried module reports one id twice; a kind the successor's profile enables but the
/// edge did not carry reports the fresh, empty store it actually starts on.
#[tokio::test]
async fn a_transitions_module_list_names_the_instance_on_both_sides() {
    let dir = TempDir::new().unwrap();
    // The first edge carries nothing at all, so the successor starts fresh on everything its own
    // profile enables; the second carries the window and the list.
    let (outcome, events) = run_machine(dir.path(), machine_set(three_state(json!([])))).await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let lists: Vec<Vec<GgTransitionModule>> = events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::AgentTransition { modules, .. } => Some(modules.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(lists.len(), 2, "two edges, two transitions");

    let row = |modules: &[GgTransitionModule], kind: GgModuleKind| {
        modules
            .iter()
            .find(|entry| entry.kind == kind)
            .cloned()
            .unwrap_or_else(|| panic!("{kind} is reported"))
    };
    for modules in &lists {
        assert_eq!(
            modules.iter().map(|entry| entry.kind).collect::<Vec<_>>(),
            GgModuleKind::ALL.to_vec(),
            "a transition list and a roster line up kind for kind"
        );
    }

    // The first edge carries nothing: both kinds the successor enables start on a *new* instance,
    // and the list names the one it starts on rather than leaving the reader to guess.
    let first_history = row(&lists[0], GgModuleKind::History);
    assert_eq!(first_history.disposition, GgModuleDisposition::Initialized);
    assert_ne!(
        first_history.from_module_id, first_history.to_module_id,
        "a fresh window is a different window, and the two ids say so"
    );
    assert!(first_history.to_module_id.is_some());

    // The second carries both: one instance, reported on both sides of the boundary.
    let second_history = row(&lists[1], GgModuleKind::History);
    assert_eq!(second_history.disposition, GgModuleDisposition::Carried);
    assert_eq!(
        second_history.from_module_id, second_history.to_module_id,
        "a carried window is the same window"
    );
    let second_tasks = row(&lists[1], GgModuleKind::Tasks);
    assert_eq!(second_tasks.disposition, GgModuleDisposition::Carried);
    assert_eq!(second_tasks.from_module_id, second_tasks.to_module_id);

    // And the instance the successor reports holding is the one the transition handed it — the join
    // that makes a lineage walkable rather than merely plausible.
    let successors: Vec<(String, Vec<GgAgentModule>)> = events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::AgentModules { modules } => {
                Some((event.agent_id.clone().unwrap_or_default(), modules.clone()))
            }
            _ => None,
        })
        .collect();
    assert_eq!(successors.len(), 3, "one roster per incarnation");
    let verifier = &successors[2].1;
    assert_eq!(
        Some(
            verifier
                .iter()
                .find(|entry| entry.kind == GgModuleKind::History)
                .unwrap()
                .module_id
                .clone()
        ),
        second_history.to_module_id,
        "the last state holds the very window the transition carried to it"
    );
    assert_eq!(
        verifier
            .iter()
            .find(|entry| entry.kind == GgModuleKind::History)
            .unwrap()
            .origin,
        GgModuleOrigin::Transferred,
        "and knows it was handed it rather than having made it"
    );
}

/// A machine gg cannot build **refuses the launch**, rather than being absorbed into an empty
/// table.
///
/// Unreachable through the production path — [`crate::validate::validate_launch`] parses the very same machines and
/// refuses this set before an orchestrator exists — so it is provoked the only way it can be, by
/// building one directly. What it guards is that the impossible case is *reported*: an empty table
/// is not a smaller version of the right answer, it is a different run. Every shell in the set
/// would come up as an ordinary agent with no states, no transitions and no model of its own,
/// while the record it produces still calls it a machine and a comparison still counts it as the
/// FSM arm.
#[test]
fn a_machine_that_will_not_build_refuses_the_launch() {
    let dir = TempDir::new().expect("a temp workspace");
    let set = machine_set(json!("not a state table"));
    // The production launch check refuses it first — this is the belt behind that brace.
    assert!(
        crate::validate::refusal(&set).is_err(),
        "launch validation is what makes the case below unreachable"
    );

    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("build".to_string()), Box::new(sink));
    let mut warnings = Vec::new();
    let Err(error) = Orchestrator::build(
        &invocation(dir.path(), set),
        &emitter,
        SessionSeams::substituted(Arc::new(ScriptedFactory::new()), crate::tools::real_shell()),
        WorktreesSetup {
            baseline_commit: None,
            root: None,
        },
        &mut warnings,
        &mut crate::validate::LaunchReport::Discarding,
    ) else {
        panic!("a machine that will not build has no orchestrator to return");
    };
    assert!(
        error.contains(ROOT_PROFILE_ID) && error.contains(FSM_PARAM_STATES),
        "the report names the shell and the param that could not be read: {error}"
    );
}
