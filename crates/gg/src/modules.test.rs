//! The [module model](super): the two copy semantics, and transfer.
//!
//! Every assertion here is about a rule the loop *relies* on but cannot state: that the board
//! contributes nothing to the prompt while staying live, that a fork and its original diverge,
//! that two shared handles are one store, and that a module handed to a different profile is
//! re-resolved against the profile receiving it rather than the one that produced it.

use std::sync::Arc;

use serde_json::json;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_MEMORIES, CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_SKILLS, CAPABILITY_TASKS, GgAgentConfig, GgCapabilityConfig, GgContextSource,
    GgModuleDisposition, GgTelemetryKind, MEMORY_PARAM_SCOPE,
};

use super::*;
use crate::board::{BoardCaps, BoardRuntime};
use crate::context::HeuristicTokenEstimator;
use crate::memories::{
    MemoriesRuntime, MemoryCaps, MemoryCode, MemoryRegistry, MemoryScope, MemoryStrategy,
};
use crate::skills::{SkillLibrary, SkillsRuntime};
use crate::tasks::{StructuredFields, TaskMode, TasksRuntime};

/// The window setup every set in these tests is built over — the heuristic estimator (no BPE
/// tables to load) and no window limit, since none of these assertions is about fullness.
fn history_setup() -> HistorySetup {
    HistorySetup {
        estimator: Arc::new(HeuristicTokenEstimator),
        window_limit: None,
        program_language: None,
    }
}

/// A one-skill library, so a skills module has something to offer and something to read.
fn library(dir: &std::path::Path) -> Arc<SkillLibrary> {
    std::fs::write(
        dir.join("guide.md"),
        "---\nname: guide\ndescription: how the thing is done.\n---\nthe body of the guide.",
    )
    .expect("the fixture skill is written");
    Arc::new(SkillLibrary::loaded(dir))
}

/// The resolve context these tests build sets against: a skills runtime, a run-global board, and
/// one agent id.
fn ctx<'a>(
    skills: &'a SkillsRuntime,
    board: &'a BoardRuntime,
    memories: &'a MemoryRegistry,
    inherited: &'a InheritedModules,
    ids: &'a ModuleIds,
) -> ModuleResolveCtx<'a> {
    ModuleResolveCtx {
        skills,
        board,
        memories,
        inherited,
        inheritable: false,
        history: history_setup(),
        agent_id: "agent-1",
        ids,
    }
}

/// The two run-global inputs a set is resolved against when nothing is shared and nothing is
/// inherited — which is every test in this file, since scoping is `memories.scope.test.rs`'s
/// subject and these tests are about the module model around it.
fn plain() -> (MemoryRegistry, InheritedModules, ModuleIds) {
    (
        MemoryRegistry::new(),
        InheritedModules::default(),
        detached_ids(),
    )
}

/// A profile enabling `capabilities`, each **fully specified**: the arm and params the
/// [authoring catalog](test_cabinet_core::gg::gg_authoring_catalog) writes, with the given params'
/// own keys written over them.
///
/// Authored rather than bare, because a bare capability is not a document gg would launch: an
/// enabled capability states every param it requires, and a test whose profile was short of one
/// would be asserting against a configuration that refuses its own launch. A test says the keys it
/// is about and inherits the rest.
fn profile_with(capabilities: Vec<(&str, serde_json::Value)>) -> GgAgentConfig {
    GgAgentConfig {
        capabilities: capabilities
            .into_iter()
            .map(|(id, params)| {
                let mut capability = GgCapabilityConfig::enabled(id);
                for (key, value) in params.as_object().expect("params is an object") {
                    capability = capability.with_param(key.as_str(), value.clone());
                }
                capability
            })
            .collect(),
        ..GgAgentConfig::root()
    }
}

/// The ceilings a board built **by hand** here carries: room for the one epic or issue each of
/// these tests files, since not one of them is about a ceiling.
///
/// Written out rather than resolved, because these boards have no capability behind them — a board
/// a test constructs is not a configured one, and the figures it is bounded by are this fixture's
/// rather than anything gg chose.
fn board_caps() -> BoardCaps {
    BoardCaps {
        max_epics: 10,
        max_issues: 10,
        max_retries: 1,
    }
}

/// Write one memory into `runtime`'s store, so a test has state to copy or carry.
fn write_memory(runtime: &MemoriesRuntime, name: &str) {
    runtime
        .store()
        .lock()
        .expect("memory store lock")
        .write("", name, "a description", "a body", MemoryCode::default())
        .expect("the write is within the caps");
}

/// Add one task to `runtime`'s list.
fn add_task(runtime: &TasksRuntime, id: &str) {
    runtime
        .store()
        .lock()
        .expect("task store lock")
        .add(
            id,
            "a title",
            None,
            StructuredFields {
                in_scope: None,
                out_of_scope: None,
                completion_criteria: None,
            },
            &[],
        )
        .expect("the task is within the cap");
}

// ---------------------------------------------------------------------------
// What reaches the prompt
// ---------------------------------------------------------------------------

/// **The board contributes no pinned block, ever.** It is reachable through its tools alone —
/// holding exactly the same contents, on the same schedule as every other uniform pass — so the
/// only every-turn block is the task list's.
///
/// Asserted through the same call prompt assembly makes — not through each runtime's own renderer
/// — because the point of the model is that the loop no longer names memories, tasks and the board
/// one at a time.
#[test]
fn the_board_contributes_no_pinned_block() {
    let tasks = TasksRuntime::new(10);
    add_task(&tasks, "t1");
    let board = BoardRuntime::new(board_caps());
    board
        .store()
        .lock()
        .expect("board store lock")
        .create_epic("api", "the API", "the API epic")
        .expect("the epic is within the caps");

    let modules = CapabilityModules::inert()
        .with(ModuleHandle::Tasks(tasks.shared()))
        .with(ModuleHandle::Board(board.shared()));
    let blocks = modules.pinned_blocks(Refresh::EveryTurn);
    assert_eq!(
        blocks.len(),
        1,
        "only the task list is refreshed every turn"
    );
    assert!(
        blocks
            .iter()
            .all(|(source, block)| block.is_some() && *source == GgContextSource::TaskList),
        "the task list renders a block on its own band, and the board renders nothing"
    );
    assert!(
        modules.board().context_block().is_none(),
        "a board with contents still shows nothing"
    );
}

