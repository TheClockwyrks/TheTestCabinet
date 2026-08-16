//! The **gg** harness data contract: the capability set that configures a gg run
//! and the first-party telemetry stream (schema v1) a run emits live.
//!
//! gg is The Test Cabinet's own first-party coding harness. Unlike a third-party
//! harness — a flat `(harness, model, orchestrator)` tuple — a gg run is configured
//! by a declarative [`GgCapabilitySet`] (which capabilities are on, which
//! implementation each uses, and how models bind to slots) and reports its activity
//! over a custom, purpose-built [`GgTelemetryEvent`] channel rather than the
//! normalized [`crate::event`] stream. See the design docs under `gg/` in the
//! documentation site.
//!
//! Like the rest of the contract, these types are the **source of truth**: the
//! TypeScript bindings (`packages/run-record/src/gg.ts`) and the JSON Schemas
//! (`apps/docs/public/schema/gg/*.json`) are generated from them (they derive
//! `ts_rs::TS` + `schemars::JsonSchema` behind the `contract` feature) by
//! `crates/contract-codegen` — never edited by hand. Regenerate with
//! `npm run gen:contract` after any change here. JSON is camelCase.

use std::collections::BTreeMap;
use std::fmt;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::metrics::{Cost, TokenCounts};

/// The conventional name of the single model slot a Phase 0 gg run uses. Later
/// phases bind additional, possibly cross-provider slots (for example `subagent`,
/// `judge`, or `reviewer`); the [`GgCapabilitySet`] allows any number, but Phase 0
/// only ever binds this one.
pub const PRIMARY_SLOT: &str = "primary";

/// The absolute in-container path the `gg` binary is installed to.
///
/// It lives here, in the shared contract, rather than privately in the host-side
/// installer that writes it, because it constrains the **other** side too: this path is a
/// regular *file* for the whole of a run, so nothing gg creates in the container may nest
/// underneath it. A path that does cannot be created at all — `create_dir_all` on any
/// descendant fails with `ENOTDIR`, in the container only, where no unit test looks. gg's
/// own scratch paths are therefore siblings spelled `/tmp/gg-*` (`/tmp/gg-invocation.json`,
/// `/tmp/gg-cancel`, and the shell capability's `/tmp/gg-shell`), never children.
pub const BINARY_PATH: &str = "/tmp/gg";

/// The stable id of the Phase 0 shell capability: the agent's ability to run shell
/// commands in the run container (the `shell` tool).
///
/// Its [implementation](GgCapabilityConfig::implementation) selects where a command's
/// output goes — [`adaptive`](SHELL_OUTPUT_ADAPTIVE), [`inline`](SHELL_OUTPUT_INLINE), or
/// [`offload`](SHELL_OUTPUT_OFFLOAD) — and its `maxLines`/`maxChars` params set the ceiling
/// the two truncating modes leave the agent. A chatty build is one of the few things that
/// can spend a large slice of a context window in a single call, so how much of one an agent
/// is shown is configured rather than hardcoded. The modes are documented at
/// <https://docs.testcabinet.ai/gg/shell/>.
pub const CAPABILITY_SHELL: &str = "shell";

/// The [shell](CAPABILITY_SHELL) output mode returning the whole (byte-capped) output in the
/// tool result and writing nothing to disk — gg's original behavior, and the control arm.
pub const SHELL_OUTPUT_INLINE: &str = "inline";

/// The [shell](CAPABILITY_SHELL) output mode writing every command's stdout and stderr to a
/// file pair the agent can grep, and returning only the configured tail inline.
pub const SHELL_OUTPUT_OFFLOAD: &str = "offload";

/// The [shell](CAPABILITY_SHELL) output mode — the **default** — that offloads selectively:
/// a command that failed comes back as it would under [`offload`](SHELL_OUTPUT_OFFLOAD), and
/// a command that succeeded comes back as its exit code and the paths its output went to.
pub const SHELL_OUTPUT_ADAPTIVE: &str = "adaptive";

/// Every [shell](CAPABILITY_SHELL) output mode, for the launch-time check that a set names one
/// gg recognizes. The [default](SHELL_OUTPUT_ADAPTIVE) is first.
pub const SHELL_OUTPUT_MODES: [&str; 3] = [
    SHELL_OUTPUT_ADAPTIVE,
    SHELL_OUTPUT_INLINE,
    SHELL_OUTPUT_OFFLOAD,
];

/// The stable id of the read-file capability: the agent's ability to read a file in the
/// run workspace (the `read_file` tool).
///
/// Its [implementation](GgCapabilityConfig::implementation) selects how much of a file one
/// call may return by default — the *unlimited* and *default-cap*
/// [read modes](https://docs.testcabinet.ai/gg/filesystem/) — and its `lineCap` param sets
/// the default window the capped mode returns. How a coding agent copes when it only sees a
/// file a window at a time unless it asks for more is a first-class experimental variable, so
/// it is configured rather than hardcoded. Neither mode can *refuse* a whole-file read: an
/// explicit larger `limit` is always honoured.
pub const CAPABILITY_READ_FILE: &str = "read-file";

/// The stable id of the write-file capability: the agent's ability to create or overwrite
/// a file in the run workspace (the `write_file` tool).
pub const CAPABILITY_WRITE_FILE: &str = "write-file";

/// The stable id of the edit-file capability: the agent's ability to patch a file in the
/// run workspace by exact, unique string replacement (the `edit_file` tool).
pub const CAPABILITY_EDIT_FILE: &str = "edit-file";

/// The stable id of the list-dir capability: the agent's ability to list a directory in
/// the run workspace (the `list_dir` tool).
pub const CAPABILITY_LIST_DIR: &str = "list-dir";

/// The stable id of the context-window-override capability: when on, the agent's model is
/// measured against the smaller window this capability's `windowLimit` param declares
/// instead of the model's full [catalog window](GgContextSourceUsage). It is a **narrowing**
/// lever only — the model's real window is a hard limit, so an override above it is clamped
/// back down rather than believed — and narrowing the window is how a study exercises
/// [compaction] against a 1M-token model without paying for a million tokens of input.
///
/// This capability offers no tool and adds nothing to the window; it is purely a
/// configuration knob. **Context visibility itself is not a capability:** the per-source
/// accounting of what fills the window (skills, memories, file contents, the thread, tool
/// output, …), which the console renders as a stacked line graph, is always computed and
/// always emitted — [compaction] and agent-managed context depend on its fullness signal —
/// independent of this or any other capability.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
pub const CAPABILITY_CONTEXT_WINDOW_OVERRIDE: &str = "context-window-override";

/// The stable id of the autoload-specifications capability: when on, an agent's very
/// first context is seeded with the **full contents of every file the test case
/// provided** — its specifications and reference images — injected as though the model
/// had already `read_file`d each, so the model starts with the whole brief in the window
/// rather than having to discover and read it.
///
/// Off (the default) the agent starts with only the build prompt and reads what it needs
/// itself; on, it is a distinct arm of the "does front-loading the whole spec help?"
/// study. Its [`implementation`](GgCapabilityConfig::implementation) is the **locked**
/// lever: the default (empty) injects the specs as ordinary, ephemeral file reads that
/// [compaction](CAPABILITY_COMPACTION) may summarize away and
/// [agent-managed context](CAPABILITY_AGENT_MANAGED_CONTEXT) may evict, while
/// [`AUTOLOAD_LOCKED_IMPL`] pins them so they are kept in the window verbatim across every
/// compaction boundary and cannot be evicted.
pub const CAPABILITY_AUTOLOAD_SPECS: &str = "autoload-specs";

/// The [`implementation`](GgCapabilityConfig::implementation) of
/// [`CAPABILITY_AUTOLOAD_SPECS`] that **locks** the autoloaded specifications into the
/// window — pinned across compaction and immune to eviction — rather than injecting them
/// as ordinary, droppable file reads (the default when the implementation is absent or empty).
///
/// This is the capability's whole vocabulary. A profile naming any other implementation is
/// refused at launch: `lock` and `Locked` are not this arm, and a run that quietly took the
/// unlocked arm instead would record the locked one having been asked for.
pub const AUTOLOAD_LOCKED_IMPL: &str = "locked";

/// The stable id of the **agent-persistence** capability: an agent profile whose instances
/// share one **serialized identity** across the whole run instead of being independent,
/// interchangeable workers.
///
/// A persistent profile changes two things about every instance of it, and nothing else:
///
/// - **Its parallelism is capped at one.** At most one instance of the profile *runs* at a
///   time, run-wide — regardless of which [worktree](CAPABILITY_PROJECT_MANAGEMENT) each was
///   dispatched into, and regardless of the run's own
///   [parallelism cap](GgRunLimits::max_parallel). Further instances are **queued**, not
///   refused: they are spawned normally and wait their turn on the same scheduler every other
///   agent waits on. An instance that suspends itself (blocking on its subagents or on an
///   issue) is not running, so it releases the profile to the next queued instance and
///   re-takes it when it resumes.
/// - **Its open views carry over.** When an instance finishes its work successfully, the set
///   of views it had open is recorded against the profile — the
///   [file views](GgContextSource::FileView) as each path plus the `offset`/`limit` region of a
///   paged read, and the [text views](GgContextSource::TextView) *with their bodies*. The next
///   instance re-opens exactly those views as its first act. A file is read **fresh from disk
///   at that moment** rather than replaying the bytes the last instance saw; a text view is
///   handed back verbatim, because the agent composed it and the window is its only copy, so
///   there is nothing fresher to read it from.
///
/// Together those make a profile behave like a long-lived worker with a desk: it comes back to
/// the files it was last working on, in their current state, and to the notes it made about
/// them, having never had two of itself editing at once. Off (the default), instances of a
/// profile are independent — they run as concurrently as the run's cap allows and each opens
/// with an empty desk.
///
/// The recorded views are re-opened **when the instance starts its first turn**, not when it
/// was spawned. A queued instance may wait a long time behind the one ahead of it, and the
/// point of the capability is to open on what the files *say now* — seeding at spawn time
/// would hand it a snapshot that the instance ahead of it has since rewritten.
///
/// It is a per-agent capability (like every other), so a run can make one profile persistent —
/// a single reviewer, or a single owner of a subsystem — while the rest of the fleet stays
/// parallel and stateless.
pub const CAPABILITY_AGENT_PERSISTENCE: &str = "agent-persistence";

/// The stable id of the Phase 1 skills capability: markdown-with-front-matter skills
/// whose descriptions are shown up front and whose bodies, once read, are retained
/// across a compaction boundary.
pub const CAPABILITY_SKILLS: &str = "skills";

/// The stable id of the Phase 1 memories capability: the same mechanism as
/// [`CAPABILITY_SKILLS`] but curated by the model itself and bounded in count and
/// length, so self-curated memory cannot crowd out the working context.
///
/// Its [`implementation`](GgCapabilityConfig::implementation) selects the **memory
/// strategy** — how the model's notes are organized, and how much of them the window
/// carries. Three strategies ship, and they differ in what is *always* in context:
///
/// - [`scratchpad`](MEMORY_STRATEGY_SCRATCHPAD) (the default) — a small, bounded set whose
///   **bodies are all pinned in the window** and cross a [compaction](CAPABILITY_COMPACTION)
///   boundary verbatim.
/// - [`markdown`](MEMORY_STRATEGY_MARKDOWN) — an **index** of slugs and descriptions is
///   pinned; the memories themselves are markdown files gg holds in memory and the model
///   reads on demand.
/// - [`keyword-search`](MEMORY_STRATEGY_KEYWORD_SEARCH) — **nothing** is pinned; the model
///   finds a memory by searching for keywords and reads the ones it wants.
///
/// Every strategy stores memories **in gg, never on disk**, so the only way to write one is
/// through the tools the capability offers — a model cannot forge a memory by writing a file
/// into the workspace. A strategy name gg does not recognize **fails the launch** and names the
/// three it knows: the arm is the independent variable, so a run that silently took the default
/// would be a measurement of the wrong thing.
///
/// Which params a run's [`params`](GgCapabilityConfig::params) may carry depends on the
/// strategy — [`GgMemoryCaps`] documents the limits each resolves and their defaults.
pub const CAPABILITY_MEMORIES: &str = "memories";

/// The [memories](CAPABILITY_MEMORIES) strategy that keeps a small, bounded set of notes
/// whose **bodies are all pinned in the context window**, retained across a
/// [compaction](CAPABILITY_COMPACTION) boundary verbatim: `write_memory` /`update_memory` /
/// `delete_memory`, bounded by all three of [`max_count`](GgMemoryCaps::max_count),
/// [`max_len_per_memory`](GgMemoryCaps::max_len_per_memory) and
/// [`max_total_len`](GgMemoryCaps::max_total_len).
///
/// The default: what a memories capability that names **no** strategy uses. Nothing else falls
/// back to it — a strategy gg does not recognize fails the launch rather than landing here.
pub const MEMORY_STRATEGY_SCRATCHPAD: &str = "scratchpad";

/// The [memories](CAPABILITY_MEMORIES) strategy that splits memory into an **index** and a
/// set of **markdown files**, in the shape The Test Cabinet's own agent memory uses.
///
/// The index — one `slug` — `description` line per memory — is pinned in the window and is
/// the only part always in context; `create_memory` adds its entry, `delete_memory` removes
/// it, and the model reads a memory's body with `read_memory` and revises it with
/// `edit_memory`'s search/replace. Bounded by
/// [`max_len_index`](GgMemoryCaps::max_len_index) (a create whose index entry would not fit
/// is refused) and [`max_len_per_memory`](GgMemoryCaps::max_len_per_memory); the number of
/// memories is bounded only by the index that must list them.
pub const MEMORY_STRATEGY_MARKDOWN: &str = "markdown";

/// The [memories](CAPABILITY_MEMORIES) strategy that keeps markdown files with **no index at
/// all**: nothing is pinned, and the model finds a memory by calling `search_memories` with
/// keywords, ranked by how many of them a memory matches and how often.
///
/// The retrieval arm of the study — it asks whether an agent can work from memory it has to
/// look up, rather than memory it is handed every turn. Bounded by
/// [`max_len_per_memory`](GgMemoryCaps::max_len_per_memory) and, optionally, by
/// [`max_count`](GgMemoryCaps::max_count); a search returns at most
/// [`max_results`](GgMemoryCaps::max_results) memories.
pub const MEMORY_STRATEGY_KEYWORD_SEARCH: &str = "keyword-search";

/// The [`params`](GgCapabilityConfig::params) key on the [memories](CAPABILITY_MEMORIES)
/// capability naming which memory **instance** an agent instance binds to — its
/// [scope](GgMemoryScope).
///
/// Meaningful only where memories are enabled: a profile that sets it with the capability off is
/// **refused** at launch, because the two together describe an intent gg cannot honour. An
/// unrecognized value is refused on the same terms, in line with how every unrecognized capability
/// *value* is treated — a scope decides which agents share a notebook, and there is no reading of
/// the record afterwards that would show a run had silently been given private ones.
///
/// See [memories](https://docs.testcabinet.ai/gg/memories/) for what each scope does, and
/// [`MODULE_PARAM_OWNERSHIP`] for the orthogonal question of whether the bound instance is carried
/// in the holder's prompt.
pub const MEMORY_PARAM_SCOPE: &str = "scope";

/// Which [memory](CAPABILITY_MEMORIES) instance an agent instance binds to — the
/// [`scope`](MEMORY_PARAM_SCOPE) param, resolved.
///
/// [`Isolated`](Self::Isolated) is the default: a subagent starts with an empty notebook and
/// nothing it writes is seen by anyone else, which is the right answer for a configuration that
/// wants each agent measured on its own curation. The other three bind the *same* store to several
/// holders, which is what makes a study of shared, accumulated knowledge possible at all.
///
/// Two rules make the four coherent, and they are the ones a configuration's reader has to know:
///
/// 1. **[`ReadOnly`](Self::ReadOnly) only ever restricts an inherited handle.** An agent that ends
///    up with a fresh instance under `read-only` may write it — a private notebook nobody may
///    write is not a feature.
/// 2. **Write access is a property of the holder, not of the store.** So a read-only agent's
///    [`Inherited`](Self::Inherited) subagent gets a read/**write** handle onto the same store.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgMemoryScope {
    /// A fresh instance per agent **instance**: what one agent writes, no other agent ever sees.
    /// The default, and gg's only behaviour before scoping existed.
    #[default]
    Isolated,
    /// One instance per agent **profile**, shared by every instance of it in the run — including
    /// instances running in parallel, which are then linked holders of one store and are told
    /// about each other's writes.
    Shared,
    /// A subagent binds its **spawner's** instance, read/write; an agent spawned any other way
    /// (the root, an issue's implementer, a reviewer or judge) gets its own. Chains: a subagent of
    /// a subagent inherits the instance its parent inherited, however deep.
    Inherited,
    /// As [`Inherited`](Self::Inherited), but this holder may **not** write: it is offered the
    /// read calls alone, and a write reaching gg any other way is refused with an explanation
    /// rather than silently dropped.
    ReadOnly,
}

impl GgMemoryScope {
    /// Every scope, in declaration order — what an editor offers and what a validation enumerates.
    pub const ALL: [GgMemoryScope; 4] = [
        GgMemoryScope::Isolated,
        GgMemoryScope::Shared,
        GgMemoryScope::Inherited,
        GgMemoryScope::ReadOnly,
    ];

    /// The scope's wire spelling — the same string its
    /// [serialization](GgMemoryScope#impl-Serialize-for-GgMemoryScope) produces, for the
    /// [`MemoryState`](GgTelemetryKind::MemoryState) telemetry, prompt text and launch warnings.
    pub fn as_str(self) -> &'static str {
        match self {
            GgMemoryScope::Isolated => "isolated",
            GgMemoryScope::Shared => "shared",
            GgMemoryScope::Inherited => "inherited",
            GgMemoryScope::ReadOnly => "read-only",
        }
    }

    /// Whether a holder under this scope may end up **linked** to another holder — sharing one
    /// store, and so owed a notice when another holder writes to it. False only for
    /// [`Isolated`](Self::Isolated), whose instances are never shared with anyone.
    pub fn may_link(self) -> bool {
        !matches!(self, GgMemoryScope::Isolated)
    }

    /// Whether a holder under this scope takes its instance from the agent that **spawned** it —
    /// the two scopes that make a spawner's notebook shared whatever the spawner's own scope says.
    pub fn is_inherited(self) -> bool {
        matches!(self, GgMemoryScope::Inherited | GgMemoryScope::ReadOnly)
    }
}

impl std::fmt::Display for GgMemoryScope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The stable id of the Phase 1 tasks capability: the model's lightweight to-do list,
/// a blocked-by DAG that survives compaction verbatim.
pub const CAPABILITY_TASKS: &str = "tasks";

/// The [`params`](GgCapabilityConfig::params) key every **module-backed** capability reads to
/// decide whether the state it keeps is [owned](GgModuleOwnership::Owned) by the agent holding
/// it — the default, and the only behaviour gg had before modules existed — or
/// [unowned](GgModuleOwnership::Unowned).
///
/// A module-backed capability is one whose state gg keeps for the agent rather than one that is
/// a pure function of a call — see [`GgModuleKind`] for the closed list of modules. Exactly **two**
/// of them read this param: [`project-management`](CAPABILITY_PROJECT_MANAGEMENT) and
/// [`agent-managed-context`](CAPABILITY_AGENT_MANAGED_CONTEXT).
///
/// The others have no ownership to configure, and every absence is load-bearing.
/// [`tasks`](CAPABILITY_TASKS): the task list is what an agent steers its work by from turn to turn,
/// so it is always carried in its holder's prompt as its own message.
/// [`memories`](CAPABILITY_MEMORIES) and [`skills`](CAPABILITY_SKILLS): for both of them the knob
/// would be a way of switching the capability off while pretending it was on — what a
/// [memory strategy](MEMORY_STRATEGY_SCRATCHPAD) pins *is* what having memories means under it, and
/// the strategy is already that knob.
///
/// So an `ownership` key on any capability but those two is a **launch failure**: it is a key on a
/// capability that has none, which is a configuration asking for something gg cannot do. An
/// unrecognized value is refused on the same terms, in line with how every unrecognized capability
/// *value* is treated.
///
/// See the [module model](https://docs.testcabinet.ai/gg/modules/) for what ownership changes.
pub const MODULE_PARAM_OWNERSHIP: &str = "ownership";

/// Whether the state a module-backed capability keeps is carried in its holder's **prompt**, or
/// is reachable only through the tools it contributes.
///
/// This is the [`ownership`](MODULE_PARAM_OWNERSHIP) param, and it is the one knob that separates
/// "the agent is told what it holds, every turn" from "the agent may look it up". It exists
/// because a module is no longer necessarily *about* the agent holding it: once a memory instance
/// can be shared between agents, or a task list handed from one FSM state to the next, an agent
/// can be given a working store it should be able to act on without paying for it in every
/// request it makes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgModuleOwnership {
    /// The holder's prompt carries the module: its system-prompt section is rendered, and the
    /// pinned block it keeps (the memory index, the task list, the board) is refreshed into the
    /// window on that module's own schedule. The default, and what a [task list](GgModuleKind)
    /// always is.
    #[default]
    Owned,
    /// The module is reachable through the holder's **tools and nothing else**: no system-prompt
    /// section, no pinned block, and no per-turn notice. Its state is still live — the tools read
    /// and write it, and it is still transferred, shared and reported as
    /// [telemetry](GgTelemetryKind) exactly as an owned one is — it simply costs the holder no
    /// context until it asks.
    Unowned,
}

impl GgModuleOwnership {
    /// Whether this is [`Owned`](Self::Owned) — the question every prompt-assembly site asks, since
    /// what ownership decides is whether the holder's prompt carries the module at all.
    pub fn is_owned(self) -> bool {
        matches!(self, GgModuleOwnership::Owned)
    }
}

/// The closed set of **modules** an agent instance holds: one unit of per-agent capability state
/// that gg can clone, share between agents, and hand from one agent instance to the next.
///
/// The names are the vocabulary a configuration uses to talk about that state — most visibly an
/// [FSM](CAPABILITY_FSM) transition's transfer list, which names the modules the successor state
/// inherits. They are a closed taxonomy rather than open capability ids because gg has to
/// implement clone/share/transfer semantics per kind; a capability with no module keeps no state
/// worth carrying.
///
/// See the [module model](https://docs.testcabinet.ai/gg/modules/) for the per-kind semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgModuleKind {
    /// The agent's **conversation window** — every message, file view and pinned block it holds.
    /// Always present (an agent without a window is not an agent); it is the module a successor
    /// receives to continue a predecessor's thread rather than start afresh.
    History,
    /// The [memories](CAPABILITY_MEMORIES) the agent curates, under whichever strategy the
    /// capability configures.
    Memories,
    /// The [task](CAPABILITY_TASKS) list — the blocked-by DAG the agent steers by.
    Tasks,
    /// The [project-management](CAPABILITY_PROJECT_MANAGEMENT) board. Run-global by
    /// construction: every holder of it holds the *same* board, so it is shared rather than
    /// copied however it is carried.
    Board,
    /// The [skills](CAPABILITY_SKILLS) library and the set of skills read so far — a promise
    /// about which skill bodies are already pinned in the window, so it travels with it.
    Skills,
    /// The thread [archive](CAPABILITY_AGENT_MANAGED_CONTEXT) `archive_thread` fills and
    /// `search_archive` reads.
    Archive,
}

impl GgModuleKind {
    /// Every module kind, in a stable order — the order a set is built, iterated, reported and
    /// transferred in, so two runs of the same configuration produce the same sequence.
    pub const ALL: [GgModuleKind; 6] = [
        GgModuleKind::History,
        GgModuleKind::Memories,
        GgModuleKind::Tasks,
        GgModuleKind::Board,
        GgModuleKind::Skills,
        GgModuleKind::Archive,
    ];

    /// The kind's wire spelling — the same string its
    /// [serialization](GgModuleKind#impl-Serialize-for-GgModuleKind) produces, for log lines,
    /// telemetry lists and the transfer-list parsing that has to report an unknown name back.
    pub fn as_str(self) -> &'static str {
        match self {
            GgModuleKind::History => "history",
            GgModuleKind::Memories => "memories",
            GgModuleKind::Tasks => "tasks",
            GgModuleKind::Board => "board",
            GgModuleKind::Skills => "skills",
            GgModuleKind::Archive => "archive",
        }
    }
}

impl std::fmt::Display for GgModuleKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// How one agent instance came to hold one module instance — the holder-side half of a module's
/// identity, and the difference between *"this agent made this notebook"* and *"this agent was
/// handed it"*.
///
/// It is a property of the **holder**, not of the store: two holders of one store routinely report
/// different origins, because one of them created it and the other bound, inherited or was handed
/// it. Read beside the holder's declared [scope](GgMemoryScope) it is also the only way to see a
/// binding that did not resolve the way its configuration asked — a holder reporting
/// `scope: inherited` with `origin: created` is one whose inheritance did not find a store to
/// inherit. gg refuses the statically decidable form of that at launch and treats the rest as its
/// own defect mid-run, so this pairing marks a gg bug rather than an accepted outcome; it stays
/// legible in the record precisely so such a bug is findable.
///
/// It deliberately does **not** distinguish a fork's copy from a fork's link. Whether the copy got
/// its own store is already visible, and visible more reliably, in the
/// [id](GgAgentModule::module_id): a link reports its forker's id and a copy reports a new one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgModuleOrigin {
    /// Created for this instance: a new backing store with nothing behind it. The default, and
    /// what every module of every agent was before instances could be shared.
    #[default]
    Created,
    /// Bound the store this agent's **spawner** offered —
    /// [`inherited`](GgMemoryScope::Inherited) or [`read-only`](GgMemoryScope::ReadOnly) memories.
    Inherited,
    /// Bound the **profile-scoped** instance every instance of this agent profile shares —
    /// [`shared`](GgMemoryScope::Shared) memories.
    Profile,
    /// Bound the run's single instance — the [board](GgModuleKind::Board), which is run-global by
    /// construction.
    Run,
    /// Carried live from the predecessor across an `exec` or an [FSM](CAPABILITY_FSM) transition.
    Transferred,
    /// Received when the agent this one was forked from was copied.
    Forked,
}

impl GgModuleOrigin {
    /// The origin's wire spelling — the same string its
    /// [serialization](GgModuleOrigin#impl-Serialize-for-GgModuleOrigin) produces.
    pub fn as_str(self) -> &'static str {
        match self {
            GgModuleOrigin::Created => "created",
            GgModuleOrigin::Inherited => "inherited",
            GgModuleOrigin::Profile => "profile",
            GgModuleOrigin::Run => "run",
            GgModuleOrigin::Transferred => "transferred",
            GgModuleOrigin::Forked => "forked",
        }
    }
}

impl std::fmt::Display for GgModuleOrigin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One [module](GgModuleKind) an agent instance holds — a row of an
/// [`AgentModules`](GgTelemetryKind::AgentModules) roster.
///
/// The load-bearing field is [`module_id`](Self::module_id): it identifies the **backing store**
/// rather than the holder, so two instances reporting one id are holding one store and two ids are
/// two stores that may merely agree. Everything a reader wants to know about sharing — which
/// instances read one memory, whether a fork copied or linked, whether a profile's twelve instances
/// curate one notebook or twelve — is a fold over that field across every instance's roster.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgAgentModule {
    /// Which module this is.
    pub kind: GgModuleKind,
    /// The **backing store** this holder is a holder of — `memories-2`, `board-0`. Two instances
    /// reporting the same id are holding one store; two ids are two stores. Empty for a disabled
    /// module, which has no store to identify.
    pub module_id: String,
    /// Whether the capability behind the module is on for this instance. A disabled module still
    /// occupies its row, so a capability switched off is legible rather than absent — the same
    /// reason it still occupies its slot in gg's own module set.
    pub enabled: bool,
    /// Whether this holder's prompt carries the module ([`owned`](GgModuleOwnership::Owned)) or it
    /// is reachable through its tools alone ([`unowned`](GgModuleOwnership::Unowned)).
    pub ownership: GgModuleOwnership,
    /// How this holder came by it.
    pub origin: GgModuleOrigin,
    /// The [scope](GgMemoryScope) this holder binds under, for the one kind that has one
    /// (memories); `None` for every other kind. It is the holder's *declared* binding rule, which
    /// the [origin](Self::origin) is the *resolved* answer to — see [`GgModuleOrigin`] for what
    /// their disagreeing means.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub scope: Option<GgMemoryScope>,
    /// Whether this holder may **write** the store. `false` marks a
    /// [read-only](GgMemoryScope::ReadOnly) inherited handle; always `true` for the kinds that have
    /// no access model of their own.
    pub writable: bool,
}

/// What happened to one [module](GgModuleKind) across a succession — a row of an
/// [`AgentTransition`](GgTelemetryKind::AgentTransition)'s
/// [`modules`](GgTelemetryKind::AgentTransition::modules) list.
///
/// It carries the module instance on **both** sides of the boundary, which is what makes a store
/// swap visible: a [`Carried`](GgModuleDisposition::Carried) or
/// [`Linked`](GgModuleDisposition::Linked) module reports the same id twice, and everything else
/// reports two different ones (or one, where only one side held anything).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgTransitionModule {
    /// Which module this row is about.
    pub kind: GgModuleKind,
    /// What the successor (or the copy) received.
    pub disposition: GgModuleDisposition,
    /// The instance the outgoing agent held, when it held one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub from_module_id: Option<String>,
    /// The instance the successor holds, when it holds one. Equal to
    /// [`from_module_id`](Self::from_module_id) for a [carried](GgModuleDisposition::Carried) or
    /// [linked](GgModuleDisposition::Linked) module and different for every other disposition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub to_module_id: Option<String>,
}

/// What a succession did with one [module](GgModuleKind) — the per-kind outcome an
/// [`AgentTransition`](GgTelemetryKind::AgentTransition) reports.
///
/// The distinction that matters is [`Carried`](Self::Carried) versus [`Linked`](Self::Linked)
/// versus [`Copied`](Self::Copied): all three leave the successor holding *something*, and only
/// the first two leave it holding the **same store** — with `Linked` the one case where both
/// instances hold it at once, which is what a fork of a shared notebook (or of the run's board)
/// produces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgModuleDisposition {
    /// The successor holds the very same store, and the predecessor no longer does. A succession.
    Carried,
    /// The copy holds an **independent** copy of the predecessor's contents, which diverge from
    /// here.
    Copied,
    /// The copy holds a **link** onto the same store — both instances hold it. The
    /// [board](GgModuleKind::Board) always, and [memories](GgModuleKind::Memories) whose
    /// [scope](GgMemoryScope) says two agents were meant to curate one notebook.
    Linked,
    /// The instance did not travel: its backing store is gone with the predecessor.
    Dropped,
    /// The successor started a new, empty instance of this kind — either the plan did not carry
    /// one, or what was carried could not be read under the successor's configuration.
    Initialized,
    /// Neither side holds one: the capability is off for both. Present so a
    /// [roster](GgTelemetryKind::AgentModules) and a transition list line up kind for kind.
    Absent,
}

impl GgModuleDisposition {
    /// The disposition's wire spelling — the same string its
    /// [serialization](GgModuleDisposition#impl-Serialize-for-GgModuleDisposition) produces.
    pub fn as_str(self) -> &'static str {
        match self {
            GgModuleDisposition::Carried => "carried",
            GgModuleDisposition::Copied => "copied",
            GgModuleDisposition::Linked => "linked",
            GgModuleDisposition::Dropped => "dropped",
            GgModuleDisposition::Initialized => "initialized",
            GgModuleDisposition::Absent => "absent",
        }
    }
}

impl std::fmt::Display for GgModuleDisposition {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One **capability module** a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) program binds — a
/// row of an [`AgentSurface`](GgTelemetryKind::AgentSurface)'s
/// [`apis`](GgTelemetryKind::AgentSurface::apis) list.
///
/// A module is present exactly when the agent binds at least one of its functions, so a capability
/// this agent was granted nothing from drops the whole module rather than leaving a named-but-empty
/// one. The [description](Self::description) is the same one-line prose the agent's own system
/// prompt names the module by — the surface reports what the model was told, not a second wording
/// of it.
///
/// # Two names, because two readers want different ones
///
/// A module has gg's [id](Self::module) for it and the arm's own [spelling](Self::path) of it, and
/// they are separate fields because they answer to different authorities. Eleven language arms
/// spell the same module `gg::files`, `gg.files` and `Gg.Files`, so a reader grouping a
/// cross-language study by the spelling would report one module as three; a reader quoting what the
/// model actually wrote must use the spelling and nothing else. The id is the same word the
/// [operation](GgTelemetryKind::ApiCall::operation) ids of its calls are namespaced on, which is
/// what makes "the calls this agent made in the module it was offered" a join rather than a guess.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgAgentApi {
    /// gg's cross-arm id for the module — `files`, `views`, `session`.
    pub module: String,
    /// This arm's own spelling of the module, and what the model reads — `gg.files`, `gg::files`.
    pub path: String,
    /// The one-line description of the module the agent's system prompt carries.
    pub description: String,
    /// The functions this instance actually binds in the module, in catalogue order — exactly the
    /// catalogue's own entries for it, with nothing appended that the catalogue does not carry.
    /// Never empty: a module with nothing bound is absent instead.
    pub functions: Vec<GgAgentApiFunction>,
}

/// One function bound in a [`GgAgentApi`] — what a
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) program may call.
///
/// The load-bearing field is [`operation`](Self::operation): every model-facing call a program makes
/// is recorded under gg's own identity for it as an
/// [`ApiCall`](GgTelemetryKind::ApiCall)/[`ApiResult`](GgTelemetryKind::ApiResult) pair, so joining a
/// bound function to how many times this agent actually called it is a join on that one string. No
/// gg tool name appears here, and none is needed: the API surface and the tool vocabulary are two
/// independent surfaces over one core, and a function no tool backs — a view call, an ending call, a
/// program-library call — is counted exactly as a function one does.
///
/// Two rows may name one operation. An arm may offer a second way in — the method it hangs off the
/// type the call operates on, beside the free function every arm has — and both spellings are the
/// same operation, so both carry the same figure. That is the truth about the run: gg counts what
/// was done, not which of an arm's synonyms did it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgAgentApiFunction {
    /// The name a program calls it by — `readFile`, `openDocsView`, `finish`.
    pub name: String,
    /// gg's own identity for what this call does — `files.read_file`, `views.open_docs_view`,
    /// `session.finish` — which is what its [`ApiCall`](GgTelemetryKind::ApiCall) records name it
    /// by, so a count survives a run whose programs were written in another language with other
    /// spellings.
    ///
    /// Every bound entry states one, so joining a surface to a run's calls is a join and never a
    /// guess: an arm's catalogue names the operation of each function it declares, and an entry
    /// naming an operation gg does not have binds nothing at all — an unresolvable operation buys
    /// no gate — so it never reaches this list to be reported without a count.
    pub operation: String,
}

/// The stable id of the Phase 2 [compaction] capability: the automatic
/// summarize-and-restart that lets a run continue past the active model's context
/// window. When the thread nears the window it summarizes the ephemeral history and
/// carries the pinned state (read skills, in-play memories, the task list) across the
/// boundary verbatim. Unlike the Phase 1 defaults this is **opt-in** — a run must name
/// it in its [`GgCapabilitySet`] to enable the backstop — so a configuration that
/// leaves it off simply never compacts. Its `summaryHeadroom` param sets the fraction of
/// the window reserved for the summarization call — which also defines the fullness threshold that
/// triggers a compaction (`1 - summaryHeadroom`) — and its
/// [`implementation`](GgCapabilityConfig::implementation) selects the **compaction
/// strategy**: who writes the summary, and what the restarted thread is rebuilt from.
///
/// Five strategies ship, and they differ along two axes — **who** condenses the thread
/// (the working model itself, or a separate handoff model) and **what** the summary is
/// (prose, a `compact` call that also re-loads files, or memories):
///
/// - [`self-summarization`](COMPACTION_STRATEGY_SELF_SUMMARIZATION) (the default) — the agent
///   is asked, in its own thread, to write the summary its next context is rebuilt from.
/// - [`self-compaction`](COMPACTION_STRATEGY_SELF_COMPACTION) — the agent calls a `compact`
///   tool with a summary **and the files to re-load**, so it chooses what survives.
/// - [`handoff-summarization`](COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION) and
///   [`handoff-compaction`](COMPACTION_STRATEGY_HANDOFF_COMPACTION) — the same two, performed
///   by a **separate model** (the `model` param) reading the thread as labelled user
///   messages.
/// - [`memory-compaction`](COMPACTION_STRATEGY_MEMORY) — the agent writes its working state
///   to [memories](CAPABILITY_MEMORIES) (which are retained verbatim) instead of a summary.
///
/// A strategy gg does not recognize **fails the launch** and names the five it knows. The
/// strategy *is* the experiment, so a run that quietly condensed itself with
/// [`self-summarization`](COMPACTION_STRATEGY_SELF_SUMMARIZATION) while its record named a
/// handoff arm would be a measurement attributed to the wrong arm.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
pub const CAPABILITY_COMPACTION: &str = "compaction";

/// The [compaction](CAPABILITY_COMPACTION) strategy in which **the agent summarizes itself**:
/// gg appends a user message asking for a summary of the work done and the work remaining, and
/// rebuilds the next context from the model's own reply.
///
/// The default: what a compaction capability that names **no** strategy uses. Nothing else falls
/// back to it — a strategy gg does not recognize fails the launch rather than landing here.
pub const COMPACTION_STRATEGY_SELF_SUMMARIZATION: &str = "self-summarization";

/// The [compaction](CAPABILITY_COMPACTION) strategy in which the agent compacts itself through
/// a **`compact` tool** — always offered, taking a summary and the workspace paths to re-load
/// as file views — so the model chooses not only what the recap says but which files survive
/// the boundary. Until it calls `compact`, every other tool call is refused.
pub const COMPACTION_STRATEGY_SELF_COMPACTION: &str = "self-compaction";

/// The [compaction](CAPABILITY_COMPACTION) strategy that hands the thread to a **separate
/// model** (named by the capability's `model` param) for the summary: the agent's own thread is
/// untouched, and the handoff model reads it as labelled user messages with no tools.
pub const COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION: &str = "handoff-summarization";

/// The [compaction](CAPABILITY_COMPACTION) strategy that hands the thread to a **separate
/// model** which must answer with a `compact` call — summary plus the files to re-load. The
/// working model is never offered the tool.
pub const COMPACTION_STRATEGY_HANDOFF_COMPACTION: &str = "handoff-compaction";

/// The [compaction](CAPABILITY_COMPACTION) strategy in which the agent's working state is
/// carried across the boundary as **[memories](CAPABILITY_MEMORIES)** rather than a summary:
/// gg requires the model to write them, accepting only memory calls until a whole reply's calls
/// succeed. It requires the [memories](CAPABILITY_MEMORIES) capability and a writable
/// [scope](MEMORY_PARAM_SCOPE): a profile that selects this strategy without them is **refused**
/// at launch rather than demoted to the default, because a demoted run records the memory arm and
/// measures the summarization one.
pub const COMPACTION_STRATEGY_MEMORY: &str = "memory-compaction";

/// The [compaction](CAPABILITY_COMPACTION) capability param naming the model the two
/// **handoff** strategies delegate to — an ordinary model id, resolved through the same client
/// factory every agent's model is.
///
/// Absent, the handoff strategies condense on the agent's own model, which is the documented
/// default for a key nobody wrote. **Present** and unresolvable is a different thing entirely: the
/// whole point of a handoff arm is *which* model condensed the thread, so a model id the catalog
/// has no window for fails the launch, and one that cannot be reached mid-run ends the run as gg's
/// own error rather than quietly reverting to the working model.
pub const COMPACTION_PARAM_MODEL: &str = "model";

/// The [compaction](CAPABILITY_COMPACTION) capability param **deferring** the handoff model to
/// one of the set's [model slots](GgModelSlot), the way an agent's own binding does with
/// [`model_slot`](GgAgentConfig::model_slot) — so which model condenses the thread can be picked
/// at launch rather than written into the configuration.
///
/// Launching resolves it: the launcher fills the slot in, writes the model it collected to
/// [`model`](COMPACTION_PARAM_MODEL), and drops this key — so a set a run *records* never carries
/// one. A set that reaches gg still carrying it named a slot nobody bound, and gg **refuses** it:
/// the key's mere presence at that point means the launch did not honour the binding, and a run
/// that continued would condense on the agent's own model while its configuration named a slot.
pub const COMPACTION_PARAM_MODEL_SLOT: &str = "modelSlot";

/// The stable id of the Phase 2 [agent-managed context] capability: the model-facing
/// complement to [compaction](CAPABILITY_COMPACTION) that gives the agent agency over
/// its own window — evicting file views it no longer needs and archiving sections of
/// its thread (removed from the live window but still searchable). Opt-in, like
/// compaction.
///
/// [agent-managed context]: https://docs.testcabinet.ai/gg/agent-managed-context/
pub const CAPABILITY_AGENT_MANAGED_CONTEXT: &str = "agent-managed-context";

/// The stable id of the [project management] capability: the heavyweight counterpart to
/// [tasks](CAPABILITY_TASKS) that expands the lightweight to-do list into a **single,
/// run-global work board** substantial enough to organize a large build, shared by every
/// agent in the run. [Epics](GgBoardEpic) group related [issues](GgBoardIssue), and an issue
/// carries structured sections — title, description, in-scope, out-of-scope, and completion
/// criteria — whose explicit scope boundaries and completion criteria are the brief gg hands
/// the agent it dispatches to implement it. Unlike agent-scoped [tasks](CAPABILITY_TASKS),
/// **submitting an issue enqueues it on the shared board**: once every issue it is blocked by
/// is done, gg **automatically spawns a top-level agent and assigns it the issue** — agents no
/// longer hand-dispatch issues to subagents. The [agent profile](GgAgentConfig) an issue is
/// dispatched under is named **when the issue is created** ([`agent`](GgBoardIssue::agent)) and
/// must be one the creating agent lists with the
/// [`implementer`](GgSubagentScope::Implementer) scope. An agent may [wait on an issue] until it
/// reaches a terminal state, and an issue whose assigned agent cannot complete it after its
/// `maxRetries` (default 1) retries is marked [failed](GgIssueStatus::Failed). Issues share the
/// [tasks](CAPABILITY_TASKS) blocked-by DAG (gg rejects any edge that would introduce a cycle),
/// and the whole board is retained across a [compaction](CAPABILITY_COMPACTION) boundary
/// verbatim.
///
/// # Every issue works in its own worktree
///
/// Issues are worked **concurrently**, so each one is isolated: gg makes the run's workspace a git
/// repository (committing a **baseline** of the seeded workspace if it is not already one) and
/// dispatches each issue's agent into a **fresh git worktree on its own branch**, with every
/// file/shell tool rooted there. A retry — and each review round's fix pass — reuses that same
/// worktree, so an attempt builds on what the last one produced. When the issue is finally accepted
/// its branch is **merged back** into the main tree and the worktree is torn down; an issue that
/// ends [failed](GgIssueStatus::Failed) has its worktree discarded unmerged. Because the merge can
/// conflict with work another issue landed first, enabling the capability **requires** naming a
/// [`mergeAgent`](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT): the profile gg hands a conflicted merge to
/// so it can resolve it and finish the merge. Every reconciliation is streamed as
/// [`WorktreeMerged`](GgTelemetryKind::WorktreeMerged).
///
/// # Reviewers gate acceptance
///
/// An issue may name [reviewers](GgBoardIssue::reviewers) — profiles the creating agent lists with
/// the [`reviewer`](GgSubagentScope::Reviewer) scope. When the assigned agent marks the issue
/// complete it moves to [`InReview`](GgIssueStatus::InReview) rather than straight to done: gg runs
/// each reviewer **in turn** against the diff of the issue's worktree, with any prior round's
/// feedback included. A reviewer either **approves** or returns **actionable items**, in which case
/// the issue's own assigned agent is re-invoked with the issue brief plus those items and the
/// review runs again. Only once **every** reviewer approves is the issue actually marked
/// [`Done`](GgIssueStatus::Done) and its worktree merged. The lifecycle is streamed as
/// [`IssueReview`](GgTelemetryKind::IssueReview) telemetry.
///
/// The blocked-by DAG and `wait_for_issue` are **core** to the capability — never withheld
/// away — but two features are optional per agent: **issue creation** (withholding
/// `create_epic`/`create_issue` leaves an agent read-only access to the board, still able to
/// wait on and complete issues) and **required [reviewers](GgBoardIssue::reviewers)** (the
/// `reviewers` param, which makes `create_issue` demand one or more reviewer profiles). The
/// capability as a whole is opt-in, like compaction and agent-managed context — a configuration
/// that leaves it off simply never offers the board calls.
///
/// [project management]: https://docs.testcabinet.ai/gg/project-management/
/// [wait on an issue]: https://docs.testcabinet.ai/gg/project-management/
pub const CAPABILITY_PROJECT_MANAGEMENT: &str = "project-management";

/// The [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability param naming the run's
/// **merge agent**: the [agent profile](GgAgentConfig) gg dispatches when merging an accepted
/// issue's worktree back into the main tree hits a **conflict**, so the conflict is resolved and
/// the merge finished rather than the issue's work being stranded on its branch.
///
/// It is **required** — a set that enables project management without naming a merge agent is
/// refused at launch — because concurrent issues make a conflicting merge an ordinary event, not an
/// edge case, and silently dropping the loser's work would make the board dishonest. The named
/// profile must exist in the set and must have the [shell](CAPABILITY_SHELL) capability enabled:
/// resolving a merge means running `git` in the workspace, which is not something an agent without
/// a shell can do.
pub const PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: &str = "mergeAgent";

/// The stable id of the Phase 4 [subagents] capability: the delegation core — an agent's
/// ability to **spawn other agents**, work in parallel with them or **block** until they
/// return, **message** a running child, and receive its **return value**.
///
/// When enabled, the agent is offered the `spawn_subagent`/`wait_for_subagents`/`send_message`
/// tools and its subagents are governed by a single global [scheduler]: the run's
/// [`maxParallel`](GgRunLimits::max_parallel) caps how many agents run at once (a spawn beyond the
/// cap **blocks until a slot frees**), and this capability's
/// `maxDepth` param bounds recursion (a spawn at `maxDepth` is **refused**, not queued). A blocked
/// parent frees its running slot so other work runs but retains priority over not-yet-started
/// agents. Off (its default — it is opt-in), the tools vanish and a run stays single-agent. A
/// subagent is spawned **by name** — `spawn_subagent` names the target [agent profile](GgAgentConfig),
/// which must appear in the caller's [allowlist](GgAgentConfig::subagents) — and runs on that
/// profile's own model, orthogonally to the parallelism cap.
///
/// [subagents]: https://docs.testcabinet.ai/gg/subagents/
/// [scheduler]: https://docs.testcabinet.ai/gg/subagents/#scheduling
pub const CAPABILITY_SUBAGENTS: &str = "subagents";

/// The stable id of the Phase 5 [FSM-driven processes] capability: driving a run through a
/// **finite state machine** so the *order* of the work is a property of the process, not the
/// model's discretion.
///
/// Where a subagent fan-out is assembled by the agent, an FSM is a state
/// table the agent is *driven through*: each [state](GgFsmState) binds an
/// [agent profile](GgAgentConfig), and a [transition](GgFsmTransition) replaces the running agent
/// instance with the next state's, carrying exactly the [modules](GgModuleKind) the transition
/// names. Opt-in, like the other Phase 2+ capabilities.
///
/// The machine is **entirely user-authored**: a profile that enables this capability declares a
/// [`states`](FSM_PARAM_STATES) table over the run's *other* agent profiles and has no turns of its
/// own — it is an **FSM shell**, and its own model binding and other capabilities are ignored. gg's
/// earlier form of the capability shipped a small library of harness-authored machines (`tdd`,
/// `plan-first`) selected by a `machine` param; a machine only gg can author is a machine only gg
/// can study, so both were removed. A set that still carries the old `machine` param and no
/// `states` **fails to launch** rather than silently running as an ordinary single agent, which
/// would have made every number drawn from it a measurement of the wrong thing.
///
/// [FSM-driven processes]: https://docs.testcabinet.ai/gg/fsms/
pub const CAPABILITY_FSM: &str = "fsm";

/// The [`params`](GgCapabilityConfig::params) key on the [FSM](CAPABILITY_FSM) capability carrying
/// the machine itself: a non-empty ordered list of [states](GgFsmState), of which the **first** is
/// the entry state.
///
/// The entry state is a position rather than a flag for the same reason the run's root agent is
/// `agents[0]` — a document that says which one starts in two places can disagree with itself.
///
/// The value is read as `Vec<GgFsmState>`. A profile that enables the capability with this key
/// absent, unparseable, or empty is a **launch failure**: an FSM shell has no turns of its own, so
/// there would be nothing at all to run.
pub const FSM_PARAM_STATES: &str = "states";

/// One state of a user-authored [FSM](CAPABILITY_FSM): the [agent profile](GgAgentConfig) that runs
/// while the machine sits in it, and where it may go from there.
///
/// A state is not itself an agent — it *binds* one. That indirection is what lets two states share a
/// profile (a machine that returns to `explore` runs the same `Explorer` twice) and what makes the
/// machine a document about **order** rather than a second place agents are configured.
///
/// A state with no [transitions](Self::transitions) is **terminal**: the agent instance it runs is
/// offered no transition call at all, so the machine ends when that agent ends, and its ending is
/// the FSM agent's return value to whoever put it to work.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgFsmState {
    /// The state's name — how a [transition](GgFsmTransition::to) addresses it and how the model
    /// names it when it moves. Must be non-empty and unique within the machine; both are launch
    /// failures, because a transition to an ambiguous name has no answer.
    pub name: String,
    /// The [agent profile](GgAgentConfig) this state runs: its model, its capabilities, its system
    /// prompt. Must name a profile the set declares, and must not name an FSM shell (a shell cannot
    /// be a state — it would recurse).
    ///
    /// Defaulted rather than required so a state that omits it is refused by the machine's own
    /// validation — which names the state and says what is missing — instead of by a serde error
    /// about a field the author never knew to write.
    #[serde(default)]
    pub agent: String,
    /// Where the agent in this state may go. Empty (the default) makes the state terminal.
    #[serde(default)]
    pub transitions: Vec<GgFsmTransition>,
}

/// One edge of a user-authored [FSM](CAPABILITY_FSM): a state the model may move to, and exactly
/// what it takes with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgFsmTransition {
    /// The [state](GgFsmState::name) this edge leads to. Must name a state the same machine
    /// declares; anything else is a launch failure.
    pub to: String,
    /// The [modules](GgModuleKind) the successor's agent instance inherits, in the state they were
    /// in — a `tasks` transfer hands over the predecessor's task list itself, not a copy of its
    /// summary.
    ///
    /// **Explicit, with no implicit history.** An absent or empty list transfers nothing, which is a
    /// deliberate hard reset between states rather than an oversight: a recorded configuration has
    /// to say what it does, and a default nobody wrote down is exactly the sort of decision a reader
    /// of the record cannot see. The console's editor pre-fills `["history"]` on every transition it
    /// creates, so the common case is still one click.
    ///
    /// Read **strictly**: every entry must be a [module kind](GgModuleKind) gg knows. An entry that
    /// is not one — a mistyped name, or a value that is not even a string — fails the document,
    /// which fails the launch. A transfer list gg silently shortened would run a machine that hands
    /// its successor less than the configuration says it hands it, and there is no reading of the
    /// record afterwards that could show the difference.
    #[serde(default)]
    pub transfer: Vec<GgModuleKind>,
    /// When the model should take this edge, in its own words — rendered into the transition tool's
    /// description beside the target name, exactly as an agent's roster description is rendered into
    /// `spawn_subagent`'s. Optional, and worth writing: it is the only thing that tells the model
    /// *why* one target rather than another.
    #[serde(default)]
    pub description: String,
}

/// The stable id of the [exec] capability: an agent's ability to **replace itself** with one
/// running another [profile](GgAgentConfig).
///
/// `exec` is the same operation over [modules](GgModuleKind) an [FSM](CAPABILITY_FSM) transition
/// performs, with the *model* rather than a declared machine choosing when it happens and what it
/// becomes. The successor is named from the caller's own [delegation
/// roster](GgAgentConfig::subagents), the same allowlist spawning is validated against. Every
/// module both profiles have is carried live, so the successor opens on its predecessor's whole
/// conversation; a capability the successor does not have is dropped, and one only it has starts
/// empty. It is one agent throughout: one id in the tree per incarnation, one scheduler slot, one
/// return value to whoever put it to work. Naming an FSM shell **enters that machine** at its entry
/// state, which is how a plain agent hands its work to a declared process.
///
/// The call is **turn-final**: it is declared during a turn and applied once every tool result of
/// that turn is recorded, because a window rewritten mid-turn would strand an assistant message
/// whose results had not been written yet. A turn that declares two successions keeps the first and
/// refuses the second — a silently replaced successor identity is a change the model cannot see. An
/// agent standing in an [FSM](CAPABILITY_FSM) state is **not** offered `exec` at all: where the run
/// goes next is the machine's decision there, and `transition_state` is how it is made.
///
/// Opt-in, like every Phase 2+ capability, and independent of [`fork`](CAPABILITY_FORK): becoming
/// something else and duplicating yourself are separate abilities, so the interesting arm ("can it
/// become something else, but not duplicate itself?") is a capability of its own rather than a
/// toggle inside a shared one.
///
/// [exec]: https://docs.testcabinet.ai/gg/fork-and-exec/
pub const CAPABILITY_EXEC: &str = "exec";

/// The stable id of the [fork] capability: an agent's ability to **clone itself** into a child.
///
/// A `fork` mints a copy of the running instance: same profile, its own id, one level deeper, its
/// own scheduler slot, and a deep copy of everything the forker holds — the window above all, so
/// the copy opens knowing everything its parent knew. Memories are the exception, and follow the
/// forker's [scope](GgMemoryScope): a linked one stays linked, an [isolated](GgMemoryScope::Isolated)
/// one is copied. The copy is an ordinary subagent from there: it is waited on and messaged like any
/// other, so it needs the [subagents](CAPABILITY_SUBAGENTS) capability to be collectable at all, and
/// it counts against the same depth and parallelism caps.
///
/// Like [`exec`](CAPABILITY_EXEC) the call is **turn-final**, and it stays available to an agent
/// standing in an [FSM](CAPABILITY_FSM) state — the copy is an ordinary child, not a second driver
/// of the machine.
///
/// Opt-in, and independent of [`exec`](CAPABILITY_EXEC).
///
/// [fork]: https://docs.testcabinet.ai/gg/fork-and-exec/
pub const CAPABILITY_FORK: &str = "fork";

/// The stable id of the Phase 6 [responses-as-code] capability: an **alternative to traditional
/// tool calling** in which the agent emits a *program over the available tools* — loops,
/// conditionals, intermediate values, and several tool invocations composed together — that gg
/// runs in a [wasmtime](https://wasmtime.dev/) sandbox (the same fuel/memory-bounded guest-in-wasm
/// pattern The Test Cabinet's [Foray](https://docs.testcabinet.ai/testing/adversarial/foray/architecture/)
/// engine uses) rather than dispatching one discrete tool call at a time.
///
/// When enabled, an agent's turn no longer offers the model native tool calls. The model's
/// **whole reply is the program** — with no code fence, no extraction and no language tag — in which
/// each of the run's [tools](CAPABILITY_SHELL) is a **typed function** (`readFile(path, { limit })`,
/// not a generic call by name), executed in a wasmtime **component** sandbox. Which
/// [language](GgProgramLanguage) that program is written in is the capability's `language` param: a
/// configuration knob a cross-language study slices its arms on, defaulting to TypeScript. gg
/// [heals](GgResponseHealing) the reply, prepares it for that language's guest, and runs it — bridging each
/// tool call the program makes to the real
/// [`ToolRegistry`](https://docs.testcabinet.ai/gg/overview/) (so the tool runs in the container and
/// its result flows back **into the program**) — and feeds the program's result (plus any error or
/// fuel exhaustion) back into the context as the turn's outcome. The tool calls the program made
/// still stream as ordinary [`ToolCall`](GgTelemetryKind::ToolCall)/[`ToolResult`](GgTelemetryKind::ToolResult)
/// telemetry, and the turn itself is streamed as a [`CodeExecution`](GgTelemetryKind::CodeExecution)
/// event. A program that calls a delegation tool still goes through the subagent
/// [scheduler](CAPABILITY_SUBAGENTS).
///
/// The session ends **only** when a program calls `finish(summary)` — a real function on the
/// sandbox's model-facing surface rather than a rule about text — whose summary becomes the run's
/// final text. Saying the work is done therefore ends nothing: a reply that is prose compiles (or
/// fails to) like any other, and the run goes on until a program calls the ending function.
///
/// Responses are **healed** before they run: a conservative, deletion-only text repair that unwraps
/// a fence the model added, drops explanatory prose from around the program, and halves a reply that
/// arrived as one completion concatenated with a byte-identical copy of itself. What counts as a
/// fence tag, or as a line of prose, belongs to the program language; the repairs themselves do not.
/// Every application is disclosed to the model in its turn feedback
/// and [counted on the run](GgHealingSummary), because a repair the model is not told about teaches
/// it nothing and corrupts the figures two configurations would be compared on; each
/// [strategy](GgHealingStrategy) is independently toggleable through the capability's `healing`
/// param — the first two on unless turned off, and
/// [`drop-doubled-response`](GgHealingStrategy::DropDoubledResponse) off unless a run arms it.
///
/// Every tool the run offers is bound into the program's surface: there is no class of call a
/// program is denied, so the toolset a program sees is exactly the toolset a JSON tool-calling
/// session would see. `finish` is the one exception in the other direction — it is a real function
/// but not a tool, so neither the membrane's enabled-set guard nor the loop's dispatch gates apply
/// to it.
///
/// gg includes responses-as-code **so its effectiveness can be measured empirically** — toggled
/// against traditional tool calling (the [`cap.responses-as-code`](crate::gg_query) document field,
/// plus the [`execution_mode`](GgSessionSummary::execution_mode) the run records), it answers
/// "does a code-shaped response help a model tackle the large [Hard](https://docs.testcabinet.ai/testing/end-to-end/)
/// cases?" with data. Opt-in, like the other Phase 2+ capabilities.
///
/// [responses-as-code]: https://docs.testcabinet.ai/gg/responses-as-code/overview/
pub const CAPABILITY_RESPONSES_AS_CODE: &str = "responses-as-code";

/// The stable id of the **program library** capability: gg keeps the source of every program a
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) agent has run, and hands the agent a `programs`
/// object to reach back for one, patch it, and hand it back to be run.
///
/// # The problem it exists for
///
/// Measured against traditional tool calling on the same case, responses-as-code collapses a task
/// from roughly twenty-three turns to six: a model given a program instead of one call at a time
/// does far more per turn. The cost of that is carried entirely by mistakes. A sixty-line program
/// with one wrong identifier is sixty lines the model must emit again to change one of them — the
/// error is small and the retry is total, and every one of those retries is paid in output tokens
/// and latency for text the model has already written once.
///
/// The library makes the fix proportional to the mistake. gg records the source of every program it
/// runs, keyed by the turn it ran on, and a program can fetch one back:
///
/// ```ts
/// const source = programs.get();                            // the previous turn's program
/// programs.rerun(source.replace("cosnt x", "const x"));      // gg runs the patched one
/// ```
///
/// Three functions, on a `programs` object bound only when this capability is on: `history()` lists
/// the programs held (turn, size, whether each ran to its end), `get(turn?)` returns one's exact
/// source, and `rerun(source)` hands gg a program to run **in place of the one that called it**.
///
/// # What `rerun` does, and what it does not
///
/// It is **registered, not performed**, exactly as [`compact`](CAPABILITY_AGENT_MANAGED_CONTEXT) and
/// an [exec](CAPABILITY_EXEC) are: the call validates the source and returns, the calling program
/// carries on to its end, and gg then compiles and runs what it was handed as the
/// same turn's program. Nothing is undone — every call the registering program made stands — and the
/// program that runs next sees exactly the world it left behind. The first registration stands and a
/// second is refused; a program that then fails loses the registration along with everything else it
/// decided, on the same rule that revokes an ending. The chain is bounded, and a turn that reaches
/// the bound is told so.
///
/// The source gg keeps for a turn is the program that **executed**, so fetch-patch-rerun composes:
/// the patched program is what the next turn's `get()` returns, not the two lines that asked for it.
/// The library also outlives the context window — it is gg's own state, not a message — so a
/// [compacted](CAPABILITY_COMPACTION) agent can still reach the program it wrote forty turns ago.
///
/// # What it is bounded by
///
/// Its `keep` param is how many of the most recent programs are retained (gg's default is 20; `0`
/// retains every program of the session). It bounds memory, not the model: a `get` of a turn the
/// retention has dropped is `not-found` naming the turns that are held.
///
/// gg includes it **so its effectiveness can be measured empirically** — toggled against the same
/// runs without it, it answers "does making a retry proportional to the mistake pay for itself?"
/// with data. Opt-in, and inert without [responses-as-code](CAPABILITY_RESPONSES_AS_CODE): there are
/// no programs in a tool-calling session to keep.
pub const CAPABILITY_PROGRAM_LIBRARY: &str = "program-library";

/// The stable id of the **documentation-view close** capability: whether a
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) agent may take a documentation view back out of
/// its own context window.
///
/// # Why *closing* is the toggle, and opening is not
///
/// A documentation view is keyed by the thing it documents, and what it documents is a constant: the
/// same key renders the same bytes for the life of the agent. So gg opens one **append-only** — a
/// second open of a key that is already open is a total no-op, not a re-placement — and the whole
/// documentation band therefore sits in the prompt as a strictly growing suffix. That is the
/// property a provider's prompt cache reads: every request extends the last, and nothing a model does
/// with documentation can invalidate a cached prefix.
///
/// Closing is the one thing that can. Removing an item from the middle of the window rewrites the
/// prompt from that position onward, and the run pays for every cached token after it. That is not a
/// reason to forbid closing — an agent that has read forty functions it no longer needs is holding
/// forty blocks it could spend on the task — but it is exactly the reason the two are not one
/// decision. Opening is unconditional because it is free of that risk; closing is a capability
/// because it is not, and because whether the reclaim pays for the invalidation is a question with a
/// measurement rather than an answer.
///
/// Default **off**, which is the arm in which the claim above holds without qualification.
pub const CAPABILITY_DOCVIEW_CLOSE: &str = "docview-close";

/// Every capability id gg ships, in catalog order — the **closed** vocabulary a
/// [capability config](GgCapabilityConfig::id) is read against.
///
/// This is the single authority on what a capability may be called. A
/// [set](GgCapabilitySet) naming an id that is not here cannot be honoured as written — gg has no
/// such capability to switch on, and every surface downstream would report a configuration that
/// did nothing — so it is **refused at launch**, before the first turn and before any model spend,
/// rather than carried through the run as a field nothing reads.
///
/// It is also what makes the `cap.*` [query](crate::gg_query) namespace **total**:
/// the document builder stores an explicit `false` for every id here that a run did not enable, so
/// "configured and off" and "never mentioned" collapse into one honest answer instead of a missing
/// key that would fail every comparison and quietly shrink an enablement rate's denominator. Because
/// the launch refuses anything outside this list, that totality is unconditional — no run can carry
/// an id the catalog has never heard of.
///
/// Adding a capability to gg means adding it here, and forgetting to means the capability cannot be
/// configured at all — which is a loud failure rather than a silent one, and deliberately so.
pub const GG_CAPABILITY_CATALOG: &[&str] = &[
    CAPABILITY_SHELL,
    CAPABILITY_READ_FILE,
    CAPABILITY_WRITE_FILE,
    CAPABILITY_EDIT_FILE,
    CAPABILITY_LIST_DIR,
    CAPABILITY_CONTEXT_WINDOW_OVERRIDE,
    CAPABILITY_AUTOLOAD_SPECS,
    CAPABILITY_AGENT_PERSISTENCE,
    CAPABILITY_SKILLS,
    CAPABILITY_MEMORIES,
    CAPABILITY_TASKS,
    CAPABILITY_COMPACTION,
    CAPABILITY_AGENT_MANAGED_CONTEXT,
    CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_SUBAGENTS,
    CAPABILITY_FSM,
    CAPABILITY_EXEC,
    CAPABILITY_FORK,
    CAPABILITY_RESPONSES_AS_CODE,
    CAPABILITY_PROGRAM_LIBRARY,
    CAPABILITY_DOCVIEW_CLOSE,
];

/// The workspace-relative dotdir gg keeps **its own** files in during a run: the capture
/// [journal](crate::gg_session_journal::GG_SESSION_JOURNAL_PATH) and the
/// [skills](CAPABILITY_SKILLS) library.
///
/// Everything under it is gg's bookkeeping, never the model's work, so seeding adds `/.gg/`
/// to the seeded repository's `.git/info/exclude`
/// ([`crate::seeding`]). That is load-bearing rather than tidy: the journal grows *inside the
/// model's working tree while the session runs*, so without the exclusion it would show up in
/// an issue reviewer's per-file diff stat, in a worktree
/// commit, and — through the model's own `git add -A` — in the **public per-run repository**,
/// where it would publish a verbatim transcript of every model call. It must be excluded at
/// seed time because no publish-time filter can undo a commit the model already made.
pub const GG_WORKSPACE_DIR: &str = ".gg";

/// The name a fresh capability set's **root agent** is seeded with.
///
/// It is a starting value, not an invariant: the root is the **first**
/// [profile](GgCapabilitySet::agents) a set declares ([`GgCapabilitySet::root`]), whatever
/// it is called, and an operator may rename it or make another profile the root. Nothing
/// resolves the root by this name — code that means "the root" must ask
/// [`GgCapabilitySet::root`] (or [`GgCapabilitySet::root_name`]) for it, or a configuration
/// whose root was renamed would fail to launch.
pub const ROOT_AGENT: &str = "Root";

/// The declarative, inspectable configuration of a gg run — its *independent
/// variable*.
///
/// A gg run is configured by a capability set rather than a harness+model+orchestrator
/// tuple. Its capabilities are **per agent**: the set declares one or more
/// [agent profiles](GgAgentConfig) — the first is the [root](Self::root) —
/// each with its own enabled capabilities, model binding, custom prompt, and the set
/// of other agents it may spawn as subagents. The set is expressed as data so a run's
/// exact configuration is recorded and reproducible, and so
/// [result aggregation](https://docs.testcabinet.ai) can slice results by
/// configuration. Freeze the model and the test case, vary the capability set, and the
/// harness becomes a laboratory.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgCapabilitySet {
    /// The name of a saved preset this set was assembled from (for example
    /// `"minimal"`, `"full"`, or `"planning-A"`), when it is a named preset rather
    /// than a hand-assembled configuration. A study is a sweep over presets, so this
    /// records which one produced a run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub preset: Option<String>,
    /// The agent profiles this run is configured with, each with its own capabilities,
    /// model binding, and delegation graph. **The first is the [root](Self::root)** — it
    /// drives the top-level session and is the default profile for issue dispatch and
    /// helper agents — whatever it happens to be *called*: the root is a position, not a
    /// name, so a configuration may rename it or promote another profile to it. A set
    /// that names the key at all must list at least one profile: an empty list is a
    /// configuration with no root, and a launch rejects it by name.
    #[serde(default = "default_agents")]
    pub agents: Vec<GgAgentConfig>,
    /// The [launch-time model parameters](GgModelSlot) this set declares, for the
    /// [agent bindings](GgAgentConfig::model_slot) that defer to one instead of pinning
    /// a model. Empty for a fully pinned set — and empty on the set a run *records*,
    /// because launching resolves every deferred binding first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub model_slots: Vec<GgModelSlot>,
    /// The **run-level guardrails** this run is bounded by — the turn, runtime, error and
    /// cost ceilings that stop a session and record which one stopped it, plus the
    /// [parallelism cap](GgRunLimits::max_parallel) that bounds how many of its agents run
    /// at once.
    ///
    /// They ride on the capability set rather than on the [launch envelope](GgInvocation)
    /// because the set is what a run *records*: a ceiling that stopped a run is only
    /// interpretable beside the value it was set to. They are deliberately not a
    /// capability — a capability is a feature a configuration switches on or off, a ceiling is an
    /// operator's guardrail over every capability at once — so they never appear in the
    /// [`cap.*`](crate::gg_query) document namespace.
    /// A set that declares none omits the key entirely.
    #[serde(default, skip_serializing_if = "GgRunLimits::is_empty")]
    pub limits: GgRunLimits,
    /// The **session hooks** this run is scripted with — the operator-authored commands and
    /// scripts gg runs at the run's two [ends](SESSION_HOOK_EVENTS), before the root agent's first
    /// turn and after its last.
    ///
    /// Only the session events live here. The other eight ([`AGENT_HOOK_EVENTS`]) fire because a
    /// particular agent did something and are declared on that agent
    /// ([`GgAgentConfig::hooks`]) — see [`GgHook`] for why the split falls where it does. A
    /// non-session event in this list is a configuration error, not a run-wide shorthand.
    ///
    /// Deliberately not a [capability](GgCapabilityConfig), for the same reason the
    /// [ceilings](Self::limits) are not: a capability is a feature the *model* is given and one
    /// configuration switches off where another leaves it on, while a hook is the operator
    /// reaching into the run from outside it.
    ///
    /// A set that declares none omits the key entirely.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hooks: Vec<GgHook>,
}

impl Default for GgCapabilitySet {
    /// A capability set carrying a single [Root agent](ROOT_AGENT) with the default
    /// capabilities but **no** model binding, so it needs no model id. Use
    /// [`Self::minimal`] to build a launchable set bound to a model.
    fn default() -> Self {
        Self {
            preset: None,
            agents: default_agents(),
            model_slots: Vec::new(),
            limits: GgRunLimits::default(),
            hooks: Vec::new(),
        }
    }
}

impl GgCapabilitySet {
    /// The reasonable "minimal" set: a single [Root agent](ROOT_AGENT) bound to
    /// `model_id` with the default capabilities ([`CAPABILITY_SHELL`], the four filesystem
    /// tools ([`CAPABILITY_READ_FILE`], [`CAPABILITY_WRITE_FILE`],
    /// [`CAPABILITY_EDIT_FILE`], [`CAPABILITY_LIST_DIR`]), [`CAPABILITY_SKILLS`],
    /// [`CAPABILITY_MEMORIES`], and [`CAPABILITY_TASKS`]) present and enabled. This is a
    /// launchable configuration — the smallest set that runs a gg session end to end.
    pub fn minimal(model_id: impl Into<String>) -> Self {
        Self {
            preset: Some("minimal".to_string()),
            agents: vec![GgAgentConfig {
                model_id: model_id.into(),
                ..GgAgentConfig::root()
            }],
            model_slots: Vec::new(),
            limits: GgRunLimits::default(),
            hooks: Vec::new(),
        }
    }

    /// The **root agent** — the first profile, which drives the top-level session.
    /// Returns a reference rather than an `Option` because a launch refuses a set that
    /// declares no profiles, so by the time anything runs there is always a first one.
    ///
    /// The root is identified by **position, never by name**: it is seeded as
    /// [`ROOT_AGENT`] but an operator may rename it, so looking one up by that name would
    /// silently fail on a renamed configuration.
    ///
    /// # Panics
    ///
    /// On a set that declares no agents — which is a **malformed** configuration, not an
    /// unusual one: it has no root, so gg's own launch validation and the backend's launch
    /// body each reject it by name, and nothing that runs can be holding one. That makes
    /// this contract safe for the run path and unsafe everywhere else: code that reads a
    /// **stored** set — a record it did not launch, and so a record that may be
    /// hand-written or corrupt — must ask [`Self::agents`] directly rather than assert a
    /// root through this. The [document builder](crate::gg_query::build_run_doc) is the
    /// standing example.
    pub fn root(&self) -> &GgAgentConfig {
        self.agents
            .first()
            .expect("a gg capability set always has at least one agent")
    }

    /// The [root agent](Self::root)'s name — what a helper knob or a telemetry slot names when it
    /// means "whichever profile drives this run".
    ///
    /// Never a **substitute** for a profile that was asked for by name and is not declared: an
    /// agent run under the root instead of the profile it was dispatched as is a different agent
    /// with a different model and different capabilities, recorded under the wrong name. gg reports
    /// that as its own defect and ends the agent that asked — and the whole session with it, when
    /// that agent is the run's root — rather than answering it from here.
    pub fn root_name(&self) -> &str {
        &self.root().name
    }

    /// The agent profile with the given `name`, or `None` when this set declares none.
    pub fn agent(&self, name: &str) -> Option<&GgAgentConfig> {
        self.agents.iter().find(|a| a.name == name)
    }

    /// Whether **any** agent in this set has the capability with `id` enabled.
    ///
    /// Deliberately not one of the [root conveniences](Self::is_enabled) below, and not a
    /// substitute for them: a capability that grants a *tool* is scoped to the agent that
    /// declares it, and reading it run-wide would hand the tool to profiles that were
    /// configured without it. This is for the handful of capabilities that are
    /// **run-wide facts** rather than per-agent powers — where enabling it anywhere
    /// changes the run, so asking only the root silently ignores the configuration.
    ///
    /// The query language's [`cap.<id>` fields](crate::gg_query::build_run_doc) are the
    /// case that keeps it: `avg(cap.compaction)` is
    /// meant to be an enablement *rate*, and a root-only read would score a run that
    /// configured the capability per-agent as not having used it at all.
    pub fn any_agent_enabled(&self, id: &str) -> bool {
        self.agents.iter().any(|agent| agent.is_enabled(id))
    }

    // --- Root-agent conveniences ------------------------------------------------
    //
    // These forward to the [Root agent](Self::root) for the run-level reads that describe a run
    // by its Root — launch validation and the session summary. Code that *executes* a specific
    // agent must
    // read that agent's own [`GgAgentConfig`], never these; code asking whether a run
    // used a feature at all wants [`Self::any_agent_enabled`].

    /// Whether the [Root agent](Self::root) has the capability with `id` enabled.
    pub fn is_enabled(&self, id: &str) -> bool {
        self.root().is_enabled(id)
    }

    /// The [Root agent's](Self::root) config for the capability with `id`.
    pub fn capability(&self, id: &str) -> Option<&GgCapabilityConfig> {
        self.root().capability(id)
    }

    /// Whether the [Root agent's](Self::root) [allowlist](GgAgentConfig::tools) grants `tool`.
    pub fn grants_tool(&self, tool: &str) -> bool {
        self.root().grants_tool(tool)
    }

    /// Whether the [Root agent's](Self::root) [allowlist](GgAgentConfig::operations) grants the
    /// operation with the rendered id `operation`.
    pub fn grants_operation(&self, operation: &str) -> bool {
        self.root().grants_operation(operation)
    }

    /// The profile that actually **runs** when work is dispatched onto the profile named `name`:
    /// that profile, or — when it is an [FSM shell](GgAgentConfig::is_fsm_shell) — the agent its
    /// machine's [entry state](GgAgentConfig::fsm_entry_agent) runs.
    ///
    /// This is the profile a dispatch takes its **model** from, because it is the one whose turns
    /// are about to be taken: an agent put to work on a machine *becomes* that machine's entry
    /// state before its first turn, and the shell itself has no model at all. One hop is enough —
    /// a state may not run another shell.
    ///
    /// Every way this can fail names the profile that is missing ([`GgDispatchError`]); none of
    /// them answers with some *other* profile. Resolving a shell whose entry agent the set does not
    /// declare as the shell itself is the worst answer available here, not the safest: a shell
    /// carries no model, so the caller would report the **shell** as the agent missing a binding —
    /// a true sentence about an agent nobody asked about, sending whoever reads it to the wrong
    /// line of the configuration. Worse, a shell that *does* carry a stray `modelId` would resolve
    /// clean, and the run would be launched, recorded and compared against a model the
    /// configuration never named for it. Attribution that reads as real is worse than no
    /// attribution, and attribution is what a run is for.
    pub fn dispatched_agent<'a>(
        &'a self,
        name: &'a str,
    ) -> Result<&'a GgAgentConfig, GgDispatchError<'a>> {
        let agent = self
            .agent(name)
            .ok_or(GgDispatchError::UndeclaredProfile(name))?;
        if !agent.is_fsm_shell() {
            return Ok(agent);
        }
        // Asked of the shell rather than of `fsm_entry_agent` alone, which answers `None` both for
        // "not a machine" and for "a machine nothing can be entered at" — two different facts that
        // must not share a report.
        let entry = agent
            .fsm_entry_agent()
            .ok_or(GgDispatchError::UnreadableMachine { shell: &agent.name })?;
        self.agent(entry)
            .ok_or(GgDispatchError::UndeclaredEntryAgent {
                shell: &agent.name,
                entry,
            })
    }

    /// The declaration of the named [model slot](GgModelSlot), or `None` when this set
    /// declares no such slot.
    pub fn model_slot(&self, name: &str) -> Option<&GgModelSlot> {
        self.model_slots.iter().find(|s| s.name == name)
    }

    /// Every distinct model the set can actually run an agent on, in agent order —
    /// each agent's resolved model id, deduplicated.
    ///
    /// This is the list a launch resolves per-model facts for (the context window each
    /// model's agents are measured against, pushed in via
    /// [`GgInvocation::model_windows`]): a run may span several models, so one figure
    /// for "the run's model" would be wrong for every agent off the Root's model. An
    /// agent whose binding is still [deferred](GgAgentConfig::model_slot) names no model
    /// and is skipped, as is an [FSM shell](GgAgentConfig::is_fsm_shell), which runs none.
    ///
    /// A **[compaction handoff](COMPACTION_PARAM_MODEL) model counts too**, and that is not a
    /// nicety: it is a second model this run really does send requests to, on the one event that
    /// rewrites an agent's entire window. Left off this list it would never be priced, never have a
    /// window resolved, and never be checked against the catalog — so a handoff naming a model that
    /// does not exist would launch, fail to resolve on the first compaction, and (before this
    /// remediation) quietly condense on the working model while the record named the handoff arm.
    /// Being on the list is what makes that a launch refusal instead.
    pub fn bound_model_ids<'a>(&'a self) -> Vec<&'a str> {
        let mut ids: Vec<&'a str> = Vec::new();
        let mut push = |id: &'a str| {
            if !id.is_empty() && !ids.contains(&id) {
                ids.push(id);
            }
        };
        for agent in &self.agents {
            if let Some(id) = agent.resolved_model_id() {
                push(id);
            }
            if let Some(model) = agent.handoff_model_id() {
                push(model);
            }
        }
        ids
    }

    /// The agents whose model binding is still [deferred](GgAgentConfig::model_slot) to a
    /// [model slot](GgModelSlot) the launch has not filled in — the launch inputs a
    /// configuration is still waiting on, in agent order (by agent name).
    ///
    /// Launching resolves every one of them, so this is empty for the capability set a
    /// run records; a non-empty result is a configuration being *launched*, not run.
    ///
    /// An [FSM shell](GgAgentConfig::is_fsm_shell) is never listed: a machine takes no turns,
    /// so there is no model for a launch to supply and nothing about it is outstanding.
    pub fn unresolved_agents(&self) -> Vec<&str> {
        self.agents
            .iter()
            .filter(|a| !a.is_fsm_shell() && !a.is_resolved())
            .map(|a| a.name.as_str())
            .collect()
    }
}

/// Why [`GgCapabilitySet::dispatched_agent`] cannot name the profile a dispatch would run.
///
/// Every arm is the same underlying fault — a name the set does not declare — and they are held
/// apart because they are *different names*. That is the entire value of returning one: whoever
/// reports it can say which profile is missing, and a machine's fault is never reported against
/// the machine.
///
/// None of these is reachable in a launched run: gg's launch validation refuses a set with any of
/// them in it, and the backend refuses the launch body before that. Reaching one means the two have
/// come apart, which is a defect in gg rather than a configuration an operator can fix — so callers
/// report it and stop rather than picking a profile to carry on as.
///
/// Borrows the set it was produced from, so a report can name the profile without copying: these
/// are read, formatted and dropped at the site that asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GgDispatchError<'a> {
    /// The set declares no profile by this name at all.
    UndeclaredProfile(&'a str),
    /// `shell` is an [FSM shell](GgAgentConfig::is_fsm_shell) whose machine has no readable
    /// [entry state](GgAgentConfig::fsm_entry_agent) — no states, or a first state naming no
    /// agent — so there is nothing for a dispatch onto it to become.
    UnreadableMachine {
        /// The shell profile whose machine could not be entered.
        shell: &'a str,
    },
    /// `shell` is an [FSM shell](GgAgentConfig::is_fsm_shell) whose machine enters a state running
    /// the `entry` agent, which the set does not declare.
    UndeclaredEntryAgent {
        /// The shell profile the dispatch was aimed at.
        shell: &'a str,
        /// The entry state's agent — the name that is actually missing.
        entry: &'a str,
    },
}

impl fmt::Display for GgDispatchError<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UndeclaredProfile(profile) => {
                write!(f, "no `{profile}` agent profile is declared")
            }
            Self::UnreadableMachine { shell } => write!(
                f,
                "the `{shell}` agent is a state machine with no readable entry state, so there is \
                 no agent profile for it to run"
            ),
            Self::UndeclaredEntryAgent { shell, entry } => write!(
                f,
                "the `{shell}` agent is a state machine that enters the `{entry}` agent, which is \
                 not a declared agent profile"
            ),
        }
    }
}

/// A single **agent profile** within a [`GgCapabilitySet`] — the per-agent unit that
/// makes gg's capabilities configurable independently for each agent in a run.
///
/// Every profile has a unique [`name`](Self::name) (the first is always the
/// [Root](ROOT_AGENT)), its own enabled [capabilities](Self::capabilities) and the
/// [tool](Self::tools) or [operation](Self::operations) allowlist that narrows them, its own model
/// (pinned via [`model_id`](Self::model_id) or [deferred](Self::model_slot) to a launch-time
/// [model slot](GgModelSlot)), an optional
/// [custom prompt](Self::custom_instructions) / [full template override](Self::system_prompt_template),
/// and the set of other agents it may spawn as [subagents](Self::subagents).
///
/// An agent is put to work **by name**: `spawn_subagent` and `exec`
/// all name the target agent, which must appear in the caller's [roster](Self::subagents) with the
/// [`subagent`](GgSubagentScope::Subagent) scope — as must an [issue](GgBoardIssue)'s implementer
/// (the [`implementer`](GgSubagentScope::Implementer) scope) and its reviewers (the
/// [`reviewer`](GgSubagentScope::Reviewer) scope). A profile may list itself, allowing recursion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgAgentConfig {
    /// The profile's name, unique within a set. `"Root"` ([`ROOT_AGENT`]) for the
    /// first profile.
    pub name: String,
    /// The capabilities this agent is configured with, each identified by a stable id.
    /// A capability absent from this list is off *and* unconfigured; one present but
    /// [disabled](GgCapabilityConfig::enabled) is off but records the configuration it
    /// would have used, which keeps two configurations differing only in that switch comparable.
    #[serde(default)]
    pub capabilities: Vec<GgCapabilityConfig>,
    /// The opaque model id this agent runs on, passed through to the model client.
    /// Empty while the binding is [deferred](Self::model_slot) to a model slot the
    /// launch has not filled in yet — and empty for good on an
    /// [FSM shell](Self::is_fsm_shell), which takes no turns and so runs no model.
    #[serde(default)]
    pub model_id: String,
    /// The [model slot](GgModelSlot) this agent takes its model from at launch, when it
    /// does not pin one itself. `None` on a pinned binding — which is every binding on
    /// the set a run records, because launching resolves the deferred ones — and on an
    /// [FSM shell](Self::is_fsm_shell), which has no model to defer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub model_slot: Option<String>,
    /// The gg **tool names** this agent may call — the allowlist that decides which of the tools
    /// its enabled capabilities offer it actually gets. Meaningful for an agent that answers with
    /// tool calls; inert for one that writes programs, which is offered no tools at all and takes
    /// its surface from [`operations`](Self::operations) instead.
    ///
    /// **The list is the grant.** Absent or empty grants *nothing*: a capability being on says which
    /// tools exist to be given out, and this says which of them this agent is given. There is no
    /// implicit "everything" to fall back to, because a blocklist cannot express the setting an
    /// operator most often wants — *this agent gets these three calls* — without enumerating every
    /// tool it does not get and re-enumerating them each time gg grows one. The console's editor
    /// fills in a capability's full set of tools the moment that capability is switched on, so
    /// switching one on still yields a working agent; that is the editor being helpful, not a
    /// runtime default.
    ///
    /// Every name is checked against gg's tool vocabulary at launch, and one that is not a gg tool
    /// — a typo, a tool since removed, or an [operation id](Self::operations) from the other surface
    /// — **refuses the launch**, rather than being a silently inert entry. An allowlist entry that
    /// grants nothing looks exactly like a deliberate narrowing, so nothing gg could say afterwards
    /// would tell an operator that the call they meant to hand over never arrived. A name that *is*
    /// a gg tool but that this agent's capabilities do not offer is fine and silent: it grants
    /// nothing, it is not a typo, and one shared document naming a call only some of the
    /// configurations it describes enable is the ordinary way a sweep is written.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<String>,
    /// The **operation ids** — `files.read_file`, `memories.update_memory` — that this agent's
    /// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) programs may call. Meaningful for an agent
    /// that writes programs; inert for a tool-calling one, whose surface is
    /// [`tools`](Self::tools).
    ///
    /// The allowlist semantics, the launch-time validation and the editor's seeding are exactly
    /// [`tools`](Self::tools)'. What differs is the vocabulary, and the two are **scoped**: the API
    /// surface is strictly the larger of the two — every tool has an operation behind it, and
    /// operations exist that no tool does — but a name is granted on precisely the surface it
    /// belongs to. A tool name here, or an operation id there, refuses the launch rather than being
    /// a spelling gg accepts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub operations: Vec<String>,
    /// Operator-authored instructions inserted into this agent's system prompt. `None`
    /// (or empty) leaves the stock prompt. This is the field an operator edits normally;
    /// [`system_prompt_template`](Self::system_prompt_template) is the escape hatch for
    /// rewriting the whole prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub custom_instructions: Option<String>,
    /// A full Handlebars override of this agent's system-prompt template. `None` uses
    /// gg's built-in template (into which [`custom_instructions`](Self::custom_instructions)
    /// are inserted). Set only when an operator deliberately rewrites the whole prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub system_prompt_template: Option<String>,
    /// How long this agent asks the provider to keep the **stable** entries of its
    /// [prompt cache](GgPromptCacheTtl) — the knob that decides whether its opening context is
    /// still cached when a slow turn comes back. Standard (the provider's five minutes) unless an
    /// operator opts this profile into the extended lifetime, because the extended one is charged
    /// a higher write premium and is only worth it for an agent whose turns are long enough, or
    /// spread far enough apart, to outlive five minutes.
    #[serde(default, skip_serializing_if = "GgPromptCacheTtl::is_standard")]
    pub prompt_cache_ttl: GgPromptCacheTtl,
    /// Whether gg watches this agent's replies for a [generation loop](GgLoopDetection), and with
    /// what knobs. Off unless an operator arms it, because arming it also moves this agent onto the
    /// streaming transport — a per-agent choice, made for the profiles whose model is observed to
    /// loop and left alone for the rest.
    #[serde(default, skip_serializing_if = "GgLoopDetection::is_default")]
    pub loop_detection: GgLoopDetection,
    /// The other agents this agent may put to work — its delegation **roster**. Each entry names
    /// a target agent (which may be this agent itself), the [scopes](GgSubagentRef::scopes) it may
    /// be used in (spawnable subagent, issue implementer, issue reviewer), and a caller-scoped
    /// [description](GgSubagentRef::description) telling this agent when to use that target. Empty
    /// means this agent can name nobody — it neither spawns nor assigns.
    ///
    /// Independent of the [subagents](CAPABILITY_SUBAGENTS) capability: the roster says *which*
    /// profiles are namable, the capability says whether this agent may spawn at all.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subagents: Vec<GgSubagentRef>,
    /// The **hooks** this agent is held to — the operator-authored commands and scripts gg runs
    /// around what *this* agent does: its writes, its shell commands, its compactions, and its own
    /// start and stop ([`AGENT_HOOK_EVENTS`]).
    ///
    /// Per agent because the agents of a run are not interchangeable, and the gates they should be
    /// held to are the clearest case of it: "the build must pass before you may stop" is right for
    /// an implementer, pointless for a planner, and actively wrong for a reviewer whose whole job
    /// is to report that the build does *not* pass. See [`GgHook`] for the full rule.
    ///
    /// The run's own two ends are not here — they belong to the run
    /// ([`GgCapabilitySet::hooks`]). A [session event](SESSION_HOOK_EVENTS) in this list is a
    /// configuration error: it would have to fire either once from a profile picked arbitrarily or
    /// once per profile, and neither is "once per run".
    ///
    /// An agent that declares none omits the key entirely.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hooks: Vec<GgHook>,
}

impl GgAgentConfig {
    /// A fresh [Root agent](ROOT_AGENT) with the default capabilities, every call those capabilities
    /// offer granted on both surfaces, and no model binding.
    ///
    /// The two allowlists are **written out** here rather than left empty, and that is not a
    /// runtime default sneaking back in. Nothing is being inferred from an absent key — an agent
    /// that omits `tools` still gets nothing, which is what [`tools`](Self::tools) documents. What
    /// this constructor does is *author a document*, exactly as the console's editor does when an
    /// operator switches a capability on: it states the grant it means. A default profile that
    /// enabled the shell and four filesystem capabilities and then handed out none of their calls
    /// would be a configuration describing an agent that cannot act.
    ///
    /// Both surfaces are filled because the default profile does not yet know which it will have.
    /// [`execution_mode`](CAPABILITY_RESPONSES_AS_CODE) is a capability like any other, so a
    /// document that starts here and turns it on is a responses-as-code agent, and one that does
    /// not is a tool-calling one. Exactly one of the two lists is read for any given agent, so
    /// carrying both costs nothing and leaves the switch a one-line edit.
    ///
    /// The names are gg's, and gg holds this to being exactly what the default capabilities offer —
    /// an entry that stopped matching a tool or an operation would be a default profile silently
    /// short of a call.
    pub fn root() -> Self {
        Self {
            name: ROOT_AGENT.to_string(),
            capabilities: default_capabilities(),
            model_id: String::new(),
            model_slot: None,
            tools: DEFAULT_TOOLS.iter().map(|name| name.to_string()).collect(),
            operations: DEFAULT_OPERATIONS.iter().map(|id| id.to_string()).collect(),
            custom_instructions: None,
            system_prompt_template: None,
            prompt_cache_ttl: GgPromptCacheTtl::default(),
            loop_detection: GgLoopDetection::default(),
            subagents: Vec::new(),
            hooks: Vec::new(),
        }
    }

    /// Whether this agent's [tool allowlist](Self::tools) grants the tool named `tool`.
    ///
    /// A capability being on is necessary and not sufficient: the capability decides the tool
    /// exists to be granted, this decides whether *this* agent got it.
    pub fn grants_tool(&self, tool: &str) -> bool {
        self.tools.iter().any(|t| t == tool)
    }

    /// Whether this agent's [operation allowlist](Self::operations) grants the operation with the
    /// rendered id `operation` (`files.read_file`) — the API surface's half of
    /// [`grants_tool`](Self::grants_tool), asked of the vocabulary a program calls by.
    pub fn grants_operation(&self, operation: &str) -> bool {
        self.operations.iter().any(|o| o == operation)
    }

    /// The configuration for the capability with the given id, or `None` when it is
    /// absent from this agent (distinct from present-but-disabled).
    ///
    /// A capability id is matched **exactly**, so this is the one lookup for both a
    /// capability's enabledness and its own
    /// [implementation](GgCapabilityConfig::implementation) and
    /// [params](GgCapabilityConfig::params).
    pub fn capability(&self, id: &str) -> Option<&GgCapabilityConfig> {
        self.capabilities.iter().find(|c| c.id == id)
    }

    /// Whether the capability with the given id is present **and** enabled for this
    /// agent.
    pub fn is_enabled(&self, id: &str) -> bool {
        self.capability(id).is_some_and(|c| c.enabled)
    }

    /// Whether this profile is an **FSM shell**: a [machine](CAPABILITY_FSM) over the set's
    /// other profiles rather than a worker.
    ///
    /// A shell takes no turns of its own — each state runs the profile it names, with that
    /// profile's configuration — so it has **no model**, no prompt, no roster and no
    /// capabilities beyond the machine itself. Everything that asks an agent for a model has to
    /// ask this first: a shell answering "none" is the configuration being correct, not
    /// incomplete.
    pub fn is_fsm_shell(&self) -> bool {
        self.is_enabled(CAPABILITY_FSM)
    }

    /// The [agent profile](GgFsmState::agent) this shell's machine **enters first** — the agent an
    /// instance dispatched onto it is running before its first turn — or `None` when this profile
    /// is not a [shell](Self::is_fsm_shell) or declares no readable entry state.
    ///
    /// The entry state is `states[0]`: the declaration order is the machine's, and its first
    /// element is where every instance starts. Read straight off the raw param rather than through
    /// the engine's parsed machine so the answer is a borrow of this set — and so the two crates
    /// that need it (gg, to resolve a dispatch's model; the backend, to name a run's model at
    /// launch) share one definition of "the profile a machine actually runs".
    pub fn fsm_entry_agent(&self) -> Option<&str> {
        let agent = self
            .capability(CAPABILITY_FSM)
            .filter(|capability| capability.enabled)?
            .params
            .get(FSM_PARAM_STATES)?
            .as_array()?
            .first()?
            .get("agent")?
            .as_str()?
            .trim();
        (!agent.is_empty()).then_some(agent)
    }

    /// The model id this agent runs on, or `None` while its binding is still
    /// [deferred](Self::model_slot) to a model slot the launch has not filled in — or forever,
    /// on an [FSM shell](Self::is_fsm_shell), which runs none.
    pub fn resolved_model_id(&self) -> Option<&str> {
        let id = self.model_id.trim();
        (!id.is_empty()).then_some(id)
    }

    /// The **second** model this agent runs on: the model its
    /// [handoff compaction](COMPACTION_PARAM_MODEL) hands the thread to, or `None` when compaction
    /// is off, the strategy is not a handoff, or the param names no model.
    ///
    /// It is here — beside the agent's own binding, and folded into
    /// [`bound_model_ids`](GgCapabilitySet::bound_model_ids) — because a handoff really is a model
    /// this run sends requests to and pays for, on the one event that rewrites an agent's entire
    /// window. Everything a launch does per bound model (price it, resolve its context window,
    /// prove the catalog knows it) has to be done for it too.
    ///
    /// The strategy is read as the two `handoff-*` ids and nothing more: gg owns the resolution and
    /// refuses an `implementation` it cannot read, so an id this does not recognize is a run that is
    /// about to be refused for that reason rather than one to guess a second model for. A `model` on
    /// a **non-handoff** strategy is deliberately not counted — it is a key the capability knows and
    /// the selected arm does not use, the "one shared params block per sweep" case, and demanding a
    /// catalog entry for it would break exactly the sweep it exists to serve.
    pub fn handoff_model_id(&self) -> Option<&str> {
        let capability = self
            .capability(CAPABILITY_COMPACTION)
            .filter(|capability| capability.enabled)?;
        let strategy = capability.implementation.as_deref()?.trim();
        if strategy != COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION
            && strategy != COMPACTION_STRATEGY_HANDOFF_COMPACTION
        {
            return None;
        }
        let model = capability
            .params
            .get(COMPACTION_PARAM_MODEL)?
            .as_str()?
            .trim();
        (!model.is_empty()).then_some(model)
    }

    /// Whether this agent names a model to run — a pinned binding, or a deferred one the
    /// launch has since filled in.
    ///
    /// Asked only of a profile that *needs* one: an [FSM shell](Self::is_fsm_shell) is
    /// unresolved by this measure and perfectly runnable, which is why
    /// [`unresolved_agents`](GgCapabilitySet::unresolved_agents) excludes it rather than
    /// this returning `true` for a machine that has no model to be resolved.
    pub fn is_resolved(&self) -> bool {
        self.resolved_model_id().is_some()
    }

    /// Whether this agent may use `target` in `scope` — i.e. `target` appears in its
    /// [roster](Self::subagents) carrying that scope.
    pub fn allows_scope(&self, target: &str, scope: GgSubagentScope) -> bool {
        self.subagents
            .iter()
            .any(|s| s.agent == target && s.has_scope(scope))
    }

    /// Whether this agent may **spawn** the agent named `target` — the
    /// [`subagent`](GgSubagentScope::Subagent) scope.
    pub fn can_spawn(&self, target: &str) -> bool {
        self.allows_scope(target, GgSubagentScope::Subagent)
    }

    /// The names, in declaration order, of the agents this one may use in `scope`.
    pub fn agents_in_scope(&self, scope: GgSubagentScope) -> Vec<&str> {
        self.subagents
            .iter()
            .filter(|s| s.has_scope(scope))
            .map(|s| s.agent.as_str())
            .collect()
    }

    /// The caller-scoped description for using `target`, or `None` when `target` is
    /// not in this agent's roster.
    pub fn subagent_description(&self, target: &str) -> Option<&str> {
        self.subagents
            .iter()
            .find(|s| s.agent == target)
            .map(|s| s.description.as_str())
    }
}

/// One entry in an [agent's](GgAgentConfig) delegation roster: a target agent this
/// agent may put to work, the [scopes](Self::scopes) it may be used in, plus the caller-scoped
/// [description](Self::description) that tells the spawning agent when to use it.
///
/// The description is scoped to the `(spawner, target)` pair, so the same target can
/// carry different guidance depending on which agent is allowed to spawn it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSubagentRef {
    /// The name of the target agent this agent may put to work (may be the spawner itself).
    pub agent: String,
    /// Caller-scoped guidance on when to use `agent`, surfaced in the spawning
    /// agent's `spawn_subagent` tool description and in the prompt's roster. May be empty.
    #[serde(default)]
    pub description: String,
    /// **What** this agent may use `agent` for. An entry may carry several scopes — the same
    /// profile is often both a reasonable implementer and a reasonable reviewer — and one that
    /// carries none can be used for nothing, which is how a reference is disabled without deleting
    /// it. An entry that names no scope takes the default,
    /// [`Subagent`](GgSubagentScope::Subagent) alone.
    #[serde(default = "default_subagent_scopes")]
    pub scopes: Vec<GgSubagentScope>,
}

impl GgSubagentRef {
    /// A roster entry naming `agent` in exactly `scopes`, with no description.
    pub fn new(agent: impl Into<String>, scopes: &[GgSubagentScope]) -> Self {
        Self {
            agent: agent.into(),
            description: String::new(),
            scopes: scopes.to_vec(),
        }
    }

    /// A roster entry naming `agent` in **every** scope — spawnable, assignable, and reviewable.
    /// The permissive shape a set that draws no distinction between the three roles wants.
    pub fn any(agent: impl Into<String>) -> Self {
        Self::new(agent, &ALL_SUBAGENT_SCOPES)
    }

    /// Whether this entry permits its target to be used in `scope`.
    pub fn has_scope(&self, scope: GgSubagentScope) -> bool {
        self.scopes.contains(&scope)
    }
}

/// Every [scope](GgSubagentScope) a [roster entry](GgSubagentRef) can carry, in declaration order —
/// what [`GgSubagentRef::any`] grants and what an editor offers as the full set.
pub const ALL_SUBAGENT_SCOPES: [GgSubagentScope; 3] = [
    GgSubagentScope::Subagent,
    GgSubagentScope::Implementer,
    GgSubagentScope::Reviewer,
];

/// The default [scopes](GgSubagentRef::scopes) of a reference that names none: general
/// [spawning](GgSubagentScope::Subagent).
fn default_subagent_scopes() -> Vec<GgSubagentScope> {
    vec![GgSubagentScope::Subagent]
}

/// What one [roster entry](GgSubagentRef) permits its target to be used **for**.
///
/// The three roles an agent can be put to work in are governed independently, because they are
/// genuinely different jobs: a profile tuned to write code is not necessarily one you want
/// reviewing it, and a cheap fan-out worker is not necessarily one you want owning a whole issue.
/// Scoping the roster rather than adding three parallel lists keeps one roster per agent — with
/// one caller-scoped [description](GgSubagentRef::description) per target — and keeps the
/// [prompt](CAPABILITY_PROJECT_MANAGEMENT) able to state exactly which names each call accepts.
///
/// The roster is **independent of the [subagents](CAPABILITY_SUBAGENTS) capability**: it says which
/// profiles this agent may name, not whether it may spawn at all. An agent with no subagents
/// capability still uses its roster to assign issues and reviews.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgSubagentScope {
    /// General delegation: `spawn_subagent` may name this target.
    /// Reachable only when the [subagents](CAPABILITY_SUBAGENTS) capability (or the workflow
    /// machinery built on it) is on.
    Subagent,
    /// This target may be named as an [issue](GgBoardIssue::agent)'s **implementer** — the profile
    /// gg dispatches to do the issue's work (and re-dispatches for each retry and review round).
    Implementer,
    /// This target may be named among an [issue](GgBoardIssue::reviewers)'s **reviewers** — the
    /// profiles that must each approve the finished work before the issue is accepted.
    Reviewer,
}

impl GgSubagentScope {
    /// The scope's stable wire id (`subagent`, `implementer`, `reviewer`) — the same string the
    /// serde representation uses, for model-facing messages and tool schemas.
    pub fn id(self) -> &'static str {
        match self {
            Self::Subagent => "subagent",
            Self::Implementer => "implementer",
            Self::Reviewer => "reviewer",
        }
    }
}

/// How long one [agent](GgAgentConfig::prompt_cache_ttl) asks the provider to keep the **stable**
/// entries of its prompt cache — the opening context and the cached grid points a later turn reads,
/// as opposed to the rolling tail, which is rewritten every turn and always takes the provider
/// default.
///
/// This is a **per-agent** choice because it is a cost trade, and the trade comes out differently
/// for different agents in the same run. The extended lifetime is billed at a higher write premium
/// (on Anthropic, 2× the base input rate against the standard lifetime's 1.25×), so it pays for
/// itself only when it turns cache *misses* into hits:
///
/// - An agent whose turns are long or far apart — one that runs builds and test suites, or one that
///   delegates and then sits idle while its subagents work — routinely comes back to its own
///   context more than five minutes later, and under the standard lifetime re-sends that whole
///   prefix at full price. [`Extended`](Self::Extended) is what stops that.
/// - An agent that runs quickly, or is spawned once and never resumed, never reaches the standard
///   lifetime's expiry in the first place. Buying it an hour is pure premium on entries that would
///   have been read (or discarded) within the five minutes it already had.
///
/// [`Standard`](Self::Standard) is therefore the default: it is the arrangement that cannot cost a
/// configuration money it was not already spending, and an operator opts individual profiles into
/// the extended lifetime where the run's shape justifies it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgPromptCacheTtl {
    /// The provider's default lifetime (five minutes), at the base write premium. Every cache
    /// entry this agent writes takes it, including the stable ones.
    #[default]
    Standard,
    /// The extended lifetime (one hour) on this agent's stable entries, at the higher write
    /// premium. The rolling tail still takes the provider default: it is superseded within seconds,
    /// so an hour would buy nothing and be charged for it.
    Extended,
}

impl GgPromptCacheTtl {
    /// Whether this is the [standard](Self::Standard) lifetime — the default, which is why a
    /// configuration that never touched the knob omits the field entirely.
    pub fn is_standard(&self) -> bool {
        matches!(self, Self::Standard)
    }
}

/// Whether one [agent](GgAgentConfig::loop_detection) has gg watch its replies for a **generation
/// loop**, and the knobs of the detector if so.
///
/// Some models, on some turns, stop producing a reply and start producing a *period*: the same
/// short fragment (`void 0;`, one line of a table, one call) emitted thousands of times until the
/// provider's output cap stops it. The reply is paid for in full, takes minutes to arrive, is
/// useless as a turn, and — worst — enters the context window, where it makes the next turn more
/// likely to do the same thing.
///
/// Arming this is what switches that agent's model transport to **streaming**: the detector reads
/// the reply as it arrives and abandons the request the moment the repetition is unmistakable,
/// which is the only point at which any of the loss above is still avoidable. An agent that leaves
/// it off keeps the non-streaming transport byte for byte, so this is an opt-in change of transport
/// as much as it is a change of policy — which is exactly why it is off by default.
///
/// It is a **per-agent** (and therefore per-model) lever, like the
/// [prompt-cache lifetime](GgPromptCacheTtl): looping is a property of a model, and a run whose
/// root runs on a model that loops has no reason to pay the streaming path for a reviewer that
/// does not. It is deliberately **not** a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE)
/// param — a tool-calling model loops in exactly the same way, inside a tool call's arguments.
///
/// Every knob is optional and an absent one takes gg's own default (documented per field). A knob
/// **set** to a value that cannot bound anything — a zero window, a zero threshold, a demand for
/// no offenders — is a launch **failure**, on the same terms as [`GgRunLimits`]: a detector armed
/// on gg's defaults instead of the ones the profile wrote is a different detector.
///
/// The one exception is a declaration gg arms exactly as written and which is merely provably
/// inert: [`min_offenders`](Self::min_offenders) above
/// [`window_words`](Self::window_words) can never saturate, but both numbers are honoured to the
/// letter, so it warns rather than refusing.
///
/// See the [loop-detection](https://docs.testcabinet.ai/gg/loop-detection/) page for the algorithm
/// these knobs parameterise.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgLoopDetection {
    /// Whether the detector runs for this agent at all. `false` — the default — leaves the agent on
    /// gg's ordinary non-streaming transport and no reply is ever discarded; `true` arms the
    /// detector **and** switches the transport to streaming, because a detector that can only read a
    /// completed reply has already let every cost it exists to avoid be paid.
    pub enabled: bool,
    /// `N` — how many of the most recent words the detector looks back over when deciding whether a
    /// reply has become repetitive. Absent takes gg's default (**256**).
    ///
    /// A "word" is a whitespace-separated run of characters, plus a fixed-width slice whenever a run
    /// exceeds gg's internal cap — which is what makes a whitespace-free loop (`a();a();a();…`)
    /// detectable at all rather than one unbounded word.
    #[serde(
        deserialize_with = "count::option_u64",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub window_words: Option<u64>,
    /// `P` — how many times a single word may occur within the window before it counts as an
    /// *offender*. Absent takes gg's default (**32**, one word occupying more than an eighth of a
    /// 256-word window).
    ///
    /// Strictly more than `P` occurrences makes an offender, so raising it tolerates more legitimate
    /// repetition (a dense data literal, a long table) at the cost of catching a loop later.
    #[serde(
        deserialize_with = "count::option_u64",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub repeat_threshold: Option<u64>,
    /// `M` — how many **distinct** offenders must be present at once for the window to count as
    /// *saturated*. Absent takes gg's default (**2**).
    ///
    /// More than one is required because a single very common token (`the`, `0,`, a brace) is
    /// ordinary; a loop repeats a whole fragment, so it saturates several words together.
    #[serde(
        deserialize_with = "count::option_u64",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub min_offenders: Option<u64>,
    /// `R` — how many consecutive words must arrive while the window stays saturated before gg
    /// abandons the reply. Absent takes gg's default (**3000**).
    ///
    /// This is the term that separates a loop from legitimately repetitive *content*: a tilemap
    /// literal or a long table saturates the window and then **ends**, while a loop saturates it and
    /// never stops. Requiring the saturation to be sustained is what lets the detector be aggressive
    /// without discarding a reply that was merely dense. `0` means "trip as soon as the window is
    /// saturated" — the unmodified frequency rule, and a deliberate choice rather than a mistake.
    #[serde(
        deserialize_with = "count::option_u64",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub min_saturated_run: Option<u64>,
    /// A hard ceiling, in characters, on a single reply — the backstop for a runaway that is not
    /// *repetitive* enough to trip the window rule. Absent takes gg's default (**250 000**); `0`
    /// turns the backstop off and leaves only the repetition rule.
    #[serde(
        deserialize_with = "count::option_u64",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_response_chars: Option<u64>,
}

impl GgLoopDetection {
    /// Whether this agent declares nothing about loop detection — the `skip_serializing_if`
    /// predicate on [`GgAgentConfig::loop_detection`] and [`GgSlotBinding::loop_detection`], so a
    /// configuration that never touched the knob omits the key entirely.
    ///
    /// Written against [`Default`] rather than field by field so a knob added later cannot be
    /// forgotten here and silently start writing a `loopDetection` key onto every stored profile.
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// Whether the detector is armed for this agent — the one question the client asks, and
    /// therefore the one question that decides which transport it builds.
    pub fn is_armed(&self) -> bool {
        self.enabled
    }
}

/// A single Root agent with the default capabilities — the [`Default`] for
/// [`GgCapabilitySet::agents`], and what a set that names no profiles at all reads as.
fn default_agents() -> Vec<GgAgentConfig> {
    vec![GgAgentConfig::root()]
}

/// The default enabled capabilities: the shell and the four filesystem tools
/// ([`read-file`](CAPABILITY_READ_FILE), [`write-file`](CAPABILITY_WRITE_FILE),
/// [`edit-file`](CAPABILITY_EDIT_FILE) and [`list-dir`](CAPABILITY_LIST_DIR)) the core agent
/// loop needs to build a test case, plus [skills](CAPABILITY_SKILLS),
/// [memories](CAPABILITY_MEMORIES), and [tasks](CAPABILITY_TASKS).
///
/// Each filesystem tool is its own capability, so each carries its own implementation and
/// params and can be varied one at a time; all four are on by default.
///
/// The [context-window override](CAPABILITY_CONTEXT_WINDOW_OVERRIDE) is deliberately *not*
/// here: it is an opt-in narrowing lever a study turns on when it wants to measure a model
/// against a smaller window, and is inert (and misleading) when on with no window declared,
/// so a default run leaves it off and measures the model against its full catalog window.
///
/// Skills is on by default because it is inert unless a
/// skills directory is actually present in the workspace: with no skills to offer it
/// contributes no `read_skill` tool and no prompt text, so a default run behaves exactly
/// as before, and a run whose workspace *was* seeded with skills lights them up. Memories
/// is on by default because a self-noting scratchpad is core to a coding agent; it offers
/// the `write_memory`/`update_memory`/`delete_memory` tools, but starts empty (the model
/// curates it as it works), so it adds nothing to the window until the model writes one.
/// Tasks is on by default for the same reason — a lightweight to-do list is core to a
/// coding agent; it offers the `add_task`/`update_task`/`set_blocked_by`/`complete_task`/
/// `remove_task` tools, but starts empty, so it adds nothing to the window until the model
/// plans one. A configuration that wants any of them off turns it off explicitly.
fn default_capabilities() -> Vec<GgCapabilityConfig> {
    vec![
        GgCapabilityConfig::enabled(CAPABILITY_SHELL),
        GgCapabilityConfig::enabled(CAPABILITY_READ_FILE),
        GgCapabilityConfig::enabled(CAPABILITY_WRITE_FILE),
        GgCapabilityConfig::enabled(CAPABILITY_EDIT_FILE),
        GgCapabilityConfig::enabled(CAPABILITY_LIST_DIR),
        GgCapabilityConfig::enabled(CAPABILITY_SKILLS),
        GgCapabilityConfig::enabled(CAPABILITY_MEMORIES),
        GgCapabilityConfig::enabled(CAPABILITY_TASKS),
    ]
}

/// Every gg **tool** the [default capabilities](default_capabilities) offer — the tool-calling half
/// of the grant [`GgAgentConfig::root`] authors, in gg's own order.
///
/// Written here rather than derived because the vocabulary belongs to gg and this crate is the one
/// that states the contract; gg's `the_default_profile_grants_what_its_capabilities_offer` holds the
/// two to being the same set, so a tool added to a default capability fails there rather than
/// quietly shrinking every default profile by one call.
const DEFAULT_TOOLS: &[&str] = &[
    "shell",
    "read_file",
    "write_file",
    "edit_file",
    "list_dir",
    "read_skill",
    "write_memory",
    "update_memory",
    "create_memory",
    "read_memory",
    "edit_memory",
    "search_memories",
    "delete_memory",
    "add_task",
    "update_task",
    "set_blocked_by",
    "complete_task",
    "remove_task",
];

/// Every **operation** the [default capabilities](default_capabilities) offer — the
/// responses-as-code half of the grant [`GgAgentConfig::root`] authors, and the same calls as
/// [`DEFAULT_TOOLS`] spelled in the other surface's vocabulary.
///
/// Held to gg's operations table by the same test, and for the same reason.
const DEFAULT_OPERATIONS: &[&str] = &[
    "shell.shell",
    "files.read_file",
    "files.read_text_file",
    "files.write_file",
    "files.edit_file",
    "files.list_dir",
    "skills.read_skill",
    "memories.write_memory",
    "memories.update_memory",
    "memories.create_memory",
    "memories.read_memory",
    "memories.edit_memory",
    "memories.search_memories",
    "memories.delete_memory",
    "tasks.add_task",
    "tasks.update_task",
    "tasks.set_blocked_by",
    "tasks.complete_task",
    "tasks.remove_task",
    // The read-file capability's second row: a program opens a file straight into its own window
    // rather than into a variable, and that channel is bought by the same capability the read is.
    "views.open_file",
];

/// The configuration of a single capability within a [`GgCapabilitySet`].
///
/// A capability is identified by a stable [`id`](Self::id) — one of
/// [`GG_CAPABILITY_CATALOG`], the closed vocabulary gg ships — can be toggled
/// [on or off](Self::enabled), can select among alternate
/// [implementations](Self::implementation) for A/B comparisons, and carries
/// free-form [`params`](Self::params) for tuning.
///
/// The id is a `String` rather than an enum because the same vocabulary has to be spelled once for
/// the console, the query language and the harness, not because it is open: an id outside the
/// catalog names nothing gg can switch on, and the launch refuses it. The [`params`](Self::params)
/// object is the one genuinely free-form field, and its **keys** are checked against the selected
/// capability's own vocabulary at launch for the same reason.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgCapabilityConfig {
    /// The capability's stable id (for example `"shell"`, `"compaction"`, or
    /// `"subagents"`) — one of [`GG_CAPABILITY_CATALOG`]. Stable across versions so recorded
    /// configurations stay comparable, and **closed**: an id gg does not ship is refused at
    /// launch rather than carried through the run as a configuration nothing reads.
    pub id: String,
    /// Whether the capability is on. Off means gg behaves as if the feature does not
    /// exist — nothing it offers is exposed and it consumes no context — which is what makes two
    /// configurations differing in one capability worth comparing.
    pub enabled: bool,
    /// The selected implementation of the capability, when it offers more than one
    /// (for example two compaction strategies or two memory strategies). `None` selects the
    /// default. This is the basis for A/B comparisons between implementations — which is exactly
    /// why a name the capability does not offer is a **launch failure** and never a fall back to
    /// the default: the arm is the independent variable, and a run measured on one arm while its
    /// record names another is worse than no run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub implementation: Option<String>,
    /// Free-form parameters for the capability (for example a compaction threshold or
    /// a subagent parallelism cap), interpreted by the capability itself. Defaults to
    /// an empty object.
    #[serde(default = "empty_params")]
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub params: Value,
}

impl GgCapabilityConfig {
    /// A capability present and enabled, with the default implementation and empty
    /// parameters.
    pub fn enabled(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            enabled: true,
            implementation: None,
            params: empty_params(),
        }
    }

    /// A capability present but disabled — recorded (so a configuration names what it turned off)
    /// yet inert.
    pub fn disabled(id: impl Into<String>) -> Self {
        Self {
            enabled: false,
            ..Self::enabled(id)
        }
    }
}

/// An empty JSON object, the default for [`GgCapabilityConfig::params`].
fn empty_params() -> Value {
    Value::Object(serde_json::Map::new())
}

/// Whether a count is zero, for a counter that is omitted from the wire in the ordinary case.
///
/// Used by [`CodeExecution::logs_suppressed`](GgTelemetryKind::CodeExecution): almost every program
/// logs well under the capture caps, so the field would otherwise put a `0` on every code turn of
/// every run for the rare turn that has something to say.
fn is_zero_u64(count: &u64) -> bool {
    *count == 0
}

/// A binding of a model to a named slot in a [`GgCapabilitySet`].
///
/// Model selection is expressed through slots so capabilities reference models by
/// role (`"primary"`, `"reviewer"`, …) rather than by a hardcoded id, and a study can
/// re-point a slot — even to a model from a different provider — without touching
/// capability logic. The provider is always inferred from the model id (gg routes
/// every live model through OpenRouter), so there is nothing to pin here.
///
/// A binding either **pins** a model — [`model_id`](Self::model_id) names it, and every
/// run of the configuration uses it — or **defers** to a declared
/// [model slot](Self::model_slot), leaving the model to be supplied when the run is
/// launched. Only a pinned binding is [resolved](Self::is_resolved); launching turns
/// every deferred one into a pinned one, so the set a run records has no deferred
/// binding left.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSlotBinding {
    /// The slot name capabilities reference (for example [`PRIMARY_SLOT`]).
    pub slot: String,
    /// The opaque model id bound to the slot, passed through to the model client. Empty
    /// while the binding is [deferred](Self::model_slot) to a model slot the launch has
    /// not filled in yet.
    #[serde(default)]
    pub model_id: String,
    /// The [model slot](GgModelSlot) this binding takes its model from at launch, when
    /// it does not pin one itself. `None` on a pinned binding — which is every binding
    /// on the set a run records, because launching resolves the deferred ones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub model_slot: Option<String>,
    /// The [prompt-cache lifetime](GgPromptCacheTtl) the client built for this binding asks for on
    /// its stable cache entries — carried here because the binding is what a client is resolved
    /// from, and the lifetime is a property of the *agent* whose turns that client serves, not of
    /// the model it runs on. [Standard](GgPromptCacheTtl::Standard) unless the agent profile this
    /// binding was built for opts into the extended one.
    #[serde(default, skip_serializing_if = "GgPromptCacheTtl::is_standard")]
    pub prompt_cache_ttl: GgPromptCacheTtl,
    /// The [loop detection](GgLoopDetection) the client built for this binding runs with — carried
    /// here for the same reason the [prompt-cache lifetime](Self::prompt_cache_ttl) is: the binding
    /// is what a client is resolved from, and whether replies are watched for a generation loop is a
    /// property of the *agent* whose turns that client serves, not of the model it runs on.
    ///
    /// [Disarmed](GgLoopDetection::is_armed) unless the agent profile this binding was built for
    /// armed it — which is also what decides whether the client uses the streaming transport.
    #[serde(default, skip_serializing_if = "GgLoopDetection::is_default")]
    pub loop_detection: GgLoopDetection,
}

impl GgSlotBinding {
    /// Bind `model_id` to the named `slot`. The provider is resolved from the id.
    pub fn new(slot: impl Into<String>, model_id: impl Into<String>) -> Self {
        Self {
            slot: slot.into(),
            model_id: model_id.into(),
            model_slot: None,
            prompt_cache_ttl: GgPromptCacheTtl::default(),
            loop_detection: GgLoopDetection::default(),
        }
    }

    /// Defer the named `slot` to the [model slot](GgModelSlot) `model_slot`: the model
    /// is supplied when a run is launched from the configuration, not now.
    pub fn deferred(slot: impl Into<String>, model_slot: impl Into<String>) -> Self {
        Self {
            slot: slot.into(),
            model_id: String::new(),
            model_slot: Some(model_slot.into()),
            prompt_cache_ttl: GgPromptCacheTtl::default(),
            loop_detection: GgLoopDetection::default(),
        }
    }

    /// This binding with `ttl` as the [prompt-cache lifetime](GgPromptCacheTtl) its client asks
    /// for — how an agent profile's choice reaches the client resolved for it.
    pub fn with_prompt_cache_ttl(mut self, ttl: GgPromptCacheTtl) -> Self {
        self.prompt_cache_ttl = ttl;
        self
    }

    /// This binding with `loop_detection` as the [generation-loop policy](GgLoopDetection) its
    /// client runs under — how an agent profile's choice reaches the client resolved for it, and
    /// therefore which transport that client is built with.
    pub fn with_loop_detection(mut self, loop_detection: GgLoopDetection) -> Self {
        self.loop_detection = loop_detection;
        self
    }

    /// Whether this binding names a model to run — a pinned binding, or a deferred one
    /// the launch has since filled in. A binding still waiting on its
    /// [model slot](Self::model_slot) is not runnable.
    pub fn is_resolved(&self) -> bool {
        !self.model_id.trim().is_empty()
    }
}

/// A **launch-time model parameter** a [`GgCapabilitySet`] declares.
///
/// A saved configuration is meant to be reusable across models, so the models it runs
/// on are not all baked into it. It declares named model slots — `primary`, `critic`,
/// … — and each [role binding](GgSlotBinding) either pins a model outright (an
/// *internal* binding, identical on every run of the configuration and never asked
/// about again) or [defers](GgSlotBinding::model_slot) to one of these, which the
/// operator fills in on the launch form. A slot may carry a
/// [default](Self::default_model_id) the form pre-fills.
///
/// Model slots are named separately from the role slots they feed precisely so that two
/// roles can share one: "run the reviewer *and* the judge on whatever I pick for
/// `critic`" is one launch input, not two.
///
/// Declaring one is a configuration-authoring concern only. Launching resolves every
/// deferred binding to a concrete model, so this list is empty on the capability set a
/// run records — what ran is a set of pinned bindings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgModelSlot {
    /// The slot's name, as the launch form labels it and as a
    /// [binding](GgSlotBinding::model_slot) refers to it. Unique within a set.
    pub name: String,
    /// The model the launch form pre-fills this slot with. `None` leaves it empty, so
    /// the operator must choose one before the run can be launched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub default_model_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Hooks: the operator's seam into a run's lifecycle
// ---------------------------------------------------------------------------

/// One **hook**: a command or a script gg runs at a [point](GgHookEvent) in a run's lifecycle,
/// able to stop the operation it precedes and to put text in front of the model.
///
/// A hook is the operator reaching into a run from outside it, which is exactly what makes it not a
/// [capability](GgCapabilityConfig): the model is never told a hook exists, is offered no tool for
/// it, and cannot decline one.
///
/// **Where a hook is declared follows from its [event](Self::event)**, and from nothing else. The
/// two [session events](SESSION_HOOK_EVENTS) fire once per run and are declared on the run
/// ([`GgCapabilitySet::hooks`]); the other eight ([`AGENT_HOOK_EVENTS`]) fire because some agent
/// wrote, ran, compacted, started or stopped, and are declared on that agent
/// ([`GgAgentConfig::hooks`]). Declaring one in the other's place is a configuration error rather
/// than a shorthand, because the two lists answer different questions: "what does this run do
/// around itself" and "what is this agent held to".
///
/// Per agent rather than once for the whole run because the agents of a run are not
/// interchangeable. A reviewer that must not write to the tree, an implementer that must pass the
/// build before it may stop, and a planner that does neither are three different sets of gates;
/// hanging them all off the run would mean every hook firing for every agent and each one working
/// out from the agent identity in its payload whether it was meant to have fired at all.
///
/// Every hook fires on exactly one [event](Self::event) and runs exactly one [action](Self::action).
/// Several hooks may name the same event; they run **in declaration order**, and the first one to
/// block stops both the operation and the rest of that event's hooks — a later hook's opinion of an
/// operation that is not going to happen is not worth the wall clock.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgHook {
    /// Which point of the run this hook fires at.
    pub event: GgHookEvent,
    /// What it runs, and how gg reads what came back.
    pub action: GgHookAction,
    /// An operator's label for this hook, shown wherever gg reports one running or blocking. Empty
    /// falls back to a description of the action, so a hook is always nameable in a diagnostic.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
}

/// The point of a run's lifecycle a [hook](GgHook) fires at.
///
/// Ten events in four pairs plus two singles, and the pairing is the whole design: a `pre-` event
/// runs **before** its operation and is the only kind that can stop it, while a `post-` event runs
/// after and can only add to what the model is told. An operator reading a configuration can
/// therefore answer "can this hook block?" from the event's name alone, without knowing what the
/// hook does — which is the property a gate has to have to be trustworthy.
///
/// The two exceptions are named rather than implied, because both are cases where the obvious
/// reading is wrong:
///
/// - [`PreCompact`](Self::PreCompact) is a `pre-` event that **cannot** block. Compaction happens
///   because the window is full; refusing it would leave the agent with no room to do anything at
///   all, so the only honest thing a hook can do there is observe.
/// - [`SessionEnd`](Self::SessionEnd) fires after the root agent is finished, so there is nothing
///   left to block — and, unlike the other `post-` events, no prompt left to insert into either.
///   It is where a run reports on itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgHookEvent {
    /// Before a file write of any kind — `write_file`, `edit_file`, or a program's `fs.writeFile` /
    /// `fs.editFile`. The payload carries the absolute path and the **contents that would be
    /// written**, so a hook sees the finished file rather than an edit's patch. **Can block**, in
    /// which case nothing touches the disk.
    PreWrite,
    /// After a file write of any kind has updated the file, with the absolute path and the contents
    /// that were written. Cannot block — the write already happened — but may insert.
    PostWrite,
    /// Before a shell command runs, with the command line about to be executed. **Can block**, in
    /// which case no process is started.
    PreShell,
    /// After a shell command has run, with the command line and how it finished. Cannot block; may
    /// insert, which is how a run comments on what a command did.
    PostShell,
    /// Before a [compaction](CAPABILITY_COMPACTION) condenses an agent's window. Cannot block (see
    /// the type's own note) and cannot insert — the window it would insert into is the one being
    /// rewritten. It exists to observe, and to let a run save state elsewhere before the thread is
    /// condensed.
    PreCompact,
    /// After a compaction has rewritten an agent's window. Cannot block, but **may insert** — into
    /// the rebuilt context, which is the one moment a run can put back something the compaction
    /// dropped.
    PostCompact,
    /// When any agent instance starts running, with the [kind](GgHookAgentKind) of agent it is.
    /// Cannot block — an agent that was dispatched is going to run — but may insert into the
    /// opening context.
    AgentStart,
    /// When any agent attempts to end its session, with the [kind](GgHookAgentKind) of agent it is.
    /// **Can block**, in which case the agent is told why and its session continues. A command
    /// hook here is the run's ending gate, and it applies to a reviewer and a subagent as readily
    /// as to the root.
    AgentStop,
    /// Before the root agent takes its first turn — once per run, ahead of everything. Cannot
    /// block, but **may insert** into the root's opening prompt, which is how a run is seeded with
    /// something gg itself has no way to know.
    SessionStart,
    /// After the root agent has finished — once per run, last. Cannot block and cannot insert;
    /// there is no session left to affect.
    SessionEnd,
}

/// Every [hook event](GgHookEvent), in the order the editor and the documentation list them:
/// the four `pre`/`post` pairs, then the session boundary.
pub const ALL_HOOK_EVENTS: [GgHookEvent; 10] = [
    GgHookEvent::PreWrite,
    GgHookEvent::PostWrite,
    GgHookEvent::PreShell,
    GgHookEvent::PostShell,
    GgHookEvent::PreCompact,
    GgHookEvent::PostCompact,
    GgHookEvent::AgentStart,
    GgHookEvent::AgentStop,
    GgHookEvent::SessionStart,
    GgHookEvent::SessionEnd,
];

/// The events that belong to the **run** rather than to any one agent, and so are declared on
/// [`GgCapabilitySet::hooks`].
///
/// Both fire exactly once per run, around the root agent's session as a whole. Neither has an
/// agent it could sensibly be declared on: the first fires before any agent has taken a turn, and
/// the second after the last one has finished.
pub const SESSION_HOOK_EVENTS: [GgHookEvent; 2] =
    [GgHookEvent::SessionStart, GgHookEvent::SessionEnd];

/// The events that belong to an **agent**, and so are declared on [`GgAgentConfig::hooks`].
///
/// Every one of these fires *because a particular agent did something* — wrote a file, ran a
/// command, filled its window, started, tried to stop — which is what makes them the agent's to
/// declare. A run whose reviewer must pass the build and whose implementer need not is then a
/// configuration rather than something a run-level hook has to work out for itself from the
/// agent identity it is handed.
pub const AGENT_HOOK_EVENTS: [GgHookEvent; 8] = [
    GgHookEvent::PreWrite,
    GgHookEvent::PostWrite,
    GgHookEvent::PreShell,
    GgHookEvent::PostShell,
    GgHookEvent::PreCompact,
    GgHookEvent::PostCompact,
    GgHookEvent::AgentStart,
    GgHookEvent::AgentStop,
];

impl GgHookEvent {
    /// The event's wire name — the string a configuration spells it with.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PreWrite => "pre-write",
            Self::PostWrite => "post-write",
            Self::PreShell => "pre-shell",
            Self::PostShell => "post-shell",
            Self::PreCompact => "pre-compact",
            Self::PostCompact => "post-compact",
            Self::AgentStart => "agent-start",
            Self::AgentStop => "agent-stop",
            Self::SessionStart => "session-start",
            Self::SessionEnd => "session-end",
        }
    }

    /// Whether this event belongs to the **run** ([`GgCapabilitySet::hooks`]) rather than to an
    /// agent ([`GgAgentConfig::hooks`]).
    ///
    /// This is the whole of the rule that decides where a hook is declared, and it is a property
    /// of the event rather than a choice an operator makes: a run has exactly one session, so a
    /// session hook declared per agent would either fire once from an arbitrary profile or fire
    /// once per profile, and neither is what "once per run" means.
    pub fn is_session(self) -> bool {
        matches!(self, Self::SessionStart | Self::SessionEnd)
    }

    /// Whether a hook on this event can **stop** the operation it fires around.
    ///
    /// Read here rather than inferred from the `pre-` prefix, because
    /// [`PreCompact`](Self::PreCompact) is a `pre-` event that deliberately cannot. gg consults this
    /// before it even looks at what a hook returned, so a `block` from a hook on a non-blocking
    /// event is reported to the operator as a misconfiguration rather than silently dropped.
    pub fn can_block(self) -> bool {
        matches!(self, Self::PreWrite | Self::PreShell | Self::AgentStop)
    }

    /// Whether a hook on this event can put text in front of the model.
    ///
    /// False for the two events with no prompt to insert into: [`PreCompact`](Self::PreCompact),
    /// whose window is about to be rewritten, and [`SessionEnd`](Self::SessionEnd), which fires
    /// after the last turn anybody could read it on.
    pub fn can_insert(self) -> bool {
        !matches!(self, Self::PreCompact | Self::SessionEnd)
    }
}

/// What a [hook](GgHook) actually runs — the three kinds, as a tagged union so a hook carries
/// exactly the fields its kind needs and no others.
///
/// The split is between a hook that is a **command** and one that is a **script**. A command is the
/// simple case: gg runs a command line, learns nothing but its exit status and its output, and
/// treats a non-zero exit as a block. A script is the expressive case: gg hands it the event as
/// JSON and reads a structured [decision](GgHookOutcomeKind) back, so a script can say "let this
/// through but tell the model X" — which an exit code cannot express.
///
/// [`BuiltIn`](Self::BuiltIn) and [`Custom`](Self::Custom) are the same execution path and the same
/// contract, differing only in where the source comes from: gg's own catalogue, or the
/// configuration. That is deliberate — a built-in is meant to be a worked example an operator can
/// read, copy into a custom hook, and change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgHookAction {
    /// Run an arbitrary command line, exactly as the [shell tool](CAPABILITY_SHELL) runs one.
    ///
    /// It receives **no input** — not the event payload, not anything on stdin. A command hook is
    /// for the check that is already a command ("does it build?", "does it lint?"), and such a
    /// check reads the workspace rather than being told about it. A hook that needs to know what is
    /// being written wants a [script](Self::Custom).
    ///
    /// A **non-zero exit blocks** (on an event that can block), and either way the command's output
    /// is inserted into the agent's prompt as hook output. The output goes through the agent's own
    /// [offloading policy](SHELL_OUTPUT_MODES), so a failing test suite that prints a megabyte is
    /// handled the way a megabyte of `shell` output is: the tail inline, the whole of it on disk to
    /// grep.
    Command {
        /// The command line, run through `sh -c`.
        command: String,
        /// Where to run it — relative to gg's working directory, or absolute. Absent runs it in the
        /// agent's workspace root, which for an agent working in an isolated
        /// [worktree](CAPABILITY_PROJECT_MANAGEMENT) is that worktree.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        cwd: Option<String>,
        /// How long it may run before it is killed. Absent uses gg's default, which is generous
        /// because a hook command is typically a build or a test suite.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        timeout_secs: Option<f64>,
        /// How much of the output comes back inline and what happens to the rest — one of
        /// [`SHELL_OUTPUT_MODES`]. Absent follows the agent's own `shell` configuration, which is
        /// almost always what an operator means; a value that is not one of the modes is refused
        /// at launch, on the same terms as the `shell` capability's own `output` param.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        output: Option<String>,
    },
    /// Run one of gg's own hook scripts, by [id](GG_BUILTIN_HOOKS).
    ///
    /// Same contract as [`Custom`](Self::Custom) in every respect — the JSON argument, the JSON
    /// decision on stdout, the exit-0 requirement — with the source coming from gg instead of the
    /// configuration. An id gg does not ship **fails the launch**, rather than being skipped: a
    /// hook that silently does not run is a gate an operator believes they have.
    BuiltIn {
        /// The script's id, one of [`GG_BUILTIN_HOOKS`].
        script: String,
    },
    /// Run a script the configuration carries verbatim.
    ///
    /// gg writes [`source`](Self::Custom::source) to a file in the run's own directory, makes it
    /// executable, and runs it with the event payload as its **sole argument** — a JSON string, not
    /// a stream, so a script reads its input without a parser for the reading. A leading `#!` line
    /// chooses the interpreter, and a script without one is run by `sh`.
    ///
    /// The script must exit `0` and print one [decision object](GgHookOutcomeKind) on stdout.
    /// **A non-zero exit is the script itself failing**, not a block — the distinction matters
    /// enough to be structural: a gate whose own machinery is broken has not judged anything, so
    /// letting the operation through would be pretending it passed and blocking it would be
    /// pretending it failed. gg **stops the run**.
    Custom {
        /// The script's source, run as described above.
        source: String,
    },
}

/// The ids of the hook scripts gg ships, for [`GgHookAction::BuiltIn`].
///
/// Deliberately a short list. A built-in exists where the thing being asked for is genuinely gg's
/// to know — the shape of its own event payloads — rather than to save an operator from writing a
/// script; anything workspace-specific belongs in a [custom](GgHookAction::Custom) one.
pub const GG_BUILTIN_HOOKS: &[&str] = &[
    // Report every event it receives to the operator log, and let it through. The one to reach for
    // when the question is "does this event fire, and with what?" — which is the question every
    // other hook starts from.
    "trace",
    // Block a write whose contents are empty or whitespace, on the reasoning that a model that
    // truncates a file to nothing has lost the file rather than emptied it. Lets every other write
    // through, and lets every non-write event through untouched.
    "refuse-empty-write",
    // Block a shell command that would run `git push`, `git reset --hard`, or `rm -rf` outside the
    // workspace — the three commands that reach past the run. A worked example of reading the event
    // payload, and useful as it stands.
    "guard-destructive-shell",
];

/// What kind of agent a [hook](GgHook) is firing for, on the two events that fire per agent
/// ([`AgentStart`](GgHookEvent::AgentStart) and [`AgentStop`](GgHookEvent::AgentStop)).
///
/// It is the **role the instance was dispatched in**, not its profile: the same profile implements
/// an issue in one dispatch and reviews one in the next, and a hook that gates completion almost
/// always means to gate one of those and not the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgHookAgentKind {
    /// The run's root agent — the one that drives the top-level session.
    Root,
    /// An agent the [board](CAPABILITY_PROJECT_MANAGEMENT) dispatched to implement an issue.
    IssueImplementer,
    /// An agent dispatched to review an issue's finished work.
    IssueReviewer,
    /// An agent another agent spawned with `spawn_subagent`, or forked from itself.
    Subagent,
}

impl GgHookAgentKind {
    /// The kind's wire name — what a script reads out of the payload's `agentKind`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Root => "root",
            Self::IssueImplementer => "issue-implementer",
            Self::IssueReviewer => "issue-reviewer",
            Self::Subagent => "subagent",
        }
    }
}

/// The **decision** a [script hook](GgHookAction::Custom) prints on stdout — gg's side of the
/// contract, as a tagged union keyed on `action`.
///
/// A tagged union rather than a bag of optional fields because the three outcomes are genuinely
/// exclusive and a script that meant one of them should not be able to express two. `{"action":
/// "block"}` with a `message` beside it would leave gg guessing whether the message was the reason
/// for the block or an insertion the author also wanted; there is no such object.
///
/// Unparseable stdout is treated exactly as a non-zero exit is: the script did not judge, so gg
/// stops the run rather than guessing which way it meant to fall.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgHookOutcomeKind {
    /// Let the operation proceed and say nothing. The overwhelmingly common answer, and what a
    /// script that has nothing to report should print.
    Continue,
    /// Stop the operation, for this reason.
    ///
    /// The reason is not decoration: it is what the model is told, and it is the only thing the
    /// model has to go on when deciding what to do instead. A block on an event that
    /// [cannot block](GgHookEvent::can_block) is a misconfiguration gg reports and does not honor.
    Block {
        /// Why the operation was refused, in the words the model reads.
        reason: String,
    },
    /// Let the operation proceed, and put this message in front of the model.
    Message {
        /// The text inserted into the agent's prompt, labelled as hook output so the model can tell
        /// it from something it produced itself.
        message: String,
    },
}

/// **Reading a declared count**, for the [run limits](GgRunLimits) and the
/// [loop detector](GgLoopDetection) — the two places gg's contract carries a bare number rather
/// than a capability param.
///
/// JSON has no integer type. A sweep generated from JavaScript writes `60.0` and `6e1` as readily
/// as `60`, and the derived `u64` reader rejects both — which would refuse a launch over a value
/// that names exactly the count the operator meant. So an **integral** number in any spelling is
/// read as that count, and everything else — a fraction, a negative, an infinity, a string, a
/// number past `u64` — is an error, because rounding one would be gg choosing a number nobody
/// wrote. It is the same rule the capability params are read under, in the one place a param
/// resolver cannot reach.
///
/// `null` is `None`: the documented spelling of "take the default", not a value gg cannot read.
mod count {
    use serde::{Deserialize, Deserializer, de};

    /// Deserialize one optional count under the rule the [module](self) states.
    pub(super) fn option_u64<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let Some(value) = Option::<serde_json::Value>::deserialize(deserializer)? else {
            return Ok(None);
        };
        if value.is_null() {
            return Ok(None);
        }
        if let Some(count) = value.as_u64() {
            return Ok(Some(count));
        }
        if let Some(count) = value.as_f64().filter(|number| {
            number.is_finite()
                && *number >= 0.0
                && number.fract() == 0.0
                && *number <= u64::MAX as f64
        }) {
            return Ok(Some(count as u64));
        }
        Err(de::Error::custom(format!(
            "expected a whole number of zero or more (`60` and `60.0` are the same count); \
             `{value}` names none"
        )))
    }
}

/// The **run-level guardrails** a gg run is bounded by: the [execution ceilings](GgLimitKind) that
/// stop a session and record which one stopped it, plus the
/// [parallelism cap](Self::max_parallel) that bounds how much of the run happens at once.
///
/// Deliberately **not** a [capability](GgCapabilityConfig): a capability is a feature a
/// configuration switches on or off, with calls behind it; a ceiling is an operator's guardrail
/// that applies to every capability and to both execution modes at once. They live on the
/// [capability set](GgCapabilitySet) rather than on the [launch envelope](GgInvocation) because
/// the set is what a run **records**, so a run stopped by a ceiling carries both the
/// [breach](GgSessionSummary::limit_hit) and the [ceilings](GgSessionSummary::limits) that
/// produced it — where limits on the invocation would let a run record *which* ceiling was hit
/// while making *what the ceiling was* unrecoverable.
///
/// **The defaults catch a stuck run without capping a productive one.** gg's host (The Test
/// Cabinet) already enforces a wall-clock cap on every run, so a turn ceiling would mostly just cut
/// a run short before it is done, and the turn ceiling is therefore **unbounded** when unset. What
/// is armed by default instead are the two error
/// ceilings that end a run which is *failing* rather than merely *long*: **5 consecutive errors**,
/// and an **error rate above 0.4 over the last 50 turns**. Runtime and cost stay off when unset —
/// the host owns the clock, and gg will not invent a spend ceiling nobody asked for.
///
/// **Absent takes the default; present-and-unhonourable fails the launch.** A field set to a value
/// that cannot bound anything — a zero turn or runtime ceiling, a zero window, a negative rate, a
/// rate above `1.0`, a non-finite cost — is refused by name, not disarmed with a warning: an
/// operator who wrote a ceiling believes the run is bounded, and a run that quietly became
/// unbounded is the one case where the misconfiguration costs money. A **partially** declared error
/// rate (a rate without a window, or a window without a rate) is refused on the same terms rather
/// than arming nothing. The run records the ceilings that were actually in force on
/// [`GgSessionSummary::limits`], so a default is a recorded fact rather than a hidden one.
///
/// One combination stays a warning, because gg honours it exactly as written:
/// [`error_rate_window`](Self::error_rate_window) at or above
/// [`max_turns`](Self::max_turns) arms both numbers to the letter and merely leaves the rate
/// ceiling able to fire only on the last turn. Which of the two knobs was meant is genuinely
/// unknowable, so gg says so and runs what was asked for.
///
/// See the [execution-limits](https://docs.testcabinet.ai/gg/execution-limits/) page for how each
/// ceiling is accounted (per agent or run-wide) and what breaching it does to the run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgRunLimits {
    /// How many of the run's agents may **run at once**, counting the root and every subagent,
    /// issue implementer and reviewer alike. **Absent means gg's default of
    /// 16**; set it explicitly to widen or tighten the pool. `0` is refused — a run with no agent
    /// able to run could not start at all, so it is a ceiling gg cannot honour rather than a way
    /// of writing "no cap".
    ///
    /// Unlike every other field here it **stops nothing** — it *queues*. An agent spawned while the
    /// pool is full is created normally and waits for a slot, so a configuration cannot lose work by
    /// setting this low, only serialize it. An agent that **suspends** itself (blocking on its
    /// subagents or on an [issue](CAPABILITY_PROJECT_MANAGEMENT)) frees its slot while it waits and
    /// does not count against the cap, and takes priority over any not-yet-started agent when a slot
    /// frees — a suspended agent is holding work that is already half-done, and starting a new agent
    /// ahead of it is how a fleet fills its pool with agents that are all waiting on each other.
    ///
    /// It is run-level rather than per-agent because it bounds the *run's* concurrency: a cap each
    /// profile declared for itself would not add up to a number the operator could reason about. The
    /// one per-agent exception is [agent-persistence](CAPABILITY_AGENT_PERSISTENCE), which caps a
    /// single profile at one instance *within* this pool.
    #[serde(
        deserialize_with = "count::option_u64",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_parallel: Option<u64>,
    /// The per-agent turn ceiling. **Absent means unbounded** — the host already caps a run's
    /// wall-clock, so a turn ceiling is left to the operator to set when a study wants one rather
    /// than imposed as a backstop that mostly cuts productive runs short. An agent that reaches a
    /// set ceiling ends `exhausted`.
    #[serde(
        deserialize_with = "count::option_u64",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_turns: Option<u64>,
    /// The run's wall-clock budget in seconds, observed by every agent at its own turn boundary.
    /// Absent means no budget. A run that spends it ends `timed_out`.
    #[serde(
        deserialize_with = "count::option_u64",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_runtime_secs: Option<u64>,
    /// How many **error turns in a row** end an agent. **Absent means gg's default of 5**; set it
    /// explicitly to widen or tighten the ceiling. `0` is refused rather than read as "off" — it
    /// would end an agent before its first turn, so it is not a ceiling gg can honour.
    ///
    /// A turn is an error when the work it *declared* could not be carried out as declared: a
    /// model call that failed, a program that did not compile, one that threw uncaught, or one the
    /// sandbox stopped at a ceiling. A tool call that failed
    /// **inside** an otherwise successful program is not one — the program handled it, which is
    /// the entire point of the typed tool surface, and counting it would make the one capability
    /// that expects failures the one capability that cannot survive them.
    #[serde(
        deserialize_with = "count::option_u64",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_consecutive_errors: Option<u64>,
    /// The fraction of recent turns that may be errors before an agent is stopped, in `0.0..=1.0`.
    /// Breached only **strictly above** the value, matching "more than X%": at `0.5` over a window
    /// of ten, five errors is not a breach and six is. Needs
    /// [`error_rate_window`](Self::error_rate_window); either alone fails the launch.
    ///
    /// When **both** this and the window are absent, gg's default arms an error rate of **0.4 over
    /// the last 50 turns**. A partial declaration (this without the window, or the window without
    /// this) neither falls back to the default nor arms nothing — it is refused, because half a
    /// ceiling is a ceiling the operator believes they have.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_error_rate: Option<f64>,
    /// How many of an agent's most recent turns [`max_error_rate`](Self::max_error_rate) is
    /// measured over — and, deliberately, the minimum sample: the ceiling cannot fire until the
    /// agent has taken this many turns, so one number does both jobs. The earliest turn this
    /// ceiling can stop a run on is therefore turn `error_rate_window` — at `1` it says "stop on
    /// any error", which is a legitimate declaration rather than an accident. Absent (together with
    /// [`max_error_rate`](Self::max_error_rate)) means gg's default window of **50**.
    #[serde(
        deserialize_with = "count::option_u64",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub error_rate_window: Option<u64>,
    /// A ceiling on the run's accumulated cost, in the same USD figure the run record reports
    /// ([`Cost::comparable`](crate::metrics::Cost::comparable), falling back to
    /// [`actual`](crate::metrics::Cost::actual)) — a ceiling measuring something the run record
    /// does not show would be unauditable. Absent means no ceiling.
    ///
    /// Checked at each agent's turn boundary, so it bounds **starting new work** rather than
    /// capping spend: the turn that crosses the line completes in full (gg has already paid for
    /// that response; discarding it would waste the money and abandon work the model asked for),
    /// and the run's final recorded cost therefore exceeds this by at most one turn's cost per
    /// concurrently running agent. The compaction summarizer's own calls are deliberately outside
    /// gg's run totals, so this measures exactly what the run record reports and no more. A run
    /// whose model reports no cost can never be stopped by it — gg does not invent a figure to
    /// stop a run with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_cost: Option<f64>,
    /// The per-run ceiling, in bytes, on the
    /// [session capture journal](crate::gg_session_journal) gg writes as it runs. **Absent means
    /// gg's default of 256 MiB.**
    ///
    /// The odd one out here, and deliberately so: every other ceiling **stops the run**, and
    /// this one stops only the *observation* of it. Crossing it stops capture and marks the
    /// record [truncated](crate::gg_session_record::GgSessionTruncationReason::ByteCeiling) — capture
    /// degrades, it never fails the run it observes, because a debugging artifact that can end
    /// a paid run is worse than no artifact. It lives on this type rather than on a capability's
    /// params because capture is on for every run whatever the set says, so a ceiling parked on a
    /// capability would be unreadable by exactly the runs that need it.
    ///
    /// `0` cannot bound anything (it would stop capture before its first line) and is **refused**,
    /// on the same terms as [`max_consecutive_errors`](Self::max_consecutive_errors)`: 0`. Omit the
    /// key to take the default; there is no spelling of "no ceiling" here, because there is no run
    /// that wants one.
    #[serde(
        deserialize_with = "count::option_u64",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub replay_max_bytes: Option<u64>,
}

impl GgRunLimits {
    /// Whether this declares no ceiling at all — the `skip_serializing_if` predicate on
    /// [`GgCapabilitySet::limits`], so a set that declares nothing omits the key entirely.
    ///
    /// Written against [`Default`] rather than field by field so a ceiling added later cannot be
    /// forgotten here and silently start writing a `limits` key onto every stored set.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Which [execution ceiling](GgRunLimits) stopped a run.
///
/// A closed, stable taxonomy (unlike the open capability ids): the console labels each one and the
/// query language's [`limit`](crate::gg_query::build_run_doc) document field groups by them, so the
/// set is fixed here rather than being a free string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgLimitKind {
    /// [`max_turns`](GgRunLimits::max_turns) — the agent took every turn it was allowed. Its
    /// terminal status is the host's own `exhausted`, not `limit_exceeded`.
    Turns,
    /// [`max_runtime_secs`](GgRunLimits::max_runtime_secs) — the run spent its wall-clock budget.
    /// Its terminal status is the host's own `timed_out`, for the same reason.
    Runtime,
    /// [`max_consecutive_errors`](GgRunLimits::max_consecutive_errors) — the agent failed that
    /// many turns in a row.
    ConsecutiveErrors,
    /// [`max_error_rate`](GgRunLimits::max_error_rate) — too many of the agent's most recent
    /// [`error_rate_window`](GgRunLimits::error_rate_window) turns were errors.
    ErrorRate,
    /// [`max_cost`](GgRunLimits::max_cost) — the run had already accumulated more than the
    /// ceiling when an agent reached its turn boundary.
    Cost,
}

impl GgLimitKind {
    /// Every ceiling, in the order [`GgRunLimits`] declares them — the order the console labels
    /// them in and the order a facet's buckets read best in.
    pub const ALL: [GgLimitKind; 5] = [
        GgLimitKind::Turns,
        GgLimitKind::Runtime,
        GgLimitKind::ConsecutiveErrors,
        GgLimitKind::ErrorRate,
        GgLimitKind::Cost,
    ];

    /// This ceiling's stable wire value — exactly the string serde writes, so the
    /// [`limit`](crate::gg_query::build_run_doc) document field that buckets runs by it and the
    /// JSON a run records can never disagree. Pinned over [`ALL`](Self::ALL) by a test.
    pub const fn as_str(self) -> &'static str {
        match self {
            GgLimitKind::Turns => "turns",
            GgLimitKind::Runtime => "runtime",
            GgLimitKind::ConsecutiveErrors => "consecutive_errors",
            GgLimitKind::ErrorRate => "error_rate",
            GgLimitKind::Cost => "cost",
        }
    }
}

/// One [execution ceiling](GgRunLimits) being breached: which one, what it was set to, what was
/// actually observed, and where.
///
/// Every figure is an `f64` so one shape carries all five ceilings — a turn count, a number of
/// seconds, a consecutive count, a fraction and an amount of money — and one aggregation can slice
/// across them without five parallel fields, four of which would be null on any given run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgLimitBreach {
    /// Which ceiling was breached.
    pub limit: GgLimitKind,
    /// What the ceiling was set to, in its own units (turns, seconds, errors, a fraction, or
    /// cost).
    pub threshold: f64,
    /// What was observed when the check fired, in the same units. For [`Cost`](GgLimitKind::Cost)
    /// this is the spend already accumulated — at or **above** the threshold, because that ceiling
    /// bounds starting new work rather than capping spend.
    pub observed: f64,
    /// How many turns [`agent_id`](Self::agent_id) had taken when the ceiling was breached.
    pub turns: u64,
    /// The agent that observed the breach — the one whose loop ended on it. For a run-wide ceiling
    /// this is whichever agent reached its turn boundary first, which is why it is carried rather
    /// than assumed to be the root.
    pub agent_id: String,
    /// The lookback window the rate was measured over, on [`ErrorRate`](GgLimitKind::ErrorRate)
    /// only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub window: Option<u64>,
}

/// How one agent turn ended — the wire mirror of gg's own `TurnOutcome`, which is the single
/// definition of "was that turn an error?" the [execution ceilings](GgRunLimits) are enforced on.
///
/// Carried on the [`TurnOutcome`](GgTelemetryKind::TurnOutcome) event so the *same* judgement the
/// ceilings act on is visible on the stream. Without it, "how error-prone was this configuration?"
/// is only answerable for the runs a ceiling actually stopped, and a run that failed a third of its
/// turns and finished anyway is indistinguishable from one that never failed a turn at all.
///
/// A closed taxonomy, deliberately: the console labels each value and a study groups by them, so
/// the set is fixed here rather than being a free string. The mapping from gg's enum to this one is
/// written by hand on the gg side, so adding a variant there is a decision to publish it here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgTurnOutcome {
    /// The turn did what its protocol asks: a program that ran to a value (however its individual
    /// tool calls went), or a tool-calling turn whose requested calls were dispatched and answered.
    /// The only outcome that clears an agent's
    /// [consecutive-error run](GgTelemetryKind::TurnOutcome::consecutive_errors).
    Progressed,
    /// The turn ended the session — a program called `finish`, or a tool-calling turn requested no
    /// tools. Terminal, and never an error: a session that ends on purpose has not failed.
    Finished,
    /// The turn's declared work could not be carried out as declared. The
    /// [kind](GgTelemetryKind::TurnOutcome::error) says how, and this is the outcome the error
    /// ceilings count.
    Error,
    /// gg's own machinery failed, so the session ends on the first occurrence. Recorded rather than
    /// skipped — so the turn accounting never drifts from the number of model calls the run made —
    /// and kept **apart** from [`Error`](Self::Error), because charging gg's defects to the model's
    /// error budget would corrupt the one figure this event exists to publish.
    Fatal,
}

/// Why a turn was an [error](GgTurnOutcome::Error), at the **base** level of the two-level error
/// taxonomy — the wire mirror of gg's own `TurnErrorKind`.
///
/// This is the coarse bucket: *whose layer* failed. The **specific** type under it —
/// authentication versus a rejected request, a syntax error versus an unsupported feature, an
/// uncaught tool failure versus an uncaught throw — is [`GgTurnErrorType`], carried beside this on
/// the same event and derivable back to this by [`GgTurnErrorType::kind`]. Read this to compare
/// runs at a glance and to reason about ceilings; read the type to say what actually went wrong.
///
/// Three of the five — [`Transpile`](Self::Transpile), [`ProgramFault`](Self::ProgramFault) and
/// [`SandboxLimit`](Self::SandboxLimit) — are
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) shapes, and that
/// asymmetry is real rather than an oversight: a tool-calling turn whose requested calls are all
/// dispatched and answered cannot declare work that is then cut short.
///
/// # There is deliberately no `response_loop` kind *here*
///
/// A reply abandoned by [loop detection](GgLoopDetection) is **not an error turn**: the attempt is
/// discarded and the request retried, and the turn is judged on whatever the retry produced. A loop
/// that survives every attempt does reach the turn loop, but it arrives as a model-client failure
/// after that client exhausted its own retry budget — so it belongs in [`ModelApi`](Self::ModelApi)
/// for every ceiling, every rate and every side-by-side comparison, which is what this level is
/// for.
///
/// What it is *not* is indistinguishable. gg knows exactly which of the two happened, and now
/// publishes it: a surviving loop is
/// [`ModelResponseLoop`](GgTurnErrorType::ModelResponseLoop) and an exhausted retry is
/// [`ModelRetryExhausted`](GgTurnErrorType::ModelRetryExhausted), under the one base kind. That is
/// the whole reason the taxonomy has two levels — the distinction was being computed and thrown
/// away. The discarded attempts are *additionally* counted in their own right, on the
/// [`loop_aborts`](GgTelemetryKind::TurnOutcome::loop_aborts) field of the same event and in
/// [`GgErrorSummary::loop_aborts`], because they are money spent on nothing rather than a turn that
/// failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgTurnErrorKind {
    /// The model call itself failed, after the client had already exhausted its own retry/backoff
    /// budget. No turn happened at all. Also where a reply that
    /// [looped](GgLoopDetection) on every attempt lands.
    ModelApi,
    /// The program could not be prepared for its guest — a syntax error, a module feature the
    /// sandbox has no implementation of, or a program past the size/nesting guards. Nothing ran.
    ///
    /// The variant keeps its name (and its wire value, `transpile`) from when every program was
    /// TypeScript and preparing one meant stripping its types: the value is contract-visible, and
    /// renaming it would break every reader of persisted run data to describe the same failure.
    Transpile,
    /// The program ran and threw an uncaught fault, so every statement after the throw never ran and
    /// the model must re-declare the remainder.
    ProgramFault,
    /// The sandbox stopped the program at a ceiling — its execution timeout or memory — or the guest
    /// trapped. The program ran and its landed calls stand, but the work it declared was cut short.
    SandboxLimit,
    /// A tool-calling turn ended with no tool call. How an agent declares it is done is not
    /// configurable: every agent ends its session with an explicit, typed call, so a text-only
    /// reply is not a completion but a failure to end the run the one way gg allows. Counted as an
    /// error so a model that keeps replying in prose trips the error ceilings instead of running to
    /// its turn budget.
    MissingCompletion,
}

impl GgTurnErrorKind {
    /// Every kind, in declaration order — the order a console shows the split in, which is
    /// deliberately the contract's own rather than a frequency sort (rows that move as a run
    /// progresses cannot be read at a glance).
    pub const ALL: [Self; 5] = [
        Self::ModelApi,
        Self::Transpile,
        Self::ProgramFault,
        Self::SandboxLimit,
        Self::MissingCompletion,
    ];

    /// This kind's **stable wire id** — the string it serializes to, and the key any breakdown
    /// grouped by base is keyed on.
    ///
    /// Written out by hand rather than derived through `serde_json`, so the value a reader keys on
    /// is a value this file states. `wire_ids_match_serde` pins the two together.
    pub fn wire_id(self) -> &'static str {
        match self {
            Self::ModelApi => "model_api",
            Self::Transpile => "transpile",
            Self::ProgramFault => "program_fault",
            Self::SandboxLimit => "sandbox_limit",
            Self::MissingCompletion => "missing_completion",
        }
    }

    /// A short human-readable label, for a console rendering this kind to a person.
    ///
    /// It lives **here**, beside the variant, rather than in a hand-written table in every consumer:
    /// the contract is generated into TypeScript from this file, labels and all (see the generated
    /// `gg-errors` module), so a kind cannot be added without a label and a label cannot drift from
    /// the taxonomy it names.
    pub fn label(self) -> &'static str {
        match self {
            Self::ModelApi => "model call",
            Self::Transpile => "transpile",
            Self::ProgramFault => "program fault",
            Self::SandboxLimit => "sandbox limit",
            Self::MissingCompletion => "no work declared",
        }
    }
}

/// Why a turn was an [error](GgTurnOutcome::Error), **specifically** — the leaf level of the
/// two-level error taxonomy, under the base [kind](GgTurnErrorKind) each variant reports through
/// [`kind`](Self::kind).
///
/// # Why two levels rather than one wider enum
///
/// The base kind answers "which layer failed?", which is what an error ceiling acts on and what a
/// cross-run comparison groups by; it is a small closed set that persisted run data, saved
/// queries and stored dashboards already key on. This answers "what actually went wrong?", which is
/// what a person reading one run needs and what a *"top error types"* ranking has to be able to
/// distinguish — a run that failed twelve turns on a rejected credential and a run that failed
/// twelve turns on a syntax error are the same `model_api`/`transpile` story only at the coarse
/// level. Adding these as more variants of the base would have widened a wire value every stored
/// record and every ceiling reads; adding them beneath it costs the base nothing.
///
/// # Every variant names a real producer
///
/// A bucket that is permanently zero in every console is a defect, so each variant below documents
/// the exact site that raises it. The set is exactly the distinctions gg makes internally: six
/// shapes of `ModelError`, four of `PrepareError`, three of the sandbox's own ceilings, the three
/// classes the guest types an uncaught throw with over WIT, and the two structurally different ways
/// a turn can end without declaring work.
///
/// # Names carry their base
///
/// Every variant is prefixed with its base's noun (`model_`, `transpile_`, `program_`, `sandbox_`,
/// `missing_completion_`) because these are ranked in one flat list, one row per type,
/// where a bare `syntax` or `timeout` would not say which layer it came from.
///
/// [`ModelRejected`](Self::ModelRejected) is deliberately *not* named `fatal`, even though gg's
/// `ModelError::Fatal` is what raises it: `fatal` already means [gg's own machinery
/// broke](GgTurnOutcome::Fatal) on the field immediately beside this one, and two meanings of one
/// word on adjacent fields of one event is a misreading waiting to happen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgTurnErrorType {
    /// The run's **credential** was refused: no key in the environment, or a `401`/`403` from the
    /// provider. No model ever ran, which is why gg ends such a run as a harness error rather than
    /// scoring it against the model.
    ModelAuth,
    /// The provider rejected the request for some other non-retryable reason — a `4xx` that is not
    /// an auth failure (a context length the route will not take, an unroutable model, a malformed
    /// request).
    ModelRejected,
    /// The provider never served the request: the client retried a transient condition (`429`,
    /// `5xx`, a transport error) to its policy and every attempt failed.
    ModelRetryExhausted,
    /// The provider served the request and every answer was a
    /// [generation loop](GgLoopDetection), so the client discarded all of them and gave up. The
    /// request was fine and the provider was up, which is precisely why this must not read as
    /// [`ModelRetryExhausted`](Self::ModelRetryExhausted).
    ModelResponseLoop,
    /// The request carried an image the model cannot accept, and gg had nothing left to strip —
    /// either the pictures were not gg's to remove, or the retry against the stripped conversation
    /// was refused too. (When there *is* something to strip, gg drops the images and re-runs the
    /// turn, so the ordinary case never reaches the turn seam at all.)
    ModelVisionUnsupported,
    /// A `2xx` response could not be parsed into a reply. Retrying an already-successful-but-
    /// malformed response would not help, so the turn ends on it.
    ModelParse,
    /// The program is not valid source in its [language](GgProgramLanguage) — the parser's own
    /// diagnostics. Nothing ran.
    TranspileSyntax,
    /// The program parses but breaks a rule the language enforces before any statement runs: a
    /// `const` declared twice, a duplicate binding in a destructuring pattern.
    TranspileSemantic,
    /// The language's **compiler read the whole program and rejected it** — a type error, a borrow
    /// error, a name that does not resolve, an interface a class does not satisfy. The model is
    /// handed the compiler's own diagnostics and writes another program; nothing ran.
    ///
    /// Kept apart from [`TranspileSyntax`](Self::TranspileSyntax) because the two say opposite
    /// things about the model. A syntax error is a typo. A compile error is a program the model
    /// wrote whole and coherently and got *wrong about the surface it was writing against* — which
    /// is the most informative thing a checked language's arm can report about the SDK it was
    /// handed, and is meaningless if it is pooled with typos.
    ///
    /// Only a language whose preparation type-checks can produce it, so it is absent from every run
    /// of a language that does not — which is a fact about the arm, not a gap.
    TranspileCompile,
    /// The program asks for something the sandbox will not run it with — a module import where
    /// there is no loader, an `await` where there is no event loop, a nesting depth past the
    /// parser's guard.
    TranspileUnsupported,
    /// The program ran and a **failed call it did not catch** ended it: a call the membrane
    /// serviced and the tool behind it rejected, or refused for any reason other than the run not
    /// offering it. The single most actionable program fault there is — it says the model is
    /// fighting the API rather than mis-writing it — and it was previously indistinguishable from
    /// any other throw.
    ProgramToolError,
    /// **The program reached for something this run does not offer it**, and the throw ended the
    /// turn: a name that was never in the program's scope, or a call the membrane refused
    /// `unavailable` because this agent's capability set, [allowlist](GgAgentConfig::operations),
    /// role or program library does not include it.
    ///
    /// The two are one fact and one recovery — write against the surface you were given — and they
    /// are folded together on purpose. Which of the two a language *produces* is an accident of how
    /// its SDK is bound: a guest that builds a scope leaves a withheld name out of it and throws a
    /// reference error, while a guest that links its SDK as an ordinary library has every name and
    /// gets a refusal from the host. Left apart, the identical event would be counted under two
    /// different types depending on the arm, which is a confound a cross-language comparison cannot
    /// carry.
    ProgramUnknownName,
    /// The program threw for any other reason: its own `TypeError`, a `throw` it wrote, an
    /// assertion it failed.
    ProgramThrow,
    /// The sandbox stopped the program at its **execution timeout** — in practice a loop or a
    /// recursion that does not terminate, since the ceiling is set far longer than any honest
    /// program needs. Time parked in a bridged call does not count towards it.
    SandboxTimeout,
    /// The guest's linear memory grew past its cap and the program was stopped.
    SandboxOutOfMemory,
    /// The guest trapped for some other reason. The program ran and its landed calls stand.
    SandboxTrap,
    /// A tool-calling turn ended with **no tool call** — the model replied in prose where the one
    /// way to end a session is an explicit, typed call.
    MissingCompletionNoCall,
    /// A turn replied with no tool call while a [compaction](GgTelemetryKind::Compaction) was
    /// pending: the model was told to compact its window and answered with prose instead. A
    /// different failure from [`MissingCompletionNoCall`](Self::MissingCompletionNoCall) — the
    /// session is nowhere near ending, and gg answers it by restating the compaction rather than by
    /// explaining how to finish — and it is answered differently, so it is recorded differently.
    MissingCompletionCompaction,
}

impl GgTurnErrorType {
    /// Every type, grouped by its [base kind](Self::kind) in that kind's declaration order.
    ///
    /// The grouping is the reading order a console ranks and labels from, and it is what makes
    /// "every type has a base, and every base has at least one type" checkable rather than asserted.
    pub const ALL: [Self; 18] = [
        Self::ModelAuth,
        Self::ModelRejected,
        Self::ModelRetryExhausted,
        Self::ModelResponseLoop,
        Self::ModelVisionUnsupported,
        Self::ModelParse,
        Self::TranspileSyntax,
        Self::TranspileSemantic,
        Self::TranspileCompile,
        Self::TranspileUnsupported,
        Self::ProgramToolError,
        Self::ProgramUnknownName,
        Self::ProgramThrow,
        Self::SandboxTimeout,
        Self::SandboxOutOfMemory,
        Self::SandboxTrap,
        Self::MissingCompletionNoCall,
        Self::MissingCompletionCompaction,
    ];

    /// The [base kind](GgTurnErrorKind) this type falls under.
    ///
    /// Total and hand-written, so the two levels cannot disagree: the `error` and `errorType` fields
    /// of one [`TurnOutcome`](GgTelemetryKind::TurnOutcome) event are emitted from a single value,
    /// and this is the function that derives one from the other. A reader may therefore regroup a
    /// per-type breakdown by base and get the per-kind counters back exactly.
    pub fn kind(self) -> GgTurnErrorKind {
        match self {
            Self::ModelAuth
            | Self::ModelRejected
            | Self::ModelRetryExhausted
            | Self::ModelResponseLoop
            | Self::ModelVisionUnsupported
            | Self::ModelParse => GgTurnErrorKind::ModelApi,
            Self::TranspileSyntax
            | Self::TranspileSemantic
            | Self::TranspileCompile
            | Self::TranspileUnsupported => GgTurnErrorKind::Transpile,
            Self::ProgramToolError | Self::ProgramUnknownName | Self::ProgramThrow => {
                GgTurnErrorKind::ProgramFault
            }
            Self::SandboxTimeout | Self::SandboxOutOfMemory | Self::SandboxTrap => {
                GgTurnErrorKind::SandboxLimit
            }
            Self::MissingCompletionNoCall | Self::MissingCompletionCompaction => {
                GgTurnErrorKind::MissingCompletion
            }
        }
    }

    /// This type's **stable wire id** — the string it serializes to, and the key
    /// [`GgErrorSummary::by_type`] is keyed on.
    ///
    /// Written out by hand for the reason [`GgTurnErrorKind::wire_id`] gives: the id is the durable
    /// thing here, read back out of records written by every gg that ever ran, so it is stated
    /// rather than inferred.
    pub fn wire_id(self) -> &'static str {
        match self {
            Self::ModelAuth => "model_auth",
            Self::ModelRejected => "model_rejected",
            Self::ModelRetryExhausted => "model_retry_exhausted",
            Self::ModelResponseLoop => "model_response_loop",
            Self::ModelVisionUnsupported => "model_vision_unsupported",
            Self::ModelParse => "model_parse",
            Self::TranspileSyntax => "transpile_syntax",
            Self::TranspileSemantic => "transpile_semantic",
            Self::TranspileCompile => "transpile_compile",
            Self::TranspileUnsupported => "transpile_unsupported",
            Self::ProgramToolError => "program_tool_error",
            Self::ProgramUnknownName => "program_unknown_name",
            Self::ProgramThrow => "program_throw",
            Self::SandboxTimeout => "sandbox_timeout",
            Self::SandboxOutOfMemory => "sandbox_out_of_memory",
            Self::SandboxTrap => "sandbox_trap",
            Self::MissingCompletionNoCall => "missing_completion_no_call",
            Self::MissingCompletionCompaction => "missing_completion_compaction",
        }
    }

    /// A short human-readable label, for the row this type occupies in a ranking.
    ///
    /// Written to stand **alone**: a "top error types" list shows one of these per row, so each has
    /// to say which layer it came from without leaning on a heading. It lives here, beside the
    /// variant, and is generated into the TypeScript contract — see [`GgTurnErrorKind::label`].
    pub fn label(self) -> &'static str {
        match self {
            Self::ModelAuth => "model auth rejected",
            Self::ModelRejected => "model call rejected",
            Self::ModelRetryExhausted => "model retries exhausted",
            Self::ModelResponseLoop => "model looped every attempt",
            Self::ModelVisionUnsupported => "model cannot see images",
            Self::ModelParse => "unparseable model response",
            Self::TranspileSyntax => "syntax error",
            Self::TranspileSemantic => "semantic error",
            Self::TranspileCompile => "compiler rejected the program",
            Self::TranspileUnsupported => "unsupported program feature",
            Self::ProgramToolError => "uncaught call failure",
            Self::ProgramUnknownName => "unknown name",
            Self::ProgramThrow => "uncaught throw",
            Self::SandboxTimeout => "execution timeout",
            Self::SandboxOutOfMemory => "out of memory",
            Self::SandboxTrap => "sandbox trap",
            Self::MissingCompletionNoCall => "no work declared",
            Self::MissingCompletionCompaction => "compaction ignored",
        }
    }
}

/// Why one call failed, in the class the caller branches on — the wire mirror of gg's own
/// `ToolFailure`, and of the membrane's `error-code`.
///
/// It is carried by whichever of the two surfaces' closing records the call has: the
/// [`ToolResult`](GgTelemetryKind::ToolResult) a tool-calling agent's dispatch closes with, or the
/// [`ApiResult`](GgTelemetryKind::ApiResult) a responses-as-code agent's call closes with. **A call
/// has exactly one of them**, because an agent has exactly one surface (see
/// [`ApiCall`](GgTelemetryKind::ApiCall)) — so the class is spelled on both types rather than on a
/// shared one, and a cross-surface count of a failure class is a sum over two disjoint sets rather
/// than a join over one.
///
/// Without this, a failed call recorded nothing at all about *why*: the class was computed where
/// the failure was raised, handed to the program to branch on, and then dropped at the telemetry
/// seam. A model fighting the same `not-found` forty times is among the most actionable facts a run
/// has, and it was not in the record.
///
/// # Its spelling is kebab-case, on purpose
///
/// Every other enum in this module is snake_case. This one is `"invalid-argument"`, because the
/// class is *already* spelled that way in the three places a reader meets it — gg's own
/// `ToolFailure` serde, the membrane's WIT `error-code`, and the `code` field of the `ToolError` a
/// program catches. One deviation from this module's convention is a smaller cost than three
/// spellings of one fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgToolFailure {
    /// The arguments were malformed, ill-typed, or out of range — including a path that is absolute
    /// or climbs out of the workspace.
    InvalidArgument,
    /// The named file, skill, memory, task, epic, issue, subagent, stored program or documentation
    /// entry does not exist. A *model slot* is not one of them: a slot is launch configuration, and
    /// an agent name a run does not declare is `invalid-argument`.
    NotFound,
    /// Well-formed, but in conflict with the current state: an ambiguous edit, a dependency cycle,
    /// a duplicate id, a subagent that already returned.
    Conflict,
    /// gg refused the call: a memory tool reached while this agent holds its memories read-only, a
    /// call a pending compaction does not admit, a session that already ended (or was already
    /// handed on) this turn, or a [hook](GgHook) that blocked it. Every one of those is gg
    /// declining a call it *could* have served, on a rule about this agent's state; a ceiling the
    /// call ran into is `limit-exceeded` instead, and the delegation depth cap in particular is a
    /// ceiling rather than a refusal.
    Refused,
    /// The call exists but this run's capability set does not offer it. On the API surface this is
    /// the membrane's backstop refusing a name a program reached anyway.
    Unavailable,
    /// A gg-side ceiling was hit: a shell timeout, a memory/task/board cap, the delegation depth
    /// cap, one of the view caps a program spends, or the run's wall-clock budget running out
    /// mid-program. The depth cap belongs here rather than under `refused` because the request was
    /// well-formed and gg had no objection to it: the run simply has no room left below this
    /// agent, which is a quantity and not a rule.
    LimitExceeded,
    /// The underlying I/O or process failed.
    IoError,
    /// The failure was not classified. Raised outside a tool implementation — the loop's own bridge
    /// and degradation paths — where there is no tool vocabulary to draw a class from. Recorded as
    /// its own value rather than as an absent one, so "this call failed" and "this call failed and
    /// nobody said why" stay distinguishable.
    Other,
}

impl GgToolFailure {
    /// Every class, in declaration order.
    pub const ALL: [Self; 8] = [
        Self::InvalidArgument,
        Self::NotFound,
        Self::Conflict,
        Self::Refused,
        Self::Unavailable,
        Self::LimitExceeded,
        Self::IoError,
        Self::Other,
    ];

    /// This class's **stable wire id** — kebab-case, matching the spelling a program branches on.
    pub fn wire_id(self) -> &'static str {
        match self {
            Self::InvalidArgument => "invalid-argument",
            Self::NotFound => "not-found",
            Self::Conflict => "conflict",
            Self::Refused => "refused",
            Self::Unavailable => "unavailable",
            Self::LimitExceeded => "limit-exceeded",
            Self::IoError => "io-error",
            Self::Other => "other",
        }
    }

    /// A short human-readable label, generated into the TypeScript contract for the reason
    /// [`GgTurnErrorKind::label`] gives.
    pub fn label(self) -> &'static str {
        match self {
            Self::InvalidArgument => "invalid argument",
            Self::NotFound => "not found",
            Self::Conflict => "conflict",
            Self::Refused => "refused",
            Self::Unavailable => "unavailable",
            Self::LimitExceeded => "limit exceeded",
            Self::IoError => "I/O error",
            Self::Other => "unclassified",
        }
    }
}

/// The gg **launch contract**: the JSON document `core` writes and the `gg` binary
/// reads via `--config <PATH>`.
///
/// This is the seam between The Test Cabinet's `core` (which constructs the file and
/// launches the binary as part of the integration workflow) and the `gg` binary
/// (which deserializes it and drives the session). It lives here in `core` — rather
/// than only in the `gg` crate — so both sides of that process boundary share a
/// single definition instead of matching shapes by hand: `core` constructs it, and
/// `gg` (which already depends on `core`) reads it.
///
/// Unlike its neighbours in this module, `GgInvocation` is a **Rust-to-Rust launch
/// detail**, not a published wire schema — nothing outside these two components
/// consumes it — so it stays plain `serde` + [`PartialEq`] and is deliberately left
/// out of the [contract codegen](../../contract_codegen/index.html) roots: it grows
/// no TypeScript or JSON-Schema bindings. (Its [`capability_set`](Self::capability_set)
/// field is a codegen'd contract type, but the envelope around it is not.)
///
/// The one thing that does **not** travel in the file is the model credential: the
/// client reads `OPENROUTER_API_KEY` from the environment so a secret is never
/// serialized to disk. JSON is camelCase, matching the rest of the contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GgInvocation {
    /// The id of this gg session. Stamped onto every emitted [`GgTelemetryEvent`] so
    /// the console can attribute the stream to the run.
    pub session_id: String,
    /// The seeded run workspace the agent builds in — the directory `core`'s shared
    /// seeding/`init` prepared inside the run container.
    pub workspace_dir: PathBuf,
    /// The build prompt handed to the agent (the rendered test-case instruction).
    pub prompt: String,
    /// The [capability set](GgCapabilitySet) configuring this run: which capabilities
    /// are on, their implementations/params, and the model-slot bindings. Defaults to
    /// the Phase 0 capability set with no slot bound when the file omits it (a
    /// configuration that parses but cannot launch a real session).
    #[serde(default)]
    pub capability_set: GgCapabilitySet,
    /// The context window, in tokens, of each model this run may bind — the **model
    /// catalog's** figure for it, resolved when the run was triggered and pushed in
    /// here. Keyed by the model id the [binding](GgSlotBinding::model_id) names, so a
    /// [multi-model](https://docs.testcabinet.ai/gg/configurations/#model-slots) run carries one entry
    /// per bound model and each agent is measured against its own model's window.
    ///
    /// gg keeps **no model table of its own**. The catalog the backend owns is the
    /// single store of model facts, and a run is *told* what it needs at launch rather
    /// than querying for it from inside the run container — where it has neither the
    /// backend's address nor a reason to reach it. Every model the set
    /// [binds](GgCapabilitySet::bound_model_ids) must appear here — a run whose catalog could not
    /// answer for one is rejected before the container is pulled
    /// ([`RunRequest::validate`](crate::RunRequest::validate)) — because gg measures window
    /// fullness, and therefore triggers [compaction](CAPABILITY_COMPACTION), against this figure
    /// and has nothing to invent one from.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub model_windows: BTreeMap<String, u64>,
    /// The **input modalities** each model this run may bind accepts (`text`, `image`,
    /// `file`, …), from the same model catalog and pushed in on the same terms as
    /// [`model_windows`](Self::model_windows). Keyed by the model id the
    /// [binding](GgSlotBinding::model_id) names.
    ///
    /// This is what lets gg show a model a reference image — the mockups a test case
    /// ships are part of its spec — without breaking a run on a model that cannot take
    /// one. A model listed **without** `image` is never sent a picture; a model that is
    /// **absent** from the map is unknown rather than text-only, and gg tries the image
    /// and recovers if the provider refuses it. Either way an image read never fails a
    /// run.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub model_modalities: BTreeMap<String, Vec<String>>,
    /// The **workspace-relative paths of every file the test case provided** — its
    /// specifications (in seeded order) followed by its rendered reference images — that
    /// the [autoload-specifications](CAPABILITY_AUTOLOAD_SPECS) capability injects into an
    /// agent's opening context.
    ///
    /// `core` computes this list when it seeds the run (it is the authority on which
    /// seeded files came from the test case, as opposed to a starter-workspace scaffold or
    /// the model's own output) and pushes it in here, so gg need not — and cannot reliably
    /// — rediscover it by scanning the workspace. Empty when nothing was seeded or every
    /// agent leaves autoload off, in which case gg reads none of them up front.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub provided_files: Vec<PathBuf>,
    /// The path of the **cancellation sentinel** to watch, when the host can cancel this
    /// run. gg checks for the file's existence at each agent's turn boundary and, once it
    /// appears, winds the session down exactly as a breached run-wide ceiling does.
    ///
    /// A file rather than a signal or a channel because gg runs as its own process inside
    /// the run container: the host has no handle on it beyond the container, but it can
    /// always write a file into one. A file rather than a flag in this document because
    /// the document is written once, before launch, and a cancellation is by definition
    /// news that arrives afterwards.
    ///
    /// `None` — the default — means nothing can cancel this run, and gg never looks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancel_file: Option<PathBuf>,
}

/// The **source** a context-window contribution is attributed to, for the per-source
/// accounting [context visibility] reports.
///
/// gg's context is not a flat transcript: every item that occupies the window is tagged
/// with the source that produced it, so gg can report *what* is filling the window —
/// the signal [compaction] triggers on and the console renders as a stacked line graph.
/// The set is a **closed, stable taxonomy** (unlike the open capability ids): the
/// console's categories and their colors are keyed to these variants, and
/// [`ALL`](Self::ALL) fixes their order so a breakdown is emitted with every category
/// present (a zero when a source contributed nothing this turn), keeping the graph's
/// bands stable across turns.
///
/// [context visibility]: https://docs.testcabinet.ai/gg/context-visibility/
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgContextSource {
    /// The base system prompt seeding the session.
    System,
    /// The build prompt handed to the agent (the rendered test-case instruction).
    UserPrompt,
    /// An assistant turn's own output (its natural-language text and tool calls).
    Assistant,
    /// The output of a tool the agent called, fed back as a tool result.
    ///
    /// **Tool calling only.** A
    /// [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/messages/) program has no tool
    /// results: a call's value returns into the program, and the only thing that reaches the model
    /// is a [view](Self::FileView) it opened. What gg has to say back to a code-mode agent is
    /// therefore never tool output — it is a [compiler](Self::CompilerError) or
    /// [runtime](Self::RuntimeError) error, or a [notice](Self::System).
    ToolOutput,
    /// A [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/messages/) program that failed
    /// to compile, carrying the compiler's error and nothing else.
    CompilerError,
    /// A [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/messages/) program that
    /// compiled and then threw, or that the sandbox stopped, carrying the error and nothing else.
    ///
    /// Split from [`CompilerError`](Self::CompilerError) because the two are different failures with
    /// different recoveries — one means nothing ran, the other means part of the program's work
    /// stands — and a model that cannot tell them apart cannot pick the right one.
    RuntimeError,
    /// The contents of a file the agent viewed — evictable working material (an
    /// agent-managed context capability may drop these; ordinary tool output is not a
    /// file view).
    FileView,
    /// Material the agent **composed** and put in its own window — a value a
    /// [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/views/) program
    /// computed and opened as a labelled view, rather than something read off the
    /// workspace or reported back by gg.
    ///
    /// It is the third party to the two bands either side of it, and the distinction is
    /// about *authorship*, not about content: a [`FileView`](Self::FileView) is workspace
    /// material (gg read a path the agent named, and the file on disk is the truth the
    /// view is a snapshot of), [`ToolOutput`](Self::ToolOutput) is gg's own per-turn
    /// reporting back to the agent on the tool-calling path, and a text view is the agent's own material — a
    /// summary, a diff, a table, a subagent's answer — that exists nowhere but the window.
    /// Each one is keyed by the label the agent gave it, so it can be attributed, superseded
    /// and closed by name exactly as a file view is by path.
    TextView,
    /// One **documentation view** a
    /// [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/views/) agent opened: the
    /// documentation for one thing gg's SDK offers, keyed by the name it is addressed under.
    ///
    /// Its own band rather than a share of [`Skill`](Self::Skill). Two things follow from
    /// separating them, and both are the point.
    /// Documentation is the one band whose size is a direct consequence of how a model *discovers*
    /// its surface, so what it costs has to be readable on its own rather than added to whatever
    /// skills the run happened to pin. And a call that closes documentation can then be a removal
    /// over one band, instead of a removal over the skill band that has to spare pinned items to
    /// avoid eating a read skill — a carve-out that was load-bearing by accident.
    DocsView,
    /// The results of the agent's **last documentation search**: a page of one-line briefs it can
    /// open the full documentation of by name.
    ///
    /// Its own band rather than a text view carrying the same list, and the reason is measurement.
    /// With the prompt naming no functions, searching is how an agent finds its surface at all — so
    /// *what discovery costs a window* is one of the things the whole design exists to find out, and
    /// it can only be read off a band nothing else contributes to. Folded into text views it would
    /// be added to whatever else the agent happened to show itself; folded into
    /// [`DocsView`](Self::DocsView) it would break the property that band is built on, since
    /// documentation is append-only and a search result replaces the one before it.
    SearchResults,
    /// A [skill](https://docs.testcabinet.ai/gg/skills/) shown or read — retained across
    /// a compaction boundary.
    Skill,
    /// A self-curated [memory](https://docs.testcabinet.ai/gg/memories/) — retained
    /// across a compaction boundary.
    Memory,
    /// The model's [task](https://docs.testcabinet.ai/gg/tasks/) list — retained across
    /// a compaction boundary.
    TaskList,
    /// The model's [epic/issue board](https://docs.testcabinet.ai/gg/project-management/)
    /// — the heavyweight work-decomposition counterpart to the task list, retained across
    /// a compaction boundary.
    Board,
    /// Prior-turn thread material not attributable to a more specific source — the
    /// catch-all history bucket, and what compaction summarizes.
    History,
}

impl GgContextSource {
    /// Every source, in a stable order. A [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown)
    /// reports one entry per source in this order (zero when a source contributed
    /// nothing), so the console's stacked graph keeps stable bands across turns.
    pub const ALL: [GgContextSource; 15] = [
        GgContextSource::System,
        GgContextSource::UserPrompt,
        GgContextSource::Assistant,
        GgContextSource::ToolOutput,
        GgContextSource::CompilerError,
        GgContextSource::RuntimeError,
        GgContextSource::FileView,
        GgContextSource::TextView,
        GgContextSource::DocsView,
        GgContextSource::SearchResults,
        GgContextSource::Skill,
        GgContextSource::Memory,
        GgContextSource::TaskList,
        GgContextSource::Board,
        GgContextSource::History,
    ];
}

/// The estimated token cost attributed to one [`GgContextSource`] at a point in the
/// run — one band of a [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown).
///
/// The token figure is an **estimate**: exact per-provider counts are not available
/// cross-provider, so gg counts with a fixed BPE tokenizer as a documented cross-model
/// approximation (see the `context` module in the `gg` crate).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgContextSourceUsage {
    /// The source this band accounts for.
    pub source: GgContextSource,
    /// The estimated tokens that source occupies in the context window.
    pub tokens: u64,
}

/// A pointer from one turn's [`Prompt`](GgTelemetryKind::Prompt) into the
/// [message pool](GgTelemetryKind::ContextMessage) — one message in the request, in
/// the order it was sent.
///
/// The message's content is carried once, on its [`ContextMessage`](GgTelemetryKind::ContextMessage)
/// definition; a prompt references it by [`id`](Self::id) so a message repeated across
/// turns is never restreamed. [`source`](Self::source) is the [`GgContextSource`] band
/// the message occupies **this turn** — carried on the reference rather than the pooled
/// message because a single message can change bands over its life (a mutable block
/// superseded into [`History`](GgContextSource::History) keeps its content, and thus its
/// id, but moves band). It is what lets a request's message list line up, message by
/// message, with the per-source [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgPromptRef {
    /// The pooled message's stable id (a fingerprint of its content).
    pub id: String,
    /// The context-window band this message occupies this turn.
    pub source: GgContextSource,
}

/// A tool call recorded on a pooled assistant [`ContextMessage`](GgTelemetryKind::ContextMessage)
/// — the message-log form of an assistant turn's request to invoke a tool.
///
/// Mirrors the loop's own tool-call shape (id, name, and parsed JSON arguments); it is a
/// distinct type from the live [`ToolCall`](GgTelemetryKind::ToolCall) event because that
/// carries only the *latest* call for the feed, while this is the verbatim call as it sat
/// in the window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgLoggedToolCall {
    /// The provider-assigned call id (keying the `tool` result that answers it).
    pub id: String,
    /// The tool's name.
    pub name: String,
    /// The arguments the assistant passed, as a free-form JSON object.
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub args: Value,
}

/// A **descriptor** of an image attached to a pooled message — its media type, decoded
/// size, and the tokens it is charged — recorded in place of the base64 bytes.
///
/// A request log exists to show *what the model was sent*, and an inline picture's bytes
/// are neither readable nor cheap: a single reference mockup can be megabytes of base64,
/// which would dominate the run record while adding nothing a reader of a request needs.
/// The descriptor keeps the picture accountable (it is why a `read_file` view's token
/// figure is what it is) without carrying the pixels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgLoggedImage {
    /// The IANA media type (`image/png`, `image/jpeg`, …).
    pub media_type: String,
    /// The image's decoded size in bytes — what the file on disk measured.
    pub bytes: u64,
}

/// The state of one [skill](https://docs.testcabinet.ai/gg/skills/) at a point in a run
/// — a band of a [`SkillsState`](GgTelemetryKind::SkillsState) event.
///
/// A skill is markdown-with-front-matter authored ahead of the run; its
/// [`description`](Self::description) is shown to the model up front (so it knows the
/// skill exists and what it is for), and [`read`](Self::read) reports whether the model
/// has called `read_skill` on it — at which point the skill's body is loaded into the
/// context window and retained across a [compaction] boundary.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSkillState {
    /// The skill's stable name (from its front matter), the handle `read_skill` takes.
    pub name: String,
    /// The skill's one-line description, shown to the model up front.
    pub description: String,
    /// Whether the model has read the skill this session (loading its body into context).
    pub read: bool,
}

/// The bounds gg enforces on the model's self-curated [memories] — a band of the
/// [`MemoryState`](GgTelemetryKind::MemoryState) event so the console can show how close
/// the model is to each limit.
///
/// Because memories are curated by the *model itself* (unlike [skills], authored ahead of
/// the run), they must be bounded so self-curated notes cannot crowd out the working
/// context. When a write would exceed a limit, gg rejects it and instructs the model to
/// revise or evict rather than silently truncating or dropping. Lengths are measured in
/// characters of a memory's **body** (its `description` is a short one-liner, like a
/// skill's).
///
/// # Which limits apply, and what they default to
///
/// Every limit is optional — `None` is **unlimited**, which a run configures by setting the
/// param to `0` — and which ones a run resolves depends on the
/// [strategy](CAPABILITY_MEMORIES) its `implementation` selected. A limit a strategy does
/// not use is always `None`:
///
/// | Limit | Param | [`scratchpad`](MEMORY_STRATEGY_SCRATCHPAD) | [`markdown`](MEMORY_STRATEGY_MARKDOWN) | [`keyword-search`](MEMORY_STRATEGY_KEYWORD_SEARCH) |
/// | --- | --- | --- | --- | --- |
/// | [`max_count`](Self::max_count) | `maxCount` | 8 | — | unlimited |
/// | [`max_len_per_memory`](Self::max_len_per_memory) | `maxLenPerMemory` | 2 000 | 8 192 | 8 192 |
/// | [`max_total_len`](Self::max_total_len) | `maxTotalLen` | 8 000 | — | — |
/// | [`max_len_index`](Self::max_len_index) | `maxLenIndex` | — | 16 384 | — |
/// | [`max_len_description`](Self::max_len_description) | `maxLenDescription` | unlimited | unlimited | unlimited |
/// | [`max_results`](Self::max_results) | `maxResults` | — | — | 25 |
///
/// [memories]: https://docs.testcabinet.ai/gg/memories/
/// [skills]: https://docs.testcabinet.ai/gg/skills/
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgMemoryCaps {
    /// The maximum number of memories that may exist at once; `null` is unlimited.
    pub max_count: Option<u64>,
    /// The maximum length, in characters, of any single memory's body; `null` is unlimited.
    pub max_len_per_memory: Option<u64>,
    /// The maximum total length, in characters, summed across every memory's body; `null`
    /// is unlimited (and always `null` for a strategy that does not hold every body in the
    /// window).
    pub max_total_len: Option<u64>,
    /// The maximum length, in characters, of the pinned **index** the
    /// [`markdown`](MEMORY_STRATEGY_MARKDOWN) strategy keeps — the one limit that bounds how
    /// many memories that strategy can hold, since every one of them must be listed there.
    /// `null` for every other strategy, and when the index is unlimited.
    pub max_len_index: Option<u64>,
    /// The maximum length, in characters, of a memory's one-line **description** — the part
    /// of a memory a strategy shows up front (every line of a
    /// [`markdown`](MEMORY_STRATEGY_MARKDOWN) index is one), which is why a run that wants a
    /// tight index bounds it here rather than trusting the model to be terse. Off by default
    /// (`null` is unlimited) and applies under every strategy.
    pub max_len_description: Option<u64>,
    /// The most memories one `search_memories` call reports under the
    /// [`keyword-search`](MEMORY_STRATEGY_KEYWORD_SEARCH) strategy. `null` for every other
    /// strategy — it is a page size rather than a bound on what may be stored, and is
    /// reported alongside the limits because it is resolved from the same params.
    pub max_results: Option<u64>,
}

/// The status of one [task](https://docs.testcabinet.ai/gg/tasks/) — a field of a
/// [`GgTaskEntry`] in a [`TasksState`](GgTelemetryKind::TasksState) event.
///
/// A task moves from [`Pending`](Self::Pending) (not started) through
/// [`InProgress`](Self::InProgress) (being worked) to [`Done`](Self::Done) (complete). A
/// task is *actionable* only when all of its blockers are [`Done`](Self::Done); the console
/// derives that from the blocked-by edges and each blocker's status rather than a separate
/// flag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgTaskStatus {
    /// Not started.
    Pending,
    /// Being worked on.
    InProgress,
    /// Complete — a task's blockers must all reach this before it is actionable.
    Done,
}

/// One model-curated [task](https://docs.testcabinet.ai/gg/tasks/) — a node of the
/// blocked-by DAG reported in a [`TasksState`](GgTelemetryKind::TasksState) event.
///
/// The model builds a lightweight to-do list with `add_task` (and revises it with
/// `update_task` / `set_blocked_by` / `complete_task` / `remove_task`). Each task has a
/// stable [`id`](Self::id) the model coins and references, a [`title`](Self::title), an
/// optional [`description`](Self::description), a [`status`](Self::status), and the set of
/// task ids it is [`blocked_by`](Self::blocked_by). The blocking relation is a **DAG** —
/// gg rejects any edge that would introduce a cycle — and the whole list is retained across
/// a [compaction] boundary verbatim, so the model never loses the plan it decomposed.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgTaskEntry {
    /// The task's stable id — the handle the other task tools and every `blockedBy`
    /// reference use.
    pub id: String,
    /// The task's short title.
    pub title: String,
    /// An optional longer description of the task.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub description: Option<String>,
    /// What the task **is** responsible for — present only in the tasks capability's
    /// **issues** [mode](https://docs.testcabinet.ai/gg/tasks/), which requires the same
    /// structured sections as a [board issue](GgBoardIssue). Absent in the default **simple**
    /// mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub in_scope: Option<String>,
    /// What the task is **not** responsible for — present only in **issues** mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub out_of_scope: Option<String>,
    /// How the task will be judged **done** — present only in **issues** mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub completion_criteria: Option<String>,
    /// The task's status.
    pub status: GgTaskStatus,
    /// The ids of the tasks this task is blocked by (must all be
    /// [`Done`](GgTaskStatus::Done) before this task is actionable). The relation is
    /// acyclic across the whole list.
    pub blocked_by: Vec<String>,
}

/// The status of one [issue](https://docs.testcabinet.ai/gg/project-management/) on the
/// [board](GgTelemetryKind::BoardState) — the heavyweight counterpart to
/// [`GgTaskStatus`].
///
/// An issue moves from [`Open`](Self::Open) (enqueued, not yet dispatched) through
/// [`InProgress`](Self::InProgress) (an agent has been assigned and is working it) and
/// [`InReview`](Self::InReview) (its agent called it complete and gg is reconciling it) to a
/// terminal state — [`Done`](Self::Done) (accepted complete) or [`Failed`](Self::Failed) (its
/// assigned agent could not complete it within the configured retries). Like a task, an issue
/// is *actionable* only when all of its blockers are [`Done`](Self::Done); the console derives
/// that from the blocked-by edges and each blocker's status rather than a separate flag. A
/// [`Failed`](Self::Failed) blocker is terminal but **not** done, so it leaves its dependents
/// permanently blocked — surfaced on the board rather than silently unblocking them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgIssueStatus {
    /// Enqueued, not yet dispatched.
    Open,
    /// An agent has been assigned and is working it.
    InProgress,
    /// Its assigned agent called the work complete, and gg is reconciling it: running the issue's
    /// [reviewers](GgBoardIssue::reviewers) (if any) and merging its worktree back. **Not**
    /// terminal — a review that requests changes sends the issue back to
    /// [`InProgress`](Self::InProgress) — and not done, so dependents stay blocked until the
    /// work is actually accepted and merged.
    InReview,
    /// Accepted complete, and its worktree merged back into the main tree — an issue's blockers
    /// must all reach this before it is actionable.
    Done,
    /// The assigned agent could not complete the issue within its configured retries. Terminal,
    /// but not [`Done`](Self::Done): its dependents stay blocked.
    Failed,
}

/// One [epic](https://docs.testcabinet.ai/gg/project-management/) on the board — a grouping of
/// related [issues](GgBoardIssue) reported in a [`BoardState`](GgTelemetryKind::BoardState)
/// event.
///
/// An epic is organizational: it has a stable [`id`](Self::id) issues reference through their
/// [`epic_id`](GgBoardIssue::epic_id), a [`title`](Self::title), and a
/// [`description`](Self::description). It carries no status of its own — an epic's progress is
/// read from the status of the issues grouped under it.
///
/// The id is the epic's **prefix**: an epic is created from a 3–6 letter prefix, upper-cased, and
/// every issue filed under it is numbered from it (`AUTH-1`, `AUTH-2`, …).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgBoardEpic {
    /// The epic's stable id — its upper-cased 3–6 letter prefix, which is both the handle an
    /// issue's `epicId` references and the stem its issue ids are numbered from.
    pub id: String,
    /// The epic's short title.
    pub title: String,
    /// A longer description of what the epic covers.
    pub description: String,
}

/// One [issue](https://docs.testcabinet.ai/gg/project-management/) on the board — a node of the
/// blocked-by DAG reported in a [`BoardState`](GgTelemetryKind::BoardState) event.
///
/// An issue is the **heavyweight** counterpart to a [task](GgTaskEntry): rather than just a
/// title and description it carries structured sections — [`in_scope`](Self::in_scope),
/// [`out_of_scope`](Self::out_of_scope), and [`completion_criteria`](Self::completion_criteria)
/// — whose explicit scope boundaries and completion criteria are what make an issue **safe to
/// dispatch to a subagent** (Phase 4): they tell the subagent exactly what it is and is not
/// responsible for and how it will be judged done. Issues share the [tasks](GgTaskEntry)
/// blocked-by relation — a **DAG**, so gg rejects any edge that would introduce a cycle — and
/// an issue may be grouped under an [epic](GgBoardEpic) through its
/// [`epic_id`](Self::epic_id). The whole board is retained across a [compaction] boundary
/// verbatim, like the task list.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgBoardIssue {
    /// The issue's stable id — the handle the other board tools and every `blockedBy`
    /// reference use.
    ///
    /// gg assigns it: it is the [epic](GgBoardEpic)'s prefix and the next number under that prefix
    /// (`AUTH-1`, `AUTH-2`, …), so an id says at a glance which epic the work belongs to. An issue
    /// filed without an epic is numbered under `ISSUE`.
    pub id: String,
    /// The issue's short title.
    pub title: String,
    /// An optional longer overview of the issue (the structured scope fields carry the
    /// dispatch-relevant detail).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub description: Option<String>,
    /// What the issue **is** responsible for — the work in its scope.
    pub in_scope: String,
    /// What the issue is **not** responsible for — the explicit exclusions that bound a
    /// dispatched subagent's work.
    pub out_of_scope: String,
    /// How the issue will be judged **done** — the acceptance criteria the assigned agent
    /// is held to.
    pub completion_criteria: String,
    /// The issue's status.
    pub status: GgIssueStatus,
    /// The ids of the issues this issue is blocked by (must all be
    /// [`Done`](GgIssueStatus::Done) before this issue is actionable). The relation is acyclic
    /// across the whole board.
    pub blocked_by: Vec<String>,
    /// The id of the [epic](GgBoardEpic) this issue is grouped under, when any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub epic_id: Option<String>,
    /// The [agent profile](GgAgentConfig) the issue was **assigned to** when it was created —
    /// the profile gg dispatches it under, and re-dispatches for every retry and review round. It
    /// is named on `create_issue` (not configured on the capability), and must be one the creating
    /// agent lists with the [`implementer`](GgSubagentScope::Implementer) scope.
    pub agent: String,
    /// The [agent profiles](GgAgentConfig) named as this issue's **reviewers** when it was
    /// created, drawn from the creating agent's roster entries carrying the
    /// [`reviewer`](GgSubagentScope::Reviewer) scope. When non-empty, completing the issue moves it
    /// to [`InReview`](GgIssueStatus::InReview) and these profiles each review the work in turn;
    /// every one of them must approve before the issue is accepted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reviewers: Vec<String>,
    /// The id of the agent gg [dispatched](https://docs.testcabinet.ai/gg/project-management/)
    /// to implement this issue, when one is assigned (its status is then
    /// [`InProgress`](GgIssueStatus::InProgress)) — the link the console follows from the issue
    /// to that agent in the Agents explorer. `None` while the issue is
    /// [`Open`](GgIssueStatus::Open), and after a terminal state carries the last agent that
    /// worked it.
    ///
    /// The id is derived from the issue rather than minted from the run's counter: the *n*th agent
    /// dispatched to implement `AUTH-1` is `AUTH-1.0i`, `AUTH-1.1i`, … (`i` for implementer), so a
    /// retry or a post-review rework pass is legible as another attempt at the same issue. Its
    /// [reviewers](GgReviewer) are named under it in turn (`AUTH-1.0i.0r`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub assigned_agent_id: Option<String>,
    /// How many times gg has **re-dispatched** this issue after an assigned agent finished
    /// without completing it. Bounded by the capability's `maxRetries`; once exhausted the
    /// issue is marked [`Failed`](GgIssueStatus::Failed). `0` until the first retry.
    pub retries: u32,
}

/// The state of one model-curated [memory](https://docs.testcabinet.ai/gg/memories/) at a
/// point in a run — a band of a [`MemoryState`](GgTelemetryKind::MemoryState) event.
///
/// A memory is written by the model — with `write_memory` under the
/// [`scratchpad`](MEMORY_STRATEGY_SCRATCHPAD) strategy, `create_memory` under the other two
/// — and its [`description`](Self::description) is what the console (and, where a strategy
/// shows one, the model) sees the memory as at a glance. [`len`](Self::len) is the body's
/// length in characters — what the [caps](GgMemoryCaps) are measured against.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgMemoryEntry {
    /// The memory's stable name — the slug every memory tool addresses it by.
    pub name: String,
    /// The memory's one-line description. Empty when the strategy does not require one (a
    /// [`keyword-search`](MEMORY_STRATEGY_KEYWORD_SEARCH) memory may omit it).
    pub description: String,
    /// The memory body's length in characters (what the caps bound).
    pub len: u64,
    /// The memory body's length in **lines** — the second size the console reports, because
    /// characters alone do not distinguish a dense paragraph from a long checklist.
    pub lines: u64,
}

/// What one [`MemoryRevision`](GgTelemetryKind::MemoryRevision) event records — the mutation
/// that produced this revision of a [memory](https://docs.testcabinet.ai/gg/memories/).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgMemoryChange {
    /// The memory was created (`write_memory` / `create_memory`).
    Written,
    /// The memory was revised (`update_memory` / `edit_memory`).
    Updated,
    /// The memory was removed (`delete_memory`).
    Deleted,
}

/// The high-water marks a run's [memories](https://docs.testcabinet.ai/gg/memories/) reached
/// — a band of every [`MemoryState`](GgTelemetryKind::MemoryState) event.
///
/// The live figures on a `MemoryState` say what the model holds *now*; a run that curates
/// aggressively can spend most of its length budget and end near empty, and the current
/// figures alone would read as a run that barely used memory at all. The peaks are what a
/// study of how much memory a strategy actually consumed is measured against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgMemoryPeak {
    /// The most memories held at once.
    pub count: u64,
    /// The largest total body length, in characters, ever held at once.
    pub total_len: u64,
    /// The largest total body length, in lines, ever held at once.
    pub total_lines: u64,
}

/// The pinned state a [compaction] carried across the boundary verbatim — the counts
/// that *survived* summarization — reported on a
/// [`Compaction`](GgTelemetryKind::Compaction) event so the console can prove the
/// retention contract held (the read skills, the task list, and the in-play memories are
/// not summarized away).
///
/// Each figure is a **count of retained items**, not a token figure: how many read
/// [skills](GgContextSource::Skill), how many [tasks](GgContextSource::TaskList), how many
/// in-play [memories](GgContextSource::Memory), and how many
/// [issues](https://docs.testcabinet.ai/gg/project-management/) on the
/// [board](GgContextSource::Board) remained pinned after the ephemeral history was replaced by
/// the summary. The epic/issue board is retained across the boundary just like the task list,
/// so its issue count is reported here as part of the retention proof.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgRetainedState {
    /// The number of read skills whose bodies were carried across the boundary verbatim.
    pub skills: u64,
    /// The number of tasks in the retained task list.
    pub tasks: u64,
    /// The number of in-play memories carried across the boundary verbatim.
    pub memories: u64,
    /// The number of issues on the retained epic/issue board.
    pub issues: u64,
}

/// The kind of agent-managed-context action a [`ContextManaged`](GgTelemetryKind::ContextManaged)
/// event reports — the model-facing window management that is the complement to
/// [compaction](CAPABILITY_COMPACTION).
///
/// The [agent-managed context](https://docs.testcabinet.ai/gg/agent-managed-context/)
/// capability lets a disciplined agent reclaim window space itself rather than waiting for
/// the automatic backstop: it can [evict file views](Self::EvictFileViews) it no longer
/// needs (safe — it can re-read the file later), [close text views](Self::CloseTextViews)
/// it composed and no longer wants in front of it, [close documentation
/// views](Self::CloseDocsViews) it has finished with, [close the results of its last
/// documentation search](Self::CloseSearchViews), or [archive a section of its
/// thread](Self::ArchiveThread) (removed from the live window but kept **searchable** via
/// `search_archive`). All five reclaim tokens; a `search_archive` call reclaims nothing and
/// so is reported only as an ordinary tool result, not as a `ContextManaged` action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgContextAction {
    /// The agent evicted one or more [file views](GgContextSource::FileView) (the results of
    /// `read_file`) from the live window, reclaiming their tokens. The file is unchanged on
    /// disk and can be re-read.
    EvictFileViews,
    /// The agent closed one or more [text views](GgContextSource::TextView) — material it
    /// had composed and opened by label — from the live window, reclaiming their tokens.
    ///
    /// Distinct from [`EvictFileViews`](Self::EvictFileViews) because the two are not the
    /// same trade: an evicted file view is recoverable by re-reading the path, whereas a
    /// closed text view held the agent's only copy of something it computed, so closing one
    /// discards it unless the agent wrote it down. A close request naming a workspace path
    /// is reported as `EvictFileViews`; one naming a view label is reported here.
    CloseTextViews,
    /// The agent closed one or more [documentation views](GgContextSource::DocsView), reclaiming
    /// their tokens — the whole of what [`docview-close`](CAPABILITY_DOCVIEW_CLOSE) buys.
    ///
    /// Its own action rather than a [`CloseTextViews`](Self::CloseTextViews) because the two differ
    /// in what closing costs: a docs view is re-openable by name at any time, like a file view,
    /// whereas a closed text view is gone.
    ///
    /// It is also the **only** action that can invalidate a cached prompt prefix, since the
    /// documentation band is otherwise append-only — which is why the event carries the index of the
    /// earliest item it removed beside the tokens it reclaimed. Reclaiming three hundred tokens from
    /// the head of a forty-thousand-token window is not the same trade as reclaiming them from its
    /// tail, and without the position the two are indistinguishable in the record.
    CloseDocsViews,
    /// The agent closed its [documentation search results](GgContextSource::SearchResults),
    /// reclaiming their tokens.
    ///
    /// Its own action for the reason the band is its own: what discovery costs a window is a thing
    /// this design exists to measure, and a close reported as a text view's would put a search's
    /// cost back into a total that already has three other contributors. Unlike a documentation
    /// view, nothing is lost by closing one — the same query answers the same way — so it carries no
    /// position: the band is superseded on every search regardless, and a cached prefix has already
    /// been rewritten from there by the second search of the session.
    CloseSearchViews,
    /// The agent archived a section of its [thread](GgContextSource::History) — the oldest
    /// ephemeral turns — removing it from the live window while keeping it searchable and
    /// recoverable through `search_archive`.
    ArchiveThread,
}

/// One entry of the thread [archive](CAPABILITY_AGENT_MANAGED_CONTEXT) — a band of an
/// [`ArchiveState`](GgTelemetryKind::ArchiveState) snapshot.
///
/// It carries **metadata and a bounded preview, never the full text**. The archive exists
/// precisely so that material is out of the request; re-streaming it into the record would put a
/// second copy of the whole thread on disk for no reader's benefit, and the searchable body stays
/// recoverable by the agent through `search_archive`, which is whose question it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgArchiveEntry {
    /// The monotonic ordinal assigned when the item was archived — the handle a model has on where
    /// it sat in its thread, and stable across a fork (an archive's ordinal counter is carried,
    /// never restarted).
    pub seq: u64,
    /// The context band the item occupied in the live window.
    pub source: GgContextSource,
    /// The conversational role the archived message had (`system` / `user` / `assistant` / `tool`).
    pub role: String,
    /// The item's length, in characters, of searchable text.
    pub len: u64,
    /// The first couple of hundred characters of that text, so a reader can tell entries apart
    /// without the record carrying the thread twice.
    pub preview: String,
}

/// The lifecycle status of an agent in the [subagent tree](https://docs.testcabinet.ai/gg/subagents/),
/// reported by an [`AgentStatus`](GgTelemetryKind::AgentStatus) transition so the console can
/// colour each node of the live tree (running vs waiting) and mark it done or failed.
///
/// An agent is [`Running`](Self::Running) while it drives its turn loop, [`Blocked`](Self::Blocked)
/// while it has **freed its running slot to wait on its subagents** (the scheduler's
/// blocked-frees-slot state — distinct from merely queuing for a slot), and terminally either
/// [`Done`](Self::Done) (its loop ended normally) or [`Failed`](Self::Failed) (its loop ended in a
/// model error). Like [`AgentSpawned`](GgTelemetryKind::AgentSpawned), the agent's identity rides
/// on the event's own [`agent_id`](GgTelemetryEvent::agent_id), so the payload carries only the
/// status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgAgentStatus {
    /// The agent is actively driving its turn loop (holds a running slot).
    Running,
    /// The agent has freed its running slot and is waiting on one or more of its subagents to
    /// return (the scheduler's blocked-with-a-wait-condition state).
    Blocked,
    /// The agent's turn loop ended normally (completed, exhausted, or timed out).
    Done,
    /// The agent's turn loop ended in a model error.
    Failed,
}

/// How one agent instance came to be replaced by (or cloned into) another — the discriminator on an
/// [`AgentTransition`](GgTelemetryKind::AgentTransition) event.
///
/// All three are the *same* operation over [modules](GgModuleKind) — carry these, drop those,
/// initialize the rest — differing only in who chose the successor and what it does to the
/// predecessor. Naming them apart is what lets the console show a succession as a lineage rather
/// than as N unrelated agents that happened to appear in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgAgentTransitionKind {
    /// The agent replaced itself with another profile, carrying every module both profiles have.
    Exec,
    /// The agent cloned itself into a child that continues from its conversation.
    Fork,
    /// An [FSM](CAPABILITY_FSM) moved into another state, carrying exactly the modules that
    /// [transition](GgFsmTransition::transfer) declares.
    Fsm,
}

/// The phase of an [issue review](https://docs.testcabinet.ai/gg/project-management/) an
/// [`IssueReview`](GgTelemetryKind::IssueReview) event reports — the
/// requested → (changes_requested)* → approved lifecycle that gates an
/// [issue](GgBoardIssue)'s acceptance.
///
/// A review is [requested](Self::Requested) when the issue's assigned agent marks it complete (gg
/// runs the issue's [reviewers](GgBoardIssue::reviewers) against the diff rather than accepting
/// immediately). A reviewer then either [requests changes](Self::ChangesRequested) — carrying the
/// actionable items the issue's own assigned agent is re-invoked to address, after which the work is
/// re-reviewed — or [approves](Self::Approved). Once **every** reviewer approves, the issue is
/// finally accepted (marked done) and its worktree merged. Because there is **no cycle limit**, a
/// single issue may emit many [`ChangesRequested`](Self::ChangesRequested) phases before an
/// [`Approved`](Self::Approved) (or none, on a clean first pass).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgIssueReviewPhase {
    /// A review round was triggered (the assigned agent marked the issue complete): the issue's
    /// reviewers run against the diff instead of the issue being accepted immediately.
    Requested,
    /// A reviewer returned actionable items: the work is not yet done. gg re-invokes the issue's
    /// assigned agent with the original brief plus these items, then re-reviews. The items ride on
    /// the event's [`items`](GgTelemetryKind::IssueReview) field.
    ChangesRequested,
    /// Every reviewer approved the work: the issue is accepted, merged, and marked done. This is
    /// the only terminal phase that accepts the issue.
    Approved,
}

/// One reviewer that reported a verdict on an [issue review](GgTelemetryKind::IssueReview) — the
/// agent gg dispatched, and the profile it ran under.
///
/// Both halves are carried because they answer different questions. The
/// [`agent_id`](Self::agent_id) is the reviewer *instance* — derived from the issue and the
/// implementer whose work it reviewed (`AUTH-1.0i.0r`), so it names the exact review pass and links
/// to that agent's own timeline — while the [`profile`](Self::profile) is the
/// [reviewer profile](GgBoardIssue::reviewers) the issue named, which is what says *what kind* of
/// review it was.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReviewer {
    /// The id of the agent that conducted this review — the handle its own
    /// [`AgentSpawned`](GgTelemetryKind::AgentSpawned)/[`AgentReturned`](GgTelemetryKind::AgentReturned)
    /// events carry.
    pub agent_id: String,
    /// The [agent profile](GgBoardIssue::reviewers) the reviewer ran under.
    pub profile: String,
}

/// One [response-healing](https://docs.testcabinet.ai/gg/response-healing/) strategy — a named,
/// independently toggleable repair gg may apply to a model's response before running it.
///
/// The wire values are the strategy ids, spelled exactly as the
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's `healing` param keys are
/// (`{"healing": {"strip-fences": false}}`), because the id is one thing: a config key, a metric
/// name, and a telemetry value. Kebab-case rather than this module's usual snake_case for exactly
/// that reason.
///
/// Every application is disclosed to the model in its turn feedback — a repair the model is never
/// told about teaches it nothing and corrupts the very question a run of this shape asks, which is
/// whether models learn the contract.
///
/// Two of the three are armed unless a configuration turns them off, because for those, repairing
/// is strictly safer than not: the reply they delete from could not have run as sent. The exception
/// is [`drop-doubled-response`](Self::DropDoubledResponse), which is **off** unless a configuration
/// arms it — see its own documentation for why that asymmetry exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgHealingStrategy {
    /// A Markdown code fence wrapping the program was removed — tagged or not, closed properly,
    /// closed with prose glued onto the closing line (which CommonMark does not accept as a close,
    /// so the prose would otherwise be swallowed into the program), or never closed at all. The
    /// count that answers "how often did this model still wrap its program in a fence after being
    /// told not to?".
    StripFences,
    /// Explanatory lines were removed from before and/or after the program body.
    StripProse,
    /// The whole reply was one completion concatenated with a byte-identical copy of itself, and the
    /// trailing copy was deleted. The shape a provider produces when it emits (or a proxy records)
    /// the same completion twice: the reply's text is exactly `X + X`, with no fence, no blank line
    /// and no declaration to separate the halves.
    ///
    /// It is the one strategy that is **off unless a configuration arms it**: the half it deletes
    /// is valid code under any reading other than "the transport duplicated this", so unlike the
    /// other repairs here, applying it to a model that genuinely meant to do the work twice changes
    /// behaviour rather than restoring it. An operator arms it for the models observed to exhibit
    /// the defect.
    DropDoubledResponse,
}

/// The language a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) program is written in — the
/// axis a cross-language study compares its arms on.
///
/// Each language ships a hand-written, idiomatic SDK that binds the same typed WIT surface, so what
/// differs between two arms of a study is the *spelling* of a call, never which calls exist. Which
/// language an agent writes in is therefore a configuration knob like every other lever the harness
/// measures, rather than a property of gg.
///
/// A language usually brings its own guest component, and one that does not says so in its own
/// documentation: [`JavaScript`](Self::JavaScript) is evaluated by
/// [`TypeScript`](Self::TypeScript)'s, because the two arms are one syntax and differ only in
/// whether the program is checked before it runs.
///
/// The wire values are the language ids, spelled exactly as the
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's `language` param is written
/// (`{"language": "typescript"}`), because the id is one thing: a config key, a telemetry value,
/// and the stem of the language's committed guest artifacts. Lower-case rather than this module's
/// usual camelCase for exactly that reason — camelCase of `TypeScript` is `typeScript`, which is
/// not a spelling anybody would put in a configuration file. [`GgHealingStrategy`] departs from the
/// module default on the same grounds.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize,
)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgProgramLanguage {
    /// TypeScript: **type-checked** with the committed `tsc`, then type-stripped to JavaScript and
    /// evaluated in the committed `componentize-js` guest. The default.
    #[default]
    TypeScript,
    /// JavaScript: the same guest, the same SDK and the same signatures — with **no type check**.
    ///
    /// It is [`TypeScript`](Self::TypeScript)'s arm with one thing removed, and the removal is the
    /// whole point of it: a program is stripped and evaluated exactly as it was before gg carried a
    /// compiler, so an A/B across the two measures *what checking a program before it runs is
    /// worth* and nothing else. Its catalogue keeps its type annotations for that reason — a model
    /// on this arm reads the same typed signatures and may annotate its own program, which is
    /// erased along with the rest of the types — so the arms do not also differ in how much the
    /// model was told about the surface.
    JavaScript,
    /// Python: evaluated by a **committed CPython**, with no compiler anywhere on the turn path.
    ///
    /// The first arm whose guest carries its own interpreter rather than an engine gg lowers to.
    /// `componentize-py` links a real CPython 3.14 against gg's WIT world, so a program crosses the
    /// membrane as *source*, the standard library it is baked with is what a program may `import`,
    /// and nothing is installed in the run container. Its SDK is hand-written and reads as Python
    /// reads — `snake_case`, keyword arguments with real defaults, dataclasses for results, enums
    /// for fixed choices, and a raised `ToolError` for the wire's error arm.
    Python,
    /// Ruby: **compiled to JavaScript on the host by Opal**, and evaluated by a guest that carries
    /// Opal's runtime, gg's Ruby SDK and the libraries a program may `require`, all pre-initialised
    /// into it.
    ///
    /// The first arm whose program is neither evaluated as written nor lowered by a parse gg carries
    /// in-process: a real compiler runs in a real process on the turn path, so this arm reports a
    /// compile time and can tell a model *the compiler read your program and refused it* — which is
    /// the band [`Python`](Self::Python) has no producer for. The compiler is itself Ruby compiled to
    /// JavaScript, so it rides inside gg's binary and the run image gains nothing. Its SDK is
    /// hand-written and reads as Ruby reads — `snake_case`, keyword arguments, blocks for a long
    /// body, `Range` for a span, splats for a list, `?` on a predicate, Symbols for a fixed choice,
    /// and a raised `ToolError` that is a `StandardError`.
    Ruby,
    /// PureScript: **compiled to JavaScript on the host by `purs`**, flattened into one script by
    /// `esbuild`, and evaluated by the same ECMAScript guest
    /// [`TypeScript`](Self::TypeScript) uses.
    ///
    /// The first arm whose compiler is a **binary in the run image** rather than something gg
    /// carries — `purs` is a ~100 MB statically linked Haskell executable — and the first whose
    /// committed artifact is not a compiler but the compiled library set that compiler cannot work
    /// without, gg's own SDK compiled into it. It is checked in the strongest sense any arm is:
    /// a real type system reads the whole program, so a call written with the wrong argument shape
    /// costs a diagnostic rather than a turn. Its SDK is hand-written and reads as PureScript
    /// reads — curried functions, an API object as a record of functions, optional arguments as a
    /// row-checked record, `Maybe`/`Either` where a PureScript author expects them, `data` types
    /// for fixed choices, and a thrown failure caught with `attempt`.
    PureScript,
    /// Java: **compiled to bytecode by `javac` and then to JavaScript by TeaVM**, both inside a
    /// **warm JVM** gg keeps between preparations, and evaluated by the same ECMAScript guest
    /// [`TypeScript`](Self::TypeScript) uses.
    ///
    /// The first arm whose compiler gg cannot afford to *start* per program — a cold build costs
    /// 4–9 s against 0.33–0.56 s in a JVM that has already done one — so it is the first served by
    /// a pool of long-lived compiler processes rather than by a process per compile. It is also the
    /// only arm whose program passes through **two** compilers, which is why a diagnostic here can
    /// be `javac`'s (a type error, a name that does not resolve) or TeaVM's (a class of the
    /// standard library its classlib does not carry) — two bands of the one recoverable,
    /// model-facing error. Its SDK is hand-written and reads as Java reads: `camelCase`,
    /// **overloads** where every other arm has a default argument or a keyword, varargs for a list,
    /// builders for a bag of optional fields, records for every result, enums for every fixed
    /// choice, a sealed interface narrowed by a `switch`, `Optional` for what the wire may omit,
    /// and an unchecked `ToolError`.
    Java,
    /// Kotlin: **compiled as a script** to bytecode by the Kotlin compiler and then to JavaScript by
    /// TeaVM, both inside a **warm JVM** gg keeps between preparations, and evaluated by the same
    /// ECMAScript guest [`TypeScript`](Self::TypeScript) uses.
    ///
    /// It rides [`Java`](Self::Java)'s road from bytecode onwards and diverges in front of it. A
    /// program here is a **Kotlin script** rather than the body of a function gg declares, because
    /// this language refuses `object`, `interface`, `enum class`, `typealias` and `private fun` as
    /// *local* declarations — so a reply with no `import` in it is compiled **byte for byte as the
    /// model wrote it**, which no other compiled arm can say. Its SDK is hand-written and reads as
    /// Kotlin reads, which is deliberately nothing like Java's given that the two share a compiler,
    /// a guest and a classlib: **default arguments passed by name** where Java has fourteen overload
    /// groups and this arm has none, more default arguments where Java has a builder, `data class`es
    /// for results, `enum class`es for fixed choices, sealed types for a closed set and for a
    /// three-way patch, an `IntRange` for a span of turns, nullable types for what the wire may
    /// omit, and a `ToolError` caught with `catch` or `runCatching`. And it is declared in the
    /// **root package**, so a program reaches the whole surface with no `import` at all.
    Kotlin,
    /// Rust: **compiled by `rustc` into the wasm component that turn is evaluated by** — the first
    /// arm whose artifact is the program.
    ///
    /// Every language before it evaluates a *string*: its committed component carries a whole
    /// runtime (a CPython, an Opal, a JavaScript engine) and a program crosses the membrane as
    /// source that runtime reads. `rustc` produces no such thing — it produces the program — so this
    /// arm commits **no component at all** and compiles one per turn instead, against a prebuilt
    /// library set that ships inside gg's binary. It is also the only arm with **no exception
    /// mechanism in the guest**: `wasm32-unknown-unknown` has no unwinder, so a panic aborts and
    /// traps, and what saves the error surface is a panic *hook* that reports through the host with
    /// the model's own line and column before the abort.
    ///
    /// A **code module** here is linked into the same artifact as the program that reads it, which
    /// is why the seam hands the modules in scope to a program's preparation at all: nothing can be
    /// bound at `lib::<key>` after the compile. Its SDK is hand-written and reads as Rust reads:
    /// `snake_case`, an API object as a **module** so a call is a path, `Result<_, ToolError>`
    /// everywhere so `?` composes gg's calls with `std`'s own fallible ones, a struct with `Default`
    /// and functional update where a call has two or more optional arguments and a bare `Option<T>`
    /// where it has one, real `enum`s for fixed choices, a `RangeInclusive` for a span of turns, and
    /// one glob (`use gg::prelude::*;`) that a program's own `use` may shadow.
    Rust,
    /// Swift: **compiled by `swiftc` into the wasm component that turn is evaluated by**, and the
    /// one arm whose reply is compiled **byte for byte** while still admitting declarations.
    ///
    /// It is [`Rust`](Self::Rust)'s shape — no committed component, one artifact per turn — reached
    /// by a different road. A program here is a whole **top-level file** rather than the body of a
    /// function gg declares, because Swift refuses `extension`, `protocol` and `import` inside one,
    /// and an arm that forbade `extension` would forbid the construct the language is built around.
    /// So nothing is prepended, nothing appended and no line moves: a diagnostic at line 7 is line
    /// 7. gg's shell is a second file of the same module, which is how it names the entry point
    /// Swift lowers top-level code into. The SDK is a Swift module of its own, reached by the
    /// `import gg` the program writes on its own first line; the shell's imports are file-scoped
    /// and reach nothing the model wrote.
    ///
    /// It is also the arm with the **most expensive instantiate and the cheapest compile of its
    /// shape**: `swiftc` takes about a third of a second and the ~7 MB component it produces takes
    /// about four times that to instantiate, which is the reverse of every other language here. Its
    /// SDK is hand-written and reads as Swift reads: `camelCase`, **argument labels** carrying the
    /// roles a name does not, default parameter values rather than an options record, optionals for
    /// what the wire may omit, `enum`s with associated values for a closed set and for a three-way
    /// patch, a `ClosedRange` for a span of turns, and `throws` for the error arm so `try` is the
    /// whole of the ceremony.
    Swift,
    /// C++: **compiled by `clang++` into the wasm component that turn is evaluated by**, against a
    /// prelude gg precompiles once per machine — and the only arm with a working **exception**
    /// mechanism in the guest.
    ///
    /// It is [`Rust`](Self::Rust)'s and [`Swift`](Self::Swift)'s shape — no committed component,
    /// one artifact per turn — and, like Swift's, the reply is compiled **byte for byte**. A
    /// program here is an ordinary translation unit that defines `main`, because C++ refuses a
    /// `template`, a `namespace` and a usable `#include` inside a function body; the price is this
    /// arm's one refusal, which is a reply that defines no entry point. It is refused by name at
    /// prepare time, because wasi-libc references `main` weakly and would otherwise link a program
    /// that traps having run nothing.
    ///
    /// It is the **cheapest compile of the three compiled arms** — ~90 ms against `swiftc`'s ~0.3 s
    /// — and only because the prelude, which is the C++ standard library, is precompiled: without
    /// that the same program costs about a second. gg's own surface is deliberately not in that
    /// prelude, so a program reaches it by writing `#include <gg/files.hpp>` for each module it
    /// calls. Its SDK is hand-written and reads like the standard library it arrives beside:
    /// `snake_case` functions *and* types, an API object as a **namespace** so a call is a
    /// qualified name, `enum class` for a fixed choice, aggregates for records, `std::variant`
    /// narrowed with `std::get_if` for a read, a default argument for one optional part and a
    /// **designated initialiser** (`{.limit = 40}`) for several — because C++ has no keyword
    /// arguments and a defaulted parameter cannot be skipped over — and a thrown
    /// `gg::core::tool_error` for the error arm.
    ///
    /// It also carries a **comparability risk no other arm has**, stated rather than hidden: an
    /// uncaught `throw` and a failed libc++ hardening check both arrive with words, but undefined
    /// behaviour arrives as a bare trap, so a failure caused by the language can be hard to tell in
    /// the run record from a model that reasoned badly.
    Cpp,
    /// C#: **compiled by Roslyn into an IL assembly on the host**, which a committed guest holding
    /// Mono's IL interpreter and the whole .NET class library loads — the one arm that is neither
    /// of this seam's two shapes.
    ///
    /// An interpreted arm sends **source** to a committed runtime; a compiled arm sends a
    /// **component** and commits nothing. This sends neither: `csc` turns the model's reply into an
    /// assembly in ~0.3 s, the bytes cross as base64 over the `program` string every arm already
    /// has, and the committed component registers and loads them in memory. So it has an
    /// interpreted arm's artifact — one guest, compiled once per process — and a compiled arm's
    /// failure bands, and it is the reason C# is affordable at all: priced on
    /// `componentize-dotnet`, which compiles the *program* to native wasm, this arm measured 25–43
    /// seconds a turn.
    ///
    /// A program is the reply **verbatim**, as a compilation unit with an entry point — no wrapper,
    /// no prologue, no offset to subtract — and all four ways a C# program may begin work, top-level
    /// statements first. Its SDK is compiled beside the program, which tells `csc` the library
    /// exists and puts no name in scope: a program writes `Gg.Views.OpenText` in full, or writes
    /// the `using Gg;` its catalogue states and then `Views.OpenText`. The SDK is hand-written and
    /// reads as C# reads: `PascalCase` methods, **optional arguments with defaults, passed by name**, nullable
    /// reference types, `record`s for results, real `enum`s for fixed choices, and a thrown
    /// `ToolException` whose `Code` is an enum rather than free text. Nothing returns `Task` and
    /// nothing is `async`.
    ///
    /// It has the **best error surface of any compiled arm here**: `try`/`catch`/`finally` work
    /// because they are IL, and an unhandled exception is reported as `Exception.ToString()` — the
    /// type, the message *and* the managed frames, each frame carrying the model's own file and
    /// line, because the assembly carries its own portable debug information and the guest
    /// initialises the lookup that reads it. What a program ends by **returning** is read too: a
    /// non-zero status from its entry point, the one failure C# reports without throwing. Two
    /// absences are
    /// stated rather than glossed: `System.Net.Http`'s native handler is not in this guest, so the
    /// types compile and the transport is gone (the network is `system.Shell`, as on every arm), and
    /// `System.Security.Cryptography` is Mono's own gap and arrives as a catchable
    /// `PlatformNotSupportedException`.
    CSharp,
}

impl GgProgramLanguage {
    /// Every language, in registration order — the list a study's arms are drawn from, and the list
    /// gg's own language registry is derived from, so the two can never disagree.
    ///
    /// Hand-written, and **checked**: [`ordinal`](Self::ordinal) is an exhaustive `match`, so a new
    /// variant does not compile until it is given a position here, and each arm's position is
    /// verified against this list *at compile time* by the `const` block inside it. A variant added
    /// to the enum and forgotten here is therefore a build failure rather than a language that
    /// silently vanishes from [`from_id`](Self::from_id), from gg's registry, and from every gate
    /// that iterates them.
    pub const ALL: &'static [GgProgramLanguage] = &[
        Self::TypeScript,
        Self::JavaScript,
        Self::Python,
        Self::Ruby,
        Self::PureScript,
        Self::Java,
        Self::Kotlin,
        Self::Rust,
        Self::Swift,
        Self::Cpp,
        Self::CSharp,
    ];

    /// How many languages there are: the length of [`ALL`](Self::ALL), and the size of every
    /// per-language table gg indexes by [`ordinal`](Self::ordinal).
    pub const COUNT: usize = Self::ALL.len();

    /// `self`'s position in [`ALL`](Self::ALL) — the index of its slot in any per-language table.
    ///
    /// This is the forcing function behind [`ALL`](Self::ALL). The `match` is exhaustive, so a new
    /// variant does not compile until it has an arm; and each arm's answer is checked against
    /// [`ALL`](Self::ALL) in a `const` block, so an arm whose position is wrong — or whose variant
    /// was never added to the list — fails to build rather than indexing past the end of a table at
    /// run time.
    pub const fn ordinal(self) -> usize {
        match self {
            Self::TypeScript => const { Self::listed_at(0, Self::TypeScript) },
            Self::JavaScript => const { Self::listed_at(1, Self::JavaScript) },
            Self::Python => const { Self::listed_at(2, Self::Python) },
            Self::Ruby => const { Self::listed_at(3, Self::Ruby) },
            Self::PureScript => const { Self::listed_at(4, Self::PureScript) },
            Self::Java => const { Self::listed_at(5, Self::Java) },
            Self::Kotlin => const { Self::listed_at(6, Self::Kotlin) },
            Self::Rust => const { Self::listed_at(7, Self::Rust) },
            Self::Swift => const { Self::listed_at(8, Self::Swift) },
            Self::Cpp => const { Self::listed_at(9, Self::Cpp) },
            Self::CSharp => const { Self::listed_at(10, Self::CSharp) },
        }
    }

    /// `ordinal`, having checked that [`ALL`](Self::ALL) really holds `expected` there.
    ///
    /// Called only from `const` blocks in [`ordinal`](Self::ordinal), which is what turns "the list
    /// and the enum agree" from a comment into a build error. Compares discriminants because a
    /// `const fn` cannot call [`PartialEq`] on stable.
    const fn listed_at(ordinal: usize, expected: Self) -> usize {
        assert!(
            ordinal < Self::COUNT,
            "a GgProgramLanguage variant claims a position past the end of GgProgramLanguage::ALL"
        );
        assert!(
            Self::ALL[ordinal] as u8 == expected as u8,
            "a GgProgramLanguage variant is missing from GgProgramLanguage::ALL, or is listed at a \
             different position than its `ordinal` arm claims"
        );
        ordinal
    }

    /// The stable id: the capability param's value, the telemetry value, and the stem of the
    /// language's committed guest artifacts.
    pub const fn id(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::JavaScript => "javascript",
            Self::Python => "python",
            Self::Ruby => "ruby",
            Self::PureScript => "purescript",
            Self::Java => "java",
            Self::Kotlin => "kotlin",
            Self::Rust => "rust",
            Self::Swift => "swift",
            Self::Cpp => "cpp",
            Self::CSharp => "csharp",
        }
    }

    /// The language an [id](Self::id) names, or `None` for a spelling gg does not know.
    ///
    /// Written against [`ALL`](Self::ALL) rather than as a second `match`, so a language cannot be
    /// added to one direction and forgotten in the other.
    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL
            .iter()
            .copied()
            .find(|language| language.id() == id)
    }

    /// This language's name as a **human** reads it — what an operator sees in a launch warning or
    /// a console label. What a model is shown is its own prompt, written in this language's syntax.
    pub const fn display_name(self) -> &'static str {
        match self {
            Self::TypeScript => "TypeScript",
            Self::JavaScript => "JavaScript",
            Self::Python => "Python",
            Self::Ruby => "Ruby",
            Self::PureScript => "PureScript",
            Self::Java => "Java",
            Self::Kotlin => "Kotlin",
            Self::Rust => "Rust",
            Self::Swift => "Swift",
            Self::Cpp => "C++",
            Self::CSharp => "C#",
        }
    }
}

/// The other half of the [`ALL`](GgProgramLanguage::ALL) check: every entry sits at the position its
/// own [`ordinal`](GgProgramLanguage::ordinal) claims.
///
/// [`ordinal`](GgProgramLanguage::ordinal)'s own `const` blocks prove *variant → list*; this proves
/// *list → variant*, so a list with a duplicate, a gap or a mis-ordered entry does not build either.
const _: () = {
    let mut index = 0;
    while index < GgProgramLanguage::COUNT {
        assert!(
            GgProgramLanguage::ALL[index].ordinal() == index,
            "GgProgramLanguage::ALL lists a language somewhere other than at its own ordinal"
        );
        index += 1;
    }
};

impl std::fmt::Display for GgProgramLanguage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.id())
    }
}

/// What gg had to do to a model's response before it could run it — the healing record of one
/// code-shaped turn.
///
/// Healing is textual and conservative: it only ever **deletes**, so a healed program is always a
/// subsequence of the response the model sent. The model is told nothing about a repair; this
/// record and the run's operator stream are where every repair is disclosed.
///
/// A response that needed nothing carries the default and is omitted from the wire entirely, so
/// the presence of this object *is* "something was unusual about this response".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgResponseHealing {
    /// Each strategy application, in the order applied — a strategy may appear more than once (two
    /// nested fences are two applications), which is what makes this a count rather than a flag.
    /// Empty for a clean response.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub strategies: Vec<GgHealingStrategy>,
    /// Whether the healing pipeline failed to reach a fixpoint, so every repair was discarded and
    /// the response ran exactly as sent.
    ///
    /// Carried so that the one response pathological enough to defeat the pipeline is
    /// distinguishable from a clean one, which is otherwise byte-identical on the wire.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub did_not_converge: bool,
    /// The reply **as the model sent it**, carried whenever healing rewrote it into something else.
    ///
    /// The program that ran is what the model's own history carries and what every reported line
    /// number counts lines of, so this is the only surviving copy of the text healing started from
    /// — and reading the two against each other is what tells a defect in healing apart from a
    /// mistake by the model. It is for the run's operator; no model is ever shown it.
    ///
    /// Absent for a clean response, where the reply and the program are the same string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub original: Option<String>,
}

impl GgResponseHealing {
    /// Whether this response needed nothing at all — the `skip_serializing_if` predicate on
    /// [`CodeExecution`](GgTelemetryKind::CodeExecution), so a clean turn's event carries no
    /// `healing` key.
    ///
    /// Written against [`Default`] rather than field by field so a fact added later cannot be
    /// forgotten here and quietly report an unusual response as an ordinary one.
    pub fn is_clean(&self) -> bool {
        *self == Self::default()
    }
}

/// The run's [response-healing](GgResponseHealing) rollup: how much of what the models sent had to
/// be repaired before it could run, and which repairs did the work.
///
/// The denominator for every rate here is [`code_executions`](GgSessionSummary::code_executions),
/// which is one per code-shaped turn — the same event these counters are folded from, so numerator
/// and denominator can never come from different mechanisms and drift. Every counter is `0`, and
/// [`enabled`](Self::enabled) empty, for a tool-calling run, because healing never runs there.
///
/// Read the per-strategy counts as **what gg's pipeline did**, not as what the model wrote: the
/// pipeline applies its strategies in a fixed order to a fixpoint, so which strategy gets the
/// credit for a response that several could have repaired is a property of that order.
///
/// # What this rollup deliberately does not count
///
/// A reply that defeated the pipeline entirely — one whose repairs never reached a fixpoint, so
/// every repair was discarded and the reply was compiled exactly as sent — contributes only to the
/// denominator here, exactly as a clean reply does. That fact lives on the turn's own
/// [`GgResponseHealing::did_not_converge`] rather than being totted up per run, because it is a
/// diagnosis of one pathological response rather than a rate a study slices on. It is stated here,
/// and on the docs page, so the gap is known rather than inferred from a rollup that looks
/// complete.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgHealingSummary {
    /// Responses that had to be repaired for the program to run.
    pub healed: u64,
    /// Total strategy applications; at least [`healed`](Self::healed), since one response may need
    /// several repairs.
    pub applications: u64,
    /// Applications of [`strip-fences`](GgHealingStrategy::StripFences) — the count that answers
    /// "how often did this model still wrap its program in a code fence after being told not to?".
    pub strip_fences: u64,
    /// Applications of [`strip-prose`](GgHealingStrategy::StripProse).
    pub strip_prose: u64,
    /// Applications of [`drop-doubled-response`](GgHealingStrategy::DropDoubledResponse) — how often
    /// a reply arrived as a byte-exact doubling of itself.
    ///
    /// Zero for every run that did not **arm** the strategy, which is the default; read it together
    /// with [`enabled`](Self::enabled) rather than as "this model never doubled a reply".
    pub drop_doubled_response: u64,
    /// The [strategies](GgHealingStrategy) that were **armed** for this run, in the order gg
    /// applies them — the resolved configuration, recorded rather than left to be re-derived from
    /// the capability set.
    ///
    /// This is what makes the configuration legible from the telemetry alone. Every counter above
    /// is a measurement of what fired, and a run in which nothing fired is byte-identical whether
    /// its strategies were all armed or all disabled — so without this field a run with healing off
    /// and a run with healing on are indistinguishable in the data, and comparing the two means
    /// going back to the invocation files that produced them.
    ///
    /// Empty means every strategy was disabled **for a responses-as-code run**, and means nothing
    /// at all for a tool-calling one, where healing never runs;
    /// [`execution_mode`](GgSessionSummary::execution_mode) is what tells those two apart.
    ///
    /// Serialized **always, empty list and all** — deliberately no `skip_serializing_if`. The empty
    /// list is the one value this field exists to publish, so a key that vanished exactly when it
    /// meant "every strategy was off" would leave the healing-off arm byte-identical on the wire to
    /// a build with no such field, reopening one level down the very hole described above.
    pub enabled: Vec<GgHealingStrategy>,
}

/// The run's **error rollup**: how many of its turns failed, how badly they clustered, and how.
///
/// Folded from the [`TurnOutcome`](GgTelemetryKind::TurnOutcome) events the run emitted — one per
/// turn, on every agent — so [`turns`](Self::turns) is both this rollup's denominator and a count
/// of the model calls the run actually made. Numerator and denominator come from the same event and
/// therefore cannot drift.
///
/// This exists because gg already *judges* every turn, the same judgement the
/// [error ceilings](GgRunLimits) are enforced on. Without the rollup a run that failed a third of
/// its turns and finished anyway would be, in the durable record, indistinguishable from one that
/// never failed a turn.
///
/// # No percentage is stored
///
/// [`errors`](Self::errors) over [`turns`](Self::turns) is the error rate; it is deliberately not
/// recorded as a third field. A stored percentage is a figure that can disagree with its own
/// denominator — after a rounding change, a partially-recorded run, or a reader that sums two runs'
/// rates — and the one thing a reader must be able to trust here is that the numbers add up.
///
/// # What this rollup deliberately does not count
///
/// - **Fatal turns.** A failure of gg's own machinery ends the session on the first occurrence and
///   is never charged to the model's error budget, exactly as the ceilings never observe one.
///   `turns` still counts it, so the accounting stays whole.
/// - **A tool call that failed inside an otherwise successful program**, in [`errors`](Self::errors)
///   or in any per-kind or per-type counter. The program handled it, which is the entire point of
///   the typed tool surface, and charging it to the model's error budget would make the one
///   capability that *expects* failures the one that cannot survive them. It is counted — see
///   [`tool_failures`](Self::tool_failures), which is a rollup of calls, not of turns — because a
///   model fighting the same `not-found` forty times is among the most actionable facts a run has.
/// - **Per-agent attribution.** These are run-wide totals; the per-agent breakdown lives on the
///   stream, where each `TurnOutcome` rides on its own agent's id.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgErrorSummary {
    /// Turns recorded across every agent, whatever their outcome — the denominator every rate here
    /// is read against, and one per model call the run made.
    pub turns: u64,
    /// Turns whose outcome was an [error](GgTurnOutcome::Error). At most [`turns`](Self::turns), and
    /// exactly the sum of the per-kind counters below.
    pub errors: u64,
    /// The longest **consecutive-error run any single agent reached** — the peak of the same
    /// counter [`max_consecutive_errors`](GgRunLimits::max_consecutive_errors) is enforced on.
    ///
    /// A maximum over agents rather than a run-wide streak: the counter is per agent (turns from
    /// two agents interleave arbitrarily on a parallel run, so a run-wide streak would be an
    /// artefact of scheduling), which is why each `TurnOutcome` event carries its agent's running
    /// count rather than leaving this to be re-derived here.
    pub max_consecutive: u64,
    /// Errors of kind [`model_api`](GgTurnErrorKind::ModelApi) — including a reply that
    /// [looped](GgLoopDetection) on every attempt.
    pub model_api: u64,
    /// Errors of kind [`transpile`](GgTurnErrorKind::Transpile).
    pub transpile: u64,
    /// Errors of kind [`program_fault`](GgTurnErrorKind::ProgramFault).
    pub program_fault: u64,
    /// Errors of kind [`sandbox_limit`](GgTurnErrorKind::SandboxLimit).
    pub sandbox_limit: u64,
    /// Errors of kind [`missing_completion`](GgTurnErrorKind::MissingCompletion).
    pub missing_completion: u64,
    /// Responses discarded mid-stream by [loop detection](GgLoopDetection). **Not** an error turn —
    /// a discarded attempt is retried, and the turn is judged on what the retry produced — and
    /// counted here because it is money and wall-clock spent on nothing, which is the cost the
    /// capability exists to bound and the figure that says whether arming it was worth it.
    ///
    /// Always `0` for a run whose agents all left loop detection disarmed, which is the default.
    pub loop_aborts: u64,
    /// The same errors split by their **specific** [type](GgTurnErrorType) rather than by base kind
    /// — the breakdown a *"top error types"* ranking is built from, keyed by
    /// [`GgTurnErrorType::wire_id`].
    ///
    /// Two invariants hold: it sums to [`errors`](Self::errors), and regrouping it by
    /// [`GgTurnErrorType::kind`] reproduces the five named counters above exactly.
    /// The named counters stay because persisted records, stored queries and the console's
    /// side-by-side split all read them; this joins them rather than replacing them.
    ///
    /// # Why a string key rather than the enum
    ///
    /// A map keyed by `GgTurnErrorType` would fail to deserialize *the whole summary* the first
    /// time a newer gg wrote a type an older backend or console had never heard of — a run recorded
    /// today must still read back tomorrow, which is exactly what an open breakdown is for. With a
    /// string key an unknown type degrades to one unlabelled row in a ranking instead. The
    /// compile-time totality this codebase normally insists on is not lost, only moved: the
    /// producing side is the enum, and the generated label table is total over it, so a type cannot
    /// be added without being labelled.
    ///
    /// Empty — and omitted from the wire — for a run with no errors, and only for one: it sums to
    /// [`errors`](Self::errors), so an empty map and a zero there are the same statement.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[cfg_attr(feature = "contract", ts(optional = nullable))]
    pub by_type: BTreeMap<String, u64>,
    /// **Calls** that failed, by [failure class](GgToolFailure) — a different population from
    /// everything above, which counts *turns*.
    ///
    /// Folded from the [`ToolResult`](GgTelemetryKind::ToolResult) events the run emitted, so it
    /// counts every failed tool dispatch in either execution mode, whether or not the program that
    /// made it caught the failure and carried on. Keyed by [`GgToolFailure::wire_id`], and open for
    /// the reason [`by_type`](Self::by_type) is.
    ///
    /// It counts **dispatches**, so a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) call that
    /// never reached a tool is not here: a carve-out no tool backs, and a call the membrane refused
    /// before dispatch, have an [`ApiResult`](GgTelemetryKind::ApiResult) carrying their class and
    /// no `ToolResult` at all. Those are on the stream and a console folds them from there; they
    /// are deliberately not summed into this map, because a rollup whose population is "some of one
    /// surface plus some of another" is a number nobody can check.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[cfg_attr(feature = "contract", ts(optional = nullable))]
    pub tool_failures: BTreeMap<String, u64>,
}

/// One `(slot, model)` token+cost rollup in a [`GgSessionSummary`] — the aggregatable
/// tail of the [`SlotUsage`](GgTelemetryKind::SlotUsage) rollups, folded onto the run so a
/// query can total or slice a gg run's spend per model without replaying the stream.
///
/// A gg run spans several models (subagents can run on different, possibly cross-provider,
/// [slots](GgSlotBinding) than the parent), so cost is accumulated **per slot** rather than
/// as one figure for one model. This is the same shape a `SlotUsage` telemetry event carries,
/// captured once per `(slot, model)` the run touched, so [result aggregation] can answer
/// "does a cheaper subagent slot cost accuracy?" from the durable record.
///
/// [result aggregation]: https://docs.testcabinet.ai/gg/result-aggregation/
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSlotCost {
    /// The [slot](GgSlotBinding) this rollup accounts for (for example [`PRIMARY_SLOT`] or a
    /// role slot like `reviewer`).
    pub slot: String,
    /// The model id (within the slot) this rollup accounts for. A slot normally resolves to one
    /// model, but the accounting keys on the model too so a re-pointed slot stays attributable.
    pub model_id: String,
    /// The tokens accumulated on this slot/model across the run, in the shared [`TokenCounts`]
    /// units.
    pub tokens: TokenCounts,
    /// The cost accumulated on this slot/model, when any turn on it reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub cost: Option<Cost>,
}

/// The compact, aggregatable summary of one whole gg session — the per-run outcome
/// [result aggregation] slices and correlates across many runs.
///
/// gg's experiments are only analyzable *in aggregate* over fields we **durably record**, so a
/// run must carry a small, flat summary of its own outcome rather than forcing every query to
/// re-parse the whole [telemetry stream](GgTelemetryEvent). gg computes this as the run proceeds
/// — counting each figure as the relevant telemetry is emitted — and emits it as a final
/// [`SessionSummary`](GgTelemetryKind::SessionSummary) event right before
/// [`SessionEnded`](GgTelemetryKind::SessionEnded); `core` then records it on the run
/// ([`RunSubject::gg_summary`](crate::run_record::RunSubject::gg_summary)) alongside the
/// [capability set](GgCapabilitySet) that is the *slice-by dimension*, so a result is both
/// configured-by and outcome-summarized on the one record. Every field is a number, a small
/// status string, or a small list, so a query can `GROUP BY` the capability set and aggregate any
/// of them directly.
///
/// [result aggregation]: https://docs.testcabinet.ai/gg/result-aggregation/
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionSummary {
    /// How the session ended — the [`SessionEnded`](GgTelemetryKind::SessionEnded) status this
    /// summary precedes. A slice-by facet for "how often does configuration X finish cleanly?".
    ///
    /// One of gg's nine terminal statuses, and here they all are: `"completed"`; the three ceiling
    /// endings `"exhausted"`, `"timed_out"` and `"limit_exceeded"`; an operator's `"canceled"`; and
    /// the four failures `"model_error"`, `"auth_error"`, `"hook_error"` and `"internal_error"`.
    /// Written out rather than sampled with a "for example", because this is where a consumer of
    /// the schema meets the vocabulary and a facet built from a partial list does not report the
    /// statuses it never heard of — it silently drops the runs that ended on one.
    ///
    /// Never `"error"`, the status a **launch** failure ends on, even though a reader watching the
    /// event stream will see that one: a launch failure stops the session before it has a turn to
    /// summarize, and emits no summary beside it.
    ///
    /// Under [responses-as-code](CAPABILITY_RESPONSES_AS_CODE), `completed` is reachable **only**
    /// through an explicit `finish` call inside a program — there is no implicit completion on
    /// that path, so `completed` is a statement the model made rather than an absence of further
    /// output.
    pub terminal_status: String,
    /// The total number of agents that ran, **including the root** — one per
    /// [`AgentSpawned`](GgTelemetryKind::AgentSpawned) the run emitted. A single-agent run reports
    /// `1`.
    pub agents_spawned: u64,
    /// The number of **subagents** the run spawned — [`agents_spawned`](Self::agents_spawned)
    /// minus the root. `0` for a single-agent run. Recorded alongside the total so a query need
    /// not subtract.
    pub subagent_count: u64,
    /// The deepest [subagent depth](GgTelemetryKind::AgentSpawned) reached this run: `0` for a
    /// single-agent run (only the root, at depth 0), `1` for a run that spawned children but no
    /// grandchildren, and so on — the correlate for "how does delegation depth relate to score?".
    pub max_subagent_depth: u64,
    /// How many [compaction](GgTelemetryKind::Compaction) boundaries the run crossed. `0` when the
    /// compaction capability was off or the thread never neared the window.
    pub compactions: u64,
    /// Whether the run ever **ran out of context** — its window fullness reached the ceiling
    /// (`>= 1.0`) at least once. The headline flag behind "with compaction off, how often did the
    /// model run out of context?".
    pub ran_out_of_context: bool,
    /// How many turns the window fullness hit the ceiling (`>= 1.0`) — the count behind
    /// [`ran_out_of_context`](Self::ran_out_of_context), so a query can distinguish a run that
    /// brushed the ceiling once from one that spent many turns overflowing.
    pub context_overflow_count: u64,
    /// The window fullness (`total_tokens / window_limit`) reported by the **last**
    /// [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown) of the run, when any carried a
    /// fullness figure. `None` when no window limit was known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub final_fullness: Option<f64>,
    /// How many [issue reviews](GgTelemetryKind::IssueReview) the run triggered — one per
    /// [`Requested`](GgIssueReviewPhase::Requested) phase (an issue whose acceptance was gated on
    /// its reviewers). `0` when no issue named reviewers.
    pub issue_reviews: u64,
    /// The total number of review **verdicts** the run's reviewers rendered — every
    /// [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) plus every
    /// [`Approved`](GgIssueReviewPhase::Approved) phase — so a single issue that took several
    /// fix rounds counts each round. The correlate for "which reviewer produced fewer
    /// rework cycles?".
    pub review_cycles: u64,
    /// How many times a review **reopened** an issue for fixes — one per
    /// [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) phase. `0` when every review
    /// approved on the first pass (or no issue named reviewers).
    pub issues_reopened: u64,
    /// Which **execution mode** the run's agents used — the durable record of whether the run was
    /// driven with [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) (`"responses_as_code"`, the
    /// model emitted programs gg ran in the wasmtime sandbox) or traditional tool calling
    /// (`"tool_calling"`, the default). This is the effective-behavior companion to the
    /// [`cap.responses-as-code`](crate::gg_query) document field: that field slices by the
    /// *configured* capability, and this one records the mode the
    /// run actually ran in, so "does a code-shaped response help?" is a durable, sliceable outcome
    /// dimension. Recorded once off the run's configuration (like [`effective_tools`](Self::effective_tools)),
    /// not derived from the telemetry stream.
    pub execution_mode: String,
    /// The [language](GgProgramLanguage) the run's root agent wrote its programs in — the slice-by
    /// dimension a cross-language study compares its arms on, and the companion to
    /// [`execution_mode`](Self::execution_mode): that field says *whether* the run answered in
    /// programs, this one says what those programs were written in.
    ///
    /// `None` for a tool-calling run, which has no program language at all — as opposed to having
    /// an unknown one. Recorded once off the run's configuration, like
    /// [`effective_tools`](Self::effective_tools), rather than derived from the telemetry stream.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub program_language: Option<GgProgramLanguage>,
    /// How many **code-shaped turns** the run took — one per
    /// [`CodeExecution`](GgTelemetryKind::CodeExecution) event. `0` when the
    /// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability was off (traditional tool
    /// calling), so a non-zero count is the proof the code path actually ran.
    ///
    /// This counts turns, not executions: a turn whose reply did not compile at all emits its event
    /// like any other and is counted here, which is exactly what makes this the denominator for
    /// every rate in the run's [healing rollup](Self::healing). Numerator and denominator are folded
    /// from the same event, so they cannot come from different mechanisms and drift.
    pub code_executions: u64,
    /// How many milliseconds the run spent **compiling**, in total — its programs, the code halves
    /// of the skills and memories they brought into use, and the on-use scripts those queued.
    /// Folded from the same [`CodeExecution`](GgTelemetryKind::CodeExecution) events
    /// [`code_executions`](Self::code_executions) counts, so the sum and the turn count it is read
    /// against cannot come from different mechanisms and drift.
    ///
    /// `0` for a language whose prepare step invokes no compiler, and for a tool-calling run — the
    /// honest answer rather than an absence, because "this arm compiled nothing" is a measurement
    /// and a missing field is not. It counts the rejected programs too: what a compiled arm pays
    /// for a program the compiler refused is part of what that arm costs.
    ///
    /// This is the run-level figure a cross-language study divides by
    /// [`code_executions`](Self::code_executions) to ask what a turn of arm A costs in compile time
    /// against a turn of arm B, and it is the only place that question is answerable — the per-turn
    /// time is on the events, but a query works on the run document.
    pub compile_ms: u64,
    /// What gg had to do to the models' responses before it could run them — the run's
    /// [response-healing](GgHealingSummary) rollup, folded from the same
    /// [`CodeExecution`](GgTelemetryKind::CodeExecution) events
    /// [`code_executions`](Self::code_executions) counts. All zeroes for a tool-calling run.
    pub healing: GgHealingSummary,
    /// How many of the run's turns failed, how badly they clustered, and how — the run's
    /// [error rollup](GgErrorSummary), folded from the
    /// [`TurnOutcome`](GgTelemetryKind::TurnOutcome) events every agent emitted.
    ///
    /// Unlike [`healing`](Self::healing) this is meaningful in **both** execution modes: a
    /// tool-calling turn fails too, just in fewer ways.
    pub errors: GgErrorSummary,
    /// How many distinct [issues](GgBoardIssue) the run ever created on its
    /// [board](GgTelemetryKind::BoardState) — the count of distinct issue ids observed across the
    /// run. `0` when the project-management capability was off.
    pub issues_created: u64,
    /// How many distinct issues the run ever drove to [`Done`](GgIssueStatus::Done) — the count of
    /// distinct issue ids observed at `Done` at any point (so an issue reopened and re-completed
    /// still counts once). At most [`issues_created`](Self::issues_created).
    pub issues_completed: u64,
    /// The per-`(slot, model)` token+cost rollup for the run — the durable tail of the
    /// [`SlotUsage`](GgTelemetryKind::SlotUsage) rollups, one entry per slot/model the run touched,
    /// in first-seen order. Empty only for a run that recorded no usage (a launch that never ran a
    /// turn).
    pub slot_costs: Vec<GgSlotCost>,
    /// The **effective toolset**: the exact set of tool names offered to the run's agent,
    /// in the order they were presented to the model. This is what the run's
    /// [capability set](GgCapabilitySet) *actually resolved to* — a capability contributes
    /// its tools only when enabled (and, for the stateful ones, only when its store is
    /// non-empty), narrowed to what the agent's [allowlist](GgAgentConfig::tools) grants —
    /// so recording it durably makes the toolset a first-class experimental variable a query
    /// can slice by ("group by whether `edit_file` was offered", "runs with only
    /// `write_file`"). Because switching a capability on/off *is* offering/withholding its
    /// tools, this is the ground truth a comparison of two configurations reads rather than
    /// re-deriving the toolset from the capability set. Empty for a run whose agent was offered no
    /// tools at all — including every run whose root answers with programs rather than tool calls,
    /// which is offered no tools by construction and whose surface is its
    /// [operations](GgAgentConfig::operations). Recorded from the root agent, whose profile is the
    /// run's headline configuration.
    pub effective_tools: Vec<String>,
    /// The [execution ceilings](GgRunLimits) that were actually **in force** for this run — the
    /// configured set with gg's own defaults filled in (the error ceilings a run left unset, and an
    /// absent `maxTurns` recorded as unbounded).
    ///
    /// Recorded rather than left to be re-derived from the [capability set](GgCapabilitySet)
    /// because a default is otherwise invisible: "what ceiling was this run bounded by?" must be
    /// answerable for every run, including one that declared none.
    pub limits: GgRunLimits,
    /// The ceiling that stopped the run, when one did — which [ceiling](Self::limits), what it was
    /// set to, and what was observed. Absent for a run that ended on its own terms.
    ///
    /// This is the **root** agent's breach: a subagent that stops on its own error ceiling ends
    /// itself and reports back through the delegation channel, and the run carries on, so its
    /// breach is not the run's outcome. Distinct from [`terminal_status`](Self::terminal_status),
    /// which cannot answer "which ceiling?" — two of the five share `limit_exceeded` and two have
    /// statuses of their own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub limit_hit: Option<GgLimitBreach>,
}

/// A single event in gg's first-party telemetry stream (schema v1).
///
/// Because gg is [headless](https://docs.testcabinet.ai/gg/overview/), this stream is
/// the only live window into a run — the console renders it natively. Each event
/// carries common fields (a timestamp and an optional session id) plus the
/// type-specific [`GgTelemetryKind`], flattened into the serialized form so the
/// discriminator and its fields sit inline.
///
/// The [`agent_id`](Self::agent_id) and [`parent_agent_id`](Self::parent_agent_id)
/// fields identify the node in the [subagent tree](https://docs.testcabinet.ai/gg/subagents/)
/// that emitted the event (Phase 4): every event an agent emits carries its own id and its
/// spawner's id, so the console can reconstruct who-spawned-whom and attribute the stream per
/// agent. A single-agent run tags every event with the root agent's id (`"root"`) and no
/// parent. The [`issue_id`](Self::issue_id) field scopes an event to a board
/// [issue](GgBoardIssue) once work is dispatched against one (Phase 4B); a run that has not
/// dispatched leaves it unset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgTelemetryEvent {
    /// RFC 3339 / ISO 8601 time the event was emitted.
    pub timestamp: String,
    /// The gg session this event belongs to, when one is known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub session_id: Option<String>,
    /// The id of the agent that emitted the event, so events can be attributed to a node
    /// in the [subagent tree](https://docs.testcabinet.ai/gg/subagents/). A single-agent
    /// run stamps every event with the root agent's id (`"root"`); it is unset only for
    /// events emitted before any agent context exists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub agent_id: Option<String>,
    /// The id of the agent that spawned the emitting agent, so the subagent tree's
    /// parent→child edges can be reconstructed. Unset for the root agent (which has no
    /// spawner) and for events with no agent context.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub parent_agent_id: Option<String>,
    /// The id of the [issue](GgBoardIssue) this event's work is scoped to, for the live
    /// board. The board itself lands in Phase 3, but an event is only *scoped* to a
    /// specific issue once work is dispatched against one (Phase 4), so a P3a run — which
    /// builds the board but does not yet dispatch — leaves this unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub issue_id: Option<String>,
    /// The type-specific event data.
    #[serde(flatten)]
    pub kind: GgTelemetryKind,
}

impl GgTelemetryEvent {
    /// Build an event carrying `kind`, stamped with `timestamp` and no session id or
    /// reserved fields — the common Phase 0 shape.
    pub fn new(timestamp: impl Into<String>, kind: GgTelemetryKind) -> Self {
        Self {
            timestamp: timestamp.into(),
            session_id: None,
            agent_id: None,
            parent_agent_id: None,
            issue_id: None,
            kind,
        }
    }
}

/// The type-specific payload of a [`GgTelemetryEvent`], discriminated by the `type`
/// field.
///
/// This is schema v1 and is designed to be **extended** — later phases add variants
/// (compaction boundaries, subagent spawn/return, context-window breakdowns, board
/// transitions) without breaking existing ones. Field names are camelCased on the
/// wire; variant tags are snake_case.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
// The `Option<T>` fields below are `#[serde(skip_serializing_if)]`, so they are
// omitted from the wire when absent rather than serialized as `null`; render them as
// TypeScript optionals (`field?: T`) to match.
#[cfg_attr(feature = "contract", ts(optional_fields))]
pub enum GgTelemetryKind {
    /// A gg session began.
    SessionStarted {
        /// The [capability set](GgCapabilitySet) the session is running — its exact,
        /// resolved configuration, announced up front so a console watching the stream
        /// knows which capabilities are live before any of them has produced an event.
        /// Without it a live view can only guess what a run is capable of and must
        /// offer every surface, including the ones this run's configuration disabled.
        capability_set: Box<GgCapabilitySet>,
    },
    /// An agent turn began (one model request/response cycle).
    TurnStarted {},
    /// The assistant emitted a natural-language message.
    AssistantMessage {
        /// The text the assistant emitted.
        text: String,
    },
    /// The agent invoked a tool.
    ToolCall {
        /// The tool's name.
        name: String,
        /// The arguments the agent passed, as a free-form JSON object.
        #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
        args: Value,
    },
    /// A tool invocation returned.
    ToolResult {
        /// The tool's name.
        name: String,
        /// Whether the tool call succeeded.
        ok: bool,
        /// A short human-readable summary of the result, when one is available.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
        /// Why it failed, when it failed — the [class](GgToolFailure) the tool itself raised, never
        /// one inferred afterwards from the summary's prose.
        ///
        /// Present on exactly the results whose [`ok`](Self::ToolResult::ok) is `false`, with
        /// [`Other`](GgToolFailure::Other) for a failure raised outside a tool implementation, and
        /// absent on every success — so `failure != null` and `ok == false` are the same statement,
        /// and a reader never meets a failure with no class.
        ///
        /// `ok` stays the authoritative "did it fail?". This says how.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        failure: Option<GgToolFailure>,
    },
    /// A [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) program called one of the functions its
    /// modules offer it — the **model-facing** record, emitted once per call the program makes.
    ///
    /// It is not a variant spelling of [`ToolCall`](Self::ToolCall), and the two never describe the
    /// same call. gg's tool vocabulary and its API surface are two independent surfaces over one
    /// core, and an agent is offered **exactly one** of them: a responses-as-code agent's calls are
    /// recorded here and only here, and a tool-calling agent emits `ToolCall`/`ToolResult` and none
    /// of these. Neither event is derived from, or counted through, the other.
    ///
    /// It carries **no arguments**. They are either trivial (`session.finish()`) or enormous
    /// (`views.openText(label, body)`), and the program that composed them is itself the model's
    /// reply — so a second copy would double the stream's largest payloads to say nothing the
    /// turn's own text does not already say.
    ///
    /// Emitted **before** the call runs, so anything the call produces — a delegation's child events
    /// — lands between it and its [`ApiResult`](Self::ApiResult), exactly as `ToolCall` brackets a
    /// native tool call.
    ApiCall {
        /// **The cross-arm join key**: gg's operation id for what was called — `files.read_file` —
        /// the same string the agent's [surface](GgAgentApiFunction::operation) reports the bound
        /// function under.
        ///
        /// It is here because eleven arms legitimately spell one operation eleven ways, and by
        /// design they do: an arm's surface answers to its own language, so `read_file`,
        /// `readFile`, `ReadFile` and `readTextFile`-as-a-method are all real spellings of things
        /// gg has exactly one name for. A study comparing arms — or comparing two agents of one run
        /// written in two languages — joins on this and on nothing else.
        ///
        /// Every model-facing call has one, including the
        /// [documentation](https://docs.testcabinet.ai/gg/responses-as-code/views/) family: the
        /// operations table is the single vocabulary of the API surface, so a call with no row in it
        /// is a call the surface could not have offered.
        operation: String,
    },
    /// The [`ApiCall`](Self::ApiCall) beside this one returned.
    ///
    /// `ok` is the **API function's** verdict, settled after the call's result has been converted
    /// into what the program is handed — so a typed implementation that answered with a payload the
    /// function could not turn into its return type is a failed call here. The API layer is the one
    /// the model experienced, and it is the only layer this event reports.
    ApiResult {
        /// The [operation](Self::ApiCall::operation), repeated so this event stands alone — and it
        /// is the repetition that earns its keep here rather than a formality: *how often did this
        /// operation fail* is a question about results, and answering it by pairing each result
        /// with the call before it would mean re-deriving a bracket across every child event a
        /// delegation emitted inside it.
        operation: String,
        /// Whether the call returned a value to the program rather than throwing into it.
        ok: bool,
        /// The [class](GgToolFailure) of the `ToolError` thrown into the program, on a call that
        /// threw. Present on exactly the results whose [`ok`](Self::ApiResult::ok) is `false`.
        ///
        /// This is the **model's** view of why its call failed — the same `code` the program itself
        /// branches on in a `catch` — and it is the only record of it, because a responses-as-code
        /// agent's calls are recorded on this stream alone. That includes the call the membrane
        /// refused before dispatch (a spent wall-clock budget, a name this agent was not granted),
        /// which never reached an implementation at all.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        failure: Option<GgToolFailure>,
    },
    /// Token usage (and, when known, cost) accounted since the previous usage event,
    /// **attributed to the agent profile and model that spent it**.
    /// Reuses the shared [`TokenCounts`] and [`Cost`] contract types so gg usage is
    /// reported in the same units as every other run.
    ///
    /// A gg run spans several models (one per [agent profile](GgAgentConfig)), so an unattributed
    /// delta is unattributable: summed over a multi-model run it says what was spent but not on
    /// what, and no consumer can price it per token class or split it per model. Each delta
    /// therefore names the profile and the concrete model that produced it, which makes the *live*
    /// per-model breakdown derivable from the delta stream alone — the
    /// [`SlotUsage`](Self::SlotUsage) rollups say the same thing, but only once an agent has
    /// finished, which is too late for a run being watched. Summing the deltas of one
    /// `(slot, model_id)` key reproduces that key's rollup exactly.
    Usage {
        /// The [agent profile](GgAgentConfig) that spent this — the same name
        /// [`AgentSpawned::slot`](Self::AgentSpawned::slot) and
        /// [`SlotUsage::slot`](Self::SlotUsage::slot) key on.
        slot: String,
        /// The concrete model id that spent this — the model the
        /// [profile](Self::Usage::slot) resolved to for the agent that took the turn.
        model_id: String,
        /// The normalized token counts for this accounting.
        tokens: TokenCounts,
        /// The cost of this accounting, when it could be determined.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cost: Option<Cost>,
    },
    /// The per-source breakdown of what fills the context window, assembled for a turn.
    ///
    /// Emitted once per turn, always — context visibility is not a capability that can be
    /// switched off, but the intrinsic accounting every run reports. The console renders
    /// the stream of these as a stacked line graph of window fullness by category over
    /// the run. All token figures are estimates (see [`GgContextSourceUsage`]).
    ContextBreakdown {
        /// One band per [`GgContextSource`], in [`GgContextSource::ALL`] order (a source
        /// that contributed nothing this turn is present with `0`), so the graph's bands
        /// stay stable across turns.
        by_source: Vec<GgContextSourceUsage>,
        /// The estimated total tokens across every source — the numerator of fullness.
        total_tokens: u64,
        /// The active model's context-window limit, when known — its catalog window, or the
        /// smaller figure an enabled [context-window override](CAPABILITY_CONTEXT_WINDOW_OVERRIDE)
        /// narrowed it to. The denominator of fullness.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        window_limit: Option<u64>,
        /// `total_tokens / window_limit` in `0.0..=1.0+`, when a limit is known — the
        /// fullness signal compaction triggers on.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fullness: Option<f64>,
    },
    /// A single **message** in an agent's context window, recorded in full the first time
    /// it enters any prompt on this agent's stream — the pool entry every
    /// [`Prompt`](Self::Prompt) points into so a message repeated across turns is stored
    /// once, not once per turn.
    ///
    /// gg's window is [append-only](https://docs.testcabinet.ai/gg/context-visibility/): a
    /// turn extends the previous turn's prompt rather than rewriting it, so the same
    /// messages recur across most turns. Rather than restream the whole prompt every turn,
    /// gg assigns each message a stable [`id`](Self::ContextMessage::id) — a fingerprint of
    /// its content — and emits its body **once**, here; each turn's [`Prompt`](Self::Prompt)
    /// is then a sequence of [pointers](GgPromptRef) into this pool, and the console
    /// reassembles a turn's exact request by resolving them. The pool is per agent (each
    /// agent's stream carries the definitions its own prompts reference). Emitted every turn;
    /// the run's
    /// [`tokens`](Self::ContextMessage::tokens) figure is the same estimate the breakdown
    /// bands are summed from, so a message's own contribution to fullness is legible.
    ///
    /// An attached image is recorded as a lightweight [descriptor](GgLoggedImage) — its
    /// media type, decoded size, and the tokens it is charged — never its base64 bytes,
    /// which would bloat the stream without adding anything the reader of a *request* needs.
    ContextMessage {
        /// The message's stable id: a fingerprint of its content, shared by every
        /// [`Prompt`](Self::Prompt) reference and by the same message wherever it recurs.
        id: String,
        /// The message's role (`system`, `user`, `assistant`, or `tool`).
        role: String,
        /// The message's textual content, when it has any (absent for an assistant turn
        /// that only called tools).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        /// The tool calls an assistant message requested, in order (empty for every other
        /// role).
        tool_calls: Vec<GgLoggedToolCall>,
        /// For a `tool` message, the id of the assistant tool call it answers.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_call_id: Option<String>,
        /// Descriptors of any images attached to the message — the media type and size of
        /// each, never its bytes (see [`GgLoggedImage`]). Empty for a text-only message.
        images: Vec<GgLoggedImage>,
        /// The estimated tokens this message occupies — the same per-item estimate the
        /// [`ContextBreakdown`](Self::ContextBreakdown) bands sum, so a message's own share
        /// of the window is legible.
        tokens: u64,
        /// The window item's **selector tag**, when it carries one: the workspace path a
        /// [`FileView`](GgContextSource::FileView) shows (the same tag
        /// `evict_file_view { path }` targets), and the sentinel naming the rebuilt
        /// fullness signal. Absent for an ordinary message, which selects nothing.
        ///
        /// It is what makes a window's *material* attributable rather than only its band:
        /// a `file_view` message says how many tokens a file occupied, and the label says
        /// **which file**, so the console can total a run's context spend per path. The
        /// tag survives what the message envelope does not — a pinned, autoloaded
        /// specification re-framed as a `user` message across a
        /// [compaction](https://docs.testcabinet.ai/gg/compaction/) boundary keeps its
        /// path, where its `tool_call_id` pairing does not.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    /// One agent turn's exact **request and response**, as pointers into the
    /// [message pool](Self::ContextMessage) — the itemized, message-level companion to the
    /// per-source [`ContextBreakdown`](Self::ContextBreakdown).
    ///
    /// [`request`](Self::Prompt::request) is the ordered list of messages sent to the model
    /// this turn, each a [pointer](GgPromptRef) to a pooled
    /// [`ContextMessage`](Self::ContextMessage) tagged with the [`GgContextSource`] band it
    /// occupies — so a turn's request is reconstructed without restreaming any message, and
    /// every message lines up with the band it contributes to on the context graph.
    /// [`response_id`](Self::Prompt::response_id) points at the assistant reply (also
    /// pooled, so it reappears as a request pointer on the next turn, its id unchanged), or
    /// is absent when the turn produced no assistant message at all.
    /// [`tokens`](Self::Prompt::tokens)/[`cost`](Self::Prompt::cost) are the turn's actual
    /// provider usage — the same figures the incremental [`Usage`](Self::Usage) carries,
    /// bundled here so a turn's request→response reads as one self-contained record.
    /// Emitted once per turn, immediately after the model call.
    Prompt {
        /// The messages sent to the model this turn, in order — pointers into the pool.
        request: Vec<GgPromptRef>,
        /// The estimated total tokens across the request (the sum of the pointed-to
        /// messages' estimates) — the numerator of this turn's fullness, matching the
        /// adjacent [`ContextBreakdown`](Self::ContextBreakdown).
        total_tokens: u64,
        /// The pooled id of the assistant reply this request produced. Absent when the turn
        /// produced no assistant message (neither text nor tool calls).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        response_id: Option<String>,
        /// Why the model's turn stopped (`stop`, `tool_calls`, `length`, …).
        finish_reason: String,
        /// The turn's normalized token usage (the same delta the [`Usage`](Self::Usage)
        /// event carries), bundled so the request→response record is self-contained.
        tokens: TokenCounts,
        /// The turn's cost, when the provider reported one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cost: Option<Cost>,
        /// How long the model call took, in milliseconds — the wall-clock latency of the
        /// request that produced this turn's [`tokens`](Self::Prompt::tokens). The
        /// denominator for a turn's generation throughput (output tokens per second).
        /// Absent when the turn was not produced by a timed model call (e.g. a replayed
        /// or synthesized response).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    /// Where one turn's wall-clock went, split into the three phases every turn passes
    /// through: assembling the prompt, waiting on the model, and handling what came back.
    ///
    /// Emitted once per [`TurnStarted`](Self::TurnStarted), as the last event of the turn it
    /// describes — the split is only knowable once the turn is over. A turn cut short (a
    /// ceiling breached mid-turn, a model call that failed) still reports one, with the
    /// phases it reached; the phases it never entered are `0`. That also means a timing for
    /// an aborted turn lands *after* the event that ended the turn, since the turn's
    /// accounting closes when the turn does.
    ///
    /// The three figures are a partition of the turn, not three independent measurements:
    /// [`response_ms`](Self::TurnTiming::response_ms) is the remainder after the other two,
    /// so they always sum to exactly the turn's wall-clock duration and stack without a
    /// gap. The console renders the stream of these as a stacked bar per turn.
    TurnTiming {
        /// Milliseconds spent assembling the request: draining the inbox, refreshing pinned
        /// state, running any triggered compaction, and building the offered toolset — from
        /// the turn's start to the moment the model call was dispatched.
        prompt_ms: u64,
        /// Milliseconds spent on the model call itself — the same wall-clock latency the
        /// turn's [`Prompt`](Self::Prompt) carries as
        /// [`duration_ms`](Self::Prompt::duration_ms), including any vision-recovery retry.
        /// `0` for a turn that ended before it reached the model.
        request_ms: u64,
        /// Milliseconds spent handling the response: dispatching and answering every tool
        /// call (or running the turn's program, in responses-as-code mode), applying the
        /// state transitions it asked for, and closing the turn. The remainder of the turn
        /// after the other two phases, so the three sum to the turn's duration.
        response_ms: u64,
    },
    /// The [skills](https://docs.testcabinet.ai/gg/skills/) available to the model and
    /// which of them have been read.
    ///
    /// Emitted once at session start (with the full catalog, all unread) when the
    /// [skills](CAPABILITY_SKILLS) capability offers any skills, and again each time the
    /// model reads one (that skill flips to `read: true` and its body enters the context
    /// window as a [`Skill`](GgContextSource::Skill)-sourced, compaction-retained item).
    /// The console renders it as the run's skill panel. A run with the capability off, or
    /// with no skills to offer, emits none.
    SkillsState {
        /// The [module instance](GgTelemetryKind::AgentModules) this snapshot is of — the backing
        /// read set, not the holder.
        module_id: String,
        /// One entry per available skill, in the order the catalog lists them.
        skills: Vec<GgSkillState>,
    },
    /// The model's self-curated [memories](https://docs.testcabinet.ai/gg/memories/) and
    /// the [bounds](GgMemoryCaps) they are kept within.
    ///
    /// Emitted once at session start (an empty list plus the caps) when the
    /// [memories](CAPABILITY_MEMORIES) capability is enabled, and again after every
    /// successful memory mutation so the console renders the curated set live and shows how
    /// close each memory is to its limit. Under the
    /// [`scratchpad`](MEMORY_STRATEGY_SCRATCHPAD) strategy each in-play memory's body is a
    /// [`Memory`](GgContextSource::Memory)-sourced, compaction-retained context item; under
    /// [`markdown`](MEMORY_STRATEGY_MARKDOWN) the pinned item is the index alone, and under
    /// [`keyword-search`](MEMORY_STRATEGY_KEYWORD_SEARCH) there is none. A run with the
    /// capability off emits none.
    MemoryState {
        /// The [module instance](GgTelemetryKind::AgentModules) this snapshot is of — the backing
        /// store, not the holder. It is what lets a reader attribute two agents' identical panels
        /// to one store rather than to a coincidence, and what lets a shared store's contents be
        /// shown once, under the module, rather than N times under N agents.
        module_id: String,
        /// The [strategy](CAPABILITY_MEMORIES) this run's memories are organized by — which
        /// tools the model was offered, and which of the [caps](GgMemoryCaps) apply.
        strategy: String,
        /// One entry per memory currently held, in name order.
        memories: Vec<GgMemoryEntry>,
        /// The number of memories currently held (the length of `memories`).
        count: u64,
        /// The total length, in characters, summed across every memory's body.
        total_len: u64,
        /// The total length, in lines, summed across every memory's body.
        total_lines: u64,
        /// The high-water marks this run's memories reached, so a set that was curated back
        /// down still reports how much it once held.
        peak: GgMemoryPeak,
        /// The bounds these memories are kept within.
        caps: GgMemoryCaps,
        /// The [scope](GgMemoryScope) the emitting agent binds this instance under — `isolated`,
        /// `shared`, `inherited` or `read-only`. It is what tells the console that two agents'
        /// memory panels are showing **one** store rather than two that happen to agree, which is
        /// otherwise indistinguishable from a snapshot.
        scope: String,
        /// Whether the emitting agent may **write** this instance. `false` marks a
        /// [read-only](GgMemoryScope::ReadOnly) inherited handle: the agent is shown the set and
        /// offered the read calls, and every write call is withheld.
        writable: bool,
    },
    /// One revision of one [memory](https://docs.testcabinet.ai/gg/memories/) — the
    /// append-only record of everything the model ever wrote to memory.
    ///
    /// Emitted after **every** successful memory mutation, alongside the
    /// [`MemoryState`](Self::MemoryState) snapshot that reports the set as it now stands. The
    /// two answer different questions: the snapshot is what the model holds, and this stream
    /// is what it *did* — including the memories it wrote and then deleted, which a snapshot
    /// can never show, and the earlier text of a memory it revised. The console replays the
    /// stream into a per-memory revision history.
    MemoryRevision {
        /// The memory's stable name — the slug the revisions of one memory are keyed by. A
        /// name that is deleted and later re-created keeps counting up from where it left
        /// off, because that too is part of what the model did.
        name: String,
        /// This memory's revision number, counting from `1` at its first write.
        revision: u64,
        /// What produced this revision.
        change: GgMemoryChange,
        /// The memory's description as of this revision; empty on a deletion, and on a
        /// strategy that does not require one.
        description: String,
        /// The memory's body as of this revision; empty on a deletion. The body is bounded by
        /// [`max_len_per_memory`](GgMemoryCaps::max_len_per_memory), so the stream carries the
        /// text itself rather than a pointer the console would have to resolve.
        body: String,
        /// The body's length in characters (`0` on a deletion).
        len: u64,
        /// The body's length in lines (`0` on a deletion).
        lines: u64,
    },
    /// The model's [task](https://docs.testcabinet.ai/gg/tasks/) list — a blocked-by DAG
    /// that is retained across a [compaction] boundary verbatim.
    ///
    /// Emitted once at session start (an empty list) when the [tasks](CAPABILITY_TASKS)
    /// capability is enabled, and again after every successful mutation
    /// (`add_task`/`update_task`/`set_blocked_by`/`complete_task`/`remove_task`) so the
    /// console can render the live DAG. The full list is also a pinned
    /// [`TaskList`](GgContextSource::TaskList)-sourced context item, so the model sees its
    /// plan each turn. A run with the capability off emits none.
    ///
    /// [compaction]: https://docs.testcabinet.ai/gg/compaction/
    TasksState {
        /// The [module instance](GgTelemetryKind::AgentModules) this snapshot is of — the backing
        /// list, not the holder.
        module_id: String,
        /// The tasks, in the order the model added them (a stable order for the DAG's
        /// nodes). Each carries its status and the ids it is blocked by.
        tasks: Vec<GgTaskEntry>,
    },
    /// The model's [epic/issue board](https://docs.testcabinet.ai/gg/project-management/) — the
    /// heavyweight work-decomposition counterpart to the [task list](Self::TasksState), whose
    /// issues form a blocked-by DAG retained across a [compaction] boundary verbatim.
    ///
    /// Emitted once at session start (an empty board) when the
    /// [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability is enabled, and again after every
    /// successful mutation
    /// (`create_epic`/`create_issue`/`update_issue`/`set_issue_blocked_by`/`remove_epic`/`remove_issue`)
    /// — and whenever gg itself moves an issue (a dispatch, a completion, an acceptance) —
    /// so the console can render the live board. The whole board is also a pinned
    /// [`Board`](GgContextSource::Board)-sourced context item, so the model sees its
    /// decomposition each turn. A run with the capability off emits none.
    ///
    /// [compaction]: https://docs.testcabinet.ai/gg/compaction/
    BoardState {
        /// The [module instance](GgTelemetryKind::AgentModules) this snapshot is of. The board is
        /// run-global by construction, so every holder in a run reports the *same* id here —
        /// which is exactly what makes the whole run's board legible as one shared module rather
        /// than as one board per agent.
        module_id: String,
        /// The epics, in the order the model created them.
        epics: Vec<GgBoardEpic>,
        /// The issues, in the order the model created them (a stable order for the DAG's
        /// nodes). Each carries its structured scope sections, its status, the ids it is
        /// blocked by, and the epic it is grouped under, if any.
        issues: Vec<GgBoardIssue>,
    },
    /// A [compaction] boundary: the thread neared the active model's window, so gg
    /// summarized the ephemeral history and restarted the thread from the summary,
    /// carrying the pinned state across verbatim.
    ///
    /// Emitted at the turn boundary where compaction fires (when the
    /// [compaction](CAPABILITY_COMPACTION) capability is enabled and window fullness
    /// reaches its threshold). The console draws it as a marker on the run timeline and
    /// the context graph; the token figures show the window reclaimed (`afterTokens` is
    /// the pinned prefix plus the summary, well below `beforeTokens`), and
    /// [`retained`](GgRetainedState) proves the skills/tasks/memories survived. A run
    /// with the capability off emits none.
    ///
    /// [compaction]: https://docs.testcabinet.ai/gg/compaction/
    Compaction {
        /// The name of the [summarization strategy](https://docs.testcabinet.ai/gg/compaction/)
        /// that produced this summary — the capability's resolved `implementation`, e.g.
        /// `self-summarization` (the default: the agent's own prose recap) or
        /// `handoff-compaction` (a separate model's `compact` call). Recorded per boundary so
        /// the console's Compaction view can compare what each strategy retained.
        strategy: String,
        /// The fullness threshold (a `0.0..=1.0` fraction) that tripped this compaction,
        /// derived from the capability's `summaryHeadroom` param as `1 - summaryHeadroom`.
        trigger_fullness: f64,
        /// The estimated total tokens in the window immediately before compaction.
        before_tokens: u64,
        /// The estimated total tokens after compaction — the pinned prefix plus the
        /// single summary item — which is below `before_tokens`.
        after_tokens: u64,
        /// The estimated tokens the summary item itself occupies.
        summary_tokens: u64,
        /// The pinned state carried across the boundary verbatim (the retention proof).
        retained: GgRetainedState,
        /// The per-source window composition **immediately before** compaction, one band per
        /// [`GgContextSource`] in [`GgContextSource::ALL`] order — the same shape as
        /// [`ContextBreakdown`](Self::ContextBreakdown)'s `by_source`. Paired with
        /// [`after_by_source`](Self::Compaction::after_by_source) it shows exactly which bands
        /// the summarize-and-restart reclaimed.
        before_by_source: Vec<GgContextSourceUsage>,
        /// The per-source window composition **immediately after** compaction: the pinned bands
        /// unchanged and the ephemeral bands collapsed into the single `History` summary item.
        after_by_source: Vec<GgContextSourceUsage>,
        /// The summary text the strategy produced (the raw summarizer output, without the
        /// recap heading gg prepends when it re-seeds the window). Recorded so the summary can
        /// be read back and compared across strategies.
        summary: String,
        /// Whether the summarization call failed and the summary degraded to gg's fixed
        /// fallback note rather than a real recap — so a study can tell a produced summary from
        /// a failed one instead of inferring it from the text.
        summary_fallback: bool,
    },
    /// An [agent-managed context](https://docs.testcabinet.ai/gg/agent-managed-context/)
    /// action: the model reclaimed window space itself — evicting file views or archiving a
    /// section of its thread — the complement to the automatic [compaction] backstop.
    ///
    /// Emitted when the [agent-managed-context](CAPABILITY_AGENT_MANAGED_CONTEXT) capability
    /// is enabled and the model calls `evict_file_view` or `archive_thread` (the underlying
    /// `ToolCall`/`ToolResult` still stream too; this event carries the *effect* — how much
    /// window was reclaimed). The console draws it as a marker on the timeline and the
    /// context graph, alongside the drop the next
    /// [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown) shows in the affected
    /// band. A `search_archive` call reclaims nothing, so it is reported only as an ordinary
    /// tool result, never here. A run with the capability off emits none.
    ///
    /// [compaction]: https://docs.testcabinet.ai/gg/compaction/
    ContextManaged {
        /// Which window-management action the agent took.
        action: GgContextAction,
        /// The estimated tokens reclaimed from the live window by the action.
        reclaimed_tokens: u64,
        /// The number of context items removed from the live window (evicted file views, or
        /// archived thread items).
        items: u64,
        /// A short human-readable description of the action and what it affected (for
        /// example the evicted paths, or how many turns were archived and the archive's new
        /// size), for the console feed.
        detail: String,
        /// Where in the window the **earliest** removed item sat, as its zero-based position among
        /// the thread's items just before the removal; `None` for an action that removed nothing.
        ///
        /// The tokens above say what a reclaim *bought*; this says what it **cost**. A provider's
        /// prompt cache serves a prefix of a request it has already seen, so removing an item
        /// invalidates everything from its position onward — and reclaiming three hundred tokens
        /// from the head of a long window is a materially worse trade than reclaiming the same three
        /// hundred from its tail. Nothing else in the record can distinguish the two, which is why
        /// a close of the otherwise append-only [documentation band](GgContextSource::DocsView)
        /// reports it: whether the [close capability](CAPABILITY_DOCVIEW_CLOSE) pays for itself is
        /// exactly this comparison.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        earliest_removed: Option<u64>,
    },
    /// The out-of-window thread [archive](CAPABILITY_AGENT_MANAGED_CONTEXT) — what `archive_thread`
    /// has put away and `search_archive` can recover.
    ///
    /// Emitted once as an agent opens (empty, when the capability is on) and again after every
    /// `archive_thread`, alongside the [`ContextManaged`](Self::ContextManaged) event that records
    /// the *act*. The two answer different questions: that one is "the window was reclaimed by this
    /// much", this one is "here is what is now out of it". A run with the capability off emits none.
    ///
    /// The entries carry metadata and a bounded preview only — see [`GgArchiveEntry`] for why the
    /// record does not carry the archived text a second time.
    ArchiveState {
        /// The [module instance](Self::AgentModules) this snapshot is of — the backing archive, not
        /// the holder.
        module_id: String,
        /// The archived entries, in archival order.
        entries: Vec<GgArchiveEntry>,
        /// How many entries are archived (the length of `entries`).
        count: u64,
        /// The total length, in characters, of everything archived — the size of what left the
        /// window.
        total_len: u64,
    },
    /// An agent [started running](https://docs.testcabinet.ai/gg/subagents/) — the event
    /// that builds the live agent tree the console visualizes.
    ///
    /// Emitted once per agent as it begins its turn loop: the root agent at session start,
    /// and (Phase 4B) each subagent when the [scheduler](https://docs.testcabinet.ai/gg/subagents/#scheduling)
    /// grants it a slot. The spawned agent's **identity is the event's own**
    /// [`agent_id`](GgTelemetryEvent::agent_id) /
    /// [`parent_agent_id`](GgTelemetryEvent::parent_agent_id) — an `AgentSpawned` is emitted on
    /// the spawned agent's own scoped stream — so the payload does not repeat them; it carries
    /// the additional facts the tree view needs beyond identity: which [model slot](GgSlotBinding)
    /// the agent runs on, the concrete model that slot resolved to, the agent's depth in the
    /// tree, and (for a subagent) the brief it was dispatched with. The `agent_id`/
    /// `parent_agent_id` and the `slot`/`modelId` together are why gg usage is accounted **per
    /// slot** (see [`SlotUsage`](Self::SlotUsage)) rather than for one model.
    AgentSpawned {
        /// The [agent profile](GgAgentConfig) name this agent runs under (for example
        /// [`ROOT_AGENT`], or an operator-named profile). gg usage is accounted per profile
        /// (see [`SlotUsage`](Self::SlotUsage)); the field keeps its `slot` name for wire
        /// stability, but it now names the agent profile rather than a role slot.
        slot: String,
        /// The concrete model id this agent's [profile](Self::AgentSpawned::slot) is bound to
        /// — the seam that makes a run span several models, one per profile.
        model_id: String,
        /// The agent's depth in the [subagent tree](https://docs.testcabinet.ai/gg/subagents/):
        /// `0` for the root, `parent.depth + 1` for a spawned child. A spawn that would exceed
        /// the configured maximum depth fails as a
        /// [limit](GgToolFailure::LimitExceeded) rather than being queued — a *ceiling*, not a
        /// [refusal](GgToolFailure::Refused): the request was well-formed, the run simply has no
        /// room left below the spawner.
        depth: u64,
        /// The task/issue brief the agent was dispatched with, when it is a subagent spawned to
        /// do a scoped piece of work. Absent for the root agent, which is driven by the run's
        /// build prompt rather than a delegated brief.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        brief: Option<String>,
        /// The isolated git worktree this agent runs in — its branch — when it was dispatched into
        /// one: an [issue](CAPABILITY_PROJECT_MANAGEMENT) agent (and the reviewers of that issue,
        /// which read the same tree) runs on the issue's branch. The console renders this
        /// as a worktree indicator on the tree node. Absent for an agent running in the shared main
        /// tree (the root, an ad-hoc subagent, the merge agent), whose edits land directly in the
        /// workspace. A worktree's result is later merged or discarded — observe which with
        /// [`WorktreeMerged`](Self::WorktreeMerged).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        worktree: Option<String>,
        /// The **working directory** this agent's file and shell tools are rooted at — the
        /// directory a command it runs without an explicit path executes in. It is the checkout of
        /// the agent's isolated [worktree](Self::AgentSpawned::worktree) when it was dispatched into
        /// one, and the shared workspace otherwise, so the two together say both *which branch* an
        /// agent works on and *where on disk* that is.
        cwd: String,
    },
    /// The [modules](GgModuleKind) one agent instance holds, as it opens: what each is, which
    /// backing store it is a holder of, whose it is, and whether the agent's prompt carries it.
    ///
    /// Emitted **once per incarnation, for every instance** — the root, every subagent, every
    /// successor — immediately after that instance's [`AgentSpawned`](Self::AgentSpawned) (and its
    /// [`FsmState`](Self::FsmState), when it stands in a machine). It is the only event that
    /// reports a module an agent holds but has not yet *touched* — a read-only inherited memory
    /// holder that never writes emits no [`MemoryState`](Self::MemoryState) of its own — and the
    /// only one that reports [ownership](GgModuleOwnership) as data rather than as a log line.
    ///
    /// A roster does not change within an incarnation: every operation that changes what an agent
    /// holds (an `exec`, an [FSM](CAPABILITY_FSM) transition, a `fork`) mints a new agent id, and
    /// the new instance emits its own. So it is emitted once and never re-emitted, and it carries
    /// deliberately **no holder count** — a point-in-time count is stale the moment a sibling
    /// spawns, while a consumer holding every instance's roster already knows the exact holder set,
    /// including which of those holders are still running.
    AgentModules {
        /// One entry per [kind](GgModuleKind::ALL), in kind order — including the kinds this
        /// instance's profile has switched off, so a capability left off is legible rather than
        /// absent.
        modules: Vec<GgAgentModule>,
    },
    /// What one agent instance is **offered**: the calls it may make, as its incarnation opens —
    /// the other half of the pair [`AgentModules`](Self::AgentModules) opens, which says what it
    /// *holds*.
    ///
    /// Emitted **once per incarnation, for every instance** — the root, every subagent, every
    /// successor — immediately after that instance's [`AgentModules`](Self::AgentModules), and
    /// un-gated: an agent offered nothing at all still reports an empty surface, which is a finding
    /// rather than an absence. It is
    /// emitted once and never re-emitted, for the same reason a roster is: everything that changes
    /// what an agent holds — an `exec`, an [FSM](CAPABILITY_FSM) transition, a `fork` — mints a new
    /// agent id, and the new instance reports its own surface.
    ///
    /// It exists because *"the model was never given that call"* and *"the model was given it and
    /// never made it"* are different findings, and nothing else in the record tells them apart: a
    /// [`ToolCall`](Self::ToolCall) or an [`ApiCall`](Self::ApiCall) reports only what was called,
    /// and re-deriving the offered set from the run's capability set cannot know about a
    /// [module binding](GgModuleKind), a [memory](CAPABILITY_MEMORIES) strategy, where the instance
    /// stands in its machine, or the [allowlist](GgAgentConfig::tools) its profile narrowed an
    /// enabled capability to. What is reported here is the resolved, post-gating set — so a consumer
    /// joining it to this agent's calls can say which of the two happened.
    ///
    /// The two [execution modes](Self::AgentSurface::execution_mode) are independent surfaces over
    /// one core and an instance has **exactly one** of them, so the payload carries a field per
    /// surface and exactly one of them is populated: [`tools`](Self::AgentSurface::tools) for a
    /// tool-calling instance, [`apis`](Self::AgentSurface::apis) for a responses-as-code one. The
    /// two vocabularies are scoped, not two spellings of one list — a tool name is never callable
    /// from a program, and an operation id is never callable as a tool.
    ///
    /// # It is where a within-run comparison reads its arm from
    ///
    /// Three of these fields are per-**agent** settings rather than per-run ones — the
    /// [execution mode](Self::AgentSurface::execution_mode), the
    /// [program language](Self::AgentSurface::program_language), and the
    /// [documentation-view type mode](Self::AgentSurface::doc_view_types) — so one run can hold two
    /// agents that differ in any of them. That is deliberate, and it is what makes an A/B *within*
    /// one run possible: both arms then share the task, the workspace, the models and the wall
    /// clock, so a difference between them is a difference the knob made. Every one of the three is
    /// reported here, on the event emitted once per incarnation, because a study that cannot read
    /// an agent's arm off the record cannot attribute anything to it — and the run's log is not the
    /// record.
    AgentSurface {
        /// How this instance answers a turn: `tool_calling`, or `responses_as_code` when the
        /// [capability](CAPABILITY_RESPONSES_AS_CODE) is on for its profile. It is a per-agent
        /// property, not a run-wide one — one run may drive a code-shaped root and a tool-calling
        /// reviewer — which is why it is reported here rather than read off the session summary.
        execution_mode: String,
        /// The [language](GgProgramLanguage) this instance's programs are written in, or `None` for
        /// a tool-calling instance, which writes none.
        ///
        /// Per-agent for exactly the reason [`execution_mode`](Self::AgentSurface::execution_mode)
        /// is: responses-as-code is a per-agent capability, so one run may drive its root in one
        /// language and (once a second language is registered) a reviewer in another.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        program_language: Option<GgProgramLanguage>,
        /// Which SDK types an `openDocsView` of a function opens **beside** it for this instance —
        /// `off` (none), `return` (the return position, the default), or `return-and-parameters`
        /// (everything the signature names). `None` for a tool-calling instance, which opens no
        /// documentation views.
        ///
        /// The value is the mode gg **resolved**, which since an unreadable one is refused at
        /// launch is always the mode the profile wrote. It is reported as the resolved value rather
        /// than the raw text so a profile that named none reports the default it actually ran on
        /// instead of an absence.
        ///
        /// It is reported for one reason, and the reason decides the field rather than decorating
        /// it. The three modes are meant to be compared against each other — opening the return
        /// type is not obviously cheaper than opening nothing, since a returned record's own fields
        /// may send the agent back for two more lookups — and the comparison is only worth anything
        /// if a reader of the events can tell which arm an agent was on. Joined by
        /// [`agent_id`](GgTelemetryEvent::agent_id) to that agent's per-band
        /// [context breakdown](Self::ContextBreakdown) — the
        /// [documentation band](GgContextSource::DocsView) and the
        /// [search band](GgContextSource::SearchResults) beside it — and to its
        /// `views.open_docs_view` [calls](Self::ApiCall), it is what makes *"which mode was this
        /// agent on, and what did it cost"* answerable from the stream alone.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        doc_view_types: Option<String>,
        /// Every gg tool name a **tool-calling** instance is offered, in the order the model is
        /// shown them: the registry's tools in registration order, then the ending calls its
        /// dispatched role may end with (`finish`, or a reviewer's `approve`/`request_changes`, or
        /// a judge's `select_winner`).
        ///
        /// The ending calls are appended by the loop rather than contributed by a capability, and
        /// are included here because the model is genuinely offered them every turn — a surface
        /// that omitted them would answer *"was `finish` offered?"* with silence.
        ///
        /// Empty for a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) instance, which is offered
        /// no tools at all: it reaches the same typed implementations through the API surface
        /// [`apis`](Self::AgentSurface::apis) enumerates, under operation ids the tool vocabulary
        /// does not share and cannot be joined to.
        tools: Vec<String>,
        /// The capability modules a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) program
        /// binds, in the order the system prompt lists them. Empty for a tool-calling agent, which
        /// has no such surface — not merely unknown for one.
        // Omitted from the wire whenever it is empty, which is every tool-calling agent — so it has
        // to declare its own optionality: the enum's `optional_fields` only reaches `Option<T>`, and
        // a consumer promised an array the record does not carry would read `undefined.length`.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        apis: Vec<GgAgentApi>,
    },
    /// A per-[slot](GgSlotBinding) usage/cost rollup for the run so far — the accounting that
    /// replaces "one figure for one model" now that a run spans several models.
    ///
    /// Because subagents can run on different, possibly cross-provider, slots than the parent,
    /// usage and cost are accumulated **per slot** (and per model within a slot). This event is
    /// a rollup the console renders as a per-slot cost breakdown; it is **not** a per-turn delta
    /// (the incremental [`Usage`](Self::Usage) events are what consumers sum for the run total),
    /// so an ingester must not add `SlotUsage` into the run total or it would double-count. One
    /// `SlotUsage` is emitted per `(slot, model)` the run touched.
    SlotUsage {
        /// The slot this rollup accounts for.
        slot: String,
        /// The model id (within the slot) this rollup accounts for. A slot normally resolves to
        /// one model, but the accounting keys on the model too so a re-pointed slot stays
        /// attributable.
        model_id: String,
        /// The tokens accumulated on this slot/model across the run, in the shared
        /// [`TokenCounts`] units.
        tokens: TokenCounts,
        /// The cost accumulated on this slot/model, when any turn on it reported one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cost: Option<Cost>,
    },
    /// An agent [transitioned](https://docs.testcabinet.ai/gg/subagents/) between lifecycle
    /// states — the running/blocked/done/failed transitions the console animates on the live
    /// agent tree.
    ///
    /// Emitted when the [subagents](CAPABILITY_SUBAGENTS) capability is enabled, as each agent
    /// moves through its lifecycle: [`Running`](GgAgentStatus::Running) once it acquires a slot
    /// and begins (right after its [`AgentSpawned`](Self::AgentSpawned)),
    /// [`Blocked`](GgAgentStatus::Blocked) when it frees its slot to
    /// [wait](https://docs.testcabinet.ai/gg/subagents/#scheduling) on its subagents,
    /// [`Running`](GgAgentStatus::Running) again when it resumes, and terminally
    /// [`Done`](GgAgentStatus::Done)/[`Failed`](GgAgentStatus::Failed). Like
    /// [`AgentSpawned`](Self::AgentSpawned), the agent's identity is the event's own
    /// [`agent_id`](GgTelemetryEvent::agent_id) (the event is emitted on that agent's scoped
    /// stream), so the payload carries only the new status.
    AgentStatus {
        /// The agent's new lifecycle status.
        status: GgAgentStatus,
        /// What the agent is **waiting on**, on a [`Blocked`](GgAgentStatus::Blocked) transition:
        /// the condition that has to be met before the scheduler grants it a slot again — for
        /// example `issue AUTH-1.0` for a [`wait_for_issue`](CAPABILITY_PROJECT_MANAGEMENT), or the
        /// subagents a [`wait_for_subagents`](CAPABILITY_SUBAGENTS) is collecting. A blocked agent
        /// is otherwise indistinguishable from a stuck one, so the console shows this beside the
        /// status. Absent on every non-blocking transition.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        waiting_on: Option<String>,
    },
    /// A subagent [returned](https://docs.testcabinet.ai/gg/subagents/) to the agent that
    /// spawned it — the event that closes a node of the agent tree and carries the child's
    /// result back for the console.
    ///
    /// Emitted (when the [subagents](CAPABILITY_SUBAGENTS) capability is enabled) once, on the
    /// **returning subagent's** own scoped stream, as its turn loop ends — so the returning
    /// agent is the event's [`agent_id`](GgTelemetryEvent::agent_id) and its spawner is the
    /// [`parent_agent_id`](GgTelemetryEvent::parent_agent_id). The `summary` is the child's
    /// return value the parent receives (its final assistant message, or a short status when it
    /// produced none). The root agent has no spawner and so emits no `AgentReturned`.
    AgentReturned {
        /// The subagent's return value: its final assistant message, or a short status line when
        /// the loop produced no final text.
        summary: String,
    },
    /// The outcome of reconciling an isolated worktree back into the main tree — the event that
    /// makes a **merge vs discard** observable.
    ///
    /// Emitted once per worktree as it is torn down: for an accepted (or failed)
    /// [issue](CAPABILITY_PROJECT_MANAGEMENT), on the issue's own stream. The three states are
    /// distinguishable: an **accepted** branch merges back
    /// (`merged: true`, with [`conflicts`](Self::WorktreeMerged::conflicts) recording whether the
    /// [merge agent](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) had to resolve a clash on the way); a
    /// **conflict the merge agent could not resolve** leaves the main tree unchanged
    /// (`merged: false, conflicts: true`) rather than dropping the work silently; a **failed or
    /// discarded** branch is removed unmerged (`merged: false, conflicts: false`). The worktree and
    /// its branch are removed in every case.
    WorktreeMerged {
        /// The branch the worktree's work lived on (for example `gg/issue-3`).
        branch: String,
        /// Whether the branch was merged back into the main tree — `true` for a clean merge **and**
        /// for one the merge agent resolved; `false` for an unresolved conflict or a discard.
        merged: bool,
        /// Whether the merge hit a conflict. `true` both when the
        /// [merge agent](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) resolved it (`merged: true`) and
        /// when it could not (`merged: false`, main tree left unchanged), so the two are told apart
        /// by `merged`. Always `false` on a clean merge or a discard.
        conflicts: bool,
    },
    /// An [FSM](CAPABILITY_FSM) agent entered a state — the event that makes a machine's path
    /// through its own state table observable.
    ///
    /// Emitted once per incarnation, on the **incoming** agent instance's stream: once for the
    /// entry state (with no [`from`](Self::FsmState::from)) and once for every state the machine
    /// moves into thereafter. Together with the [`AgentTransition`](Self::AgentTransition) that
    /// precedes each move on the *outgoing* instance's stream, the pair says both what happened and
    /// what it carried.
    FsmState {
        /// The machine: the name of the **FSM shell** [profile](GgAgentConfig) whose `states` table
        /// is being driven. An agent may only ever be inside one, so this names the document the
        /// state came from.
        fsm: String,
        /// The [state](GgFsmState::name) just entered.
        state: String,
        /// The [agent profile](GgFsmState::agent) that state runs — which is also this agent
        /// instance's [`slot`](Self::AgentSpawned::slot), so a machine's cost splits per state
        /// agent in the [per-slot rollup](Self::SlotUsage).
        agent: String,
        /// The state the machine came from, or `None` for the entry state.
        from: Option<String>,
    },
    /// One agent instance was **replaced by** (or cloned into) another: an FSM
    /// [transition](GgFsmTransition), an `exec`, or a `fork`.
    ///
    /// Emitted on the **outgoing** instance's stream, immediately before the successor's
    /// [`AgentSpawned`](Self::AgentSpawned), so a reader walking one agent's timeline sees where it
    /// went rather than watching it stop and an unexplained second agent begin. It carries what
    /// happened to each [module](GgModuleKind) — the whole of what a successor did and did not
    /// inherit — because that is the difference between a handoff and a restart, and it is
    /// otherwise invisible in the record.
    AgentTransition {
        /// Which of the three [kinds](GgAgentTransitionKind) of succession this was.
        kind: GgAgentTransitionKind,
        /// The id of the agent instance that takes over (or, for a `fork`, of the copy).
        to_agent_id: String,
        /// The [agent profile](GgAgentConfig) the successor runs under.
        agent: String,
        /// The [FSM state](GgFsmState::name) the successor stands in once the succession has been
        /// applied, when it stands in one at all.
        ///
        /// Set for every [`fsm`](GgAgentTransitionKind::Fsm) transition, and also for an
        /// [`exec`](GgAgentTransitionKind::Exec) whose target is an **FSM shell**: gg resolves such
        /// a handoff to the machine's entry state, so the successor genuinely enters a process and
        /// the record has to say which state it entered. `None` for an `exec` into an ordinary
        /// profile and for a [`fork`](GgAgentTransitionKind::Fork), neither of which moves the
        /// agent within a machine — a fork of an agent standing in a state is a second worker, not
        /// a second position, and carries no state of its own.
        state: Option<String>,
        /// What happened to each [module](GgModuleKind) the two instances between them held, in
        /// [kind](GgModuleKind::ALL) order — the whole of what a successor did and did not
        /// inherit, and **which instance** it is now holding.
        ///
        /// One list rather than the three name lists this replaced (`transferred`/`dropped`/
        /// `initialized`), because those collapsed a per-kind decision the code actually makes: a
        /// fork chooses to link or copy per kind and then reported both as "transferred", so a
        /// copy's linked board and its copied task list were indistinguishable. Each row here
        /// carries its own [disposition](GgModuleDisposition) and the module instance on both
        /// sides, so a store that was swapped underneath a successor is visible as one.
        modules: Vec<GgTransitionModule>,
    },
    /// An [issue review](https://docs.testcabinet.ai/gg/project-management/) lifecycle transition —
    /// the event that makes the reviewer-gated acceptance of an [issue](GgBoardIssue) observable.
    ///
    /// Emitted (when the issue named [reviewers](GgBoardIssue::reviewers)) as gg reconciles the
    /// issue: once as [`Requested`](GgIssueReviewPhase::Requested) when a review round starts, then
    /// once per [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) round (carrying the
    /// reviewer's actionable [`items`](Self::IssueReview::items) the issue's assigned agent is then
    /// re-invoked to address), and finally once as [`Approved`](GgIssueReviewPhase::Approved) when
    /// every reviewer has approved and the issue is accepted. Because there is **no cycle limit**, a
    /// single issue may stream many `ChangesRequested` events before an `Approved` (or go straight
    /// to `Approved` on a clean first pass).
    ///
    /// Which [issue](GgBoardIssue) is under review rides on the event's own
    /// [`issue_id`](GgTelemetryEvent::issue_id) (the event is emitted on an issue-scoped stream), the
    /// same way an agent's identity rides on [`agent_id`](GgTelemetryEvent::agent_id) — so the
    /// payload carries only the phase-specific data. The reviewer agents themselves emit the usual
    /// [`AgentSpawned`](Self::AgentSpawned)/[`AgentStatus`](Self::AgentStatus)/[`AgentReturned`](Self::AgentReturned)
    /// events, also scoped to the issue under review. An issue filed without reviewers emits none.
    IssueReview {
        /// Which phase of the review lifecycle this transition is.
        phase: GgIssueReviewPhase,
        /// The reviewer's actionable items, on the
        /// [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) phase (the changes the issue's
        /// assigned agent must address before re-review). Absent on
        /// [`Requested`](GgIssueReviewPhase::Requested) and
        /// [`Approved`](GgIssueReviewPhase::Approved).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        items: Option<Vec<String>>,
        /// **Who** returned the [`items`](Self::IssueReview::items), on the
        /// [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) phase — the one reviewer that
        /// ended the round. Absent on the other two phases.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reviewer: Option<GgReviewer>,
        /// The reviewers that **approved** the work in this round, in the order they ran: every
        /// reviewer on an [`Approved`](GgIssueReviewPhase::Approved) phase, and the ones that
        /// approved *before* the reviewer that ended a
        /// [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) round. Absent on
        /// [`Requested`](GgIssueReviewPhase::Requested) (nobody has reported yet), and whenever
        /// nobody approved.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        approvals: Option<Vec<GgReviewer>>,
        /// The baseline commit the review diffed the work against — the commit the issue's worktree
        /// branched from. Absent when no git baseline could be established for the run.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        baseline: Option<String>,
    },
    /// A [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/programs/) **turn** — the
    /// event that makes a code-shaped turn observable: what gg had to do to the model's reply
    /// before it could run it, what the program then did, and whether it ended the run.
    ///
    /// Emitted (when the [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability is enabled)
    /// once per code-shaped turn, on the agent that emitted the reply, so it rides on that agent's
    /// own [`agent_id`](GgTelemetryEvent::agent_id). That includes a turn whose reply was **not a
    /// program at all** — prose, or an empty reply — which is prepared for the guest like anything
    /// else and is reported the same way a program that did not compile is: `ok: false` and an
    /// [`error`](Self::CodeExecution::error) carrying the compiler's diagnostic. One event per
    /// code-shaped turn is the invariant, and it is what makes
    /// [`code_executions`](GgSessionSummary::code_executions) the exact denominator for the run's
    /// [healing rollup](GgHealingSummary).
    ///
    /// The individual tool calls the program made still stream as ordinary
    /// [`ToolCall`](Self::ToolCall)/[`ToolResult`](Self::ToolResult) events in the order the
    /// program composed them — this event carries the *turn* itself: whether the program returned
    /// normally, how many tool calls it composed, how long its own execution took, and, when it did
    /// not return normally, the fault. A run with the capability off emits none.
    CodeExecution {
        /// Whether the program returned normally (`true`) or faulted, was stopped, or never
        /// existed (`false`). A failed code turn is a *turn* outcome fed back to the model, never
        /// a crash of the run. Independent of [`finished`](Self::CodeExecution::finished): a
        /// program that finished the run and then threw is `ok: false` with `finished` present.
        ok: bool,
        /// How many of the program's calls **reached the turn loop** and were dispatched against
        /// gg's real machinery — the shell, the filesystem, a store — rather than being answered
        /// inside the sandbox or refused before dispatch.
        ///
        /// It is *not* a count of tool calls, and no `ToolCall`/`ToolResult` pair is streamed beside
        /// any of them: a program has no tool surface, and what it shares with one is the typed
        /// implementation under the call, not the vocabulary above it. The name is the historical
        /// one for "reached a dispatch"; the events that bracket each of these are its
        /// [`ApiCall`](Self::ApiCall)/[`ApiResult`](Self::ApiResult) pair, like every other call the
        /// program made.
        ///
        /// A call the sandbox refused before it got that far — a turn-level transition, or an
        /// operation this agent was not granted — is not one of these and never inflates the count.
        tool_calls: u64,
        /// How many **model-facing API calls** the program made — one per
        /// [`ApiCall`](Self::ApiCall)/[`ApiResult`](Self::ApiResult) pair the turn produced. Every
        /// call a program makes is one of these; it is the complete count.
        ///
        /// It legitimately **exceeds** [`tool_calls`](Self::CodeExecution::tool_calls), and by two
        /// things: the calls that dispatch nothing (a view, an ending, a program-library call), and
        /// the calls the sandbox refused before dispatch (a spent wall-clock budget, an operation
        /// this agent was not granted) — the model made those, so the API layer counts
        /// them even though nothing ran. The two figures answer different questions and are not
        /// meant to agree.
        ///
        /// Omitted when zero: a program that made no calls at all.
        #[serde(default, skip_serializing_if = "is_zero_u64")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        api_calls: u64,
        /// How long the program's **own execution** took, in milliseconds — the wall-clock time it
        /// spent running, excluding time parked in a bridged tool call, which is the per-program
        /// efficiency signal.
        /// Reported on every path that reached the engine, including a fault, a trap, or an
        /// [execution-timeout](https://docs.testcabinet.ai/gg/responses-as-code/sandbox/) stop (where it is
        /// the time burned up to the stop, not the ceiling); `Some(0)` when the program never
        /// reached the engine (a program that would not prepare, or a sandbox that could not be
        /// built).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        /// The failure message, when [`ok`](Self::CodeExecution::ok) is `false` — a program fault
        /// (a syntax error the language's prepare step rejected, or a value the program threw) or a sandbox
        /// failure (an execution timeout or memory exhaustion, a trap). Absent on a clean
        /// execution.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        /// The summary the program ended the **run** with, when it called `finish` — the one
        /// function on the sandbox's model-facing surface that is not a tool, and the only thing
        /// that ends a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) session.
        ///
        /// Present on exactly the turn that finished, absent on every other, so `finished != null`
        /// is both "did this turn end the run?" and "with what?" — and, over a run, the proof that
        /// the session ended because the model said so rather than because a ceiling stopped it. It
        /// is carried even when the program then threw or trapped: the completion is recorded
        /// before either can exist and nothing retracts it. The same text is the session's final
        /// text (a subagent's return value to its spawner).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        finished: Option<String>,
        /// Everything the program wrote with `console.*`, in order, subject to the sandbox's
        /// capture caps (200 lines, 16 KiB, 2 KiB per line — the tail is what is kept).
        ///
        /// **This is the only place a program's output is recorded.** `console.*` is not a channel
        /// into the model's own context window — what a program shows *itself* is a
        /// [view](GgContextSource::TextView), which arrives as its own attributable context message
        /// — so a log line goes to whoever is watching the run and nowhere else. Carrying the lines
        /// on the turn's own event is what keeps that true: without them, a program's diagnostic
        /// output would exist only for the instant it crossed the sandbox membrane, and an operator
        /// reading a finished run, a replay, or an analysis over a thousand runs could not see what
        /// any program printed.
        ///
        /// Absent (an empty list) for a turn that logged nothing and for a reply that was not a
        /// program at all.
        // Omitted from the wire when the program printed nothing, which is most turns — so, like
        // `healing` below, it has to declare its own optionality: the enum's `optional_fields` only
        // reaches `Option<T>`, and a consumer promised an array the record does not carry would
        // read `undefined.length`.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        logs: Vec<String>,
        /// How many log lines the capture caps discarded, so a reader of a capped list knows it is a
        /// tail rather than the whole of what the program wrote. `0` for the ordinary turn.
        #[serde(default, skip_serializing_if = "is_zero_u64")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        logs_suppressed: u64,
        /// How long **this** program spent obtaining the sandbox's compiled interpreter component,
        /// in milliseconds — absent (the ordinary case) when the component was already compiled and
        /// nothing here was on the turn's critical path.
        ///
        /// The component is compiled once per process, and a run that enables the capability starts
        /// that compile before its first model request. But starting it early only **overlaps** it
        /// with the request rather than eliminating it: on a run container with one or two cores the
        /// compile takes seconds, so a model that answers quickly gets its first program back before
        /// the warm-up has finished, and that program compiles the component itself. This is the
        /// figure that says so — without it, "did this program wait on the one shared compile or is
        /// it genuinely slow?" is only answerable by comparing timestamps across sibling runs.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        compile_wait_ms: Option<u64>,
        /// How long **compiling for this turn** took, in milliseconds — the whole of the
        /// language's prepare step, including any compiler it shells out to.
        ///
        /// Everything the turn made its compiler do is in it: the program the model wrote, each
        /// replacement it handed over to, the code half of every skill or memory the turn brought
        /// into use, and each on-use script such a read queued. A code skill is compiled again on
        /// every agent that reads it, so leaving those out would make a skill-heavy compiled arm
        /// report less than it spent.
        ///
        /// Absent for a language that compiles nothing — one whose prepare step is in-process and
        /// free, where the figure would be a zero on every turn of every run. No registered
        /// language is one, since TypeScript type-checks with `tsc`. Present on
        /// **every** turn of a language that compiles, including the turn whose program the
        /// compiler rejected — a compile that failed after four seconds cost those four seconds,
        /// and that turn is the one that would otherwise report nothing.
        ///
        /// Distinct from [`compile_wait_ms`](Self::CodeExecution::compile_wait_ms), which is the
        /// one shared *interpreter component* compile and belongs to the process rather than to
        /// this program. This field exists because without it a compiled language's per-turn cost
        /// is invisible: the sandbox's own clock starts after the program is prepared, so the time
        /// lands in neither [`duration_ms`](Self::CodeExecution::duration_ms) nor `compileWaitMs`
        /// and is absorbed into the turn's [response time](Self::TurnTiming::response_ms) alongside
        /// minutes of `shell` — which is to say a compiled arm and an interpreted one could not be
        /// compared on what compiling cost them, which is the first thing such a study asks.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        compile_ms: Option<u64>,
        /// What gg had to do to this reply before running it, and whether it was a program at all.
        /// Defaulted and omitted from the wire for a clean response, so the presence of this
        /// object *is* "something was unusual about this response".
        // The enum's `optional_fields` only reaches `Option<T>` fields, so this — the one
        // omitted field here that is not an `Option` — must declare its own optionality or the
        // TypeScript binding would promise consumers an object the wire does not always carry.
        // `optional = nullable` keeps the rendered type as-is and only adds the `?`.
        #[serde(default, skip_serializing_if = "GgResponseHealing::is_clean")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        healing: GgResponseHealing,
    },
    /// How one agent turn ended, as gg judged it — the event that makes a run's **error rate**
    /// observable.
    ///
    /// Emitted exactly once per turn, on the agent that took it, from the one seam where gg records
    /// an outcome against that agent's [error ceilings](GgRunLimits) — so this event and the
    /// ceilings can never disagree about what an error is, and every outcome is reported. A run
    /// emits one of these per model call it made,
    /// which makes [`turns`](Self::TurnOutcome::turns) the exact denominator for the run's
    /// [error rollup](GgErrorSummary).
    ///
    /// Distinct from [`CodeExecution`](Self::CodeExecution), which reports what one *program* did
    /// and only exists under [responses-as-code](CAPABILITY_RESPONSES_AS_CODE): this is the
    /// mode-agnostic judgement of the **turn**, and a tool-calling run emits it too.
    TurnOutcome {
        /// How the turn ended. [`Error`](GgTurnOutcome::Error) is the only outcome the error
        /// ceilings count.
        outcome: GgTurnOutcome,
        /// Why the turn was an error, on an [`Error`](GgTurnOutcome::Error) outcome. Absent on every
        /// other outcome, so `error != null` and `outcome == "error"` are the same statement — the
        /// kind is carried separately because a run that alternates between six ways of failing and
        /// one that fails the same way six times are the same to a ceiling and very different to a
        /// person reading the run.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<GgTurnErrorKind>,
        /// Why it was an error **specifically** — the [type](GgTurnErrorType) under the base
        /// [kind](Self::TurnOutcome::error) beside it.
        ///
        /// Present on exactly the turns `error` is present on, and `error_type.kind() == error` by
        /// construction: gg holds one value and derives both halves from it when it emits this
        /// event, for the same reason the outcome and the kind are settled together — a reader that
        /// could be handed a base and a type from two different mechanisms could be handed two that
        /// disagree. So `error != null && errorType == null` never occurs, and a reader ranking
        /// types never has to account for an errored turn that named none.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error_type: Option<GgTurnErrorType>,
        /// This agent's consecutive-error run **after** this turn — `0` on any non-error turn, since
        /// only a turn that carried out its declared work clears the count.
        ///
        /// Carried per turn rather than re-derived by a reader because the count is **per agent**
        /// and a stream is run-wide: turns from concurrently running agents interleave arbitrarily,
        /// so a reader folding the stream could only reconstruct a run-wide streak, which is an
        /// artefact of scheduling rather than a fact about any agent. Taking the maximum of this
        /// field is what makes [`GgErrorSummary::max_consecutive`] correct.
        consecutive_errors: u64,
        /// How many turns this agent has recorded, **including this one** — its own running total,
        /// not the run's. The per-agent denominator, and the same figure the turn ceiling is
        /// measured against.
        turns: u64,
        /// How many model responses [loop detection](GgLoopDetection) discarded before this turn
        /// produced one, when any were. `0` — and omitted from the wire — for the ordinary turn, and
        /// for every turn of every run that left the capability disarmed, which is the default.
        ///
        /// This is the **one** place discarded attempts are published. A discarded attempt is never
        /// a turn of its own (it produced nothing, and the request was retried), so it has no
        /// `TurnOutcome` event to be counted on; carrying it on the turn that eventually succeeded
        /// keeps the count on the stream without inventing an event for a reply that does not exist,
        /// and lets [`GgErrorSummary::loop_aborts`] be a plain sum over these.
        #[serde(default, skip_serializing_if = "is_zero_u64")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        loop_aborts: u64,
    },
    /// An [execution ceiling](GgRunLimits) was breached and the agent's loop is ending on it.
    ///
    /// Emitted once per agent that stops on a ceiling, on that agent's own stream, immediately
    /// before its loop returns — so it always precedes the run's
    /// [`SessionSummary`](Self::SessionSummary)/[`SessionEnded`](Self::SessionEnded), and a run
    /// whose **root** stopped on one carries the same breach on
    /// [`GgSessionSummary::limit_hit`]. A run that breaches nothing emits none.
    ///
    /// A structured event rather than only a log line because "which ceiling ends my runs, at what
    /// value?" is a question a study asks of thousands of runs, and prose cannot be grouped by.
    LimitExceeded {
        /// Which ceiling was breached, what it was set to, and what was observed. Its own
        /// [`agent_id`](GgLimitBreach::agent_id) duplicates this event's envelope deliberately:
        /// the same payload is also the session summary's, and a self-contained record is worth
        /// one repeated string.
        breach: GgLimitBreach,
    },
    /// A diagnostic log line from gg itself (not agent output).
    Log {
        /// The severity level (for example `"info"`, `"warn"`, or `"error"`).
        level: String,
        /// The log message.
        message: String,
    },
    /// The final, aggregatable [summary](GgSessionSummary) of the whole session — the compact
    /// per-run outcome [result aggregation](https://docs.testcabinet.ai/gg/result-aggregation/)
    /// slices and correlates across many runs.
    ///
    /// Emitted exactly once, **immediately before** [`SessionEnded`](Self::SessionEnded), on the
    /// [root agent](https://docs.testcabinet.ai/gg/subagents/)'s stream. gg computes the summary
    /// from the telemetry it emitted over the run (counting each figure as the relevant event
    /// fired), so the summary and the stream it summarizes are consistent by construction. `core`
    /// lifts this event onto the run record
    /// ([`RunSubject::gg_summary`](crate::run_record::RunSubject::gg_summary)) so aggregate queries
    /// need not re-parse the stream. A launch that failed before a session ran emits none (only a
    /// terminal `SessionEnded`).
    SessionSummary {
        /// The computed summary of the session's outcome. Boxed so this variant does not
        /// dominate the size of [`GgTelemetryKind`] (and the [`EventKind`](crate::event::EventKind)
        /// that carries a whole [`GgTelemetryEvent`]); `Box<T>` serializes and renders in the
        /// contract exactly as `T`.
        summary: Box<GgSessionSummary>,
    },
    /// A gg session ended.
    SessionEnded {
        /// How the session ended, as one of gg's ten status words — and here they all are:
        /// `"completed"`; the three ceiling endings `"exhausted"`, `"timed_out"` and
        /// `"limit_exceeded"`; an operator's `"canceled"`; the four failures `"model_error"`,
        /// `"auth_error"`, `"hook_error"` and `"internal_error"`; and `"error"` for a session that
        /// never launched, which is the one value [`GgSessionSummary::terminal_status`] cannot carry,
        /// because a launch failure has nothing to summarize.
        ///
        /// Listed in full rather than sampled with a few: a consumer branching on this is deciding
        /// whether a run is scoreable at all, and the words that decide it — `"error"`,
        /// `"auth_error"` and `"internal_error"`, the three gg exits non-zero on — are exactly the
        /// ones a short example list leaves out.
        status: String,
    },
}

#[cfg(test)]
#[path = "gg.test.rs"]
mod tests;
