//! The gg **memories** capability: a bounded, model-curated store of durable notes that
//! outlives the thread the model wrote them in.
//!
//! A [memory](https://docs.testcabinet.ai/gg/memories/) is *essentially a
//! [skill](crate::skills) the model writes itself*: the same "description up front, body that
//! survives a compaction boundary" shape, but curated at run time rather than authored ahead.
//! What differs between runs is **how** that store is organized and how much of it the context
//! window carries, which is the [strategy](MemoryStrategy) the capability's
//! [`implementation`](test_cabinet_core::gg::GgCapabilityConfig::implementation) selects:
//!
//! - [`Scratchpad`](MemoryStrategy::Scratchpad) — a small set whose **bodies are all pinned** in
//!   the window and carried across a [compaction](crate::compaction) boundary verbatim.
//! - [`Markdown`](MemoryStrategy::Markdown) — a pinned **index** of slugs and descriptions over
//!   markdown files the model reads on demand.
//! - [`KeywordSearch`](MemoryStrategy::KeywordSearch) — **nothing pinned**; the model finds a
//!   memory by [searching](search) for keywords.
//!
//! # The store is gg's, not the workspace's
//!
//! Under every strategy the memories live **in this process and nowhere else**. The two file-shaped
//! strategies talk about an "index file" and "memory files" because that is the mental model a
//! model already has, but gg never writes them to disk: the only way to create, revise or remove
//! one is a memory tool. That is what makes the index trustworthy — a model cannot edit its own
//! index behind gg's back by writing over a file, and gg's accounting of what the window holds can
//! never disagree with what is stored.
//!
//! # Why bounded
//!
//! Because the model controls memories, they must be **bounded** — otherwise self-curated notes
//! could crowd out the working context. Which [limits](MemoryCaps) apply depends on the strategy,
//! and every one of them is written into the capability's params, individually and on every arm,
//! with `0` the spelling of "no bound at all". When a mutation would exceed a limit, the store
//! **rejects it with a [`MemoryError`]** whose message tells the model how to proceed — revise,
//! evict, or delete — rather than silently truncating or dropping content.
//!
//! # Shapes
//!
//! - [`Memory`] — one curated note (slug, description, body).
//! - [`MemoryStrategy`] — which of the three shapes a run uses.
//! - [`MemoryCaps`] — the limits, [resolved](MemoryCaps::resolve) per strategy from the six params
//!   an enabled capability writes.
//! - [`MemoryStore`] — the mutable, limit-enforcing set of memories, shared (`Arc<Mutex>`) between
//!   the loop and the memory tools. It also keeps what the live set cannot show: the
//!   [revision log](MemoryStore::log_from) of every mutation (so a memory written and later
//!   deleted is still in the record) and the [peaks](MemoryPeak) the run reached.
//! - [`MemoryRevision`] — one entry of that log.
//! - [`MemoriesRuntime`] — the loop's live view: whether the capability is on, the shared store,
//!   and the derivations the loop needs (the strategy and limits the system prompt states, the
//!   [`MemoryState`](test_cabinet_core::gg::GgTelemetryKind::MemoryState) telemetry, and the pinned
//!   context block, if the strategy has one).
//!
//! The capability is **switchable**: when it is off the loop builds a
//! [`disabled`](MemoriesRuntime::disabled) runtime, so there are no memory tools, no prompt text,
//! no context block, and no telemetry — the feature vanishes.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use test_cabinet_core::gg::{
    CAPABILITY_MEMORIES, GgAgentConfig, GgCapabilityConfig, GgContextSource, GgMemoryCaps,
    GgMemoryChange, GgMemoryEntry, GgMemoryPeak, GgModuleOrigin, GgProgramLanguage,
    GgTelemetryKind, MEMORY_STRATEGY_KEYWORD_SEARCH, MEMORY_STRATEGY_MARKDOWN,
    MEMORY_STRATEGY_SCRATCHPAD,
};

use crate::model::Message;
use crate::modules::{
    AdoptError, Module, ModuleHandle, ModuleIds, ModuleKind, ModuleResolveCtx, Ownership, Refresh,
    detached_ids,
};
use crate::prompts::{
    self, MemoriesBlockContext, MemoryIndexContext, MemoryItemView, MemoryNoticeContext,
};
use crate::sandbox::{
    MEMORIES_CREATE_MEMORY, MEMORIES_DELETE_MEMORY, MEMORIES_EDIT_MEMORY, MEMORIES_READ_MEMORY,
    MEMORIES_UPDATE_MEMORY, MEMORIES_WRITE_MEMORY, OperationId, ProgramLanguage, spell,
};
use crate::tools::{
    CREATE_MEMORY_TOOL, DELETE_MEMORY_TOOL, EDIT_MEMORY_TOOL, READ_MEMORY_TOOL, UPDATE_MEMORY_TOOL,
    WRITE_MEMORY_TOOL,
};
use crate::validate::{LaunchDefect, LaunchReport};

/// Which memory instance a holder binds to, re-exported from the contract so gg and the
/// configurations it reads name the same four things. See
/// [`GgMemoryScope`](test_cabinet_core::gg::GgMemoryScope) for what each one binds.
pub use test_cabinet_core::gg::GgMemoryScope as MemoryScope;

#[path = "memories.search.rs"]
mod search;

#[path = "memories.scope.rs"]
mod scope;

pub use scope::{
    MemoryRegistry, check_scoping, inherited_strategy_conflict, resolve_scope,
    run_inherits_memories,
};
pub use search::MemoryHit;

use scope::{links, notice_entries};

/// The most characters of [code](Memory::code) or of an [on-use script](Memory::on_use) one memory
/// may carry.
///
/// Deliberately generous against every body limit, and deliberately separate from them: neither is
/// context. A module is prepared once and supplied to later programs as a library; an on-use script
/// runs on every use and is never shown to the model at all. Neither ever occupies a token of the window, so bounding them
/// against a *window* budget would be bounding the wrong thing. What this bounds is the transpiler,
/// which parses untrusted source on a recursive-descent stack.
pub const MAX_MEMORY_CODE_CHARS: usize = 32_768;

/// The memory **operations** that mutate the store — the ones whose success owes a revision record
/// and a fresh state event, and the ones a [read-only](MemoryScope::ReadOnly) holder may not make.
///
/// `memories.read_memory` and `memories.search_memories` are deliberately absent: they change
/// nothing, so there is no revision to record, the state event after one would be identical to the
/// last, and a read-only holder is entitled to make them.
///
/// It is the responses-as-code surface's list, and the tool-calling surface's is
/// [`is_memory_tool`](crate::tools::is_memory_tool). The two answer the same question about the same
/// store, and each is written in the vocabulary of the surface that asks it — an agent has exactly
/// one of the two, so neither is derived from the other and neither is the other's fallback.
pub const MEMORY_MUTATIONS: &[OperationId] = &[
    MEMORIES_WRITE_MEMORY,
    MEMORIES_UPDATE_MEMORY,
    MEMORIES_CREATE_MEMORY,
    MEMORIES_EDIT_MEMORY,
    MEMORIES_DELETE_MEMORY,
];

/// The six params one memories capability [bounds its store](MemoryCaps) with, re-exported from
/// the contract so the document, the console's editor and the resolver that reads each one all
/// spell it the same way. An enabled capability writes all six; see [`MemoryCaps::resolve`].
pub(crate) use test_cabinet_core::gg::{
    PARAM_MAX_COUNT, PARAM_MAX_LEN_DESCRIPTION, PARAM_MAX_LEN_INDEX, PARAM_MAX_LEN_PER_MEMORY,
    PARAM_MAX_RESULTS, PARAM_MAX_TOTAL_LEN,
};

/// The [strategy](MemoryStrategy) [`MemoryStrategy::resolve`] answers with when the
/// `implementation` it read **organizes nothing**: it names an organization gg does not offer, or
/// there is none there to read at all.
///
/// The resolver is [total](crate::validate#the-resolver-contract), so it has to hand back a
/// strategy; this is the one it hands back once the launch is refused, and it organizes a store no
/// turn will ever be taken against. It is not a fallback: a run whose record said `keyword-search`
/// and whose agent quietly wrote a scratchpad would be a memories study measuring the arm it did
/// not configure, which is the whole reason the launch is refused. An enabled capability short of
/// an arm is refused by [`check_implementation`](crate::validate) rather than here, and a disabled
/// one organizes no store for an arm to be owed for.
const STRATEGY_OF_A_REFUSED_LAUNCH: MemoryStrategy = MemoryStrategy::Scratchpad;

/// The bound one [limit](MemoryCaps) stands at once the param that sets it has already refused the
/// launch: **none**.
///
/// Not the "unlimited" a run asks for by writing `0` — that is a configuration gg honours.
/// [`MemoryCaps::resolve`] is [total](crate::validate#the-resolver-contract) and must answer with
/// something for a key nobody wrote or gg could not read, and this is the answer that bounds a
/// store no turn will ever be taken against.
const LIMIT_OF_A_REFUSED_LAUNCH: Option<usize> = None;

/// The characters a memory's [slug](Memory::name) may be made of, beyond ASCII alphanumerics:
/// the three separators a file name conventionally uses. Everything else — whitespace, path
/// separators, quotes — is refused, so a slug always reads as one word in an index line and can
/// never be mistaken for a path.
const SLUG_EXTRA_CHARS: [char; 3] = ['-', '_', '.'];

/// The longest a slug may be, in characters. Long enough to be descriptive, short enough that an
/// index line is mostly description.
const MAX_SLUG_LEN: usize = 64;

/// How a run's [memories](self) are organized — the capability's
/// [`implementation`](test_cabinet_core::gg::GgCapabilityConfig::implementation), and the single
/// switch behind which tools are offered, which limits apply, and what the window carries.
///
/// An enabled memories capability **names one**, whatever its [scope](MemoryScope), and a run naming
/// a strategy gg does not offer is [refused at launch](crate::validate): the strategy decides which
/// calls exist and what the window carries, so standing a strategy in for one gg could not read
/// would run one arm of a memories study under another's name. An
/// [inheriting](MemoryScope::Inherited) profile usually works in the organization its spawner
/// keeps, but every place gg starts one with no spawner to hand it a store it organizes one of its
/// own — so it names the organization it works in, and [`check_scoping`] refuses a pairing whose
/// two profiles name different ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryStrategy {
    /// Every memory's body is pinned in the window and crosses a compaction boundary verbatim.
    /// Offers `write_memory`, `update_memory` and `delete_memory`.
    Scratchpad,
    /// A pinned index of `slug` — `description` lines over bodies the model reads on demand.
    /// Offers `create_memory`, `read_memory`, `edit_memory` and `delete_memory`.
    Markdown,
    /// No index and nothing pinned: memories are found by keyword search. Offers `create_memory`,
    /// `read_memory`, `edit_memory`, `delete_memory` and `search_memories`.
    KeywordSearch,
}

impl MemoryStrategy {
    /// Every strategy gg offers — the vocabulary an
    /// [`implementation`](test_cabinet_core::gg::GgCapabilityConfig::implementation) is read
    /// against, and what a refusal offers the operator back.
    pub const ALL: [Self; 3] = [Self::Scratchpad, Self::Markdown, Self::KeywordSearch];

    /// The strategy an [implementation](test_cabinet_core::gg::GgCapabilityConfig::implementation)
    /// names — `scratchpad`, `markdown` or `keyword-search`.
    ///
    /// A name gg does not offer is reported into `report` and refuses the launch, and the
    /// [placeholder](STRATEGY_OF_A_REFUSED_LAUNCH) that comes back organizes a store no turn is
    /// taken against. Each strategy offers a different set of calls and pins a different thing in
    /// the window, so a run that quietly took the scratchpad while its record said `keyword-search`
    /// would be a memories study measuring the arm it did not configure.
    ///
    /// **An absent or blank `implementation` is the one absence this resolver does not report.**
    /// Requirement is a property of the switch and this is handed an `Option<&str>` with no switch
    /// in it, so [`check_implementation`](crate::validate) — which reads the whole capability —
    /// owns that line: an enabled capability short of an arm is refused there, and a disabled one
    /// organizes no store to be owed an arm for. What comes back here is
    /// [`STRATEGY_OF_A_REFUSED_LAUNCH`], silently.
    pub fn resolve(implementation: Option<&str>, report: &mut LaunchReport) -> Self {
        match implementation.map(str::trim) {
            None | Some("") => STRATEGY_OF_A_REFUSED_LAUNCH,
            Some(MEMORY_STRATEGY_SCRATCHPAD) => Self::Scratchpad,
            Some(MEMORY_STRATEGY_MARKDOWN) => Self::Markdown,
            Some(MEMORY_STRATEGY_KEYWORD_SEARCH) => Self::KeywordSearch,
            Some(other) => {
                report.report(
                    LaunchDefect::run_level(
                        crate::validate::implementation_locus(CAPABILITY_MEMORIES),
                        other,
                        format!(
                            "`{other}` is not a way gg can organize memories; the strategy decides \
                             which calls the agent is offered and what its window carries, so gg \
                             will not pick one for it."
                        ),
                    )
                    .known(Self::ALL.map(Self::id)),
                );
                STRATEGY_OF_A_REFUSED_LAUNCH
            }
        }
    }

