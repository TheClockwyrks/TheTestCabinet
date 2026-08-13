//! **Memory scoping and linked instances**: which store an agent binds, who may write it, and what
//! each holder is told about what the others did.
//!
//! Everything here is about one [`MemoryStore`] with more than
//! one [`MemoriesRuntime`] over it. That is what the whole file tests the
//! consequences of — telemetry that must be attributed rather than drained, a notice that must
//! reach every holder *but* the author exactly once, a write permission that belongs to a holder
//! rather than to a store, and the four [scopes](MemoryScope) that decide which of those situations
//! an agent ends up in.
//!
//! The one thing that must **not** change is the pinned index, which is what the model reasons
//! about and what every provider caches; there is a test for that byte-for-byte.

use std::sync::Arc;

use serde_json::json;
use test_cabinet_core::gg::{
    CAPABILITY_MEMORIES, CAPABILITY_SUBAGENTS, GgAgentConfig, GgCapabilityConfig, GgCapabilitySet,
    GgSubagentRef, GgTelemetryKind, ROOT_AGENT,
};

use super::*;
use crate::board::BoardRuntime;
use crate::context::HeuristicTokenEstimator;
use crate::modules::{
    HistorySetup, InheritedModules, Module, ModuleIds, ModuleResolveCtx, detached_ids,
};
use crate::skills::SkillsRuntime;

/// Everything a resolve needs beyond the profile, owned by the caller so the borrows in
/// [`ModuleResolveCtx`] have somewhere to point.
struct World {
    skills: SkillsRuntime,
    board: BoardRuntime,
    registry: MemoryRegistry,
    /// One mint for the whole `World`, so two holders resolved through it are comparable exactly
    /// as two holders in one run are.
    ids: ModuleIds,
}

impl World {
    fn new() -> Self {
        Self {
            skills: SkillsRuntime::disabled(),
            board: BoardRuntime::disabled(),
            registry: MemoryRegistry::new(),
            ids: detached_ids(),
        }
    }

    /// The resolve context for the agent instance `agent_id`, offered `inherited` by its spawner.
    fn ctx<'a>(
        &'a self,
        agent_id: &'a str,
        inherited: &'a InheritedModules,
    ) -> ModuleResolveCtx<'a> {
        self.ctx_in_run(agent_id, inherited, false)
    }

    /// The same, in a run where `inheritable` says some declared profile takes its memories from
    /// its spawner — the run-level fact a holder's own scope cannot see.
    fn ctx_in_run<'a>(
        &'a self,
        agent_id: &'a str,
        inherited: &'a InheritedModules,
        inheritable: bool,
    ) -> ModuleResolveCtx<'a> {
        ModuleResolveCtx {
            skills: &self.skills,
            board: &self.board,
            memories: &self.registry,
            inherited,
            inheritable,
            history: HistorySetup {
                estimator: Arc::new(HeuristicTokenEstimator),
                window_limit: None,
                program_language: None,
            },
            agent_id,
            ids: &self.ids,
        }
    }
}

/// A profile named `name` whose memories capability is on, organized by `strategy` and scoped by
/// `scope` — the one configuration every test here varies.
fn profile(name: &str, strategy: MemoryStrategy, scope: MemoryScope) -> GgAgentConfig {
    GgAgentConfig {
        name: name.to_string(),
        capabilities: vec![GgCapabilityConfig {
            id: CAPABILITY_MEMORIES.to_string(),
            enabled: true,
            implementation: Some(strategy.id().to_string()),
            params: json!({ "scope": scope.as_str() }),
        }],
        ..GgAgentConfig::root()
    }
}

/// A scratchpad profile — the strategy most of these tests use, because its notice carries bodies
/// and its block is the memories themselves.
fn scratchpad(name: &str, scope: MemoryScope) -> GgAgentConfig {
    profile(name, MemoryStrategy::Scratchpad, scope)
}

/// Resolve `profile`'s memories for the agent instance `agent_id`, inheriting nothing.
fn resolve_alone(world: &World, profile: &GgAgentConfig, agent_id: &str) -> MemoriesRuntime {
    let nothing = InheritedModules::default();
    MemoriesRuntime::resolve(profile, &world.ctx(agent_id, &nothing))
}

