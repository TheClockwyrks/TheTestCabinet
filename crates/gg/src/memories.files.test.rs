//! Tests for the two **file-shaped** strategies: [markdown](MemoryStrategy::Markdown)'s index and
//! [keyword-search](MemoryStrategy::KeywordSearch)'s absence of one, the create/read/edit/delete
//! surface they share, and the strategy resolution that selects between them.

use serde_json::json;
use test_cabinet_core::gg::GgTelemetryKind;

use super::*;

/// A markdown store with the documented defaults.
fn markdown_store() -> MemoryStore {
    let strategy = MemoryStrategy::Markdown;
    MemoryStore::new(strategy, MemoryCaps::for_strategy(strategy))
}

/// A keyword-search store with the documented defaults.
fn keyword_store() -> MemoryStore {
    let strategy = MemoryStrategy::KeywordSearch;
    MemoryStore::new(strategy, MemoryCaps::for_strategy(strategy))
}

// ---------------------------------------------------------------------------
// Strategy resolution
// ---------------------------------------------------------------------------

#[test]
fn strategy_resolves_from_the_implementation() {
    assert_eq!(
        MemoryStrategy::resolve(Some("markdown")),
        MemoryStrategy::Markdown
    );
    assert_eq!(
        MemoryStrategy::resolve(Some("  keyword-search  ")),
        MemoryStrategy::KeywordSearch
    );
    assert_eq!(
        MemoryStrategy::resolve(Some("scratchpad")),
        MemoryStrategy::Scratchpad
    );
}

/// An unrecognized (or absent) strategy resolves to the default rather than failing the run, so a
/// sweep may name a strategy a later gg will add.
#[test]
fn an_unknown_strategy_falls_back_to_the_default() {
    assert_eq!(MemoryStrategy::resolve(None), MemoryStrategy::Scratchpad);
    assert_eq!(
        MemoryStrategy::resolve(Some("")),
        MemoryStrategy::Scratchpad
    );
    assert_eq!(
        MemoryStrategy::resolve(Some("vector-index")),
        MemoryStrategy::Scratchpad
    );
}

#[test]
fn each_strategy_defaults_to_its_documented_limits() {
    let markdown = MemoryCaps::for_strategy(MemoryStrategy::Markdown);
    assert_eq!(markdown.max_len_index, Some(DEFAULT_MAX_LEN_INDEX));
    assert_eq!(markdown.max_len_per_memory, Some(DEFAULT_MAX_LEN_PER_FILE));
    // The index is what bounds the population; there is no separate count limit.
    assert_eq!(markdown.max_count, None);
    assert_eq!(markdown.max_total_len, None);

    let keyword = MemoryCaps::for_strategy(MemoryStrategy::KeywordSearch);
    assert_eq!(keyword.max_len_per_memory, Some(DEFAULT_MAX_LEN_PER_FILE));
    assert_eq!(keyword.max_results, Some(DEFAULT_MAX_RESULTS));
    // Unlimited by default — a run that wants a ceiling sets `maxCount`.
    assert_eq!(keyword.max_count, None);
    assert_eq!(keyword.max_len_index, None);
}

#[test]
fn keyword_search_resolves_its_own_params() {
    let caps = MemoryCaps::resolve(
        MemoryStrategy::KeywordSearch,
        &json!({ "maxCount": 40, "maxLenPerMemory": 500, "maxResults": 5 }),
    );
    assert_eq!(caps.max_count, Some(40));
    assert_eq!(caps.max_len_per_memory, Some(500));
    assert_eq!(caps.max_results, Some(5));
}

