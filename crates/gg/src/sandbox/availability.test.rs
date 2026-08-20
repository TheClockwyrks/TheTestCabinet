use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;
use test_cabinet_core::gg::{
    CAPABILITY_COMPACTION, CAPABILITY_EXEC, CAPABILITY_FORK, CAPABILITY_MEMORIES,
    CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_RESPONSES_AS_CODE, CAPABILITY_SKILLS,
    CAPABILITY_SUBAGENTS, CAPABILITY_TASKS, COMPACTION_STRATEGY_HANDOFF_COMPACTION,
    COMPACTION_STRATEGY_SELF_COMPACTION, GgAgentConfig, GgCapabilityConfig, GgMemoryScope,
    GgSubagentRef, ROOT_PROFILE_ID,
};

use super::*;
use crate::board::{BoardCaps, BoardRuntime};
use crate::memories::{MemoriesRuntime, MemoryAccess, MemoryCaps, MemoryStrategy};
use crate::modules::ModuleHandle;
use crate::skills::{SkillLibrary, SkillsRuntime};
use crate::tasks::TasksRuntime;

/// A profile with `capabilities` on and its [operation allowlist](GgAgentConfig::operations) seeded
/// with **everything those capabilities offer** — the shape the console's editor writes when an
/// operator switches a capability on.
///
/// Seeded rather than left empty because every test here is about the *run* condition: a fixture
/// naming no operations would be withheld everything for a second reason, and each assertion below
/// would pass for the wrong one.
fn profile_with(capabilities: Vec<GgCapabilityConfig>) -> GgAgentConfig {
    let enabled: Vec<String> = capabilities
        .iter()
        .filter(|capability| capability.enabled)
        .map(|capability| capability.id.clone())
        .collect();
    let operations = super::super::capability_operations(enabled.iter().map(String::as_str))
        .into_iter()
        .map(|id| id.to_string())
        .collect();
    GgAgentConfig {
        capabilities,
        operations,
        ..GgAgentConfig::root()
    }
}

/// Whether `profile`, holding `modules` and standing at `facts`, was granted `id`.
fn granted(
    profile: &GgAgentConfig,
    modules: &CapabilityModules,
    facts: &AgentFacts<'_>,
    id: OperationId,
) -> bool {
    granted_operations(profile, modules, facts).0.contains(&id)
}

/// A [position](crate::fsm::FsmPosition) in a two-state machine whose entry state has somewhere to
/// go — the fact that buys the transition, since no capability of the agent's own can.
fn fsm_position() -> crate::fsm::FsmPosition {
    use test_cabinet_core::gg::{CAPABILITY_FSM, FSM_PARAM_STATES};
    let shell = GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params: json!({ FSM_PARAM_STATES: [
                { "name": "build", "agentId": "builder", "transitions": [{ "to": "verify" }] },
                { "name": "verify", "agentId": "verifier" },
            ] }),
            ..GgCapabilityConfig::enabled(CAPABILITY_FSM)
        }],
        ..GgAgentConfig::root()
    };
    let spec = Arc::new(
        crate::fsm::FsmSpec::resolve(&shell)
            .expect("the shell declares a machine")
            .expect("it parses"),
    );
    spec.entry_position()
}