    /// The strategy's stable id — what the run was configured with, and what the
    /// [`MemoryState`](GgTelemetryKind::MemoryState) telemetry reports.
    pub fn id(self) -> &'static str {
        match self {
            Self::Scratchpad => MEMORY_STRATEGY_SCRATCHPAD,
            Self::Markdown => MEMORY_STRATEGY_MARKDOWN,
            Self::KeywordSearch => MEMORY_STRATEGY_KEYWORD_SEARCH,
        }
    }

    /// Whether this strategy keeps memories as **files** — created with `create_memory`, read with
    /// `read_memory`, revised with `edit_memory`'s search/replace — rather than as the scratchpad's
    /// always-in-context notes.
    pub fn is_file_shaped(self) -> bool {
        matches!(self, Self::Markdown | Self::KeywordSearch)
    }

    /// Whether this strategy keeps a pinned [index](MemoryStore::index_text).
    pub fn has_index(self) -> bool {
        matches!(self, Self::Markdown)
    }

    /// Whether this strategy offers `search_memories`.
    pub fn has_search(self) -> bool {
        matches!(self, Self::KeywordSearch)
    }

    /// The names this strategy's calls go by for one agent — how gg must **name a memory call back
    /// to the model** in prose.
    ///
    /// Every strategy offers a different set of tools, and under
    /// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) each is a method on
    /// an API object rather than a tool name. Any prompt that tells a model to record something —
    /// the [memory compaction](crate::compaction::CompactionStrategy::Memory) instruction, and the
    /// refusal that answers a call made while one is pending — has to name the calls that run
    /// actually has, so they are derived here once instead of being spelled out at each site.
    ///
    /// `language` is the agent's [program language](test_cabinet_core::gg::GgProgramLanguage), or
    /// `None` for a tool-calling agent. It is a language rather than a `bool` because the *method*
    /// spelling is not gg's to decide: it is resolved from that language's own catalogue
    /// by [`spell`], so an SDK that renamed `editMemory` renames it in these sentences too, and a
    /// second language spells them its own way without this function learning about it.
    pub fn calls(self, language: Option<&dyn ProgramLanguage>) -> MemoryCalls {
        let named = |call: OperationId, tool: &str| match language {
            Some(language) => format!("`{}`", spell(language, call)),
            None => format!("`{tool}`"),
        };
        let (create, revise) = match self {
            Self::Scratchpad => (
                named(MEMORIES_WRITE_MEMORY, WRITE_MEMORY_TOOL),
                named(MEMORIES_UPDATE_MEMORY, UPDATE_MEMORY_TOOL),
            ),
            _ => (
                named(MEMORIES_CREATE_MEMORY, CREATE_MEMORY_TOOL),
                named(MEMORIES_EDIT_MEMORY, EDIT_MEMORY_TOOL),
            ),
        };
        MemoryCalls {
            create,
            revise,
            delete: named(MEMORIES_DELETE_MEMORY, DELETE_MEMORY_TOOL),
            read: named(MEMORIES_READ_MEMORY, READ_MEMORY_TOOL),
        }
    }
}

/// What one [strategy](MemoryStrategy::calls)'s calls are called, for one agent, already wrapped in
/// the backticks every prompt renders them with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryCalls {
    /// The call that records a new memory.
    pub create: String,
    /// The call that revises an existing one.
    pub revise: String,
    /// The call that removes one.
    pub delete: String,
    /// The call that reads one back. Named for every strategy, but only ever *offered* by the two
    /// [file-shaped](MemoryStrategy::is_file_shaped) ones — the scratchpad's memories are already
    /// in the window, so it has nothing to read them with. A prompt that points at it has to check
    /// the strategy first.
    pub read: String,
}

/// The bounds gg keeps the model's [memories](MemoryStore) within, so self-curated notes cannot
/// crowd out the working context.
///
/// [Resolved](Self::resolve) per [strategy](MemoryStrategy) from the memories capability's params,
/// all six of which an enabled capability writes. Every limit is an `Option`: `None` is **no bound
/// in force**, which a run asks for by setting the param to `0`, and is also what a limit the
/// strategy does not use always is. Lengths are in characters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryCaps {
    /// The maximum number of memories that may exist at once (`maxCount`).
    pub max_count: Option<usize>,
    /// The maximum length of any single memory's body (`maxLenPerMemory`).
    pub max_len_per_memory: Option<usize>,
    /// The maximum total body length, summed across every memory (`maxTotalLen`) — the
    /// [scratchpad](MemoryStrategy::Scratchpad)'s window budget, and `None` everywhere else.
    pub max_total_len: Option<usize>,
    /// The maximum length of the [markdown](MemoryStrategy::Markdown) strategy's pinned
    /// [index](MemoryStore::index_text) (`maxLenIndex`), and `None` everywhere else.
    pub max_len_index: Option<usize>,
    /// The maximum length of a memory's one-line description (`maxLenDescription`), under
    /// every strategy. The description is what an [index](MemoryStore::index_text) line and a
    /// [search hit](MemoryHit) are mostly made of, so it is the one field every turn pays for —
    /// which is why it is bounded everywhere rather than left to hope the model keeps its
    /// one-liners to one line.
    pub max_len_description: Option<usize>,
    /// The most memories one [search](MemoryStore::search) reports (`maxResults`), and `None`
    /// everywhere the strategy offers no search.
    pub max_results: Option<usize>,
}

impl MemoryCaps {
    /// A store bounded by **nothing** — every limit lifted.
    ///
    /// No configuration resolves to this: a run's bounds are always [`resolve`](Self::resolve)'s
    /// answer, read out of the six params an enabled capability writes. It is what a store built
    /// **by hand** is bounded by — the [reference](crate::reference) registries, which exist to be
    /// described rather than written to, and a test that bounds the one limit it is about — so that
    /// a store nobody configured carries no figure gg was never told.
    pub const UNBOUNDED: Self = Self {
        max_count: None,
        max_len_per_memory: None,
        max_total_len: None,
        max_len_index: None,
        max_len_description: None,
        max_results: None,
    };

    /// The bounds `capability` writes, as the [strategy](MemoryStrategy) it selects applies them.
    ///
    /// **All six params are read, whichever strategy is in force**, and an enabled capability that
    /// writes any of them short is refused at that key. Writing the whole block on every arm is
    /// what lets one sweep hand every arm the same params: a block that omitted the keys its own
    /// arm ignores could not be the block beside it. `0` lifts a limit, and a value naming no whole
    /// count is reported exactly as an absent one is — a limit is what a memories arm is *bounded*
    /// by, and one gg quietly chose is a run whose numbers cannot be compared with the arm beside
    /// it.
    ///
    /// A limit the strategy does not **apply** — `maxResults` under the scratchpad, `maxLenIndex`
    /// anywhere but `markdown` — resolves to `None`, which here says *no such bound is in force*
    /// rather than *unlimited*. It is still read and still refused if gg could not have honoured
    /// it, so the arm that applies the key is not the only one an operator hears about a typo in.
    ///
    /// A **disabled** capability is owed nothing: it bounds no memories, so an absent limit is
    /// nothing for it to be short of. Everything it does carry is read on exactly these terms,
    /// which is what keeps the on and off arms of one comparison one document with one switch
    /// moved.
    pub fn resolve(
        strategy: MemoryStrategy,
        capability: &GgCapabilityConfig,
        report: &mut LaunchReport,
    ) -> Self {
        Self {
            // The index bounds a markdown run's population: every memory must have a line in it.
            max_count: resolve_limit(
                capability,
                PARAM_MAX_COUNT,
                strategy != MemoryStrategy::Markdown,
                report,
            ),
            max_len_per_memory: resolve_limit(capability, PARAM_MAX_LEN_PER_MEMORY, true, report),
            // The pinned block as a whole, which is a thing to bound only where there is one.
            max_total_len: resolve_limit(
                capability,
                PARAM_MAX_TOTAL_LEN,
                strategy == MemoryStrategy::Scratchpad,
                report,
            ),
            max_len_index: resolve_limit(
                capability,
                PARAM_MAX_LEN_INDEX,
                strategy.has_index(),
                report,
            ),
            // Every strategy has descriptions, so this one applies everywhere.
            max_len_description: resolve_limit(capability, PARAM_MAX_LEN_DESCRIPTION, true, report),
            max_results: resolve_limit(
                capability,
                PARAM_MAX_RESULTS,
                strategy.has_search(),
                report,
            ),
        }
    }

    /// The contract form of the limits for the [`MemoryState`](GgTelemetryKind::MemoryState)
    /// telemetry.
    fn to_contract(self) -> GgMemoryCaps {
        let as_u64 = |limit: Option<usize>| limit.map(|limit| limit as u64);
        GgMemoryCaps {
            max_count: as_u64(self.max_count),
            max_len_per_memory: as_u64(self.max_len_per_memory),
            max_total_len: as_u64(self.max_total_len),
            max_len_index: as_u64(self.max_len_index),
            max_len_description: as_u64(self.max_len_description),
            max_results: as_u64(self.max_results),
        }
    }
}

/// **One of the six [limits](MemoryCaps) read out of a memories capability**, in the one spelling
/// every limit uses.
///
/// The key is [required](crate::validate::Requirement::Required) of an **enabled** capability, so
/// it is read through [`required_count_param`](crate::validate::required_count_param), which
/// reports its absence at the key it reads and leaves the limit standing at
/// [none](LIMIT_OF_A_REFUSED_LAUNCH). A **disabled** capability is owed no limit, so its params are
/// read through [`count_param`](crate::validate::count_param), where an absence is the ordinary
/// shape of a capability that bounds nothing and only an unreadable value is reported.
///
/// A positive whole number caps the limit and `0` lifts it. `applies` is whether the selected
/// [strategy](MemoryStrategy) bounds anything by this key at all: where it does not, the limit is
/// `None` however the params read it — the "one shared params block per sweep" case, in which the
/// arm that *does* apply the key is where the figure is enforced.
fn resolve_limit(
    capability: &GgCapabilityConfig,
    key: &str,
    applies: bool,
    report: &mut LaunchReport,
) -> Option<usize> {
    let count = if capability.enabled {
        match crate::validate::required_count_param(
            &capability.params,
            CAPABILITY_MEMORIES,
            key,
            report,
        ) {
            Some(count) => count,
            None => return LIMIT_OF_A_REFUSED_LAUNCH,
        }
    } else {
        // A disabled capability bounds no memories, so an absence is the off arm's ordinary shape
        // rather than a hole: nothing is owed, nothing is reported, and no bound comes back.
        crate::validate::count_param(&capability.params, CAPABILITY_MEMORIES, key, report)?
    };
    if count == 0 || !applies {
        return None;
    }
    Some(usize::try_from(count).unwrap_or(usize::MAX))
}

/// Read every memories value **one profile** declares, reporting each one gg cannot honour: the
/// [strategy](MemoryStrategy::resolve) it organizes them by, the [limits](MemoryCaps::resolve) it
/// bounds them with, and the [scope](resolve_scope) that decides whose store it binds.
///
/// Read whether or not the capability is switched on. A disabled capability still records the
/// configuration the arm *would* have used, so a typo in it is one an operator wants told about now
/// rather than on the launch where they flip the switch.
///
/// The checks that need more than one profile in hand — a scope on a profile that has no memories,
/// a child inheriting from a spawner that organizes them differently — are [`check_scoping`]'s.
pub fn check_launch(profile: &GgAgentConfig, report: &mut LaunchReport) {
    let Some(capability) = profile.capability(CAPABILITY_MEMORIES) else {
        return;
    };
    let strategy = MemoryStrategy::resolve(capability.implementation.as_deref(), report);
    MemoryCaps::resolve(strategy, capability, report);
    resolve_scope(profile, report);
}

