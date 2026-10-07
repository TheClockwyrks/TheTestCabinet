//! **What one instance was actually granted on the responses-as-code surface** — the
//! [operations table](super::operations)'s configured half narrowed by the run the agent is standing
//! in, and widened by the one call its position buys it.
//!
//! # Why a configured allowlist is not the whole answer
//!
//! A capability says the machinery *may* exist for this agent and an
//! [allowlist](test_cabinet_core::gg::GgAgentConfig::operations) says which of its calls the agent
//! was handed. Neither can say whether the run built the machinery: the `memories` capability is on
//! and the strategy is the [scratchpad](crate::memories::MemoryStrategy::Scratchpad), so there is no
//! named memory to create; `skills` is on and the workspace authored none, so there is nothing to
//! read; `compaction` is on and the strategy hands the rewrite to a separate model, so there is no
//! compaction for a program to declare. Those are facts about the **instance**, settled when its
//! [modules](crate::modules) were built, and no configuration document can carry them.
//!
//! Granting past them is not a harmless over-grant. Two of the three readers built from a grant are
//! model-facing: the [documentation runtime](crate::docs::DocsRuntime) decides what a search may
//! return, and the [prompt](crate::prompts)'s API section is drawn from the same set — so an
//! over-grant is gg *telling* a model about calls its run cannot service, which is what the
//! [permission filter](crate::docs) exists to prevent. Past the documentation there is the call
//! itself: nothing downstream re-asks the strategy, so a `memories.create_memory` granted under the
//! scratchpad reaches [`MemoryStore`](crate::memories::MemoryStore) and **succeeds**, filing a named
//! memory into a store whose whole design is that its memories are the pinned block.
//!
//! # Why it is not derived from the tool registry
//!
//! Because the two surfaces are independent, and a run condition is not a tool. The conditions below
//! are the same *facts* [`ToolRegistry::from_run`](crate::tools::ToolRegistry::from_run) reads — a
//! module's `offers_*`, a memory strategy's shape, a compaction strategy's owner, a roster's
//! emptiness, a position in a machine — read here from the modules and the profile directly. Routing
//! them through the tool vocabulary is what would make gg's tool names decide what a program may
//! write, and the chain is *tool → internal* and *operation → internal*, never one through the
//! other. The cost is that each condition is stated twice, once per surface, and that is the price
//! of the two surfaces being independent rather than one being the other's subset by construction.

use test_cabinet_core::gg::{
    CAPABILITY_COMPACTION, CAPABILITY_FORK, CAPABILITY_RESPONSES_AS_CODE, CAPABILITY_SUBAGENTS,
    GgAgentConfig,
};

use crate::compaction::CompactionStrategy;
use crate::modules::CapabilityModules;
use crate::tools::AgentFacts;

use super::operations::{
    BOARD_CREATE_EPIC, BOARD_CREATE_ISSUE, BOARD_REMOVE_EPIC, BOARD_REMOVE_ISSUE,
    BOARD_SET_ISSUE_BLOCKED_BY, BOARD_UPDATE_ISSUE, BOARD_WAIT_FOR_ISSUE, Binding,
    CONTEXT_ARCHIVE_THREAD, CONTEXT_COMPACT, CONTEXT_EVICT_FILE_VIEW, CONTEXT_SEARCH_ARCHIVE,
    DELEGATION_EXEC, DELEGATION_FORK, DELEGATION_SEND_MESSAGE, DELEGATION_SPAWN_SUBAGENT,
    DELEGATION_TRANSITION_STATE, DELEGATION_WAIT_FOR_SUBAGENTS, MEMORIES_CREATE_MEMORY,
    MEMORIES_DELETE_MEMORY, MEMORIES_EDIT_MEMORY, MEMORIES_READ_MEMORY, MEMORIES_SEARCH_MEMORIES,
    MEMORIES_UPDATE_MEMORY, MEMORIES_WRITE_MEMORY, OPERATIONS, OperationId, SKILLS_READ_SKILL,
    TASKS_ADD_TASK, TASKS_COMPLETE_TASK, TASKS_REMOVE_TASK, TASKS_SET_BLOCKED_BY,
    TASKS_UPDATE_TASK, resolve_operations,
};

