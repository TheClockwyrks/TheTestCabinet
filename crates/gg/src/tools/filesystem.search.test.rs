//! Tests for the `search` tool: what it finds, what it never returns, and how it is bounded.
//!
//! Every ignore test asserts an **absence** as well as a presence, because the ignore rule is the
//! search's whole reason for being its own tool: a search that returned `node_modules` would be a
//! slower `grep`, and a test that only checked the hit it wanted would pass on exactly that.

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

/// The matches an outcome carries, or a failure naming what it carried instead.
fn matches(outcome: &ToolOutcome) -> &[SearchMatchData] {
    assert!(outcome.ok, "{}", outcome.output);
    match outcome.data.as_ref() {
        Some(ApiData::SearchMatches(matches)) => matches,
        other => panic!("expected search matches, got {other:?}"),
    }
}

/// The `path:line` of every match, which is what most assertions here are about.
fn located(outcome: &ToolOutcome) -> Vec<String> {
    matches(outcome)
        .iter()
        .map(|found| format!("{}:{}", found.path, found.line))
        .collect()
}

fn search(ctx: &ToolContext, query: &str) -> ToolOutcome {
    SearchTool.search(ctx, query.to_string(), None, None)
}

// ---------------------------------------------------------------------------
// What it finds
// ---------------------------------------------------------------------------

/// A match is a path, a 1-based line number and the line itself, in path order and then line
/// order, and the prose renders the same three facts.
#[test]
fn a_match_names_the_path_the_line_and_the_text() {
    let (dir, ctx) = workspace();
    write(dir.path(), "src/b.ts", "let x = 1;\nconst answer = 42;\n");
    write(
        dir.path(),
        "src/a.ts",
        "// answer below\nconst answer = 41;\n",
    );

    let outcome = search(&ctx, "answer");
    assert_eq!(
        located(&outcome),
        ["src/a.ts:1", "src/a.ts:2", "src/b.ts:2"]
    );
    assert_eq!(matches(&outcome)[2].text, "const answer = 42;");
    assert!(
        outcome.output.contains("src/b.ts:2: const answer = 42;"),
        "{}",
        outcome.output
    );
    assert_eq!(outcome.summary.as_deref(), Some("3 matches"));
}

/// The query is a regular expression, and it says so when it is not one.
#[test]
fn the_query_is_a_regular_expression() {
    let (dir, ctx) = workspace();
    write(
        dir.path(),
        "a.ts",
        "fn  update() {}\nfn update_later() {}\nupdate\n",
    );

    assert_eq!(located(&search(&ctx, r"fn\s+update\b")), ["a.ts:1"]);
    assert_eq!(located(&search(&ctx, "(?i)UPDATE_LATER")), ["a.ts:2"]);

    let broken = search(&ctx, "fn(");
    assert!(!broken.ok);
    assert_eq!(broken.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        broken.output.contains("not a valid regular expression"),
        "{}",
        broken.output
    );

    let blank = search(&ctx, "   ");
    assert!(!blank.ok);
    assert_eq!(blank.failure, Some(ToolFailure::InvalidArgument));
}

/// Nothing matching is a successful, empty answer — not a failure.
#[test]
fn no_match_is_an_empty_answer() {
    let (dir, ctx) = workspace();
    write(dir.path(), "a.ts", "nothing here\n");

    let outcome = search(&ctx, "absent");
    assert!(matches(&outcome).is_empty());
    assert_eq!(outcome.output, "(no matches)");
    assert_eq!(outcome.summary.as_deref(), Some("no matches"));
}

/// `path` roots the search at a directory or a single file, and a path that is not there is
/// `not-found` rather than an empty answer.
#[test]
fn a_path_roots_the_search() {
    let (dir, ctx) = workspace();
    write(dir.path(), "src/a.ts", "needle\n");
    write(dir.path(), "docs/b.md", "needle\n");
    write(dir.path(), "src/c.ts", "needle\n");

    let scoped = SearchTool.search(&ctx, "needle".into(), Some("src".into()), None);
    assert_eq!(located(&scoped), ["src/a.ts:1", "src/c.ts:1"]);

    let one = SearchTool.search(&ctx, "needle".into(), Some("docs/b.md".into()), None);
    assert_eq!(located(&one), ["docs/b.md:1"]);

    let missing = SearchTool.search(&ctx, "needle".into(), Some("nowhere".into()), None);
    assert!(!missing.ok);
    assert_eq!(missing.failure, Some(ToolFailure::NotFound));
}

