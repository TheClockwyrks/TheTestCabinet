//! The filesystem tools: read, write, edit, and list files in the workspace.
//!
//! gg runs inside the run container, so these tools operate on the **local**
//! filesystem. Every path a tool accepts is workspace-*relative* and is resolved,
//! and confined, to the invocation's workspace root by [`resolve_within`]: an
//! absolute path or a `..` sequence that would climb above the root is rejected
//! before any I/O happens. This confinement is a real safety property (a run must not
//! read or clobber files outside its seeded workspace), enforced purely lexically so
//! it is deterministic and unit-testable.
//!
//! The four tools mirror the editor primitives a coding agent needs, including
//! `edit_file`'s **exact unique replacement** semantics (matching this repo's own
//! `Edit`: the `old_string` must occur exactly once). All are contributed only when
//! the [`filesystem`](test_cabinet_core::gg::CAPABILITY_FILESYSTEM) capability is
//! enabled.

use std::path::{Component, Path, PathBuf};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{Tool, ToolContext, ToolOutcome, required_str};
use crate::model::ToolDefinition;

/// Ceiling on the bytes `read_file` returns to the model, so a huge file cannot flood
/// context. The file is read up to this cap with a truncation note.
const READ_FILE_CAP: usize = 256 * 1024;

// ---------------------------------------------------------------------------
// Path confinement
// ---------------------------------------------------------------------------

/// Resolve a workspace-relative `rel` path against the workspace `root`, refusing any
/// path that would escape the root.
///
/// The check is **lexical**: `rel` must be relative (an absolute path or one with a
/// drive/root prefix is rejected), and its normalized form must never pop above the
/// root (a leading or interior `..` that climbs past the root is rejected). `.` and
/// interior `..` that stay within the tree are normalized away. The returned path is
/// `root` joined with the normalized remainder.
///
/// Confinement is lexical by design: it makes no filesystem call, so it is
/// deterministic and testable and cannot be defeated by a race. (It does not resolve
/// symlinks; the seeded workspace is trusted not to contain adversarial links out of
/// the tree in Phase 0.)
pub fn resolve_within(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.trim().is_empty() {
        return Err("path must not be empty".to_string());
    }

    let mut normalized = PathBuf::new();
    for component in Path::new(rel).components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {
                return Err(format!(
                    "path `{rel}` must be workspace-relative, not absolute"
                ));
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!("path `{rel}` escapes the workspace root via `..`"));
                }
            }
            Component::Normal(part) => normalized.push(part),
        }
    }

    Ok(root.join(normalized))
}

/// Resolve `field` from `args` as a required workspace-relative path, mapping both a
/// missing/ill-typed argument and an escape attempt to a tool error string.
fn resolve_arg(args: &Value, field: &str, tool: &str, root: &Path) -> Result<PathBuf, String> {
    let rel = required_str(args, field, tool)?;
    resolve_within(root, &rel).map_err(|why| format!("`{tool}`: {why}"))
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

/// Reads a file's contents (capped), workspace-relative.
pub struct ReadFileTool;

#[async_trait]
impl Tool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "read_file",
            "Read a UTF-8 text file from the workspace and return its contents \
             (truncated if very large).",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path to the file to read."
                    }
                },
                "required": ["path"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        let path = match resolve_arg(&args, "path", "read_file", &ctx.workspace_dir) {
            Ok(path) => path,
            Err(message) => return ToolOutcome::error(message),
        };

        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(err) => return ToolOutcome::error(format!("read_file: {err}")),
        };

        let total = bytes.len();
        let truncated = total > READ_FILE_CAP;
        let slice = if truncated {
            &bytes[..READ_FILE_CAP]
        } else {
            &bytes[..]
        };
        let mut contents = String::from_utf8_lossy(slice).into_owned();
        if truncated {
            contents.push_str(&format!(
                "\n\n[truncated: showing {READ_FILE_CAP} of {total} bytes]"
            ));
        }

        ToolOutcome::ok(contents, format!("read {total} bytes"))
    }
}

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

/// Writes (creating or overwriting) a file, workspace-relative.
pub struct WriteFileTool;

#[async_trait]
impl Tool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "write_file",
            "Write UTF-8 text to a file in the workspace, creating parent directories \
             and overwriting any existing file.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path to write."
                    },
                    "contents": {
                        "type": "string",
                        "description": "The file's full contents."
                    }
                },
                "required": ["path", "contents"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        let path = match resolve_arg(&args, "path", "write_file", &ctx.workspace_dir) {
            Ok(path) => path,
            Err(message) => return ToolOutcome::error(message),
        };
        let contents = match required_str(&args, "contents", "write_file") {
            Ok(contents) => contents,
            Err(message) => return ToolOutcome::error(message),
        };

        if let Some(parent) = path.parent()
            && let Err(err) = std::fs::create_dir_all(parent)
        {
            return ToolOutcome::error(format!("write_file: creating parent dirs: {err}"));
        }
        if let Err(err) = std::fs::write(&path, contents.as_bytes()) {
            return ToolOutcome::error(format!("write_file: {err}"));
        }

        let bytes = contents.len();
        ToolOutcome::ok(
            format!("wrote {bytes} bytes"),
            format!("wrote {bytes} bytes"),
        )
    }
}