/// **`ownership` is not a key gg reads, on any capability.** The owned mode — rebuilding a
/// module's state into the window on a schedule and describing it in the system prompt — is gone,
/// so a configuration still carrying the key is refused rather than silently running without it.
#[test]
fn an_ownership_key_is_refused_on_every_capability() {
    for (capability, params) in [
        (CAPABILITY_TASKS, json!({ "ownership": "unowned" })),
        (
            CAPABILITY_PROJECT_MANAGEMENT,
            json!({ "ownership": "owned" }),
        ),
        (
            CAPABILITY_AGENT_MANAGED_CONTEXT,
            json!({ "ownership": "unowned" }),
        ),
    ] {
        let profile = profile_with(vec![(capability, params)]);
        let mut set = test_cabinet_core::gg::GgCapabilitySet::minimal("mock/echo");
        set.agents[0] = profile;
        assert!(
            crate::validate::refusal(&set)
                .expect_err("a key gg does not read is refused")
                .contains("ownership"),
            "{capability}"
        );
    }
}

// ---------------------------------------------------------------------------
// Copying
// ---------------------------------------------------------------------------

/// **A fork is independent.** Mutating either copy leaves the other exactly as it was — the property
/// an agent-level `fork` rests on, and the one a `#[derive(Clone)]` that sometimes meant "alias the
/// store" could not give.
#[test]
fn a_fork_is_independent_of_its_original() {
    let memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED);
    write_memory(&memories, "shared-history");
    let forked = memories.forked();

    assert_eq!(
        forked.count(),
        1,
        "a fork starts from everything the original held"
    );

    write_memory(&memories, "only-the-original");
    write_memory(&forked, "only-the-fork");
    assert_eq!(memories.count(), 2);
    assert_eq!(forked.count(), 2);
    let original: Vec<String> = memories
        .store()
        .lock()
        .expect("memory store lock")
        .memories()
        .iter()
        .map(|memory| memory.name().to_string())
        .collect();
    assert_eq!(original, ["only-the-original", "shared-history"]);

    // The same for the task list.
    let tasks = TasksRuntime::new(10);
    add_task(&tasks, "t1");
    let forked_tasks = tasks.forked();
    add_task(&forked_tasks, "t2");
    assert_eq!(tasks.count(), 1);
    assert_eq!(forked_tasks.count(), 2);
}

/// A fork carries the **revision numbering** forward rather than restarting it, so a slug written in
/// the copy continues the history the original wrote rather than claiming to be its first revision.
#[test]
fn a_fork_carries_the_revision_history() {
    let mut memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED);
    write_memory(&memories, "note");
    let _ = memories.drain_events();

    let mut forked = memories.forked();
    forked
        .store()
        .lock()
        .expect("memory store lock")
        .update("", "note", "a new description", "a new body", None)
        .expect("the update is within the caps");

    let revision = forked
        .drain_events()
        .into_iter()
        .find_map(|event| match event {
            GgTelemetryKind::MemoryRevision { revision, .. } => Some(revision),
            _ => None,
        })
        .expect("the update was recorded");
    assert_eq!(revision, 2, "the copy continues the slug's history");
}

/// **A share is one store seen twice.** A write through either handle is visible through the other —
/// the property linked memory and the run-global board rest on.
#[test]
fn a_share_is_the_same_store_through_two_handles() {
    let memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED);
    let linked = memories.shared();

    write_memory(&memories, "written-by-the-first");
    assert_eq!(linked.count(), 1, "the second handle sees it immediately");

    write_memory(&linked, "written-by-the-second");
    assert_eq!(memories.count(), 2, "and the first sees the second's write");

    // The board is *always* shared, even when a caller asks it to fork: two boards would each keep
    // their own issue counter and would both hand out the same identifier.
    let board = BoardRuntime::new(board_caps());
    let ModuleHandle::Board(copy) = board.fork() else {
        panic!("a board module forks into a board module");
    };
    board
        .store()
        .lock()
        .expect("board store lock")
        .create_epic("api", "the API", "the API epic")
        .expect("the epic is within the caps");
    assert_eq!(copy.epic_count(), 1, "a forked board is the same board");
}

/// A forked skills module keeps its own read set (it travels with a *copy* of the window the set
/// describes); a shared one keeps one read set between both holders (they are looking at one window,
/// and re-pinning a body already in it would duplicate it).
#[test]
fn a_skills_fork_copies_the_read_set_and_a_share_aliases_it() {
    let dir = tempfile::TempDir::new().unwrap();
    let mut skills = SkillsRuntime::new(library(dir.path()));
    skills.record_read("guide");

    let mut forked = skills.forked();
    assert_eq!(
        forked.read_count(),
        1,
        "the copy knows what was already read"
    );
    // A fresh library in the copy: reading it again in the copy is a repeat there, and the original
    // is untouched either way.
    assert_eq!(
        forked.record_read("guide"),
        crate::skills::ReadRecord::Repeat
    );
    assert_eq!(skills.read_count(), 1);

    let mut shared = skills.shared();
    let mut second = SkillsRuntime::new(library(dir.path()));
    second.record_read("guide");
    assert_eq!(
        shared.record_read("guide"),
        crate::skills::ReadRecord::Repeat
    );
    assert_eq!(
        shared.read_count(),
        skills.read_count(),
        "two shared holders agree on what is pinned in the one window they share"
    );
}

/// A fork does **not** duplicate telemetry the original has not yet drained: one write must be
/// reported once, on one stream, however many copies of the module exist.
#[test]
fn a_fork_does_not_duplicate_undrained_telemetry() {
    let mut memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED);
    write_memory(&memories, "note");

    let mut forked = memories.forked();
    assert!(
        forked.drain_events().is_empty(),
        "the copy owes nothing for a write it did not make"
    );

    let events = memories.drain_events();
    assert_eq!(
        events.len(),
        2,
        "the original still owes its revision and the snapshot after it"
    );
}

