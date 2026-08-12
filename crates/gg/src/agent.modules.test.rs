//! **Module identity through the live loop** — what an agent instance reports about what it
//! *holds*, driven offline through the real binary.
//!
//! `modules.test.rs` proves the primitive: that a share keeps a store's id and a fork mints a new
//! one. What only these can reach is the half that lives inside [`run_agent`] — that every
//! incarnation actually emits its [roster](GgTelemetryKind::AgentModules), that it emits it *before*
//! it has touched anything (which is the only way a read-only inherited holder appears in the
//! record at all), and that two agents sharing one store are legible as two holders of it rather
//! than as two agents whose panels happen to agree.
//!
//! That last one is the whole reason module identity exists, so it is asserted the only way it is
//! worth asserting: by running a whole session with scripted models and reading the telemetry a
//! console would see.

use std::path::Path;
use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::client::MockClient;
use crate::telemetry::{CollectingSink, Emitter};
use test_cabinet_core::gg::{
    ALL_SUBAGENT_SCOPES, CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_MEMORIES,
    CAPABILITY_SUBAGENTS, GgAgentModule, GgCapabilityConfig, GgMemoryScope, GgModuleKind,
    GgModuleOrigin, GgModuleOwnership, GgSubagentRef, GgTelemetryEvent, MEMORY_PARAM_SCOPE,
    ROOT_AGENT,
};

use super::{ScriptedFactory, invocation};

/// A two-profile run whose subagent binds its memories under `child_scope`: the root writes a
/// memory and spawns the child, and the child reads whatever it was given.
///
/// The scope is the only variable — everything else is the smallest configuration that produces two
/// agents with memories between them.
fn inherited_memories_set(child_scope: GgMemoryScope) -> GgCapabilitySet {
    let mut subagents = GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS);
    subagents.params = json!({ "maxParallel": 2, "maxDepth": 3 });
    let roster = vec![GgSubagentRef {
        agent: "reader".to_string(),
        description: String::new(),
        scopes: ALL_SUBAGENT_SCOPES.to_vec(),
    }];
    let profile = |name: &str, model: &str, scope: Option<GgMemoryScope>| {
        let mut memories = GgCapabilityConfig::enabled(CAPABILITY_MEMORIES);
        if let Some(scope) = scope {
            memories.params = json!({ MEMORY_PARAM_SCOPE: scope.as_str() });
        }
        GgAgentConfig {
            name: name.to_string(),
            model_id: model.to_string(),
            subagents: roster.clone(),
            // Exactly two capabilities: delegation, so there is a second agent, and memories, whose
            // scope is what these tests vary. The default Phase-1 set is dropped so the roster's
            // off arms are genuinely off and a disabled row is assertable.
            capabilities: vec![subagents.clone(), memories],
            ..GgAgentConfig::root()
        }
    };
    GgCapabilitySet {
        agents: vec![
            profile(ROOT_AGENT, "mock/primary", None),
            profile("reader", "mock/reader", Some(child_scope)),
        ],
        ..GgCapabilitySet::default()
    }
}

/// Every `AgentModules` roster in the stream, as `(emitting agent, rows)`.
fn rosters(events: &[GgTelemetryEvent]) -> Vec<(String, Vec<GgAgentModule>)> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::AgentModules { modules } => {
                Some((event.agent_id.clone().unwrap_or_default(), modules.clone()))
            }
            _ => None,
        })
        .collect()
}

/// One roster's row for `kind`.
fn row(roster: &[GgAgentModule], kind: GgModuleKind) -> &GgAgentModule {
    roster
        .iter()
        .find(|entry| entry.kind == kind)
        .unwrap_or_else(|| panic!("every roster reports {kind}"))
}