// ---------------------------------------------------------------------------
// edit_file
// ---------------------------------------------------------------------------

/// Replaces an exact, unique occurrence of a string in a file (this repo's `Edit`
/// semantics).
pub struct EditFileTool;

#[async_trait]
impl Tool for EditFileTool {
    fn name(&self) -> &str {
        "edit_file"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "edit_file",
            "Replace an exact occurrence of `old_string` with `new_string` in a \
             workspace file. `old_string` must appear exactly once; the edit fails if \
             it is missing or ambiguous.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path to edit."
                    },
                    "old_string": {
                        "type": "string",
                        "description": "The exact text to replace (must be unique in the file)."
                    },
                    "new_string": {
                        "type": "string",
                        "description": "The replacement text."
                    }
                },
                "required": ["path", "old_string", "new_string"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        let path = match resolve_arg(&args, "path", "edit_file", &ctx.workspace_dir) {
            Ok(path) => path,
            Err(message) => return ToolOutcome::error(message),
        };
        let old_string = match required_str(&args, "old_string", "edit_file") {
            Ok(value) => value,
            Err(message) => return ToolOutcome::error(message),
        };
        let new_string = match required_str(&args, "new_string", "edit_file") {
            Ok(value) => value,
            Err(message) => return ToolOutcome::error(message),
        };

        if old_string.is_empty() {
            return ToolOutcome::error("edit_file: `old_string` must not be empty".to_string());
        }
        if old_string == new_string {
            return ToolOutcome::error(
                "edit_file: `old_string` and `new_string` are identical; nothing to change"
                    .to_string(),
            );
        }

        let contents = match std::fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(err) => return ToolOutcome::error(format!("edit_file: {err}")),
        };

        let occurrences = contents.matches(&old_string).count();
        match occurrences {
            0 => {
                return ToolOutcome::error(
                    "edit_file: `old_string` was not found in the file".to_string(),
                );
            }
            1 => {}
            n => {
                return ToolOutcome::error(format!(
                    "edit_file: `old_string` is not unique ({n} occurrences); \
                     include more surrounding context to make it unique"
                ));
            }
        }

        let updated = contents.replacen(&old_string, &new_string, 1);
        if let Err(err) = std::fs::write(&path, updated.as_bytes()) {
            return ToolOutcome::error(format!("edit_file: writing back: {err}"));
        }

        ToolOutcome::ok("replaced 1 occurrence", "edited (1 replacement)")
    }
}

// ---------------------------------------------------------------------------
// list_dir
// ---------------------------------------------------------------------------

/// Lists a directory's entries, workspace-relative.
pub struct ListDirTool;

#[async_trait]
impl Tool for ListDirTool {
    fn name(&self) -> &str {
        "list_dir"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "list_dir",
            "List the entries of a directory in the workspace. Directories are \
             suffixed with `/`. Defaults to the workspace root.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative directory (defaults to `.`)."
                    }
                },
                "required": [],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        // `path` is optional here and defaults to the workspace root.
        let rel = match args.get("path") {
            None | Some(Value::Null) => ".".to_string(),
            Some(Value::String(value)) => value.clone(),
            Some(_) => {
                return ToolOutcome::error(
                    "`list_dir`: argument `path` must be a string".to_string(),
                );
            }
        };
        let dir = match resolve_within(&ctx.workspace_dir, &rel) {
            Ok(dir) => dir,
            Err(why) => return ToolOutcome::error(format!("`list_dir`: {why}")),
        };

        let read = match std::fs::read_dir(&dir) {
            Ok(read) => read,
            Err(err) => return ToolOutcome::error(format!("list_dir: {err}")),
        };

        let mut entries: Vec<String> = Vec::new();
        for entry in read {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => return ToolOutcome::error(format!("list_dir: {err}")),
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            entries.push(if is_dir { format!("{name}/") } else { name });
        }
        entries.sort();

        let count = entries.len();
        let output = if entries.is_empty() {
            "(empty directory)".to_string()
        } else {
            entries.join("\n")
        };
        ToolOutcome::ok(output, format!("{count} entries"))
    }
}

#[cfg(test)]
#[path = "filesystem.test.rs"]
mod tests;
