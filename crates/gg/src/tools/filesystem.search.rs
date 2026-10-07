//! The `search` tool: content search over the workspace, under the ignore files.
//!
//! The fifth filesystem primitive, and the one that finds where to point the other four. It is its
//! own [capability](test_cabinet_core::gg::CAPABILITY_SEARCH) for the same reason each of them is —
//! a study withholds or reconfigures one without disturbing the rest — and it reaches the model on
//! both surfaces: as the `search` tool here, and as `files.search` through the
//! [membrane](crate::sandbox).
//!
//! # Ignoring is the search's own rule
//!
//! What `.gitignore`, `.ignore` and their kin exclude is never scanned and never returned, `.git`
//! itself included, under the [one workspace walk](super::walk) this and the tree share. That is
//! deliberately unlike every other tool on this surface, which reach any path they are handed: a
//! search is a question about the *project* rather than about the disk, and a match list that
//! carried `node_modules`, build output and the run's own bookkeeping would answer a question nobody
//! asked while burying the one they did. A file under an ignored path is still reachable by path
//! through `read_file` and its siblings.
//!
//! # Bounded, so one search cannot flood a turn
//!
//! Three bounds, all stated to the model. The match list is capped at [`SEARCH_MAX_LIMIT`] and
//! defaults to [`SEARCH_DEFAULT_LIMIT`]; each matching line is clipped at [`SEARCH_LINE_CLIP`]
//! characters and annotated in place with how many were dropped, in the same form a file view's
//! `maxLineChars` uses; and a file that is not text — one carrying a NUL byte — is skipped rather
//! than matched byte by byte. A list exactly `limit` long may therefore have been cut, and the prose
//! says so; the structured result leaves that to the caller's arithmetic, because a search has no
//! offset and is not a way of reading a file.
//!
//! # The query is a regular expression
//!
//! Rust [`regex`] syntax, matched against each line on its own, case-sensitive unless the pattern
//! says otherwise (`(?i)`). A pattern is what a model reaching for `grep` expects to write, and the
//! syntax is documented to it beside the call. A blank query and an invalid pattern are both
//! argument errors: *you asked for nothing* and *nothing matched* are different answers.

use std::io::{BufRead, BufReader};
use std::path::Path;

use async_trait::async_trait;
use serde_json::{Value, json};

use super::walk::{display_path, workspace_walk};
use super::{
    ApiData, Tool, ToolContext, ToolDefinition, ToolFailure, ToolOutcome, invalid_argument,
    path_param, resolve_path,
};
use crate::tools::SearchMatchData;

/// The `search` tool's name — the one the [tool vocabulary](crate::tools::ALL_TOOL_NAMES) and the
/// [search capability](test_cabinet_core::gg::CAPABILITY_SEARCH) name.
pub const SEARCH_TOOL: &str = "search";

/// How many matches a search that names no `limit` of its own returns.
pub const SEARCH_DEFAULT_LIMIT: u32 = 50;

/// The most matches one search returns, whatever `limit` asked for. A larger request is answered
/// with the first this many rather than refused: the caller wanted *many*, and the ceiling is gg's
/// robustness bound rather than a rule the caller broke.
pub const SEARCH_MAX_LIMIT: u32 = 200;

/// The most characters of a matching line one match carries. A longer line is cut here and
/// annotated in place — `foo (123 more chars...)` — so a minified bundle or a data file cannot put
/// 200 lines of 10,000 characters into one turn.
pub const SEARCH_LINE_CLIP: usize = 200;

/// How many leading bytes of a file are inspected for a NUL before it is scanned as text.
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

/// Searches the workspace's files for a pattern, under the ignore files.
pub struct SearchTool;

#[async_trait]
impl Tool for SearchTool {
    fn name(&self) -> &str {
        SEARCH_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            SEARCH_TOOL,
            format!(
                "Search the workspace's files for a regular expression and return the matching \
                 lines, each as `path:line: text`. Files excluded by `.gitignore` and its kin are \
                 never scanned. Returns at most `limit` matches (default {SEARCH_DEFAULT_LIMIT}, \
                 ceiling {SEARCH_MAX_LIMIT}); a list exactly that long may have been cut, so \
                 narrow the query or the path rather than paging."
            ),
            json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The pattern to look for — a Rust-syntax regular expression matched against each line on its own (`(?i)` for a case-insensitive match)."
                    },
                    "path": path_param("Directory or file to search (default: the workspace root)"),
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "description": format!("How many matches to return at most (default {SEARCH_DEFAULT_LIMIT}, ceiling {SEARCH_MAX_LIMIT}).")
                    }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        let query = match args.get("query") {
            Some(Value::String(query)) => query.clone(),
            _ => return invalid_argument("`search`: argument `query` must be a string"),
        };
        let path = match args.get("path") {
            None | Some(Value::Null) => None,
            Some(Value::String(value)) => Some(value.clone()),
            Some(_) => return invalid_argument("`search`: argument `path` must be a string"),
        };
        let limit = match args.get("limit") {
            None | Some(Value::Null) => None,
            Some(value) => match value.as_u64().and_then(|n| u32::try_from(n).ok()) {
                Some(n) => Some(n),
                None => {
                    return invalid_argument(
                        "`search`: argument `limit` must be a positive integer",
                    );
                }
            },
        };
        self.search(ctx, query, path, limit)
    }
}

