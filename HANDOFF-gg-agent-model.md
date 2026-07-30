# Handoff: the module-based gg agent model

The authoritative design for the v0.7.0 rework of gg's agent model: capability
state is extracted into **modules** that can be owned or unowned, cloned, shared
and transferred between agent instances; memory gains **linked instances** and
four **scoping strategies**; **FSM agents** become a user-authored composition of
agent profiles; **`fork`/`exec`** generalize state transition; and the whole
**planning capability** plus the built-in `plan-first`/`tdd` machines are deleted.

This file is the spec. Every decision in it has been made — nothing is left to
the implementer's discretion. Where an alternative was rejected, the rationale is
one sentence in the same paragraph so it is not relitigated. Delete this file
once the work lands and the behaviour has been folded into
`apps/docs/src/content/docs/gg/`.

**Read first:** `CLAUDE.md`, `.claude/skills/coding/SKILL.md`, and
`apps/docs/src/content/docs/gg/overview.md`. The docs site is the source of truth
for behaviour; this file is the source of truth for *how it is built*, and it
tells you which doc pages must change.

---

## 0. Shape of the change

Five things land together, in this order (§7 has the stage plan):

| # | Change | Primary code |
| --- | --- | --- |
| 0 | Delete planning + the built-in machines | §5 |
| 1 | The module abstraction (`Module`, `ModuleSet`, ownership, clone/transfer) | `crates/gg/src/module.rs` (new), `crates/gg/src/agent.rs` |
| 2 | Memory scoping + linked memory | `crates/gg/src/memories.rs`, `crates/gg/src/tools/memories*.rs` |
| 3 | `fork` / `exec` (the incarnation loop) | `crates/gg/src/agent.rs`, `crates/gg/src/tools/transitions.rs` (new) |
| 4 | FSM agents (data-driven, built on `exec`) | `crates/gg/src/fsm.rs` (rewritten) |
| 5 | Console + docs + contract regeneration | `packages/ui/`, `apps/docs/`, `crates/core/src/gg.rs` |

Two facts about the existing code drive almost every decision below, and both
were verified against the tree at `rel/v0.7.0`:

1. **`run_agent` (`crates/gg/src/agent.rs:2018`) is the single construction
   path**, and `Agent` (`agent.rs:309-323`) is identity only — `id`,
   `parent_id`, `depth`, `slot` (the profile name). Every resource is rebuilt
   from the profile at `agent.rs:2113-2244` and handed to `Agent::drive`
   (`agent.rs:5022`) as 26 positional arguments. That argument list *is* the
   seam this design collapses.
2. **The rendered prompt only ever grows.** `ContextModel::replace_source`
   (`context.rs:661`) is a no-op on a byte-identical rebuild and supersedes in
   place otherwise (`supersede_source`, `context.rs:684`); the context-usage
   signal lives in a trailing slot (`context.rs:462`, `context.rs:1023`) that is
   rendered last (`window_items`). Anything this design adds to a turn must
   either append at the tail or occupy a slot — never edit behind the tail. See
   §2.4.

---

## 1. The module abstraction

### 1.1 What a module is

A **module** is one unit of per-agent capability state that has, together:

- a stable **kind** (`memories`, `tasks`, …),
- an **owner-visible surface** — an optional pinned context block and an optional
  system-prompt section,
- **telemetry** it emits on its holder's stream,
- defined **clone semantics** (fork = independent copy, share = same store),
- defined **transfer semantics** (what must be re-resolved when a different
  profile adopts it).

Today these five properties are spread across `MemoriesRuntime`
(`memories.rs:1269`), `TasksRuntime` (`tasks.rs:785`), `BoardRuntime`
(`board.rs:1456`), `SkillsRuntime` (`skills.rs:176`), a bare
`Arc<Mutex<ArchiveStore>>` (`agent.rs:2125`) and the `ContextModel`
(`context.rs:448`), and they are wired together by `RuntimeSet`
(`tools/mod.rs:505`) plus ~20 lines of hand-written per-capability plumbing in
`run_agent` and `drive`. Modules make that one type with one iteration order.

### 1.2 The trait

New file `crates/gg/src/module.rs` (with `module.test.rs`). Rustdoc on every item
must match the crate's explanatory voice — read `memories.rs:1260-1290` and
`context.rs:637-660` before writing it.

```rust
/// One unit of per-agent capability state: what it contributes to the prompt, what it
/// streams as telemetry, and how it is copied, shared, and handed to a different agent.
pub trait Module: Send {
    /// The module's stable kind — its key in a [`ModuleSet`], the name a transition
    /// transfer list uses, and the id its telemetry is attributed to.
    fn kind(&self) -> ModuleKind;

    /// Whether the capability behind this module is on for its holder. A disabled module
    /// occupies its slot (so an ablation's off arm is still legible) and contributes nothing.
    fn enabled(&self) -> bool;

    /// Whether this module is [owned](Ownership::Owned) by its holder — see [`Ownership`].
    fn ownership(&self) -> Ownership;

    /// The context band this module's pinned block occupies, or `None` when it pins nothing.
    fn context_source(&self) -> Option<GgContextSource>;

    /// When the holder rebuilds this module's pinned block.
    fn refresh(&self) -> Refresh;

    /// The module's pinned block for the current state, or `None` when it has nothing to
    /// show. Always `None` for an [unowned](Ownership::Unowned) module.
    fn context_block(&self) -> Option<Message>;

    /// The per-turn **notice** this holder owes the model: news produced by *another* holder
    /// of a shared module since this holder last looked. `None` when there is nothing new.
    /// Advances this holder's notice watermark, so a notice is delivered exactly once.
    fn notice(&mut self) -> Option<Message>;

    /// The module's full state snapshot(s) — emitted at session start, and re-emitted by any
    /// agent that adopts the module, so the console's per-agent reduction is never empty.
    fn state_events(&self) -> Vec<GgTelemetryKind>;

    /// The delta events this holder owes its stream since the last drain, oldest first. A
    /// shared module yields only the entries **this holder authored** (see §1.7).
    fn drain_events(&mut self) -> Vec<GgTelemetryKind>;

    /// The count this module contributes to a compaction boundary's retention proof
    /// ([`RetainedCounts`](crate::compaction::RetainedCounts)).
    fn retained(&self) -> u64;

    /// An **independent** copy: new backing store, deep-copied contents, monotonic counters
    /// carried (never restarted), undrained telemetry not duplicated. What `fork` uses.
    fn fork(&self) -> ModuleHandle;

    /// A **linked** handle onto the same backing store, with this holder's own watermarks
    /// reset to the store's current head (a new holder is not told about history it never
    /// missed). What linked memory and the run-global board use.
    fn share(&self) -> ModuleHandle;

    /// Re-resolve this module's configuration from the profile that is about to hold it —
    /// its caps, its mode, its ownership, its access. Returns `Err` when the receiving
    /// profile's configuration is structurally incompatible with the module's contents, in
    /// which case the caller drops the module and initializes a fresh one (§1.8).
    fn adopt(&mut self, profile: &GgAgentConfig, agent_id: &str) -> Result<(), AdoptError>;
}

/// Whether a module is auto-included in its holder's prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Ownership {
    /// The holder's prompt carries the module: its system-prompt section is rendered and
    /// its pinned block is kept in the window on its [`Refresh`] schedule. Today's behaviour.
    #[default]
    Owned,
    /// The module is reachable through the holder's tools and nothing else: no system-prompt
    /// section, no pinned block, no per-turn notice. Its telemetry is still emitted.
    Unowned,
}

/// When a module's pinned block is rebuilt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refresh {
    /// Rebuilt at every turn boundary through [`ContextModel::replace_source`] (a no-op when
    /// unchanged). Tasks and the board.
    EveryTurn,
    /// Rebuilt only at a context-reset boundary (a compaction). Memories — see
    /// `memories.rs:1354-1368` for why.
    AtBoundary,
    /// Pins nothing on a schedule (skills pin on read; history *is* the window).
    Never,
}

/// Why a module could not be adopted by a receiving profile.
#[derive(Debug, Clone)]
pub enum AdoptError {
    /// The receiving profile does not enable the capability behind this module.
    Disabled,
    /// The receiving profile configures the capability in a shape the module's contents
    /// cannot be read under (a different memory strategy). Carries the model-facing reason.
    Incompatible(String),
}
```

`ModuleKind` is a closed enum in gg **and** a contract enum in core (the FSM
transfer list names it on the wire — §3.1):

```rust
pub enum ModuleKind { History, Memories, Tasks, Board, Skills, Archive }
```

### 1.3 `ModuleHandle` and why there is no `Clone`

```rust
/// A typed handle onto one module. Deliberately **not** `Clone`: the survey of the current
/// code found `#[derive(Clone)]` meaning "fork" on `SkillsRuntime` and "alias the store" on
/// `MemoriesRuntime`/`TasksRuntime`/`BoardRuntime`, a distinction carried only in prose.
/// Copying goes through [`Module::fork`] or [`Module::share`], never through `.clone()`.
pub enum ModuleHandle {
    History(HistoryModule),
    Memories(MemoriesRuntime),
    Tasks(TasksRuntime),
    Board(BoardRuntime),
    Skills(SkillsRuntime),
    Archive(ArchiveRuntime),
}

impl ModuleHandle {
    pub fn as_module(&self) -> &dyn Module;
    pub fn as_module_mut(&mut self) -> &mut dyn Module;
}
```

**Remove `#[derive(Clone)]` from `MemoriesRuntime` (`memories.rs:1268`),
`TasksRuntime`, `BoardRuntime` and `SkillsRuntime`** as part of stage 1. Every
current `.clone()` on them (the code path's `LoopToolApi` seeding at
`agent.code.rs:840-847`, `orch.board.clone()` at `agent.rs:2116`) becomes an
explicit `.share()`. This is the single highest-value correctness change in the
whole refactor: it makes every aliasing decision visible at the call site.

### 1.4 Mapping onto the existing runtimes

