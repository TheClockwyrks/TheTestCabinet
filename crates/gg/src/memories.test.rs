//! Tests for the [scratchpad](MemoryStrategy::Scratchpad) strategy: writes, updates, evictions and
//! limit enforcement, the limits' resolution, and the runtime's prompt / telemetry /
//! context-block derivations. The two file-shaped strategies are tested in
//! `memories.files.test.rs`, and the keyword ranking in `memories.search.test.rs`.

use serde_json::{Value, json};
use test_cabinet_core::gg::GgTelemetryKind;

use super::*;

/// A sink that **asserts nothing is reported** — for the values gg honours exactly as written.
fn honoured() -> LaunchReport {
    LaunchReport::Discarding
}

/// Everything `read` reports, for the cases whose subject is the refusal.
fn reported(read: impl FnOnce(&mut LaunchReport)) -> Vec<LaunchDefect> {
    let mut report = LaunchReport::collecting();
    read(&mut report);
    report.into_defects()
}

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

/// One memories capability carrying exactly `params`, on or off.
///
/// Built by hand rather than [authored](GgCapabilityConfig::enabled): what these cases are about is
/// a document short of, or wrong about, one value, and the authoring catalog writes documents that
/// are neither.
fn capability(enabled: bool, params: Value) -> GgCapabilityConfig {
    GgCapabilityConfig {
        id: CAPABILITY_MEMORIES.to_string(),
        enabled,
        implementation: None,
        params,
    }
}

/// The six limits an enabled memories capability writes, as a params object — every one of them
/// `0`, which is how a run lifts one — with `overrides` merged over them.
fn every_limit(overrides: Value) -> Value {
    let mut params = json!({
        PARAM_MAX_COUNT: 0,
        PARAM_MAX_LEN_PER_MEMORY: 0,
        PARAM_MAX_TOTAL_LEN: 0,
        PARAM_MAX_LEN_INDEX: 0,
        PARAM_MAX_LEN_DESCRIPTION: 0,
        PARAM_MAX_RESULTS: 0,
    });
    for (key, value) in overrides.as_object().expect("an object of overrides") {
        params[key] = value.clone();
    }
    params
}

/// A fully specified, enabled memories capability: all six limits, with `overrides` merged over
/// them. The document a case that is not itself about an absence starts from, so that whatever it
/// does not name bounds nothing.
fn specified(overrides: Value) -> GgCapabilityConfig {
    capability(true, every_limit(overrides))
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
            revise: "`update_memory`".to_string(),
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
            create: "`write_memory`".to_string(),
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
            create: "`write_memory`".to_string(),
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
            revise: "`update_memory`".to_string(),
            delete: "`delete_memory`".to_string(),
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

/// **Every limit an enabled capability leaves out refuses the launch**, named at its own key.
///
/// gg substitutes nothing: a limit is what a memories arm is *bounded* by, and a run bounded by a
/// figure nobody wrote is one whose numbers cannot be compared with the arm beside it — and nothing
/// in its record would say why. An explicit `null` is an absence, on exactly the same terms.
#[test]
fn an_enabled_capability_short_of_a_limit_is_refused() {
    for key in [
        PARAM_MAX_COUNT,
        PARAM_MAX_LEN_PER_MEMORY,
        PARAM_MAX_TOTAL_LEN,
        PARAM_MAX_LEN_INDEX,
        PARAM_MAX_LEN_DESCRIPTION,
        PARAM_MAX_RESULTS,
    ] {
        for short in [
            {
                let mut params = every_limit(json!({}));
                params.as_object_mut().unwrap().remove(key);
                capability(true, params)
            },
            specified(json!({ key: Value::Null })),
        ] {
            let defects = reported(|report| {
                MemoryCaps::resolve(MemoryStrategy::Scratchpad, &short, report);
            });
            assert_eq!(defects.len(), 1, "{key} -> {defects:?}");
            assert_eq!(defects[0].locus, format!("memories.params.{key}"));
            assert!(
                defects[0]
                    .message
                    .contains(&format!("is on and writes no `{key}`")),
                "{}",
                defects[0].message
            );
        }
    }
}

/// **A disabled capability is owed nothing.** It bounds no memories, so there is no limit for it to
/// be short of; what it carries is the configuration the arm *would* have used, which is what lets
/// the on and off arms of one comparison be one document with one switch moved.
#[test]
fn a_disabled_capability_is_owed_no_limit() {
    let off = capability(false, json!({}));
    let caps = MemoryCaps::resolve(MemoryStrategy::Scratchpad, &off, &mut honoured());
    assert_eq!(caps, MemoryCaps::UNBOUNDED);

    // Everything it *does* write is still read, so a typo in the off arm is heard about now rather
    // than on the launch that flips the switch.
    let off = capability(false, json!({ PARAM_MAX_COUNT: "lots" }));
    let defects = reported(|report| {
        MemoryCaps::resolve(MemoryStrategy::Scratchpad, &off, report);
    });
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "memories.params.maxCount");
}

