//! gg's **module model**: the per-agent state an agent instance holds, extracted out of the
//! agent so it can be owned or unowned, cloned, shared, and handed from one agent instance to
//! another.
//!
//! # What a module is
//!
//! A module is one unit of per-agent capability state that has, together: a stable
//! [kind](ModuleKind); an owner-visible surface (an optional pinned [context block](Module::context_block)
//! and, through the [prompt](crate::prompts), an optional system-prompt section); the
//! [telemetry](Module::state_events) it emits on its holder's stream; defined **clone** semantics
//! ([`fork`](Module::fork) for an independent copy, [`share`](Module::share) for a linked handle);
//! and defined **transfer** semantics ([`adopt`](Module::adopt) — what must be re-resolved when a
//! different agent profile takes it over).
//!
//! Before this model existed, those five properties were spread across `MemoriesRuntime`,
//! `TasksRuntime`, `BoardRuntime`, `SkillsRuntime`, a bare `Arc<Mutex<ArchiveStore>>` and the
//! [`ContextModel`], and were wired together by a `RuntimeSet` plus per-capability plumbing in the
//! agent loop. A module set is that, with one iteration order and one place per question.
//!
//! # Ownership
//!
//! [`Ownership`] is the knob that separates *"the agent is told what it holds, every turn"* from
//! *"the agent may look it up"*. An [owned](Ownership::Owned) module contributes its prompt section
//! and keeps its pinned block in the window on its own [refresh](Refresh) schedule — the only
//! behaviour gg had before modules existed, and still the default. An
//! [unowned](Ownership::Unowned) one contributes **nothing** to the automatically assembled prompt
//! while remaining fully live: its tools still read and write it, its telemetry is still emitted,
//! and it is still cloned, shared and transferred.
//!
//! It exists because a module is no longer necessarily *about* the agent holding it. Once a memory
//! instance can be shared between agents, or a task list handed from one state of a machine to the
//! next, an agent can hold a working store it should be able to act on without paying for it in
//! every request it makes.
//!
//! # Copying: `fork` and `share`, never `Clone`
//!
//! None of the module types is [`Clone`]. That is deliberate, and it is the highest-value
//! correctness property of this model: a survey of the code this replaced found `#[derive(Clone)]`
//! meaning *"an independent copy"* on the skills runtime and *"alias the same store"* on the
//! memory, task and board runtimes — a distinction carried only in prose, at call sites that read
//! identically. Copying now goes through [`Module::fork`] (independent) or [`Module::share`]
//! (linked), so every aliasing decision is visible where it is made.
//!
//! # Transfer
//!
//! [`transfer`] is how a live module set is handed to an agent running under a *different*
//! profile. Its rules — carried, dropped, or initialized fresh, per kind — are documented on that
//! function. The invariant every implementation must hold is that caps, modes and ownership are
//! re-resolved from the **receiving** profile ([`Module::adopt`]); a module carrying limits
//! resolved from the profile that produced it is the classic transfer bug.
//!
//! See the [module model](https://docs.testcabinet.ai/gg/modules/) on the documentation site for
//! the user-facing description.

use std::sync::Arc;

use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_MEMORIES, CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_SKILLS, CAPABILITY_TASKS, GgAgentConfig, GgContextSource, GgTelemetryKind,
    MODULE_PARAM_OWNERSHIP,
};

use crate::archive::ArchiveRuntime;
use crate::board::BoardRuntime;
use crate::compaction::RetainedCounts;
use crate::context::{ContextModel, TokenEstimator};
use crate::memories::{MemoriesRuntime, MemoryRegistry, MemoryStrategy};
use crate::model::Message;
use crate::skills::SkillsRuntime;
use crate::tasks::TasksRuntime;

/// The closed set of module kinds, re-exported from the contract so gg and the configurations it
/// reads name the same six things. See [`GgModuleKind`](test_cabinet_core::gg::GgModuleKind) for
/// what each one holds.
pub use test_cabinet_core::gg::GgModuleKind as ModuleKind;

/// Whether a module is auto-included in its holder's prompt, re-exported from the contract — the
/// [`ownership`](MODULE_PARAM_OWNERSHIP) param, resolved. See
/// [`GgModuleOwnership`](test_cabinet_core::gg::GgModuleOwnership).
pub use test_cabinet_core::gg::GgModuleOwnership as Ownership;

/// When a module's pinned context block is rebuilt.
///
/// The schedule is a property of the module rather than of the loop, because the right answer
/// differs per kind and each answer is about what the *thread* already carries. A block whose news
/// the thread already told the model does not need rebuilding every turn; a block the model steers
/// by does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refresh {
    /// Rebuilt at **every turn boundary**, through
    /// [`replace_source`](ContextModel::replace_source) — which is a no-op when the rebuilt block
    /// is byte-identical, so an unchanged block never moves and never rewrites the cached prefix.
    /// The [task list](TasksRuntime) and the [board](BoardRuntime): both are what the model steers
    /// by from turn to turn, so both are worth keeping current.
    EveryTurn,
    /// Rebuilt only at a **context-reset boundary** — a [compaction](crate::compaction). The
    /// [memories](MemoriesRuntime) block: a memory the model just wrote is already in front of it
    /// (its own call, and the confirmation that answered it), so rebuilding the block every turn
    /// re-sends the whole set to say what the thread already said. The one thing the thread cannot
    /// carry is a compaction, which drops the very tool results the block leaned on — so that is
    /// where it is rebuilt.
    AtBoundary,
    /// Pins nothing on a schedule. [Skills](SkillsRuntime) pin a body when it is read and never
    /// again; the [archive](ArchiveRuntime) is by definition out of the window; and the
    /// [history](HistoryModule) *is* the window.
    Never,
}