/// **What this instance holds on the responses-as-code surface**, in table order, and the allowlist
/// entries that answer to no operation at all.
///
/// The granted half is an intersection and a union: what `profile`'s
/// [allowlist](GgAgentConfig::operations) names, narrowed to what this instance's `modules` and
/// `facts` can actually [service](serviceable), plus the calls [its position](Binding::Machine)
/// bought it. It is what a [`Grants`](super::Grants) is built from, and every reader of a grant —
/// the membrane, the documentation runtime, the prompt's API section, the agent-surface event —
/// takes this one value rather than resolving the profile again.
///
/// The unresolved half is returned rather than dropped for the reason [`resolve_operations`] returns
/// it: a name that answers to no operation is a typo or a call from the tool vocabulary, and either
/// way the agent was handed less than whoever configured it meant. It is a property of the
/// *configuration* rather than of this instance, so the launch reports it once, by name, and the
/// per-instance callers drop it rather than repeating one typo per spawn.
pub fn granted_operations(
    profile: &GgAgentConfig,
    modules: &CapabilityModules,
    facts: &AgentFacts<'_>,
) -> (Vec<OperationId>, Vec<String>) {
    let (named, unknown) = resolve_operations(profile.operations.iter().map(String::as_str));
    let granted = OPERATIONS
        .iter()
        .filter(|operation| match operation.binding {
            // A configured row: the allowlist has to name it *and* the run has to be able to service
            // it. Both, because they are different failures — one is what an operator chose, the
            // other is what the run turned out to be.
            Binding::Capability(_) => {
                named.contains(&operation.id) && serviceable(operation.id, profile, modules, facts)
            }
            // A positional row is never named by a configuration and never checked against one: an
            // allowlist that carried it would be granting a call out of a document written where the
            // machine is not visible. The run's own answer is the whole of it.
            Binding::Machine => serviceable(operation.id, profile, modules, facts),
            // Nothing here narrows an ending or an always-bound call. A role is decided by the
            // dispatch and read off the grant's own `ending`; an always-bound call is bound in a run
            // that enabled nothing at all, which is exactly what makes the view surface and the
            // documentation search reachable from an empty configuration.
            Binding::Ending(_) | Binding::Always => false,
        })
        .map(|operation| operation.id)
        .collect();
    (granted, unknown)
}

