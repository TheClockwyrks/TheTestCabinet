use super::*;
use serde_json::json;
use tempfile::TempDir;

use crate::tools::{Tool, ToolContext, ToolFailure};

/// The [`DirEntryData`] list an outcome carries, or a failure naming what it carried instead.
fn dir_entries(outcome: &ToolOutcome) -> &[DirEntryData] {
    match outcome.data.as_ref() {
        Some(ApiData::DirEntries(entries)) => entries,
        other => panic!("expected directory entries, got {other:?}"),
    }
}

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
    assert!(read.output.contains("nope.txt"), "{}", read.output);
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
// The structured sidecar
// ---------------------------------------------------------------------------

/// `list_dir` reports each entry's kind as a value, so a caller filtering for files does not have
/// to strip a `/` off a rendered name — and reports the name without that suffix.
#[tokio::test]
async fn list_dir_reports_each_entrys_kind() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("readme.md"), "x").unwrap();
    std::fs::create_dir(dir.path().join("src")).unwrap();

    let list = ListDirTool.invoke(json!({ "path": "." }), &ctx).await;

    assert_eq!(
        dir_entries(&list),
        [
            DirEntryData {
                name: "readme.md".to_string(),
                kind: DirEntryKind::File,
            },
            DirEntryData {
                name: "src".to_string(),
                kind: DirEntryKind::Directory,
            },
        ],
        "entries follow the prose's order, with the kind as a value and no `/` on the name"
    );
}

/// An empty directory is an empty list, not an absent one — a caller can iterate the result of any
/// successful listing.
#[tokio::test]
async fn an_empty_directory_lists_no_entries() {
    let (_dir, ctx) = workspace();
    let list = ListDirTool.invoke(json!({ "path": "." }), &ctx).await;

    assert!(list.ok);
    assert!(dir_entries(&list).is_empty());
}

/// `write_file` reports how many bytes it wrote.
#[tokio::test]
async fn write_file_reports_the_bytes_written() {
    let (_dir, ctx) = workspace();
    let write = WriteFileTool
        .invoke(json!({ "path": "a.txt", "contents": "héllo" }), &ctx)
        .await;

    assert_eq!(write.data, Some(ApiData::BytesWritten(6)));
}

/// `read_file` reports the window it returned and the file's length, footer-free.
#[tokio::test]
async fn read_file_reports_the_window_it_returned() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("f.txt"), "one\ntwo\nthree\n").unwrap();

    let read = reader().invoke(json!({ "path": "f.txt" }), &ctx).await;

    match read.data {
        Some(ApiData::FileText(data)) => {
            assert_eq!(data.contents, "one\ntwo\nthree\n");
            assert_eq!(
                (data.first_line, data.last_line, data.total_lines),
                (1, 3, 3)
            );
            assert!(!data.byte_truncated);
        }
        other => panic!("expected file text, got {other:?}"),
    }
}

/// The tools that only confirm — `edit_file` — say so by carrying no sidecar at all, rather than
/// an empty one a caller would have to interpret.
#[tokio::test]
async fn a_bare_confirmation_carries_no_sidecar() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("f.txt"), "alpha BETA gamma").unwrap();

    let edit = EditFileTool
        .invoke(
            json!({ "path": "f.txt", "old_string": "BETA", "new_string": "DELTA" }),
            &ctx,
        )
        .await;

    assert!(edit.ok);
    assert_eq!(edit.data, None);
    assert_eq!(edit.failure, None);
}

// ---------------------------------------------------------------------------
// Classified failures
// ---------------------------------------------------------------------------

/// `edit_file`'s two ways of not applying are two different classes, because they have two
/// different recoveries: re-read the file, or add surrounding context.
#[tokio::test]
async fn edit_file_distinguishes_a_missing_match_from_an_ambiguous_one() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("f.txt"), "dup dup dup").unwrap();

    let missing = EditFileTool
        .invoke(
            json!({ "path": "f.txt", "old_string": "absent", "new_string": "x" }),
            &ctx,
        )
        .await;
    assert_eq!(missing.failure, Some(ToolFailure::NotFound));

    let ambiguous = EditFileTool
        .invoke(
            json!({ "path": "f.txt", "old_string": "dup", "new_string": "x" }),
            &ctx,
        )
        .await;
    assert_eq!(ambiguous.failure, Some(ToolFailure::Conflict));
}

/// A file that is not there is `not-found` on every tool that touches one, so a caller branches on
/// one class rather than on three different sentences.
#[tokio::test]
async fn a_missing_path_is_classified_not_found() {
    let (_dir, ctx) = workspace();

    let read = reader().invoke(json!({ "path": "nope.txt" }), &ctx).await;
    assert_eq!(read.failure, Some(ToolFailure::NotFound));

    let edit = EditFileTool
        .invoke(
            json!({ "path": "nope.txt", "old_string": "a", "new_string": "b" }),
            &ctx,
        )
        .await;
    assert_eq!(edit.failure, Some(ToolFailure::NotFound));

    let list = ListDirTool
        .invoke(json!({ "path": "no/such/dir" }), &ctx)
        .await;
    assert_eq!(list.failure, Some(ToolFailure::NotFound));
}

