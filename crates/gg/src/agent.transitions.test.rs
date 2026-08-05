//! **`fork` and `exec` driven end to end** — the two successions the model chooses, from the
//! declaration through the incarnation loop to the copies and the successors it produces.
//!
//! `modules.test.rs` proves the transfer *primitive*: that a set carried under
//! [`Intersection`](crate::modules::TransferPlan::Intersection) keeps what both profiles have and
//! that a [clone](crate::modules::fork_modules) diverges from its original. What only these can
//! reach is the half that lives inside [`run_agent`] — that an `exec` really does replace the
//! running agent on the same scheduler slot with the predecessor's thread intact, and that a `fork`
//! really does produce a child holding state it never wrote.
//!
//! Both are asserted the only way they are worth asserting: by running whole sessions with scripted
//! models and reading the telemetry a console would see.

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::client::{
    MOCK_EXEC_PROMPT, MOCK_EXEC_RETURN, MOCK_EXEC_SUMMARY, MOCK_EXEC_TASK, MOCK_FORK_PROMPT,
    MOCK_FORK_RETURN, MOCK_FORK_TASK, MockClient,
};
use crate::ending::Ending;
use crate::telemetry::{CollectingSink, Emitter};
use test_cabinet_core::gg::{
    ALL_SUBAGENT_SCOPES, CAPABILITY_AGENT_TRANSITIONS, CAPABILITY_MEMORIES, CAPABILITY_SUBAGENTS,
    CAPABILITY_TASKS, GgCapabilityConfig, GgContextSource, GgModuleDisposition, GgPromptRef,
    GgSubagentRef, GgTelemetryEvent, GgTransitionModule, ROOT_AGENT,
};

use super::super::transitions::{HandoffReason, fork_note, launch_warnings, succession_note};
use super::{ScriptedFactory, invocation};

/// The module kinds a transition's per-module list reports with `disposition`, as the wire spells
/// them.
fn kinds_with(modules: &[GgTransitionModule], disposition: GgModuleDisposition) -> Vec<String> {
    modules
        .iter()
        .filter(|entry| entry.disposition == disposition)
        .map(|entry| entry.kind.to_string())
        .collect()
}

/// One row of a [transfer report](TransferReport), for the note tests — which are about the prose a
/// disposition produces, not about the ids beside it.
fn transition_module(kind: ModuleKind, disposition: GgModuleDisposition) -> GgTransitionModule {
    GgTransitionModule {
        kind,
        disposition,
        from_module_id: None,
        to_module_id: None,
    }
}

/// A roster entry admitting `agent` in every scope — the permissive test allowlist, which is also
/// what an `exec` target is validated against.
fn roster(agent: &str) -> GgSubagentRef {
    GgSubagentRef {
        agent: agent.to_string(),
        description: String::new(),
        scopes: ALL_SUBAGENT_SCOPES.to_vec(),
    }
}

/// A [`ToolCall`] named `name` carrying `arguments` — what the loop hands a succession handler.
fn call(name: &str, arguments: serde_json::Value) -> ToolCall {
    ToolCall {
        id: "call-1".to_string(),
        name: name.to_string(),
        arguments,
    }
}

// ---------------------------------------------------------------------------
// Judging an `exec` declaration
// ---------------------------------------------------------------------------

/// A target outside the agent's roster is refused with the names it *may* become, and nothing is
/// captured — the agent stays exactly where it is and the session continues.
///
/// The alternative shapes are both worse: failing the run turns a model's mistake into an operator's
/// problem, and accepting it silently would let a configuration's allowlist mean nothing.
#[test]
fn an_exec_naming_an_agent_outside_the_roster_is_refused_with_the_alternatives() {
    let agent = Agent::root("Before");
    let mut declared = None;
    let outcome = handle_exec(
        &[roster("After")],
        &agent,
        &None,
        &mut declared,
        &call(EXEC_TOOL, json!({ "agent": "Elsewhere" })),
    );

    assert!(!outcome.ok, "an unlisted target is refused");
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        outcome.output.contains("`After`"),
        "the refusal names what it may become: {}",
        outcome.output
    );
    assert!(declared.is_none(), "nothing was captured");
}

