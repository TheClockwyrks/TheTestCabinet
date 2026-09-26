//! The **context** tools: `evict_file_view`, `archive_thread` and `search_archive` — how the model
//! reclaims its own window, the complement to the automatic [compaction](crate::compaction)
//! backstop — plus `compact`, how it performs that backstop *itself*.
//!
//! The first three are contributed only when the
//! [`agent-managed-context`](test_cabinet_core::gg::CAPABILITY_AGENT_MANAGED_CONTEXT)
//! capability is enabled; `compact` only under the
//! [self-compaction](crate::compaction::CompactionStrategy::SelfCompaction) compaction strategy.
//!
//! # Why three of these are thin
//!
//! `evict_file_view`, `archive_thread` and `compact` act on the **live context window**, which the
//! loop owns and mutates in place — a tool cannot hold it. So their [`invoke`](super::Tool::invoke)
//! only **validates arguments**; the [loop](crate::agent) performs the actual reclaim against
//! the [`ContextModel`](crate::context::ContextModel) (removing the items, moving archived ones
//! into the shared [`ArchiveStore`], rewriting the window around a summary) and rewrites the tool
//! result with what was reclaimed. The shared argument parsers ([`parse_evict_path`],
//! [`parse_archive_ranges`], [`parse_compact_request`]) are the single source of truth both
//! sides use. `search_archive`, by contrast, is a self-contained store-backed tool (like the memory
//! tools): it reads the shared archive directly and needs nothing from the live window.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{
    ApiData, ArchiveHitData, ArchiveSearchData, Tool, ToolContext, ToolOutcome, invalid_argument,
    required_str, saturating_u32,
};
use crate::archive::ArchiveStore;
use crate::compaction::CompactionRequest;
use crate::context::TurnRange;
use crate::model::ToolDefinition;

/// The `evict_file_view` tool name.
pub const EVICT_FILE_VIEW_TOOL: &str = "evict_file_view";
/// The `archive_thread` tool name.
pub const ARCHIVE_THREAD_TOOL: &str = "archive_thread";
/// The `search_archive` tool name.
pub const SEARCH_ARCHIVE_TOOL: &str = "search_archive";
/// The `compact` tool name.
pub const COMPACT_TOOL: &str = "compact";

/// The most workspace paths one [`compact`](COMPACT_TOOL) call may ask gg to re-read into the
/// restarted context.
///
/// A compaction exists because the window is full, so a call that named forty files would refill it
/// on the spot and trigger the next compaction immediately — the pathological case this bounds. The
/// cap is generous relative to what a model actually needs in hand to continue, and the tool schema
/// states it so a model names no more than gg will re-read.
pub const MAX_COMPACT_FILES: usize = 12;

/// The most turn ranges one [`archive_thread`](ARCHIVE_THREAD_TOOL) call may name.
///
/// Generous relative to any real call — an agent reclaiming space names one span, or a handful of
/// them — and present only so a malformed program cannot hand the loop an unbounded list to scan the
/// window against.
pub const MAX_ARCHIVE_RANGES: usize = 32;

/// The maximum number of hits a single `search_archive` returns, so a broad query cannot
/// itself flood the window it is meant to relieve.
const SEARCH_RESULT_CAP: usize = 8;

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
        Some(_) => Err(format!("`{EVICT_FILE_VIEW_TOOL}`: `path` must be a string")),
    }
}