/// Why a module could not be adopted by a receiving profile — the two shapes
/// [`Module::adopt`] can refuse in, which [`transfer`] turns into "dropped" and "dropped and
/// re-initialized" respectively.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdoptError {
    /// The receiving profile does not enable the capability behind this module. A state or an
    /// agent that turns a capability off gets nothing — that is what turning it off means.
    Disabled,
    /// The receiving profile configures the capability in a shape the module's contents cannot be
    /// read under. Carries the model-facing reason, which the successor is told in its opening
    /// note rather than being left to discover an empty store. The concrete case is a memory
    /// strategy mismatch: a scratchpad store cannot be re-rendered as a markdown index without
    /// silently changing both its semantics and its toolset, so gg states the reset instead of
    /// performing a conversion nobody asked for.
    Incompatible(String),
}

/// One unit of per-agent capability state: what it contributes to the prompt, what it streams as
/// telemetry, and how it is copied, shared, and handed to a different agent.
///
/// Implemented by all six kinds. The trait drives every **uniform** pass over a
/// [`ModuleSet`] — prompt assembly, telemetry drain, the retention proof, transfer — while the
/// loop reaches for a concrete type through the set's typed accessors wherever it needs something
/// only one kind has (the memory strategy, the board's issue queue, the window itself).
pub trait Module: Send {
    /// The module's stable kind — its key in a [`ModuleSet`], the name a transfer list uses, and
    /// the id its telemetry is attributed to.
    fn kind(&self) -> ModuleKind;

    /// Whether the capability behind this module is on for its holder. A disabled module still
    /// occupies its slot in the set — so an ablation's off arm is legible rather than absent —
    /// and contributes nothing: no tools, no prompt, no block, no telemetry.
    fn enabled(&self) -> bool;

    /// Whether this module is [owned](Ownership::Owned) by its holder — see [`Ownership`].
    fn ownership(&self) -> Ownership;

    /// The context band this module's pinned block occupies, or `None` when it pins nothing.
    fn context_source(&self) -> Option<GgContextSource>;

    /// When the holder rebuilds this module's pinned block.
    fn refresh(&self) -> Refresh;

    /// The module's pinned block for the current state, or `None` when it has nothing to show.
    /// Always `None` for a disabled or [unowned](Ownership::Unowned) module — an unowned module
    /// contributes nothing to the automatically assembled prompt, and this is the one place that
    /// is enforced, so no caller has to remember it.
    fn context_block(&self) -> Option<Message>;

    /// The per-turn **notice** this holder owes the model: news produced by *another* holder of a
    /// shared module since this holder last looked. `None` when there is nothing new, which is
    /// every turn of a run in which nothing is shared.
    ///
    /// Advancing the holder's watermark is part of producing the notice, so a given piece of news
    /// is delivered to a given holder exactly once. An [unowned](Ownership::Unowned) module never
    /// produces one — it contributes nothing to the assembled prompt — and enforcing that is the
    /// implementation's job, exactly as it is for [`context_block`](Self::context_block), so no
    /// caller has to remember it.
    ///
    /// The default is "no module of mine is ever shared, so there is never anything to say"; only
    /// [memories](MemoriesRuntime) overrides it.
    fn notice(&mut self) -> Option<Message> {
        None
    }

    /// The module's full state snapshot(s) — emitted at session start, and re-emitted by any agent
    /// that adopts the module, so the console's per-agent reduction is never empty for a module
    /// that arrived rather than being created.
    fn state_events(&self) -> Vec<GgTelemetryKind>;

    /// The delta events this holder owes its stream since the last drain, oldest first. Empty for
    /// a module whose telemetry is snapshot-only.
    fn drain_events(&mut self) -> Vec<GgTelemetryKind>;

    /// The count this module contributes to a compaction boundary's retention proof
    /// ([`RetainedCounts`]). Zero for a module that retains nothing across a boundary.
    fn retained(&self) -> u64;

    /// An **independent** copy: new backing store, deep-copied contents, monotonic counters
    /// carried (never restarted), and no duplication of telemetry the original has not yet
    /// drained. What [`fork`](https://docs.testcabinet.ai/gg/fork-and-exec/) uses.
    ///
    /// Every implementation must leave undrained telemetry with the *forking* holder alone rather
    /// than copying it: a copied pending event would be emitted twice, on two streams, for one
    /// write.
    fn fork(&self) -> ModuleHandle;

    /// A **linked** handle onto the same backing store. What linked memory and the run-global
    /// board use.
    ///
    /// A new holder's watermarks start at the store's current head: it is not told about history
    /// it never missed.
    fn share(&self) -> ModuleHandle;

    /// Whether copying the *agent* should [link](Self::share) this module rather than
    /// [fork](Self::fork) it — the per-kind half of [`fork_modules`].
    ///
    /// `false` for a module that is genuinely one agent's, which is the default and the answer for
    /// four of the six kinds. The board says `true` unconditionally (a second copy of the run's
    /// work queue would issue the same identifier twice) and memories say `true` when their
    /// [scope](crate::memories::MemoryScope) links them (two agents meant to curate one notebook
    /// do not stop meaning it because one of them was copied).
    ///
    /// It lives on the trait, beside the two operations it chooses between, so that a kind added
    /// later answers the question in its own file rather than being forgotten in a copy routine
    /// that never mentions it.
    fn links_when_forked(&self) -> bool {
        false
    }

    /// Re-resolve this module's configuration from the profile that is about to hold it — its
    /// caps, its mode, its ownership, and anything else the *holder* rather than the contents
    /// decides.
    ///
    /// Returns [`AdoptError::Disabled`] when the receiving profile does not enable the capability,
    /// and [`AdoptError::Incompatible`] when it configures it in a shape the contents cannot be
    /// read under; [`transfer`] turns those into "dropped" and "dropped and re-initialized".
    ///
    /// Contents already over a newly-tightened cap are **kept**, and further writes are refused by
    /// the ordinary cap checks. Silently deleting a memory because the successor's profile is
    /// stingier would lose work the run already paid for.
    fn adopt(
        &mut self,
        profile: &GgAgentConfig,
        ctx: &ModuleResolveCtx<'_>,
    ) -> Result<(), AdoptError>;
}