/// Both file limits are individually disableable with `0`, which is what "it must be possible to
/// turn the limit off" means in a params block.
#[test]
fn markdown_limits_can_be_disabled_individually() {
    let caps = MemoryCaps::resolve(
        MemoryStrategy::Markdown,
        &json!({ "maxLenIndex": 0, "maxLenPerMemory": 0 }),
    );
    assert_eq!(caps.max_len_index, None);
    assert_eq!(caps.max_len_per_memory, None);

    let mut store = MemoryStore::new(MemoryStrategy::Markdown, caps);
    // A body far over the default per-file limit, and enough entries to blow the default index.
    for n in 0..50 {
        store
            .create(
                &format!("memory-{n}"),
                &"d".repeat(200),
                &"x".repeat(20_000),
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
            "build-commands",
            "How to build and test",
            "cargo nextest run"
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
    store.create("dup", "d", "first").unwrap();
    assert_eq!(
        store.create("dup", "d2", "second").unwrap_err(),
        MemoryError::Duplicate {
            name: "dup".to_string(),
            revise: "`edit_memory`",
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
        let err = store.create(bad, "d", "body").unwrap_err();
        assert!(
            matches!(err, MemoryError::InvalidSlug(_)),
            "`{bad}` should be refused, got {err:?}"
        );
    }
    // The three separators a file name conventionally uses are fine.
    assert!(store.create("build.commands_v2-b", "d", "body").is_ok());
}

/// The index entry is the memory's only presence in the window under markdown, so a description is
/// required there — and optional under keyword-search, which has no index to put it in.
#[test]
fn a_description_is_required_only_where_there_is_an_index() {
    assert_eq!(
        markdown_store().create("m", "  ", "body").unwrap_err(),
        MemoryError::EmptyField("description")
    );

    let mut keyword = keyword_store();
    assert_eq!(keyword.create("m", "", "body"), Ok(MemoryChange::Written));
    assert_eq!(keyword.read("m").unwrap().description(), "");
    // The index line of a memory without a description is just its slug.
    assert_eq!(keyword.index_text(), "- `m`");
}

#[test]
fn create_rejects_empty_contents() {
    assert_eq!(
        markdown_store().create("m", "d", "   ").unwrap_err(),
        MemoryError::EmptyField("contents")
    );
}

#[test]
fn create_enforces_the_per_memory_limit() {
    let strategy = MemoryStrategy::Markdown;
    let caps = MemoryCaps {
        max_len_per_memory: Some(10),
        ..MemoryCaps::for_strategy(strategy)
    };
    let mut store = MemoryStore::new(strategy, caps);
    assert_eq!(
        store.create("m", "d", "01234567890").unwrap_err(),
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
        ..MemoryCaps::for_strategy(strategy)
    };
    let mut store = MemoryStore::new(strategy, caps);
    store.create("aaa", "dd", "body").unwrap();
    assert_eq!(store.index_len(), 12);

    let err = store.create("bbb", "dd", "body").unwrap_err();
    assert!(
        matches!(err, MemoryError::IndexCap { cap: 12, .. }),
        "{err:?}"
    );
    assert!(err.to_string().contains("delete"));
    assert_eq!(store.count(), 1, "a refused create must not be stored");

    // Deleting frees the room again, so the ceiling is a budget rather than a one-way ratchet.
    store.delete("aaa").unwrap();
    assert!(store.create("bbb", "dd", "body").is_ok());
}

/// The length the index limit measures is the text the pinned block renders, entry separators
/// included — the model is refused against the budget it can see itself spending.
#[test]
fn the_index_limit_measures_the_rendered_index() {
    let mut store = markdown_store();
    store.create("aaa", "one", "body").unwrap();
    store.create("bbb", "two", "body").unwrap();
    assert_eq!(store.index_text(), "- `aaa` — one\n- `bbb` — two");
    assert_eq!(store.index_len(), store.index_text().chars().count());
}

#[test]
fn keyword_search_enforces_a_count_limit_when_one_is_configured() {
    let strategy = MemoryStrategy::KeywordSearch;
    let caps = MemoryCaps {
        max_count: Some(2),
        ..MemoryCaps::for_strategy(strategy)
    };
    let mut store = MemoryStore::new(strategy, caps);
    store.create("a", "", "one").unwrap();
    store.create("b", "", "two").unwrap();
    assert_eq!(
        store.create("c", "", "three").unwrap_err(),
        MemoryError::CountCap {
            cap: 2,
            revise: "`edit_memory`",
            delete: "`delete_memory`",
        }
    );
}

// ---------------------------------------------------------------------------
// read, edit, delete
// ---------------------------------------------------------------------------

#[test]
fn read_returns_the_contents_and_needs_an_existing_slug() {
    let mut store = keyword_store();
    store.create("m", "d", "the contents").unwrap();
    assert_eq!(store.read("m").unwrap().body(), "the contents");
    assert_eq!(
        store.read("nope").unwrap_err(),
        MemoryError::NotFound {
            name: "nope".to_string(),
            create: "`create_memory`",
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
    store.create("m", "d", "the old line\nand another").unwrap();
    assert_eq!(
        store.edit("m", "the old line", "the new line"),
        Ok(MemoryChange::Updated)
    );
    assert_eq!(store.read("m").unwrap().body(), "the new line\nand another");
}

/// Appending is an edit that quotes the tail and replaces it with itself plus more — the shape the
/// tool description teaches, so it is worth holding to.
#[test]
fn edit_can_append_by_quoting_the_tail() {
    let mut store = markdown_store();
    store.create("m", "d", "first line").unwrap();
    store
        .edit("m", "first line", "first line\nsecond line")
        .unwrap();
    assert_eq!(store.read("m").unwrap().body(), "first line\nsecond line");
}

#[test]
fn edit_requires_a_unique_match() {
    let mut store = markdown_store();
    store.create("m", "d", "same same").unwrap();
    assert_eq!(
        store.edit("m", "same", "other").unwrap_err(),
        MemoryError::EditNotUnique {
            name: "m".to_string(),
            occurrences: 2,
        }
    );
    assert_eq!(
        store.edit("m", "absent", "x").unwrap_err(),
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
    store.create("m", "d", "all of it").unwrap();
    let err = store.edit("m", "all of it", "   ").unwrap_err();
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
        ..MemoryCaps::for_strategy(strategy)
    };
    let mut store = MemoryStore::new(strategy, caps);
    store.create("m", "d", "0123456789").unwrap();
    let err = store.edit("m", "0123456789", "0123456789abc").unwrap_err();
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
        store.edit("nope", "a", "b").unwrap_err(),
        MemoryError::NotFound {
            name: "nope".to_string(),
            create: "`create_memory`",
        }
    );
    store.create("m", "d", "body").unwrap();
    assert_eq!(
        store.edit("m", "", "b").unwrap_err(),
        MemoryError::EmptyField("search")
    );
}

/// Deleting always succeeds for a slug that exists — it can only free room, so no limit can refuse
/// it — and it takes the index entry with it.
#[test]
fn delete_removes_the_memory_and_its_index_entry() {
    let mut store = markdown_store();
    store.create("keep", "kept", "a").unwrap();
    store.create("drop", "dropped", "b").unwrap();
    assert_eq!(store.delete("drop"), Ok(MemoryChange::Deleted));
    assert_eq!(store.index_text(), "- `keep` — kept");
    assert_eq!(
        store.read("drop").unwrap_err(),
        MemoryError::NotFound {
            name: "drop".to_string(),
            create: "`create_memory`",
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
    let runtime = MemoriesRuntime::new(
        MemoryStrategy::Markdown,
        MemoryCaps::for_strategy(MemoryStrategy::Markdown),
    );
    assert!(runtime.context_block().is_none(), "nothing to show yet");

    runtime
        .store()
        .lock()
        .unwrap()
        .create("plan", "the plan", "the secret body")
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
    let runtime = MemoriesRuntime::new(
        MemoryStrategy::KeywordSearch,
        MemoryCaps::for_strategy(MemoryStrategy::KeywordSearch),
    );
    runtime
        .store()
        .lock()
        .unwrap()
        .create("m", "d", "body")
        .unwrap();
    assert!(runtime.context_block().is_none());
}

#[test]
fn the_state_event_reports_the_strategy_and_its_limits() {
    let runtime = MemoriesRuntime::new(
        MemoryStrategy::Markdown,
        MemoryCaps::for_strategy(MemoryStrategy::Markdown),
    );
    let GgTelemetryKind::MemoryState { strategy, caps, .. } = runtime.state_event().unwrap() else {
        panic!("expected a MemoryState");
    };
    assert_eq!(strategy, "markdown");
    assert_eq!(caps.max_len_index, Some(DEFAULT_MAX_LEN_INDEX as u64));
    assert_eq!(caps.max_count, None);
}

/// The calls gg names back to the model differ by strategy *and* by execution mode; a prompt that
/// named the scratchpad's tools at a markdown run would be telling it to call something it does
/// not have.
#[test]
fn the_named_calls_follow_the_strategy_and_the_mode() {
    let scratchpad = MemoryStrategy::Scratchpad.calls(false);
    assert_eq!(scratchpad.create, "`write_memory`");
    assert_eq!(scratchpad.revise, "`update_memory`");

    let markdown = MemoryStrategy::Markdown.calls(false);
    assert_eq!(markdown.create, "`create_memory`");
    assert_eq!(markdown.revise, "`edit_memory`");

    let code = MemoryStrategy::KeywordSearch.calls(true);
    assert_eq!(code.create, "`memory.createMemory`");
    assert_eq!(code.revise, "`memory.editMemory`");
    assert_eq!(code.delete, "`memory.deleteMemory`");
}
