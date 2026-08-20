//! Tests for the two **file-shaped** strategies: [markdown](MemoryStrategy::Markdown)'s index and
//! [keyword-search](MemoryStrategy::KeywordSearch)'s absence of one, the create/read/edit/delete
//! surface they share, and the strategy resolution that selects between them.

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

/// A markdown store bounded by nothing — these cases are about the index, not about the ceilings.
fn markdown_store() -> MemoryStore {
    MemoryStore::new(MemoryStrategy::Markdown, MemoryCaps::UNBOUNDED)
}

/// A keyword-search store bounded by nothing, for the same reason.
fn keyword_store() -> MemoryStore {
    MemoryStore::new(MemoryStrategy::KeywordSearch, MemoryCaps::UNBOUNDED)
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

/// An enabled memories capability writing all six limits — every one of them `0`, which is how a
/// run lifts one — with `overrides` merged over them. The fully specified document a case that is
/// not itself about an absence starts from, so that whatever it does not name bounds nothing.
fn specified(overrides: Value) -> GgCapabilityConfig {
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
    capability(true, params)
}

// ---------------------------------------------------------------------------
// Strategy resolution
// ---------------------------------------------------------------------------

#[test]
fn strategy_resolves_from_the_implementation() {
    assert_eq!(
        MemoryStrategy::resolve(Some("markdown"), &mut honoured()),
        MemoryStrategy::Markdown
    );
    assert_eq!(
        MemoryStrategy::resolve(Some("  keyword-search  "), &mut honoured()),
        MemoryStrategy::KeywordSearch
    );
    assert_eq!(
        MemoryStrategy::resolve(Some("scratchpad"), &mut honoured()),
        MemoryStrategy::Scratchpad
    );
}

/// An **absent** (or `null`, or blank) strategy is the one absence this resolver does not report.
///
/// It is a defect on an enabled capability — and [`check_implementation`](crate::validate) refuses
/// it there, because it can see the switch and this cannot. What comes back here is the
/// [placeholder](STRATEGY_OF_A_REFUSED_LAUNCH), silently, so the hole is named once by the reader
/// that can tell which document it is in.
#[test]
fn an_absent_strategy_is_not_this_resolvers_to_report() {
    for absent in [None, Some(""), Some("  ")] {
        assert_eq!(
            MemoryStrategy::resolve(absent, &mut honoured()),
            STRATEGY_OF_A_REFUSED_LAUNCH,
            "{absent:?}"
        );
    }
}

/// A strategy gg does not offer is **refused**. Each one offers a different set of calls and pins a
/// different thing in the window, so a run that quietly took the scratchpad while its record said
/// `vector-index` would be a memories study measuring the arm it did not configure.
#[test]
fn an_unknown_strategy_is_refused() {
    for unknown in ["vector-index", "markdwon", "Markdown"] {
        let defects = reported(|report| {
            assert_eq!(
                MemoryStrategy::resolve(Some(unknown), report),
                STRATEGY_OF_A_REFUSED_LAUNCH,
                "the resolver stays total"
            );
        });
        assert_eq!(defects.len(), 1, "{unknown} -> {defects:?}");
        assert_eq!(defects[0].found, unknown);
        assert_eq!(defects[0].locus, "memories.implementation");
        assert_eq!(
            defects[0].known,
            MemoryStrategy::ALL
                .map(|strategy| strategy.id().to_string())
                .to_vec()
        );
    }
}

/// Which of the six limits each strategy **applies**: a key the selected arm bounds nothing by is
/// `None` however the params read it, and the arm that does bound something by it is where the
/// figure is enforced. Every one of them is still written and still read — see
/// [`a_limit_the_strategy_does_not_apply_is_still_required`].
#[test]
fn each_strategy_applies_the_limits_it_has_something_to_bound() {
    let all = json!({
        PARAM_MAX_COUNT: 10,
        PARAM_MAX_LEN_PER_MEMORY: 20,
        PARAM_MAX_TOTAL_LEN: 30,
        PARAM_MAX_LEN_INDEX: 40,
        PARAM_MAX_LEN_DESCRIPTION: 50,
        PARAM_MAX_RESULTS: 60,
    });

    let markdown = MemoryCaps::resolve(
        MemoryStrategy::Markdown,
        &specified(all.clone()),
        &mut honoured(),
    );
    assert_eq!(markdown.max_len_index, Some(40));
    assert_eq!(markdown.max_len_per_memory, Some(20));
    assert_eq!(markdown.max_len_description, Some(50));
    // The index is what bounds a markdown run's population, and there is no pinned block of
    // bodies to sum or search to page.
    assert_eq!(markdown.max_count, None);
    assert_eq!(markdown.max_total_len, None);
    assert_eq!(markdown.max_results, None);

    let keyword = MemoryCaps::resolve(
        MemoryStrategy::KeywordSearch,
        &specified(all),
        &mut honoured(),
    );
    assert_eq!(keyword.max_count, Some(10));
    assert_eq!(keyword.max_len_per_memory, Some(20));
    assert_eq!(keyword.max_results, Some(60));
    assert_eq!(keyword.max_len_description, Some(50));
    // Nothing is pinned, so there is no aggregate and no index to bound.
    assert_eq!(keyword.max_total_len, None);
    assert_eq!(keyword.max_len_index, None);
}

/// **The shared params block, read from both ends.** A key the selected strategy does not apply is
/// still required of an enabled capability and still read — one sweep hands every arm the same
/// block, so a block that left out the keys its own arm ignores could not be the block beside it,
/// and a figure gg could not have honoured is heard about on every arm rather than on one.
#[test]
fn a_limit_the_strategy_does_not_apply_is_still_required() {
    let mut short = specified(json!({}));
    short
        .params
        .as_object_mut()
        .unwrap()
        .remove(PARAM_MAX_RESULTS);
    let defects = reported(|report| {
        assert_eq!(
            MemoryCaps::resolve(MemoryStrategy::Scratchpad, &short, report).max_results,
            LIMIT_OF_A_REFUSED_LAUNCH,
        );
    });
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "memories.params.maxResults");

    // …and a value gg could not read on such a key is reported on that arm too.
    let unreadable = specified(json!({ PARAM_MAX_RESULTS: "lots" }));
    let defects = reported(|report| {
        assert_eq!(
            MemoryCaps::resolve(MemoryStrategy::Scratchpad, &unreadable, report).max_results,
            None,
        );
    });
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "memories.params.maxResults");
}