/// A window cannot be shared — the loop holds it `&mut` for a whole turn — so [`Module::share`]
/// falls back to an independent copy, and the copy's turn counter continues rather than restarting
/// (a model that read `Turn #37` must be naming the turns it saw).
#[test]
fn a_history_share_is_a_copy_that_keeps_its_turn_number() {
    let mut history = HistoryModule::new(&history_setup(), &detached_ids());
    history.context_mut().begin_turn(37);
    history.context_mut().push_user_prompt("the build prompt");

    let ModuleHandle::History(mut copy) = history.share() else {
        panic!("a history module shares into a history module");
    };
    assert_eq!(copy.context().messages().len(), 1);

    // The two diverge from here, and the copy keeps numbering where the original left off.
    history.context_mut().push_user_prompt("go");
    assert_eq!(copy.context().messages().len(), 1);
    copy.context_mut().push_user_prompt("go");
    assert_eq!(history.context().messages().len(), 2);
}

// ---------------------------------------------------------------------------
// Adoption and transfer
// ---------------------------------------------------------------------------

/// **Caps come from the receiving profile.** A module carrying limits resolved from the profile that
/// produced it is the classic transfer bug, and `adopt` is the one place they are re-read.
#[test]
fn adopting_re_resolves_the_caps_from_the_receiving_profile() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let ctx = ctx(&skills, &board, &registry, &inherited, &ids);

    let mut tasks = TasksRuntime::with_mode(3, TaskMode::Simple);
    add_task(&tasks, "t1");
    let receiver = profile_with(vec![(
        CAPABILITY_TASKS,
        json!({ "maxTasks": 40, "mode": "issues" }),
    )]);
    tasks.adopt(&receiver, &ctx).expect("tasks are adoptable");

    assert_eq!(tasks.max_tasks(), 40);
    assert_eq!(tasks.mode(), TaskMode::Issues);
    assert_eq!(tasks.count(), 1, "and the contents came with it");
}

/// Contents already over a newly-tightened cap are **kept**. Deleting work the run already paid for
/// because the successor's profile is stingier would lose exactly what the transfer was for.
#[test]
fn a_tightened_cap_keeps_what_is_already_there() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let ctx = ctx(&skills, &board, &registry, &inherited, &ids);

    let mut memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED);
    write_memory(&memories, "one");
    write_memory(&memories, "two");

    let receiver = profile_with(vec![(CAPABILITY_MEMORIES, json!({ "maxCount": 1 }))]);
    memories
        .adopt(&receiver, &ctx)
        .expect("memories are adoptable");

    assert_eq!(memories.count(), 2, "nothing was deleted");
    assert_eq!(memories.caps().max_count, Some(1));
    assert!(
        memories
            .store()
            .lock()
            .expect("memory store lock")
            .write("", "three", "d", "b", MemoryCode::default())
            .is_err(),
        "the next write is what the tightened cap refuses"
    );
}

/// **The receiving profile's limits are applied even though the outgoing agent's tools were still
/// holding the store.**
///
/// A holder hands its store to every memory tool it offers, as an `Arc` clone inside a
/// `MemoryBinding`, and those tools are alive right up to the moment the transfer runs. Deciding
/// "is this store one agent's?" by counting `Arc`s therefore always answered *no* in a real run,
/// and the caps a successor declared were silently never applied — the classic transfer bug this
/// module exists to prevent, hidden by a fixture that happened to hold no tools. The question is
/// asked of the store's registered **holders** instead.
#[test]
fn caps_are_re_resolved_even_while_the_tools_still_hold_the_store() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let ctx = ctx(&skills, &board, &registry, &inherited, &ids);

    let mut memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED);
    // Exactly what `ToolRegistry::from_run` does: one binding per memory tool, each an `Arc` clone.
    let bindings: Vec<_> = (0..3).map(|_| memories.binding()).collect();

    let receiver = profile_with(vec![(CAPABILITY_MEMORIES, json!({ "maxCount": 3 }))]);
    memories
        .adopt(&receiver, &ctx)
        .expect("memories are adoptable");

    assert_eq!(
        memories.caps().max_count,
        Some(3),
        "the successor's own limit is in force"
    );
    drop(bindings);
}

/// **A successor is not told that "another agent" wrote the memories it wrote itself.**
///
/// A [notice](crate::memories::MemoriesRuntime::notice) is anything in the log this holder did not
/// author, and a successor is a new holder under a new id — so a write the predecessor made in the
/// very turn it handed off would read, one turn later, as somebody else's work. Adoption re-points
/// both watermarks at the store's head, which is also what stops an *isolated* module (shared with
/// nobody, ever) producing a notice at all.
#[test]
fn an_adopted_module_is_not_handed_its_predecessors_unread_news() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let ctx = ctx(&skills, &board, &registry, &inherited, &ids);

    let mut memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED)
        .with_agent("agent-1");
    memories
        .binding()
        .lock()
        .write(
            "agent-1",
            "plan",
            "the plan",
            "the body",
            MemoryCode::default(),
        )
        .expect("the write is within the caps");

    let receiver = profile_with(vec![(CAPABILITY_MEMORIES, json!({}))]);
    memories
        .adopt(&receiver, &ctx)
        .expect("memories are adoptable");

    assert!(
        Module::notice(&mut memories).is_none(),
        "the successor is told nothing about writes it made under its previous id"
    );
    assert!(
        memories.revision_events().is_empty(),
        "and streams nothing its predecessor already streamed"
    );
}

/// **A successor scoped `shared` binds its own profile's instance, not the one it was handed.**
///
/// `shared` means *bound to the profile*: every instance of that profile in the run curates one
/// notebook. A successor that kept the store its predecessor passed it would leave one profile
/// curating two — the transferred one, and the one every other instance of it resolves — which is
/// the exact situation the scope exists to prevent.
#[test]
fn a_shared_successor_rebinds_the_instance_its_own_profile_keeps() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let ctx = ctx(&skills, &board, &registry, &inherited, &ids);

    // The instance the receiving profile already keeps, with a memory an earlier instance of it
    // wrote.
    let mut receiver = profile_with(vec![(
        CAPABILITY_MEMORIES,
        json!({ MEMORY_PARAM_SCOPE: MemoryScope::Shared.as_str() }),
    )]);
    receiver.name = "Notebook".to_string();
    let existing = MemoriesRuntime::resolve(&receiver, &ctx);
    existing
        .binding()
        .lock()
        .write(
            "agent-0",
            "house-style",
            "how we write",
            "the body",
            MemoryCode::default(),
        )
        .expect("the write is within the caps");

    // The predecessor's own, entirely separate, notebook.
    let mut carried = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED);
    write_memory(&carried, "predecessor-note");

    carried
        .adopt(&receiver, &ctx)
        .expect("memories are adopted");

    let held: Vec<String> = carried
        .binding()
        .lock()
        .memories()
        .iter()
        .map(|memory| memory.name().to_string())
        .collect();
    assert_eq!(
        held,
        vec!["house-style".to_string()],
        "the successor curates the profile's notebook, not the one it was handed"
    );
    assert_eq!(carried.scope(), MemoryScope::Shared);
}