impl SearchTool {
    /// Search — the **standard, typed** `search` API function both the JSON [adapter](Tool::invoke)
    /// and the [responses-as-code membrane](crate::sandbox) reach.
    ///
    /// `path` roots the search (`None` is the workspace root; a file searches that one file) and is
    /// `not-found` when it names nothing. `limit` is clamped to [`SEARCH_MAX_LIMIT`] and defaults to
    /// [`SEARCH_DEFAULT_LIMIT`]; zero is an argument error, because a search for nothing is not a
    /// question.
    pub(crate) fn search(
        &self,
        ctx: &ToolContext,
        query: String,
        path: Option<String>,
        limit: Option<u32>,
    ) -> ToolOutcome {
        if query.trim().is_empty() {
            return invalid_argument("`query` must not be blank");
        }
        let pattern = match regex::Regex::new(&query) {
            Ok(pattern) => pattern,
            Err(error) => {
                return invalid_argument(format!(
                    "`query` is not a valid regular expression: {error}"
                ));
            }
        };
        let limit = match limit {
            None => SEARCH_DEFAULT_LIMIT,
            Some(0) => {
                return invalid_argument(format!(
                    "`limit` must be a positive number of matches (0 given); omit it for the \
                     default of {SEARCH_DEFAULT_LIMIT}"
                ));
            }
            Some(limit) => limit.min(SEARCH_MAX_LIMIT),
        } as usize;

        let root = match resolve_path(&ctx.workspace_dir, path.as_deref().unwrap_or(".")) {
            Ok(root) => root,
            Err(why) => return invalid_argument(why),
        };
        if !root.exists() {
            return ToolOutcome::failed(
                ToolFailure::NotFound,
                format!(
                    "search: `{}` does not exist",
                    path.as_deref().unwrap_or(".")
                ),
            );
        }

        let mut matches: Vec<SearchMatchData> = Vec::new();
        let mut cut = false;
        for entry in workspace_walk(&root).build() {
            let entry = match entry {
                Ok(entry) => entry,
                // An entry the walk could not read — a permission it lacks, a link that dangles —
                // is skipped rather than failing the whole search: the answer is what could be
                // read, and a search that failed over one unreadable file would fail forever.
                Err(_) => continue,
            };
            if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                continue;
            }
            let display = display_path(&ctx.workspace_dir, entry.path());
            let Some(remaining) = limit.checked_sub(matches.len()).filter(|&left| left > 0) else {
                cut = true;
                break;
            };
            if scan_file(entry.path(), &display, &pattern, remaining, &mut matches) {
                cut = true;
                break;
            }
        }

        let count = matches.len();
        let output = if matches.is_empty() {
            "(no matches)".to_string()
        } else {
            let mut lines: Vec<String> = matches
                .iter()
                .map(|found| format!("{}:{}: {}", found.path, found.line, found.text))
                .collect();
            if cut {
                lines.push(format!(
                    "\n[showing the first {count} matches; narrow the query or the path to see \
                     the rest]"
                ));
            }
            lines.join("\n")
        };
        let summary = match (count, cut) {
            (0, _) => "no matches".to_string(),
            (count, false) => format!("{count} matches"),
            (count, true) => format!("{count} matches (cut at {count})"),
        };
        ToolOutcome::ok(output, summary).with_data(ApiData::SearchMatches(matches))
    }
}

/// Scan one file line by line, pushing at most `remaining` matches, and report whether the file
/// still had matches to give when that budget ran out.
///
/// A file carrying a NUL byte in its opening bytes — or anywhere in a line it reaches — is not
/// text, and is left as soon as that is known. Lines are decoded lossily so a stray invalid byte in
/// an otherwise textual file does not hide the file.
fn scan_file(
    path: &Path,
    display: &str,
    pattern: &regex::Regex,
    remaining: usize,
    matches: &mut Vec<SearchMatchData>,
) -> bool {
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let mut reader = BufReader::new(file);
    if let Ok(head) = reader.fill_buf() {
        let sniffed = &head[..head.len().min(BINARY_SNIFF_BYTES)];
        if sniffed.contains(&0) {
            return false;
        }
    }
    let mut pushed = 0usize;
    let mut number: u32 = 0;
    let mut raw = Vec::new();
    loop {
        raw.clear();
        match reader.read_until(b'\n', &mut raw) {
            Ok(0) | Err(_) => return false,
            Ok(_) => {}
        }
        if raw.contains(&0) {
            return false;
        }
        number = number.saturating_add(1);
        let line = String::from_utf8_lossy(&raw);
        let line = line.trim_end_matches(['\n', '\r']);
        if !pattern.is_match(line) {
            continue;
        }
        if pushed == remaining {
            return true;
        }
        matches.push(SearchMatchData {
            path: display.to_string(),
            line: number,
            text: clip_line(line, SEARCH_LINE_CLIP),
        });
        pushed += 1;
    }
}

/// `line` cut at `max` characters and annotated with how many were dropped — `foo (123 more
/// chars...)` — or the line whole when it fits. The cut is at a character boundary, never inside
/// a multi-byte sequence, and counts characters rather than bytes, because the annotation is read
/// by a model that counts what it sees.
///
/// Shared with the file view's `maxLineChars`, which cuts on exactly these terms, so the two
/// annotations a model meets read alike.
pub(crate) fn clip_line(line: &str, max: usize) -> String {
    let mut chars = line.char_indices();
    let Some((cut, _)) = chars.nth(max) else {
        return line.to_string();
    };
    let dropped = line[cut..].chars().count();
    format!("{} ({dropped} more chars...)", &line[..cut])
}

#[cfg(test)]
#[path = "filesystem.search.test.rs"]
mod tests;