/// An `exec` with no `agent` at all is the same refusal, because it is the same missing fact.
#[test]
fn an_exec_with_no_target_is_refused_with_the_alternatives() {
    let agent = Agent::root("Before");
    let mut declared = None;
    let outcome = handle_exec(
        &[roster("After")],
        &agent,
        &None,
        &mut declared,
        &call(EXEC_TOOL, json!({})),
    );

    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(outcome.output.contains("`After`"));
}

/// **First wins.** A turn makes one succession, and a second declaration is refused rather than
/// replacing the first — an invisibly replaced successor identity is a change the model cannot see,
/// which is exactly why a compaction may be replaced and this may not.
#[test]
fn a_second_succession_in_one_turn_is_refused_and_the_first_stands() {
    let agent = Agent::root("Before");
    let roster = vec![roster("After"), roster("Other")];
    let mut declared = None;

    let first = handle_exec(
        &roster,
        &agent,
        &None,
        &mut declared,
        &call(EXEC_TOOL, json!({ "agent": "After" })),
    );
    assert!(first.ok);

    let second = handle_exec(
        &roster,
        &agent,
        &None,
        &mut declared,
        &call(EXEC_TOOL, json!({ "agent": "Other" })),
    );
    assert!(!second.ok);
    assert_eq!(second.failure, Some(ToolFailure::Refused));
    assert!(
        second.output.contains("`After`"),
        "the refusal names the succession that stands: {}",
        second.output
    );
    assert_eq!(
        declared.map(|handoff| handoff.profile),
        Some("After".to_string()),
        "the first declaration is what runs"
    );
}

/// An ending beats a succession declared in the same turn: the agent said its work was done, so
/// there is nothing left to hand on.
#[test]
fn an_ending_declared_this_turn_beats_a_later_exec() {
    let agent = Agent::root("Before");
    let ending =
        Some(Ending::finished("all done".to_string(), crate::completion::FINISH_TOOL).unwrap());
    let mut declared = None;

    let outcome = handle_exec(
        &[roster("After")],
        &agent,
        &ending,
        &mut declared,
        &call(EXEC_TOOL, json!({ "agent": "After" })),
    );

    assert_eq!(outcome.failure, Some(ToolFailure::Refused));
    assert!(
        outcome.output.contains("already ended this turn"),
        "the refusal says which one won: {}",
        outcome.output
    );
    assert!(declared.is_none());
}

/// An agent standing in a machine state cannot `exec` out of it: inside a process the next move is
/// the process's decision, and the refusal points at the call that makes it.
///
/// The registry withholds the tool from such an agent in the first place, so this is the belt to
/// that braces — and it is what holds the line on the responses-as-code path, where a program
/// written against a scope the agent does not have could otherwise reach it.
#[test]
fn exec_is_refused_for_an_agent_standing_in_a_machine() {
    let machine = Arc::new(
        crate::fsm::FsmSpec::resolve(&GgAgentConfig {
            name: "Process".to_string(),
            capabilities: vec![GgCapabilityConfig {
                params: json!({ "states": [{ "name": "explore", "agent": "Before" }] }),
                ..GgCapabilityConfig::enabled(test_cabinet_core::gg::CAPABILITY_FSM)
            }],
            ..GgAgentConfig::root()
        })
        .expect("the profile declares a machine")
        .expect("the machine parses"),
    );
    let agent = Agent {
        fsm: Some(machine.entry_position()),
        ..Agent::root("Before")
    };
    let mut declared = None;

    let outcome = handle_exec(
        &[roster("After")],
        &agent,
        &None,
        &mut declared,
        &call(EXEC_TOOL, json!({ "agent": "After" })),
    );

    assert_eq!(outcome.failure, Some(ToolFailure::Unavailable));
    assert!(
        outcome.output.contains(TRANSITION_STATE_TOOL),
        "the refusal names the move it does have: {}",
        outcome.output
    );
    assert!(declared.is_none());
}