/// The two **code** halves a memory may carry beside its body, and the shape a write hands them in.
///
/// Both are [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/api-surface/) only: the native
/// memory tools' schemas do not offer them, so a native-mode run can neither write one nor be
/// handed one, and [`Default`] — both absent — is what that path always passes.
///
/// Neither is context. [`code`](Self::code) is prepared once and supplied to every later program as
/// a library; [`on_use`](Self::on_use) runs on every use and is never shown to the model at all. So
/// neither counts against a body limit, and both are bounded on their own by
/// [`MAX_MEMORY_CODE_CHARS`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MemoryCode {
    /// A module, in the agent's own program language, which its later programs import.
    pub code: Option<String>,
    /// A script gg runs on every use of the memory.
    pub on_use: Option<String>,
}

impl MemoryCode {
    /// Whether this memory carries no code at all — the ordinary case, and what every native-mode
    /// write produces.
    pub fn is_empty(&self) -> bool {
        self.code.is_none() && self.on_use.is_none()
    }

    /// The two halves trimmed, with a blank one normalised to absent: a model that clears its code
    /// by writing `""` means *no code*, and storing an empty module would bind an empty `lib` entry
    /// that says nothing and runs nothing.
    fn normalized(self) -> Self {
        let some = |value: Option<String>| {
            value
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        Self {
            code: some(self.code),
            on_use: some(self.on_use),
        }
    }
}

/// One model-curated memory: the `name` (its slug) and `description` a strategy may show up front,
/// the `body` the model wrote, and — under responses-as-code — the [code](MemoryCode) it carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Memory {
    /// The memory's stable slug — the handle every memory tool takes.
    name: String,
    /// The one-line description shown up front (not counted against the body limits).
    description: String,
    /// The memory's body — the substance, and what the length limits measure.
    body: String,
    /// The code halves, both absent for an ordinary prose memory.
    code: MemoryCode,
}

impl Memory {
    /// The memory's length in characters — its **body** length, what the [limits](MemoryCaps)
    /// bound (the short description is bounded separately, by
    /// [`max_len_description`](MemoryCaps::max_len_description)).
    pub fn len(&self) -> usize {
        self.body.chars().count()
    }

    /// The memory's length in **lines** — the second size the console reports, because
    /// characters alone do not distinguish a dense paragraph from a long checklist. Bodies are
    /// stored trimmed and never empty, so this is one more than the number of newlines.
    pub fn lines(&self) -> usize {
        self.body.lines().count().max(1)
    }
}

// Name/description/body accessors are the memory's read surface for the tests and for the
// console-facing derivations that read the fields directly; the non-test binary reaches
// the fields internally, so it sees these as unused.
#[allow(dead_code)]
impl Memory {
    /// The memory's slug.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The memory's description.
    pub fn description(&self) -> &str {
        &self.description
    }

    /// The memory's body.
    pub fn body(&self) -> &str {
        &self.body
    }

    /// The reusable module this memory carries, if any — supplied to later programs as a library
    /// once the memory is in use.
    pub fn code(&self) -> Option<&str> {
        self.code.code.as_deref()
    }

    /// The on-use script this memory carries, if any — run once, when it first comes into use.
    pub fn on_use(&self) -> Option<&str> {
        self.code.on_use.as_deref()
    }

    /// Whether this memory carries either code half. What decides whether coming into use has to do
    /// anything at all.
    pub fn has_code(&self) -> bool {
        !self.code.is_empty()
    }
}

/// Why a [`MemoryStore`] mutation was refused. Its [`Display`](fmt::Display) is the
/// **model-facing** message the tool returns: every variant tells the model how to
/// proceed (revise, evict, or delete), never silently truncating or dropping content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoryError {
    /// A required field (`name`, `description`, `body`, …) was empty.
    EmptyField(&'static str),
    /// A slug carried characters a memory name may not hold, or was too long.
    InvalidSlug(String),
    /// A create named a memory that already exists.
    Duplicate {
        /// The name that is already taken.
        name: String,
        /// The call that revises the existing memory instead, as this store's
        /// [strategy](MemoryStrategy::calls) names it.
        revise: String,
    },
    /// An operation named a memory that does not exist.
    NotFound {
        /// The name that matched nothing.
        name: String,
        /// The call that creates a memory, as this store's [strategy](MemoryStrategy::calls)
        /// names it.
        create: String,
    },
    /// The memory's description exceeds the description length limit.
    DescriptionCap {
        /// The offending memory's slug.
        name: String,
        /// The description length that was attempted.
        len: usize,
        /// The description limit.
        cap: usize,
    },
    /// The memory's code, or its on-use script, exceeds [`MAX_MEMORY_CODE_CHARS`].
    CodeCap {
        /// The offending memory's slug.
        name: String,
        /// Which half was too long, as the model wrote it (`code` / `onUse`).
        half: &'static str,
        /// The length that was attempted.
        len: usize,
    },
    /// The memory's body exceeds the per-memory length limit.
    PerMemoryCap {
        /// The offending memory's slug.
        name: String,
        /// The body length that was attempted.
        len: usize,
        /// The per-memory limit.
        cap: usize,
    },
    /// Adding a memory would exceed the count limit.
    CountCap {
        /// The count limit (already reached).
        cap: usize,
        /// The call that revises an existing memory, as this store's
        /// [strategy](MemoryStrategy::calls) names it.
        revise: String,
        /// The call that removes one, likewise.
        delete: String,
    },
    /// The write would push the aggregate body length over the total limit.
    TotalCap {
        /// The total length the write would produce.
        would_be: usize,
        /// The aggregate limit.
        cap: usize,
    },
    /// The new memory's index entry would push the [index](MemoryStore::index_text) over its
    /// limit — the [markdown](MemoryStrategy::Markdown) strategy's ceiling on how many memories a
    /// run may hold.
    IndexCap {
        /// The index length the entry would produce.
        would_be: usize,
        /// The index limit.
        cap: usize,
    },
    /// An edit's search text does not appear in the memory.
    EditNotFound {
        /// The memory that was edited.
        name: String,
    },
    /// An edit's search text appears more than once, so which occurrence to replace is ambiguous.
    EditNotUnique {
        /// The memory that was edited.
        name: String,
        /// How many times the search text occurs.
        occurrences: usize,
    },
    /// An edit would leave the memory empty — which is a deletion, and gg makes the model say so.
    WouldEmpty(String),
    /// A search was called with no usable keywords.
    NoKeywords,
}

impl fmt::Display for MemoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MemoryError::EmptyField(field) => {
                write!(f, "`{field}` must not be empty")
            }
            MemoryError::InvalidSlug(name) => write!(
                f,
                "`{name}` is not a usable memory name; up to {MAX_SLUG_LEN} characters of \
                 letters, digits, `-`, `_` or `.`"
            ),
            MemoryError::Duplicate { name, revise } => {
                write!(f, "memory `{name}` already exists; revise it with {revise}")
            }
            MemoryError::NotFound { name, create } => {
                write!(f, "no memory named `{name}`; create it with {create}")
            }
            MemoryError::DescriptionCap { name, len, cap } => write!(
                f,
                "the description for memory `{name}` is {len} characters (max {cap})"
            ),
            MemoryError::PerMemoryCap { name, len, cap } => {
                write!(f, "memory `{name}` is {len} characters (max {cap})")
            }
            MemoryError::CodeCap { name, half, len } => write!(
                f,
                "the `{half}` of memory `{name}` is {len} characters (max \
                 {MAX_MEMORY_CODE_CHARS})"
            ),
            MemoryError::CountCap {
                cap,
                revise,
                delete,
            } => write!(
                f,
                "at the maximum of {cap} memories; revise one with {revise} or remove one with \
                 {delete}"
            ),
            MemoryError::TotalCap { would_be, cap } => {
                write!(f, "total memory would be {would_be} characters (max {cap})")
            }
            MemoryError::IndexCap { would_be, cap } => write!(
                f,
                "the memory index would be {would_be} characters (max {cap})"
            ),
            MemoryError::EditNotFound { name } => {
                write!(f, "the search text does not appear in memory `{name}`")
            }
            MemoryError::EditNotUnique { name, occurrences } => write!(
                f,
                "the search text appears {occurrences} times in memory `{name}`"
            ),
            MemoryError::WouldEmpty(name) => write!(
                f,
                "that edit would leave memory `{name}` empty; delete it instead"
            ),
            MemoryError::NoKeywords => {
                write!(f, "`keywords` needs at least one non-empty keyword")
            }
        }
    }
}

/// What a successful [`MemoryStore`] mutation did — the loop reports this in the tool's
/// confirmation and the telemetry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryChange {
    /// A new memory was created.
    Written,
    /// An existing memory was revised.
    Updated,
    /// A memory was removed.
    Deleted,
}

/// The mutable, limit-enforcing set of the model's memories.
///
/// The store is the single owner of the memory set; the [tools](crate::tools) and the
/// [loop](crate::agent) share it behind an `Arc<Mutex<…>>`. Every mutation is checked against the
/// [limits](MemoryCaps) *before* it takes effect and refused with a [`MemoryError`] otherwise, so
/// the invariants always hold. Memories are kept in slug order, for a stable telemetry, index and
/// prompt-block ordering.
///
/// # What the store remembers beyond the set
///
/// The live set answers "what does the model hold now", which is the smaller half of the
/// question a study of memory asks. Two things the set cannot show are kept alongside it:
///
/// - the **[revision log](Self::log_from)** — every mutation, in order, with the text it
///   produced and the agent that made it, so a memory the model wrote and later deleted, and the
///   earlier wording of one it revised, are both still in the record;
/// - the **[peaks](Self::peak)** — the high-water count and length, so a run that curated its
///   way back down to two short notes does not read as one that never used memory.
///
/// # One store, several holders
///
/// A store is not necessarily one agent's. Under every [scope](MemoryScope) but
/// [`Isolated`](MemoryScope::Isolated) the same store is held by several
/// [`MemoriesRuntime`]s at once, and that is why the revision log is **append-only and
/// author-tagged** rather than a queue the first reader empties. A destructive drain cannot serve
/// two holders: whichever looked first would steal the other's events, and neither could tell
/// which writes were its own. With a log plus a per-holder cursor, a write is reported exactly
/// once — on the stream of the agent that made it — and every *other* holder can be told about it
/// in its next prompt without being told about its own.
///
/// A cursor is an **absolute** position in that log rather than an index into the `Vec` behind it,
/// which is what lets the store forget an entry every one of its holders has already read past
/// (see [`register_holder`](Self::register_holder)). Without that a working notebook edited for
/// hours would retain a full copy of every wording a memory ever had, for a reader that can no
/// longer exist; with it the log costs what is still owed and nothing else.
#[derive(Debug, Clone)]
pub struct MemoryStore {
    strategy: MemoryStrategy,
    caps: MemoryCaps,
    memories: Vec<Memory>,
    /// The next revision number for each slug ever written, kept across a delete so a
    /// re-created name continues its history rather than restarting it.
    revisions: BTreeMap<String, u64>,
    /// Every mutation this store has taken that some holder may still be owed, oldest first, each
    /// tagged with the agent that made it. Holders read it through their own cursors (see the
    /// type's docs) and it is pruned from the front once every live holder has passed an entry.
    log: Vec<LoggedRevision>,
    /// The absolute position of `log[0]` — how many entries have been [pruned](Self::prune_log)
    /// off the front. A holder's cursor is an absolute position, so this is what translates one
    /// into an index and what makes [`log_len`](Self::log_len) keep counting past a prune.
    log_base: usize,
    /// The watermarks of every holder of this store, weakly held so a finished agent's holder
    /// releases them. They exist for exactly one purpose: to know which log entries nobody can
    /// still be owed. A store with no live holder prunes nothing — that is a store being driven
    /// directly (a test, or one built but not yet bound), and forgetting its log would lose the
    /// record its first holder is about to read.
    holders: Vec<Weak<Mutex<HolderCursors>>>,
    /// The high-water marks, updated after every mutation.
    peak: MemoryPeak,
}

