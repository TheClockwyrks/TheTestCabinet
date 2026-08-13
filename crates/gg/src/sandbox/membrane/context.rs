//! The membrane's context family: the three tools an agent manages its own context window with.
//!
//! Their outcomes are unusual in one way worth knowing here: the two reclaim tools only *validate*
//! their arguments, and the [loop](crate::agent) — which owns the live window — performs the
//! reclaim and rewrites the outcome with what it actually freed. So the numbers a program reads
//! back are the real ones, not an estimate the tool made before the work happened.
//!
//! That also means the `ToolData::Reclaim` sidecar `evict_file_view` and `archive_thread` read is
//! produced by the **loop**, not by the tool: `EvictFileViewTool` and `ArchiveThreadTool`
//! deliberately return an outcome with no data. Until the loop's servicing seam attaches it, both
//! of these functions report `missing_data` — and the tests below pass regardless, because their
//! fake invoker supplies what the real system has to. Read a green suite here as "the conversion is
//! right", never as "the producer exists". `search_archive` is the exception: its sidecar comes
//! from the tool itself.

use super::test_cabinet::gg::context::{
    ArchiveHit, ArchiveSearch, Host as ContextHost, MessageRole, ReclaimReport, TurnRange,
};
use super::test_cabinet::gg::types::ToolError;
use super::{MembraneState, ToolApi};
use crate::model::Role;
use crate::sandbox::operations::{
    CONTEXT_ARCHIVE_THREAD, CONTEXT_COMPACT, CONTEXT_EVICT_FILE_VIEW, CONTEXT_SEARCH_ARCHIVE,
    OperationId,
};
use crate::tools::{ReclaimData, ToolData};

impl<A: ToolApi> ContextHost for MembraneState<A> {
    fn evict_file_view(&mut self, path: Option<String>) -> Result<ReclaimReport, ToolError> {
        self.recorded(CONTEXT_EVICT_FILE_VIEW, |state, rec| {
            let outcome = state.call(rec, CONTEXT_EVICT_FILE_VIEW, |api| {
                api.evict_file_view(path)
            })?;
            reclaim(state, CONTEXT_EVICT_FILE_VIEW, outcome.data)
        })
    }

    fn archive_thread(&mut self, ranges: Vec<TurnRange>) -> Result<ReclaimReport, ToolError> {
        self.recorded(CONTEXT_ARCHIVE_THREAD, |state, rec| {
            // The membrane's `u32` turn bounds widen to the model's `u64` here rather than the other
            // way around, so a range can never be narrowed on its way in.
            let ranges: Vec<crate::context::TurnRange> = ranges
                .into_iter()
                .map(|range| crate::context::TurnRange {
                    from: u64::from(range.start),
                    to: u64::from(range.end),
                })
                .collect();
            let outcome = state.call(rec, CONTEXT_ARCHIVE_THREAD, |api| {
                api.archive_thread(ranges.clone())
            })?;
            reclaim(state, CONTEXT_ARCHIVE_THREAD, outcome.data)
        })
    }

    /// Register a compaction and return.
    ///
    /// Nothing is rewritten here: like `wait_for_issue`, the call validates its arguments and
    /// records the request, and the loop performs the rewrite once the program has ended. A context
    /// reset performed *during* the program would pull the window out from under the turn that is
    /// still running in it. Success carries no payload — what the compaction reclaimed is reported
    /// to the model on its next turn, in the window it wakes up in.
    fn compact(&mut self, summary: String, files: Vec<String>) -> Result<(), ToolError> {
        self.recorded(CONTEXT_COMPACT, |state, rec| {
            state.call(rec, CONTEXT_COMPACT, |api| api.compact(summary, files))?;
            Ok(())
        })
    }

    fn search_archive(&mut self, query: String) -> Result<ArchiveSearch, ToolError> {
        self.recorded(CONTEXT_SEARCH_ARCHIVE, |state, rec| {
            let outcome =
                state.call(rec, CONTEXT_SEARCH_ARCHIVE, |api| api.search_archive(query))?;
            match outcome.data {
                Some(ToolData::ArchiveSearch(search)) => Ok(ArchiveSearch {
                    // "Nothing has been archived yet" and "the search ran and matched nothing" are
                    // different answers to the same call, and collapsing them into an empty list
                    // would make a program archive its thread a second time believing the first had
                    // failed.
                    archive_empty: search.archive_empty,
                    hits: search
                        .hits
                        .into_iter()
                        .map(|hit| ArchiveHit {
                            seq: hit.seq,
                            role: role(hit.role),
                            text: hit.text,
                        })
                        .collect(),
                }),
                other => Err(state.missing_data(CONTEXT_SEARCH_ARCHIVE, other.as_ref())),
            }
        })
    }
}

/// What a reclaim actually freed, or the defect diagnostic if the loop reported nothing.
///
/// The payload is destructured field by field rather than read through dots: a field added to it
/// then fails to compile *here*, which is where someone has to decide whether the membrane should
/// carry it to a program.
///
/// It takes the state because the diagnostic is not only returned to the program: it also corrects
/// the roster entry the dispatch already wrote, which until this point says the call succeeded.
fn reclaim<A: ToolApi>(
    state: &mut MembraneState<A>,
    id: OperationId,
    data: Option<ToolData>,
) -> Result<ReclaimReport, ToolError> {
    match data {
        Some(ToolData::Reclaim(ReclaimData {
            items,
            reclaimed_tokens,
            paths,
            detail,
        })) => Ok(ReclaimReport {
            items,
            reclaimed_tokens,
            paths,
            detail,
        }),
        other => Err(state.missing_data(id, other.as_ref())),
    }
}

/// Who said an archived message, in the membrane's vocabulary.
fn role(role: Role) -> MessageRole {
    match role {
        Role::System => MessageRole::System,
        Role::User => MessageRole::User,
        Role::Assistant => MessageRole::Assistant,
        Role::Tool => MessageRole::Tool,
    }
}

#[cfg(test)]
#[path = "context.test.rs"]
mod tests;
