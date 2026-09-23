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
use serde_json::{Value, json};

use crate::gg_session_record::{GgShellCwd, GgShellOrigin};
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

/// The exit code the `gg` binary leaves when a run was stopped by one of its own
/// [execution ceilings](GgRunLimits).
///
/// It lives in the shared contract because it is a contract: gg writes it and
/// [`gg_exec`](crate::gg_exec) reads it, and the two crates never link each other. A
/// number each of them believed in separately would be a rule nothing in the workspace
/// could check, and the failure would surface as a breached ceiling silently recorded as
/// an ordinary harness error.
///
/// It is distinct from `1`, which gg leaves for a launch fatal and for the two endings that
/// are nobody's measurement (a refused credential, a gg defect), because the two say
/// opposite things about the configuration. A `1` says the run never happened; this says the
/// run happened and ran into a bound the operator armed, which is why it becomes its own
/// [`RunState::LimitExceeded`](crate::run_record::RunState::LimitExceeded) rather than a
/// [`HarnessError`](crate::run_record::RunState::HarnessError) the host would retry. `2` is
/// left alone: a shell reads it as a usage error.
pub const EXIT_LIMIT_EXCEEDED: u8 = 3;

/// The stable id of the Phase 0 shell capability: the agent's ability to run shell
/// commands in the run container (the `shell` tool).
///
/// Its [implementation](GgCapabilityConfig::implementation) selects where a command's
/// output goes — [`inline`](SHELL_OUTPUT_INLINE) or [`offload`](SHELL_OUTPUT_OFFLOAD) — and
/// its `maxLines`/`maxChars` params set the ceiling offloading leaves the agent. A chatty
/// build is one of the few things that
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

/// Every [shell](CAPABILITY_SHELL) output mode, for the launch-time check that a set names one
/// gg recognizes. [`offload`](SHELL_OUTPUT_OFFLOAD) is first, and is the arm the
/// [authoring catalog](gg_authoring_catalog) writes into a new document.
pub const SHELL_OUTPUT_MODES: [&str; 2] = [SHELL_OUTPUT_OFFLOAD, SHELL_OUTPUT_INLINE];

/// The [shell](CAPABILITY_SHELL) capability's `maxLines` param: how many trailing **lines** of a
/// command's output come back inline under [offloading](SHELL_OUTPUT_OFFLOAD).
///
/// An enabled shell capability writes it whichever mode it selects, so a sweep that varies the
/// mode over one shared params block reads the same ceiling on every arm. Absent, the launch is
/// refused: a truncating mode is defined by the ceiling it truncates past, and one gg picked would
/// be the control arm run under the treatment arm's name.
pub const PARAM_MAX_LINES: &str = "maxLines";

/// The [shell](CAPABILITY_SHELL) capability's `maxChars` param: how many trailing **characters**
/// of a command's output come back inline under [offloading](SHELL_OUTPUT_OFFLOAD).
///
/// Written and required on exactly the terms [`maxLines`](PARAM_MAX_LINES) is. The tighter of the
/// two decides, because the result has to satisfy both.
pub const PARAM_MAX_CHARS: &str = "maxChars";

/// How many trailing **characters** of each of a command's streams a
/// [`Shell`](GgTelemetryKind::Shell) telemetry event carries.
///
/// Characters rather than bytes, on the same terms as [`maxChars`](PARAM_MAX_CHARS): a ceiling
/// means the same thing whatever the output is written in. The full streams live in the
/// [session record](crate::gg_session_record::GgSessionCommand); the telemetry cap only bounds
/// what the live stream repeats of them.
pub const GG_SHELL_EVENT_STREAM_CHARS: usize = 16 * 1024;

/// The stable id of the read-file capability: the agent's ability to read a file in the
/// run workspace (the `read_file` tool).
///
/// Its [implementation](GgCapabilityConfig::implementation) selects how much of a file one
/// call may return — the [unlimited](READ_MODE_UNLIMITED) and
/// [default-cap](READ_MODE_DEFAULT_CAP) [read modes](https://docs.testcabinet.ai/gg/filesystem/)
/// — and its [`lineCap`](PARAM_LINE_CAP) param sets the window a call that asks for no `limit` of
/// its own is given. How a coding agent copes when it only sees a file a window at a time unless
/// it asks for more is a first-class experimental variable, so it is configured rather than
/// hardcoded. Neither mode can *refuse* a whole-file read: an explicit larger `limit` is always
/// honoured.
pub const CAPABILITY_READ_FILE: &str = "read-file";

/// The [read-file](CAPABILITY_READ_FILE) capability's `lineCap` param: how many lines a call that
/// names no `limit` of its own is given under [`default-cap`](READ_MODE_DEFAULT_CAP).
///
/// An enabled capability writes it whichever mode is selected, which is what lets one sweep vary
/// the mode over a shared params block and have every launch in it judged the same way. Absent, or
/// naming no line count of one or more, the launch is refused.
pub const PARAM_LINE_CAP: &str = "lineCap";

/// The [read-file](CAPABILITY_READ_FILE) [implementation](GgCapabilityConfig::implementation)
/// under which one call returns the whole file.
pub const READ_MODE_UNLIMITED: &str = "unlimited";

/// The [read-file](CAPABILITY_READ_FILE) [implementation](GgCapabilityConfig::implementation)
/// under which a call that asks for no `limit` of its own returns
/// [`lineCap`](PARAM_LINE_CAP) lines, and one that asks for more is honoured.
pub const READ_MODE_DEFAULT_CAP: &str = "default-cap";

/// Both read modes, in the spelling a launch refusal offers back.
/// [`unlimited`](READ_MODE_UNLIMITED) is first, and is the arm the
/// [authoring catalog](gg_authoring_catalog) writes into a new document.
pub const READ_MODES: [&str; 2] = [READ_MODE_UNLIMITED, READ_MODE_DEFAULT_CAP];

/// The stable id of the write-file capability: the agent's ability to create or overwrite
/// a file in the run workspace (the `write_file` tool).
pub const CAPABILITY_WRITE_FILE: &str = "write-file";

/// The stable id of the edit-file capability: the agent's ability to patch a file in the
/// run workspace by exact, unique string replacement (the `edit_file` tool).
pub const CAPABILITY_EDIT_FILE: &str = "edit-file";

/// The stable id of the list-dir capability: the agent's ability to list a directory in
/// the run workspace (the `list_dir` tool).
pub const CAPABILITY_LIST_DIR: &str = "list-dir";

/// The stable id of the search capability: the agent's ability to search the run workspace's
/// files for a pattern and get back the matching lines, each with its path and 1-based line
/// number (the `search` tool; `files.search` under responses as code).
///
/// The search honours ignore files — what `.gitignore` and its kin exclude is never scanned and
/// never returned — because a search is a question about the project rather than about the disk.
/// Like the four editor primitives it is its own capability, so a study can withhold it without
/// disturbing them, and it is on in a fresh configuration.
pub const CAPABILITY_SEARCH: &str = "search";

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

/// The [context-window-override](CAPABILITY_CONTEXT_WINDOW_OVERRIDE) capability's `windowLimit`
/// param: the window to run this agent's model against, in tokens.
///
/// Narrowing is the whole of what the capability does, so an enabled one writes the figure it
/// narrows to and an absent one refuses the launch — an override with no figure is an override the
/// run would record and never apply. So does a `0`. The figure is a **ceiling** rather than the
/// window itself: the agent is measured against the smaller of it and the model's own window, so
/// one above the model's window narrows nothing and the run records the model's window as the
/// resolved one. That is what lets one configuration be reused across models of different sizes.
/// A profile that leaves the capability off is measured against the model's full window, and that
/// absence is the setting.
pub const PARAM_WINDOW_LIMIT: &str = "windowLimit";

/// The stable id of the autoload-specifications capability: when on, an agent's very
/// first context is seeded with the **full contents of every file the test case
/// provided** — its specifications and reference images — injected as though the model
/// had already `read_file`d each, so the model starts with the whole brief in the window
/// rather than having to discover and read it.
///
/// Off, the agent starts with only the build prompt and reads what it needs itself; on, it is a
/// distinct arm of the "does front-loading the whole spec help?" study. Its
/// [`implementation`](GgCapabilityConfig::implementation) is the **locked** lever, and it is the
/// one arm gg reads out of an implementation nobody wrote: written nowhere, the specs are injected
/// as ordinary, ephemeral file reads that [compaction](CAPABILITY_COMPACTION) may summarize away
/// and [agent-managed context](CAPABILITY_AGENT_MANAGED_CONTEXT) may evict, while
/// [`AUTOLOAD_LOCKED_IMPL`] pins them so they are kept in the window verbatim across every
/// compaction boundary and cannot be evicted.
pub const CAPABILITY_AUTOLOAD_SPECS: &str = "autoload-specs";

/// The [`implementation`](GgCapabilityConfig::implementation) of
/// [`CAPABILITY_AUTOLOAD_SPECS`] that **locks** the autoloaded specifications into the
/// window — pinned across compaction and immune to eviction — rather than injecting them
/// as ordinary, droppable file reads, which is what an implementation written nowhere declares.
///
/// This is the capability's whole vocabulary, and the one place in gg where an unwritten
/// implementation is itself a declaration rather than an omission — the capability has one arm, so
/// the two states it can be in are "written" and "not". A profile naming any other implementation
/// is refused at launch: `lock` and `Locked` are not this arm, and a run that quietly took the
/// unlocked arm instead would record the locked one having been asked for.
pub const AUTOLOAD_LOCKED_IMPL: &str = "locked";

/// The [`params`](GgCapabilityConfig::params) key of [`CAPABILITY_AUTOLOAD_SPECS`] that decides
/// whether a seeded reference mockup is attached as a **picture**.
///
/// An enabled capability writes it, and an absent one — like one gg cannot read as a switch —
/// refuses the launch. Off, a mockup is still read and still takes its place in the seeded order:
/// it enters the window as the file view any read produces, carrying the label, format and byte
/// size, and the model reads the file itself when it wants to look. On, the picture rides along,
/// and rides along again on every request for as long as the view lives.
///
/// The switch is an arm of the study rather than a detail, which is why it is stated rather than
/// assumed: an image is charged by its dimensions rather than by its prose, so a case's mockups can
/// outweigh the specifications they illustrate. Does a model build better for having seen the
/// target?
///
/// A model that cannot see images is never sent one, so the param decides only what gg *offers*.
pub const AUTOLOAD_PARAM_IMAGES: &str = "images";

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

/// The [skills](CAPABILITY_SKILLS) capability's `dir` param: the directory this profile's authored
/// skills are loaded from. A relative path is joined onto the run workspace and an absolute one is
/// taken as given.
///
/// Skills belong to an agent, so each profile that enables the capability names its own directory,
/// and an enabled capability that names none refuses the launch. gg writes nothing into the named
/// directory, so a profile that is to hold gg's [built-ins](PARAM_BUILT_INS) alone points this at
/// a directory the workspace carries and leaves empty.
pub const PARAM_SKILLS_DIR: &str = "dir";

/// The [skills](CAPABILITY_SKILLS) capability's `builtIns` param: which of the skills gg ships
/// this agent is offered.
///
/// Read the way every toggle set in gg is — an object recording only the ones switched **off**, so
/// `{}` is the declaration that offers all of them — and written by every enabled capability,
/// which is what makes `{}` a declaration rather than a silence. An absent `builtIns`, a value
/// that is not an object of toggles, and a key naming no skill gg ships each refuse the launch.
pub const PARAM_BUILT_INS: &str = "builtIns";

/// The stable id of the Phase 1 memories capability: the same mechanism as
/// [`CAPABILITY_SKILLS`] but curated by the model itself and bounded in count and
/// length, so self-curated memory cannot crowd out the working context.
///
/// Its [`implementation`](GgCapabilityConfig::implementation) selects the **memory
/// strategy** — how the model's notes are organized, and how much of them the window
/// carries. Three strategies ship, and they differ in what is *always* in context:
///
/// - [`scratchpad`](MEMORY_STRATEGY_SCRATCHPAD) — a small, bounded set whose
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
/// into the workspace. An enabled capability **names its strategy**, and one that names none, or
/// one gg does not recognize, fails the launch and is told the three that exist: the arm is the
/// independent variable, so a run gg picked an arm for would be a measurement of the wrong thing.
///
/// An enabled capability writes its [`scope`](MEMORY_PARAM_SCOPE) and all six limits —
/// [`maxCount`](PARAM_MAX_COUNT), [`maxLenPerMemory`](PARAM_MAX_LEN_PER_MEMORY),
/// [`maxTotalLen`](PARAM_MAX_TOTAL_LEN), [`maxLenIndex`](PARAM_MAX_LEN_INDEX),
/// [`maxLenDescription`](PARAM_MAX_LEN_DESCRIPTION) and [`maxResults`](PARAM_MAX_RESULTS) —
/// whichever strategy it selects, which is what lets one sweep hand every arm the same params
/// block. [`GgMemoryCaps`] is the resolved form, and a limit a strategy does not apply is `None`
/// there whatever the params say.
pub const CAPABILITY_MEMORIES: &str = "memories";

/// The [memories](CAPABILITY_MEMORIES) strategy that keeps a small, bounded set of notes
/// whose **bodies are all pinned in the context window**, retained across a
/// [compaction](CAPABILITY_COMPACTION) boundary verbatim: `write_memory` /`update_memory` /
/// `delete_memory`, bounded by all three of [`max_count`](GgMemoryCaps::max_count),
/// [`max_len_per_memory`](GgMemoryCaps::max_len_per_memory) and
/// [`max_total_len`](GgMemoryCaps::max_total_len).
///
/// The arm the [authoring catalog](gg_authoring_catalog) writes into a new document. Nothing
/// *falls* to it: a memories capability that names no strategy, and one naming a strategy gg does
/// not recognize, each refuse the launch rather than landing here.
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
/// An enabled capability writes it, and an absent one refuses the launch: a scope decides which
/// agents share a notebook, and there is no reading of the record afterwards that would show a run
/// had silently been given private ones. An unrecognized value is refused on the same terms.
///
/// Meaningful only where memories are enabled: a profile that sets it with the capability off is
/// **refused** at launch, because the two together describe an intent gg cannot honour.
///
/// See [memories](https://docs.testcabinet.ai/gg/memories/) for what each scope does.
pub const MEMORY_PARAM_SCOPE: &str = "scope";

/// The [memories](CAPABILITY_MEMORIES) capability's `maxCount` param: how many memories the set
/// may hold at once.
///
/// One of the six limits an enabled capability writes whichever strategy it selects; `0` is how a
/// limit is turned **off**. An absent limit, and one naming no whole count, each refuse the launch.
/// Applied by the [scratchpad](MEMORY_STRATEGY_SCRATCHPAD) and
/// [keyword-search](MEMORY_STRATEGY_KEYWORD_SEARCH) strategies; under
/// [markdown](MEMORY_STRATEGY_MARKDOWN) the index that must list every memory is what bounds the
/// population.
pub const PARAM_MAX_COUNT: &str = "maxCount";

/// The [memories](CAPABILITY_MEMORIES) capability's `maxLenPerMemory` param: the characters one
/// memory's body may run to. Applied by every strategy, and written on the terms
/// [`maxCount`](PARAM_MAX_COUNT) is.
pub const PARAM_MAX_LEN_PER_MEMORY: &str = "maxLenPerMemory";

/// The [memories](CAPABILITY_MEMORIES) capability's `maxTotalLen` param: the characters every
/// memory body runs to together. It is the [scratchpad](MEMORY_STRATEGY_SCRATCHPAD)'s window
/// budget, since that is the strategy whose bodies are all pinned; written on the terms
/// [`maxCount`](PARAM_MAX_COUNT) is.
pub const PARAM_MAX_TOTAL_LEN: &str = "maxTotalLen";

/// The [memories](CAPABILITY_MEMORIES) capability's `maxLenIndex` param: the characters the
/// [markdown](MEMORY_STRATEGY_MARKDOWN) strategy's pinned index may run to, a create whose entry
/// would not fit being refused. Written on the terms [`maxCount`](PARAM_MAX_COUNT) is.
pub const PARAM_MAX_LEN_INDEX: &str = "maxLenIndex";

/// The [memories](CAPABILITY_MEMORIES) capability's `maxLenDescription` param: the characters one
/// memory's one-line description may run to.
///
/// Applied by every strategy, because the description is the one field every turn pays for — an
/// index line and a search hit are mostly description. Written on the terms
/// [`maxCount`](PARAM_MAX_COUNT) is.
pub const PARAM_MAX_LEN_DESCRIPTION: &str = "maxLenDescription";

/// The [memories](CAPABILITY_MEMORIES) capability's `maxResults` param: how many hits one
/// `search_memories` call reports under the [keyword-search](MEMORY_STRATEGY_KEYWORD_SEARCH)
/// strategy. Written on the terms [`maxCount`](PARAM_MAX_COUNT) is.
pub const PARAM_MAX_RESULTS: &str = "maxResults";

/// Which [memory](CAPABILITY_MEMORIES) instance an agent instance binds to — the
/// [`scope`](MEMORY_PARAM_SCOPE) param, resolved.
///
/// [`Isolated`](Self::Isolated) is what the [authoring catalog](gg_authoring_catalog) writes into
/// a new document: a subagent starts with an empty notebook and nothing it writes is seen by
/// anyone else, which is the right answer for a configuration that wants each agent measured on
/// its own curation. The other three bind the *same* store to several holders, which is what makes
/// a study of shared, accumulated knowledge possible at all.
///
/// Two rules make the four coherent, and they are the ones a configuration's reader has to know:
///
/// 1. **[`ReadOnly`](Self::ReadOnly) only ever restricts an inherited handle.** An agent that ends
///    up with a fresh instance under `read-only` may write it — a private notebook nobody may
///    write is not a feature.
/// 2. **Write access is a property of the holder, not of the store.** So a read-only agent's
///    [`Inherited`](Self::Inherited) subagent gets a read/**write** handle onto the same store.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgMemoryScope {
    /// A fresh instance per agent **instance**: what one agent writes, no other agent ever sees.
    /// What a new document is authored with — by the authoring catalog, which writes it into the
    /// document rather than leaving gg to read it out of an absence.
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

/// The [tasks](CAPABILITY_TASKS) capability's `maxTasks` param: how many tasks the list may hold
/// at once, an add beyond it being refused.
///
/// An enabled capability writes it. An absent one refuses the launch, and so does a `0`, which
/// would offer the model a call whose every use is refused. A list bounded by a number nobody
/// wrote reads afterwards as a model that stopped planning.
pub const PARAM_MAX_TASKS: &str = "maxTasks";

/// The [tasks](CAPABILITY_TASKS) capability's `mode` param: how much structure a task carries, one
/// of [`TASK_MODES`]. An enabled capability writes it, and an absent or unrecognized one refuses
/// the launch.
pub const PARAM_MODE: &str = "mode";

/// The [tasks](CAPABILITY_TASKS) [mode](PARAM_MODE) in which a task is a lightweight to-do: a
/// title and an optional description.
pub const TASK_MODE_SIMPLE: &str = "simple";

/// The [tasks](CAPABILITY_TASKS) [mode](PARAM_MODE) in which a task carries the same structured
/// sections a [board issue](CAPABILITY_PROJECT_MANAGEMENT) does — an in-scope, an out-of-scope and
/// a completion criteria beside its title — so an agent planning substantial work for itself
/// writes down what finished means when it files the task rather than when it reaches it.
pub const TASK_MODE_ISSUES: &str = "issues";

/// Both task modes, in the spelling a launch refusal offers back.
/// [`simple`](TASK_MODE_SIMPLE) is first, and is what the
/// [authoring catalog](gg_authoring_catalog) writes into a new document.
pub const TASK_MODES: [&str; 2] = [TASK_MODE_SIMPLE, TASK_MODE_ISSUES];

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
    /// The name a program calls it by, **relative to its module**, in this arm's own spelling:
    /// a free function is its bare name — `readFile`, `openDocsView`, `finish` — and a method
    /// carries the receiver it hangs off, in the arm's own separator — `IssueCreated.wait` on
    /// TypeScript, `IssueCreated#await` on Java, `issue_created::wait` on C++. Joining the module's
    /// [`path`](GgAgentApi::path) onto it with the arm's separator gives the catalogue's
    /// fully-qualified name (`gg.board.IssueCreated.wait`), which is the key a documentation view
    /// opens by.
    ///
    /// Module-relative rather than bare so that two rows of one module never share a name: a
    /// method reported bare could collide with a free function beside it, so the memory read an
    /// arm hangs off a search hit reports as `MemoryHit.read`, never as a second bare `read`.
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
/// The arm the [authoring catalog](gg_authoring_catalog) writes into a new document. Nothing
/// *falls* to it: a compaction capability that names no strategy, and one naming a strategy gg
/// does not recognize, each refuse the launch rather than landing here.
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
/// **Optional**, and one of the few params whose absence is itself the setting: with no model
/// named, a handoff strategy condenses on the agent's own model and gg substitutes nothing.
/// **Present** and unresolvable is a different thing entirely: the
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