// ---------------------------------------------------------------------------
// The notes an arriving instance opens on
// ---------------------------------------------------------------------------

/// An exec'd successor's note says who handed the session over, what arrived, what did not, and
/// whatever the predecessor wanted it to know — so nothing about its inheritance has to be inferred
/// from an absence.
#[test]
fn an_exec_note_states_the_inheritance_and_carries_the_predecessors_message() {
    let handoff = Handoff {
        profile: "After".to_string(),
        plan: TransferPlan::Intersection,
        message: Some("the loader is the problem".to_string()),
        reason: HandoffReason::Exec {
            from: "Before".to_string(),
        },
        fsm: None,
    };
    let report = TransferReport {
        modules: vec![
            transition_module(ModuleKind::History, GgModuleDisposition::Carried),
            transition_module(ModuleKind::Tasks, GgModuleDisposition::Dropped),
        ],
        notes: Vec::new(),
        warnings: Vec::new(),
    };

    let note = succession_note(&handoff, &report, "After", None);

    assert!(note.contains("`Before`"), "{note}");
    assert!(note.contains("`After`"), "{note}");
    assert!(note.contains("the conversation"), "{note}");
    assert!(note.contains("the task list did not"), "{note}");
    assert!(note.ends_with("the loader is the problem"), "{note}");
}

/// A copy's note names the agent and the turn it came from, says the original is still running, and
/// carries its instructions — the three things a model cannot work out from the window itself.
#[test]
fn a_fork_note_names_its_origin_and_carries_its_instructions() {
    let forker = Agent {
        id: "agent-3".to_string(),
        ..Agent::root("Builder")
    };

    let note = fork_note(&forker, "try the other fix", 24);

    assert!(note.contains("`agent-3`"), "{note}");
    assert!(note.contains("`Builder`"), "{note}");
    assert!(note.contains("turn 24"), "{note}");
    assert!(note.contains("in parallel"), "{note}");
    assert!(note.ends_with("try the other fix"), "{note}");
}

// ---------------------------------------------------------------------------
// Launch diagnostics
// ---------------------------------------------------------------------------

/// A profile that carries `agent-transitions` and nothing to use it with earns a warning per
/// missing half, because an absent tool is the one misconfiguration a model can never report — it
/// simply never makes the call.
#[test]
fn launch_warns_when_neither_half_of_the_capability_can_be_offered() {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_AGENT_TRANSITIONS));

    let warnings = launch_warnings(&set);

    assert_eq!(warnings.len(), 2, "one per withheld call: {warnings:?}");
    assert!(
        warnings.iter().any(|w| w.contains(EXEC_TOOL)),
        "an empty roster leaves nothing to become: {warnings:?}"
    );
    assert!(
        warnings.iter().any(|w| w.contains(FORK_TOOL)),
        "no delegation runtime leaves the copy uncollectable: {warnings:?}"
    );
}

/// Both halves available means silence: the capability got exactly what it asked for.
#[test]
fn launch_is_quiet_when_both_calls_can_be_offered() {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.agents[0].subagents = vec![roster(ROOT_AGENT)];
    set.agents[0].capabilities.extend([
        GgCapabilityConfig::enabled(CAPABILITY_AGENT_TRANSITIONS),
        GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS),
    ]);

    assert!(launch_warnings(&set).is_empty());
}

// ---------------------------------------------------------------------------
// `exec`, end to end
// ---------------------------------------------------------------------------

