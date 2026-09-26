//! The store's **record** of what the model did to memory, as distinct from the set it is
//! holding: the [revision log](MemoryStore::log_from), the [peaks](MemoryPeak), and the
//! line counts both of them report.
//!
//! The distinction is the point. A snapshot of the live set cannot show a memory the model wrote
//! and then deleted, cannot show the earlier wording of one it revised, and reads a store that was
//! curated hard and pruned back down exactly like one that was never used. Everything here is
//! about the half a snapshot loses.

use serde_json::json;
use test_cabinet_core::gg::{GgMemoryChange, GgTelemetryKind};

use super::*;

/// A scratchpad store bounded by nothing — these tests are about what is recorded, not about what
/// is refused.
fn store() -> MemoryStore {
    MemoryStore::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED)
}

/// Every revision the store has recorded, as the telemetry a holder streams for it.
///
/// These tests drive a bare store rather than a holder, so they read the whole log from the start
/// rather than through a cursor — which is what makes them tests of what the store *records*,
/// leaving what each of several holders is told about it to `memories.scope.test.rs`.
fn recorded(store: &MemoryStore) -> Vec<GgTelemetryKind> {
    store
        .log_from(0)
        .iter()
        .map(|entry| entry.revision.to_event())
        .collect()
}

/// The store's state snapshot as an ordinary, writable, unshared holder would emit it.
fn state(store: &MemoryStore) -> GgTelemetryKind {
    store.state_event("memories-0", MemoryScope::Isolated, true)
}