/// The [compaction](CAPABILITY_COMPACTION) capability's `summaryHeadroom` param: the fraction of
/// the model's window, `0.0..=0.9`, held back from the agent so the summarization round trip has
/// room to run in.
///
/// The working window an agent is measured against is the model's window less this slice, and the
/// fullness that fires a compaction is `1 - summaryHeadroom`. An enabled capability writes it; an
/// absent one, one outside the range, and one gg cannot read as a fraction each refuse the launch.
pub const PARAM_SUMMARY_HEADROOM: &str = "summaryHeadroom";

/// The stable id of the Phase 2 [agent-managed context] capability: the model-facing
/// complement to [compaction](CAPABILITY_COMPACTION) that gives the agent agency over
/// its own window — evicting file views it no longer needs and archiving sections of
/// its thread (removed from the live window but still searchable). Under
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) it also buys the view call that
/// manages the window — `views.close` — since closing a view is context management;
/// opening a view is not, and stays bound to every program. Opt-in, like compaction.
///
/// [agent-managed context]: https://docs.testcabinet.ai/gg/agent-managed-context/
pub const CAPABILITY_AGENT_MANAGED_CONTEXT: &str = "agent-managed-context";

/// The [agent-managed-context](CAPABILITY_AGENT_MANAGED_CONTEXT) capability's `topFileViews`
/// param: how many individual files the context-usage signal's breakdown names, most expensive
/// first.
///
/// An enabled capability writes it, and an absent one refuses the launch. How many reads a window holds at once differs enormously between
/// an agent that opens two specifications and one crawling a codebase, so the figure is the
/// profile's to state rather than gg's to guess.
pub const PARAM_TOP_FILE_VIEWS: &str = "topFileViews";

/// The [agent-managed-context](CAPABILITY_AGENT_MANAGED_CONTEXT) capability's
/// `signalThresholdPercent` param: how full the agent's window has to be before the
/// context-usage signal is rendered into it at all, as a whole percentage of `0..=100`.
///
/// The denominator is the window the agent can actually fill: the model's window less the
/// [headroom](PARAM_SUMMARY_HEADROOM) an armed [compaction](CAPABILITY_COMPACTION) holds back, and
/// the model's whole window where none is armed. It is the same denominator the block's own
/// `Overall:` figure is a share of, so the threshold that puts the block in front of the agent and
/// the percentage the agent then reads are one measurement. A `0` renders the block on every turn.
///
/// **An absent one is the [default](DEFAULT_SIGNAL_THRESHOLD_PERCENT) rather than a refusal**,
/// which is the opposite of the rule the params beside it are read under. The block costs the
/// window it reports on, and an agent shown a 3% reading every turn is paying for a line that asks
/// it to reclaim nothing; gg holds it back until there is something to act on, and an operator
/// varying that point writes the figure.
pub const PARAM_SIGNAL_THRESHOLD_PERCENT: &str = "signalThresholdPercent";

/// What [`PARAM_SIGNAL_THRESHOLD_PERCENT`] names when the key is absent: three quarters of the
/// window the agent can fill.
///
/// It is written into every new document by the [authoring catalog](gg_authoring_catalog), so the
/// figure a run was conducted under is in its record whether or not the operator touched the key.
pub const DEFAULT_SIGNAL_THRESHOLD_PERCENT: u64 = 75;

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
/// dispatched under is named **when the issue is created** ([`agent`](GgBoardIssue::agent_id)) and
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
/// An issue may name [reviewers](GgBoardIssue::reviewer_ids) — profiles the creating agent lists with
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
/// wait on and complete issues) and **required [reviewers](GgBoardIssue::reviewer_ids)** (the
/// `reviewers` param, which makes `create_issue` demand one or more reviewer profiles). The
/// capability as a whole is opt-in, like compaction and agent-managed context — a configuration
/// that leaves it off simply never offers the board calls.
///
/// [project management]: https://docs.testcabinet.ai/gg/project-management/
/// [wait on an issue]: https://docs.testcabinet.ai/gg/project-management/
pub const CAPABILITY_PROJECT_MANAGEMENT: &str = "project-management";

/// The [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability param naming the run's
/// **merge agent**: the profile gg dispatches when merging an accepted issue's worktree back into
/// the main tree hits a **conflict**, so the conflict is
/// resolved and the merge finished rather than the issue's work being stranded on its branch.
///
/// It is **required** — a set that enables project management without a merge agent is refused at
/// launch — because concurrent issues make a conflicting merge an ordinary event, not an edge case,
/// and silently dropping the loser's work would make the board dishonest. The referenced
/// profile must exist in the set and must have the [shell](CAPABILITY_SHELL) capability enabled:
/// resolving a merge means running `git` in the workspace, which is not something an agent without
/// a shell can do.
pub const PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: &str = "mergeAgentId";

/// The [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability's `maxEpics` param: how many
/// epics the board may hold at once. An enabled capability writes it, and an absent one refuses
/// the launch.
pub const PARAM_MAX_EPICS: &str = "maxEpics";

/// The [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability's `maxIssues` param: how
/// many issues the board may hold at once. Written and required on the terms
/// [`maxEpics`](PARAM_MAX_EPICS) is.
pub const PARAM_MAX_ISSUES: &str = "maxIssues";

/// The `maxRetries` param: how many times gg tries again after an attempt that did not take. Two
/// capabilities read it, and each says for itself what an attempt is.
///
/// On [project-management](CAPABILITY_PROJECT_MANAGEMENT) it is how many times gg re-dispatches an
/// issue whose assigned agent finished without completing it before marking it
/// [failed](GgIssueStatus::Failed) — a review round is not a retry. Written and required there on
/// the terms [`maxEpics`](PARAM_MAX_EPICS) is, and `0` is a legitimate figure: it says one attempt
/// and no more.
///
/// On [compaction](CAPABILITY_COMPACTION) it is how many times gg compacts again after a boundary
/// that left the window still at its [trigger](PARAM_SUMMARY_HEADROOM), before the agent is ended
/// as **failed**. There the param is **optional**, and its absence is the setting rather than a
/// gap: one compaction, and an agent whose window that compaction could not relieve has failed.
/// Writing a figure is what arms a retry, which is the same rule the run's own ceilings follow.
pub const PARAM_MAX_RETRIES: &str = "maxRetries";

/// The [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability's `reviewers` param: when
/// on, this agent cannot file an issue without naming at least one reviewer.
///
/// **Optional**, and the one param of this capability that is: absent, an issue's author names
/// reviewers or leaves them out as it chooses, and that absence is the setting rather than a
/// stand-in for a value. A value that is not a switch refuses the launch.
pub const PARAM_REVIEWERS: &str = "reviewers";

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

/// The [subagents](CAPABILITY_SUBAGENTS) capability's `maxDepth` param: how deep the delegation
/// tree may go. The root is depth `0`, and an agent at `maxDepth` may not spawn, since its child
/// would be one deeper.
///
/// An enabled capability writes it, and an absent one refuses the launch. Unlike the run's
/// [parallelism cap](GgRunLimits::max_parallel) it is per agent, so two profiles may be trusted to
/// recurse to different depths.
pub const PARAM_MAX_DEPTH: &str = "maxDepth";

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
    /// prompt. Must be a profile the set declares, and must not be an FSM shell (a shell cannot be
    /// a state — it would recurse).
    ///
    /// Names the profile's internal [id](GgAgentConfig::id) while the configuration is authored and
    /// its [slug](GgAgentConfig::slug) once launching has resolved them; whether the set still
    /// carries ids says which.
    ///
    /// Defaulted rather than required so a state that omits it is refused by the machine's own
    /// validation — which names the state and says what is missing — instead of by a serde error
    /// about a field the author never knew to write.
    #[serde(default)]
    pub agent_id: String,
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
/// When enabled, an agent's turn offers the model exactly **one** native tool — `submit_program`,
/// which takes a single `program` string — and the request **requires** a call to it (forced tool
/// choice). The string passed to the tool **is** the program — no extraction, no repair, no
/// language tag — in which
/// each of the run's [tools](CAPABILITY_SHELL) is a **typed function** (`readFile(path, { limit })`,
/// not a generic call by name), executed in a wasmtime **component** sandbox. Which
/// [language](GgProgramLanguage) that program is written in is the capability's `language` param: a
/// configuration knob a cross-language study slices its arms on, and a **required** one — an
/// enabled capability that names no language refuses the launch rather than picking one. gg
/// prepares the submitted program for that language's guest and runs it — bridging each
/// tool call the program makes to the real
/// [`ToolRegistry`](https://docs.testcabinet.ai/gg/overview/) (so the tool runs in the container and
/// its result flows back **into the program**) — and feeds the program's result (plus any error or
/// fuel exhaustion) back into the context as the turn's outcome. The tool calls the program made
/// still stream as ordinary [`ToolCall`](GgTelemetryKind::ToolCall)/[`ToolResult`](GgTelemetryKind::ToolResult)
/// telemetry, and each submitted program is streamed as a [`CodeExecution`](GgTelemetryKind::CodeExecution)
/// event. A program that calls a delegation tool still goes through the subagent
/// [scheduler](CAPABILITY_SUBAGENTS).
///
/// The session ends **only** when a program calls `finish(summary)` — a real function on the
/// sandbox's model-facing surface rather than a rule about text — whose summary becomes the run's
/// final text. Saying the work is done therefore ends nothing: a submitted string that is prose
/// fails to compile like any other, and the run goes on until a program calls the ending function.
///
/// There is **no repair pass**: the submitted string is compiled exactly as sent. Text the model
/// writes beside the tool call is recorded and surfaced as the assistant's message and is never
/// parsed for code. A reply that carries **several** `submit_program` calls runs each program
/// sequentially, in order, all of them regardless of whether an earlier one failed — and however
/// many of them fail, at most **one** error is counted against the turn.
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

/// The [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's `language` param: the
/// [language](GgProgramLanguage) this agent writes its programs in.
///
/// **The one value nobody may choose on the operator's behalf.** Every other required param has a
/// figure the [authoring catalog](gg_authoring_catalog) can put in front of an operator to keep or
/// change; this one has none, and must never acquire one, because the language is the axis a
/// cross-language study slices its arms by. A profile that switches the capability on names a
/// language itself, and one that does not is refused before its first turn.
pub const PARAM_LANGUAGE: &str = "language";

/// The [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's `timeoutSecs` param: the
/// guest-CPU ceiling one program runs under, in seconds. A fraction is honoured.
///
/// An enabled capability writes it. An absent one refuses the launch, as does anything that is not
/// a positive number: a study that deliberately starves the sandbox to measure what a model does
/// about it is measuring the figure, so the figure is stated.
pub const PARAM_TIMEOUT_SECS: &str = "timeoutSecs";

/// The [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's `maxMemoryBytes` param: the
/// guest's linear-memory ceiling for one program, as a whole number of bytes.
///
/// Written and required on the terms [`timeoutSecs`](PARAM_TIMEOUT_SECS) is. JSON has no integer
/// type, so `5e8` and `500000000` are one declaration; `500000000.5` names no count of bytes and
/// is refused rather than rounded to a ceiling nobody wrote.
pub const PARAM_MAX_MEMORY_BYTES: &str = "maxMemoryBytes";

/// The [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's `docViewTypes` param: which
/// of a function's types opening its documentation opens beside it, as three independent toggles
/// keyed `return`, `parameters` and `errors`.
///
/// An enabled capability writes it. `true` opens all three and `false` opens none; an object names
/// each of the three, and one that leaves a key out is refused along with an absent param, a
/// non-boolean toggle, and a key naming none of the three.
pub const PARAM_DOC_VIEW_TYPES: &str = "docViewTypes";

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
/// runs under an id of its own — the bare string the `submit_program` acknowledgement carries, minted
/// before the program runs — and a program can fetch one back:
///
/// ```ts
/// const source = programs.get("k3p9");                      // the program that id was issued to
/// programs.rerun(source.replace("cosnt x", "const x"));      // gg runs the patched one
/// ```
///
/// Three functions, on a `programs` object bound only when this capability is on: `history()` lists
/// the programs held (id, turn, size, whether each ran to its end), `get(id)` returns one's exact
/// source, and `rerun(source)` hands gg a program to run **in place of the one that called it**.
///
/// # What `rerun` does, and what it does not
///
/// It is **registered, not performed**, exactly as [`compact`](CAPABILITY_AGENT_MANAGED_CONTEXT) and
/// an [exec](CAPABILITY_EXEC) are: the call validates the source and returns, the calling program
/// carries on to its end, and gg then compiles and runs what it was handed as the
/// same submission's program. Nothing is undone — every call the registering program made stands — and the
/// program that runs next sees exactly the world it left behind. The first registration stands and a
/// second is refused; a program that then fails loses the registration along with everything else it
/// decided, on the same rule that revokes an ending. The chain is bounded, and a submission that
/// reaches the bound is told so.
///
/// The source gg keeps for a submission is the program that **executed**, under the submission's
/// id, so fetch-patch-rerun composes: the patched program is what the next `get` of that id returns,
/// not the two lines that asked for it.
/// The library also outlives the context window — it is gg's own state, not a message — so a
/// [compacted](CAPABILITY_COMPACTION) agent can still reach the program it wrote forty turns ago.
///
/// # What it is bounded by
///
/// Its [`keep`](PARAM_KEEP) param is how many of the most recent programs are retained. It bounds
/// memory, not the model: a `get` of an id the retention has dropped is `not-found` naming the ids
/// that are held. Its [`idLength`](PARAM_ID_LENGTH) param is how long those ids are.
///
/// gg includes it **so its effectiveness can be measured empirically** — toggled against the same
/// runs without it, it answers "does making a retry proportional to the mistake pay for itself?"
/// with data. Opt-in, and inert without [responses-as-code](CAPABILITY_RESPONSES_AS_CODE): there are
/// no programs in a tool-calling session to keep.
pub const CAPABILITY_PROGRAM_LIBRARY: &str = "program-library";

/// The [program-library](CAPABILITY_PROGRAM_LIBRARY) capability's `keep` param: how many of the
/// most recent programs the library retains, `0` keeping every program of the session.
///
/// An enabled capability writes it, and an absent one refuses the launch.
pub const PARAM_KEEP: &str = "keep";

/// The [program-library](CAPABILITY_PROGRAM_LIBRARY) capability's `idLength` param: how many
/// characters long the cuid2 id assigned to each of the agent's programs is, from 2 to 32. A longer
/// id costs the model more tokens on every fetch and buys more room before a collision re-rolls.
///
/// An enabled capability writes it; an absent one, one gg cannot read as a count, and one outside
/// the range each refuse the launch.
pub const PARAM_ID_LENGTH: &str = "idLength";

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
    CAPABILITY_SEARCH,
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

// ---------------------------------------------------------------------------
// The authoring catalog
// ---------------------------------------------------------------------------

/// One [authoring catalog](gg_authoring_catalog) entry: everything a *new* document says about one
/// capability.
#[derive(Debug, Clone, PartialEq)]
pub struct GgAuthoredCapability {
    /// The capability this entry authors — one of [`GG_CAPABILITY_CATALOG`].
    pub id: &'static str,
    /// The arm a new document selects.
    ///
    /// `None` for the seventeen capabilities that offer no arms to select between, and `None` for
    /// [autoload specifications](CAPABILITY_AUTOLOAD_SPECS), whose only arm is
    /// [`locked`](AUTOLOAD_LOCKED_IMPL) and whose *unwritten* implementation is itself the
    /// declaration that the seeded specifications are ordinary file views. The remaining four —
    /// [shell](CAPABILITY_SHELL), [read-file](CAPABILITY_READ_FILE),
    /// [memories](CAPABILITY_MEMORIES) and [compaction](CAPABILITY_COMPACTION) — have no reading
    /// of an unwritten arm at all, so a new document states one.
    pub implementation: Option<&'static str>,
    /// The whole params object a new document is written with: every param the capability
    /// **requires**, and nothing whose absence is itself a setting.
    pub params: Value,
}

/// The **authoring catalog**: the [implementation](GgCapabilityConfig::implementation) and the
/// whole [params](GgCapabilityConfig::params) object a *new* document is written with, one entry
/// per id in [`GG_CAPABILITY_CATALOG`], in that same order.
///
/// It is consulted by whatever **writes** a configuration — this crate's constructors
/// ([`GgCapabilityConfig::enabled`], [`GgCapabilityConfig::disabled`] and so
/// [`GgAgentConfig::root`], [`GgCapabilitySet::default`] and [`GgCapabilitySet::minimal`]) and the
/// console's capability-set editor, which pre-fills a freshly switched-on capability from it — and
/// by **nothing that reads one**. gg's resolvers never reach it. gg reads the document in front of
/// it and substitutes nothing, so every figure a run is conducted and recorded under is a figure
/// the configuration states.
///
/// That is the whole distinction this type exists to keep: these are starting values an operator
/// keeps or changes at the moment a capability is switched on, not fallbacks a launch can land on.
/// Deleting one of these keys out of a stored document does not restore the figure — it
/// [refuses the launch](GgCapabilityConfig::params).
///
/// Two kinds of key are deliberately absent, and both absences are load-bearing.
///
/// - A param that is **off when it is absent**: [compaction](CAPABILITY_COMPACTION)'s
///   [`model`](COMPACTION_PARAM_MODEL) and [`modelSlot`](COMPACTION_PARAM_MODEL_SLOT), and
///   [project management](CAPABILITY_PROJECT_MANAGEMENT)'s [`reviewers`](PARAM_REVIEWERS). The
///   absence is the setting, so writing one in would make every new document ask for a summarizer
///   model, or a reviewer, that nobody asked for.
/// - [responses-as-code](CAPABILITY_RESPONSES_AS_CODE)'s [`language`](PARAM_LANGUAGE), which has no
///   value here and must never acquire one. It is the axis a cross-language study slices its arms
///   by, which makes it the one required value nobody may choose for the operator — not gg, and
///   not the form that opens the capability. Every other required param has a figure that can be
///   put in front of an operator to keep or change; this one has only the operator's answer.
pub fn gg_authoring_catalog() -> &'static [GgAuthoredCapability] {
    static CATALOG: std::sync::OnceLock<Vec<GgAuthoredCapability>> = std::sync::OnceLock::new();
    CATALOG.get_or_init(build_authoring_catalog)
}

/// The [authoring catalog](gg_authoring_catalog), built once behind its `OnceLock`.
fn build_authoring_catalog() -> Vec<GgAuthoredCapability> {
    /// One entry's params object. The pairs are written in the order they read best; a JSON object
    /// has no order of its own, and `serde_json`'s map sorts its keys.
    fn params(pairs: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
        Value::Object(
            pairs
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect(),
        )
    }
    /// A capability with no params to write.
    fn none() -> Value {
        params([])
    }
    let entry = |id, implementation, params| GgAuthoredCapability {
        id,
        implementation,
        params,
    };

    vec![
        entry(
            CAPABILITY_SHELL,
            Some(SHELL_OUTPUT_OFFLOAD),
            params([
                (PARAM_MAX_LINES, json!(250)),
                (PARAM_MAX_CHARS, json!(4096)),
            ]),
        ),
        entry(
            CAPABILITY_READ_FILE,
            Some(READ_MODE_UNLIMITED),
            params([(PARAM_LINE_CAP, json!(250))]),
        ),
        entry(CAPABILITY_WRITE_FILE, None, none()),
        entry(CAPABILITY_EDIT_FILE, None, none()),
        entry(CAPABILITY_LIST_DIR, None, none()),
        entry(CAPABILITY_SEARCH, None, none()),
        entry(
            CAPABILITY_CONTEXT_WINDOW_OVERRIDE,
            None,
            // A narrowing an order of magnitude under a large model's window, which is what the
            // capability is reached for: it puts a compaction boundary within reach of a run that
            // would otherwise have to buy a million tokens of input to see one.
            params([(PARAM_WINDOW_LIMIT, json!(100_000))]),
        ),
        entry(
            CAPABILITY_AUTOLOAD_SPECS,
            None,
            params([(AUTOLOAD_PARAM_IMAGES, json!(false))]),
        ),
        entry(CAPABILITY_AGENT_PERSISTENCE, None, none()),
        entry(
            CAPABILITY_SKILLS,
            None,
            params([
                (PARAM_SKILLS_DIR, json!(GG_WORKSPACE_SKILLS_DIR)),
                // Every built-in offered: the toggle set records only what is switched off.
                (PARAM_BUILT_INS, params([])),
            ]),
        ),
        entry(
            CAPABILITY_MEMORIES,
            Some(MEMORY_STRATEGY_SCRATCHPAD),
            // The scratchpad's own limits, since the scratchpad is the arm this entry selects. The
            // three it does not apply are written `0`, which is how a params object says a limit is
            // off: the count and the per-memory ceiling already bound what the window carries.
            params([
                (MEMORY_PARAM_SCOPE, json!(GgMemoryScope::Isolated)),
                (PARAM_MAX_COUNT, json!(64)),
                (PARAM_MAX_LEN_PER_MEMORY, json!(4_096)),
                (PARAM_MAX_TOTAL_LEN, json!(0)),
                (PARAM_MAX_LEN_INDEX, json!(0)),
                (PARAM_MAX_LEN_DESCRIPTION, json!(256)),
                (PARAM_MAX_RESULTS, json!(0)),
            ]),
        ),
        entry(
            CAPABILITY_TASKS,
            None,
            params([
                (PARAM_MAX_TASKS, json!(100)),
                (PARAM_MODE, json!(TASK_MODE_SIMPLE)),
            ]),
        ),
        entry(
            CAPABILITY_COMPACTION,
            Some(COMPACTION_STRATEGY_SELF_SUMMARIZATION),
            params([(PARAM_SUMMARY_HEADROOM, json!(0.2))]),
        ),
        entry(
            CAPABILITY_AGENT_MANAGED_CONTEXT,
            None,
            params([
                (PARAM_TOP_FILE_VIEWS, json!(5)),
                (
                    PARAM_SIGNAL_THRESHOLD_PERCENT,
                    json!(DEFAULT_SIGNAL_THRESHOLD_PERCENT),
                ),
            ]),
        ),
        entry(
            CAPABILITY_PROJECT_MANAGEMENT,
            None,
            params([
                // The board is the run's, so it has one merge agent, and the profile a new set
                // declares is its root. An editor that adds a second profile re-points it.
                (PROJECT_MANAGEMENT_PARAM_MERGE_AGENT, json!(ROOT_PROFILE_ID)),
                (PARAM_MAX_EPICS, json!(50)),
                (PARAM_MAX_ISSUES, json!(2_000)),
                (PARAM_MAX_RETRIES, json!(1)),
            ]),
        ),
        entry(
            CAPABILITY_SUBAGENTS,
            None,
            params([(PARAM_MAX_DEPTH, json!(3))]),
        ),
        entry(
            CAPABILITY_FSM,
            None,
            // An empty table: a machine's states are the whole of what an operator authors here,
            // and there is no state gg could invent that names a profile the set has.
            params([(FSM_PARAM_STATES, Value::Array(Vec::new()))]),
        ),
        entry(CAPABILITY_EXEC, None, none()),
        entry(CAPABILITY_FORK, None, none()),
        entry(
            CAPABILITY_RESPONSES_AS_CODE,
            None,
            // No `language`: see this catalog's own documentation for why it is the one required
            // value that has no entry here and must not gain one.
            params([
                (PARAM_TIMEOUT_SECS, json!(30)),
                (PARAM_MAX_MEMORY_BYTES, json!(268_435_456)),
                (
                    PARAM_DOC_VIEW_TYPES,
                    json!({ "return": true, "parameters": false, "errors": true }),
                ),
            ]),
        ),
        entry(
            CAPABILITY_PROGRAM_LIBRARY,
            None,
            params([(PARAM_KEEP, json!(20)), (PARAM_ID_LENGTH, json!(4))]),
        ),
        entry(CAPABILITY_DOCVIEW_CLOSE, None, none()),
    ]
}

