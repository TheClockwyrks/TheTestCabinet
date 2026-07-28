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
//! and each is individually configurable (and individually disableable) through the capability's
//! params. When a mutation would exceed a limit, the store **rejects it with a [`MemoryError`]**
//! whose message tells the model how to proceed — revise, evict, or delete — rather than silently
//! truncating or dropping content.
//!
//! # Shapes
//!
//! - [`Memory`] — one curated note (slug, description, body).
//! - [`MemoryStrategy`] — which of the three shapes a run uses.
//! - [`MemoryCaps`] — the limits, [resolved](MemoryCaps::resolve) per strategy from the
//!   capability's params with documented defaults.
//! - [`MemoryStore`] — the mutable, limit-enforcing set of memories, shared (`Arc<Mutex>`) between
//!   the loop and the memory tools.
//! - [`MemoriesRuntime`] — the loop's live view: whether the capability is on, the shared store,
//!   and the derivations the loop needs (the strategy and limits the system prompt states, the
//!   [`MemoryState`](test_cabinet_core::gg::GgTelemetryKind::MemoryState) telemetry, and the pinned
//!   context block, if the strategy has one).
//!
//! The capability is **ablatable**: when it is off the loop builds a
//! [`disabled`](MemoriesRuntime::disabled) runtime, so there are no memory tools, no prompt text,
//! no context block, and no telemetry — the feature vanishes.

use std::fmt;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use test_cabinet_core::gg::{
    GgMemoryCaps, GgMemoryEntry, GgTelemetryKind, MEMORY_STRATEGY_KEYWORD_SEARCH,
    MEMORY_STRATEGY_MARKDOWN, MEMORY_STRATEGY_SCRATCHPAD,
};

use crate::model::Message;
use crate::prompts::{self, MemoriesBlockContext, MemoryIndexContext, MemoryItemView};

#[path = "memories.search.rs"]
mod search;

pub use search::MemoryHit;

/// Default [maximum number of memories](MemoryCaps::max_count) under the
/// [scratchpad](MemoryStrategy::Scratchpad) strategy. A small ceiling — the point is a curated
/// handful of durable facts, not a second transcript.
pub const DEFAULT_MAX_COUNT: usize = 8;

/// Default [per-memory body length](MemoryCaps::max_len_per_memory) under the
/// [scratchpad](MemoryStrategy::Scratchpad) strategy, in characters — roughly a few short
/// paragraphs, enough for a decision or a fact with its rationale.
pub const DEFAULT_MAX_LEN_PER_MEMORY: usize = 2_000;

/// Default [aggregate body length](MemoryCaps::max_total_len) under the
/// [scratchpad](MemoryStrategy::Scratchpad) strategy, in characters, across every memory — a firm
/// ceiling on how much of the window self-curated notes may occupy.
pub const DEFAULT_MAX_TOTAL_LEN: usize = 8_000;

/// Default [per-file length](MemoryCaps::max_len_per_memory) under the two file-shaped strategies,
/// in characters. Far larger than the scratchpad's, because these bodies are **not** in the window
/// — they cost context only on the turn the model reads one.
pub const DEFAULT_MAX_LEN_PER_FILE: usize = 8_192;

/// Default [index length](MemoryCaps::max_len_index) under the
/// [markdown](MemoryStrategy::Markdown) strategy, in characters. The index *is* pinned, so this is
/// the real budget: at a typical entry it holds on the order of a couple of hundred memories.
pub const DEFAULT_MAX_LEN_INDEX: usize = 16_384;

/// Default [result count](MemoryCaps::max_results) for one
/// [`search_memories`](MemoryStore::search) call under the
/// [keyword-search](MemoryStrategy::KeywordSearch) strategy.
pub const DEFAULT_MAX_RESULTS: usize = 25;