/// A typed handle onto one module — the owning enum a [`ModuleSet`] is built from and
/// [`Module::fork`]/[`Module::share`] hand back.
///
/// Deliberately **not** `Clone`: see this module's documentation for why copying goes through
/// `fork`/`share` instead. It is an enum rather than a `Box<dyn Module>` because the loop needs
/// typed access to several kinds (the memory strategy, the board's issue queue, the window held
/// `&mut` for a whole turn), and downcasting six kinds at every such site would be worse than one
/// exhaustive match. The trait still exists, and still drives every uniform pass.
pub enum ModuleHandle {
    /// The agent's conversation window. Boxed because a window is two orders of magnitude larger
    /// than any other module — every other variant is an `Arc` and a flag — and an unboxed one
    /// would make every handle of every kind that size.
    History(Box<HistoryModule>),
    /// The agent's memories.
    Memories(MemoriesRuntime),
    /// The agent's task list.
    Tasks(TasksRuntime),
    /// The run-global epic/issue board.
    Board(BoardRuntime),
    /// The skills library and what has been read from it.
    Skills(SkillsRuntime),
    /// The thread archive.
    Archive(ArchiveRuntime),
}

impl ModuleHandle {
    /// This handle's module as a trait object, for the uniform passes.
    pub fn as_module(&self) -> &dyn Module {
        match self {
            ModuleHandle::History(m) => m.as_ref(),
            ModuleHandle::Memories(m) => m,
            ModuleHandle::Tasks(m) => m,
            ModuleHandle::Board(m) => m,
            ModuleHandle::Skills(m) => m,
            ModuleHandle::Archive(m) => m,
        }
    }

    /// This handle's module as a mutable trait object, for the uniform passes that drain or adopt.
    pub fn as_module_mut(&mut self) -> &mut dyn Module {
        match self {
            ModuleHandle::History(m) => m.as_mut(),
            ModuleHandle::Memories(m) => m,
            ModuleHandle::Tasks(m) => m,
            ModuleHandle::Board(m) => m,
            ModuleHandle::Skills(m) => m,
            ModuleHandle::Archive(m) => m,
        }
    }

    /// The kind this handle carries.
    pub fn kind(&self) -> ModuleKind {
        self.as_module().kind()
    }
}

// ---------------------------------------------------------------------------
// The history module
// ---------------------------------------------------------------------------

/// The agent's conversation window as a module: a [`ContextModel`] plus the module semantics that
/// make it transferable.
///
/// History is the module that makes succession mean anything. When an agent
/// [execs](https://docs.testcabinet.ai/gg/fork-and-exec/) into another, or a machine moves from
/// one state to the next carrying `history`, what the successor receives is this — the whole
/// thread, with the predecessor's system prompt [rebased](ContextModel::rebase) away and
/// everything behind it left exactly where it sat.
///
/// It is always [enabled](Module::enabled) and always [owned](Ownership::Owned): an agent without
/// a window is not an agent, and a window the agent's prompt does not carry is a contradiction —
/// the window *is* the prompt. An `ownership` param on a history module would have nothing to
/// mean, so there is none.
pub struct HistoryModule {
    /// The window itself.
    context: ContextModel,
}

impl HistoryModule {
    /// A module over a fresh, empty window measuring with `setup`'s estimator against its window
    /// limit, in its execution mode.
    pub fn new(setup: &HistorySetup) -> Self {
        Self {
            context: ContextModel::new(
                Arc::clone(&setup.estimator),
                setup.window_limit,
                setup.code_mode,
            ),
        }
    }

    /// A module wrapping an existing window — how a test seeds a module set with a window it has
    /// already filled, and how a successor is built around a transferred one.
    pub fn from_context(context: ContextModel) -> Self {
        Self { context }
    }

    /// The window, for reading. The loop takes the window mutably for a whole turn through
    /// [`context_mut`](Self::context_mut); this is the read surface the tests assert against.
    #[allow(dead_code)]
    pub fn context(&self) -> &ContextModel {
        &self.context
    }

    /// The window, for the loop that pushes into it.
    pub fn context_mut(&mut self) -> &mut ContextModel {
        &mut self.context
    }

    /// An independent deep copy of the window — see [`ContextModel`]'s own `Clone` documentation.
    /// The copy's [turn counter](ContextModel::begin_turn) continues rather than restarting, so a
    /// later `archive_thread` from either copy names the turns that copy actually saw.
    pub fn forked(&self) -> Self {
        Self {
            context: self.context.clone(),
        }
    }
}

impl Module for HistoryModule {
    fn kind(&self) -> ModuleKind {
        ModuleKind::History
    }

    fn enabled(&self) -> bool {
        true
    }

    fn ownership(&self) -> Ownership {
        Ownership::Owned
    }

    fn context_source(&self) -> Option<GgContextSource> {
        // The window is not one band of the breakdown; it is every band.
        None
    }

    fn refresh(&self) -> Refresh {
        Refresh::Never
    }

    fn context_block(&self) -> Option<Message> {
        None
    }

    fn state_events(&self) -> Vec<GgTelemetryKind> {
        // The window reports itself every turn as a `ContextBreakdown`, emitted by the loop from
        // the fully assembled window; a snapshot emitted here would be a second, staler answer to
        // the same question.
        Vec::new()
    }

    fn drain_events(&mut self) -> Vec<GgTelemetryKind> {
        Vec::new()
    }

    fn retained(&self) -> u64 {
        0
    }

    fn fork(&self) -> ModuleHandle {
        ModuleHandle::History(Box::new(self.forked()))
    }

    /// **Sharing a window is not supported**, and this returns an independent copy instead.
    ///
    /// Two agents cannot write one window: the turn loop holds it `&mut` for the whole of a turn,
    /// and a second writer would be interleaving messages into a thread mid-turn — on an
    /// OpenAI-shaped provider, potentially between an assistant `tool_calls` message and the
    /// results answering it. A copy is the only coherent answer, and every caller that would ask
    /// for a shared window (a [fork](https://docs.testcabinet.ai/gg/fork-and-exec/)) wants a copy
    /// anyway.
    fn share(&self) -> ModuleHandle {
        self.fork()
    }

