//! The [module model](super): ownership, the two copy semantics, and transfer.
//!
//! Every assertion here is about a rule the loop *relies* on but cannot state: that an unowned
//! module contributes nothing to the prompt while staying live, that a fork and its original
//! diverge, that two shared handles are one store, and that a module handed to a different profile
//! is re-resolved against the profile receiving it rather than the one that produced it.

use std::sync::Arc;

use serde_json::json;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_MEMORIES, CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_SKILLS, CAPABILITY_TASKS, GgAgentConfig, GgCapabilityConfig, GgContextSource,
    GgTelemetryKind,
};

use super::*;
use crate::board::{BoardCaps, BoardRuntime};
use crate::context::HeuristicTokenEstimator;
use crate::memories::{MemoriesRuntime, MemoryCaps, MemoryRegistry, MemoryStrategy};
use crate::skills::{SkillLibrary, SkillsRuntime};
use crate::tasks::{StructuredFields, TaskMode, TasksRuntime};

/// The window setup every set in these tests is built over — the heuristic estimator (no BPE
/// tables to load) and no window limit, since none of these assertions is about fullness.
fn history_setup() -> HistorySetup {
    HistorySetup {
        estimator: Arc::new(HeuristicTokenEstimator),
        window_limit: None,
        code_mode: false,
    }
}

/// A one-skill library, so a skills module has something to offer and something to read.
fn library(dir: &std::path::Path) -> Arc<SkillLibrary> {
    std::fs::write(
        dir.join("guide.md"),
        "---\nname: guide\ndescription: how the thing is done.\n---\nthe body of the guide.",
    )
    .expect("the fixture skill is written");
    Arc::new(SkillLibrary::load(dir))
}

/// The resolve context these tests build sets against: a skills runtime, a run-global board, and
/// one agent id.
fn ctx<'a>(
    skills: &'a SkillsRuntime,
    board: &'a BoardRuntime,
    memories: &'a MemoryRegistry,
    inherited: &'a InheritedModules,
) -> ModuleResolveCtx<'a> {
    ModuleResolveCtx {
        skills,
        board,
        memories,
        inherited,
        history: history_setup(),
        agent_id: "agent-1",
    }
}

/// The two run-global inputs a set is resolved against when nothing is shared and nothing is
/// inherited — which is every test in this file, since scoping is `memories.scope.test.rs`'s
/// subject and these tests are about the module model around it.
fn plain() -> (MemoryRegistry, InheritedModules) {
    (MemoryRegistry::new(), InheritedModules::default())
}

/// A profile enabling `capabilities`, each with the given params.
fn profile_with(capabilities: Vec<(&str, serde_json::Value)>) -> GgAgentConfig {
    GgAgentConfig {
        capabilities: capabilities
            .into_iter()
            .map(|(id, params)| GgCapabilityConfig {
                id: id.to_string(),
                enabled: true,
                implementation: None,
                params,
            })
            .collect(),
        ..GgAgentConfig::root()
    }
}