/// One entry of a store's [revision log](MemoryStore::log_from): what changed, and **who** changed
/// it.
///
/// The author is the agent id of the holder whose call performed the mutation, recorded at the
/// mutation rather than inferred at the drain — the only shape under which two holders of one
/// store can both be right about whose write a given entry was. It is what makes
/// [`MemoriesRuntime::drain_events`] report a write once, and
/// [`MemoriesRuntime::notice`] report it to everyone else.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoggedRevision {
    /// What the mutation did.
    pub revision: MemoryRevision,
    /// The id of the agent whose call made it. Empty for a store driven directly (a test), which
    /// reads as "no agent" and matches no holder.
    pub author: String,
}

/// One recorded mutation of one memory — an entry of the store's
/// [revision log](MemoryStore::log_from).
///
/// A [`Deleted`](MemoryChange::Deleted) revision carries no text: what the memory said is
/// already in the log, on the revision before it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryRevision {
    /// The memory's slug.
    pub name: String,
    /// This memory's revision number, counting from `1` at its first write.
    pub revision: u64,
    /// What this revision did.
    pub change: MemoryChange,
    /// The description as of this revision; empty on a deletion.
    pub description: String,
    /// The body as of this revision; empty on a deletion.
    pub body: String,
}

impl MemoryRevision {
    /// The contract form, for the [`MemoryRevision`](GgTelemetryKind::MemoryRevision) telemetry.
    fn to_event(&self) -> GgTelemetryKind {
        GgTelemetryKind::MemoryRevision {
            name: self.name.clone(),
            revision: self.revision,
            change: match self.change {
                MemoryChange::Written => GgMemoryChange::Written,
                MemoryChange::Updated => GgMemoryChange::Updated,
                MemoryChange::Deleted => GgMemoryChange::Deleted,
            },
            description: self.description.clone(),
            body: self.body.clone(),
            len: self.body.chars().count() as u64,
            lines: if self.body.is_empty() {
                0
            } else {
                self.body.lines().count().max(1) as u64
            },
        }
    }
}

/// The high-water marks a store reached — see [`MemoryStore`]'s note on why the live figures
/// are not the whole story.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MemoryPeak {
    /// The most memories held at once.
    pub count: usize,
    /// The largest total body length, in characters, held at once.
    pub total_len: usize,
    /// The largest total body length, in lines, held at once.
    pub total_lines: usize,
}

impl MemoryStore {
    /// An empty store bounded by `caps`, organized by `strategy`.
    pub fn new(strategy: MemoryStrategy, caps: MemoryCaps) -> Self {
        Self {
            strategy,
            caps,
            memories: Vec::new(),
            revisions: BTreeMap::new(),
            log: Vec::new(),
            log_base: 0,
            holders: Vec::new(),
            peak: MemoryPeak::default(),
        }
    }

