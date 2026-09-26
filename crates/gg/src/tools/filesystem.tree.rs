//! The `tree` tool: the directory tree beneath a root, bounded by a depth, under the ignore files.
//!
//! The [list-dir](test_cabinet_core::gg::CAPABILITY_LIST_DIR) capability's second call, and the one
//! that answers *what is in this workspace* in a single call rather than in a directory's worth of
//! them. It reaches the model on both surfaces: as the `tree` tool here, and as `files.tree` through
//! the [membrane](crate::sandbox).
//!
//! # It answers with rendered text
//!
//! A tree is nested and the [membrane](crate::sandbox) admits no recursive type, so what crosses is
//! the rendering rather than a structure: the root itself unnamed, each level indented two further
//! spaces than its parent, directories suffixed `/`, and every level in path order, so a tree reads
//! as a stack of listings. An empty root renders as `(empty directory)`, the same word a listing of
//! one uses.
//!
//! # The depth bound is stated where it is reached
//!
//! [`depth`](TREE_DEFAULT_DEPTH) counts levels of children below the root, so `1` is a listing.
//! A directory sitting at the bound is suffixed with how many entries it holds that the walk did not
//! enter — `assets/ (12 entries not shown)` — so the bound is legible at the place it bit and the
//! recovery is a deeper `depth` or a `path` rooted there. Counting those entries is what the walk's
//! one extra level is for, and it costs no second `read_dir` and honours the same ignore rule the
//! rest of the tree does.
//!
//! # Bounded, so one tree cannot flood a turn
//!
//! [`TREE_MAX_ENTRIES`] lines and [`TREE_MAX_BYTES`] bytes, whichever binds first, with a trailing
//! line naming what was cut. The byte bound is deliberately well under the
//! [text view cap](crate::agent), because gg's own [opening turn](crate::bootstrap) shows a tree in
//! a view and a bootstrap call that is refused ends the run.

use std::collections::BTreeMap;
use std::path::Path;

use async_trait::async_trait;
use serde_json::{Value, json};

use super::walk::{display_path, workspace_walk};
use super::{
    ApiData, Tool, ToolContext, ToolDefinition, ToolFailure, ToolOutcome, invalid_argument,
    path_param, resolve_path,
};

/// The `tree` tool's name — the one the [tool vocabulary](crate::tools::ALL_TOOL_NAMES) and the
/// [list-dir capability](test_cabinet_core::gg::CAPABILITY_LIST_DIR) name.
pub const TREE_TOOL: &str = "tree";

/// How deep a tree that names no `depth` of its own is walked. Two levels answer *what does this
/// directory hold*, which is the question a model's opening path guesses ask.
pub const TREE_DEFAULT_DEPTH: u32 = 2;

/// The deepest one tree is walked, whatever `depth` asked for. A larger request is answered at this
/// depth rather than refused, on the terms the search's own ceiling is: the caller wanted *deep*,
/// and the ceiling is gg's robustness bound rather than a rule the caller broke.
pub const TREE_MAX_DEPTH: u32 = 10;

/// The most lines one rendered tree carries.
pub const TREE_MAX_ENTRIES: usize = 1_000;

/// The most bytes one rendered tree carries, before the line that says it was cut. Half the
/// [text view cap](crate::agent), so a view of any tree fits whatever the workspace holds.
pub const TREE_MAX_BYTES: usize = 16 * 1024;

/// Renders the directory tree beneath a root, under the ignore files.
pub struct TreeTool;