/// Parse `archive_thread`'s required `ranges` argument into the inclusive
/// [turn ranges](TurnRange) the reclaim selects by. Shared by the tool's validation and the loop's
/// reclaim, so what counts as a well-formed call is one definition rather than two.
///
/// A range is written as a **pair**, `[from, to]`, and an object `{"from": n, "to": m}` is accepted
/// as the same thing — the pair is what the tool schema asks for, and the object is what a model
/// reaching for the more explicit spelling writes anyway. Both ends are inclusive and `from` may not
/// exceed `to`: a reversed range is refused rather than normalized, because the two readings of
/// `[19, 4]` ("nothing" and "turns 4–19") differ by the entire call, and guessing would silently
/// archive a span the model never asked for.
pub fn parse_archive_ranges(args: &Value) -> Result<Vec<TurnRange>, String> {
    let usage = || {
        format!(
            "`{ARCHIVE_THREAD_TOOL}`: `ranges` must be a non-empty array of inclusive turn pairs, \
             e.g. [[4, 19], [22, 25]]"
        )
    };
    let Some(Value::Array(entries)) = args.get("ranges") else {
        return Err(usage());
    };
    if entries.is_empty() || entries.len() > MAX_ARCHIVE_RANGES {
        return Err(usage());
    }
    let mut ranges = Vec::with_capacity(entries.len());
    for entry in entries {
        let (from, to) = match entry {
            Value::Array(pair) if pair.len() == 2 => (pair[0].as_u64(), pair[1].as_u64()),
            Value::Object(_) => (
                entry.get("from").and_then(Value::as_u64),
                entry.get("to").and_then(Value::as_u64),
            ),
            _ => return Err(usage()),
        };
        let (Some(from), Some(to)) = (from, to) else {
            return Err(usage());
        };
        if from > to {
            return Err(format!(
                "`{ARCHIVE_THREAD_TOOL}`: the range [{from}, {to}] ends before it starts"
            ));
        }
        ranges.push(TurnRange { from, to });
    }
    Ok(ranges)
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
            "Drop file contents out of your context window to reclaim space; `read_file` \
             recovers them.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to evict, spelled as you read it. Omit to evict every file view."
                    }
                },
                "required": [],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        // Validate only; the loop performs the reclaim against the live window and rewrites
        // this result — including its `ApiData::Reclaim` sidecar — with what was actually
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
    /// this outcome (and its [`ApiData::Reclaim`]) with what it actually freed. `None` evicts all
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
            "Move whole turns out of your context window to reclaim space. Archived turns stay \
             searchable with `search_archive`.",
            json!({
                "type": "object",
                "properties": {
                    "ranges": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": MAX_ARCHIVE_RANGES,
                        "items": {
                            "type": "array",
                            "minItems": 2,
                            "maxItems": 2,
                            "items": { "type": "integer", "minimum": 0 }
                        },
                        "description": "Inclusive [from, to] pairs of the turn numbers in result headers, e.g. [[4, 19], [22, 25]]."
                    }
                },
                "required": ["ranges"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        // Validate only; the loop performs the archival against the live window and rewrites this
        // result (and attaches its `ApiData::Reclaim`) with what it actually moved out.
        match parse_archive_ranges(&args) {
            Ok(ranges) => self.archive(ranges),
            Err(message) => invalid_argument(message),
        }
    }
}

impl ArchiveThreadTool {
    /// Validate an `archive_thread` call — the **standard, typed** API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach. It only
    /// validates: the [loop](crate::agent) performs the archival against the live window and rewrites
    /// this outcome (and its [`ApiData::Reclaim`]) with what it actually moved out. `ranges` are the
    /// inclusive turn spans to move into the archive.
    pub(crate) fn archive(&self, ranges: Vec<TurnRange>) -> ToolOutcome {
        // The typed entry point is reachable without going through the JSON schema (a program calls
        // it directly), so the same rules are enforced here rather than assumed.
        if ranges.is_empty() || ranges.len() > MAX_ARCHIVE_RANGES {
            return invalid_argument(format!(
                "`{ARCHIVE_THREAD_TOOL}`: name between 1 and {MAX_ARCHIVE_RANGES} inclusive turn \
                 ranges to archive"
            ));
        }
        if let Some(range) = ranges.iter().find(|range| range.from > range.to) {
            return invalid_argument(format!(
                "`{ARCHIVE_THREAD_TOOL}`: the range [{}, {}] ends before it starts",
                range.from, range.to
            ));
        }
        ToolOutcome::ok("archiving thread history", "archive thread")
    }
}