/// The two profiles of the `exec` e2e: a predecessor that keeps a task list and may become the
/// successor, and a successor that keeps **memories instead** — so one capability is dropped at the
/// boundary and another is initialized fresh, and the difference is visible in the telemetry.
fn exec_set() -> GgCapabilitySet {
    let mut before = GgAgentConfig {
        name: ROOT_AGENT.to_string(),
        model_id: "mock/exec-before".to_string(),
        subagents: vec![roster("After")],
        ..GgAgentConfig::root()
    };
    before.capabilities = vec![
        GgCapabilityConfig::enabled(CAPABILITY_AGENT_TRANSITIONS),
        GgCapabilityConfig::enabled(CAPABILITY_TASKS),
    ];
    let after = GgAgentConfig {
        name: "After".to_string(),
        model_id: "mock/exec-after".to_string(),
        capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)],
        ..GgAgentConfig::root()
    };
    GgCapabilitySet {
        agents: vec![before, after],
        ..GgCapabilitySet::default()
    }
}

/// Run `set` offline against the `exec` scripts, with `windows` deciding what each model's context
/// window is (the compaction test narrows the successor's).
async fn run_exec(
    dir: &Path,
    set: GgCapabilitySet,
    windows: Option<BTreeMap<String, u64>>,
) -> Vec<GgTelemetryEvent> {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-exec".to_string()), Box::new(sink.clone()));
    let scripted = |binding: &GgSlotBinding| -> Box<dyn ModelClient> {
        Box::new(match binding.model_id.as_str() {
            "mock/exec-before" => MockClient::with_exec_before_script(&binding.model_id),
            "mock/exec-compacting" => MockClient::with_compacting_exec_script(&binding.model_id),
            "mock/exec-after" => MockClient::with_exec_after_script(&binding.model_id),
            other => MockClient::new(other.to_string(), Vec::new()),
        })
    };
    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, scripted)
        .slot("After", scripted);
    let launched = invocation(dir, set);
    let invocation = match windows {
        Some(model_windows) => GgInvocation {
            model_windows,
            ..launched
        },
        None => launched,
    };
    let outcome = run_with_factory(&invocation, &emitter, Arc::new(factory)).await;
    assert_eq!(outcome, SessionOutcome::Ran);
    sink.events()
}