/// Resolve `profile`'s memories for `agent_id`, spawned by an agent holding `spawner`.
fn resolve_under(
    world: &World,
    profile: &GgAgentConfig,
    agent_id: &str,
    spawner: &MemoriesRuntime,
) -> MemoriesRuntime {
    let offered = InheritedModules {
        memories: Some(spawner.shared()),
    };
    MemoriesRuntime::resolve(profile, &world.ctx(agent_id, &offered))
}

/// Write one memory through `holder`'s own binding, so the log records it as that holder's work —
/// exactly as a tool call from that agent would.
fn write_as(holder: &MemoriesRuntime, name: &str, body: &str) {
    let binding = holder.binding();
    binding
        .lock()
        .write(
            binding.author(),
            name,
            &format!("about {name}"),
            body,
            MemoryCode::default(),
        )
        .expect("the write is within the caps");
}

/// The `MemoryRevision` names in `events`, in order — what a holder actually streamed.
fn revised(events: &[GgTelemetryKind]) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| match event {
            GgTelemetryKind::MemoryRevision { name, .. } => Some(name.clone()),
            _ => None,
        })
        .collect()
}

/// The `(scope, writable)` a holder's state snapshot reports.
fn state_facets(holder: &MemoriesRuntime) -> (String, bool) {
    match holder.state_event().expect("an enabled holder has a state") {
        GgTelemetryKind::MemoryState {
            scope, writable, ..
        } => (scope, writable),
        other => panic!("expected a MemoryState, got {other:?}"),
    }
}

/// Whether two holders are holders of the *same* store, which is the whole question every scoping
/// test is really asking.
fn same_store(a: &MemoriesRuntime, b: &MemoriesRuntime) -> bool {
    Arc::ptr_eq(&a.store(), &b.store())
}

// ---------------------------------------------------------------------------
// The four scopes, across the spawn matrix
// ---------------------------------------------------------------------------

/// `isolated` is what memories always were: an instance per agent instance, however the agent was
/// spawned and whatever its spawner holds.
#[test]
fn isolated_gives_every_instance_its_own_store() {
    let world = World::new();
    let config = scratchpad("Solo", MemoryScope::Isolated);

    let root = resolve_alone(&world, &config, "agent-0");
    let second = resolve_alone(&world, &config, "agent-1");
    let child = resolve_under(&world, &config, "agent-2", &root);

    assert!(
        !same_store(&root, &second),
        "two top-level instances differ"
    );
    assert!(
        !same_store(&root, &child),
        "a subagent's is its own, even under a spawner holding one"
    );
    write_as(&root, "plan", "the plan");
    assert_eq!(child.count(), 0, "nothing crosses between them");
}

/// `shared` binds the **profile**, not the instance: every instance of one profile — including two
/// running at the same time, which is the case the scope exists for — is a holder of one store.
#[test]
fn shared_binds_one_store_per_profile_across_parallel_instances() {
    let world = World::new();
    let config = scratchpad("Curator", MemoryScope::Shared);

    let first = resolve_alone(&world, &config, "agent-0");
    let second = resolve_alone(&world, &config, "agent-1");
    assert!(same_store(&first, &second), "one store per profile");

    // What either writes, the other holds. Neither is a copy taken at spawn.
    write_as(&first, "plan", "the plan");
    write_as(&second, "layout", "the layout");
    assert_eq!(first.count(), 2);
    assert_eq!(second.count(), 2);

    // A *different* profile scoped the same way gets its own entry: the registry is keyed by
    // profile, which is what "shared" names.
    let other = resolve_alone(&world, &scratchpad("Other", MemoryScope::Shared), "agent-2");
    assert!(!same_store(&first, &other));
    assert_eq!(other.count(), 0);
}