| Kind | Type | Disposition |
| --- | --- | --- |
| `history` | `HistoryModule` (new, wraps `ContextModel`) | **New wrapper**; `ContextModel` refactored in place (see below) |
| `memories` | `MemoriesRuntime` | **Refactored in place**: gains `access`, `telemetry_cursor`, `notice_cursor`, loses `Clone` |
| `tasks` | `TasksRuntime` | **Refactored in place**: loses `Clone`, gains `Module` |
| `board` | `BoardRuntime` | **Refactored in place**: `fork()` panics-by-contract → returns `share()` (see §1.6) |
| `skills` | `SkillsRuntime` | **Refactored in place**: `fork()` = share library + copy read-set; `share()` = share both |
| `archive` | `ArchiveRuntime` (new, wraps `Arc<Mutex<ArchiveStore>>`) | **New wrapper** over the bare `Arc` built at `agent.rs:2125` |
| — | `RuntimeSet` (`tools/mod.rs:505-536`) | **Deleted** — subsumed by `ModuleSet` |
| — | `PlanningRuntime` (`planning.rs:103`) | **Deleted** (§5) |
| — | `FsmRuntime` + `Machine`/`FsmState`/`ToolPolicy`/`StateExit`/`AdvanceGuard` | **Deleted and rewritten** as data-driven specs (§3) |

`ContextModel` changes required for `HistoryModule` (all in `context.rs`):

- `#[derive(Clone)]` — a deep copy. Cached per-item token estimates
  (`context.rs:103`) stay valid because there is exactly one process-wide
  estimator (`agent.rs:1197`); add a `debug_assert!(Arc::ptr_eq(...))` in
  `HistoryModule::adopt` so a future per-model estimator fails loudly instead of
  silently mis-costing a transferred window.
- `pub fn rebase(&mut self, system: String, user_prompt: Option<String>)` —
  replaces items 0/1 in place (system prompt, build prompt) and recomputes their
  estimates, leaving every item behind them untouched. This is what makes a
  transferred window legal for a different profile: item 0 is rendered from the
  *receiving* agent's profile, roster, toolset and ending role
  (`agent.rs:7501-7669`), never inherited.
- `pub fn set_window_limit(&mut self, limit: Option<u64>)` and
  `pub fn set_code_mode(&mut self, code_mode: bool)` — both are properties of the
  *holder's model and execution mode*, re-resolved on adoption. Note that
  `code_mode` is baked into already-stored message bodies (the
  `<heading>\n----\n` prefix, `context.rs:1283-1311`); changing it affects only
  messages pushed *after* the transfer, which is correct and must be stated in
  the rustdoc.
- `turn` is **never** reset on transfer or fork (`context.rs:503-511`: a
  renumbered turn silently repoints a later `archive_thread` call).

### 1.5 `ModuleSet` — the registry that replaces `RuntimeSet`

```rust
/// Every module one agent instance holds, keyed by kind, in a stable order.
pub struct ModuleSet {
    entries: Vec<ModuleHandle>,   // at most one per kind, in ModuleKind declaration order
}

impl ModuleSet {
    /// Build the set an agent running under `profile` starts with: one module per capability
    /// the profile enables, plus the always-present history module.
    pub fn resolve(profile: &GgAgentConfig, ctx: &ModuleResolveCtx<'_>) -> Self;

    pub fn get(&self, kind: ModuleKind) -> Option<&ModuleHandle>;
    pub fn get_mut(&mut self, kind: ModuleKind) -> Option<&mut ModuleHandle>;
    pub fn has(&self, kind: ModuleKind) -> bool;

    // Typed accessors the loop uses (each `Option`, `None` when the capability is off):
    pub fn memories(&self) -> &MemoriesRuntime;   // always present, `disabled()` when off
    pub fn tasks(&self) -> &TasksRuntime;
    pub fn board(&self) -> &BoardRuntime;
    pub fn skills_mut(&mut self) -> &mut SkillsRuntime;
    pub fn archive(&self) -> &ArchiveRuntime;
    pub fn history_mut(&mut self) -> &mut ContextModel;

    /// Simultaneous `&mut` to the history window and `&` to everything else — the split the
    /// turn loop needs and the borrow checker will not give through the accessors above.
    pub fn split_mut(&mut self) -> (&mut ContextModel, ModuleRefs<'_>);

    /// Detach a module (used by the code path, which moves the window onto the blocking
    /// thread) and re-attach it afterwards. Panics if the kind is already absent/present.
    pub fn detach(&mut self, kind: ModuleKind) -> ModuleHandle;
    pub fn attach(&mut self, handle: ModuleHandle);

    /// The owned modules, in kind order — what prompt assembly iterates.
    pub fn owned(&self) -> impl Iterator<Item = &ModuleHandle>;

    /// Drain every module's telemetry and its per-turn notices.
    pub fn drain_events(&mut self) -> Vec<GgTelemetryKind>;
    pub fn notices(&mut self) -> Vec<Message>;
}
```

`ModuleResolveCtx<'_>` carries what a module needs beyond the profile:
`skills_library: &Arc<SkillLibrary>`, `board: &BoardRuntime` (the run-global
one), `memory_registry: &MemoryRegistry`, `inherited: &InheritedModules`,
`agent_id: &str`, `role: &AgentRole`. It is built in `run_agent` from the
orchestrator; it is the replacement for the `RuntimeSet::new(...).with_*(...)`
builder chain at `agent.rs:2140-2144`.

`ToolRegistry::from_run` changes signature:

```rust
pub fn from_run(capabilities: &GgAgentConfig, modules: &ModuleSet, facts: &AgentFacts) -> Self;
```

`AgentFacts { fsm: Option<&FsmPosition> }` is what makes `transition_state`
offerable only where it means something (§3.3). The memory-tool block at
`tools/mod.rs:647-676` now reads strategy **and access** off the module
(`modules.memories()`), which is what gates a read-only holder's toolset (§2.3).

### 1.6 Clone semantics per kind

| Kind | `fork()` (independent) | `share()` (linked) | Notes |
| --- | --- | --- | --- |
| `history` | Deep copy of `items` + `usage_signal` + `turn`; the copy's `turn` continues, never restarts | **Unsupported** — returns a deep copy and logs a `warn` | Two agents cannot write one window: the loop holds it `&mut` for a whole turn |
| `memories` | New `Arc<Mutex<MemoryStore>>`, deep copy of `memories`, `revisions`, `peak` and the revision **log**; both holders' cursors set to the log head | Same `Arc`; the new holder's cursors start at the current head | `revisions` (`memories.rs:630`) must be carried or a re-created slug restarts its history |
| `tasks` | New `Arc<Mutex<TaskStore>>`, deep copy | Same `Arc` | Task ids are model-authored; two forks never merge, so no re-minting |
| `board` | Returns `share()` | Same `Arc` | Forking the board would fork `next_number` (`board.rs:783`) and reissue `ABC-4`; the board is run-global by construction |
| `skills` | Same `Arc<SkillLibrary>`, deep copy of the read-set | Same `Arc`, shared read-set behind a `Mutex` | The read-set is a **promise about the window** (`skills.rs:188-198`); a fork must travel with the history it refers to, which it always does (§4) |
| `archive` | New `Arc<Mutex<ArchiveStore>>`, deep copy, `next_seq` **carried** | Same `Arc` | Restarting `next_seq` would print two entries as `#0` (`archive.rs:44-65`) |

Rule the implementer must not break: **`fork()` never duplicates undrained
telemetry.** Every `fork()` implementation drains its own pending events into the
*forking* holder first (the caller emits them), then copies. Otherwise a
`MemoryRevision` is emitted twice, on two streams, for one write.

### 1.7 Telemetry attribution for a shared module

The current `MemoryStore.pending: VecDeque<MemoryRevision>` (`memories.rs:631`)
plus the destructive `drain_revisions` (`memories.rs:752`) cannot survive two
holders: whichever drains first steals the other's events. Replace it, for every
shareable store, with an **append-only, author-tagged log plus per-holder
cursors**:

```rust
// in MemoryStore
log: Vec<LoggedRevision>,           // append-only; never truncated
// in LoggedRevision
revision: MemoryRevision,
author: String,                     // the agent id that performed the mutation

// in MemoriesRuntime (the holder)
telemetry_cursor: usize,            // how far this holder has streamed
notice_cursor: usize,               // how far this holder has told the model
agent_id: String,                   // who this holder is (set at resolve/adopt)
access: MemoryAccess,               // ReadWrite | ReadOnly
```

- `drain_events()` reads `log[telemetry_cursor..]`, advances the cursor, and
  emits a `MemoryRevision` **only for entries whose `author == self.agent_id`**,
  plus one `MemoryState` snapshot if any entry at all was new. A write is
  therefore reported exactly once, on the stream of the agent that made it, and
  every linked agent's panel still updates.
- `notice()` reads `log[notice_cursor..]`, advances the cursor, and renders a
  message from entries authored by **someone else** (§2.4).
- The log is unbounded but bounded in practice by `max_count` × writes; it holds
  only what the store already held, so it is not a new memory cost worth guarding.

The same shape is applied to `TaskStore` (whose events are snapshot-only today,
so a single `state_events()` re-emission suffices — no author tagging needed) and
is *not* applied to the board, which is already run-global and whose telemetry is
already emitted by whichever agent mutates it.

### 1.8 Transfer semantics

Transfer is "hand this live module to an agent running under a different
profile". It is used by `exec` (§4.1) and by an FSM transition (§3.4). One
primitive:

```rust
/// What a handoff carries. Computed two ways and applied one way.
pub enum TransferPlan {
    /// Every kind present in **both** the outgoing and incoming profiles — `exec`'s rule.
    Intersection,
    /// Exactly these kinds — an FSM transition's declared list.
    Explicit(Vec<ModuleKind>),
}

/// Apply `plan` to `old`, producing the successor's set under `profile`.
/// Returns the successor's set plus a report of what was transferred, dropped and
/// initialized (for telemetry and for the successor's opening note).
pub fn transfer(
    old: ModuleSet,
    profile: &GgAgentConfig,
    plan: &TransferPlan,
    ctx: &ModuleResolveCtx<'_>,
    agent_id: &str,
) -> (ModuleSet, TransferReport);
```

