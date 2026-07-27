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
    ArchiveHit, ArchiveSearch, Host as ContextHost, MessageRole, ReclaimReport,
};
use super::test_cabinet::gg::types::ToolError;
use super::{MembraneState, ToolApi};
use crate::model::Role;
use crate::tools::{
    ARCHIVE_THREAD_TOOL, EVICT_FILE_VIEW_TOOL, ReclaimData, SEARCH_ARCHIVE_TOOL, ToolData,
};

impl<A: ToolApi> ContextHost for MembraneState<A> {
    fn evict_file_view(&mut self, path: Option<String>) -> Result<ReclaimReport, ToolError> {
        let outcome = self.call(EVICT_FILE_VIEW_TOOL, |api| api.evict_file_view(path))?;
        reclaim(self, EVICT_FILE_VIEW_TOOL, outcome.data)
    }

    fn archive_thread(
        &mut self,
        keep_recent_turns: Option<u32>,
    ) -> Result<ReclaimReport, ToolError> {
        let outcome = self.call(ARCHIVE_THREAD_TOOL, |api| {
            api.archive_thread(keep_recent_turns)
        })?;
        reclaim(self, ARCHIVE_THREAD_TOOL, outcome.data)
    }

    fn search_archive(&mut self, query: String) -> Result<ArchiveSearch, ToolError> {
        let outcome = self.call(SEARCH_ARCHIVE_TOOL, |api| api.search_archive(query))?;
        match outcome.data {
            Some(ToolData::ArchiveSearch(search)) => Ok(ArchiveSearch {
                // "Nothing has been archived yet" and "the search ran and matched nothing" are
                // different answers to the same call, and collapsing them into an empty list would
                // make a program archive its thread a second time believing the first had failed.
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
            other => Err(self.missing_data(SEARCH_ARCHIVE_TOOL, other.as_ref())),
        }
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
    tool: &'static str,
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
        other => Err(state.missing_data(tool, other.as_ref())),
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
