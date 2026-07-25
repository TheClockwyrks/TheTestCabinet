//! Tests for the memory store (writes/updates/evictions and cap enforcement), the caps
//! resolution, and the runtime's prompt / telemetry / context-block derivations.

use serde_json::json;
use test_cabinet_core::gg::GgTelemetryKind;

use super::*;

/// Tiny caps for exercising the guards without huge fixtures: at most 2 memories, 10
/// characters of body each, 15 characters total.
fn tiny_caps() -> MemoryCaps {
    MemoryCaps {
        max_count: 2,
        max_len_per_memory: 10,
        max_total_len: 15,
    }
}

// ---------------------------------------------------------------------------
// Writes, updates, evictions
// ---------------------------------------------------------------------------

#[test]
fn write_creates_memories_in_name_order() {
    let mut store = MemoryStore::new(MemoryCaps::default());
    assert_eq!(
        store.write("zeta", "last", "z body"),
        Ok(MemoryChange::Written)
    );
    assert_eq!(
        store.write("alpha", "first", "a body"),
        Ok(MemoryChange::Written)
    );

    assert_eq!(store.count(), 2);
    // Ordered by name for a stable prompt/telemetry order.
    assert_eq!(store.memories()[0].name(), "alpha");
    assert_eq!(store.memories()[1].name(), "zeta");
    assert_eq!(store.memories()[0].body(), "a body");
    assert_eq!(store.memories()[0].description(), "first");
}

#[test]
fn write_trims_fields_and_measures_body_length() {
    let mut store = MemoryStore::new(MemoryCaps::default());
    assert_eq!(
        store.write("  n  ", "  d  ", "  hello  "),
        Ok(MemoryChange::Written)
    );
    let memory = &store.memories()[0];
    assert_eq!(memory.name(), "n");
    assert_eq!(memory.description(), "d");
    assert_eq!(memory.body(), "hello");
    // Length is the trimmed body's character count.
    assert_eq!(memory.len(), 5);
    assert_eq!(store.total_len(), 5);
}

#[test]
fn write_rejects_a_duplicate_name_pointing_at_update() {
    let mut store = MemoryStore::new(MemoryCaps::default());
    store.write("dup", "d", "body").unwrap();
    let err = store.write("dup", "d2", "other").unwrap_err();
    assert_eq!(err, MemoryError::Duplicate("dup".to_string()));
    // The guidance names the fix.
    assert!(err.to_string().contains("update_memory"));
    // The original is untouched.
    assert_eq!(store.memories()[0].body(), "body");
}

#[test]
fn update_replaces_in_place_and_needs_an_existing_name() {
    let mut store = MemoryStore::new(MemoryCaps::default());
    store.write("m", "d", "old body").unwrap();
    assert_eq!(
        store.update("m", "d2", "new body"),
        Ok(MemoryChange::Updated)
    );
    assert_eq!(store.count(), 1);
    assert_eq!(store.memories()[0].description(), "d2");
    assert_eq!(store.memories()[0].body(), "new body");

    // Updating a name that does not exist is a NotFound, not a silent create.
    let err = store.update("nope", "d", "b").unwrap_err();
    assert_eq!(err, MemoryError::NotFound("nope".to_string()));
    assert!(err.to_string().contains("write_memory"));
}

#[test]
fn delete_evicts_and_needs_an_existing_name() {
    let mut store = MemoryStore::new(MemoryCaps::default());
    store.write("a", "d", "aa").unwrap();
    store.write("b", "d", "bb").unwrap();
    assert_eq!(store.delete("a"), Ok(MemoryChange::Deleted));
    assert_eq!(store.count(), 1);
    assert_eq!(store.memories()[0].name(), "b");

    assert_eq!(
        store.delete("a").unwrap_err(),
        MemoryError::NotFound("a".to_string())
    );
    assert_eq!(
        store.delete("  ").unwrap_err(),
        MemoryError::EmptyField("name")
    );
}

#[test]
fn writes_reject_empty_fields() {
    let mut store = MemoryStore::new(MemoryCaps::default());
    assert_eq!(
        store.write("", "d", "b").unwrap_err(),
        MemoryError::EmptyField("name")
    );
    assert_eq!(
        store.write("n", "  ", "b").unwrap_err(),
        MemoryError::EmptyField("description")
    );
    assert_eq!(
        store.write("n", "d", "").unwrap_err(),
        MemoryError::EmptyField("body")
    );
    assert_eq!(store.count(), 0);
}

// ---------------------------------------------------------------------------
// Cap enforcement (the revise-or-evict guards)
// ---------------------------------------------------------------------------

#[test]
fn per_memory_length_cap_is_enforced_with_a_revise_message() {
    let mut store = MemoryStore::new(tiny_caps());
    // 11 chars > the 10-char per-memory cap.
    let err = store.write("m", "d", "01234567890").unwrap_err();
    assert_eq!(
        err,
        MemoryError::PerMemoryCap {
            name: "m".to_string(),
            len: 11,
            cap: 10,
        }
    );
    assert!(err.to_string().contains("concise"));
    assert_eq!(store.count(), 0, "an over-cap write must not be stored");
}

#[test]
fn count_cap_is_enforced_with_a_revise_or_evict_message() {
    let mut store = MemoryStore::new(tiny_caps());
    store.write("a", "d", "aa").unwrap();
    store.write("b", "d", "bb").unwrap();
    // The third write hits the 2-memory count cap.
    let err = store.write("c", "d", "cc").unwrap_err();
    assert_eq!(err, MemoryError::CountCap { cap: 2 });
    let message = err.to_string();
    assert!(message.contains("update_memory"));
    assert!(message.contains("delete_memory"));
    assert_eq!(store.count(), 2);
}

