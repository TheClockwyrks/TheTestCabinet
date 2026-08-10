//! Durable memories, which survive a context compaction.
//!
//! A run picks one of three memory strategies and binds only that strategy's functions, so
//! `memories::list()` is the honest answer to what memory can do here. The scratchpad keeps every
//! memory in the context window ([`write_memory`], [`update_memory`]); the two file-shaped strategies
//! keep the contents outside it ([`create_memory`], [`read_memory`], [`edit_memory`]), one behind an
//! index that is always in context and one behind [`search_memories`]. [`delete_memory`] is bound
//! under all three.
//!
//! Every mutation hands back the budget after it, so a program can decide whether to write another
//! memory by reading numbers rather than by parsing a sentence about them.

use crate::bindings::test_cabinet::gg::memories;
use crate::core::ToolError;
use crate::wire;

/// The gg tools this module dispatches — see [`files::TOOLS`](crate::files::TOOLS).
pub(crate) const TOOLS: &[&str] = &[
    "write_memory",
    "update_memory",
    "create_memory",
    "read_memory",
    "edit_memory",
    "search_memories",
    "delete_memory",
];

crate::directory::directory_of!();

/// Record a durable memory that survives a context compaction.
///
/// A memory may also carry **code**. `options.code` is a Rust module whose items are bound at
/// `lib::<name>` in every later program this session writes, so a helper got right once is never
/// written again; `options.on_use` is a program gg runs the first time the memory comes into use,
/// whose views arrive on the next turn. Neither is context: they cost no window, are never shown back,
/// and count against no body limit.
///
/// # Arguments
///
/// * `name` — The memory's slug: letters, digits, `-`, `_` and `.`. Every other memory call takes it,
///   and no two memories may share one.
/// * `description` — A one-line description of what the memory holds. Where the run keeps a memory
///   index this is the memory's line in it, and so all that is visible until it is read.
/// * `body` — The memory's contents.
/// * `options` — The code halves, which may be left out.
///
/// # Errors
///
/// `Conflict` on a duplicate name, and `LimitExceeded` when the body would breach the run's caps —
/// revising or deleting a memory is the way out, rather than accruing more.
#[doc(alias = "ggop:memories.write_memory")]
pub fn write_memory(
    name: &str,
    description: &str,
    body: &str,
    options: MemoryOptions<'_>,
) -> Result<MemoryUsage, ToolError> {
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
/// # Errors
///
/// `NotFound` when no memory has that name.
#[doc(alias = "ggop:memories.update_memory")]
pub fn update_memory(
    name: &str,
    description: &str,
    body: &str,
    options: MemoryOptions<'_>,
) -> Result<MemoryUsage, ToolError> {
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
/// * `options` — The code halves, which may be left out. They load on that first read.
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
) -> Result<MemoryUsage, ToolError> {
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
/// A memory that carries code loads that code on being read: the reply names the `lib::<key>` it is
/// bound at, and it stays bound for the rest of the session.
///
/// # Arguments
///
/// * `name` — The memory's slug.
///
/// # Errors
///
/// `NotFound` when no memory has that slug.
#[doc(alias = "ggop:memories.read_memory")]
pub fn read_memory(name: &str) -> Result<String, ToolError> {
    wire::lift(memories::read_memory(name))
}

/// Revise a memory in place, replacing the one exact occurrence of `search` with `replace`.
///
/// Appending is done by quoting the last line and replacing it with itself plus what is being added.
///
/// # Arguments
///
/// * `name` — The slug of the memory to revise.
/// * `search` — The exact text to find in its contents. It must appear exactly once.
/// * `replace` — The text to put in its place.
///
/// # Errors
///
/// `NotFound` when the text does not appear, `Conflict` when it appears more than once,
/// `LimitExceeded` when the result would be too long, and `InvalidArgument` when the edit would leave
/// the memory empty — deleting it is the way to do that.
#[doc(alias = "ggop:memories.edit_memory")]
pub fn edit_memory(name: &str, search: &str, replace: &str) -> Result<MemoryUsage, ToolError> {
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
/// ranked by how many distinct keywords a memory mentions and then by how often. Several specific
/// words rank better than one sentence; [`read_memory`] is what fetches a hit worth having in full. A
/// search that matches nothing is an empty `Vec`.
///
/// # Arguments
///
/// * `keywords` — The words to look for. Several specific words rank better than one sentence,
///   because a memory is ranked by how many of them it mentions.
///
/// # Errors
///
/// `InvalidArgument` when every keyword is empty.
#[doc(alias = "ggop:memories.search_memories")]
pub fn search_memories(keywords: &[&str]) -> Result<Vec<MemoryHit>, ToolError> {
    wire::lift(memories::search_memories(&wire::strings(keywords)))
        .map(|hits| hits.into_iter().map(wire::memory_hit).collect())
}

/// Evict a memory by name, freeing room in the budget.
///
/// # Arguments
///
/// * `name` — The memory's slug.
///
/// # Errors
///
/// `NotFound` when no memory has that name.
#[doc(alias = "ggop:memories.delete_memory")]
pub fn delete_memory(name: &str) -> Result<MemoryUsage, ToolError> {
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
/// only some of them, so `None` means nothing bounds that axis — which is worth checking before
/// subtracting.
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

/// The two code halves every write of a memory accepts, and may leave out.
///
/// [`Default`] records a memory that is only prose. Neither half is context: they cost no window, are
/// never shown back, and count against no body limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MemoryOptions<'a> {
    /// A Rust module whose items are bound at `lib::<name>` in every later program this session
    /// writes.
    pub code: Option<&'a str>,
    /// A program gg runs the first time the memory comes into use, whose views arrive on the next
    /// turn.
    pub on_use: Option<&'a str>,
}
