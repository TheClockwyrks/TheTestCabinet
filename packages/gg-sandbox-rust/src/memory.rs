//! durable memories that survive context compaction
//!
//! A run picks one of three memory strategies, and only that strategy's functions are bound — so
//! `memory::list()` is the honest answer to "what can I do with memory here?". The scratchpad keeps
//! every memory in the context window ([`write_memory`]/[`update_memory`]); the two file-shaped
//! strategies keep the contents *outside* it
//! ([`create_memory`]/[`read_memory`]/[`edit_memory`]), one behind an index that is always in
//! context and one behind [`search_memories`]. [`delete_memory`] is bound under all three.
//!
//! Every mutation hands back the budget after it, so a program can decide whether to write another
//! memory by reading numbers rather than by parsing a sentence about them.

use crate::bindings::test_cabinet::gg::memories;
use crate::error::ToolError;
use crate::options::MemoryOptions;
use crate::types::{MemoryHit, MemoryUsage};
use crate::wire;

/// The gg tools this object dispatches — see [`fs::TOOLS`](crate::fs::TOOLS).
pub(crate) const TOOLS: &[&str] = &[
    "write_memory",
    "update_memory",
    "create_memory",
    "read_memory",
    "edit_memory",
    "search_memories",
    "delete_memory",
];

crate::meta::directory_of!("memory");

/// Record a durable memory that survives context compaction, and hand back how much of the memory
/// budget is now used.
///
/// A memory may also carry **code**. `options.code` is a Rust module whose items are bound at
/// `lib::<name>` in every later program you write, so a helper you get right once you never write
/// again; `options.on_use` is a program gg runs the first time the memory comes into use, whose
/// views reach you on your next turn. Neither is context — they cost you no window, are never shown
/// back to you, and count against no body limit — and both are bounded on their own.
///
/// # Arguments
///
/// * `name` — The memory's slug: letters, digits, `-`, `_` and `.`. It is what every other memory
///   call takes, and no two memories may share one.
/// * `description` — A one-line description of what the memory holds. Where the run keeps a memory
///   index this is the memory's line in it, and so all you see of the memory until you read it.
/// * `body` — The memory's contents.
/// * `options` — The code halves you may leave out.
///
/// # Errors
///
/// `Conflict` on a duplicate name, and `LimitExceeded` when the body would breach the run's caps —
/// revise or delete a memory rather than accruing more.
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

/// Replace an existing memory's description and body, keyed on its `name`, and hand back the memory
/// budget.
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

/// Record a new memory whose contents are kept OUT of your context window until you read them, and
/// hand back the memory budget.
///
/// Give it a slug, a one-line description — required where the run keeps an index, since that is the
/// memory's line in it — and the initial contents.
///
/// # Arguments
///
/// * `name` — The memory's slug: letters, digits, `-`, `_` and `.`.
/// * `description` — A one-line description of what the memory holds, which is its line in the
///   index.
/// * `body` — The memory's initial contents, which stay out of your context window until you read
///   them.
/// * `options` — The code halves you may leave out. They load on that first read.
///
/// # Errors
///
/// `Conflict` on a duplicate slug, and `LimitExceeded` when the contents, or the index entry, would
/// breach a limit.
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

/// Read one memory's full contents, by slug — the only thing that brings them into your context.
///
/// If the memory carries code, reading it also loads that code: the reply names the `lib::<key>` it
/// is bound at, and it stays bound for the rest of your session.
///
/// # Arguments
///
/// * `name` — The memory's slug.
///
/// # Errors
///
/// `NotFound` when no memory has that slug.
pub fn read_memory(name: &str) -> Result<String, ToolError> {
    wire::lift(memories::read_memory(name))
}

/// Revise a memory in place by replacing the one exact occurrence of `search` with `replace`, and
/// hand back the memory budget.
///
/// Append by quoting the last line and replacing it with itself plus what you are adding.
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
/// `LimitExceeded` when the result would be too long, and `InvalidArgument` when the edit would
/// leave the memory empty — delete it instead.
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
/// ranked by how many of your keywords a memory mentions and then by how often. Pass several
/// specific words rather than one sentence, then `memory::read_memory` the hits worth having in
/// full. A search that matches nothing is an empty `Vec`.
///
/// # Arguments
///
/// * `keywords` — The words to look for. Several specific words rank better than one sentence,
///   because a memory is ranked by how many of them it mentions.
///
/// # Errors
///
/// `InvalidArgument` when every keyword is empty.
pub fn search_memories(keywords: &[&str]) -> Result<Vec<MemoryHit>, ToolError> {
    wire::lift(memories::search_memories(&wire::strings(keywords)))
        .map(|hits| hits.into_iter().map(wire::memory_hit).collect())
}

/// Evict a memory by name, freeing room in the budget, and hand back what is left in use.
///
/// # Arguments
///
/// * `name` — The memory's slug.
///
/// # Errors
///
/// `NotFound` when no memory has that name.
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
