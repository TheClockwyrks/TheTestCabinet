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

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_MEMORIES, CAPABILITY_SUBAGENTS, GgAgentConfig, GgCapabilitySet, MEMORY_PARAM_SCOPE,
};

use super::{LoggedRevision, MemoryCaps, MemoryChange, MemoryScope, MemoryStore, MemoryStrategy};
use crate::modules::{ModuleIds, ModuleKind, ModuleResolveCtx};
use crate::prompts::MemoryNoticeEntry;
use crate::validate::{LaunchDefect, LaunchReport};

/// One registry entry: the profile-bound store and its
/// [module id](crate::modules::Module::instance_id), which are minted together and handed out
/// together — the id is only meaningful as the identity of that exact store.
type BoundInstance = (Arc<Mutex<MemoryStore>>, Arc<str>);

/// The [memory instance](MemoryScope::Shared) each agent **profile** binds to, created on first
/// use and shared by every instance of that profile in the run.
///
/// Run-global, held by the orchestrator. It exists because `shared` is scoped to the profile
/// rather than to the instance: two instances of one profile running in parallel are two holders
/// of one store, which is exactly the linked-memory case — each is told what the other wrote, and
/// neither is told what it wrote itself.
#[derive(Debug, Default)]
pub struct MemoryRegistry {
    /// The store bound to each profile name, with its [module id](crate::modules::ModuleIdMint),
    /// created lazily.
    entries: Mutex<BTreeMap<String, BoundInstance>>,
}

impl MemoryRegistry {
    /// An empty registry — a run in which no profile has yet asked for a profile-bound instance.
    pub fn new() -> Self {
        Self::default()
    }

    /// The store bound to `profile`, and its [module id](crate::modules::Module::instance_id),
    /// creating both (organized by `strategy`, bounded by `caps`, identified out of `ids`) on the
    /// first instance that asks.
    ///
    /// A later instance takes the store as it stands, **including the limits the first instance's
    /// profile resolved**: they are one store, so there is one set of limits, and re-pointing them
    /// per instance would make a write's fate depend on which instance happened to make it. It
    /// takes the same id for the same reason, and that is what makes a profile's twelve instances
    /// legible as twelve holders of one notebook rather than as twelve notebooks that agree.
    pub fn bind(
        &self,
        profile: &str,
        strategy: MemoryStrategy,
        caps: MemoryCaps,
        ids: &ModuleIds,
    ) -> BoundInstance {
        let mut entries = self.entries.lock().expect("memory registry lock");
        let (store, id) = entries.entry(profile.to_string()).or_insert_with(|| {
            (
                Arc::new(Mutex::new(MemoryStore::new(strategy, caps))),
                ids.next(ModuleKind::Memories),
            )
        });
        (Arc::clone(store), Arc::clone(id))
    }
}

/// Resolve the [`scope`](MEMORY_PARAM_SCOPE) param on `profile`'s memories capability.
///
/// Absent or `null` takes the documented default, [`Isolated`](MemoryScope::Isolated). A value gg
/// cannot read is reported into `report` and [refuses the launch](crate::validate): the scope is what
/// decides *whose notebook this agent holds*, so reading an unrecognized one as `isolated` would give
/// a run in which two agents were meant to curate one store two stores that never meet — and the
/// evidence for it is a notebook that stayed empty.
///
/// The resolved value still comes back, and is still the default, because the resolver is
/// [total](crate::validate#the-resolver-contract): it is re-read at every spawn, where the launch
/// pass has already proved there is nothing to report.
pub fn resolve_scope(profile: &GgAgentConfig, report: &mut LaunchReport) -> MemoryScope {
    let Some(raw) = profile
        .capability(CAPABILITY_MEMORIES)
        .and_then(|capability| capability.params.get(MEMORY_PARAM_SCOPE))
        .filter(|value| !value.is_null())
    else {
        return MemoryScope::default();
    };
    let known = |value: &str| {
        MemoryScope::ALL
            .into_iter()
            .find(|scope| scope.as_str() == value)
    };
    let defect = |found: String, message: String| {
        LaunchDefect::run_level(
            crate::validate::param_locus(CAPABILITY_MEMORIES, MEMORY_PARAM_SCOPE),
            found,
            message,
        )
    };
    match raw {
        Value::String(value) => match known(value.trim()) {
            Some(scope) => scope,
            None => {
                report.report(
                    defect(
                        value.clone(),
                        format!(
                            "`{MEMORY_PARAM_SCOPE}` decides which memory instance this agent \
                             binds, and `{value}` names none of them."
                        ),
                    )
                    .known(MemoryScope::ALL.map(|scope| scope.as_str())),
                );
                MemoryScope::default()
            }
        },
        other => {
            report.report(
                defect(
                    crate::validate::as_written(other),
                    format!(
                        "`{MEMORY_PARAM_SCOPE}` names a memory instance to bind, so it must be \
                             a string."
                    ),
                )
                .known(MemoryScope::ALL.map(|scope| scope.as_str())),
            );
            MemoryScope::default()
        }
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
        profile.is_enabled(CAPABILITY_MEMORIES)
            && resolve_scope(profile, &mut LaunchReport::Discarding).is_inherited()
    })
}