/// `inherited` binds the spawner's instance when there is a spawner, and a fresh one otherwise —
/// which is what makes the same profile usable as a run's root and as a subagent.
#[test]
fn inherited_binds_the_spawners_instance_only_when_spawned() {
    let world = World::new();
    let config = scratchpad("Helper", MemoryScope::Inherited);

    // No spawner (the root, an issue's implementer, a detached reviewer): its own notebook.
    let top = resolve_alone(&world, &config, "agent-0");
    let other_top = resolve_alone(&world, &config, "agent-1");
    assert!(!same_store(&top, &other_top));

    // Spawned: the spawner's, read/write.
    write_as(&top, "plan", "the plan");
    let child = resolve_under(&world, &config, "agent-2", &top);
    assert!(same_store(&top, &child));
    assert_eq!(child.count(), 1, "it starts holding what its spawner holds");
    assert!(child.is_writable());
}

/// Inheritance **chains**: a subagent of a subagent holds the instance the top of the chain
/// created, because a holder offers what it holds rather than what it made.
#[test]
fn inheritance_spans_several_levels() {
    let world = World::new();
    let config = scratchpad("Helper", MemoryScope::Inherited);

    let top = resolve_alone(&world, &config, "agent-0");
    let child = resolve_under(&world, &config, "agent-1", &top);
    let grandchild = resolve_under(&world, &config, "agent-2", &child);
    let great = resolve_under(&world, &config, "agent-3", &grandchild);

    assert!(same_store(&top, &great), "four levels, one store");
    write_as(&great, "deep", "written at the bottom");
    assert_eq!(top.count(), 1, "and it reaches the top");
}

/// `read-only` restricts an **inherited handle**, and nothing else. An agent that ends up with an
/// instance of its own may write it: a private notebook nobody may write is not a feature.
#[test]
fn read_only_restricts_an_inherited_handle_and_nothing_else() {
    let world = World::new();
    let config = scratchpad("Reader", MemoryScope::ReadOnly);

    let top = resolve_alone(&world, &config, "agent-0");
    assert!(
        top.is_writable(),
        "a fresh instance under read-only is its holder's to write"
    );

    let owner = resolve_alone(
        &world,
        &scratchpad("Owner", MemoryScope::Inherited),
        "agent-1",
    );
    let reader = resolve_under(&world, &config, "agent-2", &owner);
    assert!(same_store(&owner, &reader));
    assert!(!reader.is_writable(), "an inherited handle is read-only");
}

/// Write access is a property of the **holder**, so a read-only agent's own `inherited` subagent
/// gets a read/write handle onto the very same store. This is the requirement stated exactly.
#[test]
fn an_inherited_child_of_a_read_only_holder_regains_write_access() {
    let world = World::new();
    let owner = resolve_alone(
        &world,
        &scratchpad("Owner", MemoryScope::Inherited),
        "agent-0",
    );
    let reader = resolve_under(
        &world,
        &scratchpad("Reader", MemoryScope::ReadOnly),
        "agent-1",
        &owner,
    );
    let writer = resolve_under(
        &world,
        &scratchpad("Writer", MemoryScope::Inherited),
        "agent-2",
        &reader,
    );

    assert!(!reader.is_writable());
    assert!(writer.is_writable(), "the child's own scope decides");
    assert!(same_store(&owner, &writer), "and it is still one store");

    write_as(&writer, "found", "what the reader could not record");
    assert_eq!(owner.count(), 1, "the write lands in the shared store");
}

/// A store is read by the calls its own strategy offers, so a child organizing memories differently
/// from its spawner gets an instance of its own rather than one it cannot read.
#[test]
fn inheritance_is_refused_across_a_strategy_mismatch() {
    let world = World::new();
    let spawner = resolve_alone(
        &world,
        &profile("Owner", MemoryStrategy::Scratchpad, MemoryScope::Inherited),
        "agent-0",
    );
    write_as(&spawner, "plan", "the plan");

    let child = resolve_under(
        &world,
        &profile("Indexer", MemoryStrategy::Markdown, MemoryScope::Inherited),
        "agent-1",
        &spawner,
    );
    assert!(!same_store(&spawner, &child));
    assert_eq!(child.count(), 0);
    assert!(child.is_writable(), "its own notebook is its own to write");
}

