# Handoff: inspecting modules in the gg console

The authoritative design for making gg's **module** model legible in the console:
a `modules/` folder on the **Instances** tab, a new **Modules** tab that groups
module instances by kind, and an agent-scoped module read-out on the **Agents**
tab — all three built over **one** shared selector layer, and over the telemetry
additions that make a module instance identifiable in the first place.

This file is the spec. Every decision in it has been made; where an alternative
was rejected the rationale is one sentence in the same paragraph so it is not
relitigated. Delete this file once the work lands and the behaviour has been
folded into `apps/docs/src/content/docs/gg/`.

**Read first:** `CLAUDE.md`, `.claude/skills/coding/SKILL.md`,
`HANDOFF-gg-agent-model.md` (the module model this is the read-out for — in
particular §1 the module abstraction, §1.6 clone semantics, §1.8 transfer, §2.2
the memory scope table, and §7.6 the review pass, which is the list of what
*actually* shipped), and
`apps/docs/src/content/docs/gg/modules.md`. The docs site is the source of truth
for behaviour; this file is the source of truth for *how it is built*.

---

## 0. The problem, in one paragraph

A module instance **has no identity anywhere in the record**. `rg -n
"module_id|moduleId|instance_id|ModuleId"` over `crates/`, `packages/` and
`apps/docs/src/content/docs/gg/` returns zero hits, and every module-state event
(`SkillsState`, `MemoryState`, `TasksState`, `BoardState`) is attributed only to
the *emitting agent instance* by the envelope's `agentId`. So the console cannot
tell that `agent-3` and `agent-7` are reading **one** memory store from two that
happen to agree. The one available proxy — `MemoryState.scope` — is a *declared
configuration value*, not an identity, and it is not even reliable as a proxy:
`MemoriesRuntime::resolve` falls back to a fresh private store when an
`inherited` agent has no spawner or a mismatched strategy while still reporting
`scope: "inherited"` (`memories.scope.rs`), and `Module::adopt` re-binds a
`shared`-scoped successor to the registry entry for **its own** profile
(HANDOFF §7.6 item 6) while the transition still reports the kind as plain
`transferred`. Ownership (`owned`/`unowned`) is observable only as a free-text
`Log` line from `announce_configuration`, root-only and first-incarnation-only.
And the archive module emits nothing at all. Three UI surfaces built on that
record would be three different guesses. So the telemetry comes first.

---

## 1. The observability gap — the contract additions

All in `crates/core/src/gg.rs`, all additive except one deliberate replacement
(§1.6). Every new named type must be registered in **two** places in
`crates/contract-codegen/src/main.rs`: the `ts_decls!` list (`:188-212`) *and* —
because each of these is referenced by a telemetry event rather than being only
the shape of a `params` key — the telemetry-event `owns` list (`:~390-415`),
which is where `GgAgentTransitionKind` already sits. Per HANDOFF §7.1 item 7 and
§7.3 item 3 that split is real and getting it wrong emits a dangling `$ref`.
**`GgModuleKind`, `GgModuleOwnership` and `GgMemoryScope` are today in
`ts_decls!` only** — this design makes an event reference all three, so all
three must be added to `owns` as well. That is the single easiest thing in this
stage to miss.

### 1.1 Module instance identity — the load-bearing addition

One id per **backing store**, not per holder. Two holders of one store report
the same id; a fork that copies reports a new one; a transfer that carries
reports the same one. Everything else in this document is a projection of that
one fact.

**Minting.** A new run-global `ModuleIdMint` in `crates/gg/src/modules.rs`:

```rust
/// The run's source of module instance ids — one monotonic sequence per [kind](ModuleKind),
/// so an id says what it identifies (`memories-2`) and a run's ids are stable given the same
/// sequence of spawns, which is what makes an offline test assert on them.
///
/// It is shared rather than passed because a copy has to be able to mint one: [`Module::fork`]
/// takes `&self` and produces a genuinely new store, and threading a resolve context into it
/// would mean every clone site knowing about the run.
pub struct ModuleIdMint {
    seq: [AtomicU64; ModuleKind::ALL.len()],
}

impl ModuleIdMint {
    pub fn next(&self, kind: ModuleKind) -> Arc<str>;   // "memories-2"
}
```

Built once in `Orchestrator::build`, carried on `ModuleResolveCtx` as
`ids: &Arc<ModuleIdMint>`, and **stored inside each backing store** so every
holder of that store reads the same value:

| Kind | Where the id lives | Minted at | Carried by |
| --- | --- | --- | --- |
| `history` | `HistoryModule.id` (**not** `ContextModel` — the window's identity as a module is the module's business, and `ContextModel` stays untouched) | `HistoryModule::new` | `adopt` (a transfer keeps the window's id); `forked()` mints a fresh one |
| `memories` | `MemoryStore.id` | `MemoryStore::new`; `MemoryRegistry::bind` returns the **existing** store, hence the existing id, for a second `shared` binder | `share()`/`alias()` read it; `fork()` mints |
| `tasks` | `TaskStore.id` | `TaskStore::new` | as above |
| `board` | the run's single `BoardStore.id`, minted once in `Orchestrator::build` | once | every holder `share()`s it, so there is exactly one board id in a run |
| `skills` | the mutable **read set** (`Arc<Mutex<…>>`), not the immutable library — the library is shared by everything and identifies nothing | `SkillsRuntime::over` | `share()` reads; `forked()` mints |
| `archive` | `ArchiveStore.id` | `ArchiveStore::new` | as above |

**Trait surface.** `Module` (`crates/gg/src/modules.rs:134`) gains two methods:

```rust
/// The identity of the **backing store** this module is a holder of. Two agents reporting the
/// same id are holding one store; two ids are two stores that may merely agree. Stable for the
/// life of the store, across transfers and across a holder being replaced.
fn instance_id(&self) -> &str;

/// How *this holder* came by the module — see [`GgModuleOrigin`]. A property of the holder,
/// not of the store: two holders of one store routinely have different origins (one created
/// it, the other inherited it).
fn origin(&self) -> GgModuleOrigin;
```

`origin` is a field on each runtime, set to `Created` at construction and
overwritten by the site that knows better: `CapabilityModules::resolve` (which
knows whether it bound the registry, the spawner's offer, or the run-global
board), `adopt` (`Transferred`), and `fork_modules` (`Forked`).

### 1.2 `GgModuleOrigin` — how a holder came by a module

```rust
/// How one agent instance came to hold one module instance — the holder-side half of a module's
/// identity, and the difference between "this agent made this notebook" and "this agent was
/// handed it".
///
/// It deliberately does **not** distinguish a fork's copy from a fork's link: whether the copy got
/// its own store is already visible, and visible more reliably, in the
/// [id](GgAgentModule::module_id) — a link reports its forker's id and a copy reports a new one.
#[derive(…, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GgModuleOrigin {
    /// Created for this instance: a new backing store with nothing behind it.
    Created,
    /// Bound the store this agent's **spawner** offered ([`inherited`](GgMemoryScope::Inherited)
    /// or [`read-only`](GgMemoryScope::ReadOnly) memories).
    Inherited,
    /// Bound the **profile-scoped** instance every instance of this agent profile shares
    /// ([`shared`](GgMemoryScope::Shared) memories).
    Profile,
    /// Bound the run's single instance — the [board](GgModuleKind::Board), which is run-global by
    /// construction.
    Run,
    /// Carried live from the predecessor across an `exec` or an FSM transition.
    Transferred,
    /// Received when the agent this one was forked from was copied.
    Forked,
}
```

### 1.3 `AgentModules` — the per-instance roster

The event that makes an instance's holdings enumerable **before it mutates
anything**. This is not a nicety: today a read-only `inherited` memories holder
that never writes emits **zero** `MemoryState` events (`announce_configuration`
is gated `is_root && first_incarnation`, and `ModuleSet::state_events()` is
gated `!first_incarnation`), so a Modules tab could not even list it as a
holder.

```rust
/// The [modules](GgModuleKind) one agent instance holds, as it opens: what each is, which
/// backing store it is a holder of, whose it is, and whether the agent's prompt carries it.
///
/// Emitted **once per incarnation, for every instance** — the root, every subagent, every
/// successor — immediately after that instance's [`AgentSpawned`](Self::AgentSpawned) (and its
/// [`FsmState`](Self::FsmState), when it stands in a machine). It is the only event that reports
/// a module an agent holds but has not yet touched, and the only one that reports
/// [ownership](GgModuleOwnership) as data rather than as a log line.
///
/// A roster does not change within an incarnation — every operation that changes what an agent
/// holds (an `exec`, a transition, a fork) mints a new agent id — so it is emitted once and never
/// re-emitted. It deliberately carries **no holder count**: a point-in-time count is stale the
/// moment a sibling spawns, and a consumer that has every instance's roster already knows the
/// exact holder set, including which of those holders are still running.
AgentModules {
    /// One entry per [kind](GgModuleKind::ALL), in kind order — including the kinds this
    /// instance's profile has switched off, so an ablation's off arm is legible rather than
    /// absent (the same reason a disabled module still occupies its slot in a `ModuleSet`).
    modules: Vec<GgAgentModule>,
},

/// One module an agent instance holds — a row of an [`AgentModules`](GgTelemetryKind::AgentModules)
/// roster.
pub struct GgAgentModule {
    /// Which module this is.
    pub kind: GgModuleKind,
    /// The **backing store** this holder is a holder of. Two instances reporting the same id are
    /// holding one store; two ids are two stores. Empty for a disabled module, which has no store.
    pub module_id: String,
    /// Whether the capability behind the module is on for this instance.
    pub enabled: bool,
    /// Whether this holder's prompt carries the module ([`owned`](GgModuleOwnership::Owned)) or it
    /// is reachable through its tools alone ([`unowned`](GgModuleOwnership::Unowned)).
    pub ownership: GgModuleOwnership,
    /// How this holder came by it.
    pub origin: GgModuleOrigin,
    /// The [scope](GgMemoryScope) this holder binds under, for the one kind that has one
    /// (memories). `None` for every other kind — and note that this is the holder's *declared*
    /// binding rule, which the origin is the *resolved* answer to: a holder reporting
    /// `scope: inherited` with `origin: created` is one whose inheritance silently fell back.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<GgMemoryScope>,
    /// Whether this holder may **write** the store. `false` marks a read-only inherited handle.
    /// Always `true` for the kinds that have no access model.
    pub writable: bool,
}
```

That `scope` × `origin` pair is worth the field on its own: it is the only way
to see the declared-versus-actual divergence described in §0, and the Agents tab
(§5) renders it as a warning.

**Emission site.** `crates/gg/src/agent.rs:2456-2466`, immediately after the
`state_events()` block, **un-gated** — every incarnation emits its roster.

**And while there:** widen the `state_events()` re-emission gate from
`!first_incarnation` to `!first_incarnation || !is_root`. The current gate exists
so a first incarnation does not double-report against the root's
`announce_configuration` (HANDOFF §7.3 item 10), but `announce_configuration` is
root-only — so today an ordinary spawned subagent emits **no** opening
`MemoryState`/`TasksState`/`BoardState`/`SkillsState` at all, and its console
panels stay empty until it mutates something. The widened gate keeps the root's
announcement as the single source for the root and gives every other instance
its opening snapshots. This is a bug fix that happens to be a prerequisite.

### 1.4 `module_id` on the four state events

`SkillsState` (`:3811`), `MemoryState` (`:3827`), `TasksState` (`:3904`) and
`BoardState` (`:3923`) each gain:

```rust
/// The [module instance](GgTelemetryKind::AgentModules) this snapshot is of — the backing store,
/// not the holder. It is what lets a reader attribute two agents' identical panels to one store
/// rather than to a coincidence, and what lets a module's contents be shown once, under the module,
/// rather than N times under N agents. Empty on records written before module identity existed.
#[serde(default)]
module_id: String,
```

`#[serde(default)]` for the same reason `MemoryState.scope` has it: a stored
record must keep parsing.

### 1.5 `ArchiveState` — so the archive is not a blank tile

`ArchiveRuntime::state_events`/`drain_events` return empty
(`crates/gg/src/archive.rs:279-285`), so a `modules/archive` file and an archive
group on the Modules tab would have nothing at all to render — which, under the
repo's UX policy, is the same as not having built them.

```rust
/// The out-of-window thread [archive](CAPABILITY_AGENT_MANAGED_CONTEXT) — what `archive_thread`
/// has put away and `search_archive` can recover.
///
/// Emitted once as an agent opens (empty, when the capability is on) and again after every
/// `archive_thread`, alongside the [`ContextManaged`](Self::ContextManaged) event that records the
/// *act*. The two answer different questions: that one is "the window was reclaimed by this much",
/// this one is "here is what is now out of it".
///
/// The entries carry **metadata and a bounded preview, never the full text**. The archive exists
/// precisely so that material is out of the request; re-streaming it into the record would put a
/// second copy of the whole thread on disk for no reader's benefit, and the searchable body is
/// recoverable by the agent through `search_archive`, which is whose question it is.
ArchiveState {
    /// The module instance this snapshot is of.
    #[serde(default)]
    module_id: String,
    /// The archived entries, in archival order.
    entries: Vec<GgArchiveEntry>,
    /// How many entries are archived (the length of `entries`).
    count: u64,
    /// The total length, in characters, of everything archived — the size of what left the window.
    total_len: u64,
},

pub struct GgArchiveEntry {
    /// The monotonic ordinal assigned when the item was archived — the handle a model has on where
    /// it sat in its thread, and stable across a fork (an archive's `next_seq` is carried, never
    /// restarted).
    pub seq: u64,
    /// The context band the item occupied in the live window.
    pub source: GgContextSource,
    /// The conversational role the archived message had.
    pub role: String,
    /// The item's length in characters.
    pub len: u64,
    /// The first 200 characters of the searchable text, so a reader can tell entries apart without
    /// the record carrying the thread twice.
    pub preview: String,
}
```

`ArchiveStore` gains `id`, an `entries()` read accessor and a `state_event()`;
`ArchiveRuntime::state_events` returns it and `drain_events` stays empty
(snapshot-only, like tasks and the board).

### 1.6 `AgentTransition.modules` — the one breaking change

`AgentTransition`'s three `Vec<String>` fields (`transferred`, `dropped`,
`initialized`) collapse a per-kind decision the code actually makes into three
name lists: `fork_modules` chooses `share()` vs `fork()` per kind via
`Module::links_when_forked` and then reports **every** kind uniformly as
transferred, so a fork's linked board and its copied task list are
indistinguishable; and `MemoriesRuntime::adopt` swaps the backing store for a
`shared`-scoped successor while `transfer` still calls it "transferred".