/// **The transition is bought by the machine an instance stands in, and by nothing else.**
///
/// The regression this exists for: the `fsm` capability is what makes a profile an FSM *shell*, and
/// a shell takes no turns — so a row filed under that capability asks a question whose answer is
/// `false` for every agent that could ever make the call, and a program in a machine state would be
/// stuck there until a ceiling stopped the run.
#[test]
fn the_transition_is_granted_from_the_machine_position() {
    let profile = profile_with(vec![GgCapabilityConfig::enabled(CAPABILITY_SKILLS)]);
    let modules = CapabilityModules::inert();

    assert!(
        !granted(
            &profile,
            &modules,
            &AgentFacts::default(),
            DELEGATION_TRANSITION_STATE
        ),
        "an agent outside a machine is granted no transition"
    );

    let entry = fsm_position();
    assert!(
        granted(
            &profile,
            &modules,
            &AgentFacts {
                fsm: Some(&entry),
                ..AgentFacts::default()
            },
            DELEGATION_TRANSITION_STATE
        ),
        "a state with somewhere to go is granted one, from a profile that names no `fsm` capability \
         and no transition in its allowlist"
    );

    let terminal = entry.moved_to(
        entry
            .transition_to("verify")
            .expect("the entry state may reach `verify`"),
    );
    assert!(
        !granted(
            &profile,
            &modules,
            &AgentFacts {
                fsm: Some(&terminal),
                ..AgentFacts::default()
            },
            DELEGATION_TRANSITION_STATE
        ),
        "a terminal state is granted nothing to transition with"
    );
}

/// **An allowlist cannot buy the transition**, and an allowlist that names it is not thereby wrong:
/// the call is positional, so a document that mentions it grants nothing and a document that does
/// not still leaves a state able to move.
#[test]
fn naming_the_transition_in_an_allowlist_grants_nothing() {
    let profile = GgAgentConfig {
        operations: vec![DELEGATION_TRANSITION_STATE.to_string()],
        ..GgAgentConfig::root()
    };
    assert!(
        !granted(
            &profile,
            &CapabilityModules::inert(),
            &AgentFacts::default(),
            DELEGATION_TRANSITION_STATE
        ),
        "an allowlist entry is not a machine"
    );
}

/// **The memory strategy decides which memory calls a run has**, and the grant follows it.
///
/// Under the scratchpad the memories *are* the pinned block: there is no named memory to create,
/// read or edit. Granting one anyway is not inert — `create_memory` would reach the store and
/// succeed, filing a named memory into a store built on the premise that there are none.
#[test]
fn the_memory_grant_follows_the_strategy() {
    let profile = profile_with(vec![GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)]);
    let bound = |strategy| {
        CapabilityModules::inert().with(ModuleHandle::Memories(MemoriesRuntime::new(
            strategy,
            MemoryCaps::UNBOUNDED,
        )))
    };
    let facts = AgentFacts::default();

    let scratchpad = bound(MemoryStrategy::Scratchpad);
    for id in [
        MEMORIES_CREATE_MEMORY,
        MEMORIES_READ_MEMORY,
        MEMORIES_EDIT_MEMORY,
        MEMORIES_SEARCH_MEMORIES,
    ] {
        assert!(
            !granted(&profile, &scratchpad, &facts, id),
            "the scratchpad has no `{id}`"
        );
    }
    for id in [
        MEMORIES_WRITE_MEMORY,
        MEMORIES_UPDATE_MEMORY,
        MEMORIES_DELETE_MEMORY,
    ] {
        assert!(
            granted(&profile, &scratchpad, &facts, id),
            "the scratchpad has `{id}`"
        );
    }

    let markdown = bound(MemoryStrategy::Markdown);
    for id in [
        MEMORIES_CREATE_MEMORY,
        MEMORIES_READ_MEMORY,
        MEMORIES_EDIT_MEMORY,
    ] {
        assert!(
            granted(&profile, &markdown, &facts, id),
            "a file-shaped strategy has `{id}`"
        );
    }
    for id in [MEMORIES_WRITE_MEMORY, MEMORIES_UPDATE_MEMORY] {
        assert!(
            !granted(&profile, &markdown, &facts, id),
            "and not the scratchpad's `{id}` beside it"
        );
    }
    assert!(
        !granted(&profile, &markdown, &facts, MEMORIES_SEARCH_MEMORIES),
        "search belongs to the strategy that indexes"
    );
    assert!(
        granted(
            &profile,
            &bound(MemoryStrategy::KeywordSearch),
            &facts,
            MEMORIES_SEARCH_MEMORIES
        ),
        "which is the keyword-search one"
    );
}