/// The [authoring catalog](gg_authoring_catalog) entry for `id`, or `None` for an id outside
/// [`GG_CAPABILITY_CATALOG`] — which names no capability gg can switch on, so there is nothing to
/// author for it.
pub fn authored_capability(id: &str) -> Option<&'static GgAuthoredCapability> {
    gg_authoring_catalog().iter().find(|entry| entry.id == id)
}

/// The [parallelism cap](GgRunLimits::max_parallel) a new configuration is written with.
///
/// Wide enough that a fan-out study is measuring the run's own shape rather than this figure, and
/// narrow enough to stay legible and to keep a fleet inside a provider's rate limits.
pub const AUTHORED_MAX_PARALLEL: u64 = 16;

/// The [session-journal ceiling](GgRunLimits::replay_max_bytes) a new configuration is written
/// with: **256 MiB**.
///
/// Sized to be unreachable by a run that is behaving and reachable by one that is not. A pooled
/// record of a 200-turn session projects to a few megabytes, so this is two orders of magnitude of
/// headroom; what it bounds is a model producing megabytes of distinct output until the journal
/// fills the run container's disk.
pub const AUTHORED_REPLAY_MAX_BYTES: u64 = 256 * 1024 * 1024;

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

/// The [skills](CAPABILITY_SKILLS) library inside gg's own [dotdir](GG_WORKSPACE_DIR), and the
/// [`dir`](PARAM_SKILLS_DIR) a fresh capability set is authored with.
///
/// gg stands it up at session start, alongside the rest of its dotdir, so it is a directory the
/// workspace always carries and — until something authors a skill into it — leaves empty. That is
/// what makes it a usable starting value: a profile pointed at it holds gg's
/// [built-ins](PARAM_BUILT_INS) alone rather than refusing a launch over a directory nobody seeded.
/// A `dir` naming anywhere else is a promise about the *seeded* workspace, and the launch is refused
/// when the workspace does not keep it.
pub const GG_WORKSPACE_SKILLS_DIR: &str = ".gg/skills";

/// The name a fresh capability set's **root agent** is seeded with.
///
/// It is a starting value, not an invariant: the root is the **first**
/// [profile](GgCapabilitySet::agents) a set declares ([`GgCapabilitySet::root`]), whatever
/// it is called, and an operator may rename it or make another profile the root. Nothing
/// resolves the root by this name — code that means "the root" must ask
/// [`GgCapabilitySet::root`] (or [`GgCapabilitySet::root_name`]) for it, or a configuration
/// whose root was renamed would fail to launch.
pub const ROOT_AGENT: &str = "Root";

/// The [slug](GgAgentConfig::slug) a fresh capability set's **root profile** is seeded with.
///
/// This is the one well-known profile slug, so a hand-written set and a default one agree on what
/// the first profile is called. It is still only a starting value: the root is the **first**
/// profile a set declares, whatever its id.
///
/// A different thing from the runtime agent id a session record stamps its entries with, which
/// identifies one *instance* of a profile within one run — a profile is a template, and a run may
/// hold many instances of it at once. The two happen to spell the run's first of each `root`.
pub const ROOT_PROFILE_ID: &str = "root";

