//! Manage the agent's own context window.
//!
//! These are the only calls whose effect is on the conversation rather than on the workspace. They
//! are worth making from a program precisely because a program can decide *when* to: read a set of
//! files, extract what matters, then evict the views, all in one turn.

use std::ops::RangeInclusive;

use crate::bindings::test_cabinet::gg::context;
use crate::core::ToolError;
use crate::wire;

/// The gg tools this module dispatches — see [`files::TOOLS`](crate::files::TOOLS).
pub(crate) const TOOLS: &[&str] = &[
    "evict_file_view",
    "archive_thread",
    "search_archive",
    "compact",
];

crate::directory::directory_of!();

/// Drop the contents of files that were read out of the context window, freeing the tokens they
/// occupy.
///
/// The files on disk are untouched: this forgets what was read, not what exists.
///
/// # Arguments
///
/// * `path` — The file whose views to drop; `None` drops every file view held.
#[doc(alias = "ggop:context.evict_file_view")]
pub fn evict_file_view(path: Option<&str>) -> Result<ReclaimReport, ToolError> {
    wire::lift(context::evict_file_view(path)).map(wire::reclaim_report)
}

/// Move whole turns out of the context window and report what that reclaimed.
///
/// Every result carries a header with its turn number and roughly what holding it costs, which is
/// what names the turns worth dropping. A span is a Rust inclusive range and both ends are included,
/// so `context::archive_thread(&[4..=19])` archives turns 4 through 19. The agent's own messages in an
/// archived turn are dropped; the results are kept and stay searchable with [`search_archive`].
///
/// # Arguments
///
/// * `ranges` — The inclusive spans of turn numbers to move out of the window. They may overlap.
///
/// # Errors
///
/// `InvalidArgument` for an empty list, too many spans at once, or a span that ends before it
/// starts.
#[doc(alias = "ggop:context.archive_thread")]
pub fn archive_thread(ranges: &[RangeInclusive<u32>]) -> Result<ReclaimReport, ToolError> {
    let ranges: Vec<_> = ranges.iter().map(wire::turn_range).collect();
    wire::lift(context::archive_thread(&ranges)).map(wire::reclaim_report)
}

/// Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
///
/// [`archive_empty`](ArchiveSearch::archive_empty) is worth checking before
/// [`hits`](ArchiveSearch::hits): it distinguishes "nothing has been archived yet" from "the search
/// ran and matched nothing", so a program does not archive again believing the first archive failed.
///
/// # Arguments
///
/// * `query` — The substring to look for. Matching is case-insensitive.
#[doc(alias = "ggop:context.search_archive")]
pub fn search_archive(query: &str) -> Result<ArchiveSearch, ToolError> {
    wire::lift(context::search_archive(query)).map(wire::archive_search)
}

/// Compact the context window: the detailed thread is dropped and restarted from `summary`.
///
/// A fresh read of each path in `files` is added to the restarted window. Skills, memories and the
/// task list are kept as they are. gg asks for this call when the window is full, and refuses every
/// other call until it arrives.
///
/// It does not stop the program: it registers the request and returns, and the rewrite happens once
/// the program has ended. Everything not in the summary and not in `files` is gone, so the summary is
/// written for the agent that comes after and `files` names what it will need in hand.
///
/// # Arguments
///
/// * `summary` — What the restarted window opens with. Everything not in it and not re-read from
///   `files` is gone.
/// * `files` — The paths to read afresh into the restarted window. An empty slice reads nothing back.
#[doc(alias = "ggop:context.compact")]
pub fn compact(summary: &str, files: &[&str]) -> Result<(), ToolError> {
    wire::lift(context::compact(summary, &wire::strings(files)))
}

/// What a context reclaim actually freed from the live context window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReclaimReport {
    /// Context items dropped from the live window.
    pub items: u32,
    /// Approximately how many tokens that freed.
    pub reclaimed_tokens: u32,
    /// The workspace paths whose views were evicted. Empty for an archive.
    pub paths: Vec<String>,
    /// The prose summary of what was reclaimed.
    pub detail: String,
}

/// Who said an archived message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MessageRole {
    /// The system prompt.
    System,
    /// A turn's input to the agent — a result, a view, or an operator's instruction.
    User,
    /// Something the agent said.
    Assistant,
    /// A tool result, on a session that made tool calls rather than writing programs.
    Tool,
}

/// One archived message that matched a search.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveHit {
    /// The archived message's sequence number.
    pub seq: u32,
    /// Who said it.
    pub role: MessageRole,
    /// The message text.
    pub text: String,
}

/// What [`search_archive`] found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveSearch {
    /// Nothing has been archived yet, so there was nothing to search.
    ///
    /// Deliberately distinct from a search that ran and matched nothing, so a program does not
    /// archive again believing the first archive failed.
    pub archive_empty: bool,
    /// The matches, most recent first, at most 8.
    pub hits: Vec<ArchiveHit>,
}