/// An `exec` **replaces** the running agent: the successor is a second incarnation of the same
/// agent (same depth, parented to its predecessor), it carries the conversation, it does not carry
/// the capability its own profile turns off, and it starts the one only it has.
///
/// This is the whole of the drop/transfer/initialize rule in one run, and it is asserted on the
/// three things a console reduces: the transition event, what the successor's window contains, and
/// which module panels it opens with.
#[tokio::test]
async fn an_exec_carries_the_conversation_drops_what_the_successor_lacks_and_starts_what_it_gains()
{
    let dir = TempDir::new().unwrap();
    let events = run_exec(dir.path(), exec_set(), None).await;

    // The transition itself, on the outgoing instance's stream.
    let transition = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::AgentTransition {
                kind,
                to_agent_id,
                agent,
                modules,
                ..
            } => Some((
                *kind,
                event.agent_id.clone().unwrap_or_default(),
                to_agent_id.clone(),
                agent.clone(),
                kinds_with(modules, GgModuleDisposition::Carried),
                kinds_with(modules, GgModuleDisposition::Dropped),
                kinds_with(modules, GgModuleDisposition::Initialized),
            )),
            _ => None,
        })
        .expect("the exec was reported as a transition");
    assert_eq!(transition.0, GgAgentTransitionKind::Exec);
    assert_eq!(
        transition.1, ROOT_AGENT_ID,
        "reported by the outgoing agent"
    );
    assert_eq!(transition.3, "After", "the profile it became");
    assert_eq!(
        transition.4,
        vec!["history".to_string()],
        "the conversation is what both profiles have"
    );
    assert_eq!(
        transition.5,
        vec!["tasks".to_string()],
        "the successor's profile has no task list, so the list is dropped"
    );
    assert_eq!(
        transition.6,
        vec!["memories".to_string()],
        "the successor's memories are its own, and start empty"
    );

    // Succession is not delegation: same depth, parented to the predecessor.
    let successor = transition.2.clone();
    let spawned = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::AgentSpawned { slot, depth, .. }
                if event.agent_id.as_deref() == Some(successor.as_str()) =>
            {
                Some((event.parent_agent_id.clone(), slot.clone(), *depth))
            }
            _ => None,
        })
        .expect("the successor was announced");
    assert_eq!(
        spawned,
        (Some(ROOT_AGENT_ID.to_string()), "After".to_string(), 0),
        "a succession keeps its depth and parents to its predecessor"
    );

    // The conversation really crossed: the successor's first window already holds its
    // predecessor's assistant turns and tool output, which a fresh agent's never does.
    let carried = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. }
                if event.agent_id.as_deref() == Some(successor.as_str()) =>
            {
                Some(by_source.clone())
            }
            _ => None,
        })
        .expect("the successor reported its window");
    let band = |source: GgContextSource| {
        carried
            .iter()
            .find(|usage| usage.source == source)
            .map(|usage| usage.tokens)
            .unwrap_or(0)
    };
    assert!(
        band(GgContextSource::Assistant) > 0,
        "the predecessor's assistant turns crossed: {carried:?}"
    );
    assert!(
        band(GgContextSource::ToolOutput) > 0,
        "the predecessor's tool results crossed: {carried:?}"
    );

    // The dropped module leaves nothing behind on the successor, and the fresh one opens empty.
    let successor_tasks = events.iter().any(|event| {
        event.agent_id.as_deref() == Some(successor.as_str())
            && matches!(&event.kind, GgTelemetryKind::TasksState { .. })
    });
    assert!(
        !successor_tasks,
        "an agent whose profile has no task list reports none"
    );
    let successor_memories = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::MemoryState { memories, .. }
                if event.agent_id.as_deref() == Some(successor.as_str()) =>
            {
                Some(memories.len())
            }
            _ => None,
        })
        .expect("the successor's memories reported themselves");
    assert_eq!(successor_memories, 0, "a module it gained starts empty");

    // The predecessor's own task list is on *its* stream, and its opening note reached the
    // successor's window.
    let predecessor_tasks = events.iter().any(|event| matches!(
        &event.kind,
        GgTelemetryKind::TasksState { tasks, .. } if tasks.iter().any(|task| task.title == MOCK_EXEC_TASK)
    ));
    assert!(predecessor_tasks, "the predecessor did build a task list");
    assert!(
        events.iter().any(|event| matches!(
            &event.kind,
            GgTelemetryKind::ContextMessage { content: Some(text), .. }
                if text.contains(MOCK_EXEC_PROMPT)
        )),
        "the predecessor's message reached the successor"
    );

    // And the session's last word is the successor's, not the agent's that started it.
    assert!(
        events.iter().any(|event| matches!(
            &event.kind,
            GgTelemetryKind::AssistantMessage { text } if text == MOCK_EXEC_RETURN
        )),
        "the successor's ending is the session's"
    );
}