/// Destructure one drained revision event, which is all these tests ever look at.
fn revision(event: &GgTelemetryKind) -> (&str, u64, GgMemoryChange, &str, &str, u64, u64) {
    match event {
        GgTelemetryKind::MemoryRevision {
            name,
            revision,
            change,
            description,
            body,
            len,
            lines,
        } => (name, *revision, *change, description, body, *len, *lines),
        other => panic!("expected a MemoryRevision, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// The revision log
// ---------------------------------------------------------------------------

#[test]
fn every_mutation_is_recorded_with_the_text_it_produced() {
    let mut store = store();
    store
        .write("", "plan", "the plan", "maze runner", MemoryCode::default())
        .unwrap();
    store
        .update("", "plan", "the plan", "arrow-key maze", None)
        .unwrap();
    store.delete("", "plan").unwrap();

    let events = recorded(&store);
    assert_eq!(events.len(), 3, "one revision per mutation");

    let (name, rev, change, description, body, len, lines) = revision(&events[0]);
    assert_eq!((name, rev, change), ("plan", 1, GgMemoryChange::Written));
    assert_eq!((description, body), ("the plan", "maze runner"));
    assert_eq!((len, lines), (11, 1));

    let (_, rev, change, _, body, len, _) = revision(&events[1]);
    assert_eq!((rev, change), (2, GgMemoryChange::Updated));
    assert_eq!(body, "arrow-key maze", "the revision carries the new text");
    assert_eq!(len, 14);

    // A deletion carries no text: what the memory said is on the revision before it, and
    // repeating it here would make the log ambiguous about which one is current.
    let (_, rev, change, description, body, len, lines) = revision(&events[2]);
    assert_eq!((rev, change), (3, GgMemoryChange::Deleted));
    assert_eq!((description, body), ("", ""));
    assert_eq!((len, lines), (0, 0));
}

/// The log is what a deleted memory survives in. A `MemoryState` after the delete cannot mention
/// it at all, so if the revisions did not carry the text, the run record would have no answer to
/// "what did the model write, and then decide it did not need?".
#[test]
fn a_deleted_memory_is_still_in_the_record() {
    let mut store = store();
    store
        .write(
            "",
            "palette",
            "colours",
            "teal and sand",
            MemoryCode::default(),
        )
        .unwrap();
    store.delete("", "palette").unwrap();

    let events = recorded(&store);
    let (_, _, _, _, body, _, _) = revision(&events[0]);
    assert_eq!(body, "teal and sand");

    // The live snapshot has forgotten it, which is exactly why the log must not have.
    let GgTelemetryKind::MemoryState { memories, .. } = state(&store) else {
        panic!("expected a MemoryState");
    };
    assert!(memories.is_empty());
}

/// Revision numbers key off the **slug**, and keep counting across a delete. A model that
/// re-creates a name it discarded is doing something worth seeing in the history, and restarting
/// the count at 1 would present it as a memory with no past.
#[test]
fn revisions_keep_counting_across_a_delete_and_recreate() {
    let mut store = store();
    store
        .write("", "plan", "d", "first", MemoryCode::default())
        .unwrap();
    store.delete("", "plan").unwrap();
    store
        .write("", "plan", "d", "second", MemoryCode::default())
        .unwrap();

    let numbers: Vec<u64> = recorded(&store).iter().map(|e| revision(e).1).collect();
    assert_eq!(numbers, vec![1, 2, 3]);
}

/// Each memory counts its own revisions, so two memories curated in step do not inherit each
/// other's numbering.
#[test]
fn revision_numbers_are_per_memory() {
    let mut store = store();
    store
        .write("", "a", "d", "one", MemoryCode::default())
        .unwrap();
    store
        .write("", "b", "d", "two", MemoryCode::default())
        .unwrap();
    store.update("", "a", "d", "three", None).unwrap();

    let seen: Vec<(String, u64)> = recorded(&store)
        .iter()
        .map(|e| {
            let (name, rev, ..) = revision(e);
            (name.to_string(), rev)
        })
        .collect();
    assert_eq!(
        seen,
        vec![
            ("a".to_string(), 1),
            ("b".to_string(), 1),
            ("a".to_string(), 2),
        ]
    );
}

/// The log **accumulates**: reading it does not empty it, and a later mutation appends rather
/// than replacing what came before.
///
/// It has to be append-only, because a holder's place in it is an index. A store may be held by
/// several agents at once, and a destructive drain would let whichever looked first swallow every
/// other holder's news — so nobody drains, everybody reads from where it last looked, and the
/// store keeps the whole record. What each holder is told about it is
/// `memories.scope.test.rs`'s subject.
#[test]
fn the_log_accumulates_rather_than_draining() {
    let mut store = store();
    store
        .write("", "plan", "d", "body", MemoryCode::default())
        .unwrap();
    assert_eq!(recorded(&store).len(), 1);
    assert_eq!(recorded(&store).len(), 1, "reading it does not consume it");

    store.update("", "plan", "d", "revised", None).unwrap();
    assert_eq!(recorded(&store).len(), 2, "a later mutation appends");
}

/// A refused mutation records nothing. The log is what the store *did*, and a call that was turned
/// away did nothing — putting it in the history would make every cap breach look like an edit.
#[test]
fn a_refused_mutation_is_not_recorded() {
    let caps = MemoryCaps {
        max_len_per_memory: Some(4),
        ..MemoryCaps::UNBOUNDED
    };
    let mut store = MemoryStore::new(MemoryStrategy::Scratchpad, caps);
    store
        .write("", "plan", "d", "over the limit", MemoryCode::default())
        .unwrap_err();
    store.update("", "nope", "d", "ok", None).unwrap_err();
    store.delete("", "nope").unwrap_err();
    assert!(recorded(&store).is_empty());
}

/// The two file-shaped strategies record through their own calls too — `create_memory` and
/// `edit_memory` are mutations like any other, and an edit's revision carries the *result* of the
/// search/replace rather than the fragment that was swapped in.
#[test]
fn the_file_shaped_calls_are_recorded_too() {
    let mut store = MemoryStore::new(MemoryStrategy::Markdown, MemoryCaps::UNBOUNDED);
    store
        .create("", "layout", "the layout", "a grid", MemoryCode::default())
        .unwrap();
    store.edit("", "layout", "a grid", "a hex grid").unwrap();

    let events = recorded(&store);
    let (_, rev, change, _, body, ..) = revision(&events[1]);
    assert_eq!((rev, change), (2, GgMemoryChange::Updated));
    assert_eq!(body, "a hex grid", "the whole memory, not the replacement");
}

// ---------------------------------------------------------------------------
// Line counts
// ---------------------------------------------------------------------------

/// Lines are reported beside characters because they measure different things: a dense paragraph
/// and a long checklist can cost the same characters and read nothing alike.
#[test]
fn bodies_report_their_line_count() {
    let mut store = store();
    store
        .write("", "one", "d", "a single line", MemoryCode::default())
        .unwrap();
    store
        .write(
            "",
            "many",
            "d",
            "first\nsecond\nthird",
            MemoryCode::default(),
        )
        .unwrap();

    let GgTelemetryKind::MemoryState {
        memories,
        total_len,
        total_lines,
        ..
    } = state(&store)
    else {
        panic!("expected a MemoryState");
    };
    // In slug order: `many` then `one`.
    assert_eq!((memories[0].name.as_str(), memories[0].lines), ("many", 3));
    assert_eq!((memories[1].name.as_str(), memories[1].lines), ("one", 1));
    assert_eq!(total_lines, 4);
    assert_eq!(total_len, 18 + 13);
}

/// A body is stored trimmed and is never empty, so its line count is never zero — a one-line
/// memory is one line, not none.
#[test]
fn a_one_line_body_counts_as_one_line() {
    let mut store = store();
    store
        .write("", "plan", "d", "  just this  ", MemoryCode::default())
        .unwrap();
    assert_eq!(store.total_lines(), 1);
    assert_eq!(store.memories()[0].body(), "just this");
}

// ---------------------------------------------------------------------------
// Peaks
// ---------------------------------------------------------------------------

/// The peaks are the answer to "how much memory did this run actually use", which the live figures
/// cannot give: a model that curates well spends its budget and then prunes, and ends looking like
/// a model that never wrote anything.
#[test]
fn peaks_survive_the_pruning_that_clears_the_live_set() {
    let mut store = store();
    store
        .write("", "a", "d", "aaaa\naaaa", MemoryCode::default())
        .unwrap();
    store
        .write("", "b", "d", "bbbbbb", MemoryCode::default())
        .unwrap();
    assert_eq!(store.peak().count, 2);
    assert_eq!(store.peak().total_len, 15);
    assert_eq!(store.peak().total_lines, 3);

    store.delete("", "a").unwrap();
    store.delete("", "b").unwrap();

    // Nothing is held, and the record still says what was.
    assert_eq!(store.count(), 0);
    assert_eq!(store.total_len(), 0);
    assert_eq!(store.peak().count, 2);
    assert_eq!(store.peak().total_len, 15);
    assert_eq!(store.peak().total_lines, 3);
}

/// A peak only ever rises. Shrinking a memory in place frees budget, and the high-water mark is
/// the mark, not the current level.
#[test]
fn a_peak_never_falls() {
    let mut store = store();
    store
        .write("", "plan", "d", &"x".repeat(100), MemoryCode::default())
        .unwrap();
    assert_eq!(store.peak().total_len, 100);
    store.update("", "plan", "d", "tiny", None).unwrap();
    assert_eq!(store.total_len(), 4);
    assert_eq!(store.peak().total_len, 100);
}

#[test]
fn the_state_event_reports_the_peaks() {
    let mut store = store();
    store
        .write("", "plan", "d", "a\nb\nc", MemoryCode::default())
        .unwrap();
    store.delete("", "plan").unwrap();

    let GgTelemetryKind::MemoryState { count, peak, .. } = state(&store) else {
        panic!("expected a MemoryState");
    };
    assert_eq!(count, 0);
    assert_eq!(peak.count, 1);
    assert_eq!(peak.total_len, 5);
    assert_eq!(peak.total_lines, 3);
}

// ---------------------------------------------------------------------------
// The runtime's view
// ---------------------------------------------------------------------------

/// The runtime hands the loop every revision recorded since it last looked — which under
/// [responses-as-code](crate::sandbox) can be several, because a program makes as many memory calls
/// as it likes before the loop next drains.
#[test]
fn the_runtime_drains_a_whole_batch() {
    let runtime = MemoriesRuntime::new(MemoryStrategy::Scratchpad, MemoryCaps::UNBOUNDED);
    {
        let mut store = runtime.store().lock().unwrap().clone();
        // Mutating a clone must not reach the runtime — the shared handle is the store.
        store
            .write("", "stray", "d", "body", MemoryCode::default())
            .unwrap();
    }
    assert!(runtime.revision_events().is_empty());

    {
        let store = runtime.store();
        let mut store = store.lock().unwrap();
        store
            .write("", "a", "d", "one", MemoryCode::default())
            .unwrap();
        store
            .write("", "b", "d", "two", MemoryCode::default())
            .unwrap();
        store.delete("", "a").unwrap();
    }
    let events = runtime.revision_events();
    assert_eq!(events.len(), 3);
    assert!(
        runtime.revision_events().is_empty(),
        "the batch was drained"
    );
}

/// A disabled runtime records nothing, like every other part of a switched-off capability — there are
/// no memory tools to produce a revision in the first place.
#[test]
fn a_disabled_runtime_reports_no_revisions() {
    let runtime = MemoriesRuntime::disabled();
    assert!(runtime.revision_events().is_empty());
    assert!(runtime.state_event().is_none());
}

/// The caps a store enforces reach the telemetry, including the description limit, so a console can
/// show every limit the run is actually holding the model to.
#[test]
fn the_state_event_reports_the_description_cap() {
    let caps = MemoryCaps::resolve(
        MemoryStrategy::Markdown,
        &GgCapabilityConfig {
            id: CAPABILITY_MEMORIES.to_string(),
            enabled: true,
            implementation: None,
            params: json!({
                PARAM_MAX_COUNT: 0,
                PARAM_MAX_LEN_PER_MEMORY: 0,
                PARAM_MAX_TOTAL_LEN: 0,
                PARAM_MAX_LEN_INDEX: 0,
                PARAM_MAX_LEN_DESCRIPTION: 80,
                PARAM_MAX_RESULTS: 0,
            }),
        },
        &mut LaunchReport::Discarding,
    );
    let store = MemoryStore::new(MemoryStrategy::Markdown, caps);
    let GgTelemetryKind::MemoryState { caps, .. } = state(&store) else {
        panic!("expected a MemoryState");
    };
    assert_eq!(caps.max_len_description, Some(80));
}