    /// Re-resolve the window's **holder-owned** properties: its execution mode, and (through
    /// [`ModuleResolveCtx`]) the window limit of the model that is about to reason over it.
    ///
    /// The system prompt is *not* rebased here. Rebasing needs a rendered prompt, which needs the
    /// successor's registry and roster, which are built after its modules are — so the loop does
    /// it, explicitly, at the one point it has both.
    fn adopt(
        &mut self,
        profile: &GgAgentConfig,
        ctx: &ModuleResolveCtx<'_>,
    ) -> Result<(), AdoptError> {
        let _ = profile;
        self.context.set_window_limit(ctx.history.window_limit);
        self.context.set_code_mode(ctx.history.code_mode);
        Ok(())
    }
}

/// What a [history module](HistoryModule) needs that is a property of its **holder** rather than
/// of the conversation: the estimator every item is measured with, the window limit fullness is
/// measured against, and whether the holder writes programs.
///
/// The estimator is process-wide and shared; the other two are re-resolved whenever a different
/// agent takes the window over.
#[derive(Clone)]
pub struct HistorySetup {
    /// The estimator every context item is measured with. Shared, and the same one for every agent
    /// in the run, so two windows' figures are comparable.
    pub estimator: Arc<dyn TokenEstimator>,
    /// The holder model's context-window limit in tokens, when known — the fullness denominator.
    pub window_limit: Option<u64>,
    /// Whether the holder runs in
    /// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) mode, which
    /// arms the per-message headings gg prefixes synthesized user messages with.
    pub code_mode: bool,
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/// Everything [`ModuleSet::resolve`] and [`Module::adopt`] need beyond the profile itself: the
/// run-global resources a module is built *over* rather than *from*, and the modules this
/// particular agent may inherit.
pub struct ModuleResolveCtx<'a> {
    /// The orchestrator's skills runtime — the loaded library every agent's own read-state runtime
    /// is built over.
    pub skills: &'a SkillsRuntime,
    /// The run-global epic/issue board. Every agent's board module is a
    /// [share](Module::share) of this one: the board is the run's single work queue, and two
    /// copies of it would issue the same identifier twice.
    pub board: &'a BoardRuntime,
    /// The run-global registry of **profile-bound** memory instances — what a
    /// [`shared`](crate::memories::MemoryScope::Shared)-scoped agent binds, so every instance of
    /// that profile in the run curates one store.
    pub memories: &'a MemoryRegistry,
    /// The modules this agent may take over from the agent that spawned it — empty for every
    /// agent that has no spawner (the root, an issue's implementer, a detached reviewer or judge).
    /// Only a profile that asks for them ([`inherited`](crate::memories::MemoryScope::Inherited) or
    /// [`read-only`](crate::memories::MemoryScope::ReadOnly)) takes anything from here.
    pub inherited: &'a InheritedModules,
    /// Whether **any** profile this run declares inherits its memories from its spawner, resolved
    /// once at launch. It is what tells an agent whose own memories are
    /// [isolated](crate::memories::MemoryScope::Isolated) that a child may nonetheless end up
    /// holding them — see
    /// [`MemoriesRuntime::is_linked`](crate::memories::MemoriesRuntime::is_linked).
    pub inheritable: bool,
    /// The holder-owned properties of the conversation window.
    pub history: HistorySetup,
    /// The id of the agent instance the modules are being built for. Recorded on a shared store's
    /// entries so a write can be attributed to the holder that made it.
    pub agent_id: &'a str,
}

/// What a spawned agent may take over from its spawner, offered at the spawn and taken only by a
/// child whose own profile asks for it.
///
/// It is an offer rather than an instruction, and that is the whole of gg's inheritance model: the
/// spawner always offers what it holds, and the **child's** scope decides whether to bind it, with
/// what access. That is what makes inheritance compose — a chain of subagents each scoped
/// `inherited` all end up holding the store the top of the chain created, and a `read-only` link in
/// the middle restricts only itself, because access is a property of a holder rather than of a
/// store.
///
/// Only memories are inheritable today. The type exists in the plural because it is the seam the
/// rest of the module kinds arrive through.
#[derive(Default)]
pub struct InheritedModules {
    /// The spawner's memories, when it had any. A child binds a [share](Module::share) of this.
    pub memories: Option<MemoriesRuntime>,
}

impl InheritedModules {
    /// What a spawner offers its children: a [share](Module::share) of its own memories when the
    /// capability is on for it, and nothing when it is off.
    ///
    /// A share rather than the runtime itself because the spawner keeps curating its own memories
    /// while its children run — they are holders of one store, which is the point.
    pub fn from_spawner(modules: &CapabilityModules) -> Self {
        Self {
            memories: modules
                .memories()
                .enabled()
                .then(|| modules.memories().shared()),
        }
    }

    /// The same offer again, for one more child.
    ///
    /// A spawner offers what it holds to *every* child it spawns, and each dispatch needs an owned
    /// value to send into the child's task — so this is a fresh [share](Module::share) of the same
    /// stores rather than a move. It is not `Clone` for the reason no module type is: a copy has
    /// to name which of the two copies it means, and this one means "the same store, one more
    /// holder".
    pub fn offer(&self) -> Self {
        Self {
            memories: self.memories.as_ref().map(MemoriesRuntime::shared),
        }
    }

    /// The offered memories, but only if they are organized by `strategy` — otherwise `None`.
    ///
    /// A store is read by the calls its own strategy offers: a scratchpad handed to an agent
    /// configured for a markdown index would be a set it has no call to read and an index it
    /// cannot see. gg gives such a child a private instance instead, and
    /// [says so at launch](crate::memories::launch_warnings) rather than leaving it to be
    /// inferred from a notebook that stayed empty.
    pub fn memories_organized_as(&self, strategy: MemoryStrategy) -> Option<&MemoriesRuntime> {
        self.memories
            .as_ref()
            .filter(|memories| memories.strategy() == strategy)
    }
}