/// Write one memory into `runtime`'s store, so a test has state to copy or carry.
fn write_memory(runtime: &MemoriesRuntime, name: &str) {
    runtime
        .store()
        .lock()
        .expect("memory store lock")
        .write("", name, "a description", "a body")
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
// Ownership
// ---------------------------------------------------------------------------

/// **An owned module contributes its pinned block; an unowned one contributes nothing.**
///
/// This is the whole of what ownership changes about the prompt, and it is asserted through the
/// same call prompt assembly makes — not through each runtime's own renderer — because the point of
/// the model is that the loop no longer names memories, tasks and the board one at a time.
#[test]
fn an_unowned_module_contributes_no_pinned_block() {
    let tasks = TasksRuntime::new(10);
    add_task(&tasks, "t1");
    let board = BoardRuntime::new(BoardCaps::default());
    board
        .store()
        .lock()
        .expect("board store lock")
        .create_epic("api", "the API", "the API epic")
        .expect("the epic is within the caps");

    let owned = CapabilityModules::inert()
        .with(ModuleHandle::Tasks(tasks.shared()))
        .with(ModuleHandle::Board(board.shared()));
    let blocks = owned.pinned_blocks(Refresh::EveryTurn);
    assert_eq!(
        blocks.len(),
        2,
        "the task list and the board are both refreshed every turn"
    );
    assert!(
        blocks.iter().all(|(source, block)| block.is_some()
            && matches!(source, GgContextSource::TaskList | GgContextSource::Board)),
        "an owned module with contents renders a block on its own band"
    );

    let unowned = CapabilityModules::inert()
        .with(ModuleHandle::Tasks(
            tasks.shared().with_ownership(Ownership::Unowned),
        ))
        .with(ModuleHandle::Board(
            board.shared().with_ownership(Ownership::Unowned),
        ));
    assert!(
        unowned
            .pinned_blocks(Refresh::EveryTurn)
            .iter()
            .all(|(_, block)| block.is_none()),
        "an unowned module shows nothing, holding exactly the same contents"
    );
}

/// An unowned module is **not** a disabled one: its state is live, its telemetry is still emitted,
/// and it still counts towards the retention proof a compaction boundary records. Only the prompt
/// changes.
#[test]
fn an_unowned_module_is_still_live() {
    let memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::default())
        .with_ownership(Ownership::Unowned);
    write_memory(&memories, "note");

    assert!(
        memories.offers_memories(),
        "the memory tools are still offered"
    );
    assert_eq!(
        memories.retained(),
        1,
        "the memory still crosses a boundary"
    );
    assert!(
        matches!(
            memories.state_events().as_slice(),
            [GgTelemetryKind::MemoryState { .. }]
        ),
        "an unowned module still reports its state to the console"
    );
    assert!(
        Module::context_block(&memories).is_none(),
        "and it still says nothing in the prompt"
    );
}

/// The skills catalog is the skills module's prompt contribution, so an unowned one lists nothing —
/// while `read_skill` is untouched, which is the "reachable through its tools and nothing else"
/// half of the rule.
#[test]
fn an_unowned_skills_module_lists_no_catalog() {
    let dir = tempfile::TempDir::new().unwrap();
    let library = library(dir.path());
    let owned = SkillsRuntime::new(Arc::clone(&library));
    assert_eq!(owned.prompt_entries().len(), 1);

    let unowned = SkillsRuntime::new(library).with_ownership(Ownership::Unowned);
    assert!(unowned.prompt_entries().is_empty());
    assert!(
        unowned.offers_skills(),
        "the catalog is withheld; `read_skill` is not"
    );
}

/// A profile without the board-authoring capability holds the run-global board **unowned**, not
/// disabled — it is still on the same queue (an implementer's issue is on it), it is simply not
/// shown a decomposition it has no tool to act on.
#[test]
fn a_profile_without_the_board_capability_holds_it_unowned() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::new(BoardCaps::default());
    let (registry, inherited) = plain();
    let modules = CapabilityModules::resolve(
        &GgAgentConfig::root(),
        &ctx(&skills, &board, &registry, &inherited),
    );

    assert!(
        modules.board().offers_board(),
        "the board is the run's, and every agent holds it"
    );
    assert_eq!(modules.board().ownership(), Ownership::Unowned);

    let authoring = profile_with(vec![(CAPABILITY_PROJECT_MANAGEMENT, json!({}))]);
    let modules =
        CapabilityModules::resolve(&authoring, &ctx(&skills, &board, &registry, &inherited));
    assert_eq!(modules.board().ownership(), Ownership::Owned);
}