/// Everything a caller got wrong about its arguments — a missing one, an ill-typed one, an
/// out-of-range one, and an empty path — is one class.
#[tokio::test]
async fn argument_diagnostics_are_classified_as_invalid_arguments() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("f.txt"), "one\ntwo\n").unwrap();

    let cases: Vec<(&str, ToolOutcome)> = vec![
        (
            "a missing argument",
            WriteFileTool.invoke(json!({ "path": "a.txt" }), &ctx).await,
        ),
        (
            "an ill-typed argument",
            ListDirTool.invoke(json!({ "path": 7 }), &ctx).await,
        ),
        (
            "a non-positive paging argument",
            ReadFileTool::new(ReadPolicy::DefaultCap(10))
                .invoke(json!({ "path": "f.txt", "limit": 0 }), &ctx)
                .await,
        ),
        (
            "an offset past the end",
            ReadFileTool::new(ReadPolicy::DefaultCap(10))
                .invoke(json!({ "path": "f.txt", "offset": 99 }), &ctx)
                .await,
        ),
        (
            "an empty path",
            WriteFileTool
                .invoke(json!({ "path": "  ", "contents": "x" }), &ctx)
                .await,
        ),
        (
            "an empty `old_string`",
            EditFileTool
                .invoke(
                    json!({ "path": "f.txt", "old_string": "", "new_string": "x" }),
                    &ctx,
                )
                .await,
        ),
    ];

    for (what, outcome) in cases {
        assert_eq!(
            outcome.failure,
            Some(ToolFailure::InvalidArgument),
            "{what} should be an argument diagnostic: {}",
            outcome.output
        );
    }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

#[test]
fn resolve_path_joins_a_relative_path_onto_the_working_directory() {
    let cwd = std::path::Path::new("/ws");
    assert_eq!(
        resolve_path(cwd, "src/game.js").unwrap(),
        std::path::Path::new("/ws/src/game.js")
    );
    assert_eq!(
        resolve_path(cwd, "./a/b").unwrap(),
        std::path::Path::new("/ws/./a/b")
    );
}

/// `..` is an ordinary component now, left in the path for the kernel to resolve rather than
/// normalized away — which is also the only reading that stays correct through a symlink.
#[test]
fn resolve_path_carries_parent_components_through() {
    let cwd = std::path::Path::new("/ws");
    assert_eq!(
        resolve_path(cwd, "../secret").unwrap(),
        std::path::Path::new("/ws/../secret")
    );
}

/// An absolute path is the destination, not an error: gg's own shell offloads output to
/// `/tmp/gg-shell` and tells the agent to read it there.
#[test]
fn resolve_path_passes_an_absolute_path_through() {
    let cwd = std::path::Path::new("/ws");
    assert_eq!(
        resolve_path(cwd, "/tmp/gg-shell/cmd-1-0001.stdout").unwrap(),
        std::path::Path::new("/tmp/gg-shell/cmd-1-0001.stdout")
    );
}

/// The one path that is still refused, because joined onto the working directory it would name
/// that directory rather than a file in it.
#[test]
fn resolve_path_rejects_an_empty_path() {
    assert!(resolve_path(std::path::Path::new("/ws"), "").is_err());
    assert!(resolve_path(std::path::Path::new("/ws"), "   ").is_err());
}

/// End-to-end: the tools read and write outside the workspace root, by an absolute path and by
/// one that climbs out of it.
#[tokio::test]
async fn tools_reach_outside_the_workspace() {
    let (_dir, ctx) = workspace();
    let elsewhere = TempDir::new().unwrap();

    let target = elsewhere.path().join("logs/out.txt");
    let write = WriteFileTool
        .invoke(
            json!({ "path": target.to_str().unwrap(), "contents": "outside\n" }),
            &ctx,
        )
        .await;
    assert!(write.ok, "{}", write.output);
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "outside\n");

    let read = reader()
        .invoke(json!({ "path": target.to_str().unwrap() }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(read.output.contains("outside"));

    // The same file, reached by climbing out of the workspace: the temp workspace and the temp
    // directory above are siblings under the system temp root.
    let climbed = format!(
        "../{}/logs/out.txt",
        elsewhere.path().file_name().unwrap().to_str().unwrap()
    );
    let read = reader().invoke(json!({ "path": climbed }), &ctx).await;
    assert!(read.ok, "{}", read.output);
    assert!(read.output.contains("outside"));
}