/// The memories capability param naming the [maximum count](MemoryCaps::max_count).
const PARAM_MAX_COUNT: &str = "maxCount";
/// The memories capability param naming the [per-memory limit](MemoryCaps::max_len_per_memory).
const PARAM_MAX_LEN_PER_MEMORY: &str = "maxLenPerMemory";
/// The memories capability param naming the [aggregate limit](MemoryCaps::max_total_len).
const PARAM_MAX_TOTAL_LEN: &str = "maxTotalLen";
/// The memories capability param naming the [index limit](MemoryCaps::max_len_index).
const PARAM_MAX_LEN_INDEX: &str = "maxLenIndex";
/// The memories capability param naming the [search page size](MemoryCaps::max_results).
const PARAM_MAX_RESULTS: &str = "maxResults";

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
/// A run naming a strategy gg does not recognize resolves to [`Scratchpad`](Self::Scratchpad)
/// rather than failing to launch, so a sweep may name a strategy a later gg will add.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MemoryStrategy {
    /// Every memory's body is pinned in the window and crosses a compaction boundary verbatim.
    /// Offers `write_memory`, `update_memory` and `delete_memory`. The default.
    #[default]
    Scratchpad,
    /// A pinned index of `slug` — `description` lines over bodies the model reads on demand.
    /// Offers `create_memory`, `read_memory`, `edit_memory` and `delete_memory`.
    Markdown,
    /// No index and nothing pinned: memories are found by keyword search. Offers `create_memory`,
    /// `read_memory`, `edit_memory`, `delete_memory` and `search_memories`.
    KeywordSearch,
}

impl MemoryStrategy {
    /// The strategy an [implementation](test_cabinet_core::gg::GgCapabilityConfig::implementation)
    /// names: `markdown` or `keyword-search`, with everything else — absent, empty, or a name gg
    /// does not know — resolving to the default [`Scratchpad`](Self::Scratchpad).
    pub fn resolve(implementation: Option<&str>) -> Self {
        match implementation.map(str::trim) {
            Some(MEMORY_STRATEGY_MARKDOWN) => Self::Markdown,
            Some(MEMORY_STRATEGY_KEYWORD_SEARCH) => Self::KeywordSearch,
            _ => Self::Scratchpad,
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

    /// The names this strategy's calls go by in one execution mode — how gg must **name a memory
    /// call back to the model** in prose.
    ///
    /// Every strategy offers a different set of tools, and under
    /// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) each is a method on
    /// an API object rather than a tool name. Any prompt that tells a model to record something —
    /// the [memory compaction](crate::compaction::CompactionStrategy::Memory) instruction, and the
    /// refusal that answers a call made while one is pending — has to name the calls that run
    /// actually has, so they are derived here once instead of being spelled out at each site.
    pub fn calls(self, code_mode: bool) -> MemoryCalls {
        match (self, code_mode) {
            (Self::Scratchpad, false) => MemoryCalls {
                create: "`write_memory`",
                revise: "`update_memory`",
                delete: "`delete_memory`",
            },
            (Self::Scratchpad, true) => MemoryCalls {
                create: "`memory.writeMemory`",
                revise: "`memory.updateMemory`",
                delete: "`memory.deleteMemory`",
            },
            (_, false) => MemoryCalls {
                create: "`create_memory`",
                revise: "`edit_memory`",
                delete: "`delete_memory`",
            },
            (_, true) => MemoryCalls {
                create: "`memory.createMemory`",
                revise: "`memory.editMemory`",
                delete: "`memory.deleteMemory`",
            },
        }
    }
}

/// What one [strategy](MemoryStrategy::calls)'s calls are called, in one execution mode, already
/// wrapped in the backticks every prompt renders them with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryCalls {
    /// The call that records a new memory.
    pub create: &'static str,
    /// The call that revises an existing one.
    pub revise: &'static str,
    /// The call that removes one.
    pub delete: &'static str,
}

/// The bounds gg keeps the model's [memories](MemoryStore) within, so self-curated notes cannot
/// crowd out the working context.
///
/// [Resolved](Self::resolve) per [strategy](MemoryStrategy) from the memories capability's params.
/// Every limit is an `Option`: `None` is **unlimited**, which a run asks for by setting the param
/// to `0`, and is also what a limit the strategy does not use always is. Lengths are in characters.
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
    /// The most memories one [search](MemoryStore::search) reports (`maxResults`), and `None`
    /// everywhere the strategy offers no search.
    pub max_results: Option<usize>,
}

impl Default for MemoryCaps {
    fn default() -> Self {
        Self::for_strategy(MemoryStrategy::default())
    }
}