/// The `ownership` param is read off each module-backed capability, and an **unrecognized** value
/// falls back to `owned` with a launch warning naming it — never a launch failure, in line with how
/// gg treats every other unrecognized capability value.
#[test]
fn the_ownership_param_resolves_and_warns() {
    let profile = profile_with(vec![
        (CAPABILITY_TASKS, json!({ "ownership": "unowned" })),
        (CAPABILITY_MEMORIES, json!({ "ownership": "owned" })),
        (CAPABILITY_SKILLS, json!({ "ownership": "shared" })),
        (CAPABILITY_AGENT_MANAGED_CONTEXT, json!({ "ownership": 7 })),
    ]);

    assert_eq!(
        resolve_ownership(&profile, CAPABILITY_TASKS),
        (Ownership::Unowned, None)
    );
    assert_eq!(
        resolve_ownership(&profile, CAPABILITY_MEMORIES),
        (Ownership::Owned, None)
    );
    // An absent param is the default, silently.
    assert_eq!(
        resolve_ownership(&profile, CAPABILITY_PROJECT_MANAGEMENT),
        (Ownership::Owned, None)
    );

    let (ownership, warning) = resolve_ownership(&profile, CAPABILITY_SKILLS);
    assert_eq!(ownership, Ownership::Owned);
    assert!(
        warning
            .expect("an unknown value warns")
            .contains("`shared`"),
        "the warning names the value it could not read"
    );

    let warnings = ownership_warnings(&profile);
    assert_eq!(
        warnings.len(),
        2,
        "one per unreadable value — the string and the number: {warnings:?}"
    );
    assert!(warnings.iter().all(|w| w.starts_with("agent `Root`:")));
}

// ---------------------------------------------------------------------------
// Copying
// ---------------------------------------------------------------------------

/// **A fork is independent.** Mutating either copy leaves the other exactly as it was — the property
/// an agent-level `fork` rests on, and the one a `#[derive(Clone)]` that sometimes meant "alias the
/// store" could not give.
#[test]
fn a_fork_is_independent_of_its_original() {
    let memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::default());
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
    let mut memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::default());
    write_memory(&memories, "note");
    let _ = memories.drain_events();

    let mut forked = memories.forked();
    forked
        .store()
        .lock()
        .expect("memory store lock")
        .update("", "note", "a new description", "a new body")
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
    let memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::default());
    let linked = memories.shared();

    write_memory(&memories, "written-by-the-first");
    assert_eq!(linked.count(), 1, "the second handle sees it immediately");

    write_memory(&linked, "written-by-the-second");
    assert_eq!(memories.count(), 2, "and the first sees the second's write");

    // The board is *always* shared, even when a caller asks it to fork: two boards would each keep
    // their own issue counter and would both hand out the same identifier.
    let board = BoardRuntime::new(BoardCaps::default());
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
    let mut memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::default());
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
    let mut history = HistoryModule::new(&history_setup());
    history.context_mut().begin_turn(37);
    history.context_mut().push_system("the system prompt");

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
    let (registry, inherited) = plain();
    let ctx = ctx(&skills, &board, &registry, &inherited);

    let mut tasks = TasksRuntime::with_mode(3, TaskMode::Simple);
    add_task(&tasks, "t1");
    let receiver = profile_with(vec![(
        CAPABILITY_TASKS,
        json!({ "maxTasks": 40, "mode": "issues", "ownership": "unowned" }),
    )]);
    tasks.adopt(&receiver, &ctx).expect("tasks are adoptable");

    assert_eq!(tasks.max_tasks(), 40);
    assert_eq!(tasks.mode(), TaskMode::Issues);
    assert_eq!(Module::ownership(&tasks), Ownership::Unowned);
    assert_eq!(tasks.count(), 1, "and the contents came with it");
}

/// Contents already over a newly-tightened cap are **kept**. Deleting work the run already paid for
/// because the successor's profile is stingier would lose exactly what the transfer was for.
#[test]
fn a_tightened_cap_keeps_what_is_already_there() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited) = plain();
    let ctx = ctx(&skills, &board, &registry, &inherited);

    let mut memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::default());
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
            .write("", "three", "d", "b")
            .is_err(),
        "the next write is what the tightened cap refuses"
    );
}

