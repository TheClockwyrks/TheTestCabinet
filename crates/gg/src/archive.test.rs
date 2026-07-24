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