/// Resolve a module-backed capability's [`ownership`](MODULE_PARAM_OWNERSHIP) param, returning the
/// resolved value and, for an unrecognized one, the launch warning that names it.
///
/// An unrecognized value falls back to the default and warns rather than failing the launch, in
/// line with how gg treats every other unrecognized capability *value*: a sweep's one shared
/// configuration document must stay interpretable by every arm, and being loud is the whole of the
/// defence against a typo silently running the wrong experiment.
pub fn resolve_ownership(profile: &GgAgentConfig, capability: &str) -> (Ownership, Option<String>) {
    let Some(raw) = profile
        .capability(capability)
        .and_then(|cap| cap.params.get(MODULE_PARAM_OWNERSHIP))
    else {
        return (Ownership::Owned, None);
    };
    match raw {
        Value::String(value) => match value.as_str() {
            "owned" => (Ownership::Owned, None),
            "unowned" => (Ownership::Unowned, None),
            other => (
                Ownership::Owned,
                Some(format!(
                    "capability `{capability}` sets `{MODULE_PARAM_OWNERSHIP}` to `{other}`, which \
                     is not a module ownership gg knows (`owned` or `unowned`); the module is \
                     owned, as if the param were absent."
                )),
            ),
        },
        other => (
            Ownership::Owned,
            Some(format!(
                "capability `{capability}` sets `{MODULE_PARAM_OWNERSHIP}` to `{other}`, which is \
                 not a string; the module is owned, as if the param were absent."
            )),
        ),
    }
}

/// Every capability id gg backs with a module, paired with the kind it backs — the list
/// [`ownership_warnings`] validates and the console's editor offers an `ownership` picker for.
///
/// [`History`](ModuleKind::History) is absent deliberately: the window is not a capability, it is
/// the agent.
const MODULE_CAPABILITIES: [(&str, ModuleKind); 5] = [
    (CAPABILITY_MEMORIES, ModuleKind::Memories),
    (CAPABILITY_TASKS, ModuleKind::Tasks),
    (CAPABILITY_PROJECT_MANAGEMENT, ModuleKind::Board),
    (CAPABILITY_SKILLS, ModuleKind::Skills),
    (CAPABILITY_AGENT_MANAGED_CONTEXT, ModuleKind::Archive),
];