impl MemoryCaps {
    /// The documented defaults for `strategy`, before any param overrides.
    pub fn for_strategy(strategy: MemoryStrategy) -> Self {
        match strategy {
            MemoryStrategy::Scratchpad => Self {
                max_count: Some(DEFAULT_MAX_COUNT),
                max_len_per_memory: Some(DEFAULT_MAX_LEN_PER_MEMORY),
                max_total_len: Some(DEFAULT_MAX_TOTAL_LEN),
                max_len_index: None,
                max_results: None,
            },
            MemoryStrategy::Markdown => Self {
                // The index bounds the population: every memory must have a line in it.
                max_count: None,
                max_len_per_memory: Some(DEFAULT_MAX_LEN_PER_FILE),
                max_total_len: None,
                max_len_index: Some(DEFAULT_MAX_LEN_INDEX),
                max_results: None,
            },
            MemoryStrategy::KeywordSearch => Self {
                // Unlimited by default — a run that wants a ceiling sets `maxCount`.
                max_count: None,
                max_len_per_memory: Some(DEFAULT_MAX_LEN_PER_FILE),
                max_total_len: None,
                max_len_index: None,
                max_results: Some(DEFAULT_MAX_RESULTS),
            },
        }
    }

    /// Resolve the limits `strategy` uses from a memories-capability `params` object.
    ///
    /// Each param overrides its default when present as a non-negative integer, with **`0`
    /// meaning unlimited**; a missing or non-integer value keeps the default. A param a strategy
    /// does not use is ignored rather than rejected, so one sweep can hand every arm the same
    /// params block.
    pub fn resolve(strategy: MemoryStrategy, params: &Value) -> Self {
        let default = Self::for_strategy(strategy);
        Self {
            max_count: default.max_count.resolve_limit(
                params,
                PARAM_MAX_COUNT,
                strategy != MemoryStrategy::Markdown,
            ),
            max_len_per_memory: default.max_len_per_memory.resolve_limit(
                params,
                PARAM_MAX_LEN_PER_MEMORY,
                true,
            ),
            max_total_len: default.max_total_len.resolve_limit(
                params,
                PARAM_MAX_TOTAL_LEN,
                strategy == MemoryStrategy::Scratchpad,
            ),
            max_len_index: default.max_len_index.resolve_limit(
                params,
                PARAM_MAX_LEN_INDEX,
                strategy.has_index(),
            ),
            max_results: default.max_results.resolve_limit(
                params,
                PARAM_MAX_RESULTS,
                strategy.has_search(),
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
            max_results: as_u64(self.max_results),
        }
    }
}

/// Reading one optional limit out of a params object, in the one spelling every limit uses.
trait ResolveLimit {
    /// This default, overridden by `key` in `params` when the strategy `applies` the limit at all:
    /// a positive integer caps it, `0` disables it, anything else keeps the default. A limit the
    /// strategy does not apply resolves to `None` whatever the params say.
    fn resolve_limit(self, params: &Value, key: &str, applies: bool) -> Option<usize>;
}

impl ResolveLimit for Option<usize> {
    fn resolve_limit(self, params: &Value, key: &str, applies: bool) -> Option<usize> {
        if !applies {
            return None;
        }
        match params.get(key).and_then(Value::as_u64) {
            Some(0) => None,
            Some(limit) => Some(limit as usize),
            None => self,
        }
    }
}

/// One model-curated memory: the `name` (its slug) and `description` a strategy may show up front,
/// and the `body` the model wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Memory {
    /// The memory's stable slug — the handle every memory tool takes.
    name: String,
    /// The one-line description shown up front (not counted against the body limits).
    description: String,
    /// The memory's body — the substance, and what the length limits measure.
    body: String,
}