// ---------------------------------------------------------------------------
// What it never returns
// ---------------------------------------------------------------------------

/// **A file `.gitignore` excludes is never returned**, in a workspace that is not a git repository.
#[test]
fn an_ignored_file_is_never_returned() {
    let (dir, ctx) = workspace();
    write(dir.path(), ".gitignore", "node_modules/\n*.log\n");
    write(dir.path(), "src/a.ts", "needle\n");
    write(dir.path(), "node_modules/dep/index.js", "needle\n");
    write(dir.path(), "build.log", "needle\n");

    assert_eq!(located(&search(&ctx, "needle")), ["src/a.ts:1"]);
}

/// A nested `.gitignore` applies below its own directory and nowhere else.
#[test]
fn a_nested_ignore_file_applies_below_its_directory() {
    let (dir, ctx) = workspace();
    write(dir.path(), "src/.gitignore", "generated/\n");
    write(dir.path(), "src/a.ts", "needle\n");
    write(dir.path(), "src/generated/g.ts", "needle\n");
    write(dir.path(), "other/generated/o.ts", "needle\n");

    assert_eq!(
        located(&search(&ctx, "needle")),
        ["other/generated/o.ts:1", "src/a.ts:1"]
    );
}

/// A negation re-admits what an earlier rule excluded — the semantics `.gitignore` gives it.
#[test]
fn a_negation_re_admits_a_file() {
    let (dir, ctx) = workspace();
    write(dir.path(), ".gitignore", "*.log\n!keep.log\n");
    write(dir.path(), "drop.log", "needle\n");
    write(dir.path(), "keep.log", "needle\n");

    assert_eq!(located(&search(&ctx, "needle")), ["keep.log:1"]);
}

/// A search rooted below the workspace still honours the workspace's ignore file: the root's rules
/// are read from the parents of the search root.
#[test]
fn a_scoped_search_still_honours_the_workspaces_ignore_file() {
    let (dir, ctx) = workspace();
    write(dir.path(), ".gitignore", "*.min.js\n");
    write(dir.path(), "src/a.js", "needle\n");
    write(dir.path(), "src/a.min.js", "needle\n");

    let scoped = SearchTool.search(&ctx, "needle".into(), Some("src".into()), None);
    assert_eq!(located(&scoped), ["src/a.js:1"]);
}

/// `.git` is never scanned, and dotfiles otherwise are.
#[test]
fn the_git_directory_is_skipped_and_other_dotfiles_are_searched() {
    let (dir, ctx) = workspace();
    write(dir.path(), ".git/config", "needle\n");
    write(dir.path(), ".github/workflows/ci.yml", "needle\n");
    write(dir.path(), ".env", "needle\n");

    assert_eq!(
        located(&search(&ctx, "needle")),
        [".env:1", ".github/workflows/ci.yml:1"]
    );
}

/// A file that is not text is skipped rather than matched byte by byte.
#[test]
fn a_binary_file_is_skipped() {
    let (dir, ctx) = workspace();
    write(dir.path(), "a.ts", "needle\n");
    fs::write(dir.path().join("blob.bin"), b"needle\0needle\n").unwrap();

    assert_eq!(located(&search(&ctx, "needle")), ["a.ts:1"]);
}

// ---------------------------------------------------------------------------
// How it is bounded
// ---------------------------------------------------------------------------

/// A file with more matches than fit.
fn many(root: &Path, lines: usize) {
    let body: String = (0..lines).map(|i| format!("needle {i}\n")).collect();
    write(root, "many.txt", &body);
}