/// Every launch warning `profile`'s module configuration earns — today, one per module-backed
/// capability whose [`ownership`](MODULE_PARAM_OWNERSHIP) param gg could not read.
///
/// Collected at launch, across every declared profile, so a typo in a configuration is reported
/// once, before the first turn, rather than discovered by an agent that quietly failed to see its
/// own task list.
pub fn ownership_warnings(profile: &GgAgentConfig) -> Vec<String> {
    MODULE_CAPABILITIES
        .iter()
        .filter(|(capability, _)| profile.is_enabled(capability))
        .filter_map(|(capability, _)| resolve_ownership(profile, capability).1)
        .map(|warning| format!("agent `{}`: {warning}", profile.name))
        .collect()
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

/// The five **capability** modules an agent instance holds — everything but its window.
///
/// They are grouped apart from the [history](HistoryModule) for one concrete reason: the turn loop
/// needs `&mut` access to the window and simultaneous access to the modules whose blocks it
/// refreshes into it, and the borrow checker will only prove that for two disjoint fields. See
/// [`ModuleSet::split_mut`].
pub struct CapabilityModules {
    /// The agent's memories.
    memories: MemoriesRuntime,
    /// The agent's task list.
    tasks: TasksRuntime,
    /// The run-global epic/issue board, as this agent holds it.
    board: BoardRuntime,
    /// The skills library and what this agent has read from it.
    skills: SkillsRuntime,
    /// The thread archive.
    archive: ArchiveRuntime,
}

impl CapabilityModules {
    /// Build the five capability modules an agent running under `profile` starts with: one per
    /// capability the profile enables, and a [disabled](Module::enabled) one where it does not.
    ///
    /// The board is the exception to "per agent": it is a [share](Module::share) of the run-global
    /// one, because the board is the run's single work queue. What *is* per agent is whether that
    /// agent's prompt carries it — a profile without the authoring capability holds the board
    /// [unowned](Ownership::Unowned), so it is not shown a decomposition it has no tool to act on
    /// and no reason to go looking through for work other than the job it was given.
    pub fn resolve(profile: &GgAgentConfig, ctx: &ModuleResolveCtx<'_>) -> Self {
        let board_ownership = if profile.is_enabled(CAPABILITY_PROJECT_MANAGEMENT) {
            resolve_ownership(profile, CAPABILITY_PROJECT_MANAGEMENT).0
        } else {
            Ownership::Unowned
        };
        Self {
            memories: MemoriesRuntime::resolve(profile, ctx),
            tasks: TasksRuntime::resolve(profile),
            board: ctx.board.shared().with_ownership(board_ownership),
            skills: ctx
                .skills
                .forked()
                .with_ownership(resolve_ownership(profile, CAPABILITY_SKILLS).0),
            archive: if profile.is_enabled(CAPABILITY_AGENT_MANAGED_CONTEXT) {
                ArchiveRuntime::new()
                    .with_ownership(resolve_ownership(profile, CAPABILITY_AGENT_MANAGED_CONTEXT).0)
            } else {
                ArchiveRuntime::disabled()
            },
        }
    }

    /// Five disabled modules: the shape a test that is about the loop rather than about state
    /// drives an agent with, and the shape [`ToolRegistry::new`](crate::tools::ToolRegistry::new)
    /// assembles a toolset against — a capability whose module is disabled offers no tools, because
    /// its tools would have nothing to act on.
    pub fn inert() -> Self {
        Self {
            memories: MemoriesRuntime::disabled(),
            tasks: TasksRuntime::disabled(),
            board: BoardRuntime::disabled(),
            skills: SkillsRuntime::disabled(),
            archive: ArchiveRuntime::disabled(),
        }
    }

    /// This set with `module` in place of the one it holds of the same kind — the chaining form of
    /// [`put`](Self::put), for the tests that assemble a set a module at a time. A
    /// [history](ModuleKind::History) handle is rejected: the window is held by the [`ModuleSet`]
    /// around this, not among the capability modules.
    #[allow(dead_code)]
    pub fn with(mut self, module: ModuleHandle) -> Self {
        self.put(module);
        self
    }

    /// Put `module` in place of the one this set holds of the same kind, dropping the old one.
    ///
    /// # Panics
    ///
    /// If `module` is a [history](ModuleKind::History) handle, which belongs to the [`ModuleSet`]
    /// rather than here.
    pub fn put(&mut self, module: ModuleHandle) {
        match module {
            ModuleHandle::Memories(m) => self.memories = m,
            ModuleHandle::Tasks(m) => self.tasks = m,
            ModuleHandle::Board(m) => self.board = m,
            ModuleHandle::Skills(m) => self.skills = m,
            ModuleHandle::Archive(m) => self.archive = m,
            ModuleHandle::History(_) => {
                panic!("the history module is held by the ModuleSet, not among the capabilities")
            }
        }
    }

    /// The memories module. Always present; [disabled](Module::enabled) when the capability is
    /// off, which is what makes an ablation's off arm legible rather than absent.
    pub fn memories(&self) -> &MemoriesRuntime {
        &self.memories
    }

    /// The memories module, mutably — for the drains and notices that advance its watermarks.
    pub fn memories_mut(&mut self) -> &mut MemoriesRuntime {
        &mut self.memories
    }

    /// The task list module.
    pub fn tasks(&self) -> &TasksRuntime {
        &self.tasks
    }

    /// The board module — this agent's handle on the run-global board.
    pub fn board(&self) -> &BoardRuntime {
        &self.board
    }

    /// The skills module.
    pub fn skills(&self) -> &SkillsRuntime {
        &self.skills
    }

    /// The skills module, mutably — `read_skill` records its reads here, and the result decides
    /// whether the loop pins the body.
    pub fn skills_mut(&mut self) -> &mut SkillsRuntime {
        &mut self.skills
    }

    /// The thread archive module.
    pub fn archive(&self) -> &ArchiveRuntime {
        &self.archive
    }

    /// Every capability module, in [kind](ModuleKind) order — the order every uniform pass runs
    /// in, so two runs of one configuration produce the same sequence of events and the same
    /// prompt.
    pub fn each(&self) -> [&dyn Module; 5] {
        [
            &self.memories,
            &self.tasks,
            &self.board,
            &self.skills,
            &self.archive,
        ]
    }

    /// Every capability module mutably, in [kind](ModuleKind) order.
    pub fn each_mut(&mut self) -> [&mut dyn Module; 5] {
        [
            &mut self.memories,
            &mut self.tasks,
            &mut self.board,
            &mut self.skills,
            &mut self.archive,
        ]
    }

    /// The pinned blocks the modules on the `when` schedule currently want in the window, as
    /// `(band, block)` pairs in kind order.
    ///
    /// A `None` block means "this module has nothing to show", which the loop applies through
    /// [`replace_source`](ContextModel::replace_source) exactly as it applies a rebuilt one — so a
    /// module that empties, is turned off, or becomes [unowned](Ownership::Unowned) retires its
    /// block rather than leaving a stale copy pinned. A module that is off and has never shown
    /// anything produces a no-op.
    ///
    /// This is the whole of prompt assembly's knowledge of what a module is: the loop no longer
    /// names memories, tasks and the board one at a time.
    pub fn pinned_blocks(&self, when: Refresh) -> Vec<(GgContextSource, Option<Message>)> {
        self.each()
            .into_iter()
            .filter(|module| module.refresh() == when)
            .filter_map(|module| Some((module.context_source()?, module.context_block())))
            .collect()
    }

    /// Every module's full state snapshot, in kind order — emitted at session start and again by
    /// any agent that adopts a module, so a console panel is never empty for state that arrived
    /// rather than being created here.
    pub fn state_events(&self) -> Vec<GgTelemetryKind> {
        self.each()
            .into_iter()
            .flat_map(|module| module.state_events())
            .collect()
    }

    /// Every module's undrained delta events, in kind order, advancing each one's watermark.
    pub fn drain_events(&mut self) -> Vec<GgTelemetryKind> {
        self.each_mut()
            .into_iter()
            .flat_map(|module| module.drain_events())
            .collect()
    }

    /// The per-turn notices the modules owe the model — news another holder of a shared module
    /// produced since this holder last looked. Empty on every turn of a run that shares nothing.
    ///
    /// Whether a module is [owned](Ownership::Owned) enough to say anything is each module's own
    /// question, decided inside its [`notice`](Module::notice) — which is what lets an unowned one
    /// still advance its watermark past news it was never going to be told.
    pub fn notices(&mut self) -> Vec<Message> {
        self.each_mut()
            .into_iter()
            .filter_map(|module| module.notice())
            .collect()
    }

    /// The retention proof a compaction boundary records: what each module carries across it.
    pub fn retained_counts(&self) -> RetainedCounts {
        RetainedCounts {
            skills: self.skills.retained(),
            tasks: self.tasks.retained(),
            memories: self.memories.retained(),
            issues: self.board.retained(),
        }
    }
}

/// Every module one agent instance holds: its [window](HistoryModule) and its five
/// [capability modules](CapabilityModules).
///
/// This is what replaced the loop's hand-written per-capability plumbing — the runtimes built one
/// at a time in the agent's construction path, threaded into the turn loop as six positional
/// arguments, and refreshed into the window by three hardcoded blocks. One type, one construction
/// path ([`resolve`](Self::resolve)), one iteration order, and one place to answer "what does this
/// agent hold, and what happens to it when the agent changes".
pub struct ModuleSet {
    /// The agent's conversation window.
    history: HistoryModule,
    /// The agent's capability modules.
    caps: CapabilityModules,
}

impl ModuleSet {
    /// Build the set an agent running under `profile` starts with: one module per capability the
    /// profile enables (a [disabled](Module::enabled) one where it does not), plus the
    /// always-present window.
    ///
    /// The board is the exception to "per agent": it is a [share](Module::share) of the run-global
    /// one, because the board is the run's single work queue. What *is* per agent is whether that
    /// agent's prompt carries it — a profile without the authoring capability holds the board
    /// [unowned](Ownership::Unowned), so it is not shown a decomposition it has no tool to act on
    /// and no reason to go looking through for work other than the job it was given.
    pub fn resolve(profile: &GgAgentConfig, ctx: &ModuleResolveCtx<'_>) -> Self {
        Self {
            history: HistoryModule::new(&ctx.history),
            caps: CapabilityModules::resolve(profile, ctx),
        }
    }

    /// A set holding nothing: an empty window and five disabled modules. The starting point every
    /// test that assembles a set by hand builds from; the loop always [resolves](Self::resolve) one
    /// from a profile.
    #[allow(dead_code)]
    pub fn inert(setup: &HistorySetup) -> Self {
        Self {
            history: HistoryModule::new(setup),
            caps: CapabilityModules::inert(),
        }
    }

    /// This set with `module` put in place of the one it currently holds of that kind — the
    /// chaining form of [`put`](Self::put), for the tests that assemble a set a module at a time.
    #[allow(dead_code)]
    pub fn with(mut self, module: ModuleHandle) -> Self {
        self.put(module);
        self
    }

    /// Put `module` in place of the one this set currently holds of the same kind, dropping the
    /// old one.
    pub fn put(&mut self, module: ModuleHandle) {
        match module {
            ModuleHandle::History(m) => self.history = *m,
            other => self.caps.put(other),
        }
    }

    /// Take this set apart into its six handles, in [kind](ModuleKind) order. What [`transfer`]
    /// consumes.
    pub fn into_handles(self) -> Vec<ModuleHandle> {
        vec![
            ModuleHandle::History(Box::new(self.history)),
            ModuleHandle::Memories(self.caps.memories),
            ModuleHandle::Tasks(self.caps.tasks),
            ModuleHandle::Board(self.caps.board),
            ModuleHandle::Skills(self.caps.skills),
            ModuleHandle::Archive(self.caps.archive),
        ]
    }

    /// Whether the module of `kind` is enabled for this holder — the question a
    /// [transfer plan](TransferPlan) asks about the outgoing set.
    pub fn has(&self, kind: ModuleKind) -> bool {
        match kind {
            ModuleKind::History => true,
            ModuleKind::Memories => self.caps.memories.enabled(),
            ModuleKind::Tasks => self.caps.tasks.enabled(),
            ModuleKind::Board => self.caps.board.enabled(),
            ModuleKind::Skills => self.caps.skills.enabled(),
            ModuleKind::Archive => self.caps.archive.enabled(),
        }
    }

    /// The window itself — the shorthand for `history().context()`. The loop holds the window and
    /// the capability modules apart for a whole turn through [`split_mut`](Self::split_mut); this
    /// is the read surface for the callers that hold a whole set, which today are the fork path
    /// and the tests.
    #[allow(dead_code)]
    pub fn context(&self) -> &ContextModel {
        self.history.context()
    }

    /// The window itself, mutably — the counterpart of [`context`](Self::context), for the tests
    /// that fill a set's window before transferring or cloning it.
    #[allow(dead_code)]
    pub fn context_mut(&mut self) -> &mut ContextModel {
        self.history.context_mut()
    }

    /// The capability modules.
    pub fn caps(&self) -> &CapabilityModules {
        &self.caps
    }

    /// The capability modules, mutably.
    pub fn caps_mut(&mut self) -> &mut CapabilityModules {
        &mut self.caps
    }

    /// Simultaneous `&mut` to the window and to the capability modules — the split the turn loop
    /// needs and the borrow checker will not give through the accessors above.
    ///
    /// The loop takes it once, at the top of `drive`, and holds both halves for the whole session:
    /// the window is pushed into on every path, and the modules' blocks are refreshed into it at
    /// each boundary, so any narrower borrow would end up re-taken dozens of times to no purpose.
    pub fn split_mut(&mut self) -> (&mut HistoryModule, &mut CapabilityModules) {
        (&mut self.history, &mut self.caps)
    }

    /// Every module's full state snapshot — the window's excepted, which reports itself every turn
    /// as a context breakdown.
    pub fn state_events(&self) -> Vec<GgTelemetryKind> {
        self.caps.state_events()
    }
}

// ---------------------------------------------------------------------------
// Cloning a whole set — `fork`
// ---------------------------------------------------------------------------

/// Every module an agent holds, [cloned](Module::fork) for a copy of that agent running as
/// `agent_id` — what a [`fork`](https://docs.testcabinet.ai/gg/fork-and-exec/) hands its child.
///
/// It takes the window by reference rather than as a [`HistoryModule`] because the one caller that
/// forks from inside a [code turn](crate::sandbox) is holding the live [`ContextModel`] alone: the
/// module around it stays behind in the agent's set while a program runs.
///
/// Every module goes through the same two-way choice — [`Module::links_when_forked`] decides
/// whether the copy is a [link](Module::share) onto the same store or an independent
/// [copy](Module::fork) — so the per-kind rules live with the kinds rather than in a routine that
/// has to remember all six. Today the board always links, memories link when their
/// [scope](crate::memories::MemoryScope) says two agents were meant to curate one notebook, and
/// the rest are copied. (Skills are copied and still share the loaded library, which is immutable;
/// what is copied is the read set, a promise about *this* window — and the window is being copied
/// with it.)
///
/// The copy's memories are re-stamped with the **copy's** agent id, whichever way they came, so
/// its writes are attributed to it and it is not told about its own.
///
/// Returns the set and the kinds it actually carries, which is what the fork's
/// [`AgentTransition`](GgTelemetryKind::AgentTransition) reports.
pub fn fork_modules(
    context: &ContextModel,
    caps: &CapabilityModules,
    agent_id: &str,
) -> (ModuleSet, Vec<ModuleKind>) {
    let mut set = ModuleSet {
        history: HistoryModule::from_context(context.clone()),
        caps: CapabilityModules::inert(),
    };
    for module in caps.each() {
        set.put(if module.links_when_forked() {
            module.share()
        } else {
            module.fork()
        });
    }
    set.caps.memories = set.caps.memories.with_agent(agent_id);
    let cloned = ModuleKind::ALL
        .into_iter()
        .filter(|kind| set.has(*kind))
        .collect();
    (set, cloned)
}

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

/// What a handoff carries. Computed two ways and applied one way, by [`transfer`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransferPlan {
    /// Every kind present in **both** the outgoing set and the incoming profile — the rule
    /// [`exec`](https://docs.testcabinet.ai/gg/fork-and-exec/) applies. A capability the successor
    /// does not have is dropped; one it has and the predecessor did not is initialized fresh; one
    /// both have is carried, which is what makes the successor see the predecessor's whole
    /// conversation.
    Intersection,
    /// Exactly these kinds — a machine transition's declared transfer list. An absent or empty
    /// list transfers nothing, which is a deliberate hard reset between states rather than an
    /// oversight: a recorded configuration has to say what it does.
    Explicit(Vec<ModuleKind>),
}

