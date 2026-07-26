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
        Some(ToolData::ArchiveSearch(data)) => data,
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
fn parse_archive_keep_recent_defaults_and_validates() {
    assert_eq!(
        parse_archive_keep_recent(&json!({})),
        Ok(DEFAULT_ARCHIVE_KEEP_RECENT)
    );
    assert_eq!(
        parse_archive_keep_recent(&json!({ "keep_recent_turns": 0 })),
        Ok(0)
    );
    assert_eq!(
        parse_archive_keep_recent(&json!({ "keep_recent_turns": 3 })),
        Ok(3)
    );
    // Negative / non-integer are usage errors.
    assert!(parse_archive_keep_recent(&json!({ "keep_recent_turns": -1 })).is_err());
    assert!(parse_archive_keep_recent(&json!({ "keep_recent_turns": "lots" })).is_err());
}

#[test]
fn is_context_reclaim_tool_covers_only_the_live_window_tools() {
    assert!(is_context_reclaim_tool(EVICT_FILE_VIEW_TOOL));
    assert!(is_context_reclaim_tool(ARCHIVE_THREAD_TOOL));
    // search_archive reads the archive; it is not a live-window reclaim.
    assert!(!is_context_reclaim_tool(SEARCH_ARCHIVE_TOOL));
    assert!(!is_context_reclaim_tool("read_file"));
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
    assert!(archive.invoke(json!({}), &ctx()).await.ok);
    assert!(
        archive
            .invoke(json!({ "keep_recent_turns": 2 }), &ctx())
            .await
            .ok
    );
    assert!(
        !archive
            .invoke(json!({ "keep_recent_turns": -3 }), &ctx())
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

    let archive = ArchiveThreadTool.invoke(json!({}), &ctx()).await;
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
        ArchiveThreadTool
            .invoke(json!({ "keep_recent_turns": -3 }), &ctx())
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