/// **An exec'd agent reasons under its own system prompt, and only its own.**
///
/// The system prompt is the one thing a succession must *not* carry: it states the toolset, the
/// roster, the ending calls and the capability prose of the profile it was rendered for, and the
/// whole point of an `exec` is that the successor is a different profile. The thread crosses; the
/// instructions describing the agent do not.
///
/// It is asserted from the message log because that is the request as it actually went out. The two
/// profiles here differ in exactly the way that shows up in the prompt — the predecessor keeps a
/// task list and may `exec`, the successor keeps memories and may not — so "the successor's prompt
/// is its own" is checkable rather than merely plausible, and neither agent's stream may carry a
/// second `system` message beside it (a provider that concatenates them would hand the model one
/// instruction block naming two toolsets).
#[tokio::test]
async fn an_exec_gives_the_successor_its_own_system_prompt_and_no_trace_of_its_predecessors() {
    let dir = TempDir::new().unwrap();
    let events = run_exec(dir.path(), exec_set(), None).await;

    let successor = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::AgentTransition { to_agent_id, .. } => Some(to_agent_id.clone()),
            _ => None,
        })
        .expect("the exec was reported as a transition");

    // The message pool is per agent, so an agent's stream carries the full body of every message it
    // sent — including one it inherited, which is exactly what must not be here.
    let system_prompts = |agent: &str| -> Vec<String> {
        events
            .iter()
            .filter(|event| event.agent_id.as_deref() == Some(agent))
            .filter_map(|event| match &event.kind {
                GgTelemetryKind::ContextMessage { role, content, .. } if role == "system" => {
                    Some(content.clone().unwrap_or_default())
                }
                _ => None,
            })
            .collect()
    };

    let predecessor_prompts = system_prompts(ROOT_AGENT_ID);
    let successor_prompts = system_prompts(&successor);
    assert_eq!(
        predecessor_prompts.len(),
        1,
        "the predecessor sent exactly one system message: {predecessor_prompts:?}"
    );
    assert_eq!(
        successor_prompts.len(),
        1,
        "and so did the successor — two would have it instructed by its predecessor's toolset, \
         roster and ending calls as well as its own: {successor_prompts:?}"
    );
    let predecessor_prompt = &predecessor_prompts[0];
    let successor_prompt = &successor_prompts[0];
    assert_ne!(
        successor_prompt, predecessor_prompt,
        "the successor is a different profile and reads a different prompt"
    );

    // The difference is the profiles', not an accident of rendering: each prompt carries the
    // capability section of the agent it was rendered for, and not the other's.
    assert!(
        predecessor_prompt.contains("## Tasks") && !predecessor_prompt.contains("## Memory"),
        "the predecessor keeps a task list and no memories: {predecessor_prompt}"
    );
    assert!(
        successor_prompt.contains("## Memory") && !successor_prompt.contains("## Tasks"),
        "and the successor is told about its memories, and about no task list it does not have: \
         {successor_prompt}"
    );

    // And it renders **first**, ahead of the thread it inherited, on every request it made.
    let requests: Vec<Vec<GgPromptRef>> = events
        .iter()
        .filter(|event| event.agent_id.as_deref() == Some(successor.as_str()))
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::Prompt { request, .. } => Some(request.clone()),
            _ => None,
        })
        .collect();
    assert!(!requests.is_empty(), "the successor did take a turn");
    let system_id = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::ContextMessage { id, role, .. }
                if event.agent_id.as_deref() == Some(successor.as_str()) && role == "system" =>
            {
                Some(id.clone())
            }
            _ => None,
        })
        .expect("the successor's prompt was pooled");
    for request in &requests {
        assert_eq!(
            request.first().map(|item| item.id.as_str()),
            Some(system_id.as_str()),
            "the system prompt is message 0 of every request: {request:?}"
        );
        assert_eq!(
            request.iter().filter(|item| item.id == system_id).count(),
            1,
            "and it appears once: {request:?}"
        );
    }
}

/// A successor on a **much smaller window** compacts before its first turn.
///
/// This is the case `exec` exists to survive: an agent that has filled a large window becoming one
/// that cannot hold it. gg deliberately does nothing clever about the mismatch beyond firing the
/// successor's *own* compaction at its first turn boundary — if the two windows differ greatly, the
/// operator is expected to configure a strategy that condenses on a separate model.
#[tokio::test]
async fn an_exec_onto_a_smaller_window_compacts_before_the_successors_first_turn() {
    let dir = TempDir::new().unwrap();
    let mut set = exec_set();
    // The successor condenses out of band on its own model, which the mock answers off-script.
    set.agents[1].capabilities.push(GgCapabilityConfig::enabled(
        test_cabinet_core::gg::CAPABILITY_COMPACTION,
    ));
    // A window the predecessor's thread cannot possibly fit in.
    let windows = BTreeMap::from([
        ("mock/exec-before".to_string(), 200_000),
        ("mock/exec-after".to_string(), 200),
    ]);
    let events = run_exec(dir.path(), set, Some(windows)).await;

    let compacted = events.iter().any(|event| {
        matches!(&event.kind, GgTelemetryKind::Compaction { .. })
            && event.agent_id.as_deref() != Some(ROOT_AGENT_ID)
    });
    assert!(
        compacted,
        "the successor compacted the window it inherited before taking a turn"
    );
}