    /// An empty [scratchpad](MemoryStrategy::Scratchpad) store bounded by
    /// [nothing](MemoryCaps::UNBOUNDED) — the shorthand the tests and the bare tool-registry
    /// constructor use, neither of which has a configuration to resolve bounds out of.
    #[allow(dead_code)]
    pub fn scratchpad() -> Self {
        Self::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED)
    }

    /// The strategy this store is organized by.
    pub fn strategy(&self) -> MemoryStrategy {
        self.strategy
    }

    /// The limits this store enforces.
    pub fn caps(&self) -> MemoryCaps {
        self.caps
    }

    /// Re-point the limits at `caps` — what a [transfer](crate::modules::transfer) does when a
    /// different agent profile [adopts](crate::modules::Module::adopt) this store, so the limits
    /// in force are the *receiving* profile's rather than the ones the donor happened to resolve.
    ///
    /// Contents already over a newly-tightened cap are **kept**: the ordinary cap checks refuse
    /// the next write, but deleting a memory because the successor's profile is stingier would
    /// lose work the run already paid for.
    #[allow(dead_code)] // used by `Module::adopt`, which a transfer reaches — see `crate::modules`.
    pub fn set_caps(&mut self, caps: MemoryCaps) {
        self.caps = caps;
    }

    /// The number of memories currently held.
    pub fn count(&self) -> usize {
        self.memories.len()
    }

    /// The total body length, in characters, across every memory.
    pub fn total_len(&self) -> usize {
        self.memories.iter().map(Memory::len).sum()
    }

    /// The total body length, in lines, across every memory.
    pub fn total_lines(&self) -> usize {
        self.memories.iter().map(Memory::lines).sum()
    }

    /// The [high-water marks](MemoryPeak) this store reached. (A read surface for the tests;
    /// the telemetry reads the field directly.)
    #[allow(dead_code)]
    pub fn peak(&self) -> MemoryPeak {
        self.peak
    }

    /// The head of the [revision log](Self::log_from) — how many mutations this store has taken
    /// in its life, and where a new holder's cursors start so it is not told about history it
    /// never missed.
    ///
    /// It counts every entry ever recorded, including any the store has since
    /// [pruned](Self::prune_log): a cursor is an absolute position, so the count it is compared
    /// against has to be one too.
    pub fn log_len(&self) -> usize {
        self.log_base + self.log.len()
    }

    /// The [logged revisions](LoggedRevision) at or after the absolute position `cursor`, oldest
    /// first — the record of what was done to this store, which each holder reads through its own
    /// watermark rather than draining out from under the others.
    ///
    /// A `cursor` beyond the head yields nothing, which is what a holder that is already current
    /// sees on a turn where nobody wrote. A `cursor` *behind* the pruned front yields everything
    /// still held, which cannot happen for a registered holder — pruning stops at the earliest
    /// live cursor — and is the harmless answer for one that is not.
    pub fn log_from(&self, cursor: usize) -> &[LoggedRevision] {
        self.log
            .get(cursor.saturating_sub(self.log_base)..)
            .unwrap_or(&[])
    }

    /// Register a holder's [watermarks](HolderCursors) with the store, so it knows what is still
    /// owed to somebody.
    ///
    /// Held **weakly**: a holder is a live agent instance, and when the agent finishes nothing
    /// should keep its cursors — or the entries behind them — alive. Called once per holder, from
    /// the one constructor every holder goes through.
    fn register_holder(&mut self, cursors: &Arc<Mutex<HolderCursors>>) {
        self.holders.retain(|holder| holder.strong_count() > 0);
        self.holders.push(Arc::downgrade(cursors));
    }

    /// How many live holders this store has.
    ///
    /// The question behind it is always "is this notebook one agent's, or several agents'?" — it
    /// decides whether a [transfer](crate::modules::transfer) may re-point the store's
    /// [limits](Self::set_caps) at the receiving profile's, which would otherwise silently change
    /// what the *other* holders may write.
    pub fn holders(&self) -> usize {
        self.holders
            .iter()
            .filter(|holder| holder.strong_count() > 0)
            .count()
    }

    /// Forget the log entries every live holder has already read past.
    ///
    /// Run after each mutation, because that is the only moment the log grows. The floor is the
    /// earliest of every live holder's two watermarks: an entry below it can no longer be streamed
    /// as telemetry or announced in a notice, so nothing can ask for it again. A store with no
    /// live holder keeps everything — its first holder starts at the head, but a store driven
    /// directly (a test, or the registry entry between two instances of a profile) has a record
    /// worth reading.
    fn prune_log(&mut self) {
        self.holders.retain(|holder| holder.strong_count() > 0);
        let mut floor = usize::MAX;
        for holder in &self.holders {
            let Some(cursors) = holder.upgrade() else {
                continue;
            };
            let cursors = cursors.lock().expect("memory cursors lock");
            floor = floor.min(cursors.telemetry.min(cursors.notice));
        }
        if floor == usize::MAX {
            return;
        }
        let forget = floor.saturating_sub(self.log_base);
        if forget == 0 {
            return;
        }
        self.log.drain(..forget.min(self.log.len()));
        self.log_base = floor;
    }

    /// The memories, in slug order. (A read surface for the tests; the loop reaches the
    /// store through the runtime's derivations.)
    #[allow(dead_code)]
    pub fn memories(&self) -> &[Memory] {
        &self.memories
    }

    // -----------------------------------------------------------------------
    // The scratchpad strategy
    // -----------------------------------------------------------------------

    /// Create a new memory, body and all, under the [scratchpad](MemoryStrategy::Scratchpad)
    /// strategy. Refused if any field is empty, a memory of that name already exists, the body
    /// exceeds the per-memory limit, the store is already at the count limit, or the write would
    /// exceed the total-length limit.
    pub fn write(
        &mut self,
        author: &str,
        name: &str,
        description: &str,
        body: &str,
        code: MemoryCode,
    ) -> Result<MemoryChange, MemoryError> {
        let (name, description, body) = validate_fields(name, description, body)?;
        if self.position(&name).is_some() {
            return Err(self.duplicate(name));
        }
        let code = code.normalized();
        let len = body.chars().count();
        self.check_description(&name, &description)?;
        Self::check_code(&name, &code)?;
        self.check_per_memory(&name, len)?;
        self.check_count()?;
        self.check_total(self.total_len() + len)?;
        self.insert(Memory {
            name: name.clone(),
            description,
            body,
            code,
        });
        self.record(author, &name, MemoryChange::Written);
        Ok(MemoryChange::Written)
    }

    /// Revise an existing memory in place, replacing both its description and its whole body.
    /// Refused if any field is empty, no memory of that name exists, the new body exceeds the
    /// per-memory limit, or the update would push the aggregate length over the total limit. (The
    /// count is unchanged, so the count limit does not apply.)
    pub fn update(
        &mut self,
        author: &str,
        name: &str,
        description: &str,
        body: &str,
        code: Option<MemoryCode>,
    ) -> Result<MemoryChange, MemoryError> {
        let (name, description, body) = validate_fields(name, description, body)?;
        let Some(index) = self.position(&name) else {
            return Err(self.not_found(&name));
        };
        // `Some` replaces the memory's code whole — omitting a half clears it, on the same rule the
        // body follows, so a model that means to keep its module passes it again. `None` is the
        // *native* tool path, whose schema has no code fields at all: it must leave alone what it
        // cannot express, or a tool-calling agent sharing a store would silently delete the module a
        // program-writing one put there.
        let code = match code {
            Some(code) => code.normalized(),
            None => self.memories[index].code.clone(),
        };
        let len = body.chars().count();
        self.check_description(&name, &description)?;
        Self::check_code(&name, &code)?;
        self.check_per_memory(&name, len)?;
        // Swap the old body out of the total before checking the new one in.
        let total_without_old = self.total_len() - self.memories[index].len();
        self.check_total(total_without_old + len)?;
        self.memories[index] = Memory {
            name: name.clone(),
            description,
            body,
            code,
        };
        self.record(author, &name, MemoryChange::Updated);
        Ok(MemoryChange::Updated)
    }

    // -----------------------------------------------------------------------
    // The two file-shaped strategies
    // -----------------------------------------------------------------------

    /// Create a memory **file**: a slug, a description, and the initial contents.
    ///
    /// The description is required under [markdown](MemoryStrategy::Markdown) — it is the memory's
    /// index entry, the only thing about it that is always in the window — and optional under
    /// [keyword-search](MemoryStrategy::KeywordSearch), which has no index to put it in (there it
    /// is carried into a [search hit](MemoryHit) when given).
    ///
    /// Refused if the slug is malformed or taken, the contents are empty or over the per-memory
    /// limit, the count limit is already reached, or — under markdown — the new index entry would
    /// not fit in the index.
    pub fn create(
        &mut self,
        author: &str,
        name: &str,
        description: &str,
        contents: &str,
        code: MemoryCode,
    ) -> Result<MemoryChange, MemoryError> {
        let name = validate_slug(name)?;
        let description = description.trim().to_string();
        if self.strategy.has_index() && description.is_empty() {
            return Err(MemoryError::EmptyField("description"));
        }
        let contents = contents.trim().to_string();
        if contents.is_empty() {
            return Err(MemoryError::EmptyField("contents"));
        }
        if self.position(&name).is_some() {
            return Err(self.duplicate(name));
        }
        let code = code.normalized();
        self.check_description(&name, &description)?;
        Self::check_code(&name, &code)?;
        self.check_per_memory(&name, contents.chars().count())?;
        self.check_count()?;
        self.check_index(&name, &description)?;
        self.insert(Memory {
            name: name.clone(),
            description,
            body: contents,
            code,
        });
        self.record(author, &name, MemoryChange::Written);
        Ok(MemoryChange::Written)
    }

    /// The contents of one memory file, for `read_memory`.
    pub fn read(&self, name: &str) -> Result<&Memory, MemoryError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(MemoryError::EmptyField("name"));
        }
        self.position(name)
            .map(|index| &self.memories[index])
            .ok_or_else(|| self.not_found(name))
    }

    /// Revise a memory file by replacing the single exact occurrence of `search` with `replace` —
    /// the same search/replace contract `edit_file` has, for the same reason: a model that must
    /// quote the text it is changing cannot silently rewrite the wrong part of a memory.
    ///
    /// Refused if no memory of that name exists, the search text is missing or ambiguous, the
    /// result would exceed the per-memory limit, or the result would be **empty** — which is a
    /// deletion, and gg refuses to infer one from an edit.
    pub fn edit(
        &mut self,
        author: &str,
        name: &str,
        search: &str,
        replace: &str,
    ) -> Result<MemoryChange, MemoryError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(MemoryError::EmptyField("name"));
        }
        if search.is_empty() {
            return Err(MemoryError::EmptyField("search"));
        }
        let Some(index) = self.position(name) else {
            return Err(self.not_found(name));
        };

        let name = name.to_string();
        let body = &self.memories[index].body;
        match body.matches(search).count() {
            0 => return Err(MemoryError::EditNotFound { name }),
            1 => {}
            occurrences => return Err(MemoryError::EditNotUnique { name, occurrences }),
        }
        let edited = body.replacen(search, replace, 1).trim().to_string();
        if edited.is_empty() {
            return Err(MemoryError::WouldEmpty(name));
        }
        let len = edited.chars().count();
        self.check_per_memory(&name, len)?;
        // The scratchpad's aggregate budget still applies when a run edits under that strategy.
        let total_without_old = self.total_len() - self.memories[index].len();
        self.check_total(total_without_old + len)?;
        self.memories[index].body = edited;
        self.record(author, &name, MemoryChange::Updated);
        Ok(MemoryChange::Updated)
    }

    /// The memories matching `keywords`, best first — the
    /// [keyword-search](MemoryStrategy::KeywordSearch) strategy's retrieval.
    ///
    /// Ranked by how many distinct keywords a memory matches, then by how many times they occur;
    /// see [the ranking's own docs](search) for what is searched and why. At most
    /// [`max_results`](MemoryCaps::max_results) hits are returned. A call with no usable keyword is
    /// refused rather than answered with everything.
    pub fn search(&self, keywords: &[String]) -> Result<Vec<MemoryHit>, MemoryError> {
        let keywords = search::normalize_keywords(keywords);
        if keywords.is_empty() {
            return Err(MemoryError::NoKeywords);
        }
        Ok(search::rank(
            &self.memories,
            &keywords,
            self.caps.max_results,
        ))
    }

    /// Remove a memory. Refused only if the name is empty or no memory of that name exists — a
    /// deletion never runs into a limit, since it can only free room.
    pub fn delete(&mut self, author: &str, name: &str) -> Result<MemoryChange, MemoryError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(MemoryError::EmptyField("name"));
        }
        let Some(index) = self.position(name) else {
            return Err(self.not_found(name));
        };
        let name = self.memories.remove(index).name;
        self.record(author, &name, MemoryChange::Deleted);
        Ok(MemoryChange::Deleted)
    }

    // -----------------------------------------------------------------------
    // Derivations
    // -----------------------------------------------------------------------

    /// The [index](MemoryStrategy::Markdown) as the model sees it: one
    /// `` - `slug` — description `` line per memory, in slug order.
    ///
    /// This is the text the [index limit](MemoryCaps::max_len_index) measures **and** the text the
    /// pinned block renders, deliberately from one function: the number gg refuses a create with
    /// has to be the number the model is paying for.
    pub fn index_text(&self) -> String {
        self.memories
            .iter()
            .map(index_line)
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// The length of the [index](Self::index_text) in characters.
    pub fn index_len(&self) -> usize {
        self.index_text().chars().count()
    }

    /// The index of the memory named `name`, if any.
    fn position(&self, name: &str) -> Option<usize> {
        self.memories.iter().position(|m| m.name == name)
    }

    /// Insert `memory`, keeping the set ordered by slug.
    fn insert(&mut self, memory: Memory) {
        let at = self
            .memories
            .binary_search_by(|m| m.name.cmp(&memory.name))
            .unwrap_or_else(|at| at);
        self.memories.insert(at, memory);
    }

    /// Append `change`, made by `author`, to the [revision log](Self::log_from) and refresh the
    /// [peaks](Self::peak).
    ///
    /// Called at the end of every successful mutation, once the set is already in its new
    /// state — so the text recorded is read back from the store rather than from the caller's
    /// arguments, and can never claim a revision the store did not actually take. A deletion
    /// finds nothing to read back, and records the empty text that says so.
    ///
    /// The author travels with the mutation rather than being attached afterwards because a
    /// store may be held by several agents at once: attribution decided at the drain would be a
    /// guess, and the guess would be wrong exactly when two agents are curating together, which
    /// is the case attribution exists for.
    fn record(&mut self, author: &str, name: &str, change: MemoryChange) {
        let revision = {
            let next = self.revisions.entry(name.to_string()).or_insert(0);
            *next += 1;
            *next
        };
        let (description, body) = match self.position(name) {
            Some(index) => (
                self.memories[index].description.clone(),
                self.memories[index].body.clone(),
            ),
            None => (String::new(), String::new()),
        };
        self.log.push(LoggedRevision {
            revision: MemoryRevision {
                name: name.to_string(),
                revision,
                change,
                description,
                body,
            },
            author: author.to_string(),
        });
        self.peak = MemoryPeak {
            count: self.peak.count.max(self.memories.len()),
            total_len: self.peak.total_len.max(self.total_len()),
            total_lines: self.peak.total_lines.max(self.total_lines()),
        };
        // The log just grew, which is the only moment anything can have become unreachable: every
        // other holder's cursor is where it was, and this write is behind none of them.
        self.prune_log();
    }

    /// Refuse a description whose length exceeds the description limit.
    ///
    /// Checked **before** the body limits so a memory that is over on both is told about the
    /// one-liner first: shortening a description is a smaller ask than restructuring a body,
    /// and a model that fixes it and resubmits should not then be refused again for the same
    /// call it already had to redo.
    fn check_description(&self, name: &str, description: &str) -> Result<(), MemoryError> {
        let Some(cap) = self.caps.max_len_description else {
            return Ok(());
        };
        let len = description.chars().count();
        if len > cap {
            return Err(MemoryError::DescriptionCap {
                name: name.to_string(),
                len,
                cap,
            });
        }
        Ok(())
    }

    /// Refuse code, or an on-use script, longer than [`MAX_MEMORY_CODE_CHARS`].
    ///
    /// A fixed ceiling rather than a configurable one: what it protects is the transpiler's
    /// recursive-descent parse of untrusted source, which is a property of gg rather than of the
    /// study a run is part of.
    fn check_code(name: &str, code: &MemoryCode) -> Result<(), MemoryError> {
        for (half, source) in [("code", &code.code), ("onUse", &code.on_use)] {
            let Some(source) = source else { continue };
            let len = source.chars().count();
            if len > MAX_MEMORY_CODE_CHARS {
                return Err(MemoryError::CodeCap {
                    name: name.to_string(),
                    half,
                    len,
                });
            }
        }
        Ok(())
    }

    /// Refuse a body whose length exceeds the per-memory limit.
    fn check_per_memory(&self, name: &str, len: usize) -> Result<(), MemoryError> {
        match self.caps.max_len_per_memory {
            Some(cap) if len > cap => Err(MemoryError::PerMemoryCap {
                name: name.to_string(),
                len,
                cap,
            }),
            _ => Ok(()),
        }
    }

    /// Refuse another memory once the count limit is reached.
    fn check_count(&self) -> Result<(), MemoryError> {
        match self.caps.max_count {
            Some(cap) if self.memories.len() >= cap => {
                let calls = self.strategy.calls(None);
                Err(MemoryError::CountCap {
                    cap,
                    revise: calls.revise,
                    delete: calls.delete,
                })
            }
            _ => Ok(()),
        }
    }

    /// The "that name is taken" refusal, naming **this** strategy's revise call.
    ///
    /// The store's messages are read by a model that has one strategy's tools and no others, so
    /// every refusal that points at an alternative has to point at a call that run actually has.
    /// The tool-calling spelling is used because these messages are a tool's output; a program
    /// under responses-as-code reads the typed error class instead, and the sentence is the
    /// fallback it prints rather than the thing it branches on.
    fn duplicate(&self, name: String) -> MemoryError {
        MemoryError::Duplicate {
            name,
            revise: self.strategy.calls(None).revise,
        }
    }

    /// The "no such memory" refusal, naming this strategy's create call. See [`duplicate`](Self::duplicate).
    fn not_found(&self, name: &str) -> MemoryError {
        MemoryError::NotFound {
            name: name.to_string(),
            create: self.strategy.calls(None).create,
        }
    }

    /// Refuse an aggregate length that exceeds the total limit.
    fn check_total(&self, would_be: usize) -> Result<(), MemoryError> {
        match self.caps.max_total_len {
            Some(cap) if would_be > cap => Err(MemoryError::TotalCap { would_be, cap }),
            _ => Ok(()),
        }
    }

    /// Refuse a new entry that would push the index over its limit.
    ///
    /// The length checked is the index the create would *produce*, entry separator included, so
    /// the check and the rendering can never disagree about what an entry costs.
    fn check_index(&self, name: &str, description: &str) -> Result<(), MemoryError> {
        let Some(cap) = self.caps.max_len_index else {
            return Ok(());
        };
        let entry = index_line(&Memory {
            name: name.to_string(),
            description: description.to_string(),
            body: String::new(),
            code: MemoryCode::default(),
        });
        let current = self.index_len();
        // Every entry after the first costs its own line plus the newline joining it.
        let would_be = if current == 0 {
            entry.chars().count()
        } else {
            current + 1 + entry.chars().count()
        };
        if would_be > cap {
            return Err(MemoryError::IndexCap { would_be, cap });
        }
        Ok(())
    }

    /// The [`MemoryState`](GgTelemetryKind::MemoryState) telemetry for the current set, as the
    /// holder described by `scope` and `writable` sees it.
    ///
    /// The two holder facets are passed in rather than read off the store because they are not
    /// the store's: one store can be held by an agent that owns it and by another that may only
    /// read it, and a snapshot that did not say which would make two agents' panels
    /// indistinguishable.
    fn state_event(&self, module_id: &str, scope: MemoryScope, writable: bool) -> GgTelemetryKind {
        let memories = self
            .memories
            .iter()
            .map(|m| GgMemoryEntry {
                name: m.name.clone(),
                description: m.description.clone(),
                len: m.len() as u64,
                lines: m.lines() as u64,
            })
            .collect();
        GgTelemetryKind::MemoryState {
            module_id: module_id.to_string(),
            strategy: self.strategy.id().to_string(),
            memories,
            count: self.memories.len() as u64,
            total_len: self.total_len() as u64,
            total_lines: self.total_lines() as u64,
            peak: GgMemoryPeak {
                count: self.peak.count as u64,
                total_len: self.peak.total_len as u64,
                total_lines: self.peak.total_lines as u64,
            },
            caps: self.caps.to_contract(),
            scope: scope.as_str().to_string(),
            writable,
        }
    }

    /// The pinned context block this strategy keeps, or `None` when it keeps none (or has nothing
    /// yet to show):
    ///
    /// * [scratchpad](MemoryStrategy::Scratchpad) — every memory, body and all.
    /// * [markdown](MemoryStrategy::Markdown) — the [index](Self::index_text) alone.
    /// * [keyword-search](MemoryStrategy::KeywordSearch) — nothing, ever.
    ///
    /// The block is **state only**: a heading and the notes themselves. How to curate them, and
    /// the budget they live within, is stated once in the
    /// [system prompt](crate::prompts::SystemContext::memories) rather than re-sent each time
    /// the block is rebuilt.
    ///
    /// The loop rebuilds it at a [compaction](crate::compaction) boundary and nowhere else —
    /// see [`MemoriesRuntime::context_block`] for why.
    fn context_block(&self) -> Option<Message> {
        if self.memories.is_empty() {
            return None;
        }
        match self.strategy {
            MemoryStrategy::Scratchpad => {
                let memories = self
                    .memories
                    .iter()
                    .map(|memory| MemoryItemView {
                        name: memory.name.clone(),
                        description: memory.description.clone(),
                        body: memory.body.clone(),
                    })
                    .collect();
                Some(Message::user(prompts::render_memories(
                    &MemoriesBlockContext { memories },
                )))
            }
            // The block renders the index *verbatim* — the same text `check_index` measures — so
            // the budget the model is refused against is the budget it can see itself spending.
            MemoryStrategy::Markdown => Some(Message::user(prompts::render_memory_index(
                &MemoryIndexContext {
                    index: self.index_text(),
                },
            ))),
            MemoryStrategy::KeywordSearch => None,
        }
    }
}

