use super::*;
use serde_json::json;
use tempfile::TempDir;

use crate::tools::{Tool, ToolContext};

/// A temp workspace and a context rooted at it.
fn workspace() -> (TempDir, ToolContext) {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    (dir, ctx)
}

/// The `read_file` tool in its default (whole-file) mode. The
/// [read modes](super::ReadPolicy) have their own test file.
fn reader() -> ReadFileTool {
    ReadFileTool::new(ReadPolicy::Unlimited)
}

// ---------------------------------------------------------------------------
// write_file / read_file round-trip
// ---------------------------------------------------------------------------

#[tokio::test]
async fn write_then_read_round_trips() {
    let (dir, ctx) = workspace();

    let write = WriteFileTool
        .invoke(
            json!({ "path": "src/game.js", "contents": "console.log('hi')" }),
            &ctx,
        )
        .await;
    assert!(write.ok, "{}", write.output);
    // Parent directories are created.
    assert!(dir.path().join("src/game.js").exists());

    let read = reader()
        .invoke(json!({ "path": "src/game.js" }), &ctx)
        .await;
    assert!(read.ok);
    assert_eq!(read.output, "console.log('hi')");
}

#[tokio::test]
async fn write_overwrites_existing_file() {
    let (_dir, ctx) = workspace();

    WriteFileTool
        .invoke(json!({ "path": "a.txt", "contents": "one" }), &ctx)
        .await;
    let second = WriteFileTool
        .invoke(json!({ "path": "a.txt", "contents": "two" }), &ctx)
        .await;
    assert!(second.ok);

    let read = reader().invoke(json!({ "path": "a.txt" }), &ctx).await;
    assert_eq!(read.output, "two");
}

#[tokio::test]
async fn read_missing_file_is_an_error() {
    let (_dir, ctx) = workspace();
    let read = reader().invoke(json!({ "path": "nope.txt" }), &ctx).await;
    assert!(!read.ok);
    assert!(read.output.contains("read_file"));
}

// ---------------------------------------------------------------------------
// edit_file
// ---------------------------------------------------------------------------

#[tokio::test]
async fn edit_replaces_a_unique_occurrence() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("f.txt"), "alpha BETA gamma").unwrap();

    let edit = EditFileTool
        .invoke(
            json!({ "path": "f.txt", "old_string": "BETA", "new_string": "DELTA" }),
            &ctx,
        )
        .await;
    assert!(edit.ok, "{}", edit.output);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("f.txt")).unwrap(),
        "alpha DELTA gamma"
    );
}

#[tokio::test]
async fn edit_errors_when_old_string_missing() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("f.txt"), "nothing here").unwrap();

    let edit = EditFileTool
        .invoke(
            json!({ "path": "f.txt", "old_string": "absent", "new_string": "x" }),
            &ctx,
        )
        .await;
    assert!(!edit.ok);
    assert!(edit.output.contains("not found"));
    // The file is left untouched.
    assert_eq!(
        std::fs::read_to_string(dir.path().join("f.txt")).unwrap(),
        "nothing here"
    );
}

#[tokio::test]
async fn edit_errors_when_old_string_is_ambiguous() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("f.txt"), "dup dup dup").unwrap();

    let edit = EditFileTool
        .invoke(
            json!({ "path": "f.txt", "old_string": "dup", "new_string": "x" }),
            &ctx,
        )
        .await;
    assert!(!edit.ok);
    assert!(edit.output.contains("not unique"));
    assert!(edit.output.contains("3 occurrences"));
    // Untouched on an ambiguous match.
    assert_eq!(
        std::fs::read_to_string(dir.path().join("f.txt")).unwrap(),
        "dup dup dup"
    );
}

// ---------------------------------------------------------------------------
// list_dir
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_dir_reports_entries_with_dir_suffix() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("readme.md"), "x").unwrap();
    std::fs::create_dir(dir.path().join("src")).unwrap();

    let list = ListDirTool.invoke(json!({ "path": "." }), &ctx).await;
    assert!(list.ok);
    assert!(list.output.contains("readme.md"));
    assert!(list.output.contains("src/"));
}

#[tokio::test]
async fn list_dir_defaults_to_workspace_root() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("only.txt"), "x").unwrap();

    // No `path` argument at all.
    let list = ListDirTool.invoke(json!({}), &ctx).await;
    assert!(list.ok);
    assert!(list.output.contains("only.txt"));
}

// ---------------------------------------------------------------------------
// Path confinement (the safety property)
// ---------------------------------------------------------------------------

#[test]
fn resolve_within_normalizes_interior_dot_and_dotdot() {
    let root = std::path::Path::new("/ws");
    assert_eq!(
        resolve_within(root, "src/../game.js").unwrap(),
        std::path::Path::new("/ws/game.js")
    );
    assert_eq!(
        resolve_within(root, "./a/b").unwrap(),
        std::path::Path::new("/ws/a/b")
    );
}

#[test]
fn resolve_within_rejects_parent_escape() {
    let root = std::path::Path::new("/ws");
    assert!(resolve_within(root, "../secret").is_err());
    assert!(resolve_within(root, "../../etc/passwd").is_err());
    // Climbs back out after descending: still an escape.
    assert!(resolve_within(root, "a/../../secret").is_err());
}

#[test]
fn resolve_within_rejects_absolute_paths() {
    let root = std::path::Path::new("/ws");
    assert!(resolve_within(root, "/etc/passwd").is_err());
    assert!(resolve_within(root, "/").is_err());
}

/// End-to-end: a tool call with an escaping path fails without touching the target.
#[tokio::test]
async fn tools_reject_escaping_paths() {
    let (_dir, ctx) = workspace();

    let read = reader()
        .invoke(json!({ "path": "../../etc/passwd" }), &ctx)
        .await;
    assert!(!read.ok);
    assert!(read.output.contains("escapes"));

    let write = WriteFileTool
        .invoke(
            json!({ "path": "/tmp/gg-escape-test", "contents": "x" }),
            &ctx,
        )
        .await;
    assert!(!write.ok);
    assert!(write.output.contains("absolute"));
    // Nothing was written outside the workspace.
    assert!(!std::path::Path::new("/tmp/gg-escape-test").exists());
}