/// Whether a holder built for `profile` under `scope` should be told its memories may be held by
/// another agent too — see [`MemoriesRuntime::is_linked`](super::MemoriesRuntime::is_linked).
///
/// Either its own binding links it, or it can spawn and this run declares somebody who inherits.
/// The delegation check is what keeps the warning off an agent that has no way of producing the
/// child that would inherit from it.
pub fn links(profile: &GgAgentConfig, scope: MemoryScope, ctx: &ModuleResolveCtx<'_>) -> bool {
    scope.may_link() || (ctx.inheritable && profile.is_enabled(CAPABILITY_SUBAGENTS))
}

/// **The memory-scoping contradiction** a set can contain — a configuration in which every value is
/// individually readable and the document as a whole still asks for something gg cannot do.
///
/// The per-profile values themselves ([`resolve_scope`], the strategy, the limits) are read by
/// [`check_launch`](super::check_launch); this is only what needs more than one profile in hand at
/// once: **an [`inherited`](MemoryScope::Inherited) or [`read-only`](MemoryScope::ReadOnly) profile
/// that names a [strategy](MemoryStrategy) its spawner does not**. A store is read by the calls its
/// strategy offers, so such a child cannot take its spawner's instance: it gets a private one, and
/// the inheritance the configuration describes never happens. The evidence would otherwise be a
/// notebook that stayed empty.
///
/// A child that names **no** strategy is not that. An inheriting agent organizes its memories the
/// way its spawner does, so an absent `implementation` is the documented default *for an inheriting
/// profile* — it agrees with whatever it is handed, and [`MemoriesRuntime::resolve`](super::MemoriesRuntime::resolve)
/// binds the spawner's store whatever strategy it is organized by. Only two profiles that both
/// speak, and disagree, are a contradiction.
///
/// This is the **statically decidable half** of the question. A child spawned by a profile the
/// roster does not name — a machine's successor, a dynamically chosen spawner — is not decidable
/// from the document, and is the run's own to report.
///
/// A profile whose memories capability is **off** is skipped rather than refused for its
/// [`scope`](MEMORY_PARAM_SCOPE): a disabled capability still records the configuration the arm
/// *would* have used, which is what keeps the on and off arms of one comparison symmetric.
pub fn check_scoping(set: &GgCapabilitySet, report: &mut LaunchReport) {
    for agent in &set.agents {
        if !agent.is_enabled(CAPABILITY_MEMORIES) {
            continue;
        }
        let strategy = strategy_of(agent);
        for reference in &agent.subagents {
            let Some(child) = set.agent(&reference.agent) else {
                continue;
            };
            if !child.is_enabled(CAPABILITY_MEMORIES)
                || declared_strategy(child).is_none()
                || !matches!(
                    resolve_scope(child, &mut LaunchReport::already_reported()),
                    MemoryScope::Inherited | MemoryScope::ReadOnly
                )
            {
                continue;
            }
            let child_strategy = strategy_of(child);
            if child_strategy != strategy {
                report.report(LaunchDefect::on_agent(
                    &child.name,
                    crate::validate::implementation_locus(CAPABILITY_MEMORIES),
                    child_strategy.id(),
                    format!(
                        "`{}` inherits its memories from `{}`, which organizes them as `{}`; a \
                         store is read by the calls its strategy offers, so gg could only give \
                         `{}` an instance of its own — which is not the run this configuration \
                         describes. Organize both the same way, or scope `{}` `{}`.",
                        child.name,
                        agent.name,
                        strategy.id(),
                        child.name,
                        child.name,
                        MemoryScope::default(),
                    ),
                ));
            }
        }
    }
}