Algorithm, per kind in `ModuleKind` declaration order:

1. **Carried?** The kind is in the plan (`Intersection`: present in `old` *and*
   enabled on `profile`; `Explicit`: named in the list *and* present in `old`).
   A named kind that `old` does not hold is skipped with a `warn` — the
   transition's author asked for something the source state never had.
2. **Carried and adoptable?** Call `module.adopt(profile, agent_id)`.
   - `Ok(())` → the module moves into the successor's set, re-resolved
     (caps, mode, ownership, access, window limit, code mode, agent id, and both
     cursors re-pointed at the store head so the successor is not handed the
     predecessor's unread notices).
   - `Err(AdoptError::Disabled)` → **dropped** (a state that turns a capability
     off gets nothing).
   - `Err(AdoptError::Incompatible(reason))` → **dropped and re-initialized
     fresh**, and `reason` is appended to the successor's opening note so the
     model is told rather than left to discover an empty scratchpad. The one
     concrete case today is a memory-strategy mismatch: a scratchpad store cannot
     be re-rendered as a markdown index without silently changing both its
     semantics and its toolset.
3. **Not carried but enabled on `profile`?** Initialized fresh from `profile`'s
   params, exactly as `ModuleSet::resolve` would.
4. **Not carried and not enabled?** Absent.
5. Every dropped module's holder is drained (`drain_events()`) *before* it is
   dropped, on the outgoing agent's stream. Every transferred and every fresh
   module emits `state_events()` on the **successor's** stream immediately after
   the set is built — the console reduces per agent, so a module that arrived
   silently would leave the successor's panel empty.

Caps that were resolved from the *donor* profile are the classic transfer bug
(`memories.rs:625-626`, `tasks.rs:396-397`); `adopt` is the one place they are
re-resolved, and every module's `adopt` must do it. Contents already over a
newly-tightened cap are **kept**; further writes are refused by the existing cap
checks. Rationale: silently deleting a memory because the successor's profile is
stingier would lose work the run already paid for.

### 1.9 What is deliberately *not* a module

- **`DocsRuntime`** (`docs.rs:64`) — its `enabled` set is derived from the
  registry and its `role` from the ending role; both must be re-derived per
  incarnation anyway, and its `shown_*` ledgers are meaningless without the
  registry they name. Rebuilt per incarnation, like today.
- **`AgentPersistence` / `PersistenceSetup`** (`persistence.rs:86`, `:131`) —
  its state is run-global and keyed by *profile name*, not by instance, which is
  the opposite of a module. Unchanged, except that an exec must re-key its
  scheduler exclusivity (§4.2).
- **`CompactionSetup`, `CodeSetup`, `CompletionSetup`, `AmcSetup`,
  `AutoloadSetup`, `LimitsSetup`** — resolved configuration, not state. They are
  bundled into a new `DriveSetup` struct (§4.2) to shrink `drive`'s argument
  list, and re-resolved per incarnation.
- **`AgentCtx` / `ChildHandle` / `Scheduler` / `RunSpend` / `CancelWatch` /
  `GgRecorder` / `SessionSummaryTracker`** — single-consumer channels and
  run-global accumulators. Forking any of them corrupts the record; they are
  never modules.

---

## 2. Memory: linked instances and four scoping strategies

### 2.1 Config surface

Both new knobs are **params on the existing `memories` capability**, not new
capabilities — the `implementation` field is already spoken for by the memory
strategy (`scratchpad` / `markdown-index` / `keyword-search`,
`memories.rs:152-158`).

```jsonc
{
  "id": "memories",
  "enabled": true,
  "implementation": "markdown-index",
  "params": {
    "scope": "inherited",        // isolated | shared | inherited | read-only
    "ownership": "owned",        // owned | unowned   (every module-backed capability)
    "maxCount": 12
  }
}
```

New in `crates/core/src/gg.rs`:

```rust
/// The `scope` param on the [`memories`](CAPABILITY_MEMORIES) capability: which memory
/// instance an agent instance binds to.
pub const MEMORY_PARAM_SCOPE: &str = "scope";

#[derive(…, Serialize, Deserialize)]  // contract type
pub enum GgMemoryScope {
    /// A fresh instance per agent instance. Today's behaviour, and the default.
    Isolated,
    /// One instance per **agent profile**, shared by every instance of it in the run.
    Shared,
    /// A subagent binds its spawner's instance read/write; anything else gets its own.
    Inherited,
    /// As `inherited`, but this holder may not write.
    #[serde(rename = "read-only")]
    ReadOnly,
}

/// The `ownership` param every module-backed capability reads.
pub const MODULE_PARAM_OWNERSHIP: &str = "ownership";

#[derive(…)]
pub enum GgModuleOwnership { Owned, Unowned }
```

`Isolated`/`Shared`/`Inherited` serialize as `isolated`/`shared`/`inherited`
(snake_case), `ReadOnly` as `read-only` — kebab, matching the user-facing
spelling and the kebab house style already used for implementation ids
(`markdown-index`, `memory-compaction`).

Resolution follows the crate's standing rule (`agent.rs:677-681`): an
unrecognized `scope` or `ownership` value **falls back to the default and emits a
launch warning**; it never fails a launch.

### 2.2 Resolution rules at spawn

New run-global state on `Orchestrator`:

```rust
/// The memory instance each `shared`-scoped profile binds to, created on first use.
memory_registry: MemoryRegistry,   // Mutex<HashMap<String /*profile*/, Arc<Mutex<MemoryStore>>>>
```

And a new field threaded into every spawn:

```rust
/// The modules a spawned child may inherit from its spawner — Arc-aliases taken at the
/// spawner's own construction, so a spawn is a cheap handle copy rather than a lookup.
#[derive(Default)]
pub struct InheritedModules { pub memories: Option<MemoriesRuntime> }
```

`InheritedModules` is stored on `SubagentContext` (`agent.rs:1985-1990`, built at
`agent.rs:2282`), read by `dispatch_child` (`agent.rs:2816`), and carried on
`AgentRole::Sub { inherited, .. }`.

| Spawn site | `isolated` | `shared` | `inherited` | `read-only` |
| --- | --- | --- | --- | --- |
| **Root** (`run_with_factory`, `agent.rs:725`) | fresh | registry entry for the root profile | fresh (no spawner) | fresh, **writable** |
| **Issue dispatch** (`spawn_issue_agent`, `agent.rs:1625`) | fresh | registry entry | fresh (top-level, no spawner) | fresh, **writable** |
| **`spawn_subagent` / workflow stage / speculation attempt** (`dispatch_child`) | fresh | registry entry | `share()` of `inherited.memories` when the spawner has one, else fresh | as `inherited`, holder `access = ReadOnly` |
| **Reviewer / judge / merge agent** (`run_detached_agent`, `agent.rs:3651`) | fresh | registry entry | fresh — `InheritedModules::default()` is passed | fresh, writable |
| **Second instance of the same profile, in parallel** | separate | **the same store** (linked) | each takes its own spawner's | each takes its own spawner's |
| **`fork`** (§4.4) | `fork()` — independent copy | `share()` (already profile-bound) | `share()` of the forker's | `share()`, holder read-only |
| **`exec` / FSM transition** (§1.8) | transferred if both profiles enable memories and strategies match | rebinding: the successor's own `scope` decides — a successor scoped `shared` binds the registry entry for **its** profile rather than adopting the predecessor's store | transferred | transferred, access from the successor's own `scope` |

Two rules make the table coherent and must be stated in the docs:

1. **`read-only` only ever restricts an inherited handle.** An agent that gets a
   fresh instance under `read-only` can write it — a private notebook nobody may
   write is not a feature.
2. **Access is a property of the holder, not the store.** So a `read-only`
   agent's `inherited` subagent gets a **read/write** handle onto the same store,
   exactly as the requirement specifies. Nothing on the store records who may
   write it.

### 2.3 The write-permission model

Enforcement is at the **registry**, backed by a defensive check on the code path:

- `ToolRegistry::from_run` (`tools/mod.rs:647-676`) reads
  `modules.memories().access()`. Under `ReadOnly` it offers only
  `ReadMemoryTool` (file-shaped strategies) and `SearchMemoriesTool`
  (keyword-search), and **not** `DeleteMemoryTool`, which is unconditional today.
  Because `scope_tools` derives from the registry (`sandbox.rs:276-282`) and the
  prompt's API objects derive from `scope_tools` (`agent.rs:7381`), gating here
  gates the responses-as-code surface and the prompt in one move — and, crucially,
  it gates by *capability configuration* rather than by tool name, so the wasm
  guest needs no change for this feature.
- Under **`scratchpad`** + `read-only` the holder gets **no memory tools at all**
  (scratchpad has no read call — the content is the pinned block). That is
  coherent: it reads memories by having them in its window. `announce_configuration`
  logs it; if the module is also `unowned`, the launch **warns** that the agent can
  neither see nor write its memories.
- `LoopToolApi`'s five mutating methods (`agent.code.rs:1395-1465`) each begin
  with `if self.memories_rt.access().is_read_only() { return refused(...) }` —
  the belt to the registry's braces, so a stale program cannot reach a write.
- New `MemoryError`-adjacent refusal text lives beside the existing ones in
  `tools/memories.rs`, classed `ToolFailure::Refused` (`tools/data.rs:502`).
- **Prompt.** `MemoriesView` (`prompts.rs:612-635`, built at `agent.rs:7613`)
  gains `read_only: bool`. `system-tools.hbs:17-46` and `system-code.hbs:63-92`
  currently open every strategy paragraph with "Write memory files regularly…";
  add a read-only variant of each that says the memories are another agent's,
  names the read call, and states that writes are refused.
- **Compaction gap (real bug, fix it here).**
  `CompactionStrategy::resolve(implementation, memories_enabled)`
  (`compaction.rs:206`) demotes `memory-compaction` only when memories are *off*.
  A read-only holder configured with `memory-compaction` would be told to record
  its state with calls it cannot make, and `PendingCompaction::MemoryWrites`
  (`compaction.rs:295-328`) could never be satisfied — the run wedges on a full
  window. Change the signature to
  `resolve(implementation, memories_writable: bool)` and pass
  `memories.enabled() && !memories.access().is_read_only()`, with a launch
  warning when the demotion fires.

### 2.4 The "new memory added" notification

**Where it is injected.** At the turn boundary, in `drive`'s assembly, in the
slot immediately after the parent-inbox drain (`agent.rs:5293-5301`) and before
the pinned-block refreshes:

```rust
for notice in modules.notices() {
    context.push(GgContextSource::Memory, Retention::Ephemeral, notice);
}
```

`ContextModel::push` appends at the tail (`context.rs:519`). It is **not**
`replace_source`, and it is **not** the usage-signal slot.

**What it contains.** Rendered from a new template
`crates/gg/templates/memory-notice.hbs` through `prompts.rs` (one
`MemoryNoticeContext { entries: Vec<MemoryNoticeEntry>, read_call: Option<String>,
inline_bodies: bool }`), producing:

```
Another agent sharing your memories has made changes since your last turn:

- added `deploy-runbook` — how the staging cluster is rolled
- updated `api-conventions` — error envelope + pagination rules
- deleted `scratch-notes`

Read one with `read_memory` if it bears on what you are doing. Your memory index
is unchanged until your next compaction.
```

Under `scratchpad` there is no read call, so the notice carries each new
memory's **name, description and body** inline (already bounded by
`maxLenPerMemory`) instead of a pointer. A notice must be actionable; a pointer
to a call the agent does not have is not.