/// Run a session whose root writes a memory and spawns a `reader`, returning the stream.
async fn run_inheritance(dir: &Path, scope: GgMemoryScope) -> Vec<GgTelemetryEvent> {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-modules".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir, inherited_memories_set(scope));

    // The root writes one memory, then hands the work to a child — which is what gives the child
    // something to have inherited.
    let root = || -> Box<dyn ModelClient> {
        let write = ModelResponse {
            text: Some("Recording what I learned.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_mem".to_string(),
                name: "write_memory".to_string(),
                arguments: json!({
                    "name": "the-plan",
                    "description": "what we are building",
                    "body": "a canvas game",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            loop_aborts: 0,
        };
        let spawn = ModelResponse {
            text: Some("Handing the reading to a child.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_spawn".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({ "prompt": "read what I wrote", "agent": "reader" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            loop_aborts: 0,
        };
        let wait = ModelResponse {
            text: Some("Waiting.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_wait".to_string(),
                name: "wait_for_subagents".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts::default(),
            cost: None,
            loop_aborts: 0,
        };
        Box::new(MockClient::new(
            "mock/primary",
            vec![write, spawn, wait, stop_response()],
        ))
    };
    // The child does nothing at all with its memories — which is the point: a holder that never
    // mutates emits no `MemoryState` of its own, so its roster is the only thing that says it is a
    // holder.
    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, move |_| root())
        .slot("reader", |b| {
            Box::new(MockClient::new(&b.model_id, vec![stop_response()]))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );
    sink.events()
}

/// The load-bearing assertion of the whole feature: a subagent that binds its spawner's notebook
/// reports **the same module id** its spawner does, and reports it without ever touching the store.
///
/// Before rosters, such a holder was invisible: `announce_configuration` is the root's alone and a
/// state snapshot is only emitted by an agent that mutates something, so a read-only reader that
/// read and returned left nothing in the record saying whose memories it had been reading.
#[tokio::test]
async fn a_read_only_inherited_holder_reports_its_spawners_module_id() {
    let dir = TempDir::new().unwrap();
    let events = run_inheritance(dir.path(), GgMemoryScope::ReadOnly).await;

    let rosters = rosters(&events);
    let root = rosters
        .iter()
        .find(|(agent, _)| agent == ROOT_AGENT_ID)
        .map(|(_, roster)| roster.clone())
        .expect("the root reports its roster");
    let (child_id, child) = rosters
        .iter()
        .find(|(agent, _)| agent != ROOT_AGENT_ID)
        .cloned()
        .expect("the subagent reports its roster");

    let root_memories = row(&root, GgModuleKind::Memories);
    let child_memories = row(&child, GgModuleKind::Memories);
    assert_eq!(
        child_memories.module_id, root_memories.module_id,
        "{child_id} binds the very store the root created, and says so"
    );
    assert!(!child_memories.module_id.is_empty());
    assert_eq!(child_memories.origin, GgModuleOrigin::Inherited);
    assert_eq!(child_memories.scope, Some(GgMemoryScope::ReadOnly));
    assert!(
        !child_memories.writable,
        "a read-only handle is the one holder that may not write"
    );
    assert_eq!(
        root_memories.origin,
        GgModuleOrigin::Created,
        "the root made the notebook; the child was handed it"
    );
    assert!(root_memories.writable);

    // And the child really never wrote: nothing in its own stream carries a memory snapshot, which
    // is exactly why the roster had to exist.
    assert!(
        !events
            .iter()
            .any(|event| event.agent_id.as_deref() == Some(child_id.as_str())
                && matches!(&event.kind, GgTelemetryKind::MemoryRevision { .. })),
        "the reader mutated nothing"
    );
}

/// An `isolated` child is the control for the case above: two agents, two notebooks, two ids —
/// which is what makes the shared case a finding rather than an artefact of both panels being empty.
#[tokio::test]
async fn an_isolated_subagent_reports_a_module_id_of_its_own() {
    let dir = TempDir::new().unwrap();
    let events = run_inheritance(dir.path(), GgMemoryScope::Isolated).await;

    let rosters = rosters(&events);
    let root = rosters
        .iter()
        .find(|(agent, _)| agent == ROOT_AGENT_ID)
        .map(|(_, roster)| roster.clone())
        .expect("the root reports its roster");
    let child = rosters
        .iter()
        .find(|(agent, _)| agent != ROOT_AGENT_ID)
        .map(|(_, roster)| roster.clone())
        .expect("the subagent reports its roster");

    assert_ne!(
        row(&child, GgModuleKind::Memories).module_id,
        row(&root, GgModuleKind::Memories).module_id,
        "two isolated notebooks are two stores, whatever they happen to contain"
    );
    assert_eq!(
        row(&child, GgModuleKind::Memories).origin,
        GgModuleOrigin::Created
    );
    assert_ne!(
        row(&child, GgModuleKind::History).module_id,
        row(&root, GgModuleKind::History).module_id,
        "and two agents are two windows"
    );
}

/// Every incarnation reports a roster covering every kind, off arms included — and a spawned
/// subagent reports its **opening state snapshots** too, which it did not before: the re-emission
/// gate was `!first_incarnation`, and `announce_configuration` is the root's alone, so an ordinary
/// subagent's panels stayed empty until it happened to mutate something.
#[tokio::test]
async fn every_instance_opens_with_a_roster_and_its_state_snapshots() {
    let dir = TempDir::new().unwrap();
    let events = run_inheritance(dir.path(), GgMemoryScope::Isolated).await;

    let rosters = rosters(&events);
    assert_eq!(rosters.len(), 2, "one roster per instance, no more");
    for (agent, roster) in &rosters {
        assert_eq!(
            roster.iter().map(|entry| entry.kind).collect::<Vec<_>>(),
            GgModuleKind::ALL.to_vec(),
            "{agent} reports every kind, in kind order"
        );
        assert!(
            !row(roster, GgModuleKind::Tasks).enabled,
            "{agent}: an off capability still occupies its row"
        );
        assert!(
            row(roster, GgModuleKind::Tasks).module_id.is_empty(),
            "{agent}: and identifies no store"
        );
        assert!(
            !row(roster, GgModuleKind::Board).enabled,
            "{agent}: this run has no board"
        );
        assert_eq!(
            row(roster, GgModuleKind::Memories).ownership,
            GgModuleOwnership::Owned,
            "{agent}: ownership is reported as data, not only as a log line"
        );
    }

    // The subagent's own opening memory snapshot, emitted before it did anything.
    let (child_id, _) = rosters
        .iter()
        .find(|(agent, _)| agent != ROOT_AGENT_ID)
        .cloned()
        .expect("the subagent reports its roster");
    let child_snapshot = events
        .iter()
        .find(|event| {
            event.agent_id.as_deref() == Some(child_id.as_str())
                && matches!(&event.kind, GgTelemetryKind::MemoryState { .. })
        })
        .expect("a spawned subagent opens with its memory snapshot");
    let GgTelemetryKind::MemoryState {
        module_id, count, ..
    } = &child_snapshot.kind
    else {
        unreachable!("filtered above");
    };
    assert_eq!(*count, 0, "it opens empty, and says so");
    assert_eq!(
        module_id,
        &row(
            &rosters
                .iter()
                .find(|(agent, _)| agent == &child_id)
                .map(|(_, roster)| roster.clone())
                .unwrap(),
            GgModuleKind::Memories
        )
        .module_id,
        "a snapshot names the same instance the roster does, which is what joins them"
    );
}

/// The root's **first** incarnation opens with an `ArchiveState` too, like the other four
/// snapshots — which it did not before.
///
/// `ModuleSet::state_events` is skipped for exactly one instance in a run (the root's first, whose
/// modules `announce_configuration` introduces instead), and that function grew a `state_event()`
/// arm per capability as each was added — except the archive, which arrived last. The result was
/// that the one agent every run has emitted nothing at all for its archive until it happened to
/// call `archive_thread`, against a documented contract (`gg/telemetry/agent-surface.md`) that says the snapshot
/// arrives as an agent opens. An archive the model never uses is precisely the case worth reading
/// — "the capability was given and nothing was put in it" — so it is also the case that must not be
/// missing from the record.
#[tokio::test]
async fn the_root_opens_with_an_empty_archive_snapshot() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-archive".to_string()), Box::new(sink.clone()));
    let mut root = GgAgentConfig {
        model_id: "mock/primary".to_string(),
        ..GgAgentConfig::root()
    };
    root.capabilities.push(GgCapabilityConfig::enabled(
        CAPABILITY_AGENT_MANAGED_CONTEXT,
    ));
    let set = GgCapabilitySet {
        agents: vec![root],
        ..GgCapabilitySet::default()
    };
    let inv = invocation(dir.path(), set);
    // One turn, and it archives nothing: the whole point is the snapshot that arrives anyway.
    let factory = ScriptedFactory::new().slot(ROOT_AGENT, |b| {
        Box::new(MockClient::new(&b.model_id, vec![stop_response()]))
    });
    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );
    let events = sink.events();

    let opening = events
        .iter()
        .find(|event| matches!(&event.kind, GgTelemetryKind::ArchiveState { .. }))
        .expect("the root reports its archive as it opens, before archiving anything");
    let GgTelemetryKind::ArchiveState {
        module_id,
        entries,
        count,
        total_len,
    } = &opening.kind
    else {
        unreachable!("filtered above");
    };
    assert_eq!(*count, 0, "it opens empty, and says so");
    assert_eq!(*total_len, 0);
    assert!(entries.is_empty());
    // And it names the same store the roster does, which is what joins a snapshot to a holder.
    let roster = rosters(&events)
        .into_iter()
        .find(|(agent, _)| agent == ROOT_AGENT_ID)
        .map(|(_, roster)| roster)
        .expect("the root reports its roster");
    assert_eq!(module_id, &row(&roster, GgModuleKind::Archive).module_id);
    assert!(!module_id.is_empty());
}