/// An unrecognized `scope` falls back to `isolated` and warns rather than failing the launch — the
/// standing rule for an unrecognized capability *value*.
#[test]
fn an_unreadable_scope_falls_back_to_isolated_with_a_warning() {
    let mut config = scratchpad("Solo", MemoryScope::Isolated);
    config.capabilities[0].params = json!({ "scope": "communal" });
    let (scope, warning) = resolve_scope(&config);
    assert_eq!(scope, MemoryScope::Isolated);
    let warning = warning.expect("an unreadable value is reported");
    assert!(warning.contains("communal"), "{warning}");
    assert!(warning.contains("`isolated`"), "{warning}");

    // And a non-string is refused the same way rather than coerced.
    config.capabilities[0].params = json!({ "scope": 3 });
    assert_eq!(resolve_scope(&config).0, MemoryScope::Isolated);
    assert!(resolve_scope(&config).1.is_some());
}

/// The launch validations: a scope gg cannot read, a scope on an agent with no memories, and an
/// inheriting child whose spawner organizes memories differently.
#[test]
fn launch_warnings_report_a_scoping_gg_cannot_honour() {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    // The root inherits from nobody but may spawn `Indexer`, which organizes memories differently.
    set.agents[0] = GgAgentConfig {
        subagents: vec![GgSubagentRef::any("Indexer")],
        ..profile(
            ROOT_AGENT,
            MemoryStrategy::Scratchpad,
            MemoryScope::Inherited,
        )
    };
    set.agents.push(profile(
        "Indexer",
        MemoryStrategy::Markdown,
        MemoryScope::Inherited,
    ));
    // A third agent asks for a scope with the capability turned off entirely.
    let mut scopeless = profile("Ghost", MemoryStrategy::Scratchpad, MemoryScope::Shared);
    scopeless.capabilities[0].enabled = false;
    set.agents.push(scopeless);
    // And a fourth names a scope gg does not know.
    let mut typo = scratchpad("Typo", MemoryScope::Isolated);
    typo.capabilities[0].params = json!({ "scope": "communal" });
    set.agents.push(typo);

    let warnings = launch_warnings(&set);
    assert!(
        warnings
            .iter()
            .any(|w| w.contains("Typo") && w.contains("communal")),
        "the unreadable value is named: {warnings:?}"
    );
    assert!(
        warnings
            .iter()
            .any(|w| w.contains("Ghost") && w.contains("is not enabled")),
        "a scope with memories off is reported: {warnings:?}"
    );
    assert!(
        warnings
            .iter()
            .any(|w| w.contains("Indexer") && w.contains("markdown")),
        "the strategy mismatch is reported: {warnings:?}"
    );
}

// ---------------------------------------------------------------------------
// Telemetry attribution
// ---------------------------------------------------------------------------

/// Two holders of one store each report **their own** writes, and only theirs. A write is one
/// event, on the stream of the agent that made it, however many agents hold the store it landed in.
#[test]
fn each_holder_streams_only_the_revisions_it_authored() {
    let world = World::new();
    let config = scratchpad("Curator", MemoryScope::Shared);
    let mut first = resolve_alone(&world, &config, "agent-0");
    let mut second = resolve_alone(&world, &config, "agent-1");

    write_as(&first, "plan", "the plan");
    write_as(&second, "layout", "the layout");

    let from_first = first.drain_events();
    let from_second = second.drain_events();
    assert_eq!(revised(&from_first), vec!["plan".to_string()]);
    assert_eq!(revised(&from_second), vec!["layout".to_string()]);
}

/// A holder whose *sibling* wrote still re-emits its state snapshot — its panel changed — while
/// reporting no revision of its own, because the write was not its work.
#[test]
fn a_siblings_write_re_emits_the_snapshot_without_claiming_the_revision() {
    let world = World::new();
    let config = scratchpad("Curator", MemoryScope::Shared);
    let mut author = resolve_alone(&world, &config, "agent-0");
    let mut bystander = resolve_alone(&world, &config, "agent-1");
    // Both start current, so the drains below are only about what happens next.
    author.drain_events();
    bystander.drain_events();

    write_as(&author, "plan", "the plan");
    let seen = bystander.drain_events();
    assert!(revised(&seen).is_empty(), "it claims no revision");
    assert_eq!(seen.len(), 1, "but it does re-emit its state: {seen:?}");
    assert!(matches!(seen[0], GgTelemetryKind::MemoryState { .. }));

    // And a second drain, with nothing new, says nothing at all.
    assert!(bystander.drain_events().is_empty());
}

