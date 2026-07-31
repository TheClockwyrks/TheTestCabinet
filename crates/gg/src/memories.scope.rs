//! How a [memory store](super::MemoryStore) is **bound** to the agents that hold it: the
//! [scope](MemoryScope) param that decides which instance an agent instance gets, the run-global
//! [registry](MemoryRegistry) of profile-bound instances, the launch validation that reports a
//! scoping gg cannot honour, and the rendering of the [notice](super::MemoriesRuntime::notice) a
//! linked holder is given when somebody else writes.
//!
//! It is a file of its own because it answers a different question from its parent's. `memories.rs`
//! is about *what a memory is* — the set, its limits, its strategies, its revision log. This is
//! about *whose it is*, which is the whole of what changed when one store could be curated by
//! several agents at once.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_MEMORIES, CAPABILITY_SUBAGENTS, CAPABILITY_WORKFLOWS, GgAgentConfig,
    GgCapabilitySet, MEMORY_PARAM_SCOPE,
};

use super::{LoggedRevision, MemoryCaps, MemoryChange, MemoryScope, MemoryStore, MemoryStrategy};
use crate::modules::ModuleResolveCtx;
use crate::prompts::MemoryNoticeEntry;

/// The [memory instance](MemoryScope::Shared) each agent **profile** binds to, created on first
/// use and shared by every instance of that profile in the run.
///
/// Run-global, held by the orchestrator. It exists because `shared` is scoped to the profile
/// rather than to the instance: two instances of one profile running in parallel are two holders
/// of one store, which is exactly the linked-memory case — each is told what the other wrote, and
/// neither is told what it wrote itself.
#[derive(Debug, Default)]
pub struct MemoryRegistry {
    /// The store bound to each profile name, created lazily.
    entries: Mutex<HashMap<String, Arc<Mutex<MemoryStore>>>>,
}

impl MemoryRegistry {
    /// An empty registry — a run in which no profile has yet asked for a profile-bound instance.
    pub fn new() -> Self {
        Self::default()
    }

    /// The store bound to `profile`, creating it (organized by `strategy` and bounded by `caps`)
    /// on the first instance that asks.
    ///
    /// A later instance takes the store as it stands, **including the limits the first instance's
    /// profile resolved**: they are one store, so there is one set of limits, and re-pointing them
    /// per instance would make a write's fate depend on which instance happened to make it.
    pub fn bind(
        &self,
        profile: &str,
        strategy: MemoryStrategy,
        caps: MemoryCaps,
    ) -> Arc<Mutex<MemoryStore>> {
        let mut entries = self.entries.lock().expect("memory registry lock");
        Arc::clone(
            entries
                .entry(profile.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(MemoryStore::new(strategy, caps)))),
        )
    }
}

/// Resolve the [`scope`](MEMORY_PARAM_SCOPE) param on `profile`'s memories capability, returning
/// the resolved value and, for a value gg could not read, the launch warning that names it.
///
/// An unrecognized value falls back to [`Isolated`](MemoryScope::Isolated) — today's behaviour,
/// and the one that cannot silently entangle two agents' notebooks — and warns rather than failing
/// the launch, in line with how gg treats every other unrecognized capability *value*.
pub fn resolve_scope(profile: &GgAgentConfig) -> (MemoryScope, Option<String>) {
    let Some(raw) = profile
        .capability(CAPABILITY_MEMORIES)
        .and_then(|capability| capability.params.get(MEMORY_PARAM_SCOPE))
    else {
        return (MemoryScope::default(), None);
    };
    let known = |value: &str| {
        MemoryScope::ALL
            .into_iter()
            .find(|scope| scope.as_str() == value)
    };
    match raw {
        Value::String(value) => match known(value.trim()) {
            Some(scope) => (scope, None),
            None => (
                MemoryScope::default(),
                Some(format!(
                    "the `{CAPABILITY_MEMORIES}` capability sets `{MEMORY_PARAM_SCOPE}` to \
                     `{value}`, which is not a memory scope gg knows ({}); memories are \
                     `{}`, as if the param were absent.",
                    scope_list(),
                    MemoryScope::default(),
                )),
            ),
        },
        other => (
            MemoryScope::default(),
            Some(format!(
                "the `{CAPABILITY_MEMORIES}` capability sets `{MEMORY_PARAM_SCOPE}` to `{other}`, \
                 which is not a string; memories are `{}`, as if the param were absent.",
                MemoryScope::default(),
            )),
        ),
    }
}

/// Whether **any** profile this run declares takes its memories from its spawner — the run-level
/// half of [`MemoriesRuntime::is_linked`](super::MemoriesRuntime::is_linked).
///
/// A holder learns whether its own binding links it from its own [scope](MemoryScope), but that is
/// only half the question: inheritance is an offer the *spawner* makes, and a spawner scoped
/// [`isolated`](MemoryScope::Isolated) still hands its store to a child scoped
/// [`inherited`](MemoryScope::Inherited). Whether such a child exists at all is a property of the
/// whole configuration, so it is answered once at launch and carried into every module resolution
/// — the alternative, counting a store's live holders when the prompt is rendered, answers "has it
/// happened yet" rather than "can it happen", and a prompt rendered before the first spawn would
/// always say no.
pub fn run_inherits_memories(set: &GgCapabilitySet) -> bool {
    set.agents.iter().any(|profile| {
        profile.is_enabled(CAPABILITY_MEMORIES) && resolve_scope(profile).0.is_inherited()
    })
}

