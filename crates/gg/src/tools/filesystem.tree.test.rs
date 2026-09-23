//! Tests for the `tree` tool: what it renders, what it never renders, and how it is bounded.
//!
//! Every ignore test asserts an **absence** as well as a presence, because the ignore rule is half
//! the reason the call exists: a tree that returned `node_modules` would answer a question nobody
//! asked while burying the one they did, and a test that only checked the entry it wanted would
//! pass on exactly that.

use std::fs;
use std::path::Path;

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::tools::{Tool, ToolContext, ToolFailure, ToolOutcome};

/// A temp workspace and a context rooted at it.
fn workspace() -> (TempDir, ToolContext) {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    (dir, ctx)
}

/// Write `contents` at `relative` under `root`, creating parents.
fn write(root: &Path, relative: &str, contents: &str) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

/// The rendering an outcome carries on its sidecar, or a failure naming what it carried instead.
fn rendered(outcome: &ToolOutcome) -> &str {
    assert!(outcome.ok, "{}", outcome.output);
    match outcome.data.as_ref() {
        Some(ApiData::TreeText(text)) => text,
        other => panic!("expected a rendered tree, got {other:?}"),
    }
}

fn tree(ctx: &ToolContext, depth: Option<u32>) -> ToolOutcome {
    TreeTool.tree(ctx, None, depth)
}

// ---------------------------------------------------------------------------
// The shape it renders
// ---------------------------------------------------------------------------

/// The root is not named, each level is indented two further spaces, directories carry a `/`, and
/// every level is in path order.
#[test]
fn a_tree_indents_two_spaces_a_level_and_suffixes_directories() {
    let (dir, ctx) = workspace();
    write(dir.path(), "README.md", "hi\n");
    write(dir.path(), "engine/game.js", "");
    write(dir.path(), "engine/input.js", "");
    write(dir.path(), "src/main.js", "");

    let outcome = tree(&ctx, Some(2));
    assert_eq!(
        rendered(&outcome),
        "README.md\nengine/\n  game.js\n  input.js\nsrc/\n  main.js"
    );
    // The prose the model reads and the sidecar the program reads are the same bytes.
    assert_eq!(outcome.output, rendered(&outcome));
    assert_eq!(outcome.summary.as_deref(), Some("6 entries"));
}

/// A tree of a root with nothing under it says so rather than being blank, so a view of one is
/// never empty.
#[test]
fn an_empty_root_renders_the_empty_directory_word() {
    let (_dir, ctx) = workspace();
    let outcome = tree(&ctx, None);
    assert_eq!(rendered(&outcome), "(empty directory)");
    assert_eq!(outcome.summary.as_deref(), Some("empty"));
}

/// A `path` roots the tree, and the rendering is relative to that root rather than to the
/// workspace.
#[test]
fn a_path_roots_the_tree() {
    let (dir, ctx) = workspace();
    write(dir.path(), "engine/render/camera.js", "");
    write(dir.path(), "src/main.js", "");

    let outcome = TreeTool.tree(&ctx, Some("engine".to_string()), Some(2));
    assert_eq!(rendered(&outcome), "render/\n  camera.js");
}

// ---------------------------------------------------------------------------
// The depth bound
// ---------------------------------------------------------------------------

/// Depth 1 is the root's own entries, which is a listing — with each directory saying what it is
/// holding back, because at depth 1 every directory sits on the bound.
#[test]
fn depth_one_renders_the_roots_own_entries_only() {
    let (dir, ctx) = workspace();
    write(dir.path(), "engine/game.js", "");
    write(dir.path(), "engine/input.js", "");
    write(dir.path(), "README.md", "");

    assert_eq!(
        rendered(&tree(&ctx, Some(1))),
        "README.md\nengine/ (2 entries not shown)"
    );
}

/// A tree that names no depth walks two levels, which is what answers *what does this directory
/// hold*.
#[test]
fn the_default_depth_is_two() {
    let (dir, ctx) = workspace();
    write(dir.path(), "engine/render/camera.js", "");

    assert_eq!(
        rendered(&tree(&ctx, None)),
        "engine/\n  render/ (1 entry not shown)"
    );
    assert_eq!(rendered(&tree(&ctx, None)), rendered(&tree(&ctx, Some(2))));
}