#[test]
fn total_length_cap_is_enforced_across_memories() {
    let mut store = MemoryStore::new(tiny_caps());
    store.write("a", "d", "0123456789").unwrap(); // 10 chars
    // Adding 6 more would be 16 > the 15-char total cap (and count is fine at 2).
    let err = store.write("b", "d", "abcdef").unwrap_err();
    assert_eq!(
        err,
        MemoryError::TotalCap {
            would_be: 16,
            cap: 15
        }
    );
    assert!(err.to_string().contains("delete"));
    assert_eq!(store.total_len(), 10);

    // A 5-char body fits (15 total, at the cap).
    assert_eq!(store.write("b", "d", "abcde"), Ok(MemoryChange::Written));
    assert_eq!(store.total_len(), 15);
}

#[test]
fn update_swaps_the_old_body_out_of_the_total_before_checking() {
    let mut store = MemoryStore::new(tiny_caps());
    store.write("a", "d", "0123456789").unwrap(); // 10 chars, at total budget minus 5
    store.write("b", "d", "abcde").unwrap(); // 5 chars -> total 15, at the cap
    // Updating `b` from 5 to 5 chars is fine even though total is at the cap: the old body
    // is removed from the total before the new one is checked in.
    assert_eq!(store.update("b", "d", "vwxyz"), Ok(MemoryChange::Updated));
    assert_eq!(store.total_len(), 15);
    // But growing `b` to 6 chars would be 16 > 15.
    let err = store.update("b", "d", "vwxyz!").unwrap_err();
    assert_eq!(
        err,
        MemoryError::TotalCap {
            would_be: 16,
            cap: 15
        }
    );
    // The original 5-char body survived the rejected update.
    assert_eq!(store.memories()[1].body(), "vwxyz");
}

// ---------------------------------------------------------------------------
// Caps resolution
// ---------------------------------------------------------------------------

#[test]
fn caps_default_when_params_absent_or_invalid() {
    assert_eq!(MemoryCaps::resolve(&json!({})), MemoryCaps::default());
    // Zero and non-integer values are ignored in favor of the defaults.
    let caps = MemoryCaps::resolve(&json!({ "maxCount": 0, "maxLenPerMemory": "big" }));
    assert_eq!(caps, MemoryCaps::default());
}

#[test]
fn caps_resolve_each_param_when_present() {
    let caps = MemoryCaps::resolve(&json!({
        "maxCount": 3,
        "maxLenPerMemory": 100,
        "maxTotalLen": 250,
    }));
    assert_eq!(caps.max_count, 3);
    assert_eq!(caps.max_len_per_memory, 100);
    assert_eq!(caps.max_total_len, 250);
}

// ---------------------------------------------------------------------------
// The runtime: ablation, prompt, telemetry, context block
// ---------------------------------------------------------------------------

#[test]
fn disabled_runtime_offers_nothing() {
    let runtime = MemoriesRuntime::disabled();
    assert!(!runtime.offers_memories());
    assert!(runtime.state_event().is_none());
    assert!(runtime.context_block().is_none());
}

/// An enabled runtime reports the caps the [system prompt](crate::prompts::SystemContext::memories)
/// states up front, so the model knows its budget before it writes a note.
#[test]
fn enabled_runtime_reports_its_caps() {
    let runtime = MemoriesRuntime::new(tiny_caps());
    assert!(runtime.offers_memories());
    assert_eq!(runtime.caps(), tiny_caps());
}

#[test]
fn state_event_starts_empty_with_caps_then_reflects_writes() {
    let runtime = MemoriesRuntime::new(tiny_caps());

    // At the start: an empty list, zero totals, the caps present.
    let GgTelemetryKind::MemoryState {
        memories,
        count,
        total_len,
        caps,
    } = runtime.state_event().unwrap()
    else {
        panic!("expected a MemoryState");
    };
    assert!(memories.is_empty());
    assert_eq!(count, 0);
    assert_eq!(total_len, 0);
    assert_eq!(caps.max_count, 2);

    // After the model (through the shared store) writes one, the state reflects it.
    runtime
        .store()
        .lock()
        .unwrap()
        .write("plan", "the plan", "aaa")
        .unwrap();
    let GgTelemetryKind::MemoryState {
        memories,
        count,
        total_len,
        ..
    } = runtime.state_event().unwrap()
    else {
        panic!("expected a MemoryState");
    };
    assert_eq!(count, 1);
    assert_eq!(total_len, 3);
    assert_eq!(memories[0].name, "plan");
    assert_eq!(memories[0].description, "the plan");
    assert_eq!(memories[0].len, 3);
}

#[test]
fn context_block_is_none_when_empty_and_lists_bodies_when_not() {
    let runtime = MemoriesRuntime::new(tiny_caps());
    assert!(runtime.context_block().is_none());

    runtime
        .store()
        .lock()
        .unwrap()
        .write("plan", "the plan", "the goal")
        .unwrap();
    let block = runtime
        .context_block()
        .expect("a block once a memory exists");
    let content = block.content.expect("the block has content");
    // The block names the memory, its description, and its body so the model sees them.
    assert!(content.contains("Your memories"));
    assert!(content.contains("plan"));
    assert!(content.contains("the plan"));
    assert!(content.contains("the goal"));
}
