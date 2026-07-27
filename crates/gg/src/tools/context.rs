//! The **agent-managed context** tools: `evict_file_view`, `archive_thread`, and
//! `search_archive` — how the model reclaims its own window, the complement to the automatic
//! [compaction](crate::compaction) backstop.
//!
//! These are contributed only when the
//! [`agent-managed-context`](test_cabinet_core::gg::CAPABILITY_AGENT_MANAGED_CONTEXT)
//! capability is enabled (ablation).
//!
//! # Why two of these are thin
//!
//! `evict_file_view` and `archive_thread` act on the **live context window**, which the loop
//! owns and mutates in place — a tool cannot hold it. So their [`invoke`](super::Tool::invoke)
//! only **validates arguments**; the [loop](crate::agent) performs the actual reclaim against
//! the [`ContextModel`](crate::context::ContextModel) (removing the items, moving archived ones
//! into the shared [`ArchiveStore`]) and rewrites the tool result
//! with what was reclaimed. The shared argument parsers ([`parse_evict_path`],
//! [`parse_archive_keep_recent`]) are the single source of truth both sides use. `search_archive`,
//! by contrast, is a self-contained store-backed tool (like the memory tools): it reads the
//! shared archive directly and needs nothing from the live window.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{
    ArchiveHitData, ArchiveSearchData, Tool, ToolContext, ToolData, ToolOutcome, invalid_argument,
    required_str, saturating_u32,
};
use crate::archive::ArchiveStore;
use crate::model::ToolDefinition;

/// The `evict_file_view` tool name.
pub const EVICT_FILE_VIEW_TOOL: &str = "evict_file_view";
/// The `archive_thread` tool name.
pub const ARCHIVE_THREAD_TOOL: &str = "archive_thread";
/// The `search_archive` tool name.
pub const SEARCH_ARCHIVE_TOOL: &str = "search_archive";

/// The default number of most-recent assistant turns `archive_thread` keeps live when the
/// call does not specify one — keep the current turn, archive everything older.
pub const DEFAULT_ARCHIVE_KEEP_RECENT: usize = 1;

/// The maximum number of hits a single `search_archive` returns, so a broad query cannot
/// itself flood the window it is meant to relieve.
const SEARCH_RESULT_CAP: usize = 8;

/// Whether `name` is one of the two agent-managed-context tools that reclaim from the **live**
/// window (and so are applied by the [loop](crate::agent) against the context model, not by the
/// tool's own `invoke`). `search_archive` is *not* one of these — it only reads the archive.
pub fn is_context_reclaim_tool(name: &str) -> bool {
    matches!(name, EVICT_FILE_VIEW_TOOL | ARCHIVE_THREAD_TOOL)
}

/// Parse `evict_file_view`'s optional `path` argument: `None`/absent means "evict every file
/// view", a string selects one path, anything else is a usage error. Shared by the tool's
/// validation and the loop's reclaim so the two never diverge.
pub fn parse_evict_path(args: &Value) -> Result<Option<String>, String> {
    match args.get("path") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(path)) if !path.trim().is_empty() => Ok(Some(path.clone())),
        Some(Value::String(_)) => Err(format!(
            "`{EVICT_FILE_VIEW_TOOL}`: `path` must not be empty"
        )),
        Some(_) => Err(format!(
            "`{EVICT_FILE_VIEW_TOOL}`: `path` must be a string (omit it to evict all file views)"
        )),
    }
}

/// Parse `archive_thread`'s optional `keep_recent_turns` argument: absent means
/// [`DEFAULT_ARCHIVE_KEEP_RECENT`], otherwise a non-negative integer, anything else is a usage
/// error. Shared by the tool's validation and the loop's reclaim.
pub fn parse_archive_keep_recent(args: &Value) -> Result<usize, String> {
    match args.get("keep_recent_turns") {
        None | Some(Value::Null) => Ok(DEFAULT_ARCHIVE_KEEP_RECENT),
        Some(value) => match value.as_u64() {
            Some(n) => Ok(n as usize),
            None => Err(format!(
                "`{ARCHIVE_THREAD_TOOL}`: `keep_recent_turns` must be a non-negative integer"
            )),
        },
    }
}

// ---------------------------------------------------------------------------
// evict_file_view
// ---------------------------------------------------------------------------

/// Evicts file-view contents from the live context window (reclaim applied by the loop).
pub struct EvictFileViewTool;

#[async_trait]
impl Tool for EvictFileViewTool {
    fn name(&self) -> &str {
        EVICT_FILE_VIEW_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            EVICT_FILE_VIEW_TOOL,
            "Drop file contents you have read but no longer need from your context window, \
             reclaiming space. Give a `path` to evict just that file's views, or omit it to \
             evict every file view. This is safe: the files are unchanged on disk and you can \
             `read_file` them again if you need them later.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path whose file views to evict. Omit to evict all file views."
                    }
                },
                "required": [],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        // Validate only; the loop performs the reclaim against the live window and rewrites
        // this result — including its `ToolData::Reclaim` sidecar — with what was actually
        // reclaimed. This placeholder therefore carries no data of its own: it has not yet
        // happened, and reporting a guess would be worse than reporting nothing.
        match parse_evict_path(&args) {
            Ok(path) => self.evict(path),
            Err(message) => invalid_argument(message),
        }
    }
}

