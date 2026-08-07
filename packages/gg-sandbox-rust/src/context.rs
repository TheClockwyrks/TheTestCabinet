//! manage your own context window
//!
//! These are the only calls whose effect is on the conversation rather than on the workspace. They
//! are worth making from a program precisely because a program can decide *when* to: read a set of
//! files, extract what matters, then evict the views in the same turn.

use std::ops::RangeInclusive;

use crate::bindings::test_cabinet::gg::context;
use crate::error::ToolError;
use crate::types::{ArchiveSearch, ReclaimReport};
use crate::wire;

/// The gg tools this object dispatches — see [`fs::TOOLS`](crate::fs::TOOLS).
pub(crate) const TOOLS: &[&str] = &[
    "evict_file_view",
    "archive_thread",
    "search_archive",
    "compact",
];

crate::meta::directory_of!("context");

/// Drop the contents of files you have read out of your context window, freeing the tokens they
/// occupy, and report what that reclaimed.
///
/// The files on disk are untouched — this forgets what you read, not what exists.
///
/// # Arguments
///
/// * `path` — The file whose views to drop; `None` drops every file view you hold.
pub fn evict_file_view(path: Option<&str>) -> Result<ReclaimReport, ToolError> {
    wire::lift(context::evict_file_view(path)).map(wire::reclaim_report)
}

/// Move whole turns out of your context window and report what that reclaimed.
///
/// Every result you are given carries a header with its turn number and roughly what holding it
/// costs, so name the turns worth dropping. A span is a Rust inclusive range and both ends are
/// included, so `context::archive_thread(&[4..=19])` archives turns 4 through 19. Your own messages
/// in an archived turn are dropped; the results are kept and stay searchable with
/// [`search_archive`].
///
/// # Arguments
///
/// * `ranges` — The inclusive spans of turn numbers to move out of your window. They may overlap.
///
/// # Errors
///
/// `InvalidArgument` for a span whose ends are not turn numbers.
pub fn archive_thread(ranges: &[RangeInclusive<u32>]) -> Result<ReclaimReport, ToolError> {
    let ranges: Vec<_> = ranges.iter().map(wire::turn_range).collect();
    wire::lift(context::archive_thread(&ranges)).map(wire::reclaim_report)
}

/// Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
///
/// Check `archive_empty` before reading `hits`: it distinguishes "nothing has been archived yet"
/// from "the search ran and matched nothing", so you do not archive again believing the first
/// archive failed.
///
/// # Arguments
///
/// * `query` — The substring to look for. Matching is case-insensitive.
pub fn search_archive(query: &str) -> Result<ArchiveSearch, ToolError> {
    wire::lift(context::search_archive(query)).map(wire::archive_search)
}

/// Compact your context window: the detailed thread is dropped and restarted from `summary`, plus a
/// fresh read of each path in `files`.
///
/// Your skills, memories and task list are kept as they are. You are asked to call this when your
/// window is full, and every other call is refused until you do.
///
/// It does NOT stop your program: it registers the request and returns, and the rewrite happens once
/// your program has ended. Everything not in your summary and not in `files` is gone, so write the
/// summary for your future self and name the files you will actually need in hand.
///
/// # Arguments
///
/// * `summary` — What your restarted window opens with. Write it for your future self: everything
///   not in it and not re-read from `files` is gone.
/// * `files` — The paths to read afresh into the restarted window. An empty slice reads nothing
///   back.
///
/// # Errors
///
/// `Refused` when a compaction is already in flight and this call is not the one it asked for.
pub fn compact(summary: &str, files: &[&str]) -> Result<(), ToolError> {
    wire::lift(context::compact(summary, &wire::strings(files)))
}