/// Both file limits are individually disableable with `0`, which is what "it must be possible to
/// turn the limit off" means in a params block.
#[test]
fn markdown_limits_can_be_disabled_individually() {
    let caps = MemoryCaps::resolve(
        MemoryStrategy::Markdown,
        &specified(json!({ PARAM_MAX_LEN_INDEX: 0, PARAM_MAX_LEN_PER_MEMORY: 0 })),
        &mut honoured(),
    );
    assert_eq!(caps.max_len_index, None);
    assert_eq!(caps.max_len_per_memory, None);

    let mut store = MemoryStore::new(MemoryStrategy::Markdown, caps);
    // A body far over the default per-file limit, and enough entries to blow the default index.
    for n in 0..50 {
        store
            .create(
                "",
                &format!("memory-{n}"),
                &"d".repeat(200),
                &"x".repeat(20_000),
                MemoryCode::default(),
            )
            .unwrap();
    }
    assert_eq!(store.count(), 50);
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

#[test]
fn create_stores_the_contents_and_indexes_the_entry() {
    let mut store = markdown_store();
    assert_eq!(
        store.create(
            "",
            "build-commands",
            "How to build and test",
            "cargo nextest run",
            MemoryCode::default()
        ),
        Ok(MemoryChange::Written)
    );
    assert_eq!(store.count(), 1);
    assert_eq!(
        store.read("build-commands").unwrap().body(),
        "cargo nextest run"
    );
    assert_eq!(
        store.index_text(),
        "- `build-commands` — How to build and test"
    );
}

#[test]
fn create_rejects_a_duplicate_slug_and_leaves_the_original() {
    let mut store = markdown_store();
    store
        .create("", "dup", "d", "first", MemoryCode::default())
        .unwrap();
    assert_eq!(
        store
            .create("", "dup", "d2", "second", MemoryCode::default())
            .unwrap_err(),
        MemoryError::Duplicate {
            name: "dup".to_string(),
            revise: "`edit_memory`".to_string(),
        }
    );
    assert_eq!(store.read("dup").unwrap().body(), "first");
}

/// A slug is a file name, so it is held to a file name's shape: no whitespace, no path separators,
/// nothing that would make an index line ambiguous about where the slug ends.
#[test]
fn create_rejects_a_malformed_slug() {
    let mut store = markdown_store();
    for bad in [
        "two words",
        "../escape",
        "sub/dir",
        "quote\"d",
        &"x".repeat(65),
    ] {
        let err = store
            .create("", bad, "d", "body", MemoryCode::default())
            .unwrap_err();
        assert!(
            matches!(err, MemoryError::InvalidSlug(_)),
            "`{bad}` should be refused, got {err:?}"
        );
    }
    // The three separators a file name conventionally uses are fine.
    assert!(
        store
            .create(
                "",
                "build.commands_v2-b",
                "d",
                "body",
                MemoryCode::default()
            )
            .is_ok()
    );
}

/// The index entry is the memory's only presence in the window under markdown, so a description is
/// required there — and optional under keyword-search, which has no index to put it in.
#[test]
fn a_description_is_required_only_where_there_is_an_index() {
    assert_eq!(
        markdown_store()
            .create("", "m", "  ", "body", MemoryCode::default())
            .unwrap_err(),
        MemoryError::EmptyField("description")
    );

    let mut keyword = keyword_store();
    assert_eq!(
        keyword.create("", "m", "", "body", MemoryCode::default()),
        Ok(MemoryChange::Written)
    );
    assert_eq!(keyword.read("m").unwrap().description(), "");
    // The index line of a memory without a description is just its slug.
    assert_eq!(keyword.index_text(), "- `m`");
}

#[test]
fn create_rejects_empty_contents() {
    assert_eq!(
        markdown_store()
            .create("", "m", "d", "   ", MemoryCode::default())
            .unwrap_err(),
        MemoryError::EmptyField("contents")
    );
}

#[test]
fn create_enforces_the_per_memory_limit() {
    let strategy = MemoryStrategy::Markdown;
    let caps = MemoryCaps {
        max_len_per_memory: Some(10),
        ..MemoryCaps::UNBOUNDED
    };
    let mut store = MemoryStore::new(strategy, caps);
    assert_eq!(
        store
            .create("", "m", "d", "01234567890", MemoryCode::default())
            .unwrap_err(),
        MemoryError::PerMemoryCap {
            name: "m".to_string(),
            len: 11,
            cap: 10,
        }
    );
    assert_eq!(store.count(), 0, "an over-limit create must not be stored");
}

/// The index limit is what bounds a markdown run's memory count: a create whose entry would not
/// fit is refused, and the refusal tells the model to delete something rather than to shorten what
/// it was writing.
#[test]
fn create_is_refused_when_the_index_entry_would_not_fit() {
    let strategy = MemoryStrategy::Markdown;
    let caps = MemoryCaps {
        // Room for exactly one `- `aaa` — dd` line and no more.
        max_len_index: Some(12),
        ..MemoryCaps::UNBOUNDED
    };
    let mut store = MemoryStore::new(strategy, caps);
    store
        .create("", "aaa", "dd", "body", MemoryCode::default())
        .unwrap();
    assert_eq!(store.index_len(), 12);

    let err = store
        .create("", "bbb", "dd", "body", MemoryCode::default())
        .unwrap_err();
    assert!(
        matches!(err, MemoryError::IndexCap { cap: 12, .. }),
        "{err:?}"
    );
    assert!(err.to_string().contains("(max 12)"), "{err}");
    assert_eq!(store.count(), 1, "a refused create must not be stored");

    // Deleting frees the room again, so the ceiling is a budget rather than a one-way ratchet.
    store.delete("", "aaa").unwrap();
    assert!(
        store
            .create("", "bbb", "dd", "body", MemoryCode::default())
            .is_ok()
    );
}

/// The length the index limit measures is the text the pinned block renders, entry separators
/// included — the model is refused against the budget it can see itself spending.
#[test]
fn the_index_limit_measures_the_rendered_index() {
    let mut store = markdown_store();
    store
        .create("", "aaa", "one", "body", MemoryCode::default())
        .unwrap();
    store
        .create("", "bbb", "two", "body", MemoryCode::default())
        .unwrap();
    assert_eq!(store.index_text(), "- `aaa` — one\n- `bbb` — two");
    assert_eq!(store.index_len(), store.index_text().chars().count());
}

#[test]
fn keyword_search_enforces_a_count_limit_when_one_is_configured() {
    let strategy = MemoryStrategy::KeywordSearch;
    let caps = MemoryCaps {
        max_count: Some(2),
        ..MemoryCaps::UNBOUNDED
    };
    let mut store = MemoryStore::new(strategy, caps);
    store
        .create("", "a", "", "one", MemoryCode::default())
        .unwrap();
    store
        .create("", "b", "", "two", MemoryCode::default())
        .unwrap();
    assert_eq!(
        store
            .create("", "c", "", "three", MemoryCode::default())
            .unwrap_err(),
        MemoryError::CountCap {
            cap: 2,
            revise: "`edit_memory`".to_string(),
            delete: "`delete_memory`".to_string(),
        }
    );
}

// ---------------------------------------------------------------------------
// read, edit, delete
// ---------------------------------------------------------------------------

#[test]
fn read_returns_the_contents_and_needs_an_existing_slug() {
    let mut store = keyword_store();
    store
        .create("", "m", "d", "the contents", MemoryCode::default())
        .unwrap();
    assert_eq!(store.read("m").unwrap().body(), "the contents");
    assert_eq!(
        store.read("nope").unwrap_err(),
        MemoryError::NotFound {
            name: "nope".to_string(),
            create: "`create_memory`".to_string(),
        }
    );
    assert_eq!(
        store.read("  ").unwrap_err(),
        MemoryError::EmptyField("name")
    );
}

#[test]
fn edit_replaces_one_occurrence_in_place() {
    let mut store = markdown_store();
    store
        .create(
            "",
            "m",
            "d",
            "the old line\nand another",
            MemoryCode::default(),
        )
        .unwrap();
    assert_eq!(
        store.edit("", "m", "the old line", "the new line"),
        Ok(MemoryChange::Updated)
    );
    assert_eq!(store.read("m").unwrap().body(), "the new line\nand another");
}

/// Appending is an edit that quotes the tail and replaces it with itself plus more — the shape the
/// tool description teaches, so it is worth holding to.
#[test]
fn edit_can_append_by_quoting_the_tail() {
    let mut store = markdown_store();
    store
        .create("", "m", "d", "first line", MemoryCode::default())
        .unwrap();
    store
        .edit("", "m", "first line", "first line\nsecond line")
        .unwrap();
    assert_eq!(store.read("m").unwrap().body(), "first line\nsecond line");
}

#[test]
fn edit_requires_a_unique_match() {
    let mut store = markdown_store();
    store
        .create("", "m", "d", "same same", MemoryCode::default())
        .unwrap();
    assert_eq!(
        store.edit("", "m", "same", "other").unwrap_err(),
        MemoryError::EditNotUnique {
            name: "m".to_string(),
            occurrences: 2,
        }
    );
    assert_eq!(
        store.edit("", "m", "absent", "x").unwrap_err(),
        MemoryError::EditNotFound {
            name: "m".to_string()
        }
    );
    // Neither refusal changed anything.
    assert_eq!(store.read("m").unwrap().body(), "same same");
}

/// An edit that empties a memory is refused and told to delete instead: a deletion is a decision,
/// and gg will not infer one from an edit that happened to remove the last of the text.
#[test]
fn edit_refuses_to_empty_a_memory_and_names_the_alternative() {
    let mut store = markdown_store();
    store
        .create("", "m", "d", "all of it", MemoryCode::default())
        .unwrap();
    let err = store.edit("", "m", "all of it", "   ").unwrap_err();
    assert_eq!(err, MemoryError::WouldEmpty("m".to_string()));
    assert!(err.to_string().contains("delete"));
    assert_eq!(store.read("m").unwrap().body(), "all of it");
    assert_eq!(store.count(), 1);
}

#[test]
fn edit_enforces_the_per_memory_limit() {
    let strategy = MemoryStrategy::Markdown;
    let caps = MemoryCaps {
        max_len_per_memory: Some(12),
        ..MemoryCaps::UNBOUNDED
    };
    let mut store = MemoryStore::new(strategy, caps);
    store
        .create("", "m", "d", "0123456789", MemoryCode::default())
        .unwrap();
    let err = store
        .edit("", "m", "0123456789", "0123456789abc")
        .unwrap_err();
    assert!(
        matches!(err, MemoryError::PerMemoryCap { cap: 12, .. }),
        "{err:?}"
    );
    assert_eq!(store.read("m").unwrap().body(), "0123456789");
}

#[test]
fn edit_needs_an_existing_slug_and_a_search_string() {
    let mut store = markdown_store();
    assert_eq!(
        store.edit("", "nope", "a", "b").unwrap_err(),
        MemoryError::NotFound {
            name: "nope".to_string(),
            create: "`create_memory`".to_string(),
        }
    );
    store
        .create("", "m", "d", "body", MemoryCode::default())
        .unwrap();
    assert_eq!(
        store.edit("", "m", "", "b").unwrap_err(),
        MemoryError::EmptyField("search")
    );
}

/// Deleting always succeeds for a slug that exists — it can only free room, so no limit can refuse
/// it — and it takes the index entry with it.
#[test]
fn delete_removes_the_memory_and_its_index_entry() {
    let mut store = markdown_store();
    store
        .create("", "keep", "kept", "a", MemoryCode::default())
        .unwrap();
    store
        .create("", "drop", "dropped", "b", MemoryCode::default())
        .unwrap();
    assert_eq!(store.delete("", "drop"), Ok(MemoryChange::Deleted));
    assert_eq!(store.index_text(), "- `keep` — kept");
    assert_eq!(
        store.read("drop").unwrap_err(),
        MemoryError::NotFound {
            name: "drop".to_string(),
            create: "`create_memory`".to_string(),
        }
    );
}

// ---------------------------------------------------------------------------
// The runtime's derivations
// ---------------------------------------------------------------------------

/// Markdown pins the index and nothing else: the whole point is that the bodies are *not* in the
/// window, so a block carrying them would defeat the strategy it is meant to implement.
#[test]
fn markdown_pins_the_index_alone() {
    let runtime = MemoriesRuntime::new(MemoryStrategy::Markdown, MemoryCaps::UNBOUNDED);
    assert!(runtime.context_block().is_none(), "nothing to show yet");

    runtime
        .store()
        .lock()
        .unwrap()
        .create(
            "",
            "plan",
            "the plan",
            "the secret body",
            MemoryCode::default(),
        )
        .unwrap();
    let block = runtime
        .context_block()
        .expect("an index once a memory exists");
    let content = block.content.expect("the block has content");
    assert!(content.contains("Your memory index"));
    assert!(content.contains("- `plan` — the plan"));
    assert!(
        !content.contains("the secret body"),
        "the index must not carry bodies: {content}"
    );
}

/// Keyword-search pins nothing at all — that is the arm of the study it exists to be.
#[test]
fn keyword_search_pins_nothing() {
    let runtime = MemoriesRuntime::new(MemoryStrategy::KeywordSearch, MemoryCaps::UNBOUNDED);
    runtime
        .store()
        .lock()
        .unwrap()
        .create("", "m", "d", "body", MemoryCode::default())
        .unwrap();
    assert!(runtime.context_block().is_none());
}

#[test]
fn the_state_event_reports_the_strategy_and_its_limits() {
    let runtime = MemoriesRuntime::new(
        MemoryStrategy::Markdown,
        MemoryCaps::resolve(
            MemoryStrategy::Markdown,
            &specified(json!({ PARAM_MAX_LEN_INDEX: 4_096, PARAM_MAX_COUNT: 40 })),
            &mut honoured(),
        ),
    );
    let GgTelemetryKind::MemoryState { strategy, caps, .. } = runtime.state_event().unwrap() else {
        panic!("expected a MemoryState");
    };
    assert_eq!(strategy, "markdown");
    assert_eq!(caps.max_len_index, Some(4_096));
    // A limit this strategy does not apply is absent from the telemetry, however the params read
    // it: the run is not holding the model to it.
    assert_eq!(caps.max_count, None);
}

/// The calls gg names back to the model differ by strategy *and* by execution mode; a prompt that
/// named the scratchpad's tools at a markdown run would be telling it to call something it does
/// not have.
#[test]
fn the_named_calls_follow_the_strategy_and_the_mode() {
    let scratchpad = MemoryStrategy::Scratchpad.calls(None);
    assert_eq!(scratchpad.create, "`write_memory`");
    assert_eq!(scratchpad.revise, "`update_memory`");

    let markdown = MemoryStrategy::Markdown.calls(None);
    assert_eq!(markdown.create, "`create_memory`");
    assert_eq!(markdown.revise, "`edit_memory`");

    // The code-mode spellings come from TypeScript's own catalogue rather than from a
    // table here, which is why a second language spells them its own way with nothing to edit.
    let typescript = crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::TypeScript);
    let code = MemoryStrategy::KeywordSearch.calls(Some(typescript));
    assert_eq!(code.create, "`gg.memories.createMemory`");
    assert_eq!(code.revise, "`gg.memories.editMemory`");
    assert_eq!(code.delete, "`gg.memories.deleteMemory`");
}