/// One memory's index line, in the one spelling the limit and the rendering share.
fn index_line(memory: &Memory) -> String {
    if memory.description.is_empty() {
        format!("- `{}`", memory.name)
    } else {
        format!("- `{}` — {}", memory.name, memory.description)
    }
}

/// Validate and normalize a scratchpad write/update's three fields, trimming each and rejecting an
/// empty one. Returns the owned, trimmed `(name, description, body)`.
fn validate_fields(
    name: &str,
    description: &str,
    body: &str,
) -> Result<(String, String, String), MemoryError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(MemoryError::EmptyField("name"));
    }
    let description = description.trim();
    if description.is_empty() {
        return Err(MemoryError::EmptyField("description"));
    }
    // The body keeps its interior formatting but is trimmed of surrounding whitespace.
    let body = body.trim();
    if body.is_empty() {
        return Err(MemoryError::EmptyField("body"));
    }
    Ok((name.to_string(), description.to_string(), body.to_string()))
}

/// Validate a memory **file**'s slug: non-empty, at most [`MAX_SLUG_LEN`] characters, and made of
/// ASCII alphanumerics and [the three separators](SLUG_EXTRA_CHARS).
///
/// The scratchpad's names are deliberately not held to this — its notes are addressed only in the
/// window, never rendered as a file name in an index — so tightening a name that has always been
/// free-form would change a strategy this change is not about.
fn validate_slug(name: &str) -> Result<String, MemoryError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(MemoryError::EmptyField("name"));
    }
    let len = name.chars().count();
    let usable = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || SLUG_EXTRA_CHARS.contains(&c));
    if !usable || len > MAX_SLUG_LEN {
        return Err(MemoryError::InvalidSlug(name.to_string()));
    }
    Ok(name.to_string())
}

/// Whether a holder of a [`MemoryStore`] may **write** it.
///
/// Access is a property of the *holder*, never of the store — nothing on a store records who may
/// write it. That is not an implementation detail but the rule that makes
/// [`read-only`](MemoryScope::ReadOnly) inheritance compose: a read-only agent's own
/// [`inherited`](MemoryScope::Inherited) subagent gets a read/write handle onto the very same
/// store, because its own profile says so.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MemoryAccess {
    /// The holder may create, revise and delete. Every holder that is not a read-only inherited
    /// handle, including one that asked for `read-only` and ended up with a fresh instance of its
    /// own — a private notebook nobody may write is not a feature.
    #[default]
    ReadWrite,
    /// The holder is offered the read calls alone. Its write calls are never contributed to the
    /// [toolset](crate::tools::ToolRegistry), so the model is never shown a schema for one; the
    /// [responses-as-code](crate::sandbox) path refuses one that reaches it anyway, so a stale
    /// program cannot write through a handle the registry withheld.
    ReadOnly,
}

impl MemoryAccess {
    /// Whether this holder may write.
    pub fn is_writable(self) -> bool {
        matches!(self, MemoryAccess::ReadWrite)
    }
}

/// One holder's binding onto a [`MemoryStore`]: the shared store, and the id of the agent whose
/// calls go through it.
///
/// This is what the [memory tools](crate::tools) hold, rather than the bare `Arc<Mutex<…>>` they
/// held when a store could only ever belong to one agent. Every mutation is attributed to
/// [`author`](Self::author) as it is recorded, which is what lets several agents curate one store
/// and still have each write reported exactly once, on the stream of the agent that made it.
#[derive(Debug, Clone)]
pub struct MemoryBinding {
    /// The shared store.
    store: Arc<Mutex<MemoryStore>>,
    /// The id of the agent whose calls this binding services.
    author: Arc<str>,
}

impl MemoryBinding {
    /// A binding onto `store` for the agent named `author`.
    pub fn new(store: Arc<Mutex<MemoryStore>>, author: impl AsRef<str>) -> Self {
        Self {
            store,
            author: Arc::from(author.as_ref()),
        }
    }

    /// The agent every mutation made through this binding is recorded against.
    pub fn author(&self) -> &str {
        &self.author
    }

    /// The store, locked. Every memory tool takes this once per call and performs its read or its
    /// mutation under it.
    pub fn lock(&self) -> MutexGuard<'_, MemoryStore> {
        self.store.lock().expect("memory store lock")
    }
}

/// One holder's watermarks into its store's [revision log](MemoryStore::log_from).
///
/// Two, not one, because a holder owes two different audiences two different things and they
/// advance at different moments: the run record is owed every write *this* holder made, drained
/// after each call; the model is owed news of what *other* holders did, delivered once at a turn
/// boundary. A single cursor would make a drain swallow an undelivered notice.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct HolderCursors {
    /// How far this holder has streamed as [telemetry](MemoriesRuntime::revision_events).
    telemetry: usize,
    /// How far this holder has [told the model](MemoriesRuntime::notice).
    notice: usize,
}

/// The loop's live view of the memories capability: whether it is on, which
/// [strategy](MemoryStrategy) it runs, the [`MemoryStore`] it holds, and **how** it holds it.
///
/// Constructed [enabled](Self::new) with a strategy and resolved limits, or
/// [disabled](Self::disabled) (a configuration with the capability off). It hands a
/// [binding](Self::binding) to the
/// memory tools, produces the [strategy](Self::strategy) and [limits](Self::caps) the
/// [system prompt](crate::prompts::SystemContext::memories) states, the
/// [`MemoryState`](GgTelemetryKind::MemoryState) [telemetry](Self::state_event), and the pinned
/// [context block](Self::context_block) the loop keeps in the window.
///
/// # A holder, not an owner
///
/// Under every [scope](MemoryScope) but [`Isolated`](MemoryScope::Isolated) the store behind a
/// runtime is held by other agents too, and almost everything on this type that is not the store
/// is about being *one of several holders*: which agent this holder is (so its writes can be
/// attributed to it), whether it may [write](MemoryAccess) at all, and how far it has told its
/// stream and its model about what the store has seen. Those watermarks are the whole of the
/// linked-memory mechanism — see [`notice`](Self::notice).
///
/// It is a [module](crate::modules::Module): it can be [forked](Self::forked) into an independent
/// notebook, [shared](Self::shared) so several agents curate one, and handed to an agent running
/// under a different profile, which re-resolves the limits it enforces. It is deliberately **not**
/// `Clone` — see [the module model](crate::modules) for why every copy names which of the two it
/// wants.
#[derive(Debug)]
pub struct MemoriesRuntime {
    /// Whether the memories capability is enabled for this run.
    enabled: bool,
    /// The shared, mutable store — the same handle the tools mutate, and, under a linking
    /// [scope](MemoryScope), the same one other agents hold.
    store: Arc<Mutex<MemoryStore>>,
    /// The [identity](crate::modules::ModuleIdMint) of that store. It travels with the store, never
    /// with the holder: two agents linked to one notebook report one id, which is the only thing in
    /// the record that distinguishes them from two agents whose notes happen to agree.
    id: Arc<str>,
    /// The mint a copy of this notebook takes its id from — see [`ModuleIds`].
    ids: ModuleIds,
    /// How this holder came by the store.
    origin: GgModuleOrigin,
    /// This holder's watermarks into the store's log. Behind an `Arc` so an [alias](Self::alias) —
    /// the same holder, temporarily servicing a program on the sandbox's blocking thread —
    /// advances the very same ones, and a write is not reported twice because the loop and the
    /// program disagreed about how far they had looked.
    cursors: Arc<Mutex<HolderCursors>>,
    /// The id of the agent instance holding this. Recorded against every mutation made through
    /// this holder's [binding](Self::binding), and compared against a log entry's author to
    /// decide whether the entry is this holder's news to report or somebody else's news to be
    /// told about.
    agent_id: String,
    /// Which instance this holder bound, and so whether it may be linked to others at all.
    scope: MemoryScope,
    /// Whether this holder may write.
    access: MemoryAccess,
    /// Whether this store may be held by more than one agent — see [`is_linked`](Self::is_linked)
    /// for why it is a property of the *run's* configuration rather than of how many holders the
    /// store happens to have when the prompt is rendered.
    linked: bool,
    /// The [program language](GgProgramLanguage) the holder writes its programs in, or `None` when
    /// it calls tools instead — which is what the memory calls are *named* as in the notice this
    /// holder is given. A property of the holder, so it is re-resolved whenever a different agent
    /// takes the store over.
    program_language: Option<GgProgramLanguage>,
}

impl MemoriesRuntime {
    /// An enabled runtime with an empty store organized by `strategy` and bounded by `caps`,
    /// identified out of a [detached](detached_ids) sequence — the by-hand constructor, which in
    /// practice means the tests. A run's notebooks are built through [`Self::resolve`].
    pub fn new(strategy: MemoryStrategy, caps: MemoryCaps) -> Self {
        Self::fresh(strategy, caps, &detached_ids())
    }

    /// An enabled runtime with an empty store organized by `strategy` and bounded by `caps`,
    /// identified out of the run's [mint](ModuleIds) — a genuinely new notebook, held by this
    /// agent alone until it shares or forks it.
    fn fresh(strategy: MemoryStrategy, caps: MemoryCaps, ids: &ModuleIds) -> Self {
        Self::over(
            Arc::new(Mutex::new(MemoryStore::new(strategy, caps))),
            ids.next(ModuleKind::Memories),
            ids,
            false,
        )
    }

    /// An enabled runtime over `store`, which is identified by `id`. When `current` the holder's
    /// watermarks start at the store's head — a new holder of an existing store is not told about,
    /// and does not report, history it never missed — and otherwise at the beginning, which is what
    /// a holder that created the store wants.
    ///
    /// The id is taken rather than minted because this is the constructor a *second* holder goes
    /// through: a share, an inheritance, a profile-scoped bind. Handing it in is what makes "same
    /// store, same id" a property of the call rather than of everybody remembering.
    ///
    /// This is the one constructor every holder goes through, which is why it is also where a
    /// holder's watermarks are [registered](MemoryStore::register_holder) with the store: from
    /// here on the store knows what it still owes somebody, and can forget the rest.
    fn over(store: Arc<Mutex<MemoryStore>>, id: Arc<str>, ids: &ModuleIds, current: bool) -> Self {
        let cursors = Arc::new(Mutex::new(HolderCursors::default()));
        {
            let mut guard = store.lock().expect("memory store lock");
            if current {
                let head = guard.log_len();
                *cursors.lock().expect("memory cursors lock") = HolderCursors {
                    telemetry: head,
                    notice: head,
                };
            }
            guard.register_holder(&cursors);
        }
        Self {
            enabled: true,
            store,
            id,
            ids: Arc::clone(ids),
            origin: GgModuleOrigin::Created,
            cursors,
            agent_id: String::new(),
            // The binding a holder has before one is given to it: a notebook of its own, held by
            // nobody else. Every path through `resolve` closes with `with_binding`, which states
            // the scope the profile actually wrote.
            scope: MemoryScope::Isolated,
            access: MemoryAccess::ReadWrite,
            linked: false,
            program_language: None,
        }
    }