impl TransferPlan {
    /// Whether `kind` is carried out of `old` under this plan, given the receiving `profile`.
    ///
    /// A kind an explicit list names but the outgoing set does not hold is **not** carried; the
    /// transition's author asked for something the source state never had, which [`transfer`]
    /// reports rather than silently ignoring.
    fn carries(&self, kind: ModuleKind, old: &ModuleSet, profile: &GgAgentConfig) -> bool {
        match self {
            TransferPlan::Intersection => old.has(kind) && enables(profile, kind),
            TransferPlan::Explicit(kinds) => kinds.contains(&kind) && old.has(kind),
        }
    }
}

/// Whether `profile` enables the capability behind `kind`. The window is not a capability, so it is
/// always enabled.
fn enables(profile: &GgAgentConfig, kind: ModuleKind) -> bool {
    match kind {
        ModuleKind::History => true,
        ModuleKind::Memories => profile.is_enabled(CAPABILITY_MEMORIES),
        ModuleKind::Tasks => profile.is_enabled(CAPABILITY_TASKS),
        ModuleKind::Board => profile.is_enabled(CAPABILITY_PROJECT_MANAGEMENT),
        ModuleKind::Skills => profile.is_enabled(CAPABILITY_SKILLS),
        ModuleKind::Archive => profile.is_enabled(CAPABILITY_AGENT_MANAGED_CONTEXT),
    }
}