Deletions and updates are included (an agent acting on a memory that has since
been deleted is the failure mode the notice exists to prevent). Entries are in
log order, and consecutive entries touching the same slug collapse to the last
one so a busy sibling produces one line per memory, not one per write.

**Why it does not perturb the cached prefix.** The whole previous request is a
byte-identical prefix of this one, so the anchor and both grid breakpoints
(`client.rs:749-781`) still hit; only the tail marker moves — which is exactly
what it is for. It costs the notice's own tokens once (uncached on the turn it
lands, cached from the next turn on), and it **only exists on turns where a
linked write actually happened**, so a run with no linked activity pays nothing.
Contrast the three shapes that would have been wrong: interpolating it into the
system prompt (item 0) re-bills the entire request, tool schemas included, every
turn; editing the pinned Memory block in place invalidates everything after it;
deleting the previous turn's notice when adding this turn's invalidates the
suffix. None of those is done.

**Watermarks.** Per-holder `notice_cursor` into the store's append-only log
(§1.7), advanced when the notice is rendered — so a notice is delivered exactly
once per holder, and a holder's own writes never produce one (they are already in
its thread as a call plus a confirmation).

**Across compaction.** The notices are `Ephemeral`, so `clear_ephemeral`
(`context.rs:975`) sweeps them, and `refresh_memory_block` (`agent.rs:7857`) runs
immediately before the sweep — so everything the notices announced is in the
rebuilt pinned block or index that crosses the boundary. The `notice_cursor` is
**not** rewound: news already delivered is not re-delivered, and anything the
agent did not act on is now in the block.

**The index is untouched.** `MemoriesRuntime::context_block` keeps `Refresh::AtBoundary`
and its existing content. That is the requirement, and it is also what keeps the
cached prefix stable: an index that moved every time a sibling wrote would
supersede-and-append every turn.

### 2.5 Telemetry and console

`GgTelemetryKind::MemoryState` (`crates/core/src/gg.rs:3504`) gains two fields,
both `#[serde(default)]` so a legacy record still parses:

```rust
/// The [scope](GgMemoryScope) this holder binds under — how the console badges a shared
/// panel. Empty on a record written before scoping existed.
scope: String,
/// Whether this holder may write. `false` marks a read-only inherited handle.
writable: bool,     // #[serde(default = "default_true")]
```

`MemoryRevision` is unchanged: it is already stamped with the emitting agent by
the envelope, and §1.7 guarantees the emitter is the author.

Console (`packages/ui/src/app/pages/runs/gg/`): `MemoriesList.tsx` gains a badge
row rendering `scope` (with "read-only" styling when `!writable`); the linked
notice needs no new UI (it appears in the context feed as an ordinary Memory-band
message). `useGgRunState.ts` — remember `rg -a` — carries the two fields through
`case "memory_state"` (`:1588-1601`).

---

## 3. FSM agents

### 3.1 The config schema

The `fsm` capability id survives; **everything behind it is replaced**. It is now
a declaration of states and transitions over the run's *other* agent profiles. A
profile carrying an enabled `fsm` capability is an **FSM shell**: it has no turns
of its own, it only says which agent starts and where each one may go.

```jsonc
{
  "name": "Feature",                    // the FSM agent, namable like any other agent
  "capabilities": [
    {
      "id": "fsm",
      "enabled": true,
      "params": {
        "states": [
          {
            "name": "explore",
            "agent": "Explorer",
            "transitions": [
              { "to": "build", "transfer": ["history", "tasks"],
                "description": "when you understand the change and have a task list" }
            ]
          },
          {
            "name": "build",
            "agent": "Builder",
            "transitions": [
              { "to": "verify", "transfer": ["history", "tasks", "memories"],
                "description": "when the change compiles and you are ready to check it" },
              { "to": "explore", "transfer": ["memories"],
                "description": "when the change turns out to need more understanding" }
            ]
          },
          { "name": "verify", "agent": "Verifier", "transitions": [] }
        ]
      }
    }
  ]
}
```

Contract types in `crates/core/src/gg.rs` (registered in
`crates/contract-codegen/src/main.rs:188-212` `ts_decls!` **and** in the
`gg/capability-set.schema.json` `owns` list at `main.rs:344-356`, or they will
not be emitted):

```rust
pub const FSM_PARAM_STATES: &str = "states";

pub struct GgFsmState {
    pub name: String,
    pub agent: String,
    #[serde(default)] pub transitions: Vec<GgFsmTransition>,
}

pub struct GgFsmTransition {
    pub to: String,
    #[serde(default)] pub transfer: Vec<GgModuleKind>,
    #[serde(default)] pub description: String,
}

pub enum GgModuleKind { History, Memories, Tasks, Board, Skills, Archive }
```

They are the documented shape of one `params` key, not fields on
`GgCapabilityConfig` — `params` stays `serde_json::Value` (`gg.rs:1315`), so no
wire change to the capability container is needed. gg parses them with
`serde_json::from_value::<Vec<GgFsmState>>(params["states"].clone())`.

`transfer` is **explicit**: an absent or empty list transfers nothing (a hard
reset between states). Magic defaults on a transfer list would be exactly the
sort of decision a reader of a recorded configuration cannot see; the editor
instead pre-fills `["history"]` on every transition it creates, so the common
case is one click and the recorded document still says what it does.

**Entry state** is `states[0]` — position, not a flag, matching how the set's
root agent is already defined (`GgCapabilitySet::root`, `gg.rs:740`).
**Terminal states** are those with no transitions; they end the FSM agent by
`finish` (or their role's ending), and that ending is the FSM agent's return value
to whoever put it to work.

### 3.2 How an FSM agent runs

An FSM shell is namable everywhere an agent profile is namable: as the run's root
(`agents[0]`), as a `spawn_subagent` target, as an issue implementer, as a
workflow stage. When `run_agent` is entered for a profile with an enabled `fsm`
capability:

1. `FsmSpec::resolve(profile, &set)` builds the state table (a `BTreeMap<String,
   FsmStateSpec>` plus the entry name).
2. The agent's **first incarnation** runs under the entry state's `agent`
   profile, with `Agent::fsm = Some(FsmPosition { fsm: <shell profile name>,
   state: "explore", outgoing: [...] })`.
3. A `transition_state` call ends that incarnation with a `Handoff` (§4.1) whose
   profile is the target state's `agent`, whose plan is
   `TransferPlan::Explicit(transition.transfer)`, and whose reason is
   `HandoffReason::Fsm { from, to }`.
4. The incarnation loop in `run_agent` (§4.2) builds the next incarnation. The
   whole FSM agent is **one `run_agent` invocation**: one scheduler slot, one
   parent-wait registration, one `AgentReturn`. That is what makes an FSM agent
   indistinguishable from an ordinary agent to whoever spawned it.
5. `Agent.slot` (the accounting key) is the **state's agent profile** for each
   incarnation, so `SlotUsage` splits an FSM run per state agent, which is the
   figure a study wants.

The FSM shell's own model binding and capabilities are **ignored**.
`validate_agents` (`agent.rs:432`) is amended so a shell is exempt from the
"non-empty model id" check, and `Orchestrator::build` emits a launch warning if a
shell declares any capability other than `fsm`.

### 3.3 The transition tool

- **Name:** `transition_state`. Added to `ALL_TOOL_NAMES` (`tools/mod.rs:155`).
- **Schema:** `{ state: string, note?: string }`, `additionalProperties: false`,
  `required: ["state"]`. `note` is the successor's opening message (§4.1); it is
  the same field `spawn_subagent`'s `prompt` is, and it is optional here because
  a transferred history usually says everything.
- **Description:** enumerates the allowed targets with their `description`s, built
  by the same helper shape as `agent_menu` (`tools/subagents.rs:31-47`) so the
  model is told exactly which names it may pass — the requirement's "exactly the
  way subagent spawning names an agent".
- **Offered when** `AgentFacts.fsm` is `Some` and the current state has ≥1
  outgoing transition. A terminal state is not offered the tool at all, so the
  offered tool set is a function of the state and stays stable within an
  incarnation (the offered set is part of the cached prefix — `tools/mod.rs:726-731`).
- **Validated at the call:** an unknown or non-outgoing `state` is refused with
  `ToolFailure::InvalidArgument` enumerating the allowed targets; the agent stays
  where it is and the run continues.
- **Deferred**, exactly as `compact` and the ending calls are
  (`agent.rs:6053-6110`): captured during dispatch, applied after every tool
  result of the turn is recorded. A `transition_state` in a turn that also
  declared an ending loses to the ending (the agent finished; a successor would
  have nothing to do), and the refusal says so.

### 3.4 Modules the transition does not carry

Dropped: drained onto the outgoing incarnation's stream, then deleted (§1.8 step
5). Concretely, a transition declaring `transfer: ["history"]` from a state whose
agent had a task list means the successor starts with an **empty** task list even
if its own profile enables tasks — which is the point of naming the transfers.
The successor's opening note (§4.1) lists what it received and what it did not,
so the model is never left inferring it from an empty tool response.