**Replace all three with one list** (rather than adding a fourth field beside
them: two representations of the same fact can disagree, and this one already
does):

```rust
/// What happened to each [module](GgModuleKind) the two instances between them held, in
/// [kind](GgModuleKind::ALL) order — the whole of what a successor did and did not inherit, and
/// **which instance** it is now holding.
modules: Vec<GgTransitionModule>,

pub struct GgTransitionModule {
    pub kind: GgModuleKind,
    /// What the successor (or the copy) received.
    pub disposition: GgModuleDisposition,
    /// The instance the outgoing agent held, when it held one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_module_id: Option<String>,
    /// The instance the successor holds, when it holds one. Equal to `from_module_id` for a
    /// [carried](GgModuleDisposition::Carried) or [linked](GgModuleDisposition::Linked) module and
    /// different for every other disposition — which is what makes a store swap visible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_module_id: Option<String>,
}

#[serde(rename_all = "kebab-case")]
pub enum GgModuleDisposition {
    /// The successor holds the very same store, and the predecessor no longer does. A succession.
    Carried,
    /// The copy holds an **independent** copy of the predecessor's contents.
    Copied,
    /// The copy holds a **link** onto the same store — both instances hold it. The board always,
    /// and memories whose scope says two agents were meant to curate one notebook.
    Linked,
    /// The instance did not travel: its backing store is gone with the predecessor.
    Dropped,
    /// The successor started a new, empty instance of this kind — either the plan did not carry
    /// one, or what was carried could not be read under the successor's configuration.
    Initialized,
    /// Neither side holds one (the capability is off for both). Present so a roster and a
    /// transition list line up kind for kind.
    Absent,
}
```