/// The default and the ceiling both cut the list, and the prose says so; a request under the
/// ceiling is honoured exactly.
#[test]
fn the_match_list_is_bounded_by_the_default_and_the_ceiling() {
    let (dir, ctx) = workspace();
    many(dir.path(), 500);

    let defaulted = search(&ctx, "needle");
    assert_eq!(matches(&defaulted).len(), SEARCH_DEFAULT_LIMIT as usize);
    assert!(
        defaulted.output.contains("showing the first 50 matches"),
        "{}",
        defaulted.output
    );
    assert_eq!(defaulted.summary.as_deref(), Some("50 matches (cut at 50)"));

    let asked = SearchTool.search(&ctx, "needle".into(), None, Some(7));
    assert_eq!(matches(&asked).len(), 7);

    let greedy = SearchTool.search(&ctx, "needle".into(), None, Some(10_000));
    assert_eq!(matches(&greedy).len(), SEARCH_MAX_LIMIT as usize);

    let zero = SearchTool.search(&ctx, "needle".into(), None, Some(0));
    assert!(!zero.ok);
    assert_eq!(zero.failure, Some(ToolFailure::InvalidArgument));
}

/// A list that fits exactly is not reported as cut: the note is for a list the bound cut, not for
/// one that happened to be the bound's size.
#[test]
fn a_list_that_fits_exactly_is_not_reported_cut() {
    let (dir, ctx) = workspace();
    many(dir.path(), 7);

    let outcome = SearchTool.search(&ctx, "needle".into(), None, Some(7));
    assert_eq!(matches(&outcome).len(), 7);
    assert!(
        !outcome.output.contains("showing the first"),
        "{}",
        outcome.output
    );
    assert_eq!(outcome.summary.as_deref(), Some("7 matches"));
}

/// The bound spans files: the second file gets only what the first left.
#[test]
fn the_bound_spans_files() {
    let (dir, ctx) = workspace();
    write(dir.path(), "a.txt", "needle\nneedle\nneedle\n");
    write(dir.path(), "b.txt", "needle\nneedle\n");

    let outcome = SearchTool.search(&ctx, "needle".into(), None, Some(4));
    assert_eq!(
        located(&outcome),
        ["a.txt:1", "a.txt:2", "a.txt:3", "b.txt:1"]
    );
    assert!(
        outcome.output.contains("showing the first 4"),
        "{}",
        outcome.output
    );
}

/// A long matching line is clipped and annotated in place, on a character boundary.
#[test]
fn a_long_line_is_clipped_and_annotated() {
    let (dir, ctx) = workspace();
    let long = format!("needle {}", "é".repeat(400));
    write(dir.path(), "a.txt", &format!("{long}\n"));

    let outcome = search(&ctx, "needle");
    let text = &matches(&outcome)[0].text;
    assert_eq!(
        text.chars().count(),
        SEARCH_LINE_CLIP + " (207 more chars...)".len()
    );
    assert!(text.ends_with(" (207 more chars...)"), "{text}");
    assert!(text.starts_with("needle é"), "{text}");
}

/// [`clip_line`] on its own terms: at the bound is whole, one past is cut, and the cut counts
/// characters rather than bytes.
#[test]
fn clip_line_cuts_at_characters_not_bytes() {
    assert_eq!(clip_line("abc", 3), "abc");
    assert_eq!(clip_line("abcd", 3), "abc (1 more chars...)");
    assert_eq!(clip_line("", 3), "");
    assert_eq!(clip_line("日本語テキスト", 3), "日本語 (4 more chars...)");
    assert_eq!(clip_line("🙂🙂🙂🙂", 2), "🙂🙂 (2 more chars...)");
}

// ---------------------------------------------------------------------------
// The tool-calling adapter
// ---------------------------------------------------------------------------

/// The JSON adapter reads the three arguments and answers with the same outcome.
#[tokio::test]
async fn the_adapter_reads_query_path_and_limit() {
    let (dir, ctx) = workspace();
    write(dir.path(), "src/a.ts", "needle\nneedle\n");
    write(dir.path(), "b.ts", "needle\n");

    let outcome = SearchTool
        .invoke(
            json!({ "query": "needle", "path": "src", "limit": 1 }),
            &ctx,
        )
        .await;
    assert_eq!(located(&outcome), ["src/a.ts:1"]);

    let bad = SearchTool.invoke(json!({ "query": 5 }), &ctx).await;
    assert!(!bad.ok);
    assert_eq!(bad.failure, Some(ToolFailure::InvalidArgument));
}