/// **A read-only memory holder is granted the reads alone.** An inherited handle onto another
/// agent's instance may never write, and the grant is where that becomes total: the model is not
/// shown a write it would then be refused for using.
#[test]
fn a_read_only_memory_holder_is_granted_no_write() {
    let profile = profile_with(vec![GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)]);
    let modules = CapabilityModules::inert().with(ModuleHandle::Memories(
        MemoriesRuntime::new(MemoryStrategy::Markdown, MemoryCaps::UNBOUNDED)
            .with_binding(GgMemoryScope::ReadOnly, MemoryAccess::ReadOnly),
    ));
    let facts = AgentFacts::default();

    assert!(granted(&profile, &modules, &facts, MEMORIES_READ_MEMORY));
    for id in [
        MEMORIES_CREATE_MEMORY,
        MEMORIES_EDIT_MEMORY,
        MEMORIES_DELETE_MEMORY,
    ] {
        assert!(
            !granted(&profile, &modules, &facts, id),
            "a read-only holder is granted no `{id}`"
        );
    }
}

/// **A capability whose module the run never bound grants nothing**, however fully its allowlist is
/// written: there is no library to read a skill out of, no list to add a task to, no board to file
/// an issue on.
#[test]
fn an_unbound_module_grants_none_of_its_capability() {
    let profile = profile_with(vec![
        GgCapabilityConfig::enabled(CAPABILITY_SKILLS),
        GgCapabilityConfig::enabled(CAPABILITY_TASKS),
        GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT),
    ]);
    let facts = AgentFacts::default();

    let inert = CapabilityModules::inert();
    for id in [SKILLS_READ_SKILL, TASKS_ADD_TASK, BOARD_CREATE_ISSUE] {
        assert!(
            !granted(&profile, &inert, &facts, id),
            "`{id}` needs a module the run actually built"
        );
    }

    let dir = TempDir::new().expect("a scratch skills directory");
    std::fs::write(
        dir.path().join("intro.md"),
        "---\nname: intro\ndescription: d.\n---\nbody",
    )
    .expect("the skill is written");
    let held = CapabilityModules::inert()
        .with(ModuleHandle::Skills(SkillsRuntime::new(Arc::new(
            SkillLibrary::loaded(dir.path()),
        ))))
        .with(ModuleHandle::Tasks(TasksRuntime::new(100)))
        .with(ModuleHandle::Board(
            BoardRuntime::new(BoardCaps::detached()),
        ));
    for id in [SKILLS_READ_SKILL, TASKS_ADD_TASK, BOARD_CREATE_ISSUE] {
        assert!(
            granted(&profile, &held, &facts, id),
            "`{id}` is granted once the run holds its module"
        );
    }
}

/// **`compact` belongs to the strategies that hand the rewrite to the working model itself.** Under
/// a handoff strategy a separate model owns it, so a program that could declare one would be driving
/// a compaction the configuration deliberately delegated elsewhere.
#[test]
fn the_compact_grant_follows_the_compaction_strategy() {
    let with_strategy = |implementation: &str| {
        profile_with(vec![
            GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE),
            GgCapabilityConfig {
                implementation: Some(implementation.to_string()),
                ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
            },
        ])
    };
    let modules = CapabilityModules::inert();
    let facts = AgentFacts::default();

    assert!(
        granted(
            &with_strategy(COMPACTION_STRATEGY_SELF_COMPACTION),
            &modules,
            &facts,
            CONTEXT_COMPACT
        ),
        "self-compaction is the model's own rewrite"
    );
    assert!(
        !granted(
            &with_strategy(COMPACTION_STRATEGY_HANDOFF_COMPACTION),
            &modules,
            &facts,
            CONTEXT_COMPACT
        ),
        "a handoff strategy's rewrite belongs to another model"
    );
}

