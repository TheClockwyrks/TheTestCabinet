//! Tests for the context family — the three tools an agent manages its own window with.

use serde_json::json;

use super::*;
use crate::sandbox::fake::{CallLog, all_tools, membrane, membrane_with};
use crate::tools::{ArchiveSearchData, ToolOutcome};

/// A reclaim reports the numbers the loop actually freed, not an estimate the tool made before the
/// work happened — "reclaimed something" and "there was nothing to reclaim" are very different
/// answers to the same call, and only the counts tell them apart.
#[test]
fn reclaim_reports_carry_real_numbers() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let evicted = state
        .evict_file_view(Some("src/a.ts".to_string()))
        .expect("evicted");
    assert_eq!(evicted.items, 2);
    assert_eq!(evicted.reclaimed_tokens, 300);
    assert_eq!(evicted.paths, ["src/a.ts"]);
    assert!(!evicted.detail.is_empty());

    let archived = state.archive_thread(Some(3)).expect("archived");
    assert_eq!(archived.items, 2);

    assert_eq!(
        log.args("evict_file_view"),
        Some(json!({ "path": "src/a.ts" }))
    );
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "keep_recent_turns": 3 })),
        "the schema spells this one with underscores"
    );
}

/// Evicting every file view is the absent-path case, lowered as an explicit null.
#[test]
fn evicting_every_file_view_sends_no_path() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.evict_file_view(None).expect("evicted");

    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": null })));
}

/// A search that ran and matched nothing is an empty hit list, not an error.
#[test]
fn no_archive_match_is_an_empty_hit_list() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_tools(), None, |_, _| {
        ToolOutcome::ok("no matches", "searched").with_data(crate::tools::ToolData::ArchiveSearch(
            ArchiveSearchData {
                archive_empty: false,
                hits: Vec::new(),
            },
        ))
    });

    let search = state
        .search_archive("parser".to_string())
        .expect("a search with no match still succeeds");
    assert!(!search.archive_empty);
    assert!(search.hits.is_empty());
}

/// **An empty archive is not the same as no match.** Collapsing them would make a program archive
/// its thread a second time believing the first `archiveThread` had failed — which is exactly the
/// distinction the tool's own prose already draws.
#[test]
fn an_empty_archive_is_distinguished_from_no_match() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_tools(), None, |_, _| {
        ToolOutcome::ok("nothing has been archived yet", "searched").with_data(
            crate::tools::ToolData::ArchiveSearch(ArchiveSearchData {
                archive_empty: true,
                hits: Vec::new(),
            }),
        )
    });

    let search = state
        .search_archive("parser".to_string())
        .expect("searching an empty archive still succeeds");
    assert!(search.archive_empty);
    assert!(search.hits.is_empty());
}

/// A hit carries who said it as a value, so a program can filter by role without parsing a
/// transcript.
#[test]
fn an_archive_hit_carries_its_role_and_sequence() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let search = state
        .search_archive("answer".to_string())
        .expect("searched");

    assert_eq!(search.hits.len(), 1);
    assert_eq!(search.hits[0].seq, 3);
    assert_eq!(search.hits[0].role, MessageRole::Assistant);
    assert_eq!(search.hits[0].text, "the earlier answer");
    assert_eq!(
        log.args("search_archive"),
        Some(json!({ "query": "answer" }))
    );
}

/// Every role gg records has a membrane spelling; the conversion is exhaustive, so a new one cannot
/// be silently dropped.
#[test]
fn every_message_role_crosses_the_membrane() {
    use crate::model::Role;
    assert_eq!(role(Role::System), MessageRole::System);
    assert_eq!(role(Role::User), MessageRole::User);
    assert_eq!(role(Role::Assistant), MessageRole::Assistant);
    assert_eq!(role(Role::Tool), MessageRole::Tool);
}