**This is a breaking change to `GgTelemetryKind::AgentTransition`.** It is
acceptable because `AgentTransition` was introduced on this same unreleased
`rel/v0.7.0` branch (HANDOFF §7.3) and no released record carries it; `runs/`
contains none. The console's `moduleFate()` becomes a fold over `modules` and
keeps producing the same prose ("carried history, tasks · dropped board · fresh
memories"), with `linked` and the id change now expressible.

To feed it, `fork_modules` must **return** the per-kind link/copy choice it
already makes (today it discards it and reports one flat `cloned` list), and
`TransferReport` must carry `Vec<GgTransitionModule>` rather than three
`Vec<ModuleKind>`. Both are small: the information is computed and thrown away.

### 1.7 What is deliberately *not* added

- **No holder count on the wire.** Derived from the rosters, exactly (§1.3).
- **No re-emitted roster.** A roster cannot change within an incarnation.
- **No module-level "read" event.** The question "how much of this module is
  actually being read" is already answerable from `ContextBreakdown.by_source`
  (per agent, per turn, with a `Memory`/`TaskList`/`Board`/`Skill` band each)
  and `Compaction.retained`. What was missing was the **join** — which store a
  band belongs to — and §1.3 supplies it. No new Rust.
- **No change to `AgentSpawned`.** Identity and holdings are two events because
  a roster is long and an `AgentSpawned` is read by everything.

### 1.8 Blast radius

- **`crates/core/src/gg.rs`** — five new types (`GgModuleOrigin`,
  `GgAgentModule`, `GgTransitionModule`, `GgModuleDisposition`,
  `GgArchiveEntry`), two new variants (`AgentModules`, `ArchiveState`), one
  defaulted field on four variants, one replaced field group on
  `AgentTransition`.
- **`crates/contract-codegen/src/main.rs`** — the five new names in `ts_decls!`
  **and** in the telemetry `owns` list, plus `GgModuleKind`,
  `GgModuleOwnership` and `GgMemoryScope` added to `owns` (§1).
- **`packages/run-record/src/gg.ts`** + `apps/docs/public/schema/**` —
  regenerated by `npm run gen:contract`, never hand-edited, committed in the
  same commit. The generated union appears twice, so expect ~2× the field count
  in the diff.
- **`crates/gg/src/`** — `modules.rs` (mint, trait methods, `roster()`,
  `fork_modules`, `TransferReport`, `transfer`), `memories.rs` +
  `memories.scope.rs` (store id, registry bind), `tasks.rs`, `board.rs`,
  `skills.rs`, `archive.rs` (id, entries, state event), `agent.rs` (the emission
  site and the widened gate), `agent.transitions.rs` (both transition emissions
  and the fork report), `agent.code.rs` (the responses-as-code mirror of the same
  emissions — easy to miss). Sibling `*.test.rs` per repo policy.
- **No blast radius:** `crates/core/src/gg_aggregate.rs` (never touches
  `GgTelemetryKind`); `crates/core/src/gg_exec.rs` (matches eight kinds, new
  ones fall through its default arm); `crates/backend`, `crates/driver`,
  `crates/artifacts` (gg events are relayed and stored as opaque JSON).

---

## 2. The shared model — one selector layer, three surfaces

The three tabs are three projections of one graph. Build the graph once.

### 2.1 Where it lives

**New `packages/ui/src/app/pages/runs/gg/ggModules.ts` + `ggModules.test.ts`** —
a pure `deriveGgModules(...)` plus a thin `useGgModules(...)` memo hook, exactly
the shape `ggAgentAggregate.ts`, `ggContextAttribution.ts` and `ggCost.ts`
already have. It is **not** a third fold inside `useGgRunState`: that reducer is
partitioned *by agent instance* (`reduceGgEventsPerAgent` literally buckets the
event array by `agentId` and re-runs the same fold), and a module instance is
cross-agent by construction — the wrong axis for a partitioned reducer.

### 2.2 What the reducer must supply first

`useGgRunState.ts` (⚠️ raw NUL byte — always `rg -a`):

- **`agent_modules`** → `DerivedGgState.modules: ModuleRosterEntry[]`, that
  instance's roster. Because the fold is partitioned by agent, the per-agent
  slice gets its own roster for free and the global fold gets every roster; the
  global one is unused and that is fine.
- **`archive_state`** → `DerivedGgState.archive: ArchiveState | null`.
- **`module_id`** carried through `case "skills_state" | "memory_state" |
  "tasks_state" | "board_state"` into a **new global map**
  `DerivedGgState.moduleSnapshots: Map<string, ModuleSnapshot>` — a
  discriminated union of the five content kinds, keyed by module id, holding the
  latest snapshot for each. This is the one genuinely cross-agent addition, and
  it belongs in the global fold: a shared store has **one** content, and
  rendering it four times under four agents is what this whole design exists to
  stop.
- **`AgentTransition.modules`** replacing the three string arrays on the
  reduced `AgentTransition` type; `moduleFate()` re-expressed over it.
- The existing per-agent `memory`/`tasks`/`skills`/`board` scalars **stay** —
  they are still that instance's view, and every existing consumer keeps working.

`GgPanelState` (`GgRunPanels.tsx:77-87`) gains `moduleSnapshots`.

### 2.3 What `ggModules.ts` exports

```ts
/** Whether one module instance serves one agent instance, one agent profile, or the run. */
export type GgModuleScopeKind = "instance" | "agent" | "run";

/** One agent instance's hold on one module instance. */
export interface GgModuleHolder {
  agentId: string;
  /** The agent profile that instance runs under (via `agentProfileName`). */
  profile: string;
  status: GgAgentStatus;
  origin: GgModuleOrigin;
  ownership: GgModuleOwnership;
  writable: boolean;
  /** The holder's declared memory scope, for the one kind that has one. */
  scope: GgMemoryScope | null;
  /** When it began holding — the instance's first event timestamp. */
  since: string | null;
  /** What the module's band costs THIS holder's window: latest and peak tokens, and the
      share of that window it is. Null for a kind with no band (archive). */
  cost: GgModuleCost | null;
}

/** One event in a module instance's life, oldest first. */
export interface GgModuleLifetimeEvent {
  kind: "created" | "carried" | "copied" | "linked" | "dropped";
  timestamp: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  /** The succession that produced it (exec/fork/fsm); null for a plain spawn-time bind. */
  via: GgAgentTransitionKind | null;
}

export interface GgModuleInstance {
  id: string;
  kind: GgModuleKind;
  /** Every instance that ever held it, in first-seen order. */
  holders: GgModuleHolder[];
  /** Holders whose instance has not finished — "who is reading this right now". */
  liveHolders: GgModuleHolder[];
  /** instance | agent | run — see `deriveScopeKind`. */
  scopeKind: GgModuleScopeKind;
  /** The profile it belongs to, when `scopeKind === "agent"`. */
  profile: string | null;
  /** Created / carried / copied / linked / dropped, oldest first. */
  lifetime: GgModuleLifetimeEvent[];
  /** Whether its last lifetime event was a drop — the store is gone. */
  dropped: boolean;
  /** The latest snapshot of its contents, or null for a kind that reports none (history) or
      one whose holders never emitted (a legacy record). */
  content: GgModuleContent | null;
  /** What it costs across its live holders, per turn — the "is this earning its keep" figure. */
  totalCost: GgModuleCost | null;
}

/** The three projections the three tabs need, from one traversal. */
export interface GgModuleIndex {
  byId: Map<string, GgModuleInstance>;
  /** Grouped by kind, in `GgModuleKind` order, each group in first-seen order. */
  byKind: Array<{ kind: GgModuleKind; instances: GgModuleInstance[] }>;
  /** What each agent instance holds, in kind order — the Instances tab's folder. */
  byAgent: Map<string, GgModuleInstance[]>;
  /** What each agent PROFILE's instances hold, folded — the Agents tab's section. */
  byProfile: Map<string, GgAgentModuleSummary[]>;
}

export function deriveGgModules(
  capabilitySet: GgCapabilitySet | null,
  agentForest: readonly AgentTreeNode[],
  perAgent: ReadonlyMap<string, DerivedGgState>,
  transitions: readonly AgentTransition[],
  moduleSnapshots: ReadonlyMap<string, ModuleSnapshot>,
): GgModuleIndex;

export function useGgModules(…same args…): GgModuleIndex;

// Presentation helpers, so three surfaces spell one idea one way:
export function moduleKindLabel(kind: GgModuleKind): string;
export function moduleScopeLabel(m: GgModuleInstance): string;   // "shared by 4 instances of Reviewer"
export function moduleOriginLabel(h: GgModuleHolder): string;    // "inherited from agent-0"
export function coHolders(m: GgModuleInstance, agentId: string): GgModuleHolder[];
export function isShared(m: GgModuleInstance): boolean;          // holders.length > 1
```

### 2.4 The derivations, precisely

**Holders.** For each agent instance, its roster; for each enabled roster entry,
push a holder onto `byId.get(entry.moduleId)`. That is the whole index — no
inference, no walking the spawn tree, no scope heuristics. The survey's proposed
union-find over transitions is **not** needed and must not be built: it was the
right answer without ids and the wrong one with them.

**`scopeKind`.** Derived from the holder set, not from configuration, because
the configuration is what lies:
- 1 holder → `instance`.
- \>1 holder, all of one profile → `agent`, with `profile` set.
- \>1 holder spanning profiles → `run`.

(The board is `run` by construction and lands there naturally; nothing
special-cases it.)

**`lifetime`.** Seeded with a `created` event at the first holder's `since`, then
one event per `GgTransitionModule` mentioning this id, ordered by the
transition's timestamp: `Carried` → `carried`, `Copied` → `copied` on the *new*
id and nothing on the old, `Linked` → `linked`, `Dropped` → `dropped`,
`Initialized` → `created` on the new id, `Absent` → nothing.

**`cost`.** For the four kinds with a context band
(`memories`→`Memory`, `tasks`→`TaskList`, `board`→`Board`, `skills`→`Skill`),
read the holder's own `latestContext.bySource` and `contextSeries` peak. For
`history` the band is the whole window (`totalTokens`/`fullness`). For `archive`
there is none — it is out of the window by definition — so `cost` is null and
the archive's read-out uses the reclaim figures from `contextActions` instead.
`totalCost` sums the **live** holders, which is the honest statement of "this
shared memory costs three running agents 4k each, every turn".

**Legacy fallback.** When an instance has **no** roster (a record written before
§1), synthesize one private instance per (agentId, enabled capability) with a
synthetic id `legacy:<agentId>:<kind>`, `origin: created`, `scopeKind:
"instance"`, and content taken from that agent's own snapshot. Every surface
then degrades to exactly today's per-agent behaviour rather than going blank —
which is the difference between an old run still being readable and not.

---

## 3. The Instances tab — the `modules/` folder

### 3.1 The selection model

The flat `AgentFileKind` enum cannot express a nested folder without losing the
exhaustive `switch` in `FileContent` (`GgAgentsExplorer.tsx:658-767`, currently
exhaustive with no `default`). So introduce a node model:

```ts
/** One selectable thing inside an agent's folder: one of its own files, or one of the modules
    it holds. Two arms rather than one widened enum so both `switch`es stay exhaustive — a
    module kind added to the contract is then a compile error here, which is the point. */
export type AgentEntry =
  | { kind: "file"; file: AgentFileKind }
  | { kind: "module"; module: GgModuleKind };

interface Selection { agentId: string; entry: AgentEntry; }
```

`filesFor(set, agent)` becomes `entriesFor(set, roster, agent): AgentEntry[]`,
returning the agent's files followed by its module entries. The validity effect
compares with an `sameEntry(a, b)` helper.

### 3.2 Position, ordering, defaults

- The `modules` folder sits **after** the agent's own files and **before** its
  successors and its `subagents` folder: what the agent *is*, then what it
  *holds*, then who it *became* and whom it *put to work*.
- Module entries are ordered by `GgModuleKind::ALL` (history, memories, tasks,
  board, skills, archive) — one canonical order shared with the Rust contract,
  so a reader who has seen a transfer list reads the folder in the same order.
- Folder key `mod:<agentId>`, **closed by default**. The `subagents` grouping
  folder opens by default because closing it would hide the *list* of agents you
  then have to open one of; a modules folder is six rows per instance across
  dozens of instances, and the fleet-scannability rationale that keeps agent
  folders closed (`GgAgentsExplorer.tsx:444-447`) governs.
- `aria-label={`${label} modules`}` on the folder ("root modules", "agent-0
  modules") and `aria-label={`${label} modules ${kind}`}` on each file ("root
  modules memories"). The folder must be labelled — an unlabelled "modules"
  button appears once per instance and `getByRole("button", { name })` would be
  ambiguous in every test. **Give `subagents` the same treatment in passing**,
  for the same reason; it has the same latent problem today.
- Gating: a module entry is offered when the instance's **roster** names it as
  enabled; when there is no roster (legacy), fall back to
  `agentCapabilityOn(set, agent, <backing capability>)` via a new
  `MODULE_CAPABILITY_IDS` map in `ggCatalog.ts` mirroring gg's
  `MODULE_CAPABILITIES`. `history` is always offered.
- Sharing is marked **in the tree**: a module row whose instance has more than
  one holder carries a new `LinkIcon` and an `fsMeta` trailing count
  (`4 holders`), with a `title` naming them. That is the at-a-glance answer to
  "is this shared", available without opening anything.

### 3.3 Which existing files move — decided per file

| File | Verdict | Reasoning |
| --- | --- | --- |
| `overview` | **stays** | Agent identity, cost, throughput, tools, run structure. Facts about the instance, not about anything it holds. |
| `prompt` | **stays** | The brief and the rendered prompt *this instance* was given. |
| `activity` | **stays** | This instance's event stream. |
| `context` | **stays**, and `modules/history` is added beside it | Two different questions. Context answers "how full is this window and what filled it" — a per-instance question every run has whether or not the reader thinks in modules, and the anchor for the compaction markers. `modules/history` answers "which window object is this, where did it come from, who else has a copy". `modules/history` therefore does **not** repeat the fill graph; it links to this file. |
| `requests` | **stays** | The message-level companion to Context. |
| `metrics` | **stays** | Per-request graphs; nothing to do with held state. |
| `compaction` | **stays** | Gated on the `compaction` capability, which is **not** module-backed — there is no `GgModuleKind::Compaction`. Moving it would invent a module that does not exist. |
| `tasks` | **moves** → `modules/tasks` | A pure view of `TasksRuntime` state. Nothing on it is about the agent. |
| `knowledge` | **splits and moves** → `modules/skills` + `modules/memories` | It is a *forced join* of two independent modules that are already gated independently (`GgAgentsExplorer.tsx:736-741`) and are shared on entirely different terms — skills copy with the window, memories link across agents. Splitting it deletes `knowledgeSplit`, `knowledgeLabel` and the awkward joint retention note. |
| — | **new** `modules/board` | Per instance the board answers a question the run-global Project tab cannot: does *this* agent hold a handle on it, owned or unowned. It shows a summary and links to Project rather than drawing a second board. |
| — | **new** `modules/history` | See `context` above. |
| — | **new** `modules/archive` | Newly possible at all (§1.5). |

`RetainedNote` (`:999-1007`) follows tasks/skills/memories into the module files.

### 3.4 What a module file shows

Every module file leads with the same **module header strip** (one component,
`GgModuleHeader`, shared verbatim with the Modules tab's detail view — three
surfaces, one spelling):

```
memories-3   ·   memories   ·   owned   ·   agent-scoped   ·   4 holders
inherited from agent-0  ·  read/write
created by agent-0 · carried to agent-4 by exec · linked into agent-9 by fork
~3.1k tokens in this window every turn  ·  ~12.4k across 4 live holders
[agent-0] [agent-4] [agent-9] [this instance]
```

The holder chips navigate to the co-holder's *same* module file (§3.5). Then,
per kind:

- **history** — window identity: id, turn base, whether it was rebased on
  arrival (from the succession), forks and transfers of it; a link to the
  Context and Requests files for the actual fill.
- **memories** — `MemoriesList` + `MemoryTreemap`, unchanged, with the scope and
  `writable` badges the list already understands, plus the co-holder attribution
  it already computes for linked scopes.
- **tasks** — `RetainedNote` + `TaskDagView`.
- **board** — the board's counts by status, this holder's ownership, and a link
  to the Project tab. Not a second full board: the Project tab is the board.
- **skills** — `RetainedNote` + `SkillsList`.
- **archive** — the archived entries (seq, source, role, length, preview) and
  the reclaim events for this agent from `contextActions`.

An **unowned** module gets an explicit line rather than a badge alone: "This
agent holds it but its prompt does not carry it — the tools are offered and
nothing is put in the window." That is the one capability configuration whose
effect is otherwise invisible in every surface.

### 3.5 Deep-linking and navigation

`GgExplorerNav` (`GgExplorerNav.ts:13-22`) widens from one method to three, done
once in the context rather than as three ad-hoc jump mechanisms:

```ts
export interface GgExplorerNav {
  /** Open an agent instance on the Instances tab, optionally landing on one of its entries. */
  openAgent(agentId: string, entry?: AgentEntry): void;
  /** Open one module instance on the Modules tab. */
  openModule(moduleId: string): void;
  /** Open one configured agent's row on the Agents tab. */
  openProfile(name: string): void;
}
```

`GgRunPanels` gains `focusModule`/`focusProfile` one-shot state beside
`focusAgent`, each cleared through its own `onFocusHandled`, and
`GgAgentsExplorer`'s focus effect gains `focusEntry` and must additionally force
`mod:<agentId>` open on the path walk (the existing loop already force-opens
`folder:`/`sub:` rather than clearing to default, for exactly this reason). Every
consumer keeps degrading to plain text when `useGgExplorerNav()` returns null, as
all three do today.

---

## 4. The Modules tab

### 4.1 When it is offered, and where

Position: **between Instances and Project** — Dashboard (the run) → Agents (the
profiles) → Instances (the instances) → Modules (the state they hold) → Project
(the board). `MonitorTab` gains `"modules"`, `TAB_LABELS` gains a row in that
position, and `ggTabsFor` gains one clause.

Offered when **any** agent profile has a module-backed capability on —
`memories`, `tasks`, `project-management`, `skills`, `agent-managed-context` —
via a new `MODULE_CAPABILITY_IDS` const and `anyAgentCapabilityOn`, symmetric
with Project's gate. Not unconditional: a plain shell+filesystem run's Modules
tab would list one history module per instance and nothing else, and a tab that
is only ever empty is worse than no tab. When the tab *is* offered, history
modules are shown in it as a group — the run already earned the surface, and a
window's lineage across an `exec` is worth reading there.

### 4.2 Master/detail shape

The same filesystem idiom, one level shallower than the Instances tree:

```
memories                         3 instances
   memories-0        Reviewer     4 holders   🔗
   memories-1        Builder      1 holder
   memories-2        (dropped)    2 holders
tasks                            2 instances
   tasks-0           Root         1 holder
board                            1 instance
   board-0           run-global   7 holders   🔗
skills …
archive …
history                          12 instances
   …
```

- Kind folders (`kind:<kind>`) open by default — they are grouping folders, like
  `subagents`, and their children are leaves so there is no explosion — **except
  `history`**, which is one instance per agent by construction and therefore the
  longest and least surprising group; it opens closed. A kind with no instances
  is omitted rather than shown empty (the tab's gate already says the run has
  modules; an absent group says "none of these" more clearly than an empty one).
- Each row: id, a trailing profile / `run-global` / `(dropped)` annotation, a
  holder count, and the link glyph when shared.
- Selection is `{ moduleId }`, kept valid by the same effect pattern the other
  two explorers use, defaulting to the first instance of the first non-history
  group.

### 4.3 The detail view

Five stacked sections, in this order, because it is the order the questions get
asked:

1. **Identity** — the shared `GgModuleHeader` (§3.4). Ownership is per holder,
   so where holders disagree it reads "owned by 3 of 4 holders" with the odd one
   named; that disagreement is itself a finding.
2. **Holders** — one row per holding instance: agent id (chip → Instances, that
   agent's `modules/<kind>` file), profile (chip → Agents, that profile's row),
   status dot, origin ("created it", "inherited from agent-0", "bound the
   Reviewer registry entry", "carried from agent-3"), read/write, and what the
   module costs *that* instance's window per turn. This section is the answer to
   "which instances share this module", and it is the reason the tab exists.
3. **Lifetime** — the `lifetime` events as a vertical list, oldest first,
   matching the activity feed's direction rather than a horizontal chain
   (`FsmPathStrip`'s shape reads well for four states and badly for twelve
   events). Each row: timestamp, what happened, both agent ids, and the
   succession that caused it. A `copied` row names the id that was copied *from*,
   so a family of forked stores is walkable.
4. **Cost** — per-holder latest and peak band tokens, and the summed per-turn
   figure across live holders; for the archive, reclaimed tokens and entry count
   instead. This is the "is this capability earning its keep" read-out the whole
   feature is for, and it belongs on the module rather than on any one agent.
5. **Contents** — the same per-kind view the Instances module file renders,
   fed from the module's **own** latest snapshot (`moduleSnapshots.get(id)`)
   rather than from any one agent's slice. A shared store has one content; that
   is the point.

Cross-links out: holder chips → Instances; profile chips → Agents; the board
module's contents section → Project. Cross-links in: the Instances module header
and the Agents module section both offer "open this module", so all three
surfaces reach each other in one click.

---

## 5. The Agents tab — agent-scoped module data

The Agents tab is the run read per **configured profile** — the grain a
configuration is tuned at. The module question at that grain is: *does one store
serve all twelve instances of this profile, or twelve?*

### 5.1 The fold

`GgAgentSummary` (`ggAgentAggregate.ts:76-140`) gains:

```ts
/** What this profile's instances hold, per module kind — see `ggModules`. */
modules: GgAgentModuleSummary[];

export interface GgAgentModuleSummary {
  kind: GgModuleKind;
  /** How this profile's instances are distributed over module instances, most-held first. */
  instances: Array<{ id: string; holdersInProfile: number; totalHolders: number }>;
  /** instance | agent | run | mixed — the row's headline (see below). */
  sharing: "instance" | "agent" | "run" | "mixed";
  /** What the CONFIGURATION declares, read off the capability's params. */
  declaredOwnership: GgModuleOwnership;
  declaredScope: GgMemoryScope | null;
  /** The ownership its instances actually reported, when it differs from the declaration. */
  observedOwnership: GgModuleOwnership | null;
  /** Set when the declared scope and the observed sharing disagree — see §5.3. */
  divergence: string | null;
  /** What it cost this profile's windows: summed across instances, and the per-instance mean. */
  cost: GgModuleCost | null;
}
```

Computed in `deriveGgAgentSummaries` from `GgModuleIndex.byProfile`, which
`deriveGgModules` already produces — the fold does not re-derive anything.

Reading the declared side needs a genuine new helper, because **nothing in the
monitor surfaces reads a capability's `params` today** (`ggCatalog.ts` exports
only `capabilityOn`/`agentProfile`/`agentCapabilityOn`/`anyAgentCapabilityOn`):

```ts
/** One capability param off one agent's profile, or null when the profile, the capability or
    the key is absent. The declared half of every module question — what the configuration
    ASKED for, as against what `ggModules` observes it got. */
export function capabilityParam(
  set: GgCapabilitySet | null,
  agent: string | null | undefined,
  capabilityId: string,
  key: string,
): unknown;
```

It belongs in `ggCatalog.ts` beside its siblings, where `MODULE_OWNERSHIP_OPTIONS`
(`:469`), `ownershipParam` (`:477`), `MEMORY_SCOPE_OPTIONS` (`:521`) and
`MODULE_KINDS` (`:420-455`, already typed `GgModuleKind` with per-kind hint prose
worth reusing verbatim) already are.

### 5.2 The section

A new **Modules** section inside `AgentDetail`, **between `InstanceChips` and
`AgentStats`** — because "do this profile's twelve instances share one memory
store?" is precisely the question the instance chips raise, and answering it two
scroll-lengths later answers it too late.

One row per module kind the profile enables. The row leads with a **sharing
badge**, which is the whole distinction between instance-scoped and agent-scoped
data made visual:

- **instance-scoped** — "12 instances · 12 stores". No content is shown: there
  are twelve different contents and any single rendering would be a lie. The row
  shows the distribution (count, and the size range across instances) and a link
  into the Modules tab, which is where twelve instances are compared.
- **agent-scoped** — "12 instances · 1 store (`memories-3`)". The store is one,
  so **its contents render inline, right here**, expanded from the row. This is
  the user's explicit ask, and it is legitimate precisely because there is
  nothing to aggregate: the profile's memories *are* that store.
- **run-global** — "shared beyond this agent (`board-0`, 7 holders)". A link,
  a holder count, and no content: the Project tab is the board.
- **mixed** — "12 instances · 3 stores". The interesting failure: some instances
  bound a shared store and some did not. Shows the distribution and is always
  worth opening.

### 5.3 Declared versus observed

When the declared configuration and the observed sharing disagree, the row
carries a warning line. This is the highest-value thing on the tab for the user's
stated purpose, because the divergences are real and currently silent:

- declared `scope: inherited`, observed `instance` for every instance → *"Every
  instance got its own store: these instances have no spawner to inherit from
  (or their spawner organizes memories differently)."* — the
  `MemoriesRuntime::resolve` fallback.
- declared `scope: shared`, observed more than one store → the profile was
  re-bound mid-run by a succession (HANDOFF §7.6 item 6), which is correct
  behaviour and worth saying out loud.
- declared `ownership: unowned`, some holder reporting `owned` (or the reverse)
  → a per-instance divergence that can only come from a transfer into a profile
  that configures it differently.

The line names the declared value, the observed one, and the likely cause. It is
a note, never an error: every one of these is a legal configuration.

---

## 6. Shared plumbing to extract first

`GgAgentsExplorer.tsx` and `ProjectExplorer.tsx` are the same explorer built
twice — two-pane shell, sparse open-override map, selection-validity effect,
folder row markup, file row markup, empty state, all duplicated near-verbatim.
The Modules tab would be the third copy, and three is where duplication stops
being cheap. **Extract before building it**, as its own stage:

New `packages/ui/src/app/pages/runs/gg/GgFsExplorer.tsx` exporting

- `useFsFolders()` → `{ isOpen, toggle, open(keys) }` — `open` is what the focus
  path-walker needs and what both explorers currently inline;
- `<FsExplorer sidebarLabel tree detail />` — the two-pane shell;
- `<FsFolderRow>` / `<FsFileRow>` — presentational rows encapsulating the
  `fsIndent`/`fsGuide`/`fsFile`/`aria-*` invariants, so the `.fsFile::before`
  caret-spacer rationale (`GgPanels.module.scss:2117-2127`) stops being something
  every new call site has to remember.

What must **not** be genericized: the `Selection` *types* and the
validity-effect predicates. Those are per-explorer domain logic and forcing three
shapes into one generic would be worse than the duplication it removed.

The tree geometry needs no CSS change: `fsIndent` is an inline style precisely
because depth is unbounded (`ggFsTree.ts:8-11`), so a module row one level deeper
than a file row costs nothing. New icons in `ggIcons.tsx`, in the existing `Icon`
frame: `ModulesIcon` (the folder mark), `MemoriesIcon` (today `KnowledgeIcon`
covers skills and memories jointly, which the split ends), `HistoryIcon`,
`ArchiveIcon`, `LinkIcon` (the shared badge).

---

## 7. Sequencing

Eight stages, each one commit with a Conventional-Commits scope. Each ends green
on `cargo fmt --all`, `cargo clippy --workspace --all-targets`,
`cargo nextest run -p test-cabinet-gg -p test-cabinet-core`, and — for any stage
touching `crates/core/src/gg.rs` — `npm run gen:contract` with the regenerated
`packages/run-record/src/gg.ts` and `apps/docs/public/schema/**` committed in the
same commit. Console stages additionally run `npm run -w @test-cabinet/ui test`,
`npm run -w @test-cabinet/ui typecheck` and `npm run lint`.

### Stage 1 — `feat(core): module instance identity in the gg telemetry contract`

All of §1's contract work: `GgModuleOrigin`, `GgAgentModule`,
`GgTransitionModule`, `GgModuleDisposition`, `GgArchiveEntry`; the `AgentModules`
and `ArchiveState` variants; `module_id` on the four state events;
`AgentTransition.modules` replacing the three string vectors. Codegen
registration in **both** lists, plus `GgModuleKind`/`GgModuleOwnership`/
`GgMemoryScope` added to the telemetry `owns` list.

**Tests:** `crates/core/src/gg.test.rs` — each new variant round-trips; a
`memory_state` payload with no `module_id` still deserializes (the defaulted
field); `GgModuleDisposition`/`GgModuleOrigin` serialize kebab-case.

### Stage 2 — `feat(gg): mint and report module instance identity`

`ModuleIdMint`; ids on the five stores and on `HistoryModule`;
`Module::instance_id`/`origin`; `MemoryRegistry::bind` returning the existing
store's id; `CapabilityModules::roster()`/`ModuleSet::roster()`; the
`AgentModules` emission and the widened `state_events()` gate (§1.3);
`ArchiveStore` id + entries + `state_event`; `fork_modules` returning per-kind
dispositions; `TransferReport.modules`; both `AgentTransition` emission sites
(`agent.rs`, `agent.transitions.rs`) and the `agent.code.rs` mirror.

**Tests:** `modules.test.rs` — `share()` yields the same id and `fork()` a new
one, per kind, with the board and linked memories the exceptions; `adopt`
preserves the id (and a `shared`-scoped successor re-binds to its own profile's
registry id, which is a *different* id and must be reported as such);
`fork_modules` reports `Linked` for the board and `Copied` for tasks.
`memories.scope.test.rs` — two `shared` holders of one profile report one id.
`archive.test.rs` — the snapshot's counts and bounded preview.
`agent.test.rs` — a spawned subagent emits its roster and its opening state
snapshots before it mutates anything; an `inherited` read-only holder appears in
the record at all; an FSM transition's `modules` list carries both ids per kind.

### Stages 1, 2 & 4 as built — deviations from §1 and §2

**LANDED** as `feat(gg): give every module instance an identity the record can name` and
`feat(ui): the gg module model over the reducer`. All of §1 and all of §2 shipped; the
three stages went together because §4's selector layer is unbuildable without the
telemetry §1 adds and untestable without §2 emitting it. Eleven things are shaped
differently from the sketch above; **stages 5–7 should build on this list, not on §2.3's
signatures.**

1. **The mint is reached through the modules, not threaded through every constructor.**
   §1.1 puts the id on each backing store and says the mint is "carried on
   `ModuleResolveCtx`", which it is — but `MemoryStore::new`, `TaskStore::with_mode`,
   `ArchiveStore::new` and friends have ~130 call sites, almost all of them tests, and
   `Module::fork` takes `&self` and must be able to mint. So each **runtime** carries an
   `ids: ModuleIds` (an `Arc<ModuleIdMint>`) alongside its id: `resolve` takes the run's
   off `ctx.ids`, and the by-hand constructors fall back to `modules::detached_ids()` — a
   private sequence, documented as such, which only the tests and the disabled modules an
   ablation's off arm holds ever use. Every module a *run* builds is resolved, transferred
   or forked from one that was, so ids are unique within a run, which is the only scope
   they are compared in.
2. **`Module::instance_id(&self) -> &str` as designed**, which is why the id lives on the
   runtime rather than inside the mutex-guarded store: a borrow cannot escape a lock. Each
   of the five sites that decides "same store or new store" (`new`/`over`/`forked`/
   `shared`/`alias`, plus `adopt`'s rebind) sets it explicitly, and
   `MemoriesRuntime::over` **takes** the id rather than minting one, so "same store, same
   id" is a property of the call instead of something every caller has to remember.
3. **`Module` gained `set_origin` and `origin_when_forked`.** §1.1 lists two methods;
   `fork_modules` copies through the trait and has to attribute what it hands over, and
   the board's answer differs from every other kind's (it is run-global by construction,
   so a copy's board reports `Run`, not `Forked`). `origin_when_forked` puts that per-kind
   choice with the kind, exactly as `links_when_forked` already does. `Module::roster_entry`
   is a **provided** method, so a kind added later reports itself without touching the
   roster builder.
4. **`Module::memory_scope`/`writable` are provided methods** with `None`/`true` defaults,
   overridden by memories alone. Named `memory_scope` rather than `scope` because
   `MemoriesRuntime::scope` already exists and returns a non-`Option`.
5. **`TransferReport.modules` replaced the three vectors** as designed, with `carried()`,
   `dropped()`, `initialized()` and `carries(kind)` as folds over it — `succession_note`
   and the `Opening::Carried { history }` check read those and produce byte-identical
   prose.
6. **`TasksRuntime::resolve(profile, ctx)`** — it needs the run's mint, and it was the one
   module resolver that did not take the context.
7. **`dispatch_forks` takes a `transitions::ForkSource`** (`context`, `history_id`,
   `caps`) instead of three positional arguments: the window's id has to travel with the
   window, and eight arguments is one past clippy's ceiling. `fork_modules` likewise takes
   `history_id` — the module around the window is not always in reach (the loop holds the
   two split apart, and a code turn moves the window out of its module altogether), so
   `drive` reads the id once, right after `ModuleSet::split_mut`.
8. **`apply_context_reclaim` returns `Vec<GgTelemetryKind>`**, so an `archive_thread`
   emits its `ArchiveState` beside the `ContextManaged` that records the act. `AmcSetup`
   carries the archive's `archive_id` for it, and `CodeTurn::complete` takes a vec too.
9. **The reduced `AgentTransition` gained a `timestamp`.** §2.4's lifetime is "ordered by
   the transition's timestamp" and the reduced type carried none.
10. **`moduleFate()` names `copied` and `linked` separately** rather than folding both into
    "carried" — that distinction is the whole reason §1.6 replaced the three lists, and
    hiding it again in the one-line prose would have been perverse.
11. **`ggModules.ts` exports three things §2.3 does not name**, each earning its place:
    `GgModuleIndex.identified` (false on a roster-less record, so a surface can soften its
    language rather than assert things it synthesized); `declaredModuleConfig(set, profile,
    kind)`, a module-shaped wrapper over `ggCatalog`'s new `capabilityParam` that resolves
    both params **with their defaults** (a surface comparing declared against observed
    needs "owned"/"isolated", not `null`); and `MODULE_KIND_ORDER`. `moduleOriginLabel`
    takes `(module, holder)` rather than the holder alone — naming *whom* a module was
    inherited or carried from needs the holder list and the lifetime beside it.

**Deferred to stage 5:** the five new `ggIcons.tsx` marks §7's stage-4 list mentions. They
are purely presentational, nothing consumes them yet, and an unused export is a worse
seam than a late one; add them with the folder that renders them.

### Stage 3 — `refactor(ui): extract the shared gg filesystem explorer`

§6, with `GgAgentsExplorer` and `ProjectExplorer` moved onto the primitives. No
behaviour change.

**Tests:** the existing `GgRunMonitorPage.test.tsx` passing unmodified **is** the
test — that is what makes this stage safe to do first.

### Stage 4 — `feat(ui): the gg module model over the reducer`

`useGgRunState.ts` (`rg -a`): `agent_modules`, `archive_state`, `module_id` on
the four snapshots, `moduleSnapshots`, the reshaped `AgentTransition.modules` and
`moduleFate()`. New `ggModules.ts` + `ggModules.test.ts`. `ggCatalog.ts`:
`capabilityParam`, `MODULE_CAPABILITY_IDS`, module kind labels. `ggIcons.tsx`:
the five new marks. `GgPanelState` gains `moduleSnapshots`. No visible surface
yet.

**Tests:** `ggModules.test.ts`, in the pure-function idiom of
`ggAgentAggregate.test.ts` — holder indexing from rosters; the three `scopeKind`
derivations plus the cross-profile case; lifetime assembly from a
carried/copied/linked/dropped sequence; cost attribution per band; the legacy
fallback producing today's per-agent shape from a roster-less stream.

### Stage 5 — `feat(ui): a modules folder on the Instances tab`

The `AgentEntry` selection model, `entriesFor`, the `modules` folder, the six
module files, the shared `GgModuleHeader`, Tasks and Knowledge re-homed (and
`knowledgeSplit`/`knowledgeLabel` deleted), the widened `GgExplorerNav`, the
`fsMeta` holder count and `LinkIcon` badge, and the `GgPanels.module.scss`
additions.

**Tests:** `GgRunMonitorPage.test.tsx` — `openFolder("root modules")` then
`openFile("root modules memories")` renders the memories list; `openFile("root
tasks")` no longer resolves (the file moved) while `openFile("root modules
tasks")` does; a two-holder memories instance shows "2 holders" on its row and
its co-holder chip navigates to the other instance's same file; an `unowned`
module says so. `sessionStartedWith` must be widened to accept per-capability
params (it hardcodes `params: {}` today) — required from here on.

### Stage 5 as built — deviations from §3

**LANDED** as `feat(ui): a modules folder on the Instances tab`. All of §3 shipped: the
`AgentEntry` selection model, the `modules` folder, six module files, the shared
`GgModuleHeader`, Tasks re-homed, Knowledge split and deleted, the `fsMeta` holder count
and `LinkIcon` badge, the widened focus channel, and the `GgPanels.module.scss`
additions. Eight things are shaped differently from §3; **stage 6 should build on this
list.**

1. **The entry model lives in a new `ggAgentEntries.ts`, not in `GgAgentsExplorer.tsx`.**
   `AgentEntry` is referenced by `GgExplorerNav` (whose `openAgent` now takes one) and by
   `GgModuleViews` (`onOpenFile`), and both are imported *by* the explorer — so leaving the
   type in the explorer would have made two import cycles. The module also carries
   `AgentFileKind`, `FILE_ORDER`/`FILE_CAPABILITIES`/`FILE_LABELS`/`FILE_ICONS`,
   `MODULE_ICONS`, `filesFor`, `entriesFor`, `sameEntry` and `OVERVIEW_ENTRY`, which is a
   real separation rather than a dumping ground: it is "what an agent folder offers and how
   one of those things is named and selected", and none of it is rendering.
2. **`entriesFor(set, agent, modules)`** takes the agent's already-derived
   `GgModuleInstance[]` rather than §3.1's raw roster. `ggModules` has *already* decided what
   an instance holds — from its reported roster where the run had one and from its profile's
   capabilities where it did not — so re-deriving that here would be a second, divergent
   answer to a question that has one. §3.2's `MODULE_CAPABILITY_IDS` legacy fallback is
   therefore reached through `ggModules.rosterFor`, exactly once, as stage 4 built it.
3. **The per-kind content views live in a new `GgModuleViews.tsx`** alongside
   `GgModuleHeader`, and `RetainedNote` moved there with them. §3.4 only promised the header
   would be shared; the contents have to be too, because §4.3's Contents section is the same
   read-out from the same `module.content`. `ModuleContents` takes an optional `holder` and an
   optional `state`, so the Modules tab can render it with neither.
4. **`GgExplorerNav` gained `openProject()`, not §3.5's `openModule`/`openProfile`.** The
   board module file has to hand the reader through to the Project tab *now*, and it is one
   line to implement. `openModule`/`openProfile` have no target until the Modules and Agents
   tabs exist, and an unused nav method is a worse seam than a late one — the same call stage
   4 made for the icons. Stage 6 adds `openModule`; stage 7 adds `openProfile`.
5. **Co-holder chips do not route through the nav at all.** A co-holder is the same module
   file one folder over *in the same explorer*, so the chip calls a local `reveal(agentId,
   entry)` — which is also what the focus effect now calls. `GgModuleHeader` therefore takes
   an `onOpenHolder` callback rather than reading the context, and stage 6 passes
   `nav.openAgent(id, { kind: "module", module })` into the same prop.
6. **The memories view is handed the *holder's* scope and write access**, overriding what
   the snapshot carries. A shared store's snapshot reports the scope and access of whichever
   holder last emitted it, which is not necessarily the one being read; the roster is
   authoritative per holder, and `MemoriesList` already knows how to badge both.
7. **`ggModules` gained a content fallback to the holder's own slice** when a module id has
   no snapshot in `moduleSnapshots`. §2.4 says a legacy record's content comes "from that
   agent's own snapshot" and stage 4 did not wire it, so every module file on a pre-identity
   record would have rendered empty — which is most of `runs/`.
8. **No empty-state row for a module-less instance.** `history` is always enabled and has no
   capability behind it, so an instance's folder always has at least one row; the folder is
   guarded on `held.length > 0` (for an instance the index has not caught up with) and the
   *reachable* version of that requirement — a shell-only profile — is tested as "one
   `history` row and nothing else". The content pane does carry a real empty state, for a
   module a succession dropped out from under a live selection.

**Also in passing:** the `subagents` folder gained the `aria-label` §3.2 asks for, and
`.knowledgeSplit` was deleted with the file that used it.

### Stage 6 — `feat(ui): the Modules tab`

New `GgModulesExplorer.tsx`, the tab registration and gate in `GgRunPanels.tsx`,
the five detail sections, and the cross-links in both directions.

**Tests:** `GgRunMonitorPage.test.tsx` — the tab is absent for a
shell+filesystem-only run and present for one with memories; the sidebar groups
by kind with `history` closed and the rest open; a shared memories instance's
detail lists both holders with their origins; the lifetime shows
created/carried/dropped in order; a holder chip jumps to the Instances tab on
that agent's module file.

### Stages 3 & 6 as built — deviations from §4 and §6

**LANDED** as `refactor(ui): extract the shared gg filesystem explorer` and
`feat(ui): the Modules tab`. Stage 3 shipped first and unmodified in behaviour — all 668
existing UI tests passed untouched, which is what §6 says makes the extraction safe — and
the tab was then written on the primitives rather than as a third copy. Nine things are
shaped differently from §4/§6; **stage 7 should build on this list.**

1. **The extracted primitives are `useFsFolders` / `<FsExplorer>` / `<FsFolder>` /
   `<FsFileRow>`.** §6 names `<FsFolderRow>`; what shipped merges the folder's row, its
   `<li>` and its child `<ul>` into one `<FsFolder>`, because every one of the six call
   sites paired them and the relation between them (`fsIndent(depth)` on the row,
   `fsGuide(depth)` on the list it opens, children one level in) is precisely the invariant
   worth encapsulating — split across two components each site could still get it wrong.
   `FsFolder` takes `icon` (defaulting to the folder glyph, overridden by the agent row's
   status dot and the module folder's stacked blocks) and `meta` (trailing counts, badges,
   dots) as nodes.
2. **A kind group leads with an Overview, so the selection has two arms** — `{ kind:
   "group" }` | `{ kind: "module" }`, not §4.2's `{ moduleId }`. The user's stated purpose
   is to *get a feel for how a capability is being used*, and that is unanswerable one
   store at a time: "twelve private notebooks holding two notes each" versus "one store
   four agents curate" only reads with every instance of the kind side by side. The
   Overview carries that — instances, holders, how many are shared and how widely, the
   summed per-turn rent, how many hold nothing at all, and a per-instance distribution list
   — and it follows the Project explorer's epic-Overview precedent exactly (a folder whose
   first child summarizes the folder). The landing is therefore the first non-history
   group's Overview rather than §4.2's "first instance of the first non-history group".
3. **`GgModuleHeader` gained `detail: "full" | "identity"`.** §4.3 reuses the strip
   verbatim, but the strip already ends with a one-line lifetime, a cost line and the
   holder chips — all three of which the tab's own Holders, Lifetime and Cost sections then
   restate. `identity` stops after the identity and origin lines; the Instances tab keeps
   `full`, where there is nothing else on the page to say those things.
4. **`GgModuleHeader` gained `onOpenModule`** — §4.3's "cross-links in", wired from the
   Instances tab's module file ("Open in Modules") through the nav.
5. **`GgExplorerNav` gained *both* `openModule` and `openProfile` here**, where stage 5's
   note deferred the latter to stage 7. The tab's holder rows link out twice — the agent id
   to that instance (Instances) and the profile to that arm of the configuration (Agents) —
   because they are two different follow-up questions, so both had a caller as of this
   stage. `GgAgentsSummary` accordingly gained `focusProfile` + `onFocusHandled` and opens
   the named row (every row there starts closed, so arriving with it shut would answer the
   question the link was asked with a list). `GgRunPanels` now carries three one-shot focus
   channels, each cleared through its own handler.
6. **The kind folder's row carries a bare instance count**, the way the `subagents` folder
   does, with the holder distribution in its `title` — not §4.2's separate instance and
   holder columns. The sidebar is 17rem and the distribution is what the Overview is for.
7. **`moduleContentSummary` and `moduleLifetimeLabel` are exported from
   `GgModuleViews`**, so the distribution list's "1 memory · 40 chars" and the vertical
   lifetime's "carried to agent-2 by exec" are the same spelling as the header strip's
   one-liners rather than a second paraphrase.
8. **The Overview's per-turn rent is divided by the windows that actually reported a
   band**, not by the holder count: an instance whose window never reported a breakdown
   pays an unknown rent, not a zero one.
9. **`ModuleContents` is handed a holder's `state` only for `history` and `archive`** on
   this tab. Those two are the kinds whose read-out genuinely needs an instance (a window's
   turn count, an archive's reclaim figures) and both belong to exactly one live holder by
   construction; every other kind's contents come wholly from the module's own snapshot,
   which is the point of a store having one content rather than N.

**Tests:** six new cases in `GgRunMonitorPage.test.tsx` over one `moduleRun()` fixture
(two Reviewers sharing one notebook, a Root with a private one, a Root that execs and
carries its window and task list while dropping the notebook): the tab's gate, grouping
with `history` closed and a shared store appearing **once** with two holders, the kind
Overview's usage read-out, one store's holders/lifetime/cost/contents, the lifetime's
order, and both cross-link directions plus the profile hand-off to the Agents tab.

### Stage 7 — `feat(ui): agent-scoped modules on the Agents tab`

`ggAgentAggregate.ts` gains `modules`; `GgAgentsSummary.tsx` gains the Modules
section between `InstanceChips` and `AgentStats`, with the four sharing badges,
the inline contents for an agent-scoped row, and the declared-versus-observed
note.

**Tests:** `ggAgentAggregate.test.ts` — a `shared`-scoped profile with two
instances folds to one store and `sharing: "agent"`; an `isolated` one to two and
`"instance"`; a divergence between declared and observed is reported.
`GgRunMonitorPage.test.tsx` — the agent-scoped row renders its store's memories
inline and the instance-scoped one does not.

### Stage 7 as built — deviations from §5

**LANDED** as `feat(ui): agent-scoped modules on the Agents tab`. All of §5 shipped: the
`modules` fold on `GgAgentSummary`, the Modules section between `InstanceChips` and
`AgentStats`, the sharing badges, the inline contents for an agent-scoped store, and the
declared-versus-observed notes. Nine things are shaped differently from §5; **stage 8
should document what shipped, not §5.**

1. **There is a fifth sharing value, `carried`, and it is the most load-bearing change in
   the stage.** §5.2's four values classify by *how many holders*, and that is wrong for
   the case every run with an `exec` or an FSM produces: a window or a task list handed to
   a successor has two holders of which only ever **one** held it. Under the four-value
   rule that reads as `agent` — "one store, both instances" — which would invite a reader
   to treat one instance's tasks as the profile's, the single most misleading thing this
   surface could say. So `GgAgentModuleSharing` gained `carried`, and every classification
   now goes through a new exported `concurrentHolders(module)` — the holders whose
   [origin](GgModuleOrigin) is not `transferred`, i.e. the ones that *joined* the holders
   already there rather than replacing them. `agent` now requires more than one concurrent
   holder, which also fixes a latent bug in §2's fold: `instances.length === 1` with
   `nodes.length > 1` unconditionally returned `agent`, whatever the holder count.
2. **`GgAgentModuleSummary.instances` carries the `GgModuleInstance`, not its id.** §5.1's
   `{ id, holdersInProfile, totalHolders }` cannot render anything — a row that shows a
   store's contents, its holders and its cost would have to look every one of them back up
   in `byId`, which is a second traversal of a fold that exists to be shared. So the hold is
   `{ module, holdersInProfile }` and `totalHolders` is `module.holders.length`, i.e. one
   spelling of one fact. (The one `ggModules.test.ts` assertion that spelled the old shape
   was updated.)
3. **`agentScoped: GgModuleInstance | null` on the summary.** §5.2 leaves each surface to
   decide when contents may be rendered; that decision is exactly the thing that must not be
   made twice, so the fold makes it once and names the store — non-null precisely when
   `sharing === "agent"`. A surface then renders contents iff `agentScoped` is set.
4. **`divergences` is a list of `GgModuleDivergence { declared, observed, note }`, not one
   `string | null`.** A row can diverge on scope *and* on ownership independently, and
   collapsing that to one string means silently dropping one of two findings. The structured
   shape is also what lets the surface render the declared/observed pair in one weight and
   the cause in another.
5. **The declared half and the divergences are computed in `ggModules.foldByProfile`, not in
   `deriveGgAgentSummaries`.** They belong with the observed facts they are a comparison
   against, `declaredModuleConfig` was already there, and it keeps `GgAgentSummary.modules` a
   pure regrouping. `declaredFor` also returns **null** — rather than
   `declaredModuleConfig`'s defaults — for the window (no capability behind it) and for a
   profile the captured configuration does not declare, so a run recorded without its
   configuration cannot be reported as diverging from a declaration nobody made.
6. **`deriveGgAgentSummaries` takes the `GgModuleIndex` as a sixth argument and
   `useGgAgentSummaries` takes it as a fourth**, rather than folding it. `ggModules` imports
   `agentProfileName` from `ggAgentAggregate`, so importing anything from `ggModules` at
   runtime would close a cycle; the index is a whole-run traversal three surfaces share
   anyway. `ggAgentAggregate`'s import of it is therefore `import type`. `GgAgentsSummary`
   folds it with `useGgModules` beside `useGgAgentSummaries` — a third independent fold,
   deliberately, on the same "a tab costs nothing while closed" precedent the panel's own
   doc comment states.
7. **`GgExplorerNav` gained `openModuleKind(kind)`, and the Modules tab's focus channel
   became `GgModuleFocus`** (exported from `GgModulesExplorer`, structurally its
   `Selection`). §5.2's "a link into the Modules tab, which is where twelve instances are
   compared" wants the kind **Overview** stage 6 invented, and `openModule(id)` can only
   select one store. One channel carrying the selection beats a bare id plus a parallel
   kind channel that could disagree with it.
8. **Every module row is a labelled `<section>` (`"<Profile> <kind>"`), and the agent-scoped
   store a nested one (`"<Profile> agent-scoped <kind>"`).** The requirement that it never be
   ambiguous whether the screen shows one instance's state or the whole agent's has to hold
   by ear as well as by eye; it is also what makes the rows addressable in tests, since two
   rows of one profile routinely carry identical figure lines.
9. **An instance-scoped row shows a usage line, not a distribution list.** §5.2 asks for
   "the distribution (count, and the size range across instances)"; what shipped is *"2 of 2
   stores never written to · ~800/turn each"* plus **Compare in Modules**, because the
   per-store list is one row per instance — twelve windows for a twelve-instance profile —
   and the surface built to compare N stores side by side is one click away. `carried`,
   `run` and `mixed` rows **do** list their stores (there are one or two of them, and which
   is which is the point), each with its holders as chips that open that instance's own file.

**Tests:** four new cases in `ggAgentAggregate.test.ts` (a `shared` profile folding to one
agent-scoped store with no divergence; the `isolated` control folding to two with
`agentScoped` null; an `inherited` scope that inherited nothing reporting its divergence; a
carried task list classified `carried` rather than `agent`), one in `ggModules.test.ts`
(`concurrentHolders` telling a shared store from one held in turn), and three in
`GgRunMonitorPage.test.tsx` over stage 6's `moduleRun()` fixture (the shared store's
contents rendered inline and framed; the isolated profile saying so and showing no frame;
both cross-links out).

### Stage 8 — `docs(gg): module inspection in the console`

`apps/docs/src/content/docs/gg/modules.md` gains an "Inspecting modules" section
covering the three surfaces and what each answers; `gg/telemetry.md` documents
`AgentModules`, `ArchiveState`, the `module_id` field and the reshaped
`AgentTransition`; `gg/memories.md` points its scoping section at the Modules
tab; `apps/docs/src/content/docs/components/ui/overview.md` updates the tab list
if it enumerates one; `changelogs/v0.7.0.md` gains the feature and the one
breaking change.

### Stage 8 as built — deviations from the stage-8 list

**LANDED** as `docs(gg): module inspection in the console`. Everything the stage asks for
shipped; four things are shaped differently from the list above.

1. **`components/ui/overview.md` does not enumerate the console's gg tabs** — `rg -n "gg"`
   over `components/ui/overview.md` and `components/web/overview.md` returns nothing, so
   there was no tab list there to update. The place that *does* enumerate them in prose is
   [`gg/configurations.md`](apps/docs/src/content/docs/gg/configurations.md) ("A launched gg
   run is watched on gg's own live monitor… led by a tab selector"), which gained **Modules**
   and, in the bullet below it, the correction that a run with the tasks capability now has a
   **modules → tasks** file rather than a top-level one.
2. **`gg/modules.md` gained *two* sections, not one.** "Inspecting modules in the console"
   describes the three surfaces, but it is unreadable without the fact underneath it, which
   the docs site did not state anywhere: that a **backing store has an id**, that the id
   follows the store through share/fork/transfer, and that a roster reports what an instance
   holds before it touches it. That is behaviour, not console UI, so it is its own
   "Identity: which store is this?" section, and the telemetry page and the changelog both
   link *to* it rather than restating it.
3. **`gg/agent-managed-context.md` was updated too**, which the stage list does not mention.
   Its "What the console sees" section stated that evict and archive emit `ContextManaged`
   and stopped there — accurate before `ArchiveState` existed and wrong after it, since the
   archive now reports its contents. Leaving the one page devoted to the archive silent
   about the only event that says what is *in* it would have been the same omission this
   whole feature exists to fix.
4. **The changelog carries two feature sections rather than one bullet.** "Every store has a
   name" (the identity + roster + archive-state telemetry) and "Three surfaces for reading
   what a run holds" (the console), plus the `agent_transition` reshape under **Breaking
   changes** with the reason the three lists could not be kept, and the additive paragraph
   widened to name `agent_modules`, `archive_state` and the defaulted `module_id`.

**Gates run at this stage** (the full set, not the per-stage subset): `cargo fmt --all`,
`cargo build --workspace`, `cargo clippy --workspace --all-targets`,
`cargo nextest run --workspace` (2811 passed, 2 skipped), `cargo test --workspace --doc`,
`npm run gen:contract` + `git diff --exit-code packages/run-record/src/gg.ts` (no drift),
`npm run -w @test-cabinet/gg-sandbox signatures` (no drift), `npm run lint`,
`npm run -w @test-cabinet/ui typecheck`, `npm run -w @test-cabinet/ui test` (683 passed),
and `npm run build`. All green.

### Stage 9 (optional, do it if anything above slipped) — `test(gg): end-to-end module identity`

One offline run whose root `exec`s into a second profile carrying memories and
tasks, forks itself, and spawns an `inherited` read-only subagent — asserting the
full sequence of `AgentModules` rosters, that exactly three distinct memory ids
exist and which instances report each, and that the two `AgentTransition`s report
`Carried`/`Copied`/`Linked` correctly. This is the test that catches a
stage-boundary mistake.

---

## 8. Decision log

Decisions an implementer might otherwise relitigate:

1. **One id per backing store, minted per kind by a run-global mint.** Ids are
   the only reliable answer to "is this shared"; every scope-based inference is
   a guess the code contradicts in three places (§0).
2. **The id lives on the store, except history's, which lives on the module.**
   A window has no store; its module *is* its identity.
3. **A separate `AgentModules` event, not fields on `AgentSpawned`.** A roster is
   long, `AgentSpawned` is read by everything, and the roster is the event that
   also fixes subagents reporting nothing until they mutate.
4. **No holder count on the wire.** A count is stale on emission; every roster
   together is the exact holder set, live status included.
5. **`AgentTransition`'s three string vectors are replaced, not supplemented.**
   Two representations of one fact can disagree, and today's already does (a
   fork's linked board reads as "transferred"). Safe because the event is
   unreleased.
6. **`GgModuleOrigin` does not distinguish a fork's copy from its link.** The id
   says it, and says it more reliably.
7. **The archive streams metadata and a bounded preview, never bodies.** The
   archive exists to be out of the request; a second copy of the thread in the
   record serves nobody.
8. **The selector layer is a sibling module, not a third fold in the reducer.**
   The reducer is partitioned by agent and modules are cross-agent.
9. **`scopeKind` is derived from observed holders, never from declared scope.**
   The declared value is the thing being audited.
10. **A legacy record synthesizes one private module per (agent, capability).**
    An old run staying readable is worth twenty lines.
11. **`context` stays a top-level file and `modules/history` is added beside
    it.** Two questions — how full is this window, versus which window is this —
    and folding them would lose the one everybody actually asks.
12. **`compaction` stays put.** It is not module-backed; there is no
    `GgModuleKind::Compaction` to move it under.
13. **`knowledge` splits.** It was a forced join of two independently gated
    modules with entirely different sharing semantics.
14. **The `modules` folder is closed by default; the Modules tab's kind folders
    are open except `history`.** Both follow the existing rationale: an agent is
    a folder you open to read, a grouping folder is one you read.
15. **The Modules tab is gated on a module-backed capability, not
    unconditional.** A tab that can only ever be empty is worse than no tab.
16. **The Agents tab renders contents inline only for an agent-scoped module.**
    With one store there is nothing to aggregate and the contents *are* the
    answer; with twelve, any single rendering is a lie.
17. **Declared-versus-observed is a note, not an error.** Every divergence listed
    in §5.3 is a legal configuration, and being loud about it is the whole point
    of the feature.
18. **The explorer primitives are extracted before the third explorer is
    written**, as its own no-behaviour-change stage, so the extraction is
    verified by the existing tests rather than by the new ones.

---

## 9. Review-fix stage as built (corrections to §§4–6 and decision 9)

Three independent reviews of the finished branch produced seventeen findings (with
heavy overlap). What they changed, and where this design was wrong:

1. **Decision 9 was under-specified, and every surface but the Agents tab
   implemented it wrongly.** "Derived from observed holders" is necessary but not
   sufficient: a store handed from a predecessor to a successor collects holders
   exactly the way a shared store does, and only ever had one. `isShared` and
   `scopeKind` both read `holders.length`, so an `exec` — and every state of an
   FSM run — rendered as agent-scoped sharing on the Instances tree, the module
   file header, the Modules tab sidebar and its kind Overview, while the Agents
   tab (which stage 7 had already fixed with `concurrentHolders`) correctly
   called the same store *handed on*. **Now:** `isShared` and `scopeKind` both go
   through `concurrentHolders`; `GgModuleScopeKind` gained a fourth value,
   `carried`; a new `isCarried` predicate and a `handed on` badge/annotation
   replace the link glyph and holder count wherever a store was only ever held
   one instance at a time. `classifySharing` also now decides `agent` vs `run`
   from the concurrent holders' profiles rather than from a holder-count
   equality, which was wrong for a store that was both shared and later carried.
2. **`dropped` was a fact about one holder presented as a fact about the store.**
   `transfer` reports `Dropped` whenever a successor's profile does not enable
   the capability, which says nothing about the store's other holders — so a
   run-global board was permanently badged `(dropped)` from the first `exec` past
   it while the Project tab rendered it live. **Now:** the derivation records
   which holders *released* the store (a `dropped` disposition, an `initialized`
   one, and the predecessor side of every `carried`), and `dropped` is true only
   once every holder is in that set. `initialized` also gained the lifetime row
   it was missing for the predecessor's abandoned store.
3. **The legacy-roster fallback was per instance, not per record.** §7's stage 1
   built it as "this instance reported no roster", which in a live stream is true
   for every instance between its `agent_spawned` and its `agent_modules` — so
   phantom `legacy:` stores flickered into the Modules tab's counts and briefly
   reported a profile as diverging from its declared scope. **Now:**
   `identified` is computed over the whole run *before* anything is folded, and
   the fallback applies only when the record reported no rosters at all.
4. **Declared-versus-observed notes were computed for synthesized holders.**
   Their `origin: created` / `ownership: owned` are placeholders, so a
   pre-identity record reported notes with no evidence behind them — on the
   surface §5.3 calls the highest-value thing on the tab. **Now:** `foldByProfile`
   takes `identified` and returns no divergences without it.
5. **`moduleContentSummary() == null` was read as "never written to" by three
   surfaces.** A window has no snapshot *by construction*, so the Modules tab's
   "holding nothing" stat, its distribution column and both Agents-tab paths
   reported every conversation window in every run as unused. **Now:**
   `moduleReportsContents(kind)` distinguishes "reports none" from "was never
   written to"; the stat is omitted entirely for `history`.
6. **The cross-links into the Modules tab could be dead.** The tab is gated on a
   module-backed capability (decision 15) while `history` has no capability
   behind it, so an ordinary shell run's `modules/history` file and every
   profile's History row offered links to a tab the validity effect immediately
   fell back out of, dumping the reader on the Dashboard. **Now:**
   `GgExplorerNav.openModule` and `openModuleKind` are **optional**, supplied by
   `GgRunPanels` only when the tab is offered; a caller without them renders no
   button. (Reversing the gate — always offering the tab — was rejected: it
   contradicts decision 15 for a real reason.)
7. **A synthesized `legacy:<agent>:<kind>` id was presented as the store's name.**
   `identified` was consulted in exactly one place. **Now:** `GgModuleInstance`
   carries `synthesized`, and the shared header strip badges it `inferred` and
   explains it — so every surface that renders the id also says what it is.
8. **A forked store's lifetime read "copied" before "created".** The synthesized
   `created` row and the `copied` row describe one instant, and the fork's
   transition is emitted on the spawner's stream *before* the child's
   `agent_spawned`, so the copy sorted first. **Now:** the `created` row is
   dropped when a `copied` row names the first holder, for the same reason
   `initialized` never adds one.
9. **`capabilityParam` had no callers and `observedScope` had no readers.**
   `declaredModuleConfig` now reads through `capabilityParam` as §5.1 said it
   did; `observedScope` is deleted (a holder's scope is its own profile's
   declaration, so it added nothing the divergence check did not); and
   `observedOwnership` is now what `moduleDivergences` decides ownership
   agreement from, instead of recomputing it.
10. **The kind Overview borrowed the FSM transfer-list prose.** Those hints are
    written in the second person of a checkbox and refer to "this" and "the next
    state", neither of which exists on that page. **Now:**
    `moduleKindDescription(kind)` in `ggModules.ts`, written for the question the
    tab asks.
11. **A measured-zero per-turn cost said "no context band"**, which is the
    archive's meaning. **Now:** three distinct sub-labels — `no context band`
    (archive), `measured zero`, `not measured yet`.
12. **The root's first incarnation never emitted its opening `ArchiveState`.**
    `ModuleSet::state_events` is skipped for it and `announce_configuration` grew
    one arm per capability, missing the archive (which arrived last) — against a
    documented contract. **Now:** `announce_configuration` emits it, covered by
    `agent.modules.test.rs::the_root_opens_with_an_empty_archive_snapshot`.

Regression coverage added: five cases in `ggModules.test.ts` (carried ≠ shared, a
store surviving one holder's release, a fork's lifetime ordering under realistic
stamps, no synthesis for an in-flight roster, no divergences without rosters),
four in `GgRunMonitorPage.test.tsx` (handed-on across three surfaces, a window
never reported empty, no dead Modules link in a run with no Modules tab, the
`inferred` badge), and one in `crates/gg/src/agent.modules.test.rs`.

`gg/modules.md` was updated in the same commit for items 1, 2, 3(via 4), 5, 6 and
7 — the design's own prose about the surfaces was wrong in the same places the
code was.
