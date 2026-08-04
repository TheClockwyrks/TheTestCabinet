//! Tests for the [scratchpad](MemoryStrategy::Scratchpad) strategy: writes, updates, evictions and
//! limit enforcement, the limits' resolution, and the runtime's prompt / telemetry /
//! context-block derivations. The two file-shaped strategies are tested in
//! `memories.files.test.rs`, and the keyword ranking in `memories.search.test.rs`.

use serde_json::json;
use test_cabinet_core::gg::GgTelemetryKind;

use super::*;

/// Tiny limits for exercising the guards without huge fixtures: at most 2 memories, 10
/// characters of body each, 15 characters total.
fn tiny_caps() -> MemoryCaps {
    MemoryCaps {
        max_count: Some(2),
        max_len_per_memory: Some(10),
        max_total_len: Some(15),
        max_len_index: None,
        max_len_description: None,
        max_results: None,
    }
}

/// A scratchpad store bounded by [`tiny_caps`].
fn tiny_store() -> MemoryStore {
    MemoryStore::new(MemoryStrategy::Scratchpad, tiny_caps())
}

// ---------------------------------------------------------------------------
// Writes, updates, evictions
// ---------------------------------------------------------------------------

#[test]
fn write_creates_memories_in_name_order() {
    let mut store = MemoryStore::scratchpad();
    assert_eq!(
        store.write("", "zeta", "last", "z body", MemoryCode::default()),
        Ok(MemoryChange::Written)
    );
    assert_eq!(
        store.write("", "alpha", "first", "a body", MemoryCode::default()),
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
    let mut store = MemoryStore::scratchpad();
    assert_eq!(
        store.write("", "  n  ", "  d  ", "  hello  ", MemoryCode::default()),
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
    let mut store = MemoryStore::scratchpad();
    store
        .write("", "dup", "d", "body", MemoryCode::default())
        .unwrap();
    let err = store
        .write("", "dup", "d2", "other", MemoryCode::default())
        .unwrap_err();
    assert_eq!(
        err,
        MemoryError::Duplicate {
            name: "dup".to_string(),
            revise: "`update_memory`",
        }
    );
    // The guidance names the fix.
    assert!(err.to_string().contains("update_memory"));
    // The original is untouched.
    assert_eq!(store.memories()[0].body(), "body");
}

#[test]
fn update_replaces_in_place_and_needs_an_existing_name() {
    let mut store = MemoryStore::scratchpad();
    store
        .write("", "m", "d", "old body", MemoryCode::default())
        .unwrap();
    assert_eq!(
        store.update("", "m", "d2", "new body", None),
        Ok(MemoryChange::Updated)
    );
    assert_eq!(store.count(), 1);
    assert_eq!(store.memories()[0].description(), "d2");
    assert_eq!(store.memories()[0].body(), "new body");

    // Updating a name that does not exist is a NotFound, not a silent create.
    let err = store.update("", "nope", "d", "b", None).unwrap_err();
    assert_eq!(
        err,
        MemoryError::NotFound {
            name: "nope".to_string(),
            create: "`write_memory`",
        }
    );
    assert!(err.to_string().contains("write_memory"));
}

#[test]
fn delete_evicts_and_needs_an_existing_name() {
    let mut store = MemoryStore::scratchpad();
    store
        .write("", "a", "d", "aa", MemoryCode::default())
        .unwrap();
    store
        .write("", "b", "d", "bb", MemoryCode::default())
        .unwrap();
    assert_eq!(store.delete("", "a"), Ok(MemoryChange::Deleted));
    assert_eq!(store.count(), 1);
    assert_eq!(store.memories()[0].name(), "b");

    assert_eq!(
        store.delete("", "a").unwrap_err(),
        MemoryError::NotFound {
            name: "a".to_string(),
            create: "`write_memory`",
        }
    );
    assert_eq!(
        store.delete("", "  ").unwrap_err(),
        MemoryError::EmptyField("name")
    );
}

#[test]
fn writes_reject_empty_fields() {
    let mut store = MemoryStore::scratchpad();
    assert_eq!(
        store
            .write("", "", "d", "b", MemoryCode::default())
            .unwrap_err(),
        MemoryError::EmptyField("name")
    );
    assert_eq!(
        store
            .write("", "n", "  ", "b", MemoryCode::default())
            .unwrap_err(),
        MemoryError::EmptyField("description")
    );
    assert_eq!(
        store
            .write("", "n", "d", "", MemoryCode::default())
            .unwrap_err(),
        MemoryError::EmptyField("body")
    );
    assert_eq!(store.count(), 0);
}

// ---------------------------------------------------------------------------
// Cap enforcement (the revise-or-evict guards)
// ---------------------------------------------------------------------------

#[test]
fn per_memory_length_cap_is_enforced_with_a_revise_message() {
    let mut store = tiny_store();
    // 11 chars > the 10-char per-memory cap.
    let err = store
        .write("", "m", "d", "01234567890", MemoryCode::default())
        .unwrap_err();
    assert_eq!(
        err,
        MemoryError::PerMemoryCap {
            name: "m".to_string(),
            len: 11,
            cap: 10,
        }
    );
    assert!(err.to_string().contains("11 characters (max 10)"), "{err}");
    assert_eq!(store.count(), 0, "an over-cap write must not be stored");
}

#[test]
fn count_cap_is_enforced_with_a_revise_or_evict_message() {
    let mut store = tiny_store();
    store
        .write("", "a", "d", "aa", MemoryCode::default())
        .unwrap();
    store
        .write("", "b", "d", "bb", MemoryCode::default())
        .unwrap();
    // The third write hits the 2-memory count cap.
    let err = store
        .write("", "c", "d", "cc", MemoryCode::default())
        .unwrap_err();
    assert_eq!(
        err,
        MemoryError::CountCap {
            cap: 2,
            revise: "`update_memory`",
            delete: "`delete_memory`",
        }
    );
    let message = err.to_string();
    assert!(message.contains("update_memory"));
    assert!(message.contains("delete_memory"));
    assert_eq!(store.count(), 2);
}

#[test]
fn total_length_cap_is_enforced_across_memories() {
    let mut store = tiny_store();
    store
        .write("", "a", "d", "0123456789", MemoryCode::default())
        .unwrap(); // 10 chars
    // Adding 6 more would be 16 > the 15-char total cap (and count is fine at 2).
    let err = store
        .write("", "b", "d", "abcdef", MemoryCode::default())
        .unwrap_err();
    assert_eq!(
        err,
        MemoryError::TotalCap {
            would_be: 16,
            cap: 15
        }
    );
    assert!(err.to_string().contains("16 characters (max 15)"), "{err}");
    assert_eq!(store.total_len(), 10);

    // A 5-char body fits (15 total, at the cap).
    assert_eq!(
        store.write("", "b", "d", "abcde", MemoryCode::default()),
        Ok(MemoryChange::Written)
    );
    assert_eq!(store.total_len(), 15);
}

#[test]
fn update_swaps_the_old_body_out_of_the_total_before_checking() {
    let mut store = tiny_store();
    store
        .write("", "a", "d", "0123456789", MemoryCode::default())
        .unwrap(); // 10 chars, at total budget minus 5
    store
        .write("", "b", "d", "abcde", MemoryCode::default())
        .unwrap(); // 5 chars -> total 15, at the cap
    // Updating `b` from 5 to 5 chars is fine even though total is at the cap: the old body
    // is removed from the total before the new one is checked in.
    assert_eq!(
        store.update("", "b", "d", "vwxyz", None),
        Ok(MemoryChange::Updated)
    );
    assert_eq!(store.total_len(), 15);
    // But growing `b` to 6 chars would be 16 > 15.
    let err = store.update("", "b", "d", "vwxyz!", None).unwrap_err();
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
    let strategy = MemoryStrategy::Scratchpad;
    assert_eq!(
        MemoryCaps::resolve(strategy, &json!({})),
        MemoryCaps::default()
    );
    // A non-integer value is ignored in favor of the default.
    let caps = MemoryCaps::resolve(strategy, &json!({ "maxLenPerMemory": "big" }));
    assert_eq!(caps, MemoryCaps::default());
}

#[test]
fn caps_resolve_each_param_when_present() {
    let caps = MemoryCaps::resolve(
        MemoryStrategy::Scratchpad,
        &json!({
            "maxCount": 3,
            "maxLenPerMemory": 100,
            "maxTotalLen": 250,
        }),
    );
    assert_eq!(caps.max_count, Some(3));
    assert_eq!(caps.max_len_per_memory, Some(100));
    assert_eq!(caps.max_total_len, Some(250));
}

/// `0` is how a run **disables** a limit — the one spelling for "unlimited" — and a disabled limit
/// is `None` rather than a zero the guards would then have to special-case.
#[test]
fn a_zero_param_disables_that_limit() {
    let caps = MemoryCaps::resolve(
        MemoryStrategy::Scratchpad,
        &json!({ "maxCount": 0, "maxTotalLen": 0 }),
    );
    assert_eq!(caps.max_count, None);
    assert_eq!(caps.max_total_len, None);
    // The limits that were not named keep their defaults.
    assert_eq!(caps.max_len_per_memory, Some(DEFAULT_MAX_LEN_PER_MEMORY));

    // And an unlimited store really is unlimited: past the default count, with a huge body.
    let mut store = MemoryStore::new(MemoryStrategy::Scratchpad, caps);
    for n in 0..DEFAULT_MAX_COUNT + 4 {
        store
            .write(
                "",
                &format!("m{n}"),
                "d",
                &"x".repeat(1_000),
                MemoryCode::default(),
            )
            .unwrap();
    }
    assert_eq!(store.count(), DEFAULT_MAX_COUNT + 4);
}

/// The description limit applies under **every** strategy — unlike the others, which each belong to
/// one or two — and every strategy defaults it to the same number.
///
/// It is the one field every turn pays for, wherever it appears: an index line and a search hit are
/// mostly description. So it is bounded everywhere rather than left to hope.
#[test]
fn the_description_cap_defaults_everywhere_and_is_configurable_everywhere() {
    for strategy in [
        MemoryStrategy::Scratchpad,
        MemoryStrategy::Markdown,
        MemoryStrategy::KeywordSearch,
    ] {
        assert_eq!(
            MemoryCaps::for_strategy(strategy).max_len_description,
            Some(DEFAULT_MAX_LEN_DESCRIPTION),
            "{strategy:?} bounds descriptions by default"
        );
        let caps = MemoryCaps::resolve(strategy, &json!({ "maxLenDescription": 40 }));
        assert_eq!(caps.max_len_description, Some(40), "{strategy:?}");
    }
    // And `0` disables it, the same spelling every other limit uses.
    let caps = MemoryCaps::resolve(MemoryStrategy::Markdown, &json!({ "maxLenDescription": 0 }));
    assert_eq!(caps.max_len_description, None);
}

/// An over-long description is refused rather than truncated, and the refusal tells the model what
/// a description is *for* — the point is a scannable index, so "shorten it" without saying why
/// would just invite a description that is shorter and still a paragraph.
#[test]
fn the_description_cap_refuses_a_long_one_liner() {
    let caps = MemoryCaps {
        max_len_description: Some(20),
        ..MemoryCaps::default()
    };
    let mut store = MemoryStore::new(MemoryStrategy::Scratchpad, caps);
    let long = "a".repeat(21);
    let err = store
        .write("", "plan", &long, "the goal", MemoryCode::default())
        .unwrap_err();
    assert_eq!(
        err,
        MemoryError::DescriptionCap {
            name: "plan".to_string(),
            len: 21,
            cap: 20,
        }
    );
    assert!(err.to_string().contains("21 characters (max 20)"), "{err}");
    // Nothing was stored: a refused write leaves the set exactly as it was.
    assert_eq!(store.count(), 0);

    // At the limit is fine, and so is revising to a shorter one.
    store
        .write(
            "",
            "plan",
            &"a".repeat(20),
            "the goal",
            MemoryCode::default(),
        )
        .unwrap();
    assert_eq!(store.count(), 1);
    let err = store
        .update("", "plan", &long, "the goal", None)
        .unwrap_err();
    assert!(matches!(err, MemoryError::DescriptionCap { .. }));
    store.update("", "plan", "short", "the goal", None).unwrap();
    assert_eq!(store.memories()[0].description(), "short");
}

/// The description cap is checked **before** the body caps, so a call that breaches both is told
/// about the cheaper fix first — a model that shortens its one-liner and resubmits should not then
/// be refused again for the body it had no reason to think was the problem.
#[test]
fn the_description_cap_is_reported_before_the_body_caps() {
    let caps = MemoryCaps {
        max_len_per_memory: Some(5),
        max_len_description: Some(5),
        ..MemoryCaps::default()
    };
    let mut store = MemoryStore::new(MemoryStrategy::Scratchpad, caps);
    let err = store
        .write(
            "",
            "plan",
            &"d".repeat(50),
            &"b".repeat(50),
            MemoryCode::default(),
        )
        .unwrap_err();
    assert!(matches!(err, MemoryError::DescriptionCap { .. }), "{err:?}");
}

/// A param a strategy does not use is ignored rather than rejected, so one sweep can hand every
/// arm the same params block — and the limit stays `None` however the params spell it.
#[test]
fn a_param_the_strategy_does_not_use_is_ignored() {
    let caps = MemoryCaps::resolve(
        MemoryStrategy::Scratchpad,
        &json!({ "maxLenIndex": 4_096, "maxResults": 10 }),
    );
    assert_eq!(caps.max_len_index, None);
    assert_eq!(caps.max_results, None);
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
    let runtime = MemoriesRuntime::new(MemoryStrategy::Scratchpad, tiny_caps());
    assert!(runtime.offers_memories());
    assert_eq!(runtime.caps(), tiny_caps());
}

#[test]
fn state_event_starts_empty_with_caps_then_reflects_writes() {
    let runtime = MemoriesRuntime::new(MemoryStrategy::Scratchpad, tiny_caps());

    // At the start: an empty list, zero totals, the caps present.
    let GgTelemetryKind::MemoryState {
        strategy,
        memories,
        count,
        total_len,
        caps,
        ..
    } = runtime.state_event().unwrap()
    else {
        panic!("expected a MemoryState");
    };
    assert_eq!(strategy, "scratchpad");
    assert!(memories.is_empty());
    assert_eq!(count, 0);
    assert_eq!(total_len, 0);
    assert_eq!(caps.max_count, Some(2));
    // A limit this strategy does not use is absent, not zero.
    assert_eq!(caps.max_len_index, None);

    // After the model (through the shared store) writes one, the state reflects it.
    runtime
        .store()
        .lock()
        .unwrap()
        .write("", "plan", "the plan", "aaa", MemoryCode::default())
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
    let runtime = MemoriesRuntime::new(MemoryStrategy::Scratchpad, tiny_caps());
    assert!(runtime.context_block().is_none());

    runtime
        .store()
        .lock()
        .unwrap()
        .write("", "plan", "the plan", "the goal", MemoryCode::default())
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