### 3.5 Telemetry

`GgTelemetryKind::FsmState` is **redefined** (the old
`{ machine, state, state_index }` is deleted outright, per the no-back-compat
decision):

```rust
/// The FSM agent moved into a state: which machine (the shell profile), which state, the
/// agent profile the state runs, and the state it came from (`None` for the entry state).
FsmState {
    fsm: String,
    state: String,
    agent: String,
    #[serde(default)] from: Option<String>,
},
```

and a new kind carries every succession, FSM or not:

```rust
/// One agent instance was replaced by (or cloned into) another: `exec`, `fork`, or an FSM
/// transition. Carries what each module did, so the console can show a handoff as a handoff
/// rather than as an unexplained second agent.
AgentTransition {
    kind: GgAgentTransitionKind,      // exec | fork | fsm
    to_agent_id: String,
    #[serde(default)] state: Option<String>,   // the FSM state, when `kind == fsm`
    agent: String,                    // the successor's profile
    transferred: Vec<String>,         // module kinds
    dropped: Vec<String>,
    initialized: Vec<String>,
},
```

It is emitted on the **outgoing** agent's stream (the envelope already carries
`agent_id`), immediately before the successor's `AgentSpawned`.

### 3.6 Relationship to `exec` — the shared code

An FSM transition **is** an `exec` with an explicit transfer list. Both build the
same value and go through the same function:

```rust
struct Handoff {
    profile: String,                 // the successor's agent profile
    plan: TransferPlan,
    message: Option<String>,         // the successor's opening note
    reason: HandoffReason,           // Exec | Fsm { from: String, to: String }
    fsm: Option<FsmPosition>,        // Some for an FSM transition, carrying the new position
}
```

`drive` returns `LoopEnd { handoff: Option<Handoff>, .. }`; `run_agent` applies
it. `exec` produces `plan: TransferPlan::Intersection, fsm: None`;
`transition_state` produces `plan: TransferPlan::Explicit(...), fsm:
Some(next_position)`. There is exactly one `apply_handoff` in `agent.rs`, and the
difference between the two features is two lines at the capture site.

### 3.7 Launch validation (hard failures)

Added to `validate_agents` (`agent.rs:432-506`), because these are structural in
exactly the way "a roster reference names an undeclared profile" already is — a
run with them is not a differently-configured run, it is an unrunnable one:

- an enabled `fsm` capability whose `states` is absent, unparseable, or empty;
- a state with an empty name, or two states with the same name;
- a state whose `agent` names a profile the set does not declare;
- a transition whose `to` names a state the machine does not declare;
- an FSM shell that is itself named as a state's `agent` (a shell cannot be a
  state — it would recurse).

Non-fatal launch **warnings**: a `transfer` entry naming an unknown module kind
(skipped); a state unreachable from the entry state (kept, but it will never
run); an FSM shell declaring capabilities other than `fsm`.

---

## 4. `fork` and `exec`

### 4.1 `exec`

New capability, so an operator can ablate the pair:

```rust
/// Agents may replace themselves (`exec`) and clone themselves (`fork`).
pub const CAPABILITY_AGENT_TRANSITIONS: &str = "agent-transitions";
```

Tools `exec` and `fork`, each its own `toolAblation` slider in the console
catalogue.

**Schema.**

```jsonc
// exec
{
  "type": "object",
  "properties": {
    "agent":  { "type": "string", "description": "The agent to continue as (one of: …)." },
    "prompt": { "type": "string", "description": "What the new agent should do next; it \
                 inherits your conversation and any state you both keep." }
  },
  "required": ["agent"],
  "additionalProperties": false
}
```

**Target validation.** `agent` must appear in the caller's roster with the
`Subagent` scope (`GgAgentConfig::can_spawn`, `gg.rs:1056-1084`) — the same
allowlist spawning uses. A fourth scope for "may be exec'd into" is not worth the
contract surface; putting a profile to work is putting a profile to work.
Naming yourself is legal (it re-initializes the capabilities you both have — a
deliberate self-reset).

**The algorithm**, keyed on capability presence, is `TransferPlan::Intersection`
in §1.8:

- present in the old set, absent from the new profile → **dropped**, its backing
  store deleted;
- present in both → **transferred**, state persists, config re-resolved (this is
  what makes the successor see the predecessor's full conversation: `history` is
  present in every set);
- absent from the old set, present in the new profile → **initialized fresh**.

**Deferred and turn-final.** `exec` is captured during dispatch exactly as an
ending is (`agent.rs:6300-6317`), applied after every tool result of the turn is
recorded, and ends the incarnation. A second `exec` (or an `exec` after a
`transition_state`) in the same turn is **refused** — first wins. Unlike
`compact`, where last-wins is harmless because compaction is idempotent, a
silently replaced successor identity is a surprise the model cannot see.

**The opening note.** After the successor's modules are built, `run_agent`
pushes one ephemeral `GgContextSource::System` user message at the tail of the
transferred window:

```
You are now running as agent `Builder`. Your predecessor's conversation, task list and
memories carried over; its thread archive did not.

<the exec prompt, when one was given>
```

When history was **not** transferred (only possible through an FSM transition
that omits it), the successor is seeded like a fresh agent instead: system
prompt, then the handoff message as its build prompt, falling back to the run's
own prompt when the transition gave none.

### 4.2 The incarnation loop in `run_agent`

`run_agent` becomes:

```
acquire slot (unchanged, agent.rs:2033)
loop {
    resolve profile, client, model_id                       // per incarnation
    build modules:  first pass  → ModuleSet::resolve(...)
                    later pass  → transfer(previous, profile, plan, ...)
    rebase history (system prompt + build prompt for THIS profile)
    re-emit state_events() for every module on this incarnation's stream
    if compaction.should_compact(history) { apply_compaction(...) }      // §4.3
    build registry / tool_ctx / DriveSetup / subagent + project contexts
    emit AgentSpawned (+ AgentTransition on the predecessor's stream)
    end = drive(&mut modules, ...)
    fold accounting for THIS incarnation (end.slot, end.tokens, end.cost)
    match end.handoff {
        Some(h) => { rekey scheduler exclusivity; agent = agent.succeed(next_id, h.profile, h.fsm); continue }
        None => break end,
    }
}
role epilogue (unchanged: Root / Issue reconcile / Sub return)
```

Concrete consequences the implementer must get right:

- **One slot for the whole succession.** No release/re-acquire; the run is
  continuous and a transition must not queue behind unrelated work.
- **Exclusivity re-key.** The agent-persistence exclusivity key is derived from
  the profile name (`persistence.rs:74`, `agent.rs:1307`) and changes across an
  exec. Add `Scheduler::rekey(&self, old: Option<&str>, new: Option<&str>)`,
  which — when the new key is held by another agent — blocks this agent through
  the existing blocked/ready machinery (`subagents.rs:442-470`) rather than
  spinning or deadlocking.
- **Persistence is not recorded on an exec.** `persistence.record` runs only on a
  *finished* agent (`agent.rs:6306`, `:5779`); an incarnation that handed off did
  not finish. Documented, not incidental.
- **Ids.** Each incarnation takes a fresh id from `orch.next_agent_id()`
  (`agent.rs:1239`), `parent_id` = the **previous incarnation's id**, and the
  **same `depth`**. Succession is not delegation: incrementing depth would let a
  long FSM exhaust `max_depth`, and the depth cap exists to bound the delegation
  tree.
- **Telemetry streams.** A fresh agent id means a fresh `MessagePool`
  (`telemetry.rs:174`), so the successor's first `Prompt` re-emits every
  `ContextMessage` definition it references. That is exactly right — the console
  reduces per agent and each incarnation's stream must be self-contained — and it
  is the reason a new id is minted rather than the old one reused.
- **`is_root` is sticky.** The role does not change across incarnations, so
  `record_limit_hit` (`agent.rs:813`) and the root-only epilogue keep working.
  `record_effective_tools` / `record_execution_mode` / `announce_configuration`
  (`agent.rs:2169-2206`) run on the **first** incarnation only; later ones log an
  info line naming the new profile, so the durable ablation facets stay
  single-valued.
- **`drive`'s argument list collapses** from 26 to 12: `modules: &mut ModuleSet`
  absorbs skills/memories/tasks/board/archive/history, and a new
  `DriveSetup { limits, context, compaction, amc, autoload, persistence, code,
  completion, read_policy, shell_offload, speculative, ending_role }` absorbs the
  configuration structs. Keep `#[allow(clippy::too_many_arguments)]` off it — the
  point of the refactor is that it is no longer needed.

### 4.3 Compaction on `exec`

Fired **after** the transfer and rebase and **before** the successor's first
turn, using the **successor's** `CompactionSetup` (its threshold, its strategy,
its handoff model) and the successor's window limit:
`if compaction::should_compact(&history, &setup) { apply_compaction(...) }`.

An agent whose window is 200k moving into a state on a 32k model is exactly the
case this exists for. gg does not try to be clever about the model mismatch: if
the two windows differ greatly the operator is expected to configure a compaction
strategy whose summarizer runs on a separate model (the existing
`compaction.model`/`modelSlot` handoff, `agent.rs:2216-2239`). That is a user
concern, and the docs must say so in those words.

### 4.4 `fork`