    /// A disabled runtime — **there are no memories at all**: no tools, no prompt text, no context
    /// block, no telemetry.
    ///
    /// This is what a profile whose memories capability is absent or off resolves to, and it is the
    /// value that says so rather than an arm of the capability. The store behind it is
    /// [unbounded](MemoryCaps::UNBOUNDED) and never written: there is no call that could reach it,
    /// so its organization and its bounds describe nothing and are read by nobody.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ..Self::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED)
        }
    }

    /// Build the memories module `profile` configures for the agent instance `ctx` describes.
    ///
    /// Two questions are answered here, and they are independent. **What** the memories are —
    /// the [strategy](MemoryStrategy) the capability's `implementation` selects and the
    /// [limits](MemoryCaps::resolve) its params resolve — and **whose** they are, which is the
    /// [`scope`](test_cabinet_core::gg::MEMORY_PARAM_SCOPE):
    ///
    /// * [`isolated`](MemoryScope::Isolated) — a fresh store, held by this instance alone;
    /// * [`shared`](MemoryScope::Shared) — the [registry](MemoryRegistry) entry for this
    ///   *profile*, so every instance of it in the run is a holder of one store;
    /// * [`inherited`](MemoryScope::Inherited) / [`read-only`](MemoryScope::ReadOnly) — the
    ///   spawner's instance when this agent was spawned as a subagent and its spawner organizes
    ///   memories the same way, and otherwise a fresh one.
    ///
    /// A holder that ends up with a fresh instance under `read-only` may **write** it: the scope
    /// restricts an inherited handle, and only an inherited handle.
    ///
    /// A profile whose memories capability is **absent or off** has no memories at all, and gets a
    /// [disabled](Self::disabled) module — the value that says so, never an arm of the capability
    /// resolved out of nothing.
    pub fn resolve(profile: &GgAgentConfig, ctx: &ModuleResolveCtx<'_>) -> Self {
        let Some(capability) = profile
            .capability(CAPABILITY_MEMORIES)
            .filter(|capability| capability.enabled)
        else {
            return Self::disabled();
        };
        // Every value below was read — and, where it could not be honoured, refused — by
        // [`check_launch`] before the first turn, so this re-resolution reports into a discarding
        // sink: anything arriving in it would mean gg read one document two different ways.
        let report = &mut LaunchReport::Discarding;
        let strategy = MemoryStrategy::resolve(capability.implementation.as_deref(), report);
        let caps = MemoryCaps::resolve(strategy, capability, report);
        let scope = resolve_scope(profile, report);

        // The [origin](GgModuleOrigin) is the *resolved* answer to the question the scope asks, and
        // the two can disagree: an `inherited` profile with no spawner to inherit from falls back
        // to a private notebook, which nothing else in the record says.
        let (mut bound, access, origin) = match scope {
            MemoryScope::Isolated => (
                Self::fresh(strategy, caps, ctx.ids),
                MemoryAccess::ReadWrite,
                GgModuleOrigin::Created,
            ),
            MemoryScope::Shared => {
                let (store, id) = ctx.memories.bind(&profile.id, strategy, caps, ctx.ids);
                (
                    Self::over(store, id, ctx.ids, true),
                    MemoryAccess::ReadWrite,
                    GgModuleOrigin::Profile,
                )
            }
            MemoryScope::Inherited | MemoryScope::ReadOnly => {
                // An inheriting profile is offered its spawner's store when the spawner organizes
                // it the way this profile says its memories are organized. The launch pass refuses
                // every naming pair the roster shows, so a mismatch reaching here is the run's own
                // defect and is reported as one.
                match ctx.inherited.memories_organized_as(strategy) {
                    Some(parent) => (
                        parent.shared(),
                        if scope == MemoryScope::ReadOnly {
                            MemoryAccess::ReadOnly
                        } else {
                            MemoryAccess::ReadWrite
                        },
                        GgModuleOrigin::Inherited,
                    ),
                    // No spawner to inherit from (the root, an issue's implementer, a reviewer),
                    // or one whose memories are organized differently: a private notebook, which
                    // its holder may write whatever the scope said, organized the way this
                    // profile's own `implementation` says. Every enabled memories capability names
                    // one, so the notebook gg keeps here is the one this document described.
                    None => (
                        Self::fresh(strategy, caps, ctx.ids),
                        MemoryAccess::ReadWrite,
                        GgModuleOrigin::Created,
                    ),
                }
            }
        };
        bound.program_language = ctx.history.program_language;
        bound.origin = origin;
        bound.linked = links(profile, scope, ctx);
        bound.with_binding(scope, access).with_agent(ctx.agent_id)
    }

    /// This runtime held by the agent named `agent_id` — whose writes are recorded against it, and
    /// who is therefore never told about them again.
    pub fn with_agent(mut self, agent_id: impl Into<String>) -> Self {
        self.agent_id = agent_id.into();
        self
    }

    /// This runtime bound under `scope`, with `access` deciding whether its holder may write.
    ///
    /// The two travel together because they are one decision made in two halves: the scope says
    /// which instance was bound, and the access says what this particular holder may do with it.
    pub fn with_binding(mut self, scope: MemoryScope, access: MemoryAccess) -> Self {
        self.scope = scope;
        self.access = access;
        self
    }

    /// Whether the capability offers memory tools this run (simply whether it is enabled —
    /// unlike skills, memories need no pre-existing library; the model creates them).
    pub fn offers_memories(&self) -> bool {
        self.enabled
    }

    /// The [scope](MemoryScope) this holder bound under.
    pub fn scope(&self) -> MemoryScope {
        self.scope
    }

    /// Whether this holder may write. `true` for every holder but a
    /// [read-only](MemoryScope::ReadOnly) inherited handle — including a **disabled** one, whose
    /// answer is never read but must not read as a restriction the run did not ask for.
    pub fn is_writable(&self) -> bool {
        self.access.is_writable()
    }

    /// Whether **this holder's own binding** links it to other agents — the question a
    /// [fork](crate::modules::fork_modules) asks, because a copy of an agent whose memories are
    /// shared keeps sharing them while a copy of an [isolated](MemoryScope::Isolated) notebook
    /// diverges.
    ///
    /// It is a property of the scope alone, and deliberately narrower than
    /// [`is_linked`](Self::is_linked): an isolated holder is never linked *by its own binding*,
    /// however many of the agents it spawns go on to inherit its store.
    pub fn is_linkable(&self) -> bool {
        self.enabled && self.scope.may_link()
    }

    /// Whether this store may end up held by more than one agent at all — what the holder's
    /// **prompt** is told, so a mid-thread "another agent added a memory"
    /// [notice](Self::notice) is a message it was warned to expect rather than an unexplained
    /// interruption.
    ///
    /// Wider than [`is_linkable`](Self::is_linkable) because inheritance is an offer the *spawner*
    /// makes whatever its own scope is: an agent whose memories are `isolated` still hands them to
    /// a child scoped [`inherited`](MemoryScope::Inherited), and it is that child's write the
    /// parent is then told about. The answer therefore folds in one run-level fact — whether any
    /// profile this run declares inherits memories at all — resolved once at launch, because the
    /// prompt is rendered before the first child is spawned and must not change afterwards.
    pub fn is_linked(&self) -> bool {
        self.enabled && (self.scope.may_link() || self.linked)
    }

    /// An **independent** notebook holding a copy of everything this one holds: a new store, the
    /// memories and their revision history deep-copied, and the two holders diverging from here.
    /// Carrying the revision numbers is what stops a re-created slug from restarting its history
    /// in the copy.
    ///
    /// The copy's watermarks start at the copied log's head, so it neither re-reports the
    /// original's writes as telemetry nor announces them to its model as news: the history came
    /// with the notebook, and it was never missed.
    pub fn forked(&self) -> Self {
        let mut copy = self.store.lock().expect("memory store lock").clone();
        // The copy is nobody's yet: the holders it inherited from the clone are the *original's*,
        // and leaving them registered would let this store prune entries against watermarks that
        // were never read from it.
        copy.holders.clear();
        Self {
            enabled: self.enabled,
            linked: self.linked,
            // A new store, so a new id: from here the two notebooks are two, however alike they
            // look on the turn the copy was taken.
            ..Self::over(
                Arc::new(Mutex::new(copy)),
                self.ids.next(ModuleKind::Memories),
                &self.ids,
                true,
            )
        }
        .with_agent(self.agent_id.clone())
        .with_binding(self.scope, self.access)
    }

    /// A **linked** handle onto the same notebook, held by a *different* agent: what one holder
    /// writes, every other holder of it reads — and is told about, on its next turn. The basis of
    /// [shared memory](https://docs.testcabinet.ai/gg/memories/) between agents.
    ///
    /// The new holder's watermarks start at the store's current head, so it is not handed a
    /// backlog of everything that happened before it existed.
    pub fn shared(&self) -> Self {
        Self {
            enabled: self.enabled,
            linked: self.linked,
            // The same store, so the same id: that identity is the whole of what makes two holders
            // legible as two holders rather than as a coincidence.
            ..Self::over(
                Arc::clone(&self.store),
                Arc::clone(&self.id),
                &self.ids,
                true,
            )
        }
        .with_agent(self.agent_id.clone())
        .with_binding(self.scope, self.access)
    }

    /// **The same holder**, reachable from somewhere else — not a second one.
    ///
    /// The [responses-as-code](crate::sandbox) path moves the agent's per-turn state onto a
    /// blocking thread and services the program's calls there, which needs a handle it can own.
    /// That handle must be the *same* holder as the loop's: it shares the store, the agent id, the
    /// access **and the watermarks**, so a memory the program wrote is streamed once rather than
    /// once by the program and again by the loop that reclaimed the state afterwards.
    pub fn alias(&self) -> Self {
        Self {
            enabled: self.enabled,
            store: Arc::clone(&self.store),
            id: Arc::clone(&self.id),
            ids: Arc::clone(&self.ids),
            origin: self.origin,
            cursors: Arc::clone(&self.cursors),
            agent_id: self.agent_id.clone(),
            scope: self.scope,
            access: self.access,
            linked: self.linked,
            program_language: self.program_language,
        }
    }

    /// The shared store itself, for the reads that do not go through a holder.
    ///
    /// Everything in the running loop reaches the store through a [binding](Self::binding) or
    /// through this type's own derivations, precisely so a mutation is always attributed; this is
    /// the raw handle the tests drive a store with, where there is no agent to attribute anything
    /// to.
    #[allow(dead_code)]
    pub fn store(&self) -> Arc<Mutex<MemoryStore>> {
        Arc::clone(&self.store)
    }

    /// This holder's [binding](MemoryBinding) onto the store — what the memory tools take, so
    /// every mutation they make is recorded against the agent that made it.
    pub fn binding(&self) -> MemoryBinding {
        MemoryBinding::new(Arc::clone(&self.store), &self.agent_id)
    }

    /// The strategy this run's memories are organized by. [`Scratchpad`](MemoryStrategy::Scratchpad)
    /// when the capability is off, which nothing reads — a disabled runtime offers no tools.
    pub fn strategy(&self) -> MemoryStrategy {
        self.store.lock().expect("memory store lock").strategy()
    }

    /// The limits this run enforces.
    pub fn caps(&self) -> MemoryCaps {
        self.store.lock().expect("memory store lock").caps()
    }

    /// The number of in-play memories — reported as the memories figure of a
    /// [compaction](https://docs.testcabinet.ai/gg/compaction/) boundary's retention proof.
    /// Zero when the capability is off (the store is empty).
    pub fn count(&self) -> usize {
        self.store.lock().expect("memory store lock").count()
    }

    /// The [`MemoryState`](GgTelemetryKind::MemoryState) telemetry for the current store as *this
    /// holder* sees it, or `None` when the capability is off. Emitted at session start (empty,
    /// with the limits) and after every successful mutation.
    ///
    /// It carries the holder's [scope](MemoryScope) and whether it may write, so the console can
    /// tell two agents showing one shared store from two agents that happen to hold the same
    /// notes — a distinction a snapshot alone cannot make.
    pub fn state_event(&self) -> Option<GgTelemetryKind> {
        if !self.enabled {
            return None;
        }
        Some(self.store.lock().expect("memory store lock").state_event(
            &self.id,
            self.scope,
            self.access.is_writable(),
        ))
    }

    /// The [`MemoryRevision`](GgTelemetryKind::MemoryRevision) telemetry **this holder** owes its
    /// stream: every entry appended to the store's log since this holder last looked that *this
    /// holder authored*, oldest first. Empty when the capability is off, when nothing has changed,
    /// or when everything that changed was somebody else's work.
    ///
    /// Filtering by author is what makes a shared store correct rather than merely shared: a write
    /// is one event, on the stream of the agent that made it, however many agents hold the store
    /// it landed in. What the *other* holders get instead is a [notice](Self::notice).
    ///
    /// One drain can yield several events: a [responses-as-code](crate::sandbox) program makes as
    /// many memory calls as it likes before the loop next looks, and each of them is a revision in
    /// its own right.
    pub fn revision_events(&self) -> Vec<GgTelemetryKind> {
        self.drain_revisions().0
    }

    /// This holder's undrained revisions, and whether the store's log moved at all since it last
    /// looked. The flag is what decides whether a state snapshot is worth re-emitting: a turn in
    /// which a *sibling* wrote changes what this holder's panel should show even though this
    /// holder authored none of it.
    fn drain_revisions(&self) -> (Vec<GgTelemetryKind>, bool) {
        if !self.enabled {
            return (Vec::new(), false);
        }
        let store = self.store.lock().expect("memory store lock");
        let mut cursors = self.cursors.lock().expect("memory cursors lock");
        let head = store.log_len();
        if cursors.telemetry >= head {
            return (Vec::new(), false);
        }
        let events = store
            .log_from(cursors.telemetry)
            .iter()
            .filter(|entry| entry.author == self.agent_id)
            .map(|entry| entry.revision.to_event())
            .collect();
        cursors.telemetry = head;
        (events, true)
    }

    /// The pinned context block for the current store, or `None` when the capability is off, the
    /// [strategy](MemoryStore::context_block) pins nothing, or there is nothing yet to show. The
    /// loop keeps this as the single [`Memory`](test_cabinet_core::gg::GgContextSource::Memory)-sourced
    /// item in the window.
    ///
    /// # It is refreshed at a compaction boundary, and only there
    ///
    /// A memory the model just wrote is already in front of it — the call it made and the
    /// confirmation it got back are both in the thread — so re-sending the whole block the turn
    /// after a write tells it nothing it does not know, and costs a fresh copy of every memory
    /// (or of the whole index) each time it curates. Between boundaries the block is therefore
    /// left exactly as it is, and the thread carries the news.
    ///
    /// What the thread cannot carry is a [compaction](crate::compaction), which drops the very
    /// tool results the block was leaning on. So the loop rebuilds it there, immediately before
    /// the window is rewritten: the stale copy is superseded into the ephemeral history the
    /// boundary is about to sweep away, and the fresh one crosses as part of the pinned prefix.
    /// That is the only point at which the model could otherwise lose track of what it holds,
    /// and it is the point the retention contract is about.
    ///
    /// **A linked write does not move it.** When another holder writes, this holder is told in a
    /// [notice](Self::notice) appended at the tail of its window; the block itself is left exactly
    /// where it is. That is the requirement, and it is also what keeps the cached prompt prefix
    /// intact: a block that moved every time a sibling wrote would supersede-and-append on turns
    /// this agent did nothing at all.
    pub fn context_block(&self) -> Option<Message> {
        if !self.enabled {
            return None;
        }
        self.store
            .lock()
            .expect("memory store lock")
            .context_block()
    }

    /// The **linked-memory notice** this holder owes its model: what other holders of its store
    /// have done since it was last told, as one ephemeral message appended at the tail of its
    /// window.
    ///
    /// `None` — the overwhelmingly common answer — when the capability is off, or when nothing but
    /// this holder's own writes have landed since it last looked.
    ///
    /// # Why a tail append
    ///
    /// The requirement is that a linked write is *noticed*, and the constraint is that the
    /// [index](Self::context_block) must not change shape — both because the index is what the
    /// model reasons about and because a rebuilt index would rewrite the pinned prefix every
    /// provider caches. Appending at the tail satisfies both: the whole previous request is still
    /// a byte-identical prefix of this one, so the cache breakpoints still hit, and the notice
    /// costs its own tokens once. A run in which nothing is linked never produces one at all.
    ///
    /// # Delivered exactly once
    ///
    /// Producing a notice advances this holder's notice watermark to the store's head, so the same
    /// news is never delivered twice — and a holder's *own* writes never produce one, because they
    /// are already in its thread as a call and the confirmation that answered it.
    ///
    /// The watermark is **not** rewound by a [compaction](crate::compaction): a notice is
    /// ephemeral, so a boundary sweeps it, but the boundary rebuilds the pinned block first, so
    /// everything the notice announced crosses in the block (or, under
    /// [keyword-search](MemoryStrategy::KeywordSearch), stays findable by search). Re-announcing
    /// it would be telling the model twice about a memory it has already been told about once and
    /// may well have read.
    pub fn notice(&mut self) -> Option<Message> {
        if !self.enabled {
            return None;
        }
        let store = self.store.lock().expect("memory store lock");
        let mut cursors = self.cursors.lock().expect("memory cursors lock");
        let head = store.log_len();
        if cursors.notice >= head {
            return None;
        }
        let fresh = store.log_from(cursors.notice);
        cursors.notice = head;
        let strategy = store.strategy();
        let entries = notice_entries(fresh, &self.agent_id, strategy);
        if entries.is_empty() {
            return None;
        }
        let calls = strategy.calls(self.program_language.map(crate::sandbox::language));
        Some(Message::user(prompts::render_memory_notice(
            &MemoryNoticeContext {
                entries,
                // The scratchpad has no read call: its memories *are* the pinned block, so the
                // notice carries the bodies rather than pointing at a call the model does not have.
                read_call: strategy.is_file_shaped().then(|| calls.read.to_string()),
                inline_bodies: !strategy.is_file_shaped(),
                indexed: strategy.has_index(),
            },
        )))
    }
}

