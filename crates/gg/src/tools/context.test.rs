//! Tests for the agent-managed-context tools' argument parsing and the store-backed
//! `search_archive`. The live-window reclaim of `evict_file_view`/`archive_thread` is applied
//! by the loop and is covered in `context.rs`'s and `agent.rs`'s tests; here we cover the
//! tool surface (validation, definitions, and the archive search).

use std::sync::{Arc, Mutex};

use serde_json::json;

use super::*;
use crate::archive::ArchiveStore;
use crate::model::{Message, Role};
use crate::tools::{Tool, ToolContext, ToolFailure};
use test_cabinet_core::gg::GgContextSource;

fn ctx() -> ToolContext {
    ToolContext::new(std::env::temp_dir())
}

/// The [`ArchiveSearchData`] an outcome carries, or a failure naming what it carried instead.
fn search_data(outcome: &ToolOutcome) -> &ArchiveSearchData {
    match outcome.data.as_ref() {
        Some(ApiData::ArchiveSearch(data)) => data,
        other => panic!("expected an archive search, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Argument parsing (shared by the tools and the loop's reclaim)
// ---------------------------------------------------------------------------

#[test]
fn parse_evict_path_accepts_absent_null_and_string() {
    assert_eq!(parse_evict_path(&json!({})), Ok(None));
    assert_eq!(parse_evict_path(&json!({ "path": null })), Ok(None));
    assert_eq!(
        parse_evict_path(&json!({ "path": "src/a.js" })),
        Ok(Some("src/a.js".to_string()))
    );
    // Wrong type and empty string are usage errors.
    assert!(parse_evict_path(&json!({ "path": 3 })).is_err());
    assert!(parse_evict_path(&json!({ "path": "  " })).is_err());
}

#[test]
fn parse_archive_ranges_reads_pairs_and_objects() {
    assert_eq!(
        parse_archive_ranges(&json!({ "ranges": [[4, 19]] })),
        Ok(vec![TurnRange { from: 4, to: 19 }])
    );
    // A single turn is a range of one.
    assert_eq!(
        parse_archive_ranges(&json!({ "ranges": [[7, 7], [9, 12]] })),
        Ok(vec![
            TurnRange { from: 7, to: 7 },
            TurnRange { from: 9, to: 12 }
        ])
    );
    // The object spelling a model reaches for means the same thing.
    assert_eq!(
        parse_archive_ranges(&json!({ "ranges": [{ "from": 4, "to": 19 }] })),
        Ok(vec![TurnRange { from: 4, to: 19 }])
    );
}

#[test]
fn parse_archive_ranges_refuses_malformed_calls() {
    // `ranges` is required, and an empty list would archive nothing while reading as a success.
    assert!(parse_archive_ranges(&json!({})).is_err());
    assert!(parse_archive_ranges(&json!({ "ranges": [] })).is_err());
    // Wrong shapes.
    assert!(parse_archive_ranges(&json!({ "ranges": 3 })).is_err());
    assert!(parse_archive_ranges(&json!({ "ranges": [[1]] })).is_err());
    assert!(parse_archive_ranges(&json!({ "ranges": [[1, 2, 3]] })).is_err());
    assert!(parse_archive_ranges(&json!({ "ranges": [["a", "b"]] })).is_err());
    assert!(parse_archive_ranges(&json!({ "ranges": [[-1, 4]] })).is_err());
    // A reversed range is refused rather than silently normalized — the two readings of it
    // differ by the whole call.
    let reversed = parse_archive_ranges(&json!({ "ranges": [[19, 4]] }));
    assert!(reversed.is_err());
    assert!(reversed.unwrap_err().contains("[19, 4]"));
    // And the list is bounded.
    let many: Vec<[u64; 2]> = (0..MAX_ARCHIVE_RANGES as u64 + 1).map(|n| [n, n]).collect();
    assert!(parse_archive_ranges(&json!({ "ranges": many })).is_err());
}

// ---------------------------------------------------------------------------
// The reclaim tools only validate (the loop applies the effect)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn evict_and_archive_tools_validate_arguments() {
    let evict = EvictFileViewTool;
    assert!(evict.invoke(json!({ "path": "a.js" }), &ctx()).await.ok);
    assert!(evict.invoke(json!({}), &ctx()).await.ok);
    assert!(!evict.invoke(json!({ "path": 5 }), &ctx()).await.ok);

    let archive = ArchiveThreadTool;
    assert!(
        archive
            .invoke(json!({ "ranges": [[4, 19]] }), &ctx())
            .await
            .ok
    );
    // `ranges` is required: a call that named nothing would reclaim nothing while reading as a
    // success.
    assert!(!archive.invoke(json!({}), &ctx()).await.ok);
    assert!(!archive.invoke(json!({ "ranges": [] }), &ctx()).await.ok);
    assert!(
        !archive
            .invoke(json!({ "ranges": [[19, 4]] }), &ctx())
            .await
            .ok
    );
}

// ---------------------------------------------------------------------------
// search_archive
// ---------------------------------------------------------------------------

#[tokio::test]
async fn search_archive_recovers_matching_history() {
    let store = Arc::new(Mutex::new(ArchiveStore::new()));
    {
        let mut s = store.lock().unwrap();
        let m = Message::assistant(
            Some("Inspected the physics tuning constants".to_string()),
            Vec::new(),
        );
        s.archive([(GgContextSource::Assistant, &m)]);
    }
    let tool = SearchArchiveTool::new(Arc::clone(&store));

    let hit = tool.invoke(json!({ "query": "physics" }), &ctx()).await;
    assert!(hit.ok);
    assert!(hit.output.contains("physics tuning"));

    let miss = tool
        .invoke(json!({ "query": "no-such-term" }), &ctx())
        .await;
    assert!(
        miss.ok,
        "a miss is a successful search with no results, not an error"
    );
    assert!(miss.output.contains("No archived thread history"));

    // Missing / empty query is a usage error.
    assert!(!tool.invoke(json!({}), &ctx()).await.ok);
    assert!(!tool.invoke(json!({ "query": "  " }), &ctx()).await.ok);
}

#[tokio::test]
async fn search_archive_reports_an_empty_archive() {
    let store = Arc::new(Mutex::new(ArchiveStore::new()));
    let tool = SearchArchiveTool::new(store);
    let out = tool.invoke(json!({ "query": "anything" }), &ctx()).await;
    assert!(out.ok);
    assert!(out.output.contains("archive is empty"));
}

// ---------------------------------------------------------------------------
// The structured sidecar and the classified failures
// ---------------------------------------------------------------------------

/// A hit reports the message itself — who said it, where it sat in the thread, and its text — so a
/// caller recovers the history rather than the rendering of it.
#[tokio::test]
async fn search_archive_reports_each_hit_as_a_message() {
    let store = Arc::new(Mutex::new(ArchiveStore::new()));
    {
        let mut s = store.lock().unwrap();
        let m = Message::assistant(
            Some("Inspected the physics tuning constants".to_string()),
            Vec::new(),
        );
        s.archive([(GgContextSource::Assistant, &m)]);
    }
    let tool = SearchArchiveTool::new(Arc::clone(&store));

    let hit = tool.invoke(json!({ "query": "physics" }), &ctx()).await;

    let data = search_data(&hit);
    assert!(!data.archive_empty);
    assert_eq!(data.hits.len(), 1);
    assert_eq!(data.hits[0].role, Role::Assistant);
    assert_eq!(data.hits[0].seq, 0, "the first thing archived is ordinal 0");
    assert!(data.hits[0].text.contains("physics tuning"));
}

/// "Nothing archived yet" and "nothing matched" are two different answers, and the sidecar keeps
/// them apart exactly as the prose does — a caller told only that the list was empty would archive
/// its thread again, believing the first attempt had failed.
#[tokio::test]
async fn an_empty_archive_is_distinguished_from_no_match() {
    let empty = SearchArchiveTool::new(Arc::new(Mutex::new(ArchiveStore::new())))
        .invoke(json!({ "query": "anything" }), &ctx())
        .await;
    assert_eq!(
        search_data(&empty),
        &ArchiveSearchData {
            archive_empty: true,
            hits: Vec::new(),
        }
    );

    let store = Arc::new(Mutex::new(ArchiveStore::new()));
    {
        let mut s = store.lock().unwrap();
        let m = Message::assistant(Some("something else entirely".to_string()), Vec::new());
        s.archive([(GgContextSource::Assistant, &m)]);
    }
    let miss = SearchArchiveTool::new(store)
        .invoke(json!({ "query": "no-such-term" }), &ctx())
        .await;
    assert_eq!(
        search_data(&miss),
        &ArchiveSearchData {
            archive_empty: false,
            hits: Vec::new(),
        }
    );
}

/// The two reclaim tools carry no sidecar of their own: the loop performs the reclaim and rewrites
/// the outcome with what it actually freed, so reporting a guess here would be worse than
/// reporting nothing.
#[tokio::test]
async fn the_reclaim_tools_leave_the_sidecar_to_the_loop() {
    let evict = EvictFileViewTool
        .invoke(json!({ "path": "a.js" }), &ctx())
        .await;
    assert!(evict.ok);
    assert_eq!(evict.data, None);

    let archive = ArchiveThreadTool
        .invoke(json!({ "ranges": [[1, 3]] }), &ctx())
        .await;
    assert!(archive.ok);
    assert_eq!(archive.data, None);
}

/// Every argument diagnostic across the three tools is one class.
#[tokio::test]
async fn argument_diagnostics_are_classified_as_invalid_arguments() {
    let store = Arc::new(Mutex::new(ArchiveStore::new()));
    let search = SearchArchiveTool::new(store);

    for outcome in [
        EvictFileViewTool.invoke(json!({ "path": 5 }), &ctx()).await,
        EvictFileViewTool
            .invoke(json!({ "path": "  " }), &ctx())
            .await,
        ArchiveThreadTool.invoke(json!({}), &ctx()).await,
        ArchiveThreadTool
            .invoke(json!({ "ranges": [[19, 4]] }), &ctx())
            .await,
        search.invoke(json!({}), &ctx()).await,
        search.invoke(json!({ "query": "  " }), &ctx()).await,
    ] {
        assert_eq!(
            outcome.failure,
            Some(ToolFailure::InvalidArgument),
            "{}",
            outcome.output
        );
    }
}

// ---------------------------------------------------------------------------
// compact
// ---------------------------------------------------------------------------

/// The [`ToolFailure`] an outcome carries, or a failure naming what it carried instead.
fn failure(outcome: &ToolOutcome) -> ToolFailure {
    match outcome.failure {
        Some(failure) => failure,
        None => panic!("expected a failure, got {:?}", outcome.output),
    }
}

#[tokio::test]
async fn a_well_formed_compact_is_accepted_by_the_tool() {
    let outcome = CompactTool
        .invoke(
            json!({ "summary": "building the level loader", "files": ["src/a.ts"] }),
            &ctx(),
        )
        .await;
    assert!(outcome.ok, "{}", outcome.output);
    assert_eq!(outcome.summary.as_deref(), Some("compact context"));
    // The loop rewrites the window and replaces this result with what it actually compacted, so
    // the tool reports no sidecar of its own.
    assert_eq!(outcome.data, None);
}

#[tokio::test]
async fn a_compact_missing_its_summary_is_an_argument_error() {
    let outcome = CompactTool.invoke(json!({ "files": [] }), &ctx()).await;
    assert!(!outcome.ok);
    assert_eq!(failure(&outcome), ToolFailure::InvalidArgument);
    assert!(outcome.output.contains("summary"), "{}", outcome.output);
}

#[tokio::test]
async fn a_blank_compact_summary_is_an_argument_error() {
    let outcome = CompactTool
        .invoke(json!({ "summary": "   " }), &ctx())
        .await;
    assert!(!outcome.ok);
    assert_eq!(failure(&outcome), ToolFailure::InvalidArgument);
}

#[tokio::test]
async fn a_compact_summary_that_is_not_a_string_is_an_argument_error() {
    let outcome = CompactTool.invoke(json!({ "summary": 7 }), &ctx()).await;
    assert!(!outcome.ok);
    assert_eq!(failure(&outcome), ToolFailure::InvalidArgument);
}

#[tokio::test]
async fn a_compact_files_value_that_is_not_a_list_is_an_argument_error() {
    let outcome = CompactTool
        .invoke(json!({ "summary": "state", "files": "src/a.ts" }), &ctx())
        .await;
    assert!(!outcome.ok);
    assert_eq!(failure(&outcome), ToolFailure::InvalidArgument);
    assert!(outcome.output.contains("files"), "{}", outcome.output);
}

#[tokio::test]
async fn a_compact_file_entry_that_is_not_a_string_is_an_argument_error() {
    let outcome = CompactTool
        .invoke(json!({ "summary": "state", "files": [7] }), &ctx())
        .await;
    assert!(!outcome.ok);
    assert_eq!(failure(&outcome), ToolFailure::InvalidArgument);
    assert!(outcome.output.contains("files"), "{}", outcome.output);
}

/// `files` is optional: a compaction that continues from the summary alone is a normal call.
#[tokio::test]
async fn a_compact_with_no_files_is_accepted() {
    let absent = CompactTool
        .invoke(json!({ "summary": "state" }), &ctx())
        .await;
    assert!(absent.ok, "{}", absent.output);
    let null = CompactTool
        .invoke(json!({ "summary": "state", "files": null }), &ctx())
        .await;
    assert!(null.ok, "{}", null.output);
}

#[test]
fn compact_file_paths_are_trimmed_and_blanks_dropped() {
    let request =
        parse_compact_request(&json!({ "summary": "state", "files": ["  src/a.ts  ", "", "   "] }))
            .expect("a well-formed compact");
    assert_eq!(request.summary, "state");
    assert_eq!(request.files, vec!["src/a.ts".to_string()]);
}

/// Re-reading the same file twice would simply spend the window twice.
#[test]
fn a_repeated_compact_file_is_named_once() {
    let request = parse_compact_request(
        &json!({ "summary": "state", "files": ["src/a.ts", "  src/a.ts  ", "src/a.ts"] }),
    )
    .expect("a well-formed compact");
    assert_eq!(request.files, vec!["src/a.ts".to_string()]);
}

#[test]
fn the_compact_file_list_is_cut_at_the_ceiling() {
    let named: Vec<String> = (0..MAX_COMPACT_FILES + 3)
        .map(|n| format!("src/f{n}.ts"))
        .collect();
    let request = parse_compact_request(&json!({ "summary": "state", "files": named.clone() }))
        .expect("a well-formed compact");
    assert_eq!(request.files, named[..MAX_COMPACT_FILES]);
}