impl EvictFileViewTool {
    /// Validate an `evict_file_view` call — the **standard, typed** API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach. It only
    /// validates: the [loop](crate::agent) performs the reclaim against the live window and rewrites
    /// this outcome (and its [`ToolData::Reclaim`]) with what it actually freed. `None` evicts all
    /// file views; an empty path is refused.
    pub(crate) fn evict(&self, path: Option<String>) -> ToolOutcome {
        if matches!(&path, Some(path) if path.trim().is_empty()) {
            return invalid_argument(format!(
                "`{EVICT_FILE_VIEW_TOOL}`: `path` must not be empty"
            ));
        }
        ToolOutcome::ok("evicting file views", "evict file views")
    }
}

// ---------------------------------------------------------------------------
// archive_thread
// ---------------------------------------------------------------------------

/// Archives older thread history out of the live window, keeping it searchable (reclaim
/// applied by the loop).
pub struct ArchiveThreadTool;

#[async_trait]
impl Tool for ArchiveThreadTool {
    fn name(&self) -> &str {
        ARCHIVE_THREAD_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            ARCHIVE_THREAD_TOOL,
            "Move older parts of this thread out of your context window to reclaim space, \
             keeping the most recent turns. The archived history is NOT lost — it stays \
             searchable with `search_archive`, so you can recover any detail later. By default \
             it keeps your most recent turn and archives everything older; set \
             `keep_recent_turns` to keep more.",
            json!({
                "type": "object",
                "properties": {
                    "keep_recent_turns": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "How many of your most recent assistant turns to keep live (default 1)."
                    }
                },
                "required": [],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        // Validate only; the loop performs the archival against the live window and rewrites this
        // result (and attaches its `ToolData::Reclaim`) with what it actually moved out.
        match parse_archive_keep_recent(&args) {
            Ok(keep_recent_turns) => self.archive(keep_recent_turns),
            Err(message) => invalid_argument(message),
        }
    }
}

impl ArchiveThreadTool {
    /// Validate an `archive_thread` call — the **standard, typed** API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach. It only
    /// validates: the [loop](crate::agent) performs the archival against the live window and rewrites
    /// this outcome (and its [`ToolData::Reclaim`]) with what it actually moved out. `keep_recent_turns`
    /// is the count of most-recent turns to keep live.
    pub(crate) fn archive(&self, _keep_recent_turns: usize) -> ToolOutcome {
        ToolOutcome::ok("archiving thread history", "archive thread")
    }
}

// ---------------------------------------------------------------------------
// search_archive
// ---------------------------------------------------------------------------

/// Searches the out-of-window thread archive for recoverable history.
pub struct SearchArchiveTool {
    archive: Arc<Mutex<ArchiveStore>>,
}

impl SearchArchiveTool {
    /// A tool searching `archive`.
    pub fn new(archive: Arc<Mutex<ArchiveStore>>) -> Self {
        Self { archive }
    }
}

#[async_trait]
impl Tool for SearchArchiveTool {
    fn name(&self) -> &str {
        SEARCH_ARCHIVE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            SEARCH_ARCHIVE_TOOL,
            "Search history you previously archived with `archive_thread` (which is out of \
             your context window but recoverable). Returns the matching archived messages so \
             you can recover detail without keeping the whole thread in context.",
            json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Text to find in the archived thread (case-insensitive substring)."
                    }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let query = match required_str(&args, "query", SEARCH_ARCHIVE_TOOL) {
            Ok(query) => query,
            Err(error) => return error.into(),
        };
        self.search(query)
    }
}

impl SearchArchiveTool {
    /// Search the out-of-window archive — the **standard, typed** `search_archive` API function both
    /// the JSON [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn search(&self, query: String) -> ToolOutcome {
        if query.trim().is_empty() {
            return invalid_argument(format!(
                "`{SEARCH_ARCHIVE_TOOL}`: `query` must not be empty"
            ));
        }

        let archive = self.archive.lock().expect("archive store lock");
        if archive.is_empty() {
            // "Nothing has been archived yet" and "nothing matched" are different answers, and the
            // sidecar keeps them apart exactly as the prose does: a caller told only that the hit
            // list was empty would archive its thread again, believing the first attempt failed.
            return ToolOutcome::ok(
                "The thread archive is empty — nothing has been archived yet.",
                "archive empty",
            )
            .with_data(ToolData::ArchiveSearch(ArchiveSearchData {
                archive_empty: true,
                hits: Vec::new(),
            }));
        }
        let hits = archive.search(&query, SEARCH_RESULT_CAP);
        let data = ToolData::ArchiveSearch(ArchiveSearchData {
            archive_empty: false,
            hits: hits
                .iter()
                .map(|entry| ArchiveHitData {
                    seq: saturating_u32(entry.seq),
                    role: entry.role,
                    text: entry.text.clone(),
                })
                .collect(),
        });
        if hits.is_empty() {
            return ToolOutcome::ok(
                format!("No archived thread history matches `{query}`."),
                format!("no archive match for `{query}`"),
            )
            .with_data(data);
        }

        let mut out = format!("Archived history matching `{query}`:\n");
        for entry in &hits {
            out.push_str(&format!("\n[{}] {}\n", entry.label(), entry.text));
        }
        let summary = format!("{} archive hit(s) for `{query}`", hits.len());
        ToolOutcome::ok(out, summary).with_data(data)
    }
}

#[cfg(test)]
#[path = "context.test.rs"]
mod tests;
