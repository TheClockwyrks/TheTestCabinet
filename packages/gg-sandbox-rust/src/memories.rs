//! Durable memories, which survive a context compaction.
//!
//! A run picks one of three memory strategies and binds only that strategy's functions. The
//! scratchpad strategy keeps every memory in the context window; the two file-shaped strategies keep
//! the contents outside it until a memory is read, one behind an index that is always in context and
//! one behind a keyword search.
//!
//! Every mutation returns the budget after it.

use crate::bindings::test_cabinet::gg::memories;
use crate::core::ApiError;
use crate::wire;

/// The gg tools this module dispatches — see [`files::OPERATIONS`](crate::files::OPERATIONS).
pub(crate) const OPERATIONS: &[&str] = &[
    "write_memory",
    "update_memory",
    "create_memory",
    "read_memory",
    "edit_memory",
    "search_memories",
    "delete_memory",
];

/// Record a durable memory that survives a context compaction.
///
/// A memory may also carry code. `options.code` is a Rust module every later program this session
/// writes reaches as `<name>::<item>`; `options.on_use` is a program gg runs on every use of the
/// memory, whose views arrive on the next turn. Neither is context: they cost no window, are never
/// shown back, and count against no body limit.
///
/// # Arguments
///
/// * `name` — The memory's slug: letters, digits, `-`, `_` and `.`. Every other memory call takes it,
///   and no two memories may share one.
/// * `description` — A one-line description of what the memory holds. Where the run keeps a memory
///   index this is the memory's line in it.
/// * `body` — The memory's contents.
/// * `options` — The code halves, which may be left out.
///
/// # Returns
///
/// The budget after the write.
///
/// # Errors
///
/// `Conflict` on a duplicate name, and `LimitExceeded` when the body would breach the run's caps.
#[doc(alias = "ggop:memories.write_memory")]
pub fn write_memory(
    name: &str,
    description: &str,
    body: &str,
    options: MemoryOptions<'_>,
) -> Result<MemoryUsage, ApiError> {
    wire::lift(memories::write_memory(&input(
        name,
        description,
        body,
        options,
    )))
    .map(wire::memory_usage)
}

/// Replace an existing memory's description and body, keyed on its slug.
///
/// Its code and on-use program are replaced too — leaving them out of `options` clears them.
///
/// # Arguments
///
/// * `name` — The slug of the memory to replace.
/// * `description` — The one-line description to replace the old one with.
/// * `body` — The contents to replace the old ones with.
/// * `options` — The code halves. Leaving one out clears the one the memory had.
///
/// # Returns
///
/// The budget after the replacement, which moves when the new body is a different length.
///
/// # Errors
///
/// `NotFound` when no memory has that name.
#[doc(alias = "ggop:memories.update_memory")]
pub fn update_memory(
    name: &str,
    description: &str,
    body: &str,
    options: MemoryOptions<'_>,
) -> Result<MemoryUsage, ApiError> {
    wire::lift(memories::update_memory(&input(
        name,
        description,
        body,
        options,
    )))
    .map(wire::memory_usage)
}

/// Record a new memory whose contents stay out of the context window until they are read.
///
/// It takes a slug, a one-line description — required where the run keeps an index, since that is the
/// memory's line in it — and the initial contents.
///
/// # Arguments
///
/// * `name` — The memory's slug: letters, digits, `-`, `_` and `.`.
/// * `description` — A one-line description of what the memory holds, which is its line in the index.
/// * `body` — The memory's initial contents, which stay out of the context window until they are
///   read.
/// * `options` — The code halves, which may be left out. They come into use when the memory is read.
///
/// # Returns
///
/// The budget after the creation, index included.
///
/// # Errors
///
/// `InvalidArgument` for a blank field or a slug with characters a name may not hold, `Conflict` on
/// a duplicate slug, and `LimitExceeded` when the contents, or the index entry, would breach a
/// limit.
#[doc(alias = "ggop:memories.create_memory")]
pub fn create_memory(
    name: &str,
    description: &str,
    body: &str,
    options: MemoryOptions<'_>,
) -> Result<MemoryUsage, ApiError> {
    wire::lift(memories::create_memory(&input(
        name,
        description,
        body,
        options,
    )))
    .map(wire::memory_usage)
}

/// Read one memory's full contents by slug, which is the only thing that brings them into context.
///
/// A memory that carries code loads that code on being read: reading it opens a documentation view
/// of each function the code declares, and the code stays reachable for the rest of the session.
///
/// # Arguments
///
/// * `name` — The memory's slug.
///
/// # Returns
///
/// The memory's contents in full — the whole body, never the index line or an excerpt of it.
///
/// # Errors
///
/// `NotFound` when no memory has that slug.
#[doc(alias = "ggop:memories.read_memory")]
pub fn read_memory(name: &str) -> Result<String, ApiError> {
    wire::lift(memories::read_memory(name))
}

