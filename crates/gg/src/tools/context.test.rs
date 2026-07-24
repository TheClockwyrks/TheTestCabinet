//! Tests for the agent-managed-context tools' argument parsing and the store-backed
//! `search_archive`. The live-window reclaim of `evict_file_view`/`archive_thread` is applied
//! by the loop and is covered in `context.rs`'s and `agent.rs`'s tests; here we cover the
//! tool surface (validation, definitions, and the archive search).

use std::sync::{Arc, Mutex};

use serde_json::json;

use super::*;
use crate::archive::ArchiveStore;
use crate::model::Message;
use crate::tools::{Tool, ToolContext};
use test_cabinet_core::gg::GgContextSource;

fn ctx() -> ToolContext {
    ToolContext::new(std::env::temp_dir())
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