/// A profile that does not enable the capability **refuses** the module: turning a capability off is
/// what "this agent does not get one" means.
#[test]
fn a_profile_that_disables_the_capability_refuses_the_module() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let ctx = ctx(&skills, &board, &registry, &inherited, &ids);

    let mut memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED);
    assert_eq!(
        memories.adopt(&profile_with(Vec::new()), &ctx),
        Err(AdoptError::Disabled)
    );
}

/// A **different memory strategy** is refused rather than converted: the strategy decides both what
/// the store means and which tools read it, so gg states the reset instead of silently changing
/// both.
#[test]
fn a_different_memory_strategy_is_refused_with_a_reason() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let ctx = ctx(&skills, &board, &registry, &inherited, &ids);

    let mut memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED);
    let mut receiver = profile_with(vec![(CAPABILITY_MEMORIES, json!({}))]);
    receiver.capabilities[0].implementation = Some("markdown".to_string());

    let Err(AdoptError::Incompatible(reason)) = memories.adopt(&receiver, &ctx) else {
        panic!("a strategy mismatch is an incompatibility, not a refusal to run");
    };
    assert!(
        reason.contains("scratchpad") && reason.contains("markdown"),
        "{reason}"
    );
}

/// An `exec`-shaped transfer: every kind **both** sides have is carried, one only the successor has
/// starts fresh, and one only the predecessor had is dropped.
#[test]
fn an_intersection_transfer_carries_drops_and_initializes() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();

    // The predecessor holds memories and a task list; the successor's profile keeps memories, adds
    // the archive, and drops tasks entirely.
    let old = ModuleSet::inert(&history_setup())
        .with(ModuleHandle::Memories(MemoriesRuntime::new(
            MemoryStrategy::Scratchpad,
            MemoryCaps::UNBOUNDED,
        )))
        .with(ModuleHandle::Tasks(TasksRuntime::new(10)));
    write_memory(old.caps().memories(), "carried");
    add_task(old.caps().tasks(), "dropped");

    let successor_profile = profile_with(vec![
        (CAPABILITY_MEMORIES, json!({})),
        (CAPABILITY_AGENT_MANAGED_CONTEXT, json!({})),
    ]);
    let (successor, report) = transfer(
        old,
        &successor_profile,
        &TransferPlan::Intersection,
        &ctx(&skills, &board, &registry, &inherited, &ids),
    );

    assert!(report.carried().contains(&ModuleKind::Memories));
    assert!(report.carried().contains(&ModuleKind::History));
    assert!(report.dropped().contains(&ModuleKind::Tasks));
    assert!(report.initialized().contains(&ModuleKind::Archive));

    assert_eq!(
        successor.caps().memories().count(),
        1,
        "the memories are the predecessor's, live"
    );
    assert_eq!(
        successor.caps().tasks().count(),
        0,
        "the dropped task list is gone, not merely hidden"
    );
    assert!(!successor.caps().tasks().offers_tasks());
    assert!(successor.caps().archive().offers_archive());
}

/// A machine transition's rule: **exactly** the named kinds are carried, and a kind the successor's
/// own profile enables but the list did not name starts fresh. That is the point of naming them.
#[test]
fn an_explicit_transfer_carries_only_what_it_names() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();

    let old = ModuleSet::inert(&history_setup())
        .with(ModuleHandle::Memories(MemoriesRuntime::new(
            MemoryStrategy::Scratchpad,
            MemoryCaps::UNBOUNDED,
        )))
        .with(ModuleHandle::Tasks(TasksRuntime::new(10)));
    write_memory(old.caps().memories(), "not-named");
    add_task(old.caps().tasks(), "named");

    let successor_profile = profile_with(vec![
        (CAPABILITY_MEMORIES, json!({})),
        (CAPABILITY_TASKS, json!({})),
    ]);
    let (successor, report) = transfer(
        old,
        &successor_profile,
        &TransferPlan::Explicit(vec![ModuleKind::Tasks]),
        &ctx(&skills, &board, &registry, &inherited, &ids),
    );

    assert_eq!(report.carried(), vec![ModuleKind::Tasks]);
    assert!(report.initialized().contains(&ModuleKind::Memories));
    assert!(
        report.initialized().contains(&ModuleKind::History),
        "a transition that does not carry history opens a fresh window"
    );
    assert_eq!(successor.caps().tasks().count(), 1);
    assert_eq!(
        successor.caps().memories().count(),
        0,
        "an unnamed module starts empty even where the successor enables it"
    );
}

/// A transfer list naming a module the outgoing agent never held is a **warning**, not a failure:
/// the transition's author asked for something the source state did not have, and gg says so rather
/// than silently carrying nothing.
/// **A transfer list naming a module the outgoing agent does not hold is gg's own defect.**
///
/// The successor was configured to continue with that module's state and would start with an empty
/// one, which downstream reads exactly like a state that chose to put nothing in it. The
/// statically decidable half — a kind the profiles on either side of the edge do not both enable —
/// refuses the launch, so a defect reaching here is gg reading one configuration two ways, and the
/// agent's loop (and the run) ends on it.
#[test]
fn a_transfer_list_naming_an_absent_module_is_a_defect() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let old = ModuleSet::inert(&history_setup());

    let (_, report) = transfer(
        old,
        &profile_with(Vec::new()),
        &TransferPlan::Explicit(vec![ModuleKind::Memories]),
        &ctx(&skills, &board, &registry, &inherited, &ids),
    );
    assert_eq!(report.defects.len(), 1, "{report:?}");
    assert!(report.defects[0].contains("`memories`"));
}