/// A directory sitting exactly at the bound says how many entries it is holding back, and the
/// count is post-ignore.
#[test]
fn a_directory_at_the_bound_names_what_it_holds_back() {
    let (dir, ctx) = workspace();
    write(dir.path(), ".gitignore", "engine/render/ignored.js\n");
    write(dir.path(), "engine/render/camera.js", "");
    write(dir.path(), "engine/render/sprites.js", "");
    write(dir.path(), "engine/render/ignored.js", "");

    assert_eq!(
        rendered(&tree(&ctx, Some(2))),
        ".gitignore\nengine/\n  render/ (2 entries not shown)"
    );
}

/// An empty directory at the bound is left bare: there is nothing being held back to name.
#[test]
fn an_empty_directory_at_the_bound_is_left_bare() {
    let (dir, ctx) = workspace();
    fs::create_dir_all(dir.path().join("engine/render")).unwrap();

    assert_eq!(rendered(&tree(&ctx, Some(2))), "engine/\n  render/");
}

/// A depth past the ceiling is answered at the ceiling rather than refused: the caller wanted
/// deep, and the ceiling is gg's robustness bound.
#[test]
fn a_depth_past_the_ceiling_is_clamped() {
    let (dir, ctx) = workspace();
    let deep: String = (1..=(TREE_MAX_DEPTH as usize + 3))
        .map(|level| format!("d{level}/"))
        .collect();
    write(dir.path(), &format!("{deep}leaf.txt"), "");

    let clamped = rendered(&tree(&ctx, Some(TREE_MAX_DEPTH + 40))).to_string();
    assert_eq!(clamped, rendered(&tree(&ctx, Some(TREE_MAX_DEPTH))));
    assert_eq!(clamped.lines().count(), TREE_MAX_DEPTH as usize);
}

/// A tree of nothing is not a question.
#[test]
fn a_depth_of_zero_is_an_argument_error() {
    let (_dir, ctx) = workspace();
    let outcome = tree(&ctx, Some(0));
    assert!(!outcome.ok);
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        outcome
            .output
            .contains("`depth` must be a positive number of levels"),
        "{}",
        outcome.output
    );
}

// ---------------------------------------------------------------------------
// The ignore rule
// ---------------------------------------------------------------------------

/// What the ignore files exclude is absent from the tree, and `.git` goes with them — in a
/// workspace that is a repository and in one that is not yet.
#[test]
fn ignored_paths_are_absent() {
    let (dir, ctx) = workspace();
    write(dir.path(), ".gitignore", "node_modules/\ndist/\n");
    write(dir.path(), "node_modules/left-pad/index.js", "");
    write(dir.path(), "dist/bundle.js", "");
    write(dir.path(), ".git/objects/ab/cdef", "");
    write(dir.path(), ".github/workflows/ci.yml", "");
    write(dir.path(), "src/main.js", "");

    let out = rendered(&tree(&ctx, Some(2))).to_string();
    assert!(!out.contains("node_modules"), "{out}");
    assert!(!out.contains("dist"), "{out}");
    assert!(!out.contains(".git/"), "{out}");
    // A dotfile that no ignore file excludes is an entry like any other.
    assert!(out.contains(".github/"), "{out}");
    assert!(out.contains("src/"), "{out}");
}

/// A nested ignore file and a negation inside it are both honoured, which is the `ignore` crate's
/// semantics rather than a prefix match of our own.
#[test]
fn a_nested_ignore_file_and_its_negation_are_honoured() {
    let (dir, ctx) = workspace();
    write(dir.path(), "pkg/.gitignore", "*.log\n!keep.log\n");
    write(dir.path(), "pkg/noisy.log", "");
    write(dir.path(), "pkg/keep.log", "");

    let out = rendered(&tree(&ctx, Some(2))).to_string();
    assert!(out.contains("keep.log"), "{out}");
    assert!(!out.contains("noisy.log"), "{out}");
}

/// A symbolic link into a directory is an entry rather than a second copy of a subtree, so a tree
/// of a workspace holding one terminates.
#[test]
#[cfg(unix)]
fn a_symlink_is_not_followed() {
    let (dir, ctx) = workspace();
    write(dir.path(), "src/main.js", "");
    std::os::unix::fs::symlink(dir.path(), dir.path().join("loop")).unwrap();

    let out = rendered(&tree(&ctx, Some(3))).to_string();
    assert!(out.contains("loop"), "{out}");
    assert!(!out.contains("loop/"), "{out}");
}