/// **The delegation family is granted on the terms each call is usable on**: a spawn needs a roster
/// entry to name, a fork needs the calls that collect a copy, and `exec` needs somewhere to go and
/// is withheld inside a machine, where the next move is the machine's.
#[test]
fn the_delegation_grant_follows_what_makes_each_call_usable() {
    let modules = CapabilityModules::inert();
    let facts = AgentFacts::default();

    // Everything on, nothing to name: no spawn, no exec, and no fork — `fork` needs `subagents`,
    // which is what offers the calls that collect the copy.
    let bare = profile_with(vec![
        GgCapabilityConfig::enabled(CAPABILITY_EXEC),
        GgCapabilityConfig::enabled(CAPABILITY_FORK),
    ]);
    for id in [DELEGATION_SPAWN_SUBAGENT, DELEGATION_EXEC, DELEGATION_FORK] {
        assert!(
            !granted(&bare, &modules, &facts, id),
            "`{id}` is not usable with nothing to name and nothing to collect with"
        );
    }

    let mut rostered = profile_with(vec![
        GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS),
        GgCapabilityConfig::enabled(CAPABILITY_EXEC),
        GgCapabilityConfig::enabled(CAPABILITY_FORK),
    ]);
    rostered.subagents.push(GgSubagentRef::any(ROOT_PROFILE_ID));
    for id in [
        DELEGATION_SPAWN_SUBAGENT,
        DELEGATION_EXEC,
        DELEGATION_FORK,
        DELEGATION_WAIT_FOR_SUBAGENTS,
        DELEGATION_SEND_MESSAGE,
    ] {
        assert!(
            granted(&rostered, &modules, &facts, id),
            "`{id}` is usable with a roster and the collecting calls"
        );
    }

    let position = fsm_position();
    assert!(
        !granted(
            &rostered,
            &modules,
            &AgentFacts {
                fsm: Some(&position),
                ..AgentFacts::default()
            },
            DELEGATION_EXEC
        ),
        "inside a machine the next move is the machine's"
    );
}

/// **An always-bound call survives an empty configuration**, and an ending is not narrowed here at
/// all: what a role dispatched is read off the grant's own ending, and what nothing gates is what a
/// run enabling nothing still has.
#[test]
fn nothing_here_narrows_the_ungated_surface() {
    let bare = GgAgentConfig {
        capabilities: Vec::new(),
        operations: Vec::new(),
        ..GgAgentConfig::root()
    };
    let (granted, unknown) =
        granted_operations(&bare, &CapabilityModules::inert(), &AgentFacts::default());
    assert!(granted.is_empty(), "a bare profile is granted nothing here");
    assert!(unknown.is_empty(), "and names nothing it cannot resolve");

    let grants = super::super::Grants::new(Vec::new(), None, granted);
    for id in [DOCS_SEARCH_ID, VIEWS_CURRENT_ID] {
        let operation = super::super::operation(id).expect("a table row");
        assert!(
            grants.permits(operation),
            "`{id}` is bound to every program whatever a run enables"
        );
    }
}

/// The two always-bound ids this module's last test reaches for, named here rather than imported
/// into the whole file: they are the only operations it asks about that it does not narrow.
use super::super::operations::{DOCS_SEARCH as DOCS_SEARCH_ID, VIEWS_CURRENT as VIEWS_CURRENT_ID};

/// **An allowlist entry that answers to no operation comes back**, because a name that grants
/// nothing is a configuration error rather than an inert entry — and the launch is what says so.
#[test]
fn an_unresolvable_allowlist_entry_is_reported() {
    let profile = GgAgentConfig {
        operations: vec!["read_file".to_string(), "files.read_file".to_string()],
        ..GgAgentConfig::root()
    };
    let (_, unknown) = granted_operations(
        &profile,
        &CapabilityModules::inert(),
        &AgentFacts::default(),
    );
    assert_eq!(
        unknown,
        vec!["read_file".to_string()],
        "a gg tool name is not an operation id"
    );
}