/// What a [`transfer`] did, per kind — for the successor's opening note, for the operator log, and
/// for the console, which has to be able to show a handoff *as* a handoff rather than as an
/// unexplained second agent.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct TransferReport {
    /// The kinds the successor received live, with their contents.
    pub transferred: Vec<ModuleKind>,
    /// The kinds the successor did not receive: not named by the plan, or named but refused by the
    /// receiving profile's configuration.
    pub dropped: Vec<ModuleKind>,
    /// The kinds the successor's own profile enables that it started fresh — either because the
    /// plan did not carry them, or because what was carried could not be read under the
    /// successor's configuration.
    pub initialized: Vec<ModuleKind>,
    /// The model-facing reasons a carried module could not be adopted, in kind order. They go into
    /// the successor's opening note, so a reset is something it is told rather than something it
    /// discovers.
    pub notes: Vec<String>,
    /// Warnings for the operator log: a transfer list naming a module the source state never held.
    pub warnings: Vec<String>,
}

/// Apply `plan` to `old`, producing the set the successor runs under `profile` with, plus a
/// [report](TransferReport) of what happened to each kind.
///
/// Per kind, in [`ModuleKind`] order:
///
/// 1. **Carried?** The plan says so ([`Intersection`](TransferPlan::Intersection): present in `old`
///    *and* enabled on `profile`; [`Explicit`](TransferPlan::Explicit): named *and* present in
///    `old`). A named kind the outgoing set does not hold is skipped with a warning.
/// 2. **Carried and adoptable?** [`Module::adopt`] decides. `Ok` moves the live module into the
///    successor's set, re-resolved against the receiving profile.
///    [`Disabled`](AdoptError::Disabled) drops it — a profile that turns a capability off gets
///    nothing. [`Incompatible`](AdoptError::Incompatible) drops it, keeps the freshly initialized
///    one in its place, and records the reason for the successor's opening note.
/// 3. **Not carried but enabled on `profile`?** It is the fresh module
///    [`ModuleSet::resolve`] already built.
/// 4. **Not carried and not enabled?** Disabled, like any other off capability.
///
/// Draining a dropped module's telemetry onto the *outgoing* agent's stream is the caller's job
/// and must happen before this is called — after it, the module is gone.
pub fn transfer(
    old: ModuleSet,
    profile: &GgAgentConfig,
    plan: &TransferPlan,
    ctx: &ModuleResolveCtx<'_>,
) -> (ModuleSet, TransferReport) {
    let mut successor = ModuleSet::resolve(profile, ctx);
    let mut report = TransferReport::default();

    if let TransferPlan::Explicit(kinds) = plan {
        for kind in kinds {
            if !old.has(*kind) {
                report.warnings.push(format!(
                    "transfer list names the `{kind}` module, which the outgoing agent does not \
                     hold; nothing is carried for it."
                ));
            }
        }
    }

    let carried: Vec<ModuleKind> = ModuleKind::ALL
        .into_iter()
        .filter(|kind| plan.carries(*kind, &old, profile))
        .collect();
    // Read before the set is consumed: a kind the outgoing agent *held* and the successor does not
    // receive is a drop worth reporting, while a kind neither side has is simply absent.
    let held: Vec<ModuleKind> = ModuleKind::ALL
        .into_iter()
        .filter(|kind| old.has(*kind))
        .collect();

    for mut handle in old.into_handles() {
        let kind = handle.kind();
        if !carried.contains(&kind) {
            if enables(profile, kind) {
                report.initialized.push(kind);
            } else if held.contains(&kind) {
                report.dropped.push(kind);
            }
            continue;
        }
        match handle.as_module_mut().adopt(profile, ctx) {
            Ok(()) => {
                report.transferred.push(kind);
                successor.put(handle);
            }
            Err(AdoptError::Disabled) => report.dropped.push(kind),
            Err(AdoptError::Incompatible(reason)) => {
                report.initialized.push(kind);
                report.notes.push(reason);
            }
        }
    }

    (successor, report)
}

#[cfg(test)]
#[path = "modules.test.rs"]
mod tests;