impl Module for MemoriesRuntime {
    fn kind(&self) -> ModuleKind {
        ModuleKind::Memories
    }

    fn instance_id(&self) -> &str {
        &self.id
    }

    fn origin(&self) -> GgModuleOrigin {
        self.origin
    }

    fn set_origin(&mut self, origin: GgModuleOrigin) {
        self.origin = origin;
    }

    fn memory_scope(&self) -> Option<MemoryScope> {
        Some(self.scope)
    }

    fn writable(&self) -> bool {
        self.access.is_writable()
    }

    fn enabled(&self) -> bool {
        self.enabled
    }

    /// Always [owned](Ownership::Owned). What a strategy puts in the window — every body, the
    /// index, or nothing — *is* what having memories means under it, so there is no coherent arm in
    /// which an agent holds memories and is told nothing about them; the strategy is the knob, and
    /// [keyword-search](MemoryStrategy::KeywordSearch) is the arm that pins nothing.
    fn ownership(&self) -> Ownership {
        Ownership::Owned
    }

    fn context_source(&self) -> Option<GgContextSource> {
        Some(GgContextSource::Memory)
    }

    fn refresh(&self) -> Refresh {
        Refresh::AtBoundary
    }

    fn context_block(&self) -> Option<Message> {
        MemoriesRuntime::context_block(self)
    }

    fn notice(&mut self) -> Option<Message> {
        MemoriesRuntime::notice(self)
    }

    fn state_events(&self) -> Vec<GgTelemetryKind> {
        self.state_event().into_iter().collect()
    }

    fn drain_events(&mut self) -> Vec<GgTelemetryKind> {
        // The revisions first — the append-only record of what this holder did, which for a
        // deletion is the only place it is recorded at all — then the snapshot the store is left
        // in. A drain that found nothing says nothing: re-emitting the snapshot on a turn where
        // the store did not move would tell the console what it already knows. A turn in which a
        // *sibling* wrote does move it, and re-emits the snapshot with no revisions of its own,
        // which is exactly right: this holder's panel changed, but the write was not its work.
        let (mut events, moved) = self.drain_revisions();
        if !moved {
            return events;
        }
        events.extend(self.state_event());
        events
    }

    fn retained(&self) -> u64 {
        self.count() as u64
    }

    fn fork(&self) -> ModuleHandle {
        ModuleHandle::Memories(self.forked())
    }

    fn share(&self) -> ModuleHandle {
        ModuleHandle::Memories(self.shared())
    }

    /// Whether the forker's own [binding](Self::is_linkable) links it. Two agents meant to curate
    /// one notebook do not stop meaning it because one of them was copied; an
    /// [isolated](MemoryScope::Isolated) notebook is copied, and the two diverge from there.
    fn links_when_forked(&self) -> bool {
        self.is_linkable()
    }

    /// Re-resolve the holder-owned configuration from the receiving profile — its limits, its
    /// [scope](MemoryScope) and the write access that follows from it, the agent
    /// holding it, and the execution mode its notices are named in — refusing a profile that does
    /// not enable memories at all, or that organizes them by a **different**
    /// [strategy](MemoryStrategy).
    ///
    /// The strategy is the one thing that cannot be re-resolved: it decides both what the store
    /// means (bodies pinned in the window, an index over files, or nothing pinned at all) and which
    /// tools read it. Converting a scratchpad into a markdown index would silently change both, so
    /// gg refuses, the caller starts the successor with a fresh store, and the successor is told
    /// why rather than left to discover an empty notebook.
    ///
    /// A successor whose own scope is [`shared`](MemoryScope::Shared) does not adopt the store it
    /// was handed at all: `shared` means *bound to the profile*, so it re-binds the
    /// [registry](MemoryRegistry) entry for the profile it is about to run under. Otherwise one
    /// profile could be curating two different notebooks at once — the one its predecessor handed
    /// it, and the one every other instance of it resolved — which is the exact situation the scope
    /// exists to prevent.
    ///
    /// The limits are re-pointed **only when this holder is the store's sole holder**. A store
    /// several agents are curating together has one set of limits by construction; re-pointing
    /// them because one of its holders was replaced would silently change what the *others* may
    /// write.
    ///
    /// Finally, both [watermarks](HolderCursors) are re-pointed at the store's head. The successor
    /// is a *new* holder under a new agent id: without this it would inherit its predecessor's
    /// unread news and, since a notice is anything the holder did not author itself, be told that
    /// "another agent" had written the memories it wrote one turn earlier under its old name.
    fn adopt(
        &mut self,
        profile: &GgAgentConfig,
        ctx: &ModuleResolveCtx<'_>,
    ) -> Result<(), AdoptError> {
        let Some(capability) = profile
            .capability(CAPABILITY_MEMORIES)
            .filter(|capability| capability.enabled)
        else {
            // The successor keeps no memories at all, so there is no notebook for it to take over.
            return Err(AdoptError::Disabled);
        };
        // Re-resolved for the adopting profile, against a discarding sink: the launch pass proved
        // this same document honourable before the run began.
        let report = &mut LaunchReport::Discarding;
        let strategy = MemoryStrategy::resolve(capability.implementation.as_deref(), report);
        let held = self.strategy();
        if strategy != held {
            return Err(AdoptError::Incompatible(format!(
                "your memories were organized as `{}` and this agent organizes them as `{}`, \
                 which reads them with different calls; they were not carried over and you are \
                 starting with an empty set.",
                held.id(),
                strategy.id()
            )));
        }
        let caps = MemoryCaps::resolve(strategy, capability, report);
        let scope = resolve_scope(profile, report);
        // A `shared`-scoped successor is bound to its **own** profile's registry entry, which is
        // very often a different store than the one it was handed — so the id moves with it, and
        // the transition reports two ids rather than pretending the notebook travelled.
        self.origin = if scope == MemoryScope::Shared {
            let (store, id) = ctx.memories.bind(&profile.id, strategy, caps, ctx.ids);
            self.store = store;
            self.id = id;
            GgModuleOrigin::Profile
        } else {
            GgModuleOrigin::Transferred
        };
        self.ids = Arc::clone(ctx.ids);
        if self.store.lock().expect("memory store lock").holders() <= 1 {
            self.store.lock().expect("memory store lock").set_caps(caps);
        }
        // A new holder of whatever store it ended up with: registered with it, and current with it.
        self.cursors = Arc::new(Mutex::new(HolderCursors::default()));
        {
            let mut store = self.store.lock().expect("memory store lock");
            let head = store.log_len();
            *self.cursors.lock().expect("memory cursors lock") = HolderCursors {
                telemetry: head,
                notice: head,
            };
            store.register_holder(&self.cursors);
        }
        self.enabled = true;
        self.scope = scope;
        self.access = match scope {
            // A successor that asks for read-only memories and receives a live store is exactly
            // the inherited case the scope restricts; every other scope hands its holder the pen.
            MemoryScope::ReadOnly => MemoryAccess::ReadOnly,
            _ => MemoryAccess::ReadWrite,
        };
        self.linked = links(profile, scope, ctx);
        self.agent_id = ctx.agent_id.to_string();
        self.program_language = ctx.history.program_language;
        Ok(())
    }
}

#[cfg(test)]
#[path = "memories.test.rs"]
mod tests;

#[cfg(test)]
#[path = "memories.files.test.rs"]
mod files_tests;

#[cfg(test)]
#[path = "memories.record.test.rs"]
mod record_tests;

#[cfg(test)]
#[path = "memories.scope.test.rs"]
mod scope_tests;