**Schema.**

```jsonc
{
  "type": "object",
  "properties": {
    "prompt": { "type": "string",
                "description": "What the copy of you should do that you will not." }
  },
  "required": ["prompt"],
  "additionalProperties": false
}
```

**Offered when** the `agent-transitions` capability is on **and** the agent has a
delegation context (`subagents` or `workflows` — `Orchestrator::delegation_enabled`,
`agent.rs:1257`). A fork is a child that must be waitable and messageable; without
the delegation machinery there is nothing to collect it with. The tool
description says so.

**Mechanics.**

1. Depth cap checked exactly as `dispatch_child` checks it (`agent.rs:2830`) —
   a fork is a child.
2. New id from `orch.next_agent_id()`; `parent_id` = the forker; `depth + 1`;
   **same profile**, so the same model, toolset, system prompt and ending role.
3. Modules: `fork()` for everything except memories under `shared` /
   `inherited` / `read-only` (which `share()`), the board (always `share()`), and
   the skills library (shared `Arc` inside `fork()`). Per-kind rules in §1.6.
4. The forked window is the forker's window **deep-copied**, with one ephemeral
   user message appended at the tail:

   ```
   You were forked from agent `agent-7` at turn 24. Everything above is the conversation
   you were forked from. Your instructions from here:

   <the fork prompt>
   ```

   Nothing is rebased (same profile ⇒ identical system prompt) and `turn` is not
   reset, so any `archive_thread` reference either copy makes still names the
   same turns.
5. Registered in the forker's `ChildHandle` list (`agent.rs:2890`) so
   `wait_for_subagents` and `send_message` work on it with no special cases, and
   spawned through `dispatch_child`'s tail (`tokio::spawn(run_agent(...))`,
   `agent.rs:2886`) with `AgentRole::Sub { brief: <fork prompt>, .. }`.
6. The forker gets an ordinary tool result — the same
   `ToolData::SubagentSpawned(SubagentHandleData { id, slot, model_id })` sidecar
   `spawn_subagent` produces (`agent.rs:2699-2703`) — so the console's existing
   spawn affordances light up unchanged.
7. The fork acquires its **own** scheduler slot inside `run_agent`
   (`agent.rs:2033`) like any child, and contends for parallelism normally.
8. Telemetry: `AgentTransition { kind: fork, .. }` on the forker's stream, then
   the fork's own `AgentSpawned`.

**`fork` × memory scope**

| Scope | The fork's memories |
| --- | --- |
| `isolated` | Independent deep copy — the two diverge |
| `shared` | The same profile-bound instance (they were already one) |
| `inherited` | `share()` of the forker's instance, read/write; both are now linked holders and both get notices |
| `read-only` | `share()` of the forker's instance; the fork's access is `ReadOnly` because its own profile says so |

### 4.5 Responses-as-code

All three new tools are real tools that a program may call, not withheld
transitions:

- **`fork`** dispatches immediately and returns the new agent's id, exactly as
  `spawn_subagent` does (`agent.code.rs` delegation family, via `block_on`).
- **`exec` and `transition_state`** are **deferred declarations**, the shape
  `context.compact(...)` already has (`CodeTurnState::compact_requested`,
  `agent.code.rs:768-777`): they set a host-side flag, return normally, the
  program keeps running, and the loop applies the handoff once the program has
  ended. First declaration wins; a later one is refused. Rewriting the agent a
  program is running inside would pull the window out from under the turn still
  using it.

Because the deleted `enter_plan_mode` / `submit_plan` / `advance_state` were the
**entire** contents of `TURN_LEVEL_TOOLS` (`tools/mod.rs:189`), that constant and
the concept behind it are deleted, along with the WIT `turns` interface
(`crates/gg/wit/gg-sandbox.wit:546-558`, `import turns;` at `:856`), its host
implementation (`crates/gg/src/sandbox/membrane/turns.rs` + its test), the
`refuse_turn_level` helper (`membrane.rs:468-489`), and the guest declaration
block (`packages/gg-sandbox/src/membrane.d.ts:420-435`). `scope_tools`
(`sandbox.rs:276-282`) becomes `registry.tool_names()`.

The three new functions go on the **`delegation`** interface
(`gg-sandbox.wit:671`), where the rest of "put an agent to work" already lives.

> **Artifact regeneration is mandatory.** The WIT world changes, so
> `crates/gg/src/sandbox/gg-sandbox.component.wasm` and
> `crates/gg/src/sandbox/signatures.json` go stale and gg's `bound-tools` /
> `the_component_binds_exactly_the_tools_gg_offers` tests fail until they are
> rebuilt: `bash packages/gg-sandbox/build.sh` then
> `npm run -w @test-cabinet/gg-sandbox signatures`. The pinned
> `componentize-js@0.21.0` the script fetches through `npx` **is already present
> in the local npx cache** (`~/.npm/_npx/3d03f07022ffd59f/node_modules/@bytecodealliance/componentize-js`,
> verified), so the rebuild works in this devcontainer without network; if `npx`
> tries to reach the registry anyway, invoke the cached binary directly. Commit
> the regenerated wasm and `signatures.json` with the stage-3 change, and say so
> loudly in the commit body — it is a multi-megabyte binary diff.

Also update the guest SDK (`packages/gg-sandbox/src/tools/delegation.ts`), the
catalogue (`packages/gg-sandbox/src/catalogue.ts:17-20`, `:149` — the "35 entries,
not 38" paragraph and the `boundTools() == ALL_TOOL_NAMES \ TURN_LEVEL_TOOLS`
claim both become `boundTools() == ALL_TOOL_NAMES`), `types.ts:41`,
`README.md:37-38, :51`, and `signatures.test.rs:44` / `membrane.test.rs:38`.

---

## 5. Removals — the complete deletion list

No backwards compatibility. Historical runs rendering nothing for these panels is
accepted.

### 5.1 Core contract (`crates/core/src/gg.rs`)

Delete: `CAPABILITY_PLANNING` (`:421-435`); `CAPABILITY_FSM`'s **body** stays but
its rustdoc is rewritten (`:475-495`); `enum GgPlanPhase` (`:2322-2345`);
`GgTelemetryKind::Planning` (`:3672-3692`); the old
`GgTelemetryKind::FsmState { machine, state, state_index }` (`:3912-3932`,
replaced per §3.5); `GgContextSource::Plan` (`:1806-1810`) and its `ALL` entry
(`:1822`, `ALL` becomes `[GgContextSource; 10]`).

> Deleting the `Plan` context source is safe on the Rust side: the only Rust
> consumer of `GgTelemetryKind` is `crates/core/src/gg_exec.rs:616-740`, which
> parses the **live** stream of the gg binary it just launched, never stored
> history. Stored events are re-read only by the TypeScript console, which
> tolerates an unknown source string.

Rewrite prose at `:29`, `:469-472`, `:543-544`, `:559-566`, `:1305`, `:2024`,
`:2845`, `:2909`, `:3565`; and `crates/core/src/gg_aggregate.rs:217, 622-623`.
Codegen: drop `gg::GgPlanPhase` from `crates/contract-codegen/src/main.rs:201`
and `"GgPlanPhase"` from `:399`.

### 5.2 gg runtime

Delete whole files: `crates/gg/src/planning.rs`, `planning.test.rs`,
`crates/gg/src/tools/planning.rs`, `crates/gg/src/tools/fsm.rs`,
`crates/gg/src/sandbox/membrane/turns.rs`, `turns.test.rs`.
`crates/gg/src/fsm.rs` and `fsm.test.rs` are **rewritten**, not deleted (§3).

`lib.rs`: drop `mod planning;` (`:41`); `mod fsm;` stays.

`agent.rs`, in the order the survey found them (verified against the tree):
imports `:100` (`GgPlanPhase`), `:124`, `:139`, `:144`, `:161-168`; the runtime
resolution at `:2108-2124`; the announce plumbing `:2177-2183`, `:2442-2443`,
`:2499-2505`, `:2527-2546`, `:2563-2589` (`announce_fsm`, including the stale
`review-gated` string at `:2585`); the whole FSM section `:4385-4568`
(`AdvanceResult`, `handle_advance_state`, `advance_owned`, `push_state_guidance`,
`fsm_state_event`, `fsm_refusal`); loop params `:5040-5041`; `:5063-5064`,
`:5108-5109`; the entry-state block `:5177-5186`; `in_plan_mode` `:5199-5203`;
the per-turn filter `:5414-5446`; the code-turn plumbing `:5712-5717`;
`submitted_plan` `:6006-6018`; the dispatch guards `:6111-6130`; the planning
tool branch `:6214-6262`; the plan→implement reset `:6266-6295`; `PromptInputs`
fields `:7296-7299`, `:7508-7509`, `:7576`, `:7652-7655`; `code_heading_views`'s
`plan` row `:7418`, `:7466-7469`; `plan_mode_refusal` `:7711-7737`.

`agent.code.rs`: `:706-719`, `:788`, `:845-852`, `:988`, `:1025-1032`,
`:1040-1050`, `:1067-1097` (the plan/FSM arms of `gate()`).

`client.rs` (mock scripts): `:51`, `:1580-1676` (`with_planning_script`),
`:1838-1910` (`with_fsm_tdd_script`), `:2218-2224`, `:2743-2749`, `:2769-2770`.

`tools/mod.rs`: `:53`, `:55`, `:68-69`, `:107`, `:112`, the three names in
`ALL_TOOL_NAMES` (`:165-167`), `TURN_LEVEL_TOOLS` + its rustdoc (`:176-189`),
`is_read_only_tool` (`:252-257`), `plan_mode_offers` (`:264-278`), the registry
doc (`:601-602`) and the two registration blocks (`:745-759`).

Peripheral prose: `context.rs:627, :952, :955-956, :1286, :1330`;
`summary.rs:354-355`; `tools/subagents.rs:8`; `tools/data.rs:502`;
`Cargo.toml:21`; `README.md:97`.

### 5.3 Prompts and templates