/// Each holder's watermark is its own: one draining does not consume another's news, which is
/// exactly what the destructive queue this replaced could not do.
#[test]
fn draining_one_holder_leaves_another_holders_cursor_alone() {
    let world = World::new();
    let config = scratchpad("Curator", MemoryScope::Shared);
    let mut first = resolve_alone(&world, &config, "agent-0");
    let mut second = resolve_alone(&world, &config, "agent-1");

    write_as(&first, "plan", "the plan");
    assert_eq!(revised(&first.drain_events()), vec!["plan".to_string()]);
    // The second holder has not looked yet; the first's drain did not take its turn away.
    let seen = second.drain_events();
    assert!(revised(&seen).is_empty(), "the write was not its own");
    assert_eq!(seen.len(), 1, "but the snapshot is still owed to it");
}

/// The snapshot says **how** its emitter holds the store, so the console can tell one shared store
/// from two that happen to agree, and a read-only handle from a writable one.
#[test]
fn the_state_snapshot_carries_the_holders_scope_and_access() {
    let world = World::new();
    let owner = resolve_alone(
        &world,
        &scratchpad("Owner", MemoryScope::Inherited),
        "agent-0",
    );
    let reader = resolve_under(
        &world,
        &scratchpad("Reader", MemoryScope::ReadOnly),
        "agent-1",
        &owner,
    );

    assert_eq!(state_facets(&owner), ("inherited".to_string(), true));
    assert_eq!(state_facets(&reader), ("read-only".to_string(), false));
    assert_eq!(
        state_facets(&resolve_alone(
            &world,
            &scratchpad("Solo", MemoryScope::Isolated),
            "agent-2"
        )),
        ("isolated".to_string(), true)
    );
}

/// The **same holder** reached from the sandbox's blocking thread is not a second one: an alias
/// shares the watermarks, so a memory a program wrote is streamed once rather than once by the
/// program and again by the loop that reclaimed its state.
#[test]
fn an_alias_is_the_same_holder_and_not_a_second_one() {
    let world = World::new();
    let mut holder = resolve_alone(
        &world,
        &scratchpad("Solo", MemoryScope::Isolated),
        "agent-0",
    );
    let mut on_thread = holder.alias();

    write_as(&on_thread, "plan", "the plan");
    assert_eq!(revised(&on_thread.drain_events()), vec!["plan".to_string()]);
    assert!(
        holder.drain_events().is_empty(),
        "the loop's handle does not re-stream what the program already did"
    );
}

/// A [fork](MemoriesRuntime::forked) is an independent notebook: it starts holding a copy, the two
/// diverge from there, and the copy re-reports none of the history it arrived with.
#[test]
fn a_fork_diverges_and_re_reports_nothing() {
    let world = World::new();
    let mut original = resolve_alone(
        &world,
        &scratchpad("Solo", MemoryScope::Isolated),
        "agent-0",
    );
    write_as(&original, "plan", "the plan");

    let mut copy = original.forked().with_agent("agent-1");
    assert_eq!(copy.count(), 1, "it starts with what the original held");
    assert!(!same_store(&original, &copy));
    assert!(
        copy.drain_events().is_empty(),
        "the copy re-reports none of the history it arrived with"
    );
    // The original's own undrained write is still its own to report.
    assert_eq!(revised(&original.drain_events()), vec!["plan".to_string()]);

    write_as(&copy, "detour", "only in the copy");
    assert_eq!(original.count(), 1, "they have diverged");
}

// ---------------------------------------------------------------------------
// The notice
// ---------------------------------------------------------------------------