/// **A turn that compacts and hands off does both, in that order.**
///
/// Both calls are deferred to the end of the turn, so the loop chooses which is applied first, and
/// only one order is defensible: the successor inherits this window, and it must inherit the one
/// the turn actually produced. Applying the handoff first returned from the loop before the
/// compaction was reached, so the summary the model paid to write was dropped and the successor
/// opened on the full window its predecessor believed it had just condensed — while the tool result
/// it had already been given promised the opposite. The code path has always applied the two this
/// way round; this is the tool-calling path agreeing with it.
#[tokio::test]
async fn a_turn_that_compacts_and_execs_hands_over_the_compacted_window() {
    let dir = TempDir::new().unwrap();
    let mut set = exec_set();
    set.agents[0].model_id = "mock/exec-compacting".to_string();
    set.agents[0].capabilities.push(GgCapabilityConfig {
        implementation: Some(
            test_cabinet_core::gg::COMPACTION_STRATEGY_SELF_COMPACTION.to_string(),
        ),
        ..GgCapabilityConfig::enabled(test_cabinet_core::gg::CAPABILITY_COMPACTION)
    });
    let events = run_exec(dir.path(), set, None).await;

    let compacted = events.iter().any(|event| {
        event.agent_id.as_deref() == Some(ROOT_AGENT_ID)
            && matches!(&event.kind, GgTelemetryKind::Compaction { .. })
    });
    assert!(
        compacted,
        "the compaction the turn declared was applied before the incarnation ended"
    );

    // And the successor opened on the summary rather than on the thread it replaced.
    let successor = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::AgentTransition { to_agent_id, .. } => Some(to_agent_id.clone()),
            _ => None,
        })
        .expect("the exec produced a successor");
    let inherited_summary = events.iter().any(|event| match &event.kind {
        GgTelemetryKind::ContextMessage { content, .. } => {
            event.agent_id.as_deref() == Some(successor.as_str())
                && content
                    .as_deref()
                    .is_some_and(|text| text.contains(MOCK_EXEC_SUMMARY))
        }
        _ => false,
    });
    assert!(
        inherited_summary,
        "the successor's window is the compacted one"
    );
}

// ---------------------------------------------------------------------------
// `fork`, end to end
// ---------------------------------------------------------------------------

/// A forking profile: it may fork (the capability), it can collect what it forks (delegation), and
/// it keeps a task list so the copy has something visible to have inherited.
///
/// `maxDepth: 1` is load-bearing rather than incidental: a copy runs its forker's own profile and
/// therefore replays its script, so the cap is what stops the copy forking a copy — and what makes
/// the depth refusal part of what this run covers.
fn fork_set() -> GgCapabilitySet {
    let mut subagents = GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS);
    subagents.params = json!({ "maxParallel": 4, "maxDepth": 1 });
    let mut root = GgAgentConfig {
        name: ROOT_AGENT.to_string(),
        model_id: "mock/fork".to_string(),
        subagents: vec![roster(ROOT_AGENT)],
        ..GgAgentConfig::root()
    };
    root.capabilities = vec![
        GgCapabilityConfig::enabled(CAPABILITY_AGENT_TRANSITIONS),
        GgCapabilityConfig::enabled(CAPABILITY_TASKS),
        subagents,
    ];
    GgCapabilitySet {
        agents: vec![root],
        ..GgCapabilitySet::default()
    }
}