/// An incompatible carried module is dropped, **re-initialized**, and the reason is put where the
/// successor's opening note can state it — so a reset is something the model is told rather than
/// something it discovers.
#[test]
fn an_incompatible_module_is_reinitialized_with_a_stated_reason() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();

    let old = ModuleSet::inert(&history_setup()).with(ModuleHandle::Memories(
        MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED),
    ));
    write_memory(old.caps().memories(), "lost");

    let mut successor_profile = profile_with(vec![(CAPABILITY_MEMORIES, json!({}))]);
    successor_profile.capabilities[0].implementation = Some("keyword-search".to_string());

    let (successor, report) = transfer(
        old,
        &successor_profile,
        &TransferPlan::Intersection,
        &ctx(&skills, &board, &registry, &inherited, &ids),
    );

    assert!(!report.carried().contains(&ModuleKind::Memories));
    assert!(report.initialized().contains(&ModuleKind::Memories));
    assert_eq!(report.notes.len(), 1, "{report:?}");
    assert_eq!(successor.caps().memories().count(), 0);
    assert_eq!(
        successor.caps().memories().strategy(),
        MemoryStrategy::KeywordSearch,
        "the fresh store is organized the successor's way"
    );
}

/// **A window crosses a succession carrying no system prompt.** The thread is what the successor is
/// meant to keep; the prompt states the toolset, the roster and the ending calls of the agent it was
/// rendered for, so the adoption empties it and the successor's own loop fills it in — and until it
/// does, there is nothing in the window for the successor to read as instructions.
#[test]
fn an_adopted_window_keeps_the_thread_and_drops_the_system_prompt() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let ctx = ctx(&skills, &board, &registry, &inherited, &ids);

    let mut history = HistoryModule::new(&history_setup(), &detached_ids());
    history.context_mut().set_system("the predecessor's prompt");
    history.context_mut().push_user_prompt("build the thing");
    history.context_mut().begin_turn(1);
    history
        .context_mut()
        .push_assistant(Some("working on it".to_string()), Vec::new());

    history
        .adopt(&profile_with(Vec::new()), &ctx)
        .expect("a window is always adoptable");

    assert!(
        history.context().system().is_none(),
        "the predecessor's prompt is gone, not retagged and left in the thread"
    );
    let carried = history.context().messages();
    assert!(
        !carried
            .iter()
            .any(|m| matches!(m.role, crate::model::Role::System)),
        "and nothing system-role reaches the provider until the successor sets its own: {carried:?}"
    );

    history.context_mut().set_system("the successor's prompt");

    let rendered = history.context().messages();
    assert_eq!(
        rendered.first().and_then(|m| m.content.clone()),
        Some("the successor's prompt".to_string()),
        "the successor's own prompt renders first, ahead of the thread it inherited"
    );
    assert_eq!(
        rendered
            .iter()
            .filter(|m| matches!(m.role, crate::model::Role::System))
            .count(),
        1,
        "exactly one system-role message reaches the provider: two would have the successor \
         instructed by its predecessor's toolset, roster and ending calls as well as its own"
    );
    assert!(
        !rendered
            .iter()
            .any(|m| m.content.as_deref() == Some("the predecessor's prompt")),
        "and the predecessor's is not one of them"
    );
    assert!(
        rendered
            .iter()
            .any(|m| m.content.as_deref() == Some("working on it")),
        "the thread the successor inherits is untouched"
    );
}

/// The same rule on the other succession shape: a **fork** is a different agent too, so the copy
/// does not open holding the forker's instructions.
#[test]
fn a_forked_window_carries_the_thread_but_not_the_system_prompt() {
    let mut history = HistoryModule::new(&history_setup(), &detached_ids());
    history.context_mut().set_system("the forker's prompt");
    history.context_mut().begin_turn(1);
    history
        .context_mut()
        .push_assistant(Some("before the fork".to_string()), Vec::new());

    let copy = history.forked();

    assert!(copy.context().system().is_none());
    assert!(
        copy.context()
            .messages()
            .iter()
            .any(|m| m.content.as_deref() == Some("before the fork")),
        "the conversation still crosses; only the prompt describing the forker does not"
    );
    assert!(
        history.context().system().is_some(),
        "and the forker keeps its own — it is still running"
    );
}

// ---------------------------------------------------------------------------
// Cloning a whole set — `fork`
// ---------------------------------------------------------------------------

/// **A copy diverges from its original the moment either writes.**
///
/// This is what makes a fork worth having and what makes it dangerous: the copy opens knowing
/// everything its forker knows, and then the two stop being the same agent. The window is the case
/// that matters — two agents cannot write one thread — so it is asserted from both directions, and
/// the task list is asserted with it because a shared task store would have the two copies
/// completing each other's work.
#[test]
fn a_forked_set_is_independent_of_the_set_it_was_cloned_from() {
    let dir = tempfile::TempDir::new().unwrap();
    let skills = SkillsRuntime::new(library(dir.path()));
    let board = BoardRuntime::new(board_caps());
    let (registry, inherited, ids) = plain();
    let profile = profile_with(vec![
        (CAPABILITY_MEMORIES, json!({})),
        (CAPABILITY_TASKS, json!({})),
    ]);
    let mut original =
        ModuleSet::resolve(&profile, &ctx(&skills, &board, &registry, &inherited, &ids));
    original.context_mut().set_system("the shared prefix");
    original.context_mut().begin_turn(1);
    original
        .context_mut()
        .push_assistant(Some("before the fork".to_string()), Vec::new());
    add_task(original.caps().tasks(), "shared");

    let (mut copy, cloned) = fork_modules(
        original.context(),
        original.history_id(),
        original.caps(),
        "agent-2",
    );

    let copied: Vec<ModuleKind> = cloned
        .iter()
        .filter(|entry| entry.disposition == GgModuleDisposition::Copied)
        .map(|entry| entry.kind)
        .collect();
    assert!(
        copied.contains(&ModuleKind::History) && copied.contains(&ModuleKind::Tasks),
        "the copy carries the window and everything else it holds: {cloned:?}"
    );
    assert_eq!(
        copy.caps().tasks().count(),
        1,
        "the copy opens holding what its forker built"
    );

    // Now diverge, in both directions.
    add_task(copy.caps().tasks(), "the copy's own");
    copy.context_mut().begin_turn(2);
    copy.context_mut()
        .push_assistant(Some("only the copy said this".to_string()), Vec::new());
    original
        .context_mut()
        .push_assistant(Some("only the original said this".to_string()), Vec::new());

    assert_eq!(
        original.caps().tasks().count(),
        1,
        "the copy's task never reached the original"
    );
    assert_eq!(copy.caps().tasks().count(), 2);
    let original_thread: Vec<String> = original
        .context()
        .messages()
        .iter()
        .filter_map(|message| message.content.clone())
        .collect();
    let copy_thread: Vec<String> = copy
        .context()
        .messages()
        .iter()
        .filter_map(|message| message.content.clone())
        .collect();
    assert!(
        original_thread.iter().any(|m| m == "before the fork")
            && copy_thread.iter().any(|m| m == "before the fork"),
        "both hold everything said before the fork"
    );
    assert!(
        original_thread
            .iter()
            .any(|m| m == "only the original said this")
            && !original_thread
                .iter()
                .any(|m| m == "only the copy said this"),
        "the original's thread is its own: {original_thread:?}"
    );
    assert!(
        copy_thread.iter().any(|m| m == "only the copy said this")
            && !copy_thread
                .iter()
                .any(|m| m == "only the original said this"),
        "and so is the copy's: {copy_thread:?}"
    );
}