/// The headline: a linked write reaches every *other* holder, once, naming the memory and its
/// description so the reader can decide whether to look.
#[test]
fn a_linked_write_notices_every_other_holder_exactly_once() {
    let world = World::new();
    let config = profile("Curator", MemoryStrategy::Markdown, MemoryScope::Shared);
    let mut author = resolve_alone(&world, &config, "agent-0");
    let mut reader = resolve_alone(&world, &config, "agent-1");

    write_as(
        &author,
        "deploy-runbook",
        "how the staging cluster is rolled",
    );

    let notice = reader
        .notice()
        .expect("the reader is told")
        .content
        .unwrap_or_default();
    assert!(notice.contains("deploy-runbook"), "{notice}");
    assert!(notice.contains("about deploy-runbook"), "{notice}");
    assert!(notice.contains("added"), "{notice}");
    assert!(
        notice.contains("`read_memory`"),
        "a file-shaped strategy points at its read call:\n{notice}"
    );

    assert!(
        reader.notice().is_none(),
        "news already delivered is not delivered again"
    );
    assert!(
        author.notice().is_none(),
        "and a holder is never told about its own write"
    );
}

/// One line per **memory**, not one per write: a sibling that writes and then twice revises the
/// same note produces one line saying what it now says.
#[test]
fn the_notice_collapses_a_memorys_writes_into_one_line() {
    let world = World::new();
    let config = profile("Curator", MemoryStrategy::Markdown, MemoryScope::Shared);
    let author = resolve_alone(&world, &config, "agent-0");
    let mut reader = resolve_alone(&world, &config, "agent-1");

    let binding = author.binding();
    binding
        .lock()
        .create(
            binding.author(),
            "api",
            "first pass",
            "one",
            MemoryCode::default(),
        )
        .unwrap();
    binding
        .lock()
        .edit(binding.author(), "api", "one", "two")
        .unwrap();
    binding
        .lock()
        .create(
            binding.author(),
            "layout",
            "the layout",
            "grid",
            MemoryCode::default(),
        )
        .unwrap();

    let notice = reader
        .notice()
        .expect("the reader is told")
        .content
        .unwrap_or_default();
    assert_eq!(
        notice.matches("`api`").count(),
        1,
        "one line for the memory, not one per write:\n{notice}"
    );
    assert!(
        notice.contains("updated `api`"),
        "and it reports where the memory ended up:\n{notice}"
    );
    assert!(notice.contains("added `layout`"), "{notice}");
}

/// A deletion is reported too — acting on a memory that has since been deleted is the failure the
/// notice exists to prevent — and it wins over anything earlier in the same batch.
#[test]
fn the_notice_reports_a_deletion_and_lets_it_win() {
    let world = World::new();
    let config = profile("Curator", MemoryStrategy::Markdown, MemoryScope::Shared);
    let author = resolve_alone(&world, &config, "agent-0");
    let mut reader = resolve_alone(&world, &config, "agent-1");

    let binding = author.binding();
    binding
        .lock()
        .create(
            binding.author(),
            "scratch",
            "notes",
            "throwaway",
            MemoryCode::default(),
        )
        .unwrap();
    binding.lock().delete(binding.author(), "scratch").unwrap();

    let notice = reader
        .notice()
        .expect("the reader is told")
        .content
        .unwrap_or_default();
    assert!(notice.contains("deleted `scratch`"), "{notice}");
    assert!(!notice.contains("added `scratch`"), "{notice}");
}

/// Under the scratchpad there is no read call — its memories *are* the pinned block — so the notice
/// carries the bodies inline rather than pointing at a call the agent does not have.
#[test]
fn the_scratchpad_notice_carries_bodies_instead_of_a_read_call() {
    let world = World::new();
    let config = scratchpad("Curator", MemoryScope::Shared);
    let author = resolve_alone(&world, &config, "agent-0");
    let mut reader = resolve_alone(&world, &config, "agent-1");

    write_as(&author, "plan", "beat the boss with the grapple");

    let notice = reader
        .notice()
        .expect("the reader is told")
        .content
        .unwrap_or_default();
    assert!(
        notice.contains("beat the boss with the grapple"),
        "the body is carried:\n{notice}"
    );
    assert!(
        !notice.contains("read_memory"),
        "and no call it does not have is named:\n{notice}"
    );
}