/// A `fork` produces a **child** holding everything its forker held: the copy is one level deeper
/// with its own id and slot, it is reported as a fork rather than as an unexplained second agent,
/// and its very first task-list snapshot already carries a task it never wrote.
///
/// That last assertion is the whole point of the feature. A subagent starts from a brief; a copy
/// starts from its forker's state, and the only way to tell the two apart from outside is that the
/// copy holds something it did not create.
#[tokio::test]
async fn a_fork_opens_holding_the_state_its_forker_built() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-fork".to_string()), Box::new(sink.clone()));
    let factory = ScriptedFactory::new().slot(ROOT_AGENT, |binding: &GgSlotBinding| {
        Box::new(MockClient::with_fork_script(&binding.model_id)) as Box<dyn ModelClient>
    });
    let outcome = run_with_factory(
        &invocation(dir.path(), fork_set()),
        &emitter,
        Arc::new(factory),
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);
    let events = sink.events();

    // Reported as a fork, on the forker's stream, carrying every module it cloned.
    let (emitted_by, copy, transferred) = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::AgentTransition {
                kind: GgAgentTransitionKind::Fork,
                to_agent_id,
                modules,
                ..
            } => {
                assert!(
                    kinds_with(modules, GgModuleDisposition::Dropped).is_empty(),
                    "a copy is a copy: nothing is dropped"
                );
                assert!(
                    kinds_with(modules, GgModuleDisposition::Initialized).is_empty(),
                    "and nothing starts empty"
                );
                // A copy holds its own window and its own list, and the run's one board.
                let carried = [
                    kinds_with(modules, GgModuleDisposition::Copied),
                    kinds_with(modules, GgModuleDisposition::Linked),
                ]
                .concat();
                Some((
                    event.agent_id.clone().unwrap_or_default(),
                    to_agent_id.clone(),
                    carried,
                ))
            }
            _ => None,
        })
        .expect("the fork was reported as a transition");
    assert_eq!(emitted_by, ROOT_AGENT_ID);
    assert!(
        transferred.contains(&"history".to_string()) && transferred.contains(&"tasks".to_string()),
        "a copy carries the window above all: {transferred:?}"
    );

    // A copy is a child: one level deeper, on its forker's own profile, briefed with the
    // instructions the fork call gave it.
    let spawned = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::AgentSpawned {
                slot, depth, brief, ..
            } if event.agent_id.as_deref() == Some(copy.as_str()) => Some((
                event.parent_agent_id.clone(),
                slot.clone(),
                *depth,
                brief.clone(),
            )),
            _ => None,
        })
        .expect("the copy was announced");
    assert_eq!(
        spawned,
        (
            Some(ROOT_AGENT_ID.to_string()),
            ROOT_AGENT.to_string(),
            1,
            Some(MOCK_FORK_PROMPT.to_string())
        ),
        "a copy is a child running its forker's profile"
    );

    // The state it never wrote. Its *first* task snapshot is emitted before it takes a turn, so a
    // list holding the forker's task can only have arrived with the clone.
    let first_tasks = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::TasksState { tasks, .. }
                if event.agent_id.as_deref() == Some(copy.as_str()) =>
            {
                Some(
                    tasks
                        .iter()
                        .map(|task| task.title.clone())
                        .collect::<Vec<_>>(),
                )
            }
            _ => None,
        })
        .expect("the copy's task list reported itself");
    assert_eq!(
        first_tasks,
        vec![MOCK_FORK_TASK.to_string()],
        "the copy opened holding its forker's task list"
    );

    // Its opening message tells it what it is and what it is for.
    assert!(
        events.iter().any(|event| matches!(
            &event.kind,
            GgTelemetryKind::ContextMessage { content: Some(text), .. }
                if text.contains("You were forked from") && text.contains(MOCK_FORK_PROMPT)
        )),
        "the copy is told it was forked, and what for"
    );

    // The forker itself carried on and finished — a fork does not end the agent that made it.
    assert!(
        events.iter().any(|event| matches!(
            &event.kind,
            GgTelemetryKind::AssistantMessage { text } if text == MOCK_FORK_RETURN
        )),
        "the forker kept running after forking"
    );

    // And the copy could not fork again: `maxDepth` is a ceiling on the whole tree, copies
    // included.
    assert!(
        events.iter().any(|event| matches!(
            &event.kind,
            GgTelemetryKind::ToolResult { name, ok, .. }
                if name == FORK_TOOL && !*ok && event.agent_id.as_deref() == Some(copy.as_str())
        )),
        "the copy's own fork was refused at the depth cap"
    );
}