/// **A copy's memories follow the forker's scope, not the fork.**
///
/// An [isolated](MemoryScope::Isolated) notebook is a private one, so the copy gets its own and the
/// two diverge. Every scope that links agents at all was already meant to have several holders, and
/// a fork is not a reason to split what a configuration deliberately joined — so the copy binds the
/// very same store, and each sees what the other writes.
#[test]
fn a_forked_memory_is_copied_when_isolated_and_linked_when_it_is_not() {
    let dir = tempfile::TempDir::new().unwrap();
    let skills = SkillsRuntime::new(library(dir.path()));
    let board = BoardRuntime::new(board_caps());
    let (registry, inherited, ids) = plain();

    for (scope, links) in [
        (MemoryScope::Isolated, false),
        (MemoryScope::Shared, true),
        (MemoryScope::Inherited, true),
        (MemoryScope::ReadOnly, true),
    ] {
        let profile = profile_with(vec![(
            CAPABILITY_MEMORIES,
            json!({ MEMORY_PARAM_SCOPE: scope.as_str() }),
        )]);
        let original =
            ModuleSet::resolve(&profile, &ctx(&skills, &board, &registry, &inherited, &ids));
        write_memory(original.caps().memories(), "before-the-fork");

        let (copy, _) = fork_modules(
            original.context(),
            original.history_id(),
            original.caps(),
            "agent-2",
        );
        assert_eq!(
            copy.caps().memories().count(),
            1,
            "{scope}: the copy opens holding what its forker wrote"
        );
        // The copy's writes are attributed to the copy either way — the holder is a different
        // agent, whether or not the store behind it is the same one.
        assert_eq!(copy.caps().memories().binding().author(), "agent-2");

        write_memory(copy.caps().memories(), "after-the-fork");
        assert_eq!(
            original.caps().memories().count(),
            if links { 2 } else { 1 },
            "{scope}: a linked notebook shows the copy's write and an isolated one does not"
        );
    }
}

// ---------------------------------------------------------------------------
// Module instance identity
// ---------------------------------------------------------------------------

/// The whole of what an id promises, per kind: a [share](Module::share) is the same store and says
/// so, a [fork](Module::fork) is a new one and says so, and the two answers are the *only* thing in
/// the record that distinguishes two holders of one store from two stores that agree.
///
/// The board is the exception in both directions — it shares whichever operation is asked for,
/// because a run has one work queue — and that shows up here as an id that never changes.
#[test]
fn share_keeps_a_module_id_and_fork_mints_a_new_one() {
    let dir = tempfile::TempDir::new().unwrap();
    let ids = detached_ids();
    let modules: Vec<ModuleHandle> = vec![
        ModuleHandle::Memories(MemoriesRuntime::new(
            MemoryStrategy::Scratchpad,
            MemoryCaps::UNBOUNDED,
        )),
        ModuleHandle::Tasks(TasksRuntime::new(10)),
        ModuleHandle::Skills(SkillsRuntime::new(library(dir.path()))),
        ModuleHandle::Archive(crate::archive::ArchiveRuntime::new()),
    ];
    for handle in &modules {
        let module = handle.as_module();
        let id = module.instance_id().to_string();
        assert!(
            id.starts_with(&format!("{}-", module.kind())),
            "an id says what it identifies: {id}"
        );
        assert_eq!(
            module.share().as_module().instance_id(),
            id,
            "{}: two holders of one store report one id",
            module.kind()
        );
        assert_ne!(
            module.fork().as_module().instance_id(),
            id,
            "{}: a copy is a second store and reports a second id",
            module.kind()
        );
    }

    // The window is the other exception, in the other direction: two agents cannot write one
    // thread, so `share` hands back a copy — and a copy is a second window with a second id.
    let history = HistoryModule::new(&history_setup(), &ids);
    assert_ne!(
        history.share().as_module().instance_id(),
        history.instance_id()
    );
    assert_ne!(
        history.fork().as_module().instance_id(),
        history.instance_id()
    );

    // The board is the run's single work queue: every way of copying it hands back the same one.
    let board = BoardRuntime::new(board_caps());
    let id = board.instance_id().to_string();
    assert_eq!(board.share().as_module().instance_id(), id);
    assert_eq!(
        board.fork().as_module().instance_id(),
        id,
        "forking the board would issue `ABC-4` twice; it shares instead, and keeps its identity"
    );
}

/// Two instances of one profile scoped `shared` are two **holders**, and the record has to be able
/// to say so: same id, one store, whatever else differs between them.
#[test]
fn two_shared_holders_of_one_profile_report_one_module_id() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let profile = profile_with(vec![(
        CAPABILITY_MEMORIES,
        json!({ MEMORY_PARAM_SCOPE: MemoryScope::Shared.as_str() }),
    )]);

    let first =
        MemoriesRuntime::resolve(&profile, &ctx(&skills, &board, &registry, &inherited, &ids));
    let second =
        MemoriesRuntime::resolve(&profile, &ctx(&skills, &board, &registry, &inherited, &ids));

    assert_eq!(first.instance_id(), second.instance_id());
    assert_eq!(
        first.origin(),
        GgModuleOrigin::Profile,
        "the resolved answer to `shared` is the profile's instance, and the roster says so"
    );
    assert_eq!(second.origin(), GgModuleOrigin::Profile);
    write_memory(&first, "one notebook");
    assert_eq!(second.count(), 1, "and it really is one store");

    // An `isolated` profile is the control: two instances, two ids.
    let isolated = profile_with(vec![(CAPABILITY_MEMORIES, json!({}))]);
    let a = MemoriesRuntime::resolve(
        &isolated,
        &ctx(&skills, &board, &registry, &inherited, &ids),
    );
    let b = MemoriesRuntime::resolve(
        &isolated,
        &ctx(&skills, &board, &registry, &inherited, &ids),
    );
    assert_ne!(a.instance_id(), b.instance_id());
    assert_eq!(a.origin(), GgModuleOrigin::Created);
}