#[async_trait]
impl Tool for TreeTool {
    fn name(&self) -> &str {
        TREE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            TREE_TOOL,
            format!(
                "Render the directory tree beneath a path, indented two spaces per level, with \
                 directories suffixed `/`. Files excluded by `.gitignore` and its kin are never \
                 walked. `depth` counts levels of children below the root (default \
                 {TREE_DEFAULT_DEPTH}, ceiling {TREE_MAX_DEPTH}); a directory at the bound is \
                 suffixed with how many entries it holds that were not shown."
            ),
            json!({
                "type": "object",
                "properties": {
                    "path": path_param("Directory to walk (default: the workspace root)"),
                    "depth": {
                        "type": "integer",
                        "minimum": 1,
                        "description": format!("How many levels of children below the root to render (default {TREE_DEFAULT_DEPTH}, ceiling {TREE_MAX_DEPTH}).")
                    }
                },
                "required": [],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        let path = match args.get("path") {
            None | Some(Value::Null) => None,
            Some(Value::String(value)) => Some(value.clone()),
            Some(_) => return invalid_argument("`tree`: argument `path` must be a string"),
        };
        let depth = match args.get("depth") {
            None | Some(Value::Null) => None,
            Some(value) => match value.as_u64().and_then(|n| u32::try_from(n).ok()) {
                Some(n) => Some(n),
                None => {
                    return invalid_argument("`tree`: argument `depth` must be a positive integer");
                }
            },
        };
        self.tree(ctx, path, depth)
    }
}

impl TreeTool {
    /// Render a tree — the **standard, typed** `tree` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    ///
    /// `path` roots the tree (`None` is the workspace root) and is `not-found` when it names
    /// nothing and an argument error when it names something that is not a directory. `depth` is
    /// clamped to [`TREE_MAX_DEPTH`] and defaults to [`TREE_DEFAULT_DEPTH`]; zero is an argument
    /// error, because a tree of nothing is not a question.
    pub(crate) fn tree(
        &self,
        ctx: &ToolContext,
        path: Option<String>,
        depth: Option<u32>,
    ) -> ToolOutcome {
        self.tree_within(ctx, path, depth, TREE_MAX_ENTRIES)
    }

    /// [`tree`](Self::tree), rendering at most `max_entries` lines rather than
    /// [`TREE_MAX_ENTRIES`], so the entry ceiling can be exercised on a directory of a dozen
    /// entries.
    fn tree_within(
        &self,
        ctx: &ToolContext,
        path: Option<String>,
        depth: Option<u32>,
        max_entries: usize,
    ) -> ToolOutcome {
        let depth = match depth {
            None => TREE_DEFAULT_DEPTH,
            Some(0) => {
                return invalid_argument(format!(
                    "`depth` must be a positive number of levels (0 given); omit it for the \
                     default of {TREE_DEFAULT_DEPTH}"
                ));
            }
            Some(depth) => depth.min(TREE_MAX_DEPTH),
        };

        let named = path.as_deref().unwrap_or(".");
        let root = match resolve_path(&ctx.workspace_dir, named) {
            Ok(root) => root,
            Err(why) => return invalid_argument(why),
        };
        if !root.exists() {
            return ToolOutcome::failed(
                ToolFailure::NotFound,
                format!("tree: `{named}` does not exist"),
            );
        }
        if !root.is_dir() {
            return invalid_argument(format!("tree: `{named}` is not a directory"));
        }

        let rows = walk_rows(&root, depth);
        let (output, shown, cut) = render(&rows, max_entries);
        let summary = match (shown, cut) {
            (0, _) => "empty".to_string(),
            (shown, false) => format!("{shown} entries"),
            (shown, true) => format!("{shown} entries (cut at {shown})"),
        };
        ToolOutcome::ok(output.clone(), summary).with_data(ApiData::TreeText(output))
    }
}

/// One rendered line of a tree, before the size bounds are applied.
struct Row {
    /// How far below the root this entry sits: `1` for the root's own entries.
    depth: u32,
    /// The entry's path below the root, `/`-separated — the key a bound directory's count is
    /// attached by, so two directories sharing a name keep their own numbers.
    path: String,
    /// The entry's name, with a `/` on a directory.
    name: String,
    /// How many entries a directory at the depth bound holds that the walk did not enter. `0` for
    /// everything else, and for a bound directory that is empty.
    elided: usize,
}

/// Every row of the tree under `root`, in path order, walked one level past `depth` so that a
/// directory sitting at the bound can say how much it is holding back.
fn walk_rows(root: &Path, depth: u32) -> Vec<Row> {
    // `max_depth` counts the root itself as 0, and the extra level is walked to be counted rather
    // than rendered.
    let walk = workspace_walk(root)
        .max_depth(Some(depth as usize + 1))
        .build();

    let mut rows: Vec<Row> = Vec::new();
    // How many children each directory at the bound turned out to hold, keyed by its path below the
    // root. Filled by the extra level and read back once the walk is done.
    let mut held: BTreeMap<String, usize> = BTreeMap::new();

    for entry in walk {
        let entry = match entry {
            Ok(entry) => entry,
            // An entry the walk could not read — a permission it lacks, a link that dangles — is
            // skipped rather than failing the whole tree: the answer is what could be read.
            Err(_) => continue,
        };
        let level = entry.depth() as u32;
        if level == 0 {
            continue;
        }
        if level > depth {
            if let Some(parent) = entry.path().parent() {
                *held.entry(display_path(root, parent)).or_default() += 1;
            }
            continue;
        }
        let directory = entry.file_type().is_some_and(|kind| kind.is_dir());
        let name = entry.file_name().to_string_lossy().into_owned();
        rows.push(Row {
            depth: level,
            path: display_path(root, entry.path()),
            name: match directory {
                true => format!("{name}/"),
                false => name,
            },
            elided: 0,
        });
    }

    for row in &mut rows {
        if let Some(count) = held.get(&row.path) {
            row.elided = *count;
        }
    }
    rows
}

/// The rows as the model reads them, plus how many were shown and whether the size bounds —
/// `max_entries` lines and [`TREE_MAX_BYTES`] bytes — cut the rest.
///
/// An empty tree is `(empty directory)` rather than an empty string, so a view of one is never
/// blank.
fn render(rows: &[Row], max_entries: usize) -> (String, usize, bool) {
    if rows.is_empty() {
        return ("(empty directory)".to_string(), 0, false);
    }
    let mut lines: Vec<String> = Vec::new();
    let mut bytes = 0usize;
    let mut cut = false;
    for row in rows {
        if lines.len() == max_entries {
            cut = true;
            break;
        }
        let line = format!(
            "{}{}{}",
            "  ".repeat(row.depth as usize - 1),
            row.name,
            match row.elided {
                0 => String::new(),
                1 => " (1 entry not shown)".to_string(),
                held => format!(" ({held} entries not shown)"),
            }
        );
        // The newline the join will add is charged here, so the bound is the size of what comes
        // back rather than of the lines it was assembled from.
        if bytes + line.len() + 1 > TREE_MAX_BYTES {
            cut = true;
            break;
        }
        bytes += line.len() + 1;
        lines.push(line);
    }
    let shown = lines.len();
    if shown == 0 {
        // The very first line was already over the byte bound, which only a pathological name can
        // do. Saying nothing at all would be a blank view.
        return ("(empty directory)".to_string(), 0, true);
    }
    if cut {
        lines.push(format!(
            "\n[showing the first {shown} entries; narrow the path or lower the depth to see the \
             rest]"
        ));
    }
    (lines.join("\n"), shown, cut)
}

#[cfg(test)]
#[path = "filesystem.tree.test.rs"]
mod tests;