/// Revise a memory in place, replacing the one exact occurrence of `search` with `replace`.
///
/// # Arguments
///
/// * `name` — The slug of the memory to revise.
/// * `search` — The exact text to find in its contents. It must appear exactly once.
/// * `replace` — The text to put in its place.
///
/// # Returns
///
/// The budget after the edit, which moves by the difference between `search` and `replace`.
///
/// # Errors
///
/// `NotFound` when the text does not appear, `Conflict` when it appears more than once,
/// `LimitExceeded` when the result would be too long, and `InvalidArgument` when the edit would
/// leave the memory empty.
#[doc(alias = "ggop:memories.edit_memory")]
pub fn edit_memory(name: &str, search: &str, replace: &str) -> Result<MemoryUsage, ApiError> {
    wire::lift(memories::edit_memory(&memories::MemoryEdit {
        name: name.to_string(),
        search: search.to_string(),
        replace: replace.to_string(),
    }))
    .map(wire::memory_usage)
}

/// Find the memories mentioning any of `keywords`, best first.
///
/// Plain case-insensitive substring matching over each memory's slug, description and contents,
/// ranked by how many distinct keywords a memory mentions and then by how often. A search that
/// matches nothing is an empty `Vec`.
///
/// # Arguments
///
/// * `keywords` — The words to look for.
///
/// # Returns
///
/// The memories that matched, most keywords first, each with the numbers it was ranked by and a
/// window around its first match.
///
/// # Errors
///
/// `InvalidArgument` when every keyword is empty.
#[doc(alias = "ggop:memories.search_memories")]
pub fn search_memories(keywords: &[&str]) -> Result<Vec<MemoryHit>, ApiError> {
    wire::lift(memories::search_memories(&wire::strings(keywords)))
        .map(|hits| hits.into_iter().map(wire::memory_hit).collect())
}

/// Evict a memory by name, freeing room in the budget.
///
/// # Arguments
///
/// * `name` — The memory's slug.
///
/// # Returns
///
/// The budget after the eviction.
///
/// # Errors
///
/// `NotFound` when no memory has that name.
#[doc(alias = "ggop:memories.delete_memory")]
pub fn delete_memory(name: &str) -> Result<MemoryUsage, ApiError> {
    wire::lift(memories::delete_memory(name)).map(wire::memory_usage)
}

/// The wire record the three writes share, built once rather than three times.
fn input(
    name: &str,
    description: &str,
    body: &str,
    options: MemoryOptions<'_>,
) -> memories::MemoryInput {
    memories::MemoryInput {
        name: name.to_string(),
        description: description.to_string(),
        body: body.to_string(),
        code: options.code.map(str::to_string),
        on_use: options.on_use.map(str::to_string),
    }
}

/// How much of the run's durable-memory budget is used, after the call that returned it.
///
/// Every maximum is an [`Option`]: each limit can be turned off, and a run's memory strategy applies
/// only some of them, so `None` means nothing bounds that axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryUsage {
    /// Memories currently held.
    pub count: u32,
    /// The most memories this run allows, if it limits the count.
    pub max_count: Option<u32>,
    /// Characters of body currently held, across all memories.
    pub total_chars: u32,
    /// The most characters of body this run allows in total, if it limits the aggregate.
    pub max_total_chars: Option<u32>,
    /// Characters the memory index occupies, under a run that keeps one.
    pub index_chars: Option<u32>,
    /// The most characters the index may occupy, if it is limited.
    pub max_index_chars: Option<u32>,
}

/// One memory [`search_memories`] matched, and the numbers it was ranked by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryHit {
    /// The memory's slug — what [`read_memory`] takes.
    pub name: String,
    /// Its description, or `""` when it was created without one.
    pub description: String,
    /// How many distinct keywords it matched — the primary ranking.
    pub matched: u32,
    /// How many times those keywords occur in it — the tiebreak.
    pub occurrences: u32,
    /// A short window of the memory around its first match.
    pub excerpt: String,
}

impl MemoryHit {
    /// Read this memory's full contents, which is what brings them into context.
    ///
    /// The same call as [`read_memory`], with the slug already supplied.
    ///
    /// # Returns
    ///
    /// The memory's contents in full.
    ///
    /// # Errors
    ///
    /// `NotFound` when the memory has since been deleted.
    #[doc(alias = "ggop-alias:memories.read_memory")]
    pub fn read(&self) -> Result<String, ApiError> {
        read_memory(&self.name)
    }
}

/// The two code halves every write of a memory accepts, and may leave out.
///
/// [`Default`] records a memory that is only prose. Neither half is context: they cost no window, are
/// never shown back, and count against no body limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MemoryOptions<'a> {
    /// A Rust module every later program this session writes reaches as `<name>::<item>`.
    pub code: Option<&'a str>,
    /// A program gg runs on every use of the memory, whose views arrive on the next turn.
    pub on_use: Option<&'a str>,
}