/// An `inherited` profile with nothing to inherit from silently falls back to a private notebook.
/// That fallback is legal, invisible in every other field, and exactly what the roster's
/// `scope` × `origin` pair exists to surface.
#[test]
fn an_inherited_holder_with_no_spawner_reports_a_created_origin() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let profile = profile_with(vec![(
        CAPABILITY_MEMORIES,
        json!({ MEMORY_PARAM_SCOPE: MemoryScope::Inherited.as_str() }),
    )]);

    let orphan =
        MemoriesRuntime::resolve(&profile, &ctx(&skills, &board, &registry, &inherited, &ids));
    assert_eq!(orphan.memory_scope(), Some(MemoryScope::Inherited));
    assert_eq!(
        orphan.origin(),
        GgModuleOrigin::Created,
        "declared inherited, resolved private — the divergence the roster reports"
    );

    // With a spawner offering a store organized the same way, the scope resolves as declared.
    let spawner = ModuleSet::resolve(
        &profile_with(vec![(CAPABILITY_MEMORIES, json!({}))]),
        &ctx(&skills, &board, &registry, &inherited, &ids),
    );
    let offered = InheritedModules::from_spawner(spawner.caps());
    let child =
        MemoriesRuntime::resolve(&profile, &ctx(&skills, &board, &registry, &offered, &ids));
    assert_eq!(child.origin(), GgModuleOrigin::Inherited);
    assert_eq!(
        child.instance_id(),
        spawner.caps().memories().instance_id(),
        "an inherited holder holds its spawner's very store"
    );
}

/// A roster reports every kind, disabled ones included, with the disabled ones carrying no id —
/// there is no store to identify, and reporting the placeholder gg keeps in the slot would invent
/// a module instance the run does not have.
#[test]
fn a_roster_reports_every_kind_with_ids_only_where_there_is_a_store() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::new(board_caps());
    let (registry, inherited, ids) = plain();
    let profile = profile_with(vec![
        (CAPABILITY_MEMORIES, json!({})),
        (CAPABILITY_PROJECT_MANAGEMENT, json!({})),
    ]);

    let set = ModuleSet::resolve(&profile, &ctx(&skills, &board, &registry, &inherited, &ids));
    let roster = set.roster();

    assert_eq!(
        roster.iter().map(|entry| entry.kind).collect::<Vec<_>>(),
        ModuleKind::ALL.to_vec(),
        "one row per kind, in kind order"
    );
    let memories = &roster[1];
    assert_eq!(memories.kind, ModuleKind::Memories);
    assert!(memories.enabled);
    assert_eq!(memories.scope, Some(MemoryScope::Isolated));
    assert!(memories.writable);
    assert_eq!(memories.module_id, set.caps().memories().instance_id());

    let tasks = &roster[2];
    assert!(!tasks.enabled, "this profile has no task list");
    assert_eq!(tasks.module_id, "", "a disabled module identifies nothing");

    let board_row = &roster[3];
    assert_eq!(board_row.origin, GgModuleOrigin::Run);
    assert_eq!(board_row.module_id, board.instance_id());
    assert!(
        roster[0].module_id.starts_with("history-"),
        "the window is a module too, and the first one"
    );
}

/// A fork's per-kind report is the whole reason the three flat name lists were replaced: the copy's
/// **own** task list and the run's **one** board are two entirely different outcomes, and a list
/// that called both "transferred" could not tell them apart.
#[test]
fn a_fork_reports_linked_and_copied_per_kind_with_both_ids() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::new(board_caps());
    let (registry, inherited, ids) = plain();
    let profile = profile_with(vec![
        (CAPABILITY_TASKS, json!({})),
        (CAPABILITY_PROJECT_MANAGEMENT, json!({})),
    ]);
    let original = ModuleSet::resolve(&profile, &ctx(&skills, &board, &registry, &inherited, &ids));

    let (copy, report) = fork_modules(
        original.context(),
        original.history_id(),
        original.caps(),
        "agent-2",
    );

    let row = |kind: ModuleKind| {
        report
            .iter()
            .find(|entry| entry.kind == kind)
            .unwrap_or_else(|| panic!("{kind} is reported"))
    };
    assert_eq!(
        report.iter().map(|entry| entry.kind).collect::<Vec<_>>(),
        ModuleKind::ALL.to_vec()
    );

    let history = row(ModuleKind::History);
    assert_eq!(history.disposition, GgModuleDisposition::Copied);
    assert_eq!(
        history.from_module_id.as_deref(),
        Some(original.history_id())
    );
    assert_eq!(history.to_module_id.as_deref(), Some(copy.history_id()));
    assert_ne!(history.from_module_id, history.to_module_id);

    let tasks = row(ModuleKind::Tasks);
    assert_eq!(tasks.disposition, GgModuleDisposition::Copied);
    assert_ne!(
        tasks.from_module_id, tasks.to_module_id,
        "a copy's list is its own from here"
    );
    assert_eq!(
        copy.caps().tasks().origin(),
        GgModuleOrigin::Forked,
        "the copy holds it because its forker was copied"
    );

    let board_row = row(ModuleKind::Board);
    assert_eq!(board_row.disposition, GgModuleDisposition::Linked);
    assert_eq!(
        board_row.from_module_id, board_row.to_module_id,
        "both instances hold the run's one board"
    );
    assert_eq!(
        copy.caps().board().origin(),
        GgModuleOrigin::Run,
        "however a holder came by the board, it is the run's"
    );

    let memories = row(ModuleKind::Memories);
    assert_eq!(
        memories.disposition,
        GgModuleDisposition::Absent,
        "a kind neither side holds is absent, not dropped"
    );
    assert!(memories.from_module_id.is_none());
}