/// **Whether this instance's run can actually service the operation `id` names** — the condition
/// beyond the capability switch, or `true` for the operations that have none.
///
/// One `match` over the whole table rather than a predicate per family, because the question a
/// reader arrives with is *which calls have a condition, and what is it*, and a scatter of per-family
/// helpers answers that nowhere. The final arm is a wildcard on purpose: an operation gg grows is
/// serviceable until somebody says otherwise, which is the direction an omission should fail in — a
/// call the run cannot make throws when it is made, where a call wrongly withheld is a capability
/// the agent is never told it has and therefore never uses.
fn serviceable(
    id: OperationId,
    profile: &GgAgentConfig,
    modules: &CapabilityModules,
    facts: &AgentFacts<'_>,
) -> bool {
    match id {
        // Nothing to read: an empty skill library and an absent one are the same fact to
        // `read_skill`.
        SKILLS_READ_SKILL => modules.skills().offers_skills(),

        // The **memory strategy** decides which memory calls a run has, and the store is asked
        // rather than the capability re-read: the store was built from that strategy, so a run
        // resolves it in one place. The two write sets are disjoint, so a model is never shown two
        // ways to write one memory, and a read-only holder — an inherited handle onto another
        // agent's instance — holds the reads alone.
        MEMORIES_WRITE_MEMORY | MEMORIES_UPDATE_MEMORY => {
            memories(modules, |strategy, writable| {
                !strategy.is_file_shaped() && writable
            })
        }
        MEMORIES_CREATE_MEMORY | MEMORIES_EDIT_MEMORY => memories(modules, |strategy, writable| {
            strategy.is_file_shaped() && writable
        }),
        MEMORIES_READ_MEMORY => memories(modules, |strategy, _| strategy.is_file_shaped()),
        MEMORIES_DELETE_MEMORY => memories(modules, |_, writable| writable),
        MEMORIES_SEARCH_MEMORIES => memories(modules, |strategy, _| strategy.has_search()),

        // Each of these mutates a store the instance either holds or does not.
        TASKS_ADD_TASK | TASKS_UPDATE_TASK | TASKS_SET_BLOCKED_BY | TASKS_COMPLETE_TASK
        | TASKS_REMOVE_TASK => modules.tasks().offers_tasks(),
        BOARD_CREATE_EPIC
        | BOARD_CREATE_ISSUE
        | BOARD_UPDATE_ISSUE
        | BOARD_SET_ISSUE_BLOCKED_BY
        | BOARD_REMOVE_EPIC
        | BOARD_REMOVE_ISSUE
        | BOARD_WAIT_FOR_ISSUE => modules.board().offers_board(),
        // The archive backs the search; the two reclaim calls act on the live window, and are gated
        // with it because the three are one capability's account of a window an agent manages.
        CONTEXT_EVICT_FILE_VIEW | CONTEXT_ARCHIVE_THREAD | CONTEXT_SEARCH_ARCHIVE => {
            modules.archive().offers_archive()
        }

        // `compact` exists only under the strategies that hand the rewrite to the working model
        // itself. Under a handoff strategy a separate model owns it, so a program that could declare
        // one would be driving a compaction its configuration deliberately delegated elsewhere.
        //
        // The switch is read first and on its own: a capability that is off compacts by no strategy
        // at all, and resolving its unwritten arm would answer with
        // [`NO_COMPACTION`](CompactionStrategy::NO_COMPACTION) — a placeholder, not an arm, and one
        // no call may be offered off.
        CONTEXT_COMPACT => {
            profile.is_enabled(CAPABILITY_COMPACTION)
                && CompactionStrategy::resolve(
                    profile
                        .capability(CAPABILITY_COMPACTION)
                        .and_then(|capability| capability.implementation.as_deref()),
                    // Mid-run: the launch pass already read this profile's `implementation`.
                    &mut crate::validate::LaunchReport::Discarding,
                )
                .offers_compact_tool(profile.is_enabled(CAPABILITY_RESPONSES_AS_CODE))
        }

        // A spawn needs a roster entry to name; an empty allowlist means this agent delegates to
        // no one.
        DELEGATION_SPAWN_SUBAGENT => can_delegate(profile),
        // Collecting and guiding are offered to an agent that can have children **at all** — from
        // its roster, or by forking itself. A profile whose only child is a copy of itself would
        // otherwise hold a `fork` it could neither wait on nor guide.
        DELEGATION_WAIT_FOR_SUBAGENTS | DELEGATION_SEND_MESSAGE => {
            can_delegate(profile) || can_fork(profile)
        }
        // `exec` needs somewhere to go, and is withheld from an agent standing in a machine state:
        // there the run's next move is the machine's decision and `transition_state` is how it is
        // made.
        DELEGATION_EXEC => can_delegate(profile) && facts.fsm.is_none(),
        // A fork is a child, so it is gated on the calls that *collect* one rather than on a roster
        // it never reads.
        DELEGATION_FORK => can_fork(profile),
        // The transition, offered from where this instance stands rather than from its profile. A
        // terminal state has nowhere to go, and a call whose every use would be refused is worse
        // than no call at all: it teaches the model a move it does not have.
        DELEGATION_TRANSITION_STATE => facts
            .fsm
            .is_some_and(|position| !position.outgoing().is_empty()),

        _ => true,
    }
}

/// Ask `held` about this instance's memory store — its strategy and whether this holder may write —
/// or answer `false` outright when there is no store bound at all.
///
/// The absent-store check is factored here rather than repeated in seven arms because it is the same
/// answer for all seven and the arms are about the *strategy*: a run with no memories has no memory
/// call, whatever shape the strategy it does not have would be.
fn memories(
    modules: &CapabilityModules,
    held: impl FnOnce(crate::memories::MemoryStrategy, bool) -> bool,
) -> bool {
    modules.memories().offers_memories()
        && held(
            modules.memories().strategy(),
            modules.memories().is_writable(),
        )
}

/// Whether this profile can name a child to spawn — the [subagents](CAPABILITY_SUBAGENTS) capability
/// switched on, over a non-empty delegation roster.
fn can_delegate(profile: &GgAgentConfig) -> bool {
    profile.is_enabled(CAPABILITY_SUBAGENTS) && !profile.subagents.is_empty()
}

/// Whether this profile can produce a child *without* naming one. A [fork](CAPABILITY_FORK) targets
/// the agent itself, so it needs no roster entry — but it does need the
/// [subagents](CAPABILITY_SUBAGENTS) calls that collect the copy, which is what the second half asks.
fn can_fork(profile: &GgAgentConfig) -> bool {
    profile.is_enabled(CAPABILITY_FORK) && profile.is_enabled(CAPABILITY_SUBAGENTS)
}

#[cfg(test)]
#[path = "availability.test.rs"]
mod tests;