/// Whether `slug` is a well-formed [profile slug](GgAgentConfig::id): one or more groups
/// of lowercase ASCII letters and digits, separated by single hyphens.
///
/// The rule exists because the slug is what the **model** is shown and passes back. A
/// roster in a prompt reads as prose only while every name in it is one word the model can
/// copy without deciding how to spell it, so a slug carries no whitespace, no case and no
/// punctuation to get wrong.
pub fn is_valid_agent_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

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
    /// The **name** a saved configuration carried at launch (for example `"minimal"`,
    /// `"full"`, or `"planning-A"`), when this set was launched from one rather than
    /// assembled by hand. A study is a sweep over configurations, so this records which
    /// one produced a run.
    ///
    /// Display text and a slicing key: it is what the run log shows, what the
    /// [query language](https://docs.testcabinet.ai/gg/analysis/query-language/) reads as
    /// `preset`, and what a comparison groups by. It is not identity — a name is rewritten
    /// freely and two configurations may share one, so what a run is *attributed* to is
    /// [`preset_id`](Self::preset_id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub preset: Option<String>,
    /// The **id** of the saved configuration this set was launched from, when it was
    /// launched from one rather than assembled by hand.
    ///
    /// This is what identifies a run's
    /// [coverage cell](https://docs.testcabinet.ai/components/backend/coverage/), and
    /// [`preset`](Self::preset) beside it is what a person reads: the id is minted once and
    /// never rewritten, so renaming a configuration costs a plan nothing and two
    /// configurations that happen to agree on a name stay two cells.
    ///
    /// Recording it is consistent with gg's rule that launching resolves a configuration's
    /// internal ids away. That rule covers the ids of [agent profiles](GgAgentConfig::id),
    /// which are references the model reads back by slug, and nothing in a launched set
    /// points at the configuration's own id — the model is never shown it. It rides along
    /// as provenance, so a run can be attributed to the configuration that produced it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub preset_id: Option<String>,
    /// The agent profiles this run is configured with, each with its own capabilities,
    /// model binding, and delegation graph. **The first is the [root](Self::root)** — it
    /// drives the top-level session and is the default profile for issue dispatch and
    /// helper agents — whatever it happens to be *called*: the root is a position, not a
    /// name, so a configuration may rename it or promote another profile to it. A set
    /// that names the key at all must list at least one profile: an empty list is a
    /// configuration with no root, and a launch rejects it by name.
    #[serde(default = "default_agents")]
    pub agents: Vec<GgAgentConfig>,
    /// The [launch inputs](GgConfigSlot) this set declares, each naming the
    /// [agent slots](GgModelSlot) it fills.
    ///
    /// This is not the whole of what a launch asks for: a
    /// [passthrough](GgModelSlot::passthrough) agent slot is exposed on its own without a
    /// declaration here. [`launch_slots`](Self::launch_slots) is the one set of inputs a
    /// run is launched with. Empty for a fully pinned set, and empty on the set a run
    /// records, because launching resolves every deferred binding first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub model_slots: Vec<GgConfigSlot>,
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
    ///
    /// Two of them are **required**: [`maxParallel`](GgRunLimits::max_parallel) and
    /// [`replayMaxBytes`](GgRunLimits::replay_max_bytes), because gg conducts every run under both
    /// and neither has an off it could take instead. The five ceilings are each armed by writing a
    /// figure and left unarmed by leaving it out. A set that declares nothing at all omits the key
    /// entirely and still deserializes — and is refused at launch, naming the two it owes.
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
    ///
    /// Fully specified in every respect a model binding is not: each capability carries the arm and
    /// params the [authoring catalog](gg_authoring_catalog) writes, and the set carries the two
    /// [required ceilings](GgRunLimits::authored).
    fn default() -> Self {
        Self {
            preset: None,
            preset_id: None,
            agents: default_agents(),
            model_slots: Vec::new(),
            limits: GgRunLimits::authored(),
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
    ///
    /// Launchable means **fully specified**: every capability carries the arm and params the
    /// [authoring catalog](gg_authoring_catalog) writes, and the set carries the two
    /// [required ceilings](GgRunLimits::authored). A set short of any of those is refused before
    /// its first turn, so "the smallest set that runs" and "the smallest set that is complete" are
    /// the same set.
    pub fn minimal(model_id: impl Into<String>) -> Self {
        Self {
            preset: Some("minimal".to_string()),
            preset_id: None,
            agents: vec![GgAgentConfig {
                model_id: model_id.into(),
                ..GgAgentConfig::root()
            }],
            model_slots: Vec::new(),
            limits: GgRunLimits::authored(),
            hooks: Vec::new(),
        }
    }

    /// The **root agent** — the first profile, which drives the top-level session.
    /// Returns a reference rather than an `Option` because a launch refuses a set that
    /// declares no profiles, so by the time anything runs there is always a first one.
    ///
    /// The root is identified by **position**: it is seeded with the id
    /// [`ROOT_PROFILE_ID`], but an operator may promote a different profile to first, so
    /// looking one up by that id would silently fail on a reordered configuration.
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

    /// The [root agent](Self::root)'s [display name](GgAgentConfig::name) — for prose that has to
    /// call the profile driving this run something a person recognises.
    ///
    /// For prose only, like [`Self::agent_name`]: a reference to the root is
    /// [`Self::root_id`].
    pub fn root_name(&self) -> &str {
        &self.root().name
    }

    /// The [root agent](Self::root)'s [slug](GgAgentConfig::slug) — what a reference means when
    /// it means "whichever profile drives this run".
    pub fn root_id(&self) -> &str {
        &self.root().slug
    }

    /// The agent profile with the given [slug](GgAgentConfig::slug), or `None` when this set
    /// declares none.
    ///
    /// The only way to resolve a reference in a **launched** set, which is every set gg reads:
    /// launching rewrites each one to the profile's slug. Profile [names](GgAgentConfig::name) are
    /// display text and may repeat, so there is deliberately no lookup by one.
    pub fn agent(&self, slug: &str) -> Option<&GgAgentConfig> {
        self.agents.iter().find(|a| a.slug == slug)
    }

    /// The agent profile carrying the internal [id](GgAgentConfig::id) `id`, or `None` when this
    /// set declares none.
    ///
    /// The lookup an **authored** configuration resolves a reference by, before a launch has
    /// rewritten those references to slugs. Two profiles may legitimately share a slug while an
    /// operator is clearing a collision, and this still names exactly one of them.
    pub fn agent_by_key(&self, id: &str) -> Option<&GgAgentConfig> {
        self.agents.iter().find(|a| a.id.as_deref() == Some(id))
    }

    /// The [display name](GgAgentConfig::name) of one profile, or the slug when this set declares
    /// no such profile — a dangling reference reads as the slug it failed to resolve rather than
    /// as nothing.
    ///
    /// For prose only. Names may repeat, so nothing may resolve one back to a profile; a surface
    /// that has to *name* a profile unambiguously names its [slug](GgAgentConfig::slug).
    pub fn agent_name<'a>(&'a self, slug: &'a str) -> &'a str {
        self.agent(slug).map(|a| a.name.as_str()).unwrap_or(slug)
    }

    /// One agent's roster in `scope`, resolved for a **model-facing** surface: the profiles it may
    /// use, each carrying the [name](GgAgentConfig::name) that makes the menu read as prose.
    ///
    /// Every surface that offers a choice of agent goes through this — the `spawn_subagent` and
    /// `transition_state` menus, `create_issue`'s implementer and reviewer lists — so all of them
    /// offer the same vocabulary, which is the profile [ids](GgAgentConfig::id). An entry pointing
    /// at a profile the set does not declare is dropped: a launch refuses such a set, so reaching
    /// here means it was already reported.
    pub fn roster(&self, agent: &GgAgentConfig, scope: GgSubagentScope) -> Vec<GgRosterEntry> {
        agent
            .subagents
            .iter()
            .filter(|entry| entry.has_scope(scope))
            .filter_map(|entry| {
                Some(GgRosterEntry {
                    agent_id: entry.agent_id.clone(),
                    name: self.agent(&entry.agent_id)?.name.clone(),
                    description: entry.description.clone(),
                })
            })
            .collect()
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

    /// The profile that actually **runs** when work is dispatched onto the profile with
    /// [slug](GgAgentConfig::slug) `id`: that profile, or — when it is an
    /// [FSM shell](GgAgentConfig::is_fsm_shell) — the agent its machine's
    /// [entry state](GgAgentConfig::fsm_entry_agent) runs.
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
        id: &'a str,
    ) -> Result<&'a GgAgentConfig, GgDispatchError<'a>> {
        let agent = self
            .agent(id)
            .ok_or(GgDispatchError::UndeclaredProfile(id))?;
        if !agent.is_fsm_shell() {
            return Ok(agent);
        }
        // Asked of the shell rather than of `fsm_entry_agent` alone, which answers `None` both for
        // "not a machine" and for "a machine nothing can be entered at" — two different facts that
        // must not share a report.
        let entry = agent
            .fsm_entry_agent()
            .ok_or(GgDispatchError::UnreadableMachine { shell: &agent.slug })?;
        self.agent(entry)
            .ok_or(GgDispatchError::UndeclaredEntryAgent {
                shell: &agent.slug,
                entry,
            })
    }

    /// The declaration of the named [configuration slot](GgConfigSlot), or `None` when
    /// this set declares no such slot.
    pub fn model_slot(&self, name: &str) -> Option<&GgConfigSlot> {
        self.model_slots.iter().find(|s| s.name == name)
    }

    /// The one set of [launch inputs](GgLaunchSlot) this configuration asks for: every
    /// [configuration slot](GgConfigSlot) in declaration order, then every
    /// [passthrough](GgModelSlot::passthrough) agent slot in agent order.
    ///
    /// A configuration slot pre-fills from its own default, or from the first
    /// [target](GgSlotTarget) that carries one.
    pub fn launch_slots(&self) -> Vec<GgLaunchSlot> {
        let mut out: Vec<GgLaunchSlot> = Vec::new();
        for slot in &self.model_slots {
            // A target names the profile's internal id, which is the half of its identity an
            // authored set carries — and a set with a slot table to read is an authored one.
            let default = slot.default_model_id.clone().or_else(|| {
                slot.targets.iter().find_map(|t| {
                    self.agent_by_key(&t.agent)?
                        .model_slot_decl(&t.slot)?
                        .default_model_id
                        .clone()
                })
            });
            out.push(GgLaunchSlot {
                name: slot.name.clone(),
                default_model_id: default,
                targets: slot.targets.clone(),
            });
        }
        for agent in &self.agents {
            for slot in agent.model_slots.iter().filter(|s| s.passthrough) {
                out.push(GgLaunchSlot {
                    name: passthrough_slot_name(&agent.slug, &slot.name),
                    default_model_id: slot.default_model_id.clone(),
                    // Labelled by the slug, because that is what an operator reads on the
                    // launch form; targeted by the internal id, because that is what a
                    // target names everywhere else.
                    targets: vec![GgSlotTarget {
                        agent: agent.id.clone().unwrap_or_else(|| agent.slug.clone()),
                        slot: slot.name.clone(),
                    }],
                });
            }
        }
        out
    }

    /// This set with every deferred binding resolved to the model the launcher collected for
    /// the [launch input](Self::launch_slots) that fills its slot, and every slot declaration
    /// dropped — the **launched** form of a configuration's model bindings.
    ///
    /// `models` is the launcher's answer to [`launch_slots`](Self::launch_slots), keyed by input
    /// name. Three things move: an agent whose binding is
    /// [deferred](GgAgentConfig::model_slot) takes the model its slot was filled with,
    /// [compaction](COMPACTION_PARAM_MODEL_SLOT)'s handoff param is rewritten to the
    /// [`model`](COMPACTION_PARAM_MODEL) key gg actually reads, and both levels of
    /// [declaration](GgModelSlot) go. What comes back is a fully pinned set, which is the only
    /// shape a run records: nothing downstream of a launch has a deferral left to resolve.
    ///
    /// A binding the configuration **pinned itself** is untouched — it was decided when the
    /// configuration was written and is never asked about again — and an input the launcher left
    /// blank binds *nothing* rather than a model id of `""`: the agent stays
    /// [unresolved](GgCapabilitySet::unresolved_agents), which is the launch refusal it should be,
    /// and an unfilled handoff param goes back to being absent, which is the documented arm where
    /// the agent condenses on its own model. Deciding which of those two an empty answer means is
    /// the caller's, not this function's.
    ///
    /// Mirrors the console's `bindModelSlots`, so a run the scheduler enqueues and a run an
    /// operator launches from the same configuration and the same models are the same run.
    pub fn bind_launch_slots(&self, models: &BTreeMap<String, String>) -> GgCapabilitySet {
        // Which model fills each agent slot, resolved through the one set of inputs the launcher
        // was asked for, so a slot reached by a configuration slot and one reached on its own are
        // bound by exactly the same rule.
        let mut model_for: BTreeMap<(&str, &str), &str> = BTreeMap::new();
        let slots = self.launch_slots();
        for input in &slots {
            let model = models
                .get(&input.name)
                .map(|model| model.trim())
                .unwrap_or_default();
            for target in &input.targets {
                model_for.insert((target.agent.as_str(), target.slot.trim()), model);
            }
        }
        let agents = self
            .agents
            .iter()
            .map(|agent| {
                // A target names the profile's internal id, falling back to the slug for a set
                // that carries none — the same key a passthrough input is filled by.
                let key = agent.id.as_deref().unwrap_or(&agent.slug);
                let model_of = |slot: &str| {
                    model_for
                        .get(&(key, slot.trim()))
                        .copied()
                        .unwrap_or_default()
                        .to_string()
                };
                let mut bound = agent.clone();
                for capability in &mut bound.capabilities {
                    if capability.id != CAPABILITY_COMPACTION {
                        continue;
                    }
                    let Some(params) = capability.params.as_object_mut() else {
                        continue;
                    };
                    let slot = params
                        .get(COMPACTION_PARAM_MODEL_SLOT)
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_string();
                    if slot.is_empty() {
                        continue;
                    }
                    params.remove(COMPACTION_PARAM_MODEL_SLOT);
                    let model = model_of(&slot);
                    if model.is_empty() {
                        params.remove(COMPACTION_PARAM_MODEL);
                    } else {
                        params.insert(COMPACTION_PARAM_MODEL.to_string(), Value::String(model));
                    }
                }
                if let Some(slot) = bound.model_slot.take()
                    && !slot.trim().is_empty()
                {
                    bound.model_id = model_of(&slot);
                }
                bound.model_slots = Vec::new();
                bound
            })
            .collect();
        GgCapabilitySet {
            agents,
            model_slots: Vec::new(),
            ..self.clone()
        }
    }

    /// Every profile [slug](GgAgentConfig::slug) this set declares more than once, in
    /// declaration order and each named once.
    ///
    /// A slug is what the model is shown and passes back, and what everything a run produces names
    /// a profile by. A repeat therefore makes every one of those ambiguous rather than merely
    /// untidy, which is why it refuses the launch instead of being tidied up on the operator's
    /// behalf. The [ids](GgAgentConfig::id) underneath stay distinct, so both profiles remain
    /// addressable while an operator clears it.
    pub fn duplicate_agent_slugs(&self) -> Vec<&str> {
        repeated(self.agents.iter().map(|a| a.slug.trim()))
    }

    /// Every internal [id](GgAgentConfig::id) this set declares more than once, in declaration
    /// order and each named once.
    ///
    /// An id is minted, never written, so a repeat is a document that was assembled wrongly rather
    /// than an operator's mistake — but it is the one thing that would make a reference in an
    /// authored configuration ambiguous, so it is refused before the configuration is stored.
    pub fn duplicate_agent_keys(&self) -> Vec<&str> {
        repeated(self.agents.iter().filter_map(|a| a.id.as_deref()))
    }

    /// The [slugs](GgAgentConfig::slug) of the profiles still carrying an internal
    /// [id](GgAgentConfig::id) — empty for a launched set, and every profile of an authored one.
    ///
    /// Launching rewrites every reference to a slug and drops the ids, so one still on the document
    /// means the launch was incomplete and the references gg is about to resolve name ids nothing
    /// will match.
    pub fn unresolved_agent_keys(&self) -> Vec<&str> {
        self.agents
            .iter()
            .filter(|a| a.id.is_some())
            .map(|a| a.slug.as_str())
            .collect()
    }

    /// This set with every reference to a profile's internal [id](GgAgentConfig::id) rewritten to
    /// that profile's [slug](GgAgentConfig::slug), and the ids dropped — the **launched** form of
    /// an authored configuration.
    ///
    /// Three references name a profile and are rewritten: a
    /// [roster entry](GgSubagentRef::agent_id), the
    /// [merge agent](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) param, and each of a machine's
    /// [states](FSM_PARAM_STATES). A [configuration slot](GgConfigSlot)'s
    /// [target](GgSlotTarget::agent) is not among them because a launch resolves the slots away
    /// entirely.
    ///
    /// A reference naming an id this set does not declare is left exactly as written rather than
    /// dropped or guessed at: the launch check reports it as the dangling reference it is, and a
    /// resolution that quietly deleted it would leave nothing to report.
    pub fn resolve_agent_keys(&self) -> GgCapabilitySet {
        let slug_of = |id: &str| {
            self.agent_by_key(id)
                .map(|a| a.slug.clone())
                .unwrap_or_else(|| id.to_string())
        };
        let agents = self
            .agents
            .iter()
            .map(|agent| {
                let mut resolved = agent.clone();
                resolved.id = None;
                for entry in &mut resolved.subagents {
                    entry.agent_id = slug_of(&entry.agent_id);
                }
                for capability in &mut resolved.capabilities {
                    if capability.id == CAPABILITY_PROJECT_MANAGEMENT
                        && let Some(Value::String(merge)) = capability
                            .params
                            .get_mut(PROJECT_MANAGEMENT_PARAM_MERGE_AGENT)
                    {
                        *merge = slug_of(merge);
                    }
                    if capability.id == CAPABILITY_FSM
                        && let Some(Value::Array(states)) =
                            capability.params.get_mut(FSM_PARAM_STATES)
                    {
                        for state in states.iter_mut() {
                            if let Some(Value::String(agent_id)) = state.get_mut("agentId") {
                                *agent_id = slug_of(agent_id);
                            }
                        }
                    }
                }
                resolved
            })
            .collect();
        GgCapabilitySet {
            agents,
            model_slots: Vec::new(),
            ..self.clone()
        }
    }

    /// Why this **authored** set's [slots](GgModelSlot) cannot be launched from, each defect in
    /// one sentence naming what is wrong, or empty when the mapping is sound.
    ///
    /// Authored, because a [target](GgSlotTarget::agent) names a profile's internal
    /// [id](GgAgentConfig::id): a launch resolves every slot away, so a launched set has no mapping
    /// left to check and gg refuses one that still declares any.
    pub fn slot_defects(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();

        // Which configuration slots name each agent slot, so "mapped nowhere" and "mapped
        // twice" are both answered from one pass.
        let mut mapped: Vec<(&str, &str, usize)> = Vec::new();
        let mut names: Vec<&str> = Vec::new();
        for slot in &self.model_slots {
            let name = slot.name.trim();
            if name.is_empty() {
                out.push("a configuration slot has no name; the launch form labels an input by its name.".to_string());
            } else if names.contains(&name) {
                out.push(format!(
                    "the `{name}` configuration slot is declared more than once; the launch form keys one model by each name."
                ));
            } else {
                names.push(name);
            }
            for target in &slot.targets {
                let Some(agent) = self.agent_by_key(target.agent.trim()) else {
                    out.push(format!(
                        "the `{name}` configuration slot fills a slot on `{}`, which this configuration does not declare.",
                        target.agent
                    ));
                    continue;
                };
                let Some(declared) = agent.model_slot_decl(target.slot.trim()) else {
                    out.push(format!(
                        "the `{name}` configuration slot fills `{}` on `{}`, which declares no such slot.",
                        target.slot, target.agent
                    ));
                    continue;
                };
                if declared.passthrough {
                    out.push(format!(
                        "the `{}` slot on `{}` is passthrough and is also filled by the `{name}` configuration slot, so a launch would ask for it twice.",
                        target.slot, target.agent
                    ));
                }
                match mapped
                    .iter_mut()
                    .find(|(a, s, _)| *a == agent.slug && *s == declared.name)
                {
                    Some((_, _, count)) => *count += 1,
                    None => mapped.push((&agent.slug, &declared.name, 1)),
                }
            }
        }

        for agent in &self.agents {
            let mut declared: Vec<&str> = Vec::new();
            for slot in &agent.model_slots {
                let slot_name = slot.name.trim();
                if slot_name.is_empty() {
                    out.push(format!(
                        "a model slot on `{}` has no name; a binding names a slot to defer to it.",
                        agent.slug
                    ));
                    continue;
                }
                if declared.contains(&slot_name) {
                    out.push(format!(
                        "the `{slot_name}` slot is declared more than once on `{}`; a binding names one and the first answers.",
                        agent.slug
                    ));
                    continue;
                }
                declared.push(slot_name);
                let fills = mapped
                    .iter()
                    .find(|(a, s, _)| *a == agent.slug && *s == slot_name)
                    .map_or(0, |(_, _, count)| *count);
                if fills > 1 {
                    out.push(format!(
                        "the `{slot_name}` slot on `{}` is filled by {fills} configuration slots; exactly one launch input supplies each binding.",
                        agent.slug
                    ));
                }
                if fills == 0 && !slot.passthrough {
                    out.push(format!(
                        "the `{slot_name}` slot on `{}` reaches no launch input; map a configuration slot onto it, or mark it passthrough.",
                        agent.slug
                    ));
                }
            }
            for deferred in agent.deferred_slot_names() {
                if !declared.contains(&deferred) {
                    out.push(format!(
                        "`{}` defers a model to `{deferred}`, which it does not declare as a model slot.",
                        agent.slug
                    ));
                }
            }
        }

        // Two launch inputs at one name is one model where the operator meant two. A
        // passthrough input is named after the agent that declares it, so the configuration
        // slot is the half that can be renamed.
        let mut seen: Vec<String> = Vec::new();
        let mut collided: Vec<String> = Vec::new();
        for input in self.launch_slots() {
            if seen.contains(&input.name) {
                if !collided.contains(&input.name) {
                    collided.push(input.name.clone());
                }
            } else {
                seen.push(input.name);
            }
        }
        for name in collided {
            out.push(format!(
                "two launch inputs are named `{name}`; rename the configuration slot, since a \
                 passthrough slot takes its name from the agent that declares it."
            ));
        }
        out
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

    /// The models this set binds, as one comparable string: every binding written as
    /// `<agent slug>=<model id>` — with a [handoff](GgAgentConfig::handoff_model_id) written as
    /// `<agent slug>:compaction=<model id>` — sorted, de-duplicated and joined with commas.
    ///
    /// This is the gg half of a [coverage cell](https://docs.testcabinet.ai)'s identity. A
    /// configuration can run several models at once, so two members of one configuration that
    /// agree on the root agent's model and differ on a reviewer's are two arms of a study, and a
    /// cell keyed on the root model alone would merge them.
    ///
    /// It names **which agent runs which model** rather than the bare set of models, because the
    /// bare set does not separate every pair of arms it is asked to: two members that swap one
    /// configuration's two models between its two launch slots bind the same models and are
    /// exactly the A/B a study is made of. A key that collapsed them would have one arm's runs
    /// satisfy the other's target, and the comparison would quietly run half.
    ///
    /// **Sorted** because it is compared, not read: the set a run recorded and the set a queued
    /// job was lifted from must produce the same string whatever order their agents happen to be
    /// declared in. Nothing parses it, so a slug carrying a character the grammar did not expect
    /// costs a possible collision with another such set and never a misreading.
    ///
    /// It exists here, on the contract, rather than at either end, because the run lift and the job
    /// lift both write it and a cell only counts while the two agree.
    pub fn bound_model_key(&self) -> String {
        let mut bindings: Vec<String> = Vec::new();
        for agent in &self.agents {
            if let Some(model) = agent.resolved_model_id() {
                bindings.push(format!("{}={model}", agent.slug));
            }
            if let Some(model) = agent.handoff_model_id() {
                bindings.push(format!("{}:compaction={model}", agent.slug));
            }
        }
        bindings.sort_unstable();
        bindings.dedup();
        bindings.join(",")
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
    /// The set declares no profile with this [slug](GgAgentConfig::slug) at all.
    UndeclaredProfile(&'a str),
    /// `shell` is an [FSM shell](GgAgentConfig::is_fsm_shell) whose machine has no readable
    /// [entry state](GgAgentConfig::fsm_entry_agent) — no states, or a first state naming no
    /// agent — so there is nothing for a dispatch onto it to become.
    UnreadableMachine {
        /// The [slug](GgAgentConfig::slug) of the shell profile whose machine could not be entered.
        shell: &'a str,
    },
    /// `shell` is an [FSM shell](GgAgentConfig::is_fsm_shell) whose machine enters a state running
    /// the `entry` agent, which the set does not declare.
    UndeclaredEntryAgent {
        /// The [slug](GgAgentConfig::slug) of the shell profile the dispatch was aimed at.
        shell: &'a str,
        /// The entry state's [`agent_id`](GgFsmState::agent_id) — the id that is actually missing.
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

/// **What a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) agent's window opens holding** — the
/// two lists and the [tree](GgOpeningTree) gg's synthesized opening turn is generated from, per
/// agent.
///
/// A code agent's first turn is a program gg writes in the agent's own language and runs before the
/// model has said a word: it searches the documentation of the modules named here, together, in one
/// listing keyed by their paths, and opens a documentation view of each function named here, in the
/// order written. The prompt names no function, so this is the only thing that hands a model its way
/// into its own surface; the lists are **configuration** rather than gg's choice because what a
/// window should open on is an operator's decision about the agent, and a study that varies it is a
/// study gg has no business deciding the answer to.
///
/// Both vocabularies are gg's cross-arm ones: [`modules`](Self::modules) names a module by its id
/// (the namespace half of an operation id — `files`, `shell`, `views`, …) and
/// [`functions`](Self::functions) names an operation (`files.read_file`), never an arm's own
/// spelling of either. The two lists are **independent**: a function's documentation is opened
/// whether or not its module is listed, and a module is listed whether or not any of its functions
/// is opened.
///
/// An entry gg has no vocabulary for refuses the launch, on the terms an
/// [allowlist](GgAgentConfig::operations) entry does; so does a function held by role or by
/// placement (an ending call, `delegation.transition_state`), which no configuration can promise.
/// An entry in the right vocabulary that *this* agent does not hold — a module none of whose
/// functions it may call, a function it was not granted — is dropped at seed time with a warning,
/// which is what lets one shared document describe agents with different grants. Duplicates are
/// opened once. Two lists that come out empty seed no program at all, which is a valid choice
/// rather than a defect.
///
/// **Required** on every agent, and always written: a document without it does not read. Its
/// [`tree`](Self::tree) is the one part a document may leave out. The authored default a fresh
/// profile is seeded with is [`GgAgentConfig::root`]'s — [`DEFAULT_OPENING_MODULES`],
/// [`DEFAULT_OPENING_FUNCTIONS`] and a tree at [`DEFAULT_OPENING_TREE_DEPTH`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgOpeningTurn {
    /// The gg module ids whose whole function list the opening program searches for, together, in
    /// one directory listing keyed by the modules in this order: `files`, `shell`, `board`, ….
    pub modules: Vec<String>,
    /// The operation ids whose documentation view the opening program opens, in this order:
    /// `docs.search`, `views.open_file`, ….
    pub functions: Vec<String>,
    /// Whether the opening program opens a [tree](GgOpeningTree) of the workspace, and how deep.
    ///
    /// Optional in a document, unlike the two lists, because every capability set written before
    /// gg had a tree call left it out and those documents open the window they always opened:
    /// [`GgOpeningTree::default`] is the tree switched off. A fresh profile is seeded with it on
    /// ([`GgOpeningTurn::seeded`]).
    #[serde(default, skip_serializing_if = "GgOpeningTree::is_default")]
    pub tree: GgOpeningTree,
}

/// **The workspace tree a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) agent's window opens
/// holding** — whether gg's synthesized opening turn calls `files.tree` at all, and the depth it
/// calls it with.
///
/// A model that opens a window on the prompt alone has to guess at paths, and a guess that names a
/// file the workspace does not hold costs the whole program the turn was spent on. The opening
/// tree answers the question those guesses ask, and it is configuration rather than gg's choice
/// for the same reason the two lists beside it are: what a window opens on is an operator's
/// decision about the agent.
///
/// [`include`](Self::include) and [`depth`](Self::depth) are independent, so a study that switches
/// the tree off and on again gets the depth it chose back rather than gg's.
///
/// The tree is dropped at seed time for an agent that does not hold `files.tree`, on the same terms
/// a listed module or function it does not hold is. A [`depth`](Self::depth) gg cannot honour
/// refuses the launch whether or not `include` is set, because a document holding a number gg would
/// not honour is refused where it is written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgOpeningTree {
    /// Whether the opening program calls `files.tree` at all.
    #[serde(default)]
    pub include: bool,
    /// The depth that call names: levels of children below the workspace root, `1` being the root's
    /// own entries. Held to `1..=`[`MAX_OPENING_TREE_DEPTH`] at launch.
    #[serde(default = "default_opening_tree_depth")]
    pub depth: u32,
}

/// [`GgOpeningTree::depth`]'s default, as a function serde can name.
fn default_opening_tree_depth() -> u32 {
    DEFAULT_OPENING_TREE_DEPTH
}

impl Default for GgOpeningTree {
    /// The tree switched off, at the authored depth — what a document written without a `tree` key
    /// reads as.
    fn default() -> Self {
        Self {
            include: false,
            depth: DEFAULT_OPENING_TREE_DEPTH,
        }
    }
}

impl GgOpeningTree {
    /// Whether this is the [default](Self::default) — no tree, at the authored depth — which is
    /// what a document that names no tree at all reads as and what one is written back without.
    ///
    /// A depth kept across the switch going off is *not* default, so an operator's chosen depth
    /// survives a round trip through a stored document.
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

impl GgOpeningTurn {
    /// The opening turn a fresh profile is **seeded** with — [`DEFAULT_OPENING_MODULES`] and
    /// [`DEFAULT_OPENING_FUNCTIONS`] — which is what [`GgAgentConfig::root`] writes.
    ///
    /// An authored document, not a runtime default: gg reads the field as written and never
    /// substitutes this for an absent one.
    pub fn seeded() -> Self {
        Self {
            modules: DEFAULT_OPENING_MODULES
                .iter()
                .map(|id| id.to_string())
                .collect(),
            functions: DEFAULT_OPENING_FUNCTIONS
                .iter()
                .map(|id| id.to_string())
                .collect(),
            tree: GgOpeningTree {
                include: true,
                depth: DEFAULT_OPENING_TREE_DEPTH,
            },
        }
    }

    /// Whether both lists are empty and no tree is asked for — an agent whose window opens on the
    /// build prompt alone.
    pub fn is_empty(&self) -> bool {
        self.modules.is_empty() && self.functions.is_empty() && !self.tree.include
    }
}

/// A single **agent profile** within a [`GgCapabilitySet`] — the per-agent unit that
/// makes gg's capabilities configurable independently for each agent in a run.
///
/// Every profile has a unique [`id`](Self::id) and a [display name](Self::name) that need not be
/// (the first profile of a default set is [`root`](ROOT_PROFILE_ID), called
/// [Root](ROOT_AGENT)), its own enabled [capabilities](Self::capabilities) and the
/// [tool](Self::tools) or [operation](Self::operations) allowlist that narrows them, its own model
/// (pinned via [`model_id`](Self::model_id) or [deferred](Self::model_slot) to a launch-time
/// [model slot](GgModelSlot)), an optional
/// [custom prompt](Self::custom_instructions) / [full template override](Self::system_prompt_template),
/// and the set of other agents it may spawn as [subagents](Self::subagents).
///
/// An agent is put to work **by id**: `spawn_subagent` and `exec`
/// all name the target agent's [id](Self::id), which must appear in the caller's
/// [roster](Self::subagents) with the
/// [`subagent`](GgSubagentScope::Subagent) scope — as must an [issue](GgBoardIssue)'s implementer
/// (the [`implementer`](GgSubagentScope::Implementer) scope) and its reviewers (the
/// [`reviewer`](GgSubagentScope::Reviewer) scope). A profile may list itself, allowing recursion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgAgentConfig {
    /// The profile's **internal identifier**: opaque text, minted when the profile is created,
    /// never rewritten, and shown to nobody. Its only job is to be the same text tomorrow.
    ///
    /// Everything *inside an authored configuration* that points at a profile points at this —
    /// a [roster entry](GgSubagentRef::agent_id), a machine's [state](GgFsmState::agent_id), the
    /// [merge agent](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT), a
    /// [configuration slot](GgConfigSlot)'s [target](GgSlotTarget::agent), and a configuration's
    /// link to the saved agent a profile follows. That is what makes renaming free and importing
    /// safe: no reference breaks because a name changed, and two profiles showing one name are
    /// still two profiles.
    ///
    /// **Absent once a launch has resolved the set**, which is what the field says. Launching
    /// rewrites every reference to the profile's [slug](Self::slug) and drops the ids, so the set
    /// gg reads and a run records names profiles by the one name the operator wrote and the model
    /// was shown. gg refuses a set that still carries one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub id: Option<String>,
    /// The profile's **slug**: the name the model reads, written by the operator, unique within
    /// the set, and shaped by [`is_valid_agent_slug`].
    ///
    /// A roster in a prompt names slugs, and the slug is what the model passes back as the `agent`
    /// argument of `spawn_subagent`, `exec` and `create_issue`. It is also what a run names a
    /// profile by everywhere afterwards — every telemetry event, every accounting row, an
    /// [issue](GgBoardIssue::agent_id)'s implementer and reviewers, and the analysis query
    /// language — so what an operator writes is what they later slice by.
    ///
    /// The model needs a name of its own for the same reason everything else does: a display
    /// [name](Self::name) may repeat, so it cannot say which profile is meant. It is shaped rather
    /// than free because the model has to copy it back without deciding how to spell it.
    /// [`ROOT_PROFILE_ID`] is the slug of the first profile of a default set.
    pub slug: String,
    /// The profile's **display name**: what the console, the run log and a roster's prose call
    /// this agent. `"Root"` ([`ROOT_AGENT`]) for the first profile of a default set.
    ///
    /// Free-form and mutable, and **not** unique: two profiles may carry one name. Nothing
    /// resolves a reference by reading it, which is what makes renaming a profile free.
    pub name: String,
    /// The capabilities this agent is configured with, each identified by a stable id.
    ///
    /// A capability absent from this list is off *and* unconfigured, and absence from the list is
    /// the **only** way to leave a capability unconfigured. One present and enabled is **fully
    /// specified**: it writes an [`implementation`](GgCapabilityConfig::implementation) wherever
    /// the capability offers arms and every param that capability requires, and a launch that finds
    /// one of them missing is refused. One present but
    /// [disabled](GgCapabilityConfig::enabled) is off yet records the configuration it would have
    /// used, which keeps two configurations differing only in that switch comparable, and is held
    /// to nothing beyond the values it does write being honourable.
    ///
    /// An id declared twice on one agent refuses the launch: the first declaration answers every
    /// lookup, so the second one's switch, arm and params would configure nothing while the run's
    /// record carried them.
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
    /// The [launch-time model parameters](GgModelSlot) this agent declares, for its own
    /// bindings that defer to one instead of pinning a model.
    ///
    /// The slots belong to the agent, so they travel with it: a
    /// [saved agent](GgAgentConfig) imported into a configuration brings the slots its
    /// bindings name, and the configuration decides how each reaches the launch form.
    /// Empty for a fully pinned agent, for an [FSM shell](Self::is_fsm_shell), which runs
    /// no model, and on the set a run records, because launching resolves every deferred
    /// binding first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub model_slots: Vec<GgModelSlot>,
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
    /// What this agent's window **opens holding** under
    /// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE): the modules gg's synthesized opening
    /// turn lists and the functions whose documentation it opens — see [`GgOpeningTurn`] for the
    /// vocabulary and the held/drop/refuse rules. Read only for an agent that writes programs;
    /// carried, and still required, on a tool-calling one, so that the one switch between the two
    /// modes stays a one-line edit.
    ///
    /// **Required and always written.** There is no default gg substitutes for an absent key: the
    /// lists an agent opens on are part of the agent's record, and a document that omits them does
    /// not read. [`GgAgentConfig::root`] seeds a fresh profile with [`GgOpeningTurn::seeded`].
    pub opening_turn: GgOpeningTurn,
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
    /// How hard this agent asks its model to think, carried on every request of the agent as the
    /// unified `reasoning` request object — see [`GgReasoning`] for the two ways to name it and
    /// what each sends.
    ///
    /// `None`, and a configuration that never touched the lever omits the key entirely: no
    /// parameter is sent and the model runs at its provider's default. A declaration that is
    /// present must name exactly one of its two values, and one that does not is
    /// [refused at launch](GgReasoning::is_honourable) rather than read as either.
    ///
    /// Beside the [prompt-cache lifetime](Self::prompt_cache_ttl) because it is the other
    /// per-agent lever over how a request is made rather than what it says, and offered by the
    /// console's agent form beside it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub reasoning: Option<GgReasoning>,
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
    /// A fresh [Root agent](ROOT_AGENT) with the default capabilities — each **fully specified**,
    /// carrying the arm and the whole params object the [authoring catalog](gg_authoring_catalog)
    /// writes — every call those capabilities offer granted on both surfaces, and no model binding.
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
            id: None,
            slug: ROOT_PROFILE_ID.to_string(),
            name: ROOT_AGENT.to_string(),
            capabilities: default_capabilities(),
            model_id: String::new(),
            model_slot: None,
            model_slots: Vec::new(),
            tools: DEFAULT_TOOLS.iter().map(|name| name.to_string()).collect(),
            operations: DEFAULT_OPERATIONS.iter().map(|id| id.to_string()).collect(),
            opening_turn: GgOpeningTurn::seeded(),
            custom_instructions: None,
            system_prompt_template: None,
            prompt_cache_ttl: GgPromptCacheTtl::default(),
            reasoning: None,
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

    /// The [agent profile](GgFsmState::agent_id) this shell's machine **enters first** — the agent an
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
            .get("agentId")?
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

    /// The declaration of this agent's [model slot](GgModelSlot) named `name`, or `None`
    /// when it declares no such slot.
    pub fn model_slot_decl(&self, name: &str) -> Option<&GgModelSlot> {
        self.model_slots.iter().find(|s| s.name == name)
    }

    /// Every [model slot](GgModelSlot) name this agent's bindings defer to, in the order
    /// they are read and without repeats: its own model binding, then each capability
    /// param that names a slot.
    ///
    /// A name here that this agent does not [declare](Self::model_slots) is a binding
    /// nothing can fill, which refuses the launch.
    pub fn deferred_slot_names(&self) -> Vec<&str> {
        let compaction = self
            .capability(CAPABILITY_COMPACTION)
            .and_then(|c| c.params.get(COMPACTION_PARAM_MODEL_SLOT))
            .and_then(|v| v.as_str());
        let mut names: Vec<&str> = Vec::new();
        for name in [self.model_slot.as_deref(), compaction]
            .into_iter()
            .flatten()
        {
            let name = name.trim();
            if !name.is_empty() && !names.contains(&name) {
                names.push(name);
            }
        }
        names
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

    /// Whether this agent may use the profile `target_id` in `scope` — i.e. that profile appears
    /// in its [roster](Self::subagents) carrying that scope.
    pub fn allows_scope(&self, target_id: &str, scope: GgSubagentScope) -> bool {
        self.subagents
            .iter()
            .any(|s| s.agent_id == target_id && s.has_scope(scope))
    }

    /// Whether this agent may **spawn** the profile `target_id` — the
    /// [`subagent`](GgSubagentScope::Subagent) scope.
    pub fn can_spawn(&self, target_id: &str) -> bool {
        self.allows_scope(target_id, GgSubagentScope::Subagent)
    }

    /// The [ids](Self::id), in declaration order, of the profiles this agent may use in `scope`.
    pub fn agents_in_scope(&self, scope: GgSubagentScope) -> Vec<&str> {
        self.subagents
            .iter()
            .filter(|s| s.has_scope(scope))
            .map(|s| s.agent_id.as_str())
            .collect()
    }

    /// The caller-scoped description for using the profile `target_id`, or `None` when it is
    /// not in this agent's roster.
    pub fn subagent_description(&self, target_id: &str) -> Option<&str> {
        self.subagents
            .iter()
            .find(|s| s.agent_id == target_id)
            .map(|s| s.description.as_str())
    }
}

/// One roster entry as a **model-facing** surface presents it: the target profile's
/// [slug](GgAgentConfig::slug) — which is what the model passes back — its
/// [name](GgAgentConfig::name), and the caller-scoped guidance for using it.
///
/// The name is here so a menu reads as prose (`` `reviewer` (Careful Reviewer) ``); the slug is
/// the whole of what a call is resolved against. Nothing matches on the name, because two
/// profiles may share one and a call has to name exactly one thing.
#[derive(Debug, Clone, PartialEq)]
pub struct GgRosterEntry {
    /// The [slug](GgAgentConfig::slug) of the profile this entry points at — the value the model
    /// passes as `agent`.
    pub agent_id: String,
    /// The target's [display name](GgAgentConfig::name), for the menu's prose.
    pub name: String,
    /// Caller-scoped guidance on when to use it. May be empty.
    pub description: String,
}

impl GgRosterEntry {
    /// Whether `entries` offers the profile `agent_id` — the check a delegation call is admitted
    /// by. Trimmed, since that is how the argument arrives.
    pub fn offers(entries: &[GgRosterEntry], agent_id: &str) -> bool {
        let wanted = agent_id.trim();
        entries.iter().any(|entry| entry.agent_id == wanted)
    }

    /// The profile ids `entries` offers, in roster order — the vocabulary a tool schema
    /// enumerates.
    pub fn ids(entries: &[GgRosterEntry]) -> Vec<String> {
        entries.iter().map(|entry| entry.agent_id.clone()).collect()
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
    /// The target profile this agent may put to work (may be the spawner itself). A reference the
    /// set does not declare refuses the launch.
    ///
    /// Names the profile's internal [id](GgAgentConfig::id) while the configuration is authored and
    /// its [slug](GgAgentConfig::slug) once launching has resolved them; whether the set still
    /// carries ids says which.
    pub agent_id: String,
    /// Caller-scoped guidance on when to use the target, surfaced in the spawning
    /// agent's `spawn_subagent` tool description and in the prompt's roster. May be empty.
    #[serde(default)]
    pub description: String,
    /// **What** this agent may use the target for — one or more. An entry may carry several scopes:
    /// the same profile is often both a reasonable implementer and a reasonable reviewer.
    ///
    /// An entry that names none can be used for nothing, and is
    /// [refused at launch](https://docs.testcabinet.ai/gg/configurations/) rather than read as a
    /// scope gg chose for it — a roster line that permits nothing is a delegation the document
    /// describes and the run cannot make.
    #[serde(default)]
    pub scopes: Vec<GgSubagentScope>,
}

impl GgSubagentRef {
    /// A roster entry pointing at `agent_id` in exactly `scopes`, with no description.
    pub fn new(agent_id: impl Into<String>, scopes: &[GgSubagentScope]) -> Self {
        Self {
            agent_id: agent_id.into(),
            description: String::new(),
            scopes: scopes.to_vec(),
        }
    }

    /// A roster entry pointing at `agent_id` in **every** scope — spawnable, assignable, and
    /// reviewable. The permissive shape a set that draws no distinction between the three roles
    /// wants.
    pub fn any(agent_id: impl Into<String>) -> Self {
        Self::new(agent_id, &ALL_SUBAGENT_SCOPES)
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
    /// This target may be named as an [issue](GgBoardIssue::agent_id)'s **implementer** — the profile
    /// gg dispatches to do the issue's work (and re-dispatches for each retry and review round).
    Implementer,
    /// This target may be named among an [issue](GgBoardIssue::reviewer_ids)'s **reviewers** — the
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

/// The [effort](GgReasoning::effort) levels a reasoning setting names — the vocabulary
/// OpenRouter's unified `reasoning` request object speaks, which the provider maps onto whatever
/// the model's own parameter is called.
///
/// [`Low`](Self::Low) and below are what a run reaches for when a model's default effort is more
/// than its task warrants: a small model reasoning at full effort on a two-hundred-token program
/// spends thousands of reasoning tokens and minutes per request on work that needs neither.
/// [`None`](Self::None) is the same demand stated absolutely.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgReasoningEffort {
    /// The provider's highest effort.
    XHigh,
    /// High effort.
    High,
    /// Medium effort.
    Medium,
    /// Low effort.
    Low,
    /// The least reasoning the provider can do with a reasoning model still reasoning.
    Minimal,
    /// No reasoning at all.
    None,
}

impl GgReasoningEffort {
    /// Every level, in declaration order — what an editor offers and what a validation enumerates.
    pub const ALL: [GgReasoningEffort; 6] = [
        GgReasoningEffort::XHigh,
        GgReasoningEffort::High,
        GgReasoningEffort::Medium,
        GgReasoningEffort::Low,
        GgReasoningEffort::Minimal,
        GgReasoningEffort::None,
    ];

    /// The level's wire spelling — the same string its
    /// [serialization](GgReasoningEffort#impl-Serialize-for-GgReasoningEffort) produces, and what
    /// the `reasoning` request object's `effort` field is written with.
    pub fn as_str(self) -> &'static str {
        match self {
            GgReasoningEffort::XHigh => "xhigh",
            GgReasoningEffort::High => "high",
            GgReasoningEffort::Medium => "medium",
            GgReasoningEffort::Low => "low",
            GgReasoningEffort::Minimal => "minimal",
            GgReasoningEffort::None => "none",
        }
    }
}

impl fmt::Display for GgReasoningEffort {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// How hard one [agent](GgAgentConfig::reasoning) asks its model to think: an
/// [effort](Self::effort) level or a [budget](Self::max_tokens) of reasoning tokens, exactly one
/// of the two. Absent from a profile entirely, the model runs at its provider's default and gg
/// sends no `reasoning` parameter for that agent at all.
///
/// It rides on **every request of the agent's own model**, its turns and the compaction summaries
/// written on that model alike, as OpenRouter's unified `reasoning` request object, one key wide:
/// `{"effort": "low"}` or `{"max_tokens": 8192}`. The provider maps that object onto whatever the
/// model's own parameter is, so the vocabulary here is the unified one rather than any one
/// provider's spelling.
///
/// The two are **exclusive**, and a declaration that names both, names neither, or names a
/// [`max_tokens`](Self::max_tokens) of zero is refused at launch rather than read as either one:
/// gg substitutes nothing, and a run that quietly picked one half of a contradictory declaration
/// would record a setting its operator never chose. A budget of zero is refused rather than read
/// as [`none`](GgReasoningEffort::None) for the same reason — that demand has a spelling of its
/// own, and this one names no count of tokens a reply could think in.
///
/// Per agent rather than per run because the effort is a property of the *task*: a run whose root
/// writes whole programs wants more of it than the reviewer reading their diff, and a study that
/// varies one against the other is one configuration with two profiles.
///
/// A handoff summarizer bound to a second model is sent none: the setting is
/// tuned to the agent's own model, and a budget one provider accepts is one another refuses.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReasoning {
    /// The effort level, one of [`GgReasoningEffort`]. Mutually exclusive with
    /// [`max_tokens`](Self::max_tokens).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub effort: Option<GgReasoningEffort>,
    /// The reasoning-token budget, for the providers that cap reasoning by tokens rather than
    /// naming a level. A whole count of one or more (`60` and `60.0` are the same count), and
    /// mutually exclusive with [`effort`](Self::effort).
    #[serde(
        default,
        deserialize_with = "count::option_u64",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_tokens: Option<u64>,
}

impl GgReasoning {
    /// Whether this declaration names exactly one of the two — an [effort](Self::effort) or a
    /// non-zero [budget](Self::max_tokens) — and so can be sent as written.
    ///
    /// The rule the launch check refuses on: `false` for a declaration naming both, naming
    /// neither, or naming a budget of zero.
    pub fn is_honourable(&self) -> bool {
        match (self.effort, self.max_tokens) {
            (Some(_), None) => true,
            (None, Some(tokens)) => tokens > 0,
            _ => false,
        }
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
/// **An armed detector writes all five knobs.** What the rule trips on is the whole set of them
/// together — a lookback, a frequency, a breadth, a persistence and a backstop — so a detector
/// armed on figures nobody chose measures gg rather than the model, and an armed detector missing
/// any of them refuses the launch. An **unarmed** one owes none of them, and a knob written on one
/// is still read and still judged as written, which is what keeps the armed and unarmed arms of one
/// comparison the same document with one switch moved. A knob **set** to a value that cannot bound
/// anything — a zero window, a zero threshold, a demand for no offenders — is a launch **failure**,
/// on the same terms as [`GgRunLimits`].
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
    /// Whether the detector runs for this agent at all. `false`, which is what a profile that says
    /// nothing about loop detection reads as, leaves the agent on gg's ordinary non-streaming
    /// transport and no reply is ever discarded; `true` arms the
    /// detector **and** switches the transport to streaming, because a detector that can only read a
    /// completed reply has already let every cost it exists to avoid be paid.
    pub enabled: bool,
    /// `N` — how many of the most recent words the detector looks back over when deciding whether a
    /// reply has become repetitive, and the minimum sample: the repetition rule cannot fire until
    /// this many words have arrived.
    ///
    /// One of the five knobs an **armed** detector writes. What the rule trips on is the five of
    /// them together, so a detector armed on figures nobody chose would measure gg rather than the
    /// model, and an armed detector missing any of them refuses the launch. An unarmed detector owes
    /// none of them, and a knob written on one is still read and still judged as written.
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
    /// `P` — how many times a single word may occur within the [window](Self::window_words) before
    /// it counts as an *offender*. Written and required on the terms
    /// [`window_words`](Self::window_words) is.
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
    /// *saturated*. Written and required on the terms [`window_words`](Self::window_words) is.
    ///
    /// More than one is worth asking for because a single very common token (`the`, `0,`, a brace)
    /// is ordinary; a loop repeats a whole fragment, so it saturates several words together.
    #[serde(
        deserialize_with = "count::option_u64",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub min_offenders: Option<u64>,
    /// `R` — how many consecutive words must arrive while the window stays saturated before gg
    /// abandons the reply. Written and required on the terms
    /// [`window_words`](Self::window_words) is.
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
    /// *repetitive* enough to trip the window rule. Written and required on the terms
    /// [`window_words`](Self::window_words) is; `0` turns the backstop off and leaves only the
    /// repetition rule, which is a declaration rather than an omission.
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
/// loop needs to build a test case, the [search](CAPABILITY_SEARCH) that finds where to point
/// them, plus [skills](CAPABILITY_SKILLS), [memories](CAPABILITY_MEMORIES), and
/// [tasks](CAPABILITY_TASKS).
///
/// Each filesystem tool is its own capability, so each carries its own implementation and
/// params and can be varied one at a time; all five are on by default.
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
        GgCapabilityConfig::enabled(CAPABILITY_SEARCH),
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
    "tree",
    "search",
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
    "files.write_file",
    "files.edit_file",
    "files.list_dir",
    // The list-dir capability's second row: a directory's entries and the tree beneath one are two
    // separately granted calls over one capability.
    "files.tree",
    "files.search",
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

/// The **modules** a fresh profile's [opening turn](GgOpeningTurn::modules) lists: the two an agent
/// that builds anything reaches for first. Every module the agent holds is named in its prompt, one
/// line each, and a module path is an exact lookup into the surface — so a module the agent turns
/// out to need costs it one search, while a module it never touches costs it nothing. Listing all
/// of them up front would spend a directory apiece on the ones a run never reaches for, on every
/// request of that run.
///
/// The authored default and nothing more: gg reads an agent's own list, never this one.
pub const DEFAULT_OPENING_MODULES: &[&str] = &["files", "shell"];

/// The **depth** a fresh profile's [opening tree](GgOpeningTree::depth) is walked to, and the depth
/// a document that names none reads as.
///
/// Two levels answer the question a model's opening guesses ask — what a named directory holds —
/// without walking a monorepo, which is what a deeper default would spend on every run.
pub const DEFAULT_OPENING_TREE_DEPTH: u32 = 2;

/// The deepest [opening tree](GgOpeningTree::depth) a configuration may name. A larger value refuses
/// the launch rather than being clamped, because the number is authored rather than computed.
pub const MAX_OPENING_TREE_DEPTH: u32 = 10;

/// The **functions** a fresh profile's [opening turn](GgOpeningTurn::functions) opens the
/// documentation of: the calls discovery and showing are made of, and nothing else.
///
/// First, both halves of the loop the prompt describes, in the order it describes them — a model
/// searches for what it needs and then opens a documentation view of what it found — so the
/// transcript's first turn reads as the loop rather than as two unrelated calls. Then every other
/// function that puts something in the agent's own window (the text view every run has, and the
/// file view an agent holding `read-file` has), and the workspace search, so the call that greps a
/// workspace is read before it is written.
///
/// Held to gg's operations table by the same test the allowlist defaults are. The authored default
/// and nothing more: gg reads an agent's own list, never this one.
pub const DEFAULT_OPENING_FUNCTIONS: &[&str] = &[
    "docs.search",
    "views.open_docs_view",
    "views.open_text",
    "views.open_file",
    "files.search",
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
    /// The arm this capability is configured on, for the five capabilities that offer arms to
    /// choose between: [shell](CAPABILITY_SHELL), [read-file](CAPABILITY_READ_FILE),
    /// [memories](CAPABILITY_MEMORIES), [compaction](CAPABILITY_COMPACTION) and
    /// [autoload specifications](CAPABILITY_AUTOLOAD_SPECS).
    ///
    /// **An enabled capability that offers arms writes one.** Leaving it out refuses the launch
    /// rather than selecting one, because the arm is the independent variable and a run measured on
    /// one arm while its record names another is worse than no run. The single exception is
    /// autoload specifications, whose one arm is [`locked`](AUTOLOAD_LOCKED_IMPL): there an
    /// unwritten implementation is itself the declaration that the seeded specifications are
    /// ordinary file views, which is a reading of absence rather than a substitution for it.
    ///
    /// A name the capability does not offer refuses the launch, and so does any name at all on one
    /// of the seventeen capabilities that offer none. `Option` on the wire so a configuration already
    /// stored in the database still deserializes and still opens in the editor: what a missing
    /// required arm costs is the *launch*, not the parse. The
    /// [authoring catalog](gg_authoring_catalog) is what writes one into a new document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub implementation: Option<String>,
    /// The capability's parameters, interpreted by the capability itself.
    ///
    /// **An enabled capability writes every param it requires.** An absent one refuses the launch,
    /// named at its own locus beside every other defect in the document, because gg substitutes
    /// nothing: every figure a run is conducted and recorded under is a figure written here. A
    /// param that is *optional* — [compaction](CAPABILITY_COMPACTION)'s
    /// [`model`](COMPACTION_PARAM_MODEL) and [`modelSlot`](COMPACTION_PARAM_MODEL_SLOT),
    /// [project management](CAPABILITY_PROJECT_MANAGEMENT)'s [`reviewers`](PARAM_REVIEWERS) — is
    /// **off when it is absent**, and that absence is the setting rather than a stand-in for a
    /// figure.
    ///
    /// A **disabled** capability configures nothing and so requires nothing of itself, while the
    /// values written on it are still read and still refused if gg cannot honour them.
    ///
    /// The object stays free-form on the wire — its keys are the selected capability's own
    /// vocabulary, which no shared type could express — and every key is checked against that
    /// vocabulary at launch. The [authoring catalog](gg_authoring_catalog) is what *writes* one;
    /// nothing that reads a configuration consults it. Deserializes to an empty object when the key
    /// is absent, so a stored document still parses and still opens in the editor.
    #[serde(default = "empty_params")]
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub params: Value,
}

impl GgCapabilityConfig {
    /// A capability present and enabled, **fully specified**: the arm and the whole params object
    /// the [authoring catalog](gg_authoring_catalog) writes for `id`.
    ///
    /// This is authoring rather than resolution. It states figures in a document for an operator to
    /// keep or change, exactly as the console's editor does the moment a capability is switched on;
    /// gg then reads that document and chooses nothing of its own. Every capability this crate
    /// constructs is therefore launchable as it stands, and every capability an operator edits
    /// afterwards carries the figures they left in it.
    ///
    /// An id outside [`GG_CAPABILITY_CATALOG`] has no catalog entry and gets no arm and no params.
    /// A set carrying such an id is refused at launch by name, so there is nothing here to author
    /// for it.
    pub fn enabled(id: impl Into<String>) -> Self {
        let id = id.into();
        let authored = authored_capability(&id);
        Self {
            id,
            enabled: true,
            implementation: authored.and_then(|entry| entry.implementation.map(str::to_string)),
            params: authored.map_or_else(empty_params, |entry| entry.params.clone()),
        }
    }

    /// A capability present but **disabled** — inert, and carrying the same fully specified arm and
    /// params [`enabled`](Self::enabled) writes.
    ///
    /// A disabled capability configures nothing, so nothing is *required* of it; what it records is
    /// the configuration the arm would have used, which is what keeps the on and off arms of one
    /// comparison the same document with one switch moved. Values written on it are still read and
    /// still refused if gg cannot honour them, so a typo in one is heard about now rather than on
    /// the launch that flips the switch.
    pub fn disabled(id: impl Into<String>) -> Self {
        Self {
            enabled: false,
            ..Self::enabled(id)
        }
    }

    /// This capability with one param overridden: the [catalog](gg_authoring_catalog)'s object with
    /// `key` set to `value` and every other key it wrote left standing.
    ///
    /// It **merges**, and that is the whole of its contract. A caller changing one figure asked for
    /// one figure changed; replacing the object would hand back a capability short of the params it
    /// requires, which is a document that refuses its own launch — and would do so naming a param
    /// the caller never touched.
    pub fn with_param(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        let (key, value) = (key.into(), value.into());
        match self.params.as_object_mut() {
            Some(params) => {
                params.insert(key, value);
            }
            // A params object that is not an object at all cannot be merged into; it came from a
            // hand-written document, and the launch refuses it either way.
            None => self.params = Value::Object([(key, value)].into_iter().collect()),
        }
        self
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
    /// The [reasoning setting](GgReasoning) the client built for this binding sends on every
    /// request — carried here for the same reason the [prompt-cache lifetime](Self::prompt_cache_ttl)
    /// is: the binding is what a client is resolved from, and how hard the model is asked to think
    /// is a property of the *agent* whose work that client serves, not of the model it runs on.
    /// `None` unless the agent profile this binding was built for named one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub reasoning: Option<GgReasoning>,
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
            reasoning: None,
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
            reasoning: None,
            loop_detection: GgLoopDetection::default(),
        }
    }

    /// This binding with `ttl` as the [prompt-cache lifetime](GgPromptCacheTtl) its client asks
    /// for — how an agent profile's choice reaches the client resolved for it.
    pub fn with_prompt_cache_ttl(mut self, ttl: GgPromptCacheTtl) -> Self {
        self.prompt_cache_ttl = ttl;
        self
    }

    /// This binding with `reasoning` as the [reasoning setting](GgReasoning) its client sends on
    /// every request — how an agent profile's choice reaches the client resolved for it. `None`
    /// leaves every request of this binding without a `reasoning` parameter.
    pub fn with_reasoning(mut self, reasoning: Option<GgReasoning>) -> Self {
        self.reasoning = reasoning;
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

/// A **launch-time model parameter** an [agent profile](GgAgentConfig) declares.
///
/// An agent is meant to be reusable across models, so the model it runs on need not be
/// baked into it. Each of its model bindings — its own [model](GgAgentConfig::model_slot)
/// and every capability param that names one, today
/// [compaction's handoff](COMPACTION_PARAM_MODEL_SLOT) — either pins a model outright or
/// defers to one of the slots the agent declares here.
///
/// A slot belongs to the agent that declares it, which is what lets a
/// [saved agent](GgAgentConfig) carry its slots into every configuration that imports it,
/// and lets two agents each declare a `critic` without meaning one launch input.
///
/// An agent slot reaches the launch form one of two ways, and exactly one: a
/// [configuration slot](GgConfigSlot) [names](GgSlotTarget) it, or it is
/// [passthrough](Self::passthrough) and is exposed on its own. A slot that is neither
/// leaves its bindings with no model to take; one that is both asks twice for the same
/// binding. Both refuse the launch.
///
/// Declaring one is an authoring concern only. Launching resolves every deferred binding
/// to a concrete model, so this list is empty on the capability set a run records — what
/// ran is a set of pinned bindings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgModelSlot {
    /// The slot's name, as this agent's bindings refer to it. Unique within the agent.
    pub name: String,
    /// The model the launch form pre-fills this slot with. `None` leaves it to the
    /// [configuration slot](GgConfigSlot::default_model_id) that fills this one, or —
    /// when nothing supplies a default — to the operator on the launch form.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub default_model_id: Option<String>,
    /// Whether this slot is exposed at launch on its own, without a
    /// [configuration slot](GgConfigSlot) naming it. The launch form labels a passthrough
    /// slot `<agent id>.<slot name>`, which is what keeps it distinct from every other
    /// launch input.
    ///
    /// It exists so a configuration is spared declaring a slot whose only job is to
    /// forward one, which is the common case: most agents want their own model chosen at
    /// launch and share it with nobody.
    #[serde(default, skip_serializing_if = "is_false")]
    pub passthrough: bool,
}

/// The values `items` yields more than once, in first-seen order and each reported once.
fn repeated<'a>(items: impl Iterator<Item = &'a str>) -> Vec<&'a str> {
    let mut seen: Vec<&'a str> = Vec::new();
    let mut twice: Vec<&'a str> = Vec::new();
    for item in items {
        if seen.contains(&item) {
            if !twice.contains(&item) {
                twice.push(item);
            }
        } else {
            seen.push(item);
        }
    }
    twice
}

/// Whether `value` is `false` — the `skip_serializing_if` for a flag whose absence is its
/// off position.
fn is_false(value: &bool) -> bool {
    !*value
}

/// The [launch input](GgLaunchSlot) name a [passthrough](GgModelSlot::passthrough) agent
/// slot is exposed under: the profile's [slug](GgAgentConfig::slug) and the slot's name,
/// separated by a dot.
///
/// Agent ids are unique within a set and slot names unique within an agent, so this names
/// exactly one agent slot.
pub fn passthrough_slot_name(agent_id: &str, slot: &str) -> String {
    format!("{agent_id}.{slot}")
}

/// A **launch input** a [`GgCapabilitySet`] declares, and the
/// [agent slots](GgModelSlot) it fills.
///
/// A run asks for exactly one set of models and the configuration decides what that set
/// is. One configuration slot filling several agent slots is what makes "run the reviewer
/// *and* the merge agent on whatever I pick for `critic`" one launch input rather than
/// two.
///
/// Declaring one is a configuration-authoring concern only. Launching resolves every
/// deferred binding to a concrete model, so this list is empty on the capability set a
/// run records.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgConfigSlot {
    /// The slot's name, as the launch form labels it and keys its answer by. Unique
    /// within a set, and distinct from every `<agent id>.<slot name>` a
    /// [passthrough](GgModelSlot::passthrough) slot is exposed under.
    pub name: String,
    /// The model the launch form pre-fills this slot with. `None` takes the default of
    /// the first [target](Self::targets) that carries one, so importing an agent that
    /// defaults its own slot keeps that default working.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub default_model_id: Option<String>,
    /// The [agent slots](GgModelSlot) this input fills. Each names a profile the set
    /// declares and a slot that profile declares, and no agent slot is named by two
    /// configuration slots.
    #[serde(default)]
    pub targets: Vec<GgSlotTarget>,
}

/// One [agent slot](GgModelSlot) a [configuration slot](GgConfigSlot) fills.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSlotTarget {
    /// The [id](GgAgentConfig::id) of the profile whose slot this fills.
    pub agent: String,
    /// The [name](GgModelSlot::name) of that profile's slot.
    pub slot: String,
}

/// One **launch input** a configuration exposes, as the launch form asks for it: every
/// [configuration slot](GgConfigSlot) in declaration order, then every
/// [passthrough](GgModelSlot::passthrough) agent slot in agent order.
///
/// This is the single set of models a run is launched with. What differs between the two
/// kinds is only where the declaration lives; both fill the same
/// [agent slots](Self::targets).
#[derive(Debug, Clone, PartialEq)]
pub struct GgLaunchSlot {
    /// The name the form labels this input with and keys its answer by — a configuration
    /// slot's own name, or `<agent id>.<slot name>` for a passthrough one.
    pub name: String,
    /// The model the form pre-fills, resolved through the configuration slot's own
    /// default and then its targets'.
    pub default_model_id: Option<String>,
    /// The [agent slots](GgModelSlot) this input fills.
    pub targets: Vec<GgSlotTarget>,
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
        /// How long it may run before it is killed. **Required** on a command hook: the ceiling a
        /// build or a test suite needs is nothing gg could know, and a hook killed at a figure
        /// nobody wrote is a gate that reports a failure the workspace did not have. An absent one
        /// refuses the launch. `Option` on the wire so a stored configuration still deserializes
        /// and still opens in the editor.
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
/// **Two are required, three default, and five are armed by being written.**
/// [`max_parallel`](Self::max_parallel) and [`replay_max_bytes`](Self::replay_max_bytes) bound
/// every run gg conducts — the pool it runs agents in and the journal it writes as it goes — and
/// neither has a figure that means "no cap", so an absent one refuses the launch.
/// [`model_call_timeout_secs`](Self::model_call_timeout_secs) bounds every model request and
/// defaults to fifteen minutes when absent;
/// [`model_stream_idle_secs`](Self::model_stream_idle_secs) bounds how long a streamed reply may
/// go without a delta and defaults to sixty; the [retry schedule](Self::max_model_retries) is
/// conducted on its defaults when neither of its keys is written. [`max_turns`](Self::max_turns),
/// [`max_runtime_secs`](Self::max_runtime_secs),
/// [`max_cost`](Self::max_cost), [`max_consecutive_errors`](Self::max_consecutive_errors) and
/// [`max_error_rate`](Self::max_error_rate) with its [window](Self::error_rate_window) are each
/// **unarmed when the configuration leaves them out**. gg arms no ceiling nobody wrote: an agent
/// stopped for looping on errors was stopped by a threshold an operator chose, which is what makes
/// the stop a finding rather than an artefact of the harness. The host (The Test Cabinet) enforces
/// a wall-clock cap on every run regardless.
///
/// **Present and unhonourable fails the launch.** A field set to a value that cannot bound
/// anything — a zero turn, runtime or model-call ceiling, a zero window, a negative rate, a rate
/// above `1.0`, a non-finite cost — is refused by name rather than disarmed with a warning: an operator who wrote
/// a ceiling believes the run is bounded, and a run that quietly became unbounded is the one case
/// where the misconfiguration costs money. A **partially** declared error rate (a rate without a
/// window, or a window without a rate) is refused on the same terms rather than arming nothing. The
/// run records the ceilings that were in force on [`GgSessionSummary::limits`], and records an
/// unarmed one as unbounded.
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
    /// issue implementer and reviewer alike.
    ///
    /// **Required.** Every configuration states it, because gg runs every agent out of this one
    /// pool and there is no figure that means "no cap": `0` describes a run with no agent able to
    /// run, which is not a run. An absent one and a `0` each refuse the launch.
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
    /// The ceiling, in seconds, on **one attempt at a model request**, from sending it to the last
    /// chunk of its reply.
    ///
    /// One of the four keys on this type an absence answers with a **figure** rather than with
    /// "off", beside the [stream-idle bound](Self::model_stream_idle_secs) and the
    /// [retry schedule](Self::max_model_retries): **absent is fifteen minutes**
    /// (900 seconds), because there is no run whose calls may hang forever, and `0` is refused on
    /// the same terms as every other unhonourable figure.
    ///
    /// A reply that goes without a delta is cut sooner by
    /// [`model_stream_idle_secs`](Self::model_stream_idle_secs), so this is the bound on a reply
    /// whose deltas keep arriving for longer than it, and on every attempt when the idle bound is
    /// set above it. The backoff between attempts sits outside it.
    ///
    /// Unlike the ceilings above it, breaching this one does not stop the run. The turn is
    /// recorded as a [`ModelTimeout`](GgTurnErrorType::ModelTimeout) error and the agent asks
    /// again, so an attempt that ran the whole ceiling costs one bounded error turn and the run
    /// ends only when an error ceiling says it should.
    #[serde(
        deserialize_with = "count::option_u64",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub model_call_timeout_secs: Option<u64>,
    /// The bound, in seconds, on **how long a streamed reply may go without a delta** — the idle
    /// clock that turns a provider which has stopped mid-reply into a transport failure the
    /// client retries on its own [schedule](Self::max_model_retries), rather than a stall the run
    /// waits the whole [call ceiling](Self::model_call_timeout_secs) out on.
    ///
    /// One of the four keys an absence answers with a **figure**: **absent is sixty seconds**, on
    /// the terms the call ceiling is, because a reply that stops arriving is never a setting an
    /// operator can ask for — a run that had no idle bound would be one a silent provider could
    /// hold for the whole of every call ceiling. `0` is refused on the same terms as every other
    /// unhonourable figure.
    ///
    /// The clock measures time since the last chunk carrying a `delta` with content, reasoning or
    /// tool-call arguments, or since the request was sent when none has arrived. A model that
    /// reasons for minutes produces reasoning deltas for the whole of that time when the provider
    /// streams them, so a provider's silence and a model's thinking are distinguishable within
    /// seconds. Keep-alive comments (OpenRouter sends `: OPENROUTER PROCESSING`) and blank lines
    /// carry no delta and leave the clock running. A request whose clock expires is cancelled and
    /// retried as a transport error is, and the retry's `log` line names the stall.
    #[serde(
        deserialize_with = "count::option_u64",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub model_stream_idle_secs: Option<u64>,
    /// How many times the model client **retries** a failed request after its first attempt: one
    /// answered `429` or `5xx`, or one that failed in transport.
    ///
    /// Absent is **ten**, on the terms the [model-call ceiling](Self::model_call_timeout_secs)
    /// takes a figure: every failed request is retried on some schedule. `0` is honoured as
    /// written, a run that gives up on the first failure. The retries are the client's own, and a
    /// stalled stream is one of the transient failures they cover — a cancelled stall costs the
    /// idle bound rather than the call ceiling, so retrying one inside the client is worth the
    /// wait.
    #[serde(
        deserialize_with = "count::option_u64",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_model_retries: Option<u64>,
    /// The ceiling, in seconds, on **one retry's backoff delay**: the first retry waits one
    /// second, each later one twice the last, capped here.
    ///
    /// Absent is **sixty seconds**, which against the default ten retries waits about five
    /// minutes in all. `0` is refused, since a schedule of no waits hammers a provider that has
    /// just said it is down. A `429` or `503` carrying a `Retry-After` in seconds waits that long
    /// instead when it is longer than the schedule's delay.
    #[serde(
        deserialize_with = "count::option_u64",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub model_retry_max_delay_secs: Option<u64>,
    /// How many **error turns in a row** end an agent. **Absent leaves it unarmed** — gg arms no
    /// error ceiling nobody wrote, so an agent stopped by this one was stopped by a threshold its
    /// operator chose. `0` is refused rather than read as "off": it would end an agent before its
    /// first turn, so it is not a ceiling gg can honour, and leaving the key out is how a
    /// configuration says there is none.
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
    /// The two halves stand or fall together. Writing both arms the ceiling and writing neither
    /// leaves it **unarmed**; writing one half is refused, because a rate with no window and a
    /// window with no rate each describe a ceiling gg has no threshold to judge against, and half a
    /// ceiling is a ceiling the operator believes they have.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_error_rate: Option<f64>,
    /// How many of an agent's most recent turns [`max_error_rate`](Self::max_error_rate) is
    /// measured over — and, deliberately, the minimum sample: the ceiling cannot fire until the
    /// agent has taken this many turns, so one number does both jobs. The earliest turn this
    /// ceiling can stop a run on is therefore turn `error_rate_window` — at `1` it says "stop on
    /// any error", which is a legitimate declaration rather than an accident. Absent together with
    /// [`max_error_rate`](Self::max_error_rate) leaves the ceiling **unarmed**; absent while the
    /// rate is written refuses the launch.
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
    /// [session capture journal](crate::gg_session_journal) gg writes as it runs.
    ///
    /// **Required.** gg writes the journal on every run whatever the set says, so there is no run
    /// this ceiling does not apply to and no spelling of "no ceiling" here, because there is no run
    /// that wants one. An absent one refuses the launch.
    ///
    /// The odd one out here, and deliberately so: every other ceiling **stops the run**, and
    /// this one stops only the *observation* of it. Crossing it stops capture and marks the
    /// record [truncated](crate::gg_session_record::GgSessionTruncationReason::ByteCeiling) — capture
    /// degrades, it never fails the run it observes, because a debugging artifact that can end
    /// a paid run is worse than no artifact. It lives on this type rather than on a capability's
    /// params because capture is on for every run whatever the set says, so a ceiling parked on a
    /// capability would be unreadable by exactly the runs that need it.
    ///
    /// `0` cannot bound anything — it would stop capture before its first line — and is
    /// **refused**, on the same terms as
    /// [`max_consecutive_errors`](Self::max_consecutive_errors)`: 0`.
    #[serde(
        deserialize_with = "count::option_u64",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub replay_max_bytes: Option<u64>,
}

impl GgRunLimits {
    /// The two **required** ceilings, at the figures the [authoring catalog](gg_authoring_catalog)
    /// writes, and no ceiling armed beyond them.
    ///
    /// What a new configuration is written with, and the smallest limits block a launch accepts. It
    /// arms neither error ceiling and no turn, runtime or cost budget: a study that wants one writes
    /// the figure it wants, which is the only way gg ever comes to have one.
    pub fn authored() -> Self {
        Self {
            max_parallel: Some(AUTHORED_MAX_PARALLEL),
            replay_max_bytes: Some(AUTHORED_REPLAY_MAX_BYTES),
            ..Self::default()
        }
    }

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
/// [`GgErrorSummary::loop_aborts`], with the size of the output they threw away beside them,
/// because they are money spent on nothing rather than a turn that failed.
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
    /// The gateway served the call from a provider other than the one the launch pinned. The
    /// request was well-formed and the provider answered it; the answer is unusable because the
    /// cost recorded from it on would be on a different price basis. gg ends the run as a harness
    /// failure rather than scoring it against the model.
    ModelProviderMismatch,
    /// The model call ran into the run's
    /// [**per-call ceiling**](GgRunLimits::model_call_timeout_secs) without producing a reply — a
    /// stalled provider, not a refusal. Unlike every other `model_` type this one does **not**
    /// end the session: the turn is recorded as this error and the loop asks again, so a stalled
    /// endpoint costs the run one bounded error turn per stall and the run ends only when the
    /// [error ceilings](GgRunLimits) say it should.
    ModelTimeout,
    /// The reply hit the **provider's output cap** (`finish_reason: length`) and was rejected
    /// whole: a length-capped reply is presumed a degenerate generation, so it never enters the
    /// context, its usage is kept out of the run's cost and turn metrics (tallied on
    /// [`GgSessionSummary::rejected_responses`] instead), and the turn is retried on the same
    /// terms as [`ModelTimeout`](Self::ModelTimeout) — recorded as this error, bounded by the
    /// error ceilings.
    ModelLengthCapped,
    /// The program is not valid source in its [language](GgProgramLanguage) — the parser's own
    /// diagnostics. Nothing ran.
    TranspileSyntax,
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
    ProgramApiError,
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
    ///
    /// On an arm whose program dies the way its runtime kills it rather than reporting a throw to
    /// the host, this is also where an ordinary uncaught program failure lands, so a slice over
    /// this type — or over the [`SandboxLimit`](GgTurnErrorKind::SandboxLimit) kind above it — is a
    /// comparison within one program language and not across them.
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
    /// A [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) turn made no `submit_program` call, so
    /// the reply carried no program to run — the code-mode counterpart of
    /// [`MissingCompletionNoCall`](Self::MissingCompletionNoCall), reached only when a provider
    /// answers a request that required the call with a reply that does not make it.
    MissingCompletionNoProgram,
}

impl GgTurnErrorType {
    /// Every type, grouped by its [base kind](Self::kind) in that kind's declaration order.
    ///
    /// The grouping is the reading order a console ranks and labels from, and it is what makes
    /// "every type has a base, and every base has at least one type" checkable rather than asserted.
    pub const ALL: [Self; 21] = [
        Self::ModelAuth,
        Self::ModelRejected,
        Self::ModelRetryExhausted,
        Self::ModelResponseLoop,
        Self::ModelVisionUnsupported,
        Self::ModelParse,
        Self::ModelProviderMismatch,
        Self::ModelTimeout,
        Self::ModelLengthCapped,
        Self::TranspileSyntax,
        Self::TranspileCompile,
        Self::TranspileUnsupported,
        Self::ProgramApiError,
        Self::ProgramUnknownName,
        Self::ProgramThrow,
        Self::SandboxTimeout,
        Self::SandboxOutOfMemory,
        Self::SandboxTrap,
        Self::MissingCompletionNoCall,
        Self::MissingCompletionCompaction,
        Self::MissingCompletionNoProgram,
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
            | Self::ModelParse
            | Self::ModelProviderMismatch
            | Self::ModelTimeout
            | Self::ModelLengthCapped => GgTurnErrorKind::ModelApi,
            Self::TranspileSyntax | Self::TranspileCompile | Self::TranspileUnsupported => {
                GgTurnErrorKind::Transpile
            }
            Self::ProgramApiError | Self::ProgramUnknownName | Self::ProgramThrow => {
                GgTurnErrorKind::ProgramFault
            }
            Self::SandboxTimeout | Self::SandboxOutOfMemory | Self::SandboxTrap => {
                GgTurnErrorKind::SandboxLimit
            }
            Self::MissingCompletionNoCall
            | Self::MissingCompletionCompaction
            | Self::MissingCompletionNoProgram => GgTurnErrorKind::MissingCompletion,
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
            Self::ModelProviderMismatch => "model_provider_mismatch",
            Self::ModelTimeout => "model_timeout",
            Self::ModelLengthCapped => "model_length_capped",
            Self::TranspileSyntax => "transpile_syntax",
            Self::TranspileCompile => "transpile_compile",
            Self::TranspileUnsupported => "transpile_unsupported",
            Self::ProgramApiError => "program_api_error",
            Self::ProgramUnknownName => "program_unknown_name",
            Self::ProgramThrow => "program_throw",
            Self::SandboxTimeout => "sandbox_timeout",
            Self::SandboxOutOfMemory => "sandbox_out_of_memory",
            Self::SandboxTrap => "sandbox_trap",
            Self::MissingCompletionNoCall => "missing_completion_no_call",
            Self::MissingCompletionCompaction => "missing_completion_compaction",
            Self::MissingCompletionNoProgram => "missing_completion_no_program",
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
            Self::ModelProviderMismatch => "served by another provider",
            Self::ModelTimeout => "model call timed out",
            Self::ModelLengthCapped => "length-capped reply rejected",
            Self::TranspileSyntax => "syntax error",
            Self::TranspileCompile => "compiler rejected the program",
            Self::TranspileUnsupported => "unsupported program feature",
            Self::ProgramApiError => "uncaught call failure",
            Self::ProgramUnknownName => "unknown name",
            Self::ProgramThrow => "uncaught throw",
            Self::SandboxTimeout => "execution timeout",
            Self::SandboxOutOfMemory => "out of memory",
            Self::SandboxTrap => "sandbox trap",
            Self::MissingCompletionNoCall => "no work declared",
            Self::MissingCompletionCompaction => "compaction ignored",
            Self::MissingCompletionNoProgram => "no program submitted",
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
/// `ToolFailure` serde, the membrane's WIT `error-code`, and the `code` field of the `ApiError` a
/// program catches. One deviation from this module's convention is a smaller cost than three
/// spellings of one fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgCallFailure {
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

impl GgCallFailure {
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
    /// The OpenRouter **provider** each model this run may bind is pinned to — the model's
    /// own developer, resolved from the catalog when the run was triggered and pushed in here on
    /// the same terms as [`model_windows`](Self::model_windows). Keyed by the model id the
    /// [binding](GgSlotBinding::model_id) names.
    ///
    /// Every request for a model carries this slug as `provider.only` with fallbacks refused, so
    /// a run stays on one provider and one price basis. A bound model with no entry refuses the
    /// launch, together with every other missing one: a model whose official endpoint is not
    /// listed is not testable, and running it on another provider would put the run's cost on a
    /// basis the record does not name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub model_providers: BTreeMap<String, String>,
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
    /// On the [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/messages/) surface this
    /// band carries only the terse tool results answering the turn's `submit_program` calls (and
    /// the refusal answering a call to a tool the mode does not offer): a **program's** calls have
    /// no tool results — a call's value returns into the program, and the only thing a program
    /// shows the model is a [view](Self::FileView) it opened. What gg has to say back about a
    /// program is a [compiler](Self::CompilerError) or [runtime](Self::RuntimeError) error, or a
    /// [notice](Self::System).
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
    /// Prior-turn thread material not attributable to a more specific source — the
    /// catch-all history bucket, and what compaction summarizes.
    History,
}

impl GgContextSource {
    /// Every source, in a stable order. A [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown)
    /// reports one entry per source in this order (zero when a source contributed
    /// nothing), so the console's stacked graph keeps stable bands across turns.
    pub const ALL: [GgContextSource; 14] = [
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
/// # Which limits apply
///
/// An enabled capability writes all six params whichever strategy it selects, so one sweep hands
/// every arm the same params block; `0` is how a limit is turned off, and a param a strategy does
/// not apply is `None` here whatever the params said. The resolved figures are therefore the
/// configuration's, never gg's:
///
/// | Limit | Param | Applies under |
/// | --- | --- | --- |
/// | [`max_count`](Self::max_count) | [`maxCount`](PARAM_MAX_COUNT) | [`scratchpad`](MEMORY_STRATEGY_SCRATCHPAD), [`keyword-search`](MEMORY_STRATEGY_KEYWORD_SEARCH) |
/// | [`max_len_per_memory`](Self::max_len_per_memory) | [`maxLenPerMemory`](PARAM_MAX_LEN_PER_MEMORY) | every strategy |
/// | [`max_total_len`](Self::max_total_len) | [`maxTotalLen`](PARAM_MAX_TOTAL_LEN) | [`scratchpad`](MEMORY_STRATEGY_SCRATCHPAD) |
/// | [`max_len_index`](Self::max_len_index) | [`maxLenIndex`](PARAM_MAX_LEN_INDEX) | [`markdown`](MEMORY_STRATEGY_MARKDOWN) |
/// | [`max_len_description`](Self::max_len_description) | [`maxLenDescription`](PARAM_MAX_LEN_DESCRIPTION) | every strategy |
/// | [`max_results`](Self::max_results) | [`maxResults`](PARAM_MAX_RESULTS) | [`keyword-search`](MEMORY_STRATEGY_KEYWORD_SEARCH) |
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
    /// tight index bounds it here rather than trusting the model to be terse. Applies under every
    /// strategy; `null` is unlimited, which a configuration asks for by writing `0`.
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
    /// [reviewers](GgBoardIssue::reviewer_ids) (if any) and merging its worktree back. **Not**
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
    /// The [slug](GgAgentConfig::slug) of the profile the issue was **assigned to** when it was
    /// created — the profile gg dispatches it under, and re-dispatches for every retry and review
    /// round. The creating agent names it by [label](GgAgentConfig::name) on `create_issue` (it is
    /// not configured on the capability) out of its roster entries carrying the
    /// [`implementer`](GgSubagentScope::Implementer) scope, and gg records which profile that was.
    pub agent_id: String,
    /// The [ids](GgAgentConfig::id) of the profiles named as this issue's **reviewers** when it
    /// was created, drawn from the creating agent's roster entries carrying the
    /// [`reviewer`](GgSubagentScope::Reviewer) scope. When non-empty, completing the issue moves it
    /// to [`InReview`](GgIssueStatus::InReview) and these profiles each review the work in turn;
    /// every one of them must approve before the issue is accepted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reviewer_ids: Vec<String>,
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
/// [skills](GgContextSource::Skill), how many [tasks](GgContextSource::TaskList), and how many
/// in-play [memories](GgContextSource::Memory) remained pinned after the ephemeral history was
/// replaced by the summary.
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
/// runs the issue's [reviewers](GgBoardIssue::reviewer_ids) against the diff rather than accepting
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
/// [reviewer profile](GgBoardIssue::reviewer_ids) the issue named, which is what says *what kind* of
/// review it was.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReviewer {
    /// The id of the agent that conducted this review — the handle its own
    /// [`AgentSpawned`](GgTelemetryKind::AgentSpawned)/[`AgentReturned`](GgTelemetryKind::AgentReturned)
    /// events carry.
    pub agent_id: String,
    /// The [slug](GgAgentConfig::slug) of the profile the reviewer ran under — one of the issue's
    /// [reviewers](GgBoardIssue::reviewer_ids).
    pub profile_id: String,
    /// The [display name](GgCapabilitySet::agent_name) that profile carried, so a review reads
    /// without resolving anything. Display text; nothing joins on it.
    pub profile: String,
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
/// not a spelling anybody would put in a configuration file.
///
/// No language is the default. An agent with [responses-as-code](CAPABILITY_RESPONSES_AS_CODE)
/// switched on names one of these, and a launch that omits it is refused. The enum carries no
/// `Default` for that reason: a fallback would record a run under a language nobody chose, on the
/// very axis a study slices its arms by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgProgramLanguage {
    /// TypeScript: **type-checked** with the committed `tsc`, then type-stripped to JavaScript and
    /// evaluated in the committed `componentize-js` guest.
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
    /// and nothing is installed in the run container. A program is executed in a namespace of its
    /// own with nothing in it: the SDK is the ordinary package `gg`, baked into the guest and
    /// reached by writing `import gg`, and the agent's code modules are the package `lib`. Its SDK
    /// is hand-written and reads as Python reads — `snake_case`, keyword arguments with real
    /// defaults, dataclasses for results, enums for fixed choices, and a raised `gg.core.ApiError`
    /// for the wire's error arm.
    Python,
    /// Ruby: **compiled to JavaScript on the host by Opal**, and evaluated by a guest that carries
    /// Opal's runtime pre-initialised into it.
    ///
    /// The first arm whose program is neither evaluated as written nor lowered by a parse gg carries
    /// in-process: a real compiler runs in a real process on the turn path, so this arm reports a
    /// compile time and can tell a model *the compiler read your program and refused it* — which is
    /// the band [`Python`](Self::Python) has no producer for. The compiler is itself Ruby compiled to
    /// JavaScript, so it rides inside gg's binary and the run image gains nothing. gg's SDK, the
    /// agent's code modules and the libraries a program may require are all compiled into the guest
    /// as requirable units and none is loaded: a program reaches gg's surface by writing
    /// `require "gg"` and its own loaded code by writing `require "lib"`. Its SDK is hand-written
    /// and reads as Ruby reads — `snake_case`, keyword arguments, blocks for a long body, `Range`
    /// for a span, splats for a list, `?` on a predicate, Symbols for a fixed choice, and a raised
    /// `ApiError` that is a `StandardError`.
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
    /// and an unchecked `ApiError`.
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
    /// omit, and an `ApiError` caught with `catch` or `runCatching`. And it is declared in the
    /// **root package**, so a program reaches the whole surface with no `import` at all.
    Kotlin,
    /// Rust: **compiled by `rustc` into the wasm component that turn is evaluated by** — the first
    /// arm whose artifact is the program.
    ///
    /// Every language before it evaluates a *string*: its committed component carries a whole
    /// runtime (a CPython, an Opal, a JavaScript engine) and a program crosses the membrane as
    /// source that runtime reads. `rustc` produces no such thing — it produces the program — so this
    /// arm commits **no component at all** and compiles one per turn instead, against a prebuilt
    /// library set that ships inside gg's binary.
    ///
    /// A program is the reply **verbatim**, as a whole Rust program declaring its own `fn main` —
    /// no wrapper, no prologue, no offset to subtract. The crate type is `bin`, which is what makes
    /// that `main` reachable: `rustc` emits the unmangled C entry symbol for a binary crate, and
    /// gg's SDK calls it from the world's `run` export. `--extern gg=…` makes the SDK available and
    /// puts no name in scope, so a program writes `gg::files::read_file` in full or the
    /// `use gg::files;` its catalogue states.
    ///
    /// A failure reaches the model by **capture**, with nothing intercepted. The target is
    /// `wasm32-wasip1`, so a panic writes `std`'s own message to a real standard error in the
    /// model's own file, line and column before it aborts; a `main` returning `Err` writes
    /// `Error: …` through `Termination`; and `std::process::exit` is `proc_exit`.
    ///
    /// A **code module** here is linked into the same artifact as the program that reads it, which
    /// is why the seam hands the modules in scope to a program's preparation at all: nothing can be
    /// bound at `lib::<key>` after the compile. Its SDK is hand-written and reads as Rust reads:
    /// `snake_case`, an API object as a **module** so a call is a path, `Result<_, ApiError>`
    /// everywhere so `?` composes gg's calls with `std`'s own fallible ones, a struct with `Default`
    /// and functional update where a call has two or more optional arguments and a bare `Option<T>`
    /// where it has one, real `enum`s for fixed choices, and a `RangeInclusive` for a span of
    /// turns.
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
    /// `gg::core::api_error` for the error arm.
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
    /// `ApiException` whose `Code` is an enum rather than free text. Nothing returns `Task` and
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
    /// Words of generated output across every reply [`loop_aborts`](Self::loop_aborts) counts, and
    /// the characters of the same output beside it — the **size** of what was thrown away, where
    /// the count beside them is only how often.
    ///
    /// The units are the ones gg measured itself, as the replies streamed. There is deliberately no
    /// token count and no price: gg's [cost](crate::metrics::Cost) and
    /// [tokens](crate::metrics::TokenCounts) come from the provider's usage payload, which arrives
    /// at the end of a stream an abandoned reply never reached, so any figure in those units would
    /// be an estimate published where every neighbouring figure is a measurement.
    ///
    /// This output is charged to the provider bill and is absent from the run's recorded cost, by
    /// design: a looping reply is a model defect, and a run must not be made to look expensive for
    /// one. The figures here are what makes that omission visible rather than silent.
    pub loop_abort_words: u64,
    /// Characters of generated output across every reply [`loop_aborts`](Self::loop_aborts) counts
    /// — the companion of [`loop_abort_words`](Self::loop_abort_words), and the finer of the two
    /// measures, since a reply's final partial word is never counted as a word.
    pub loop_abort_chars: u64,
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
    /// **Calls** that failed, by [failure class](GgCallFailure) — a different population from
    /// everything above, which counts *turns*.
    ///
    /// Folded from the [`ToolResult`](GgTelemetryKind::ToolResult) events the run emitted, so it
    /// counts every failed tool dispatch in either execution mode, whether or not the program that
    /// made it caught the failure and carried on. Keyed by [`GgCallFailure::wire_id`], and open for
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

/// **Calls a model wrote without having read what they do** — the measurement of whether a model
/// follows the one discipline [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) discovery is built
/// on.
///
/// gg's prompt names the modules an agent holds and no function inside any of them, so a model
/// cannot know a call's signature until it has searched the documentation and opened a
/// [documentation view](GgContextSource::DocsView) of the name. A view a program opens arrives in
/// the window on the turn *after* the program that opened it, which is why the prompt states the
/// discipline as *open a documentation view of each function you intend to call, and write the call
/// on a later turn*. This counts the calls that broke it: the operation was called while no
/// documentation view of it stood in the window from an earlier turn.
///
/// # It is a measurement and never a gate
///
/// Nothing is refused, nothing is retried and no [turn outcome](GgTurnOutcome) changes: the program
/// compiled, ran and did its work, so no [error ceiling](GgRunLimits) observes any of this and none
/// of it reaches the [error rollup](GgErrorSummary). What it is evidence about is the **model**. A
/// model that repeatedly calls functions it never looked up is writing signatures from memory, and
/// a run where that number is large is a run whose model should not be given this surface — which
/// is a conclusion nobody could reach from a record that only showed the calls that happened to
/// compile.
///
/// It is a **lower bound**, and deliberately so. A guessed signature that did not compile never
/// reaches a call site, so it is counted nowhere here; what is counted is the guess that happened to
/// be right about the shape while still being a guess.
///
/// # Why the operations are carried and not only the count
///
/// A bare count says a model guessed and not at what. Forty calls of `files.read_file` is a model
/// that never opened the one page it needed; forty different operations once each is a model
/// ignoring the mechanism outright. Those are different findings with different remedies, and only
/// the breakdown tells them apart.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgUndocumentedCalls {
    /// How many such calls were made. Exactly the sum of [`operations`](Self::operations)'s values.
    pub calls: u64,
    /// The same calls broken down by **which** operation was called, keyed by gg's own rendered
    /// [operation id](GgTelemetryKind::ApiCall) (`files.read_file`) rather than by any arm's
    /// spelling — so eleven language arms' findings are counted under one key.
    ///
    /// Open (a string key) for the reason [`GgErrorSummary::by_type`] is: an operation added to gg's
    /// vocabulary joins the breakdown without a schema change, and a reader that has never heard of
    /// one degrades to an unlabelled row rather than failing to read the record at all.
    ///
    /// Empty — and omitted from the wire — exactly when [`calls`](Self::calls) is `0`.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[cfg_attr(feature = "contract", ts(optional = nullable))]
    pub operations: BTreeMap<String, u64>,
}

impl GgUndocumentedCalls {
    /// Whether nothing was recorded — the condition the per-turn record is omitted from the wire
    /// on, and the state of every tool-calling run and of every well-behaved code run.
    pub fn is_empty(&self) -> bool {
        self.calls == 0
    }

    /// Record one call of `operation`, given by gg's rendered [operation id](GgTelemetryKind::ApiCall).
    ///
    /// The one way either field is written, so the count and the breakdown cannot disagree: the
    /// invariant this type promises — `calls == operations.values().sum()` — is a property of there
    /// being no other door rather than of every caller remembering to use both.
    pub fn record(&mut self, operation: &str) {
        self.calls = self.calls.saturating_add(1);
        let count = self.operations.entry(operation.to_string()).or_default();
        *count = count.saturating_add(1);
    }

    /// Fold `other` into this rollup — how a run-level total is accumulated from the per-turn
    /// records, and how a turn that ran several programs totals them.
    pub fn merge(&mut self, other: &Self) {
        self.calls = self.calls.saturating_add(other.calls);
        for (operation, added) in &other.operations {
            let count = self.operations.entry(operation.clone()).or_default();
            *count = count.saturating_add(*added);
        }
    }
}

/// The run's **rejected-reply** rollup: how many model replies gg refused to use (today, exactly
/// the length-capped ones — see [`GgTelemetryKind::ResponseRejected`]), and the spend they burned.
///
/// This bucket exists so the exclusion is visible rather than silent. A rejected reply's usage is
/// deliberately kept **out** of the run's cost and turn metrics — a degenerate generation must not
/// make a run look expensive or long — but the money was still spent, and "how often does this
/// model cap out, and what does it cost?" is a question the owner asks of the durable record.
/// Folded from the [`ResponseRejected`](GgTelemetryKind::ResponseRejected) events the run emitted.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgRejectedResponses {
    /// How many replies were rejected.
    pub count: u64,
    /// The tokens the provider billed for them, summed — spend absent from the run's own
    /// [token totals](crate::metrics::TokenCounts) by design.
    pub tokens: TokenCounts,
    /// Their cost, summed, when the provider reported any — spend absent from the run's recorded
    /// cost by design.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub cost: Option<Cost>,
}

impl GgRejectedResponses {
    /// Whether nothing was rejected — the state of the overwhelming majority of runs, and the
    /// condition the rollup is omitted from the wire on.
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }
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
    /// The [slug](GgAgentConfig::slug) of the agent profile this rollup accounts for. Resolve it
    /// against the run's set for the [display name](GgCapabilitySet::agent_name) to show.
    pub profile_id: String,
    /// The model id (within the profile) this rollup accounts for. A profile normally resolves to
    /// one model, but the accounting keys on the model too so a re-pointed binding stays
    /// attributable.
    pub model_id: String,
    /// The tokens accumulated on this slot/model across the run, in the shared [`TokenCounts`]
    /// units.
    pub tokens: TokenCounts,
    /// The cost accumulated on this slot/model, when any turn on it reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub cost: Option<Cost>,
}

/// One `(provider, model)` health slice in a [`GgSessionSummary`] — which upstream provider
/// served a run's model calls, and how the calls it served went. Folded from the run's own
/// stream: the [`Usage`](GgTelemetryKind::Usage) deltas contribute the calls with their tokens
/// and cost, the [`ResponseRejected`](GgTelemetryKind::ResponseRejected) events the length-capped
/// replies, and the [`TurnOutcome`](GgTelemetryKind::TurnOutcome) events the per-turn judgement,
/// each attributed to the provider its own call named.
///
/// Two invariants hold across a summary's slices: their [`turns`](Self::turns) sum to the
/// [error rollup](GgErrorSummary::turns)'s denominator, and within a slice `turns` minus
/// [`working`](Self::working) minus its error count is its fatal turns.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgProviderStat {
    /// OpenRouter's name for the upstream provider that served this slice's calls. `None` for the
    /// slice of calls that named none — a gateway that stamps no provider, or a turn whose call
    /// produced no reply to name one (a model timeout).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
    /// The model this slice's agent was running on, as the agent's own
    /// [`Usage`](GgTelemetryKind::Usage) deltas named it. `None` for a turn or rejection recorded
    /// before the agent's first usage delta named one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub model_id: Option<String>,
    /// Model calls folded from the [`Usage`](GgTelemetryKind::Usage) deltas — the calls that
    /// reported usage. A call that reported neither tokens nor cost emits no delta and reaches
    /// only the turn figures below.
    pub calls: u64,
    /// The tokens those calls reported, summed in the shared [`TokenCounts`] units.
    pub tokens: TokenCounts,
    /// Their cost, summed, when any of them reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub cost: Option<Cost>,
    /// Replies gg [rejected whole](GgRejectedResponses) — the length-capped ones — that this
    /// slice's provider served. `0`, and omitted, for the ordinary slice with none.
    #[serde(default, skip_serializing_if = "is_zero_u64")]
    #[cfg_attr(feature = "contract", ts(optional = nullable))]
    pub rejected: u64,
    /// Turns attributed to this slice: each [`TurnOutcome`](GgTelemetryKind::TurnOutcome) lands on
    /// the provider its own call named, or on the providerless slice when it named none.
    pub turns: u64,
    /// The turns among them that worked — a [progressed](GgTurnOutcome::Progressed) or
    /// [finished](GgTurnOutcome::Finished) outcome.
    pub working: u64,
    /// The errored turns among them, keyed by [`GgTurnErrorType::wire_id`] — the same open,
    /// string-keyed breakdown [`GgErrorSummary::by_type`] is, and omitted when empty on the same
    /// terms.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[cfg_attr(feature = "contract", ts(optional = nullable))]
    pub errors: BTreeMap<String, u64>,
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
    /// One of gg's ten terminal statuses, and here they all are: `"completed"`; the three ceiling
    /// endings `"exhausted"`, `"timed_out"` and `"limit_exceeded"`; an operator's `"canceled"`; and
    /// the five failures `"model_error"`, `"auth_error"`, `"hook_error"`, `"compaction_failed"`
    /// and `"internal_error"`.
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
    /// How many **programs** the run executed — one per
    /// [`CodeExecution`](GgTelemetryKind::CodeExecution) event. `0` when the
    /// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability was off (traditional tool
    /// calling), so a non-zero count is the proof the code path actually ran.
    ///
    /// A submitted program that did not compile at all emits its event like any other and is
    /// counted here, and a turn that submitted several programs contributes one count per program.
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
    /// How many of the run's turns failed, how badly they clustered, and how — the run's
    /// [error rollup](GgErrorSummary), folded from the
    /// [`TurnOutcome`](GgTelemetryKind::TurnOutcome) events every agent emitted.
    ///
    /// Meaningful in **both** execution modes: a tool-calling turn fails too, just in fewer
    /// ways.
    pub errors: GgErrorSummary,
    /// Every **dispatched tool call** the run made, in either execution mode — one per
    /// [`ToolResult`](GgTelemetryKind::ToolResult) event, failed or not. This is the population
    /// [`GgErrorSummary::tool_failures`] classifies the failed half of, recorded so the successful
    /// half is derivable: `tool_calls` minus the failures is the calls that succeeded, and on a
    /// record that carries the figure it is at least the sum of the failures.
    ///
    /// `0` — and omitted — for a run that dispatched none, so a reader must treat a summary with
    /// failures but no total as one whose total was not recorded.
    #[serde(default, skip_serializing_if = "is_zero_u64")]
    #[cfg_attr(feature = "contract", ts(optional = nullable))]
    pub tool_calls: u64,
    /// How many model replies gg **rejected whole** — the length-capped ones — and the spend they
    /// burned; see [`GgRejectedResponses`]. Their usage is excluded from the run's cost and turn
    /// metrics by design, so this rollup is where it lives instead. Omitted from the wire for the
    /// ordinary run that rejected nothing.
    #[serde(default, skip_serializing_if = "GgRejectedResponses::is_empty")]
    #[cfg_attr(feature = "contract", ts(optional = nullable))]
    pub rejected_responses: GgRejectedResponses,
    /// The longest reply the run produced, in characters: the model's raw text plus, on a
    /// responses-as-code turn, the `program` string of each `submit_program` call it made. Folded
    /// as a maximum over the [`TurnOutcome`](GgTelemetryKind::TurnOutcome) events'
    /// `response_chars`, over every turn but the one recorded
    /// [`ModelLengthCapped`](GgTurnErrorType::ModelLengthCapped), whatever the turn's outcome.
    ///
    /// Recorded so an output ceiling can later be chosen from data rather than guessed: a cap
    /// below this figure would have truncated a reply the model generated whole. The one excluded
    /// turn is the one whose reply the provider had already cut off at its own output cap, which
    /// is the reply such a ceiling exists to cut. An errored turn is folded in, since a program
    /// long enough to matter here is the one most likely to fail, and dropping it would
    /// under-report exactly the runs that write the most. `0` — and omitted — for a run whose
    /// turns reported no reply at all.
    #[serde(default, skip_serializing_if = "is_zero_u64")]
    #[cfg_attr(feature = "contract", ts(optional = nullable))]
    pub max_response_chars: u64,
    /// The same maximum in the provider's own unit: **completion tokens** (output plus reasoning,
    /// the figure an output cap is measured in). `0` — and omitted — for a run whose turns
    /// reported no usage.
    #[serde(default, skip_serializing_if = "is_zero_u64")]
    #[cfg_attr(feature = "contract", ts(optional = nullable))]
    pub max_response_output_tokens: u64,
    /// How many calls the run's models wrote **without ever having read the call's documentation**
    /// — the run's [discovery rollup](GgUndocumentedCalls), folded from the same
    /// [`CodeExecution`](GgTelemetryKind::CodeExecution) events
    /// [`code_executions`](Self::code_executions) counts.
    ///
    /// All zeroes for a tool-calling run, which has no documentation surface to open a view of and
    /// no discipline to break, and all zeroes for the well-behaved code run — which is the point:
    /// this is the field that separates a model that discovers its surface from one that writes
    /// signatures from memory, and a study comparing two models on
    /// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) reads it before it reads anything else.
    ///
    /// Read against [`code_executions`](Self::code_executions) for a per-turn rate and against the
    /// run's API calls for a per-call one; neither ratio is stored, for the reason
    /// [`GgErrorSummary`] stores no percentage.
    pub undocumented_calls: GgUndocumentedCalls,
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
    /// The per-`(provider, model)` health rollup for the run — which upstream providers served its
    /// model calls and how the calls each one served went; see [`GgProviderStat`]. One slice per
    /// pair observed, in key order with the providerless slice first. Empty — and omitted — when
    /// no call, turn or rejection was ever folded in, which includes every record from a client
    /// that reports no usage at all.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "contract", ts(optional = nullable))]
    pub provider_stats: Vec<GgProviderStat>,
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
        /// The OpenRouter provider each bound model is pinned to, beside the routing
        /// key. A run's cost is recorded against this pin; a response from any other
        /// provider ends the run.
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        model_providers: BTreeMap<String, String>,
        /// The **routing key** gg minted at launch: a cuid2 sent on every request of the run
        /// as both `session_id` and `prompt_cache_key`, so a provider dashboard row can be
        /// matched to the run it belongs to. Minted rather than derived from the session id,
        /// which is caller-supplied text of any length, so it is always inside every
        /// provider's cap on either field.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        routing_key: Option<String>,
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
        /// Why it failed, when it failed — the [class](GgCallFailure) the tool itself raised, never
        /// one inferred afterwards from the summary's prose.
        ///
        /// Present on exactly the results whose [`ok`](Self::ToolResult::ok) is `false`, with
        /// [`Other`](GgCallFailure::Other) for a failure raised outside a tool implementation, and
        /// absent on every success — so `failure != null` and `ok == false` are the same statement,
        /// and a reader never meets a failure with no class.
        ///
        /// `ok` stays the authoritative "did it fail?". This says how.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        failure: Option<GgCallFailure>,
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
        /// `readFile` and `ReadFile` are all real spellings of things
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
        /// The [class](GgCallFailure) of the `ApiError` thrown into the program, on a call that
        /// threw. Present on exactly the results whose [`ok`](Self::ApiResult::ok) is `false`.
        ///
        /// This is the **model's** view of why its call failed — the same `code` the program itself
        /// branches on in a `catch` — and it is the only record of it, because a responses-as-code
        /// agent's calls are recorded on this stream alone. That includes the call the membrane
        /// refused before dispatch (a spent wall-clock budget, a name this agent was not granted),
        /// which never reached an implementation at all.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        failure: Option<GgCallFailure>,
    },
    /// One **shell command** gg ran on an agent's behalf, emitted on the stream of the agent it
    /// ran for, from whichever of gg's three command paths issued it — the
    /// [`shell`](CAPABILITY_SHELL) tool, a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE)
    /// program's `system.shell(…)`, or a hook's commands. The
    /// [origin](Self::Shell::origin) says which, so a command gg ran without the model asking
    /// stays distinguishable from one the model issued.
    ///
    /// The streams are the process's own, captured before the shell capability's output policy
    /// merged and truncated them for the model, and capped to their trailing
    /// [`GG_SHELL_EVENT_STREAM_CHARS`] characters. The
    /// [session record](crate::gg_session_record::GgSessionEntryKind)'s shell entries hold the
    /// full streams; this event is the live, capped view of the same fact, and it is what the
    /// console's per-agent Shell file lists.
    Shell {
        /// Which command path issued it.
        origin: GgShellOrigin,
        /// The command line, run as `sh -c <command>`.
        command: String,
        /// Where it ran, expressed relative to the **agent's own** workspace root — its isolated
        /// worktree when it has one — on the terms [`GgShellCwd`] records.
        cwd: GgShellCwd,
        /// The exit status. A timeout kill, a signal-terminated process and a process that never
        /// launched all pin as `-1`, matching the session record's convention: every consumer
        /// branches on "zero or not", and what a reader needs from those cases is that the
        /// command did not succeed and printed whatever it printed.
        exit_code: i32,
        /// The trailing [`GG_SHELL_EVENT_STREAM_CHARS`] characters of standard output.
        stdout: String,
        /// The trailing [`GG_SHELL_EVENT_STREAM_CHARS`] characters of standard error.
        stderr: String,
        /// How many leading characters the cap removed from stdout. `0` for the ordinary
        /// command, whose output fits whole.
        #[serde(default, skip_serializing_if = "is_zero_u64")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        stdout_dropped: u64,
        /// How many leading characters the cap removed from stderr, on the terms
        /// [`stdout_dropped`](Self::Shell::stdout_dropped) is counted on.
        #[serde(default, skip_serializing_if = "is_zero_u64")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        stderr_dropped: u64,
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
    /// `(profile_id, model_id)` key reproduces that key's rollup exactly.
    Usage {
        /// The [slug](GgAgentConfig::slug) of the agent profile that spent this — the same id
        /// [`AgentSpawned::profile_id`](Self::AgentSpawned::profile_id) and
        /// [`SlotUsage::profile_id`](Self::SlotUsage::profile_id) key on.
        profile_id: String,
        /// The concrete model id that spent this — the model the
        /// [profile](Self::Usage::profile_id) resolved to for the agent that took the turn.
        model_id: String,
        /// The normalized token counts for this accounting.
        tokens: TokenCounts,
        /// The cost of this accounting, when it could be determined.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cost: Option<Cost>,
        /// The upstream **provider** that served the call, when the gateway reported one
        /// (OpenRouter's `provider` response field). A model id is served by several providers
        /// behind one name, and provider-shaped failures are only attributable — and a provider
        /// only blacklistable — if every call's spend names who served it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
    },
    /// A model reply gg **rejected whole** instead of using: today, exactly the replies that hit
    /// the provider's output cap (`finish_reason: length`), which are presumed degenerate.
    ///
    /// A rejected reply never enters the context, and its usage is deliberately **excluded** from
    /// the run's cost and turn metrics — no [`Usage`](Self::Usage) delta is emitted for it — so
    /// this event is the only place the spend appears, and
    /// [`GgSessionSummary::rejected_responses`] is its durable sum. The turn that produced it is
    /// recorded as a [`model_length_capped`](GgTurnErrorType::ModelLengthCapped) error and
    /// retried, bounded by the error ceilings.
    ResponseRejected {
        /// Why the reply was rejected — the provider's own finish reason, today always
        /// `"length"`. A string so a future rejection class joins without a schema change.
        reason: String,
        /// The rejected reply's length in characters, measured by gg — the figure a later
        /// output ceiling would be judged against.
        chars: u64,
        /// The usage the provider billed for the rejected call — spend the run's own metrics do
        /// not include, kept here so nothing is silently lost.
        tokens: TokenCounts,
        /// The rejected call's cost, when the provider reported one. Excluded from the run's
        /// recorded cost on the same terms as the tokens.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cost: Option<Cost>,
        /// The upstream provider that served the rejected call, when the gateway named one — the
        /// attribution that makes a provider-shaped failure blacklistable.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
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
        /// The upstream **provider** that served the call, when the gateway reported one
        /// (OpenRouter's `provider` response field) — the request/response record's copy of the
        /// attribution the [`Usage`](Self::Usage) delta carries, so a provider-shaped reply is
        /// attributable from the message log alone.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
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
    /// so the console can render the live board. A run with the capability off emits none.
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
        /// The [slug](GgAgentConfig::slug) of the agent profile this agent runs under. gg usage is
        /// accounted per profile (see [`SlotUsage`](Self::SlotUsage)), and every consumer that
        /// shows a name resolves it against the run's set
        /// ([`agent_name`](GgCapabilitySet::agent_name)) rather than reading one off the
        /// stream — two profiles may carry the same name, so an id is the only thing that
        /// groups a run's agents correctly.
        profile_id: String,
        /// The concrete model id this agent's [profile](Self::AgentSpawned::profile_id) is bound
        /// to — the seam that makes a run span several models, one per profile.
        model_id: String,
        /// The agent's depth in the [subagent tree](https://docs.testcabinet.ai/gg/subagents/):
        /// `0` for the root, `parent.depth + 1` for a spawned child. A spawn that would exceed
        /// the configured maximum depth fails as a
        /// [limit](GgCallFailure::LimitExceeded) rather than being queued — a *ceiling*, not a
        /// [refusal](GgCallFailure::Refused): the request was well-formed, the run simply has no
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
    /// backing store it is a holder of, and whose it is.
    ///
    /// Emitted **once per incarnation, for every instance** — the root, every subagent, every
    /// successor — immediately after that instance's [`AgentSpawned`](Self::AgentSpawned) (and its
    /// [`FsmState`](Self::FsmState), when it stands in a machine). It is the only event that
    /// reports a module an agent holds but has not yet *touched* — a read-only inherited memory
    /// holder that never writes emits no [`MemoryState`](Self::MemoryState) of its own.
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
        /// Which SDK types an `openDocsView` of a function opens **beside** it for this instance:
        /// the enabled `docViewTypes` flags joined with `+` in gg's own fixed order — `return`
        /// (what the signature hands back), `parameters` (what its arguments declare), `errors`
        /// (the failures its documentation comment declares) — so the value is one of `none`,
        /// `return`, `parameters`, `errors`, `return+parameters`, `return+errors`,
        /// `parameters+errors` or `return+parameters+errors`. `None` for a tool-calling instance,
        /// which opens no documentation views.
        ///
        /// **A joined string rather than three fields**, because what a reader of the stream needs
        /// is the *arm*: a configuration is one thing an agent ran under, and joining it here means
        /// a group-by on this field is a group-by on the arm rather than on a tuple every consumer
        /// has to reassemble. `none` rather than the empty string for the same reason, since an
        /// empty string is what a reader could not tell from a record carrying nothing.
        ///
        /// The value is the set gg **resolved**, which since an unreadable one is refused at
        /// launch is always the set the profile wrote. It is reported as the resolved value rather
        /// than the raw object so a profile that named none reports the defaults it actually ran on
        /// instead of an absence.
        ///
        /// It is reported for one reason, and the reason decides the field rather than decorating
        /// it. The flags are meant to be compared against each other — opening the return
        /// type is not obviously cheaper than opening nothing, since a returned record's own fields
        /// may send the agent back for two more lookups — and the comparison is only worth anything
        /// if a reader of the events can tell which arm an agent was on. Joined by
        /// [`agent_id`](GgTelemetryEvent::agent_id) to that agent's per-band
        /// [context breakdown](Self::ContextBreakdown) — the
        /// [documentation band](GgContextSource::DocsView) and the
        /// [search band](GgContextSource::SearchResults) beside it — and to its
        /// `views.open_docs_view` [calls](Self::ApiCall), it is what makes *"which types was this
        /// agent shown, and what did it cost"* answerable from the stream alone.
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
    /// usage and cost are accumulated **per profile** (and per model within a profile). This event is
    /// a rollup the console renders as a per-profile cost breakdown; it is **not** a per-turn delta
    /// (the incremental [`Usage`](Self::Usage) events are what consumers sum for the run total),
    /// so an ingester must not add `SlotUsage` into the run total or it would double-count. One
    /// `SlotUsage` is emitted per `(profile, model)` the run touched.
    SlotUsage {
        /// The [slug](GgAgentConfig::slug) of the agent profile this rollup accounts for.
        profile_id: String,
        /// The model id (within the profile) this rollup accounts for. A profile normally resolves
        /// to one model, but the accounting keys on the model too so a re-pointed binding stays
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
        /// The machine: the [slug](GgAgentConfig::slug) of the **FSM shell** profile whose `states`
        /// table is being driven. An agent may only ever be inside one, so this identifies the
        /// document the state came from.
        fsm_id: String,
        /// The [state](GgFsmState::name) just entered.
        state: String,
        /// The [profile](GgFsmState::agent_id) that state runs — which is also this agent
        /// instance's [`profile_id`](Self::AgentSpawned::profile_id), so a machine's cost splits
        /// per state agent in the [per-profile rollup](Self::SlotUsage).
        profile_id: String,
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
        /// The [slug](GgAgentConfig::slug) of the agent profile the successor runs under.
        profile_id: String,
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
    /// Emitted (when the issue named [reviewers](GgBoardIssue::reviewer_ids)) as gg reconciles the
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
    /// once per **submitted program**, on the agent that emitted the reply, so it rides on that
    /// agent's own [`agent_id`](GgTelemetryEvent::agent_id) — a turn that submitted several
    /// programs emits one event per program, in submission order. That includes a submitted string
    /// that was **not a program at all** — prose, or empty — which is prepared for the guest like
    /// anything else and is reported the same way a program that did not compile is: `ok: false`
    /// and an [`error`](Self::CodeExecution::error) carrying the compiler's diagnostic.
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
        /// How many of those calls the model wrote **without ever having read the call's
        /// documentation** — see [`GgUndocumentedCalls`], which is where the whole of what this
        /// measures and what it deliberately does not is written down.
        ///
        /// A subset of [`api_calls`](Self::CodeExecution::api_calls) beside it, counted at the same
        /// bracket, and never an error: the turn's [outcome](Self::TurnOutcome) is unchanged by it
        /// and no ceiling observes it. Only the model's own programs contribute — gg's
        /// [bootstrap](https://docs.testcabinet.ai/gg/responses-as-code/discovery/) and the on-use
        /// script of a skill the turn read are gg's own code, and charging their calls to the model
        /// would make every turn that used a skill report a violation the model did not commit.
        ///
        /// Defaulted and omitted from the wire when nothing was recorded, so the presence of this
        /// object *is* "this turn called something it had not looked up".
        // Omitted when empty and not an `Option`, so it declares its own
        // optionality: the enum's `optional_fields` only reaches `Option<T>`, and a consumer
        // promised an object the wire does not always carry would read `undefined.calls`.
        #[serde(default, skip_serializing_if = "GgUndocumentedCalls::is_empty")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        undocumented_calls: GgUndocumentedCalls,
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
        // Omitted from the wire when the program printed nothing, which is most turns — so it
        // has to declare its own optionality: the enum's `optional_fields` only reaches
        // `Option<T>`, and a consumer promised an array the record does not carry would read
        // `undefined.length`.
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
        /// Words of generated output those discarded replies had produced by the moment each was
        /// abandoned, summed. Present on exactly the turns
        /// [`loop_aborts`](Self::TurnOutcome::loop_aborts) is present on.
        ///
        /// The count says how often the model looped; this says how much generation it cost to find
        /// out. It is measured by gg as the replies streamed rather than reported by the provider,
        /// which is why it is words and characters and never tokens or dollars: an abandoned stream
        /// carries no usage payload. It is for the same reason excluded from the turn's
        /// [usage](Self::Usage) and cost, which report the one reply that was read.
        #[serde(default, skip_serializing_if = "is_zero_u64")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        loop_abort_words: u64,
        /// Characters of that same discarded output, counted as characters rather than bytes — the
        /// companion of [`loop_abort_words`](Self::TurnOutcome::loop_abort_words), and the finer of
        /// the two, since a reply's final partial word is never counted as a word.
        #[serde(default, skip_serializing_if = "is_zero_u64")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        loop_abort_chars: u64,
        /// The reply's length in characters — the model's raw text plus, on a
        /// responses-as-code turn, the `program` string of each `submit_program` call it made.
        /// Carried on every outcome so [`GgSessionSummary::max_response_chars`] can be folded as a
        /// maximum over every turn but the length-capped one: the figure a later output ceiling
        /// would have to accommodate. `0` — and omitted — for a turn whose reply carried no text
        /// at all.
        #[serde(default, skip_serializing_if = "is_zero_u64")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        response_chars: u64,
        /// The reply's **completion tokens** as the provider billed them (output plus reasoning —
        /// the figure a provider's output cap is measured in), the companion of
        /// [`response_chars`](Self::TurnOutcome::response_chars) and the second unit
        /// [`GgSessionSummary::max_response_output_tokens`] is folded in. `0` — and omitted —
        /// when the provider reported no usage.
        #[serde(default, skip_serializing_if = "is_zero_u64")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        response_output_tokens: u64,
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
        /// How the session ended, as one of gg's eleven status words — and here they all are:
        /// `"completed"`; the three ceiling endings `"exhausted"`, `"timed_out"` and
        /// `"limit_exceeded"`; an operator's `"canceled"`; the five failures `"model_error"`,
        /// `"auth_error"`, `"hook_error"`, `"compaction_failed"` and `"internal_error"`; and
        /// `"error"` for a session that never launched, which is the one value
        /// [`GgSessionSummary::terminal_status`] cannot carry, because a launch failure has nothing
        /// to summarize.
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