impl Memory {
    /// The memory's length in characters — its **body** length, what the [limits](MemoryCaps)
    /// bound (the short description is not counted).
    pub fn len(&self) -> usize {
        self.body.chars().count()
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
        revise: &'static str,
    },
    /// An operation named a memory that does not exist.
    NotFound {
        /// The name that matched nothing.
        name: String,
        /// The call that creates a memory, as this store's [strategy](MemoryStrategy::calls)
        /// names it.
        create: &'static str,
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
        revise: &'static str,
        /// The call that removes one, likewise.
        delete: &'static str,
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
                write!(f, "`{field}` must not be empty.")
            }
            MemoryError::InvalidSlug(name) => write!(
                f,
                "`{name}` is not a usable memory name; use up to {MAX_SLUG_LEN} characters of \
                 letters, digits, `-`, `_` or `.` (for example `build-commands`)."
            ),
            MemoryError::Duplicate { name, revise } => write!(
                f,
                "a memory named `{name}` already exists; use {revise} to revise it, or choose a \
                 different name."
            ),
            MemoryError::NotFound { name, create } => write!(
                f,
                "no memory named `{name}` exists; check the name against the memories you hold, \
                 or use {create} to create it."
            ),
            MemoryError::PerMemoryCap { name, len, cap } => write!(
                f,
                "memory `{name}` is {len} characters, over the per-memory limit of {cap}; \
                 make it more concise, or split it across two memories."
            ),
            MemoryError::CountCap {
                cap,
                revise,
                delete,
            } => write!(
                f,
                "you already hold the maximum of {cap} memories; revise an existing one with \
                 {revise}, or remove one with {delete}, before adding another."
            ),
            MemoryError::TotalCap { would_be, cap } => write!(
                f,
                "this would bring your total memory to {would_be} characters, over the \
                 {cap}-character budget; shorten or delete other memories first."
            ),
            MemoryError::IndexCap { would_be, cap } => write!(
                f,
                "this entry would bring your memory index to {would_be} characters, over the \
                 {cap}-character limit; delete a memory you no longer need before adding \
                 another."
            ),
            MemoryError::EditNotFound { name } => write!(
                f,
                "the text you searched for does not appear in memory `{name}`; read it and \
                 quote the text exactly as it stands."
            ),
            MemoryError::EditNotUnique { name, occurrences } => write!(
                f,
                "the text you searched for appears {occurrences} times in memory `{name}`; \
                 include enough surrounding text to make the match unique."
            ),
            MemoryError::WouldEmpty(name) => write!(
                f,
                "that edit would leave memory `{name}` empty; delete the memory instead if you \
                 no longer need it."
            ),
            MemoryError::NoKeywords => write!(
                f,
                "give at least one non-empty keyword to search your memories for."
            ),
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
#[derive(Debug, Clone)]
pub struct MemoryStore {
    strategy: MemoryStrategy,
    caps: MemoryCaps,
    memories: Vec<Memory>,
}

impl MemoryStore {
    /// An empty store bounded by `caps`, organized by `strategy`.
    pub fn new(strategy: MemoryStrategy, caps: MemoryCaps) -> Self {
        Self {
            strategy,
            caps,
            memories: Vec::new(),
        }
    }

    /// An empty [scratchpad](MemoryStrategy::Scratchpad) store with the default limits — the
    /// shorthand the tests and the bare tool-registry constructor use.
    #[allow(dead_code)]
    pub fn scratchpad() -> Self {
        Self::new(MemoryStrategy::Scratchpad, MemoryCaps::default())
    }

    /// The strategy this store is organized by.
    pub fn strategy(&self) -> MemoryStrategy {
        self.strategy
    }

    /// The limits this store enforces.
    pub fn caps(&self) -> MemoryCaps {
        self.caps
    }

    /// The number of memories currently held.
    pub fn count(&self) -> usize {
        self.memories.len()
    }

    /// The total body length, in characters, across every memory.
    pub fn total_len(&self) -> usize {
        self.memories.iter().map(Memory::len).sum()
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
        name: &str,
        description: &str,
        body: &str,
    ) -> Result<MemoryChange, MemoryError> {
        let (name, description, body) = validate_fields(name, description, body)?;
        if self.position(&name).is_some() {
            return Err(self.duplicate(name));
        }
        let len = body.chars().count();
        self.check_per_memory(&name, len)?;
        self.check_count()?;
        self.check_total(self.total_len() + len)?;
        self.insert(Memory {
            name,
            description,
            body,
        });
        Ok(MemoryChange::Written)
    }

    /// Revise an existing memory in place, replacing both its description and its whole body.
    /// Refused if any field is empty, no memory of that name exists, the new body exceeds the
    /// per-memory limit, or the update would push the aggregate length over the total limit. (The
    /// count is unchanged, so the count limit does not apply.)
    pub fn update(
        &mut self,
        name: &str,
        description: &str,
        body: &str,
    ) -> Result<MemoryChange, MemoryError> {
        let (name, description, body) = validate_fields(name, description, body)?;
        let Some(index) = self.position(&name) else {
            return Err(self.not_found(&name));
        };
        let len = body.chars().count();
        self.check_per_memory(&name, len)?;
        // Swap the old body out of the total before checking the new one in.
        let total_without_old = self.total_len() - self.memories[index].len();
        self.check_total(total_without_old + len)?;
        self.memories[index] = Memory {
            name,
            description,
            body,
        };
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
        name: &str,
        description: &str,
        contents: &str,
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
        self.check_per_memory(&name, contents.chars().count())?;
        self.check_count()?;
        self.check_index(&name, &description)?;
        self.insert(Memory {
            name,
            description,
            body: contents,
        });
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
    pub fn delete(&mut self, name: &str) -> Result<MemoryChange, MemoryError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(MemoryError::EmptyField("name"));
        }
        let Some(index) = self.position(name) else {
            return Err(self.not_found(name));
        };
        self.memories.remove(index);
        Ok(MemoryChange::Deleted)
    }