// ---------------------------------------------------------------------------
// compact
// ---------------------------------------------------------------------------

/// Parse a [`compact`](COMPACT_TOOL) call's arguments into the
/// [request](CompactionRequest) a compaction is rewritten from: a required non-empty `summary` and
/// an optional `files` array of workspace paths.
///
/// Shared by the tool's own validation, the [loop](crate::agent)'s application of an accepted call,
/// and the [handoff compactor](crate::compaction::HandoffCompactor)'s reading of the separate
/// model's answer — so what counts as a well-formed `compact` call is one definition rather than
/// three.
///
/// Paths are trimmed, blanks dropped, duplicates collapsed (re-reading the same file twice would
/// simply spend the window twice) and the list capped at [`MAX_COMPACT_FILES`]. A `files` value that
/// is not an array of strings is a usage error rather than a silent empty list: a model that asked
/// for files and got none back would continue believing it had them.
pub fn parse_compact_request(args: &Value) -> Result<CompactionRequest, String> {
    let summary = args
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|summary| !summary.is_empty())
        .ok_or_else(|| format!("`{COMPACT_TOOL}`: `summary` must be a non-empty string"))?
        .to_string();

    let files = match args.get("files") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(entries)) => {
            let mut paths: Vec<String> = Vec::new();
            for entry in entries {
                let path = entry.as_str().ok_or_else(|| {
                    format!(
                        "`{COMPACT_TOOL}`: every entry of `files` must be a workspace path string"
                    )
                })?;
                let path = path.trim();
                if path.is_empty() || paths.iter().any(|seen| seen == path) {
                    continue;
                }
                paths.push(path.to_string());
            }
            paths.truncate(MAX_COMPACT_FILES);
            paths
        }
        Some(_) => {
            return Err(format!(
                "`{COMPACT_TOOL}`: `files` must be an array of workspace path strings"
            ));
        }
    };

    Ok(CompactionRequest { summary, files })
}

/// Compacts the agent's own context window: replaces the thread with a summary and re-reads the
/// named files (rewrite applied by the loop).
pub struct CompactTool;

#[async_trait]
impl Tool for CompactTool {
    fn name(&self) -> &str {
        COMPACT_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            COMPACT_TOOL,
            "Restart your context window from the `summary` you write plus a fresh read of \
             `files`. Your skills, memories and task list are kept; the rest of the thread is \
             dropped.",
            json!({
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "The working state to continue from: what you are building, the decisions and discoveries that matter, the files you have changed, what is in progress, and the next step."
                    },
                    "files": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": format!("Workspace paths to re-read into the restarted context, at most {MAX_COMPACT_FILES}.")
                    }
                },
                "required": ["summary"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        // Validate only; the loop performs the rewrite against the live window (and re-reads the
        // files) and replaces this result with what it actually did.
        match parse_compact_request(&args) {
            Ok(request) => self.compact(request.summary, request.files),
            Err(message) => invalid_argument(message),
        }
    }
}

impl CompactTool {
    /// Validate a `compact` call — the **standard, typed** API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach. It only
    /// validates: the [loop](crate::agent) rewrites the window and replaces this outcome with what
    /// it actually compacted.
    pub(crate) fn compact(&self, summary: String, files: Vec<String>) -> ToolOutcome {
        let mut args = json!({ "summary": summary });
        args["files"] = Value::Array(files.into_iter().map(Value::String).collect());
        match parse_compact_request(&args) {
            Ok(_) => ToolOutcome::ok("compacting the context window", "compact context"),
            Err(message) => invalid_argument(message),
        }
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
            "Search the turns you moved out of context with `archive_thread`.",
            json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Case-insensitive substring to match."
                    }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let query = match required_str(&args, "query") {
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
            .with_data(ApiData::ArchiveSearch(ArchiveSearchData {
                archive_empty: true,
                hits: Vec::new(),
            }));
        }
        let hits = archive.search(&query, SEARCH_RESULT_CAP);
        let data = ApiData::ArchiveSearch(ArchiveSearchData {
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