Delete `crates/gg/templates/plan-mode.hbs`, `plan-framing.hbs`,
`fsm-tdd-write-tests.hbs`, `fsm-tdd-implement.hbs`, `fsm-tdd-verify.hbs`,
`fsm-plan-first-plan.hbs`, `fsm-plan-first-implement.hbs`.

`prompts.rs`: module doc `:5, :8, :26`; `PLAN_MODE_TEMPLATE` /
`PLAN_FRAMING_TEMPLATE` `:116-120`; the five `FSM_*_TEMPLATE` consts `:210-221`
and their registrations `:232-233, :268-275`; `SystemContext { planning, fsm }`
`:438-441`; `struct FsmView` `:686-691`; the Planning section `:1142-1169`; the
FSM guidance section `:1544-1581`. `system-tools.hbs` / `system-code.hbs` need
no edit for the removal (they never read those fields) — they *do* need the
read-only memory paragraphs from §2.3.

### 5.4 Console

Delete `packages/ui/src/app/pages/runs/gg/PlanView.tsx` and `FsmStateStrip.tsx`
(the FSM strip is **replaced** by a new state-path strip in stage 5 — new file,
new shape; do not try to evolve the old one).

`useGgRunState.ts` (`rg -a`): `:29`, `:63-66`, `:380-397` (`PlanState`),
`:437-450` (`FsmProgress`), `:560-574`, `:672-692` (`planPhaseFeed`), `:779-791`,
`:900-902`, `:1262`, `:1270`, `:1273-1278`, `:1642-1657`, `:1683-1692`,
`:1789-1799`, `:1844-1846`, `:1852`.

`GgAgentsExplorer.tsx` `:47, :61, :73, :105, :124, :157, :170, :188, :619,
:648-657, :915`; `GgDashboard.tsx` `:6, :10, :74, :101, :136, :225-228`;
`GgRunMonitorPage.tsx` `:37, :111`; `RunGgPage.tsx` `:17, :114`;
`ContextFillGraph.tsx` `:56, :71, :91, :109, :213-216, :225, :275-281`;
`ggCatalog.ts` `:247, :488-497, :927-936` (the `planning` entry) and `:984-999`
(the old `fsm` entry — replaced, §6); `ggIcons.tsx` `:6` and `PlanIcon`;
`GgPanels.module.scss` `:59-60, :831-928, :1755-1841`;
`FeedView.module.scss:92-93, :110, :113, :117, :121-122`.

### 5.5 Docs

Delete `apps/docs/src/content/docs/gg/planning.md`; rewrite
`apps/docs/src/content/docs/gg/fsms.md` wholesale. Sidebar
`apps/docs/astro.config.mjs:545` (remove `gg/planning`), `:553` (keep `gg/fsms`),
plus the two new pages from §7.

Cross-references to rewrite: `gg/overview.md:28, :98, :241-242, :257-259`;
`gg/prompts.md:22, :60, :78`; `gg/configurations.md:217, :234`;
`gg/telemetry.md:43`; `gg/responses-as-code.md:237, :472, :480-482, :489-492`;
`gg/workflows.md:18`; `gg/speculative-execution.md:15`;
`gg/execution-limits.md:71, :139`; `gg/agent-managed-context.md:81`;
`gg/result-aggregation.md:12`; `gg/project-management.md:40`.

### 5.6 Tests

Delete `crates/gg/src/planning.test.rs`, `crates/gg/src/sandbox/membrane/turns.test.rs`;
rewrite `crates/gg/src/fsm.test.rs`.

Excise: `agent.test.rs` `:16, :24, :29, :36`, the planning section `:4040-4312`,
the FSM section `:7610-7790`, the ~17 `PlanningRuntime::disabled(),
FsmRuntime::disabled()` call-site pairs (`:245-246, 939-940, 996-997, 1054-1055,
1153-1154, 1466-1467, 1521-1522, 2418-2419, 2610-2611, 2778-2779, 2865-2866,
3064-3065, 3382-3383, 3549-3550, 3639-3640, 3816-3817, 4006-4007`) and the
harness builder fields `:1873-1874, :1895-1896, :1927-1928` — most of which
collapse into the new `ModuleSet`/`DriveSetup` construction anyway;
`agent.compaction.test.rs:52-53`; `agent.persistence.test.rs:94-95`;
`tools/mod.test.rs:550-584, :586-617, :722-723, :747-748, :900-925`;
`prompts.test.rs:85-88, :769, :779, :1291-1305, :1438, :1648-1662`;
`sandbox/signatures.test.rs:10, :44-49`; `sandbox/membrane.test.rs:21, :38`;
`crates/core/src/gg.test.rs:640-654`;
`GgRunMonitorPage.test.tsx:120, :124, :345-357, :527, :703-706, :743, :759,
:856-860, :1406-1420`; `GgDashboard.test.tsx:142`.

**Not affected** (verified): the string `"planning-A"` in
`runSummary.test.ts`, `runColumns.test.tsx`, `RunLog.test.tsx`,
`snapshot.test.rs`, `jobs.test.rs`, `gg_aggregate.test.rs`, `gg.test.rs:129` is
an arbitrary *preset name*, not the capability. `crates/cli`, `crates/driver`,
`crates/backend` (non-test) and `crates/artifacts` contain zero references.
`runs/` contains no recorded `planning` or `fsm_state` events.

---

## 6. Capability-set schema: every backwards-incompatibility

All of these are deliberate; the owner has confirmed there is no
back-compat requirement. They are listed so the release notes can carry them.

1. **`planning` capability removed.** A stored set naming it deserializes fine
   (ids are open strings, `gg.rs:1293`) and is simply ignored — no tools, no
   prompt. The console's editor no longer offers it, and a stored set carrying it
   round-trips verbatim through the draft's unknown-capability passthrough.
   *Add a launch warning naming it,* so a sweep that still enables it is loud.
2. **`fsm.machine` no longer means anything.** `"machine": "tdd"` /
   `"plan-first"` resolves to no machine. Because an enabled `fsm` capability
   with no `states` is now a **hard launch failure** (§3.7), a stored set with
   the old param **fails to launch** rather than silently degrading. This is the
   one intentional hard break: silently running an ex-TDD configuration as an
   ordinary single agent would corrupt a comparison.
3. **`GgContextSource::Plan` removed**, `ALL` 11 → 10. Old records carrying
   `"plan"` are only re-read by the console (tolerant); the Rust parser sees only
   live streams (§5.1).
4. **`GgTelemetryKind::Planning` removed**; the console renders nothing for it in
   historical runs.
5. **`GgTelemetryKind::FsmState` redefined** — `{ machine, state, state_index }`
   → `{ fsm, state, agent, from }`. An old record's `fsm_state` event now fails
   the TS discriminated-union narrowing and is dropped by the reducer's default
   arm. Accepted.
6. **New `GgTelemetryKind::AgentTransition`** — additive.
7. **`MemoryState` gains `scope` and `writable`**, both defaulted — additive and
   backwards-compatible.
8. **New capability `agent-transitions`** — additive; absent means off, so every
   existing set behaves as before.
9. **New params** `memories.scope` and `<module>.ownership` — additive; absent
   means `isolated` / `owned`, i.e. today's behaviour.
10. **`ALL_TOOL_NAMES` churn**: `enter_plan_mode`, `submit_plan`, `advance_state`
    removed; `fork`, `exec`, `transition_state` added. A stored
    `disabledTools` naming a removed tool now produces the existing
    "unknown disabled tool" launch **warning** (`tools/mod.rs:193`) rather than
    silently withholding nothing — which is the correct, loud outcome.
11. **`GgFsmState` / `GgFsmTransition` / `GgModuleKind` / `GgMemoryScope` /
    `GgModuleOwnership`** are new contract types; they must be added to
    `ts_decls!` (`contract-codegen/src/main.rs:188-212`) **and** to the
    capability-set schema's `owns` list (`:344-356`), or they are emitted as
    dangling `$ref`s.

Note also the hand-written `Deserialize` for `GgCapabilitySet`
(`crates/core/src/gg.rs:858-884` via `GgCapabilitySetRaw`): none of the above
touches the container, but any future field must be added to **both** the
canonical struct and `Raw`.

---

## 7. Sequencing

Nine stages. Each stage ends green on: `cargo fmt --all`,
`cargo clippy --workspace --all-targets`,
`cargo nextest run -p test-cabinet-gg -p test-cabinet-core`, and — for any stage
touching `crates/core/src/gg.rs` — `npm run gen:contract` with the regenerated
`packages/run-record/src/gg.ts` and `apps/docs/public/schema/**` committed in the
same commit. Console stages additionally run `npm run -w @test-cabinet/ui test`,
`npm run -w @test-cabinet/ui typecheck`, and `npm run lint`.

Each stage is one commit with a Conventional-Commits scope of `gg` (or `core` /
`ui` / `docs` where that is the primary target).

### Stage 1 — `refactor(gg): remove the planning capability and the built-in machines`

The whole of §5 except the FSM *rewrite* (leave `fsm.rs` as a stub that resolves
nothing and warns, so stage 5 has a landing place). Contract regeneration.
Nothing new is added.

**Tests:** delete/excise per §5.6. New: `tools/mod.test.rs` asserts
`ALL_TOOL_NAMES` no longer contains the three names and that
`TURN_LEVEL_TOOLS` is gone from the crate. `crates/core/src/gg.test.rs` asserts
`GgContextSource::ALL.len() == 10`. UI: `GgRunMonitorPage.test.tsx` loses its
plan/FSM cases.

### Stage 2 — `refactor(gg): extract per-agent state into modules`

New `crates/gg/src/module.rs` + `module.test.rs`. `RuntimeSet` deleted.
`ModuleSet::resolve`, `ModuleHandle`, `Module` implemented for all six kinds.
`Clone` removed from the four runtimes. `ContextModel` gains `Clone`, `rebase`,
`set_window_limit`, `set_code_mode`. `ArchiveRuntime` and `HistoryModule` added.
`run_agent` builds a `ModuleSet`; `drive` takes `&mut ModuleSet` + `DriveSetup`.
Prompt assembly iterates `modules.owned()` instead of the three hardcoded blocks
(`agent.rs:5303-5341`). `ToolRegistry::from_run` takes `&ModuleSet` + `AgentFacts`.
**No behaviour change** beyond the ownership param.