/// A new holder starts at the store's head: it is not handed a backlog of everything that happened
/// before it existed, which would be its first turn's whole window.
#[test]
fn a_new_holder_is_not_told_about_history_it_never_missed() {
    let world = World::new();
    let config = scratchpad("Curator", MemoryScope::Shared);
    let author = resolve_alone(&world, &config, "agent-0");
    write_as(&author, "plan", "the plan");
    write_as(&author, "layout", "the layout");

    let mut latecomer = resolve_alone(&world, &config, "agent-1");
    assert_eq!(latecomer.count(), 2, "it holds the memories");
    assert!(
        latecomer.notice().is_none(),
        "but is told about none of them as news"
    );
}

/// **The index must not move.** The notice is strictly additive: the pinned block a holder renders
/// is byte-identical whether or not it is also owed a notice, which is what keeps the cached prompt
/// prefix intact on a turn where only a sibling wrote.
#[test]
fn the_pinned_block_is_byte_identical_with_and_without_a_pending_notice() {
    let world = World::new();
    let config = profile("Curator", MemoryStrategy::Markdown, MemoryScope::Shared);
    let author = resolve_alone(&world, &config, "agent-0");
    let mut reader = resolve_alone(&world, &config, "agent-1");
    write_as(&author, "plan", "the plan");

    // Both holders see the same store, so the index they render is the same text. Take the
    // reader's *before* it is told anything...
    let before = reader
        .context_block()
        .expect("an index with a memory in it")
        .content
        .clone()
        .unwrap_or_default();
    // ...then again after the notice it is owed has been produced and consumed.
    let notice_text = reader
        .notice()
        .expect("a notice is owed")
        .content
        .unwrap_or_default();
    let after = reader
        .context_block()
        .expect("an index with a memory in it")
        .content
        .clone()
        .unwrap_or_default();

    assert_eq!(
        before, after,
        "the notice changed the index; it must be purely additive"
    );
    assert_eq!(
        before,
        author
            .context_block()
            .expect("the author's index")
            .content
            .clone()
            .unwrap_or_default(),
        "and both holders of one store render one index"
    );
    assert!(
        !before.contains(&notice_text),
        "the notice is its own message, not part of the block"
    );
}

/// The watermark is not rewound by a compaction. A boundary rebuilds the pinned block *before* it
/// sweeps the ephemeral history, so everything a notice announced crosses in the block; re-issuing
/// the notice afterwards would tell the model twice about a memory it may already have read.
#[test]
fn a_delivered_notice_is_not_re_issued_after_the_block_is_rebuilt() {
    let world = World::new();
    let config = profile("Curator", MemoryStrategy::Markdown, MemoryScope::Shared);
    let author = resolve_alone(&world, &config, "agent-0");
    let mut reader = resolve_alone(&world, &config, "agent-1");

    write_as(&author, "plan", "the plan");
    assert!(reader.notice().is_some());

    // The boundary: the block is rebuilt from the store, carrying the memory across.
    let rebuilt = reader
        .context_block()
        .expect("the rebuilt index")
        .content
        .unwrap_or_default();
    assert!(rebuilt.contains("plan"), "{rebuilt}");
    assert!(
        reader.notice().is_none(),
        "and the news is not announced a second time"
    );
}

// ---------------------------------------------------------------------------
// What the store keeps
// ---------------------------------------------------------------------------

/// **The revision log forgets what every live holder has read past.**
///
/// A cursor is an absolute position, so an entry below the earliest cursor of every live holder can
/// never be streamed or announced again. Keeping it anyway would make a working notebook edited for
/// hours retain a full copy of every wording each memory ever had, for a reader that cannot exist —
/// so the store drops the prefix and keeps counting from where it was.
#[test]
fn the_revision_log_forgets_what_every_holder_has_read_past() {
    let world = World::new();
    let config = profile("Curator", MemoryStrategy::Markdown, MemoryScope::Shared);
    let mut author = resolve_alone(&world, &config, "agent-0");
    let mut reader = resolve_alone(&world, &config, "agent-1");

    for n in 0..5 {
        write_as(&author, &format!("note-{n}"), "a body");
    }
    let store = author.store();
    assert_eq!(
        store.lock().expect("memory store lock").log_len(),
        5,
        "the head counts every mutation the store has taken"
    );
    assert!(
        store.lock().expect("memory store lock").log_from(0).len() >= 5,
        "and nothing is dropped while both holders are still behind it"
    );

    // Both holders catch up: the author streams its own writes, the reader is told about them.
    author.revision_events();
    reader.revision_events();
    reader.notice();
    author.notice();
    // Only a mutation can prune, because only a mutation can make an entry unreachable.
    write_as(&author, "note-5", "a body");

    let store = store.lock().expect("memory store lock");
    assert_eq!(
        store.log_len(),
        6,
        "the head keeps counting past what was pruned — a cursor is compared against it"
    );
    assert_eq!(
        store.log_from(5).len(),
        1,
        "the entry neither holder has seen is still there"
    );
    assert!(
        store.log_from(0).len() < 6,
        "and the ones both have read past are gone"
    );
}