/// Whether a holder built for `profile` under `scope` should be told its memories may be held by
/// another agent too — see [`MemoriesRuntime::is_linked`](super::MemoriesRuntime::is_linked).
///
/// Either its own binding links it, or it can spawn and this run declares somebody who inherits.
/// The delegation check is what keeps the warning off an agent that has no way of producing the
/// child that would inherit from it.
pub fn links(profile: &GgAgentConfig, scope: MemoryScope, ctx: &ModuleResolveCtx<'_>) -> bool {
    scope.may_link()
        || (ctx.inheritable
            && (profile.is_enabled(CAPABILITY_SUBAGENTS)
                || profile.is_enabled(CAPABILITY_WORKFLOWS)))
}

/// The scopes, as a prose list — the vocabulary every scope diagnostic offers back.
fn scope_list() -> String {
    MemoryScope::ALL
        .map(|scope| format!("`{scope}`"))
        .join(", ")
}

/// Every launch warning `set`'s **memory scoping** earns, across every declared profile.
///
/// Three things are reported, all of them configurations that describe an intent gg cannot honour
/// and would otherwise carry out as something else:
///
/// 1. a [`scope`](MEMORY_PARAM_SCOPE) gg could not read (falls back to
///    [`isolated`](MemoryScope::Isolated));
/// 2. a `scope` on a profile whose memories capability is **off** — scoping decides which instance
///    an agent binds, and an agent with no memories binds none;
/// 3. an [`inherited`](MemoryScope::Inherited) or [`read-only`](MemoryScope::ReadOnly) profile
///    whose spawner organizes memories by a **different** [strategy](MemoryStrategy). A store is
///    read by the calls its strategy offers, so such a child cannot take its spawner's instance
///    and silently gets one of its own — which is worth saying before the run rather than
///    inferring afterwards from a notebook that stayed empty.
///
/// Collected at launch beside the other per-profile diagnostics, so a typo is reported before the
/// first turn.
pub fn launch_warnings(set: &GgCapabilitySet) -> Vec<String> {
    let mut warnings = Vec::new();
    for agent in &set.agents {
        if let Some(warning) = resolve_scope(agent).1 {
            warnings.push(format!("agent `{}`: {warning}", agent.name));
        }
        let declares_scope = agent
            .capability(CAPABILITY_MEMORIES)
            .is_some_and(|capability| capability.params.get(MEMORY_PARAM_SCOPE).is_some());
        if declares_scope && !agent.is_enabled(CAPABILITY_MEMORIES) {
            warnings.push(format!(
                "agent `{}`: the `{CAPABILITY_MEMORIES}` capability sets \
                 `{MEMORY_PARAM_SCOPE}` but is not enabled; a scope decides which memory \
                 instance an agent binds, and an agent with no memories binds none.",
                agent.name,
            ));
        }
        if !agent.is_enabled(CAPABILITY_MEMORIES) {
            continue;
        }
        let strategy = strategy_of(agent);
        for reference in &agent.subagents {
            let Some(child) = set.agent(&reference.agent) else {
                continue;
            };
            if !child.is_enabled(CAPABILITY_MEMORIES)
                || !matches!(
                    resolve_scope(child).0,
                    MemoryScope::Inherited | MemoryScope::ReadOnly
                )
            {
                continue;
            }
            let child_strategy = strategy_of(child);
            if child_strategy != strategy {
                warnings.push(format!(
                    "agent `{}` inherits memories but organizes them as `{}`, while its spawner \
                     `{}` organizes them as `{}`; a store is read by the calls its strategy \
                     offers, so `{}` gets an instance of its own instead of its spawner's.",
                    child.name,
                    child_strategy.id(),
                    agent.name,
                    strategy.id(),
                    child.name,
                ));
            }
        }
    }
    warnings
}

/// The [strategy](MemoryStrategy) `profile` organizes its memories by.
fn strategy_of(profile: &GgAgentConfig) -> MemoryStrategy {
    MemoryStrategy::resolve(
        profile
            .capability(CAPABILITY_MEMORIES)
            .and_then(|capability| capability.implementation.as_deref()),
    )
}

/// The [notice](MemoriesRuntime::notice) lines `fresh` deserves, from the point of view of the
/// holder `holder`: every entry another holder authored, **one line per memory** rather than one
/// per write.
///
/// Collapsing by slug is what keeps a busy sibling from filling this agent's window: a memory
/// written and then twice revised is one line saying what it now says. The lines keep the order in
/// which each memory *first* appeared in this batch, so the notice reads as a list of what changed
/// rather than as a reshuffle. A deletion is included and wins over anything earlier in the batch —
/// acting on a memory that has since been deleted is precisely the failure the notice exists to
/// prevent.
pub(super) fn notice_entries(
    fresh: &[LoggedRevision],
    holder: &str,
    strategy: MemoryStrategy,
) -> Vec<MemoryNoticeEntry> {
    let mut order: Vec<String> = Vec::new();
    let mut latest: HashMap<String, MemoryNoticeEntry> = HashMap::new();
    for entry in fresh {
        if entry.author == holder {
            continue;
        }
        let name = entry.revision.name.clone();
        if !latest.contains_key(&name) {
            order.push(name.clone());
        }
        latest.insert(
            name.clone(),
            MemoryNoticeEntry {
                name,
                change: match entry.revision.change {
                    MemoryChange::Written => "added",
                    MemoryChange::Updated => "updated",
                    MemoryChange::Deleted => "deleted",
                }
                .to_string(),
                description: entry.revision.description.clone(),
                // The bodies are only carried where there is no call to read one with; they are
                // already bounded by `maxLenPerMemory`, so the notice cannot outgrow one memory.
                body: (!strategy.is_file_shaped()
                    && entry.revision.change != MemoryChange::Deleted)
                    .then(|| entry.revision.body.clone()),
            },
        );
    }
    order
        .into_iter()
        .filter_map(|name| latest.remove(&name))
        .collect()
}