// ---------------------------------------------------------------------------
// The size bounds
// ---------------------------------------------------------------------------

/// The entry ceiling cuts the rendering and says so in the same prose the tree came back as. The
/// ceiling is set to ten so fifteen files cross it; the production call renders under
/// [`TREE_MAX_ENTRIES`] through the same path.
#[test]
fn the_entry_ceiling_cuts_and_says_so() {
    let (dir, ctx) = workspace();
    for index in 0..15 {
        write(dir.path(), &format!("f{index:02}.txt"), "");
    }

    let outcome = TreeTool.tree_within(&ctx, None, Some(1), 10);
    let out = rendered(&outcome).to_string();
    let shown: Vec<&str> = out.lines().filter(|line| line.ends_with(".txt")).collect();
    assert_eq!(shown.len(), 10, "{out}");
    assert_eq!(
        shown.last(),
        Some(&"f09.txt"),
        "the first ten in path order"
    );
    assert!(out.contains("[showing the first 10 entries;"), "{out}");
    assert_eq!(outcome.summary.as_deref(), Some("10 entries (cut at 10)"));
}

/// A directory that exactly fills the entry ceiling is shown whole, with no line claiming a cut.
#[test]
fn a_tree_that_exactly_fills_the_entry_ceiling_is_not_cut() {
    let (dir, ctx) = workspace();
    for index in 0..10 {
        write(dir.path(), &format!("f{index:02}.txt"), "");
    }

    let outcome = TreeTool.tree_within(&ctx, None, Some(1), 10);
    let out = rendered(&outcome).to_string();
    assert!(!out.contains("[showing the first"), "{out}");
    assert_eq!(outcome.summary.as_deref(), Some("10 entries"));
}

/// The byte ceiling binds before the entry ceiling when the names are long, and the rendering
/// stays under it so a view of any tree fits.
#[test]
fn the_byte_ceiling_binds_first_for_long_names() {
    let (dir, ctx) = workspace();
    let long = "n".repeat(200);
    for index in 0..200 {
        write(dir.path(), &format!("{long}{index:04}.txt"), "");
    }

    let outcome = tree(&ctx, Some(1));
    let out = rendered(&outcome).to_string();
    let shown = out.lines().filter(|line| line.ends_with(".txt")).count();
    assert!(shown < 200, "the byte ceiling did not bind: {shown} lines");
    assert!(out.contains("[showing the first"), "{out}");
}

// ---------------------------------------------------------------------------
// The arguments
// ---------------------------------------------------------------------------

/// A path that names nothing is `not-found`, and one that names a file is an argument error: a
/// tree of a file is a different question from a tree of a directory.
#[test]
fn a_missing_path_is_not_found_and_a_file_is_an_argument_error() {
    let (dir, ctx) = workspace();
    write(dir.path(), "src/main.js", "");

    let missing = TreeTool.tree(&ctx, Some("nope".to_string()), None);
    assert!(!missing.ok);
    assert_eq!(missing.failure, Some(ToolFailure::NotFound));

    let file = TreeTool.tree(&ctx, Some("src/main.js".to_string()), None);
    assert!(!file.ok);
    assert_eq!(file.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        file.output.contains("is not a directory"),
        "{}",
        file.output
    );
}

/// The JSON adapter reads the same two arguments the typed call takes, and refuses a `depth` it
/// cannot read as a count.
#[tokio::test]
async fn the_json_adapter_reads_path_and_depth() {
    let (dir, ctx) = workspace();
    write(dir.path(), "engine/render/camera.js", "");

    let outcome = TreeTool
        .invoke(json!({ "path": "engine", "depth": 1 }), &ctx)
        .await;
    assert_eq!(rendered(&outcome), "render/ (1 entry not shown)");

    let refused = TreeTool.invoke(json!({ "depth": "deep" }), &ctx).await;
    assert!(!refused.ok);
    assert_eq!(refused.failure, Some(ToolFailure::InvalidArgument));
}