**Tests:** `module.test.rs` — per kind: `fork` produces an independent store and
does not duplicate undrained telemetry; `share` aliases; `adopt` re-resolves caps
from the receiving profile; an owned module contributes a block and an unowned one
does not. `agent.test.rs` — an unowned `tasks` module offers the task tools and
puts nothing in the window (assert on `ContextBreakdown` bands). Existing
`memories.test.rs` / `tasks.test.rs` / `skills.test.rs` adjust to the new
constructors.

### Stage 3 — `feat(gg): memory scoping strategies and linked memory instances`

`GgMemoryScope`, `MEMORY_PARAM_SCOPE`, `MemoryAccess`, `MemoryRegistry`,
`InheritedModules`, the author-tagged revision log + two cursors,
`Module::notice`, `templates/memory-notice.hbs`, the registry-level read-only
gate, `MemoriesView.read_only` + the read-only prompt paragraphs, the
`CompactionStrategy::resolve(_, memories_writable)` fix, `MemoryState.{scope,
writable}`.

**Tests:** new `crates/gg/src/memories.scope.test.rs` (store/holder level: two
holders on one store, cursor independence, author-filtered telemetry, notice
exactly once, notice content per strategy). `agent.test.rs` — a scoped-`shared`
profile spawned twice writes into one store; an `inherited` subagent of a
`read-only` parent gets write tools; a `read-only` holder's write is refused and
its registry offers no `delete_memory`; the notice lands as an ephemeral Memory
item at the tail and the pinned index is unchanged (assert the index item's
position and body across the turn). `compaction.test.rs` — `memory-compaction`
demotes for a read-only holder. UI: `MemoriesList` badge test.

### Stage 4 — `feat(gg): fork and exec`

`CAPABILITY_AGENT_TRANSITIONS`, `crates/gg/src/tools/transitions.rs`,
`Handoff`/`TransferPlan`/`transfer()`/`TransferReport`, the incarnation loop in
`run_agent`, `Scheduler::rekey`, `AgentTransition` telemetry, the deferred
capture on both execution paths, the WIT `delegation` additions and the **wasm +
signatures regeneration** (§4.5).

**Tests:** new `crates/gg/src/agent.transitions.test.rs` — exec drops/transfers/
initializes per capability presence; the successor's window carries the
predecessor's thread with a rebased system prompt; compaction fires on exec when
the successor's window is smaller; a second exec in one turn is refused; a fork's
memories follow the §4.4 table; the forker gets a `SubagentSpawned` sidecar and
can `wait_for_subagents` on the fork; ids/depth/parent are as specified.
`subagents.test.rs` — `rekey` blocks and wakes correctly. `sandbox.test.rs` —
`exec` from a program is deferred and applied after the turn.
`sandbox/signatures.test.rs` — `boundTools() == ALL_TOOL_NAMES`.

### Stage 5 — `feat(gg): user-defined FSM agents`

`fsm.rs` rewritten: `FsmSpec`, `FsmStateSpec`, `FsmTransitionSpec`,
`FsmPosition`, `Agent.fsm`, the `transition_state` tool, the launch validations
(§3.7), the redefined `FsmState` telemetry, and the two-line capture that turns a
transition into a `Handoff`.

**Tests:** rewritten `fsm.test.rs` (spec parsing, entry state, unknown target
refusal, terminal state offers no tool, transfer list honoured, validation
failures). `agent.test.rs` — an offline end-to-end run of a three-state machine
through the default factory (replacing the deleted `fsm_tdd_offline_e2e`), with a
new mock script in `client.rs`.

### Stage 6 — `feat(ui): author modules, memory scoping and FSM agents`

`ggCatalog.ts`: the new `agent-transitions` capability; the rewritten `fsm`
capability with a new `states` param; `scope` and `ownership` params on the
module-backed capabilities; the removed `planning` entry. New `ParamSpec.kind:
"states"` with its four draft functions in `ggConfigDraft.ts`
(`statesFromDraft` / `statesDraftValue` / `statesFromParam` / `statesToParam`),
mirroring the `commands` precedent at `ggConfigDraft.ts:570-657` — including
`statesFromParam` returning `null` for anything it cannot represent so a
hand-written machine routes to the verbatim `extraParams` passthrough rather than
being silently rewritten. Cross-field validation ("a transition names a state
that does not exist", "a state names an agent this configuration does not
declare") in `capabilityParams`'s `ParamsParse` channel, surfaced inline at
`GgConfigEditor.tsx:1267`. The state-row editor: per row a name, an `agent`
select over the configuration's agents, and a transitions sub-list whose targets
are a select over the sibling state names and whose transfer is a checkbox set
over `GgModuleKind` — new transitions pre-filled with `["history"]`.

**Tests:** `ggConfigDraft.test.ts` — a `states` round-trip, the passthrough on an
unrepresentable value, the two cross-field validations, `scope`/`ownership`
params. `GgConfigEditor.test.tsx` — adding a state, adding a transition,
renaming a state carrying its inbound transitions.

### Stage 7 — `feat(ui): render module transfers, FSM state paths and memory scope`

`useGgRunState.ts`: `AgentTransition` and the new `FsmState` into the per-agent
reduction; a `transitions: GgAgentTransition[]` list and an `fsmPath` derived
per agent. New `FsmPathStrip.tsx` (replacing the deleted `FsmStateStrip`) showing
the states walked and the transfers each carried; a transition row in the agent
feed; the memory scope badge. `GgAgentsExplorer` renders successions as a chain
so an exec'd agent reads as one lineage rather than N unrelated nodes.

**Tests:** `GgRunMonitorPage.test.tsx` — a synthetic run with an exec, a fork and
two FSM transitions renders the lineage, the transfer chips and the scope badge.

### Stage 8 — `docs(gg): the module-based agent model`

New pages: `apps/docs/src/content/docs/gg/modules.md` (the module model,
ownership, clone/transfer semantics, the per-kind table) and
`apps/docs/src/content/docs/gg/fork-and-exec.md`. Rewritten: `gg/fsms.md`,
`gg/memories.md` (scoping, linked notices, read-only). Updated cross-references
per §5.5, plus `astro.config.mjs` sidebar entries for the two new pages.
`apps/docs/src/content/docs/changelogs/` gets the v0.7.0 entries for all of it.

### Stage 9 — `test(gg): end-to-end coverage of the composed model`

The integration pass the individual stages cannot give: an offline run whose root
is an FSM agent whose `build` state forks itself, whose fork inherits memory
read-only, and whose `verify` state receives a transferred task list — asserting
the full telemetry sequence (`AgentSpawned` × N, `AgentTransition` × N,
`FsmState` × N, `MemoryState` on every holder) and the final `SessionSummary`.
This is the test that catches a stage-boundary mistake, and it is the one to
write first if time runs short.

---

## 8. Decision log

Decisions made here that an implementer might otherwise relitigate:

1. **A typed `ModuleHandle` enum, not `Box<dyn Module>` alone.** The loop needs
   typed access (`memories.strategy()`, `board` pump, `history` `&mut`);
   downcasting six kinds everywhere would be worse than an exhaustive match. The
   trait still exists and drives every *uniform* pass.
2. **`ModuleHandle` is not `Clone`.** Copying goes through `fork()`/`share()`
   so every aliasing decision is visible at its call site.
3. **`ownership` and `scope` are params, not new capabilities.** `implementation`
   is taken (memory strategy), and a param is what the editor already renders as
   a closed picker.
4. **`read-only` restricts only an inherited handle.** A private notebook nobody
   may write is not a feature.
5. **Access is a holder property, not a store property** — which is precisely
   why a read-only agent's `inherited` child regains write access.
6. **The linked-memory notice is a tail append, not a slot and not an index
   rebuild.** A slot would be overwritten before the model necessarily read it;
   an index rebuild would thrash the cached prefix. A tail append costs its own
   tokens once and only on turns where something actually changed.
7. **A per-holder cursor over an author-tagged append-only log**, replacing the
   destructive `pending` queue — one mechanism serving both telemetry drain and
   the notice watermark, and the only shape under which two holders can both be
   correct.
8. **Exec mints a new agent id, keeps the same depth, and parents to the previous
   incarnation.** A fresh id gives the successor a self-contained message pool;
   constant depth keeps the delegation cap measuring delegation.
9. **The whole succession is one `run_agent` invocation** — one slot, one
   `AgentReturn` — so an FSM agent is indistinguishable from an ordinary agent to
   whoever put it to work.
10. **`transfer` is explicit, with no implicit history.** A recorded
    configuration must say what it does; the editor pre-fills the common case.
11. **A memory-strategy mismatch drops rather than converts.** Silent semantic
    change is worse than a stated reset, and the successor is told in its opening
    note.
12. **Caps tighten forward only:** contents already over a newly-resolved cap are
    kept and further writes refused, never deleted.
13. **An FSM shell is a distinct kind of profile** (no model, no other
    capabilities) rather than "the entry state plus a list", because a shell that
    is also a state cannot be named from another machine without ambiguity.
14. **FSM structural errors are hard launch failures**, in the same class as an
    undeclared roster reference — unlike unrecognized *values*, which keep
    falling back with a warning per `agent.rs:677-681`.
15. **`exec`/`transition_state` are deferred declarations in code mode, `fork` is
    an immediate call** — matching `compact` and `spawn_subagent` respectively.
16. **First-wins on a duplicate `exec`** (unlike `compact`'s last-wins), because a
    silently replaced successor identity is invisible to the model.
17. **`fork` requires the delegation machinery.** A child nobody can wait on or
    message is a leak, not a feature.
18. **`exec` targets are validated against the existing `subagent` roster scope.**
    A fourth scope is not worth the contract surface.