/// A store nobody holds keeps its whole log: it is either being driven directly (a test) or is a
/// registry entry between two instances of a profile, and the next holder to arrive would otherwise
/// find a record with a hole in it.
#[test]
fn a_store_with_no_holders_forgets_nothing() {
    let mut store = MemoryStore::new(MemoryStrategy::Scratchpad, MemoryCaps::default());
    for n in 0..4 {
        store
            .write(
                "nobody",
                &format!("note-{n}"),
                "a description",
                "a body",
                MemoryCode::default(),
            )
            .expect("the write is within the caps");
    }

    assert_eq!(store.log_from(0).len(), 4);
    assert_eq!(store.log_len(), 4);
}

// ---------------------------------------------------------------------------
// What a holder is told about being linked
// ---------------------------------------------------------------------------

/// **A spawner is told its memories may be shared even when its own scope is `isolated`.**
///
/// Inheritance is an offer the *spawner* makes, whatever its own scope: a root scoped `isolated`
/// still hands its store to a child scoped `inherited`, and it is that child's write the root is
/// then told about in a mid-thread notice. Deriving the prompt's warning from the holder's own
/// scope alone left the one agent that receives such a notice as the one agent never warned it
/// could.
#[test]
fn a_spawner_is_told_its_isolated_memories_may_still_be_shared() {
    let world = World::new();
    let nothing = InheritedModules::default();

    // A profile that can spawn, in a run where somebody inherits.
    let mut delegating = scratchpad("Lead", MemoryScope::Isolated);
    delegating
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS));
    let lead = MemoriesRuntime::resolve(&delegating, &world.ctx_in_run("agent-0", &nothing, true));
    assert!(
        lead.is_linked(),
        "an agent that can spawn an inheriting child may end up sharing its notebook"
    );
    assert!(
        !lead.is_linkable(),
        "its own binding still links it to nobody, so a fork of it still gets a private copy"
    );

    // The same run, for an agent that cannot spawn: nothing can ever take its store.
    let solitary = scratchpad("Worker", MemoryScope::Isolated);
    let worker = MemoriesRuntime::resolve(&solitary, &world.ctx_in_run("agent-1", &nothing, true));
    assert!(!worker.is_linked());

    // And a run in which nobody inherits at all: the spawner is told nothing either.
    let lead_alone =
        MemoriesRuntime::resolve(&delegating, &world.ctx_in_run("agent-2", &nothing, false));
    assert!(!lead_alone.is_linked());
}

/// The run-level half of that answer is read off the whole capability set, once, at launch: does
/// any profile take its memories from its spawner?
#[test]
fn a_run_knows_whether_any_profile_inherits_memories() {
    let inheriting = GgCapabilitySet {
        agents: vec![
            scratchpad("Lead", MemoryScope::Isolated),
            scratchpad("Worker", MemoryScope::Inherited),
        ],
        ..GgCapabilitySet::default()
    };
    assert!(crate::memories::run_inherits_memories(&inheriting));

    let read_only = GgCapabilitySet {
        agents: vec![scratchpad("Worker", MemoryScope::ReadOnly)],
        ..GgCapabilitySet::default()
    };
    assert!(crate::memories::run_inherits_memories(&read_only));

    let nobody = GgCapabilitySet {
        agents: vec![
            scratchpad("Lead", MemoryScope::Isolated),
            scratchpad("Notebook", MemoryScope::Shared),
        ],
        ..GgCapabilitySet::default()
    };
    assert!(!crate::memories::run_inherits_memories(&nobody));
}