    // -----------------------------------------------------------------------
    // Derivations
    // -----------------------------------------------------------------------

    /// The [index](MemoryStrategy::Markdown) as the model sees it: one `- \`slug\` — description`
    /// line per memory, in slug order.
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
                let calls = self.strategy.calls(false);
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
            revise: self.strategy.calls(false).revise,
        }
    }

    /// The "no such memory" refusal, naming this strategy's create call. See [`duplicate`](Self::duplicate).
    fn not_found(&self, name: &str) -> MemoryError {
        MemoryError::NotFound {
            name: name.to_string(),
            create: self.strategy.calls(false).create,
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

    /// The [`MemoryState`](GgTelemetryKind::MemoryState) telemetry for the current set.
    fn state_event(&self) -> GgTelemetryKind {
        let memories = self
            .memories
            .iter()
            .map(|m| GgMemoryEntry {
                name: m.name.clone(),
                description: m.description.clone(),
                len: m.len() as u64,
            })
            .collect();
        GgTelemetryKind::MemoryState {
            strategy: self.strategy.id().to_string(),
            memories,
            count: self.memories.len() as u64,
            total_len: self.total_len() as u64,
            caps: self.caps.to_contract(),
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
    /// [system prompt](crate::prompts::SystemContext::memories) rather than re-sent every turn
    /// the block is refreshed.
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

/// The loop's live view of the memories capability: whether it is on, which
/// [strategy](MemoryStrategy) it runs, and the shared [`MemoryStore`].
///
/// Constructed [enabled](Self::new) with a strategy and resolved limits, or
/// [disabled](Self::disabled) (an ablation's off arm). It hands the [`store`](Self::store) to the
/// memory tools, produces the [strategy](Self::strategy) and [limits](Self::caps) the
/// [system prompt](crate::prompts::SystemContext::memories) states, the
/// [`MemoryState`](GgTelemetryKind::MemoryState) [telemetry](Self::state_event), and the pinned
/// [context block](Self::context_block) the loop keeps in the window.
#[derive(Debug, Clone)]
pub struct MemoriesRuntime {
    /// Whether the memories capability is enabled for this run.
    enabled: bool,
    /// The shared, mutable store — the same handle the tools mutate.
    store: Arc<Mutex<MemoryStore>>,
}

impl MemoriesRuntime {
    /// An enabled runtime with an empty store organized by `strategy` and bounded by `caps`.
    pub fn new(strategy: MemoryStrategy, caps: MemoryCaps) -> Self {
        Self {
            enabled: true,
            store: Arc::new(Mutex::new(MemoryStore::new(strategy, caps))),
        }
    }

    /// A disabled runtime (the memories capability is off): no tools, no prompt text,
    /// no context block, no telemetry.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            store: Arc::new(Mutex::new(MemoryStore::scratchpad())),
        }
    }

    /// Whether the capability offers memory tools this run (simply whether it is enabled —
    /// unlike skills, memories need no pre-existing library; the model creates them).
    pub fn offers_memories(&self) -> bool {
        self.enabled
    }

    /// The shared store, for binding into the memory tools.
    pub fn store(&self) -> Arc<Mutex<MemoryStore>> {
        Arc::clone(&self.store)
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

    /// The [`MemoryState`](GgTelemetryKind::MemoryState) telemetry for the current store,
    /// or `None` when the capability is off. Emitted at session start (empty, with the
    /// limits) and after every successful mutation.
    pub fn state_event(&self) -> Option<GgTelemetryKind> {
        if !self.enabled {
            return None;
        }
        Some(self.store.lock().expect("memory store lock").state_event())
    }

    /// The pinned context block for the current store, or `None` when the capability is off, the
    /// [strategy](MemoryStore::context_block) pins nothing, or there is nothing yet to show. The
    /// loop keeps this as the single [`Memory`](test_cabinet_core::gg::GgContextSource::Memory)-sourced
    /// item in the window.
    pub fn context_block(&self) -> Option<Message> {
        if !self.enabled {
            return None;
        }
        self.store
            .lock()
            .expect("memory store lock")
            .context_block()
    }
}

#[cfg(test)]
#[path = "memories.test.rs"]
mod tests;

#[cfg(test)]
#[path = "memories.files.test.rs"]
mod files_tests;
