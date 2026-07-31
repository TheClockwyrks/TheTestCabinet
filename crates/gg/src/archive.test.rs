//! Tests for the searchable thread [archive](super).

use super::*;
use crate::model::{Message, ToolCall};
use serde_json::json;
use test_cabinet_core::gg::GgContextSource;

#[test]
fn archives_and_finds_by_case_insensitive_substring() {
    let mut store = ArchiveStore::new();
    let a = Message::assistant(
        Some("Investigating the Physics engine".to_string()),
        Vec::new(),
    );
    let b = Message::tool_result("call_1", "directory listing: src/, assets/");
    let added = store.archive([
        (GgContextSource::Assistant, &a),
        (GgContextSource::ToolOutput, &b),
    ]);
    assert_eq!(added, 2);
    assert_eq!(store.len(), 2);

    // Case-insensitive substring match.
    let hits = store.search("physics", 10);
    assert_eq!(hits.len(), 1);
    assert!(hits[0].text.contains("Physics engine"));

    // A term in the tool output.
    assert_eq!(store.search("assets/", 10).len(), 1);
    // No match.
    assert!(store.search("nonexistent", 10).is_empty());
}

#[test]
fn assigns_monotonic_ordinals_across_batches() {
    let mut store = ArchiveStore::new();
    let m1 = Message::user("first");
    let m2 = Message::user("second");
    store.archive([(GgContextSource::History, &m1)]);
    store.archive([(GgContextSource::History, &m2)]);
    let all = store.search("s", 10); // matches "first"→no; both contain 's'
    // Both contain the letter 's'; ordinals must be 0 then 1 in order.
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].seq, 0);
    assert_eq!(all[1].seq, 1);
    assert!(all[1].seq > all[0].seq);
}

#[test]
fn indexes_assistant_tool_calls_as_searchable_text() {
    let mut store = ArchiveStore::new();
    let assistant = Message::assistant(
        Some("Reading the config".to_string()),
        vec![ToolCall {
            id: "c1".to_string(),
            name: "read_file".to_string(),
            arguments: json!({ "path": "game/config.json" }),
        }],
    );
    store.archive([(GgContextSource::Assistant, &assistant)]);
    // The tool call's name and arguments are searchable.
    assert_eq!(store.search("read_file", 10).len(), 1);
    assert_eq!(store.search("config.json", 10).len(), 1);
}

#[test]
fn skips_empty_items_and_ignores_empty_query() {
    let mut store = ArchiveStore::new();
    let empty = Message::assistant(None, Vec::new());
    let real = Message::user("real content");
    let added = store.archive([
        (GgContextSource::Assistant, &empty),
        (GgContextSource::UserPrompt, &real),
    ]);
    assert_eq!(added, 1, "the content-free message is not archived");
    assert_eq!(store.len(), 1);

    // A blank query matches nothing rather than returning everything.
    assert!(store.search("   ", 10).is_empty());
}

#[test]
fn search_respects_the_result_cap() {
    let mut store = ArchiveStore::new();
    for i in 0..5 {
        let m = Message::user(format!("match token number {i}"));
        store.archive([(GgContextSource::History, &m)]);
    }
    assert_eq!(store.search("match token", 3).len(), 3);
    assert_eq!(store.search("match token", 100).len(), 5);
}

/// The snapshot the console renders an archive from: every entry's metadata, a **bounded** preview
/// of its text, and the totals. The bound is the point — the archive exists so this material is out
/// of the request, and putting the bodies back into the record would put a second copy of the whole
/// thread on disk for nobody's benefit.
#[test]
fn the_snapshot_reports_metadata_and_a_bounded_preview() {
    let mut store = ArchiveStore::new();
    let long = Message::tool_result("call_1", "x".repeat(PREVIEW_CHARS * 3));
    let said = Message::assistant(Some("a short remark".to_string()), Vec::new());
    store.archive([
        (GgContextSource::ToolOutput, &long),
        (GgContextSource::Assistant, &said),
    ]);

    let GgTelemetryKind::ArchiveState {
        module_id,
        entries,
        count,
        total_len,
    } = store.state_event("archive-7")
    else {
        panic!("expected an archive snapshot");
    };

    assert_eq!(module_id, "archive-7");
    assert_eq!(count, 2);
    assert_eq!(entries.len(), 2);
    assert_eq!(
        total_len,
        (PREVIEW_CHARS * 3 + "a short remark".len()) as u64,
        "the totals measure what was archived, not what the preview shows"
    );

    let first = &entries[0];
    assert_eq!(
        first.seq, 0,
        "the ordinal is the handle the model has on it"
    );
    assert_eq!(first.source, GgContextSource::ToolOutput);
    assert_eq!(first.role, "tool");
    assert_eq!(first.len, (PREVIEW_CHARS * 3) as u64);
    assert_eq!(
        first.preview.chars().count(),
        PREVIEW_CHARS,
        "a long entry is previewed, never carried"
    );

    let second = &entries[1];
    assert_eq!(second.role, "assistant");
    assert_eq!(
        second.preview, "a short remark",
        "an entry shorter than the bound is shown whole"
    );
}

/// A disabled archive reports nothing at all — an ablation's off arm has no store to snapshot — and
/// an enabled one reports itself the moment its agent opens, empty, so the module has something to
/// render before anything has been archived.
#[test]
fn the_runtime_snapshots_only_when_the_capability_is_on() {
    assert!(ArchiveRuntime::disabled().state_event().is_none());

    let runtime = ArchiveRuntime::new();
    let GgTelemetryKind::ArchiveState { count, entries, .. } =
        runtime.state_event().expect("an enabled archive reports")
    else {
        panic!("expected an archive snapshot");
    };
    assert_eq!(count, 0);
    assert!(entries.is_empty());
}