/// **The half of [`check_scoping`] no document could decide**: an instance about to bind its
/// spawner's memories that **names** a [strategy](MemoryStrategy) its spawner does not organize them
/// by.
///
/// `Some(detail)` is a **gg defect** and ends the agent — and the run with it. It is not a
/// configuration an operator can fix from the refusal, because the pairing is not in the
/// configuration: the roster pairings are all refused at launch, so what reaches here is a spawner
/// gg chose at run time (a machine's successor, a dynamically dispatched agent). What must not
/// happen is the old answer — a fresh private notebook — which leaves the run's record saying two
/// agents shared a store while they never saw each other's memories.
///
/// `None` covers the three ordinary cases: an agent that is not inheriting at all, an inheriting
/// agent whose spawner keeps no memories (the documented arm in which the child gets its own), and
/// an inheriting agent that names **no** strategy — which organizes its memories the way its spawner
/// does, whatever way that is, and so can never disagree with one.
pub fn inherited_strategy_conflict(
    profile: &GgAgentConfig,
    ctx: &ModuleResolveCtx<'_>,
) -> Option<String> {
    if !profile.is_enabled(CAPABILITY_MEMORIES) {
        return None;
    }
    // Discarding: every value read here was read — and refused — by the launch pass, through these
    // same resolvers.
    let scope = resolve_scope(profile, &mut LaunchReport::Discarding);
    if !matches!(scope, MemoryScope::Inherited | MemoryScope::ReadOnly) {
        return None;
    }
    let strategy = declared_strategy(profile)?;
    let spawner = ctx.inherited.memories_organized_differently(strategy)?;
    Some(format!(
        "agent `{}` is scoped `{scope}` and organizes its memories as `{}`, but the agent that \
         spawned it organizes them as `{}`; a store is read by the calls its own strategy offers, \
         so there is no handle onto it this agent could be given",
        profile.name,
        strategy.id(),
        spawner.id(),
    ))
}

/// The [strategy](MemoryStrategy) `profile` organizes its memories by, **naming one or not**: the
/// documented default ([`Scratchpad`](MemoryStrategy::Scratchpad)) where it names none.
///
/// Read into an [already-reported](LaunchReport::already_reported) sink: the profile's own
/// `implementation` is read — and refused — by [`check_launch`](super::check_launch) a few lines
/// earlier in the same pass, so reporting it again here would name one typo twice.
fn strategy_of(profile: &GgAgentConfig) -> MemoryStrategy {
    MemoryStrategy::resolve(
        profile
            .capability(CAPABILITY_MEMORIES)
            .and_then(|capability| capability.implementation.as_deref()),
        &mut LaunchReport::already_reported(),
    )
}

/// The [strategy](MemoryStrategy) `profile` **names**, or `None` when it names none.
///
/// That distinction is the whole of an inheriting profile's contract. A profile that names a
/// strategy has said how its notebook is organized, and one that names none organizes it however
/// whoever hands it one does — so it agrees with every spawner, and there is nothing for gg to
/// refuse or to report. A blank string names nothing (it is how an editor spells "unset"), so it
/// reads exactly as an absent key does.
pub(super) fn declared_strategy(profile: &GgAgentConfig) -> Option<MemoryStrategy> {
    let named = profile
        .capability(CAPABILITY_MEMORIES)
        .and_then(|capability| capability.implementation.as_deref())
        .map(str::trim)
        .filter(|named| !named.is_empty())?;
    Some(MemoryStrategy::resolve(
        Some(named),
        &mut LaunchReport::already_reported(),
    ))
}

/// The [notice](super::MemoriesRuntime::notice) lines `fresh` deserves, from the point of view of the
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
    let mut latest: BTreeMap<String, MemoryNoticeEntry> = BTreeMap::new();
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