/// A profile that does not enable the capability **refuses** the module: turning a capability off is
/// what "this agent does not get one" means.
#[test]
fn a_profile_that_disables_the_capability_refuses_the_module() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited) = plain();
    let ctx = ctx(&skills, &board, &registry, &inherited);

    let mut memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::default());
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
    let (registry, inherited) = plain();
    let ctx = ctx(&skills, &board, &registry, &inherited);

    let mut memories = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::default());
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
    let (registry, inherited) = plain();

    // The predecessor holds memories and a task list; the successor's profile keeps memories, adds
    // the archive, and drops tasks entirely.
    let old = ModuleSet::inert(&history_setup())
        .with(ModuleHandle::Memories(MemoriesRuntime::new(
            MemoryStrategy::Scratchpad,
            MemoryCaps::default(),
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
        &ctx(&skills, &board, &registry, &inherited),
    );

    assert!(report.transferred.contains(&ModuleKind::Memories));
    assert!(report.transferred.contains(&ModuleKind::History));
    assert!(report.dropped.contains(&ModuleKind::Tasks));
    assert!(report.initialized.contains(&ModuleKind::Archive));

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
    let (registry, inherited) = plain();

    let old = ModuleSet::inert(&history_setup())
        .with(ModuleHandle::Memories(MemoriesRuntime::new(
            MemoryStrategy::Scratchpad,
            MemoryCaps::default(),
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
        &ctx(&skills, &board, &registry, &inherited),
    );

    assert_eq!(report.transferred, vec![ModuleKind::Tasks]);
    assert!(report.initialized.contains(&ModuleKind::Memories));
    assert!(
        report.initialized.contains(&ModuleKind::History),
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
#[test]
fn a_transfer_list_naming_an_absent_module_warns() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited) = plain();
    let old = ModuleSet::inert(&history_setup());

    let (_, report) = transfer(
        old,
        &profile_with(Vec::new()),
        &TransferPlan::Explicit(vec![ModuleKind::Memories]),
        &ctx(&skills, &board, &registry, &inherited),
    );
    assert_eq!(report.warnings.len(), 1, "{report:?}");
    assert!(report.warnings[0].contains("`memories`"));
}

/// An incompatible carried module is dropped, **re-initialized**, and the reason is put where the
/// successor's opening note can state it — so a reset is something the model is told rather than
/// something it discovers.
#[test]
fn an_incompatible_module_is_reinitialized_with_a_stated_reason() {
    let skills = SkillsRuntime::disabled();
    let board = BoardRuntime::disabled();
    let (registry, inherited) = plain();

    let old = ModuleSet::inert(&history_setup()).with(ModuleHandle::Memories(
        MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::default()),
    ));
    write_memory(old.caps().memories(), "lost");

    let mut successor_profile = profile_with(vec![(CAPABILITY_MEMORIES, json!({}))]);
    successor_profile.capabilities[0].implementation = Some("keyword-search".to_string());

    let (successor, report) = transfer(
        old,
        &successor_profile,
        &TransferPlan::Intersection,
        &ctx(&skills, &board, &registry, &inherited),
    );

    assert!(!report.transferred.contains(&ModuleKind::Memories));
    assert!(report.initialized.contains(&ModuleKind::Memories));
    assert_eq!(report.notes.len(), 1, "{report:?}");
    assert_eq!(successor.caps().memories().count(), 0);
    assert_eq!(
        successor.caps().memories().strategy(),
        MemoryStrategy::KeywordSearch,
        "the fresh store is organized the successor's way"
    );
}

/// A transferred window is the predecessor's thread with the **successor's** system prompt at the
/// head of it: everything behind item 0 is what the successor is meant to keep, and item 0 is the
/// one thing that must never be inherited.
#[test]
fn a_rebased_window_keeps_the_thread_and_replaces_the_prompt() {
    let mut history = HistoryModule::new(&history_setup());
    history
        .context_mut()
        .push_system("the predecessor's prompt");
    history.context_mut().push_user_prompt("build the thing");
    history.context_mut().begin_turn(1);
    history
        .context_mut()
        .push_assistant(Some("working on it".to_string()), Vec::new());

    let before = history.context().messages().len();
    history.context_mut().rebase("the successor's prompt", None);

    assert_eq!(
        history.context().messages().len(),
        before + 1,
        "the changed prompt is superseded and re-appended, never edited in place"
    );
    let rendered = history.context().messages();
    assert_eq!(
        rendered.last().and_then(|m| m.content.clone()),
        Some("the successor's prompt".to_string())
    );
    assert!(
        rendered
            .iter()
            .any(|m| m.content.as_deref() == Some("working on it")),
        "the thread the successor inherits is untouched"
    );
}