/// A limit gg cannot read is **refused**, and the limit it would have set stands at the
/// [placeholder](LIMIT_OF_A_REFUSED_LAUNCH) — the resolver is total, and the run is not going to
/// start.
#[test]
fn a_limit_gg_cannot_read_is_refused() {
    for value in [
        json!("big"),
        json!(-1),
        json!(1.5),
        json!(true),
        json!([10]),
    ] {
        let capability = specified(json!({ PARAM_MAX_LEN_PER_MEMORY: value.clone() }));
        let defects = reported(|report| {
            assert_eq!(
                MemoryCaps::resolve(MemoryStrategy::Scratchpad, &capability, report)
                    .max_len_per_memory,
                LIMIT_OF_A_REFUSED_LAUNCH,
                "the resolver stays total"
            );
        });
        assert_eq!(defects.len(), 1, "{value} -> {defects:?}");
        assert_eq!(defects[0].locus, "memories.params.maxLenPerMemory");
    }
}

/// **An integral float is a count.** JSON has no integer type, so a sweep generated from JavaScript
/// writes `1e2` and `100.0` as readily as `100`; refusing those would be a usability regression
/// rather than a fallback fix.
#[test]
fn an_integral_float_is_a_valid_limit() {
    let caps = MemoryCaps::resolve(
        MemoryStrategy::Scratchpad,
        &specified(json!({ PARAM_MAX_COUNT: 3.0, PARAM_MAX_TOTAL_LEN: 2.5e2 })),
        &mut honoured(),
    );
    assert_eq!(caps.max_count, Some(3));
    assert_eq!(caps.max_total_len, Some(250));
}

#[test]
fn caps_resolve_each_param_when_present() {
    let caps = MemoryCaps::resolve(
        MemoryStrategy::Scratchpad,
        &specified(json!({
            PARAM_MAX_COUNT: 3,
            PARAM_MAX_LEN_PER_MEMORY: 100,
            PARAM_MAX_TOTAL_LEN: 250,
        })),
        &mut honoured(),
    );
    assert_eq!(caps.max_count, Some(3));
    assert_eq!(caps.max_len_per_memory, Some(100));
    assert_eq!(caps.max_total_len, Some(250));
}

/// `0` is how a run **lifts** a limit — the one spelling for "no bound at all" — and a lifted limit
/// is `None` rather than a zero the guards would then have to special-case.
#[test]
fn a_zero_param_lifts_that_limit() {
    let caps = MemoryCaps::resolve(
        MemoryStrategy::Scratchpad,
        &specified(json!({ PARAM_MAX_LEN_PER_MEMORY: 4_096 })),
        &mut honoured(),
    );
    assert_eq!(caps.max_count, None);
    assert_eq!(caps.max_total_len, None);
    // The one limit this document did bound is bounded.
    assert_eq!(caps.max_len_per_memory, Some(4_096));

    // And an unlimited store really is unlimited: far past any figure gg used to pick, with a
    // huge body on each.
    let mut store = MemoryStore::new(
        MemoryStrategy::Scratchpad,
        MemoryCaps::resolve(
            MemoryStrategy::Scratchpad,
            &specified(json!({})),
            &mut honoured(),
        ),
    );
    for n in 0..200 {
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
    assert_eq!(store.count(), 200);
}

/// The description limit applies under **every** strategy — unlike the others, which each belong to
/// one or two.
///
/// It is the one field every turn pays for, wherever it appears: an index line and a search hit are
/// mostly description. So it is bounded everywhere rather than left to hope.
#[test]
fn the_description_cap_is_configurable_under_every_strategy() {
    for strategy in MemoryStrategy::ALL {
        let caps = MemoryCaps::resolve(
            strategy,
            &specified(json!({ PARAM_MAX_LEN_DESCRIPTION: 40 })),
            &mut honoured(),
        );
        assert_eq!(caps.max_len_description, Some(40), "{strategy:?}");
    }
    // And `0` lifts it, the same spelling every other limit uses.
    let caps = MemoryCaps::resolve(
        MemoryStrategy::Markdown,
        &specified(json!({})),
        &mut honoured(),
    );
    assert_eq!(caps.max_len_description, None);
}

/// An over-long description is refused rather than truncated, and the refusal tells the model what
/// a description is *for* — the point is a scannable index, so "shorten it" without saying why
/// would just invite a description that is shorter and still a paragraph.
#[test]
fn the_description_cap_refuses_a_long_one_liner() {
    let caps = MemoryCaps {
        max_len_description: Some(20),
        ..MemoryCaps::UNBOUNDED
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
        ..MemoryCaps::UNBOUNDED
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

/// **The shared params block.** A limit the selected strategy does not apply bounds nothing under
/// it, so one sweep can hand every arm the same block — and the block is still written whole and
/// still read whole, which is what makes it the same block.
#[test]
fn a_limit_the_strategy_does_not_apply_bounds_nothing() {
    let caps = MemoryCaps::resolve(
        MemoryStrategy::Scratchpad,
        &specified(json!({ PARAM_MAX_LEN_INDEX: 4_096, PARAM_MAX_RESULTS: 10 })),
        &mut honoured(),
    );
    assert_eq!(caps.max_len_index, None);
    assert_eq!(caps.max_results, None);
}

// ---------------------------------------------------------------------------
// The runtime: the capability switch, prompt, telemetry, context block
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