/// A transfer keeps the store it was handed — same id on both sides — **except** where the
/// successor's own scope re-binds it. That exception is a store swap, it is correct behaviour, and
/// before ids there was no way to see it happen.
#[test]
fn a_transfer_keeps_the_module_id_unless_the_successor_rebinds() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let profile = profile_with(vec![
        (CAPABILITY_MEMORIES, json!({})),
        (CAPABILITY_TASKS, json!({})),
    ]);
    let old = ModuleSet::resolve(&profile, &ctx(&skills, &board, &registry, &inherited, &ids));
    let (memories_before, tasks_before) = (
        old.caps().memories().instance_id().to_string(),
        old.caps().tasks().instance_id().to_string(),
    );

    // An ordinary successor: the same stores, under a new holder.
    let (successor, report) = transfer(
        old,
        &profile,
        &TransferPlan::Intersection,
        &ctx(&skills, &board, &registry, &inherited, &ids),
    );
    let row = |report: &TransferReport, kind: ModuleKind| {
        report
            .modules
            .iter()
            .find(|entry| entry.kind == kind)
            .cloned()
            .unwrap_or_else(|| panic!("{kind} is reported"))
    };
    let tasks = row(&report, ModuleKind::Tasks);
    assert_eq!(tasks.disposition, GgModuleDisposition::Carried);
    assert_eq!(tasks.from_module_id.as_deref(), Some(tasks_before.as_str()));
    assert_eq!(tasks.to_module_id, tasks.from_module_id);
    assert_eq!(successor.caps().tasks().instance_id(), tasks_before);
    assert_eq!(
        successor.caps().tasks().origin(),
        GgModuleOrigin::Transferred
    );

    // A `shared`-scoped successor binds the registry entry for **its own** profile instead.
    let shared = profile_with(vec![(
        CAPABILITY_MEMORIES,
        json!({ MEMORY_PARAM_SCOPE: MemoryScope::Shared.as_str() }),
    )]);
    let (rebound, report) = transfer(
        successor,
        &shared,
        &TransferPlan::Intersection,
        &ctx(&skills, &board, &registry, &inherited, &ids),
    );
    let memories = row(&report, ModuleKind::Memories);
    assert_eq!(memories.disposition, GgModuleDisposition::Carried);
    assert_eq!(
        memories.from_module_id.as_deref(),
        Some(memories_before.as_str())
    );
    assert_ne!(
        memories.to_module_id.as_deref(),
        Some(memories_before.as_str()),
        "the successor curates its profile's notebook, not the one it was handed"
    );
    assert_eq!(
        rebound.caps().memories().instance_id(),
        memories.to_module_id.as_deref().unwrap()
    );
    assert_eq!(rebound.caps().memories().origin(), GgModuleOrigin::Profile);
}

/// A dropped module reports where it went (nowhere) and an initialized one reports the empty store
/// the successor actually ends up holding — so a reader can follow every kind across the boundary
/// without guessing which of two ids is which.
#[test]
fn a_transfer_names_the_fresh_instance_an_initialized_module_starts_on() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();
    let old = ModuleSet::resolve(
        &profile_with(vec![(CAPABILITY_TASKS, json!({}))]),
        &ctx(&skills, &board, &registry, &inherited, &ids),
    );
    let tasks_before = old.caps().tasks().instance_id().to_string();

    // The successor has memories and no task list: one kind is dropped, the other starts fresh.
    let (successor, report) = transfer(
        old,
        &profile_with(vec![(CAPABILITY_MEMORIES, json!({}))]),
        &TransferPlan::Intersection,
        &ctx(&skills, &board, &registry, &inherited, &ids),
    );

    let tasks = report
        .modules
        .iter()
        .find(|entry| entry.kind == ModuleKind::Tasks)
        .expect("tasks are reported");
    assert_eq!(tasks.disposition, GgModuleDisposition::Dropped);
    assert_eq!(tasks.from_module_id.as_deref(), Some(tasks_before.as_str()));
    assert!(
        tasks.to_module_id.is_none(),
        "a dropped store went nowhere; there is no successor instance to name"
    );

    let memories = report
        .modules
        .iter()
        .find(|entry| entry.kind == ModuleKind::Memories)
        .expect("memories are reported");
    assert_eq!(memories.disposition, GgModuleDisposition::Initialized);
    assert!(memories.from_module_id.is_none());
    assert_eq!(
        memories.to_module_id.as_deref(),
        Some(successor.caps().memories().instance_id()),
        "an initialized module names the empty store the successor is now holding"
    );
}

/// A library holding one skill of the given name, for a test that has to tell two catalogues apart.
fn library_named(dir: &std::path::Path, name: &str) -> Arc<SkillLibrary> {
    std::fs::write(
        dir.join(format!("{name}.md")),
        format!("---\nname: {name}\ndescription: how the thing is done.\n---\nthe body."),
    )
    .expect("the fixture skill is written");
    Arc::new(SkillLibrary::loaded(dir))
}

/// **A successor reads its own profile's skills**, not the ones its predecessor was reading.
///
/// A library belongs to an agent, so an `exec` onto a profile pointing at another directory has to
/// arrive holding that directory's catalogue. Carrying the predecessor's would list the successor
/// skills its own configuration does not offer, and withhold the ones it does.
#[test]
fn a_transfer_takes_the_successors_own_skills() {
    let old_dir = tempfile::TempDir::new().unwrap();
    let new_dir = tempfile::TempDir::new().unwrap();
    let predecessor = SkillsRuntime::new(library_named(old_dir.path(), "predecessor-guide"));
    let successors = SkillsRuntime::new(library_named(new_dir.path(), "successor-guide"));
    let board = BoardRuntime::disabled();
    let (registry, inherited, ids) = plain();

    let old = ModuleSet::inert(&history_setup()).with(ModuleHandle::Skills(predecessor));
    let (successor, report) = transfer(
        old,
        &profile_with(vec![(CAPABILITY_SKILLS, json!({}))]),
        &TransferPlan::Intersection,
        &ctx(&successors, &board, &registry, &inherited, &ids),
    );

    assert!(report.carried().contains(&ModuleKind::Skills));
    let catalogue = successor.caps().skills().library();
    let names: Vec<&str> = catalogue
        .skills()
        .iter()
        .map(|skill| skill.name())
        .collect();
    assert_eq!(
        names,
        vec!["successor-guide"],
        "the successor reads the directory its own profile names"
    );
}
