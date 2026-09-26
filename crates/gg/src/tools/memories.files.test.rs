//! Tests for the file-shaped memory tools — `create_memory`, `read_memory`, `edit_memory` and
//! `search_memories` — covering the happy paths, the store's refusals surfaced as classified tool
//! errors, the strategy-dependent tool definitions, and argument validation. No network.

use std::sync::{Arc, Mutex};

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::memories::{MemoryBinding, MemoryCaps, MemoryCode, MemoryStore, MemoryStrategy};
use crate::tools::ToolFailure;

/// A [binding](MemoryBinding) onto a store on `strategy` with its documented limits, plus a
/// throwaway workspace context.
///
/// The binding, rather than the bare store, because that is what a tool takes: a store plus the
/// agent whose calls go through it. These tests attribute to no agent — the empty author — since
/// what they are about is what each call does, not whose call it was.
fn fixture(strategy: MemoryStrategy) -> (MemoryBinding, ToolContext, TempDir) {
    fixture_with(strategy, MemoryCaps::UNBOUNDED)
}

/// The same, with limits of the caller's choosing.
fn fixture_with(
    strategy: MemoryStrategy,
    caps: MemoryCaps,
) -> (MemoryBinding, ToolContext, TempDir) {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    (
        MemoryBinding::new(Arc::new(Mutex::new(MemoryStore::new(strategy, caps))), ""),
        ctx,
        dir,
    )
}

/// The [`MemoryUsageData`] an outcome carries, or a failure naming what it carried instead.
fn usage(outcome: &ToolOutcome) -> &super::super::MemoryUsageData {
    match outcome.data.as_ref() {
        Some(ApiData::MemoryUsage(data)) => data,
        other => panic!("expected memory usage, got {other:?}"),
    }
}

/// The hits an outcome carries, or a failure naming what it carried instead.
fn hits(outcome: &ToolOutcome) -> &[MemoryHitData] {
    match outcome.data.as_ref() {
        Some(ApiData::MemoryHits(hits)) => hits,
        other => panic!("expected memory hits, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// create_memory
// ---------------------------------------------------------------------------

#[tokio::test]
async fn create_memory_stores_the_contents_and_reports_usage() {
    // The usage note reports what the call is bounded *by*, so this case has to bound something:
    // an unbounded store spends against no ceiling and has no room to report.
    let (store, ctx, _dir) = fixture_with(
        MemoryStrategy::Markdown,
        MemoryCaps {
            max_len_index: Some(4096),
            ..MemoryCaps::UNBOUNDED
        },
    );
    let tool = CreateMemoryTool::new(store.clone());

    let outcome = tool
        .invoke(
            json!({
                "name": "build-commands",
                "description": "How to build and test",
                "contents": "cargo nextest run --workspace",
            }),
            &ctx,
        )
        .await;
    assert!(outcome.ok, "{}", outcome.output);
    assert!(outcome.output.contains("Created memory `build-commands`"));

    let store = store.lock();
    assert_eq!(store.count(), 1);
    assert_eq!(
        store.read("build-commands").unwrap().body(),
        "cargo nextest run --workspace"
    );
    // A markdown run's binding constraint is the index, so that is what the usage note reports.
    assert!(outcome.output.contains("index:"), "{}", outcome.output);
    assert_eq!(usage(&outcome).index_chars, Some(store.index_len() as u32));
}

/// Under keyword-search there is no index, so the description is optional — and the tool's schema
/// says so, rather than the store refusing a call the schema invited.
#[tokio::test]
async fn create_memory_makes_the_description_optional_without_an_index() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::KeywordSearch);
    let tool = CreateMemoryTool::new(store.clone());

    let required = tool.definition().parameters["required"].clone();
    assert_eq!(required, json!(["name", "contents"]));

    let outcome = tool
        .invoke(json!({ "name": "m", "contents": "the contents" }), &ctx)
        .await;
    assert!(outcome.ok, "{}", outcome.output);
    assert_eq!(store.lock().read("m").unwrap().description(), "");
}

/// Under markdown the description *is* the memory's index entry, so it is required both in the
/// schema and by the store.
#[tokio::test]
async fn create_memory_requires_a_description_with_an_index() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::Markdown);
    let tool = CreateMemoryTool::new(store.clone());

    let required = tool.definition().parameters["required"].clone();
    assert_eq!(required, json!(["name", "description", "contents"]));

    let outcome = tool
        .invoke(json!({ "name": "m", "contents": "body" }), &ctx)
        .await;
    assert!(!outcome.ok);
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(outcome.output.contains("description"));
    assert_eq!(store.lock().count(), 0);
}

#[tokio::test]
async fn create_memory_surfaces_a_duplicate_and_a_bad_slug() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::Markdown);
    let tool = CreateMemoryTool::new(store.clone());
    let args = json!({ "name": "dup", "description": "d", "contents": "b" });

    assert!(tool.invoke(args.clone(), &ctx).await.ok);
    let duplicate = tool.invoke(args, &ctx).await;
    assert_eq!(duplicate.failure, Some(ToolFailure::Conflict));
    assert!(duplicate.output.contains("already exists"));

    let bad_slug = tool
        .invoke(
            json!({ "name": "two words", "description": "d", "contents": "b" }),
            &ctx,
        )
        .await;
    assert_eq!(bad_slug.failure, Some(ToolFailure::InvalidArgument));
    assert!(bad_slug.output.contains("not a usable memory name"));
}

/// The index limit is what a markdown run runs out of, and the refusal is a limit — so a model
/// pruning its memory knows to delete rather than to rephrase.
#[tokio::test]
async fn create_memory_surfaces_a_full_index_as_a_limit() {
    let strategy = MemoryStrategy::Markdown;
    let (store, ctx, _dir) = fixture_with(
        strategy,
        MemoryCaps {
            // Room for exactly one `- `aaa` — dd` line and no more.
            max_len_index: Some(12),
            ..MemoryCaps::UNBOUNDED
        },
    );
    let tool = CreateMemoryTool::new(store.clone());

    assert!(
        tool.invoke(
            json!({ "name": "aaa", "description": "dd", "contents": "b" }),
            &ctx
        )
        .await
        .ok
    );
    let full = tool
        .invoke(
            json!({ "name": "bbb", "description": "dd", "contents": "b" }),
            &ctx,
        )
        .await;
    assert_eq!(full.failure, Some(ToolFailure::LimitExceeded));
    assert!(full.output.contains("memory index"));
    assert_eq!(store.lock().count(), 1);
}

// ---------------------------------------------------------------------------
// read_memory
// ---------------------------------------------------------------------------

/// A memory's contents *are* the result, with no wrapper prose — the same contract `read_skill`
/// has, so a program gets the text rather than a sentence about it.
#[tokio::test]
async fn read_memory_returns_the_contents_verbatim() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::KeywordSearch);
    store
        .lock()
        .create("", "m", "d", "line one\nline two", MemoryCode::default())
        .unwrap();

    let outcome = ReadMemoryTool::new(store.clone())
        .invoke(json!({ "name": "m" }), &ctx)
        .await;
    assert!(outcome.ok);
    assert_eq!(outcome.output, "line one\nline two");
    assert_eq!(outcome.data, None, "a read has no usage to report");
}

#[tokio::test]
async fn read_memory_reports_an_unknown_slug_as_not_found() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::Markdown);
    let outcome = ReadMemoryTool::new(store)
        .invoke(json!({ "name": "ghost" }), &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::NotFound));
    assert!(outcome.output.contains("no memory named `ghost`"));
}

// ---------------------------------------------------------------------------
// edit_memory
// ---------------------------------------------------------------------------

#[tokio::test]
async fn edit_memory_replaces_the_unique_occurrence() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::Markdown);
    store
        .lock()
        .create(
            "",
            "m",
            "d",
            "the old line\nand another",
            MemoryCode::default(),
        )
        .unwrap();

    let outcome = EditMemoryTool::new(store.clone())
        .invoke(
            json!({ "name": "m", "old_string": "the old line", "new_string": "the new line" }),
            &ctx,
        )
        .await;
    assert!(outcome.ok, "{}", outcome.output);
    assert!(outcome.output.contains("Edited memory `m`"));
    assert_eq!(
        store.lock().read("m").unwrap().body(),
        "the new line\nand another"
    );
}

/// An empty `new_string` is how text is cut out, so it is an optional argument rather than a
/// required one — a caller that omits it means "delete this text".
#[tokio::test]
async fn edit_memory_accepts_an_empty_replacement() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::Markdown);
    store
        .lock()
        .create("", "m", "d", "keep DROP", MemoryCode::default())
        .unwrap();

    let outcome = EditMemoryTool::new(store.clone())
        .invoke(
            json!({ "name": "m", "old_string": " DROP", "new_string": "" }),
            &ctx,
        )
        .await;
    assert!(outcome.ok, "{}", outcome.output);
    assert_eq!(store.lock().read("m").unwrap().body(), "keep");
}

#[tokio::test]
async fn edit_memory_classifies_each_refusal() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::Markdown);
    store
        .lock()
        .create("", "m", "d", "same same", MemoryCode::default())
        .unwrap();
    let tool = EditMemoryTool::new(store.clone());

    let ambiguous = tool
        .invoke(
            json!({ "name": "m", "old_string": "same", "new_string": "x" }),
            &ctx,
        )
        .await;
    assert_eq!(ambiguous.failure, Some(ToolFailure::Conflict));
    assert!(ambiguous.output.contains("appears 2 times"));

    let missing = tool
        .invoke(
            json!({ "name": "m", "old_string": "absent", "new_string": "x" }),
            &ctx,
        )
        .await;
    assert_eq!(missing.failure, Some(ToolFailure::NotFound));

    // Emptying a memory is a deletion, and the model is told to say so.
    let emptied = tool
        .invoke(
            json!({ "name": "m", "old_string": "same same", "new_string": "" }),
            &ctx,
        )
        .await;
    assert_eq!(emptied.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        emptied.output.contains("delete it instead"),
        "{}",
        emptied.output
    );
    assert_eq!(store.lock().count(), 1);
}

// ---------------------------------------------------------------------------
// search_memories
// ---------------------------------------------------------------------------

#[tokio::test]
async fn search_memories_ranks_and_reports_hits() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::KeywordSearch);
    {
        let mut store = store.lock();
        store
            .create(
                "",
                "gates",
                "How to run the gates",
                "cargo nextest run --workspace",
                MemoryCode::default(),
            )
            .unwrap();
        store
            .create(
                "",
                "style",
                "House style",
                "comments explain why",
                MemoryCode::default(),
            )
            .unwrap();
    }

    let outcome = SearchMemoriesTool::new(store.clone())
        .invoke(json!({ "keywords": ["cargo", "nextest"] }), &ctx)
        .await;
    assert!(outcome.ok, "{}", outcome.output);
    assert!(outcome.output.contains("1 of 2 memories match"));
    assert!(outcome.output.contains("`gates` — How to run the gates"));

    let hits = hits(&outcome);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].name, "gates");
    assert_eq!(hits[0].matched, 2);
    assert!(hits[0].excerpt.contains("cargo nextest"));
}

/// An empty store and a search that matched nothing are different situations with different next
/// moves, so they read differently rather than sharing one "no results" line.
#[tokio::test]
async fn search_memories_distinguishes_empty_from_unmatched() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::KeywordSearch);
    let tool = SearchMemoriesTool::new(store.clone());

    let empty = tool.invoke(json!({ "keywords": ["anything"] }), &ctx).await;
    assert!(empty.ok);
    assert!(empty.output.contains("no memories yet"));
    assert!(hits(&empty).is_empty());

    store
        .lock()
        .create("", "m", "d", "something", MemoryCode::default())
        .unwrap();
    let unmatched = tool.invoke(json!({ "keywords": ["absent"] }), &ctx).await;
    assert!(unmatched.ok);
    assert!(unmatched.output.contains("No memory matches"));
    assert!(hits(&unmatched).is_empty());
}

#[tokio::test]
async fn search_memories_validates_its_keywords() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::KeywordSearch);
    let tool = SearchMemoriesTool::new(store);

    let empty = tool.invoke(json!({ "keywords": ["  ", ""] }), &ctx).await;
    assert_eq!(empty.failure, Some(ToolFailure::InvalidArgument));
    assert!(empty.output.contains("at least one non-empty keyword"));

    let missing = tool.invoke(json!({}), &ctx).await;
    assert_eq!(missing.failure, Some(ToolFailure::InvalidArgument));

    let wrong_type = tool.invoke(json!({ "keywords": "cargo" }), &ctx).await;
    assert_eq!(wrong_type.failure, Some(ToolFailure::InvalidArgument));
    assert!(wrong_type.output.contains("array of strings"));
}

// ---------------------------------------------------------------------------
// The descriptions a model actually reads
// ---------------------------------------------------------------------------

/// A description must state the limits this run enforces and no others: a model told about a cap
/// that has been disabled would ration something it has plenty of.
#[tokio::test]
async fn a_tool_description_states_only_the_limits_in_force() {
    let strategy = MemoryStrategy::KeywordSearch;
    let (bounded, _ctx, _dir) = fixture_with(
        strategy,
        MemoryCaps {
            max_count: Some(12),
            max_len_per_memory: Some(500),
            ..MemoryCaps::UNBOUNDED
        },
    );
    let description = CreateMemoryTool::new(bounded).definition().description;
    assert!(description.contains("12 memories"), "{description}");
    assert!(description.contains("500 characters"), "{description}");

    let (unbounded, _ctx, _dir) = fixture_with(
        strategy,
        MemoryCaps {
            max_count: None,
            max_len_per_memory: None,
            max_len_index: None,
            ..MemoryCaps::UNBOUNDED
        },
    );
    let description = CreateMemoryTool::new(unbounded).definition().description;
    // With every limit this description states switched off, the sentence naming them goes
    // entirely rather than dangling on an empty list.
    assert!(!description.contains("at most"), "{description}");
}

/// `read_memory` tells the model where slugs come from, which differs by strategy: an index it can
/// see, or a search it has to run.
#[tokio::test]
async fn read_memory_describes_where_slugs_come_from() {
    let (markdown, _ctx, _dir) = fixture(MemoryStrategy::Markdown);
    let description = ReadMemoryTool::new(markdown).definition().description;
    assert!(description.contains("index"), "{description}");

    let (keyword, _ctx, _dir) = fixture(MemoryStrategy::KeywordSearch);
    let description = ReadMemoryTool::new(keyword).definition().description;
    assert!(description.contains("search_memories"), "{description}");
}

// ---------------------------------------------------------------------------
// The argument diagnostics the file-shaped tools raise
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_create_missing_its_name_is_an_argument_error() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::Markdown);
    let tool = CreateMemoryTool::new(store.clone());

    let outcome = tool.invoke(json!({ "contents": "x" }), &ctx).await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(outcome.output.contains("name"), "{}", outcome.output);
    assert_eq!(store.lock().count(), 0);
}

#[tokio::test]
async fn a_create_missing_its_contents_is_an_argument_error() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::Markdown);
    let tool = CreateMemoryTool::new(store.clone());

    let outcome = tool.invoke(json!({ "name": "n" }), &ctx).await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(outcome.output.contains("contents"), "{}", outcome.output);
    assert_eq!(store.lock().count(), 0);
}

/// The description is optional, not untyped: a non-string is still refused, so a program that
/// passed the wrong value is told rather than having it silently dropped.
#[tokio::test]
async fn a_create_with_an_ill_typed_description_is_an_argument_error() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::KeywordSearch);
    let tool = CreateMemoryTool::new(store.clone());

    let outcome = tool
        .invoke(
            json!({ "name": "n", "description": 3, "contents": "x" }),
            &ctx,
        )
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        outcome.output.contains("`description` must be a string"),
        "{}",
        outcome.output
    );
    assert_eq!(store.lock().count(), 0);
}

#[tokio::test]
async fn a_read_missing_its_name_is_an_argument_error() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::KeywordSearch);
    let tool = ReadMemoryTool::new(store);

    let outcome = tool.invoke(json!({}), &ctx).await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(outcome.output.contains("name"), "{}", outcome.output);
}

#[tokio::test]
async fn a_read_with_an_ill_typed_name_is_an_argument_error() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::KeywordSearch);
    let tool = ReadMemoryTool::new(store);

    let outcome = tool.invoke(json!({ "name": 1 }), &ctx).await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        outcome.output.contains("`name` must be a string"),
        "{}",
        outcome.output
    );
}

/// Editing a slug the store does not hold is not-found rather than a bad argument: the call was
/// well formed, and the recovery is to create the memory or to name a different one.
#[tokio::test]
async fn an_edit_of_an_unknown_memory_is_not_found() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::Markdown);
    store
        .lock()
        .create("", "held", "d", "the contents", MemoryCode::default())
        .unwrap();

    let outcome = EditMemoryTool::new(store.clone())
        .invoke(
            json!({ "name": "ghost", "old_string": "the", "new_string": "a" }),
            &ctx,
        )
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::NotFound));
    assert!(
        outcome.output.contains("no memory named `ghost`"),
        "{}",
        outcome.output
    );
    assert_eq!(store.lock().read("held").unwrap().body(), "the contents");
}

#[tokio::test]
async fn an_edit_missing_its_name_or_old_string_is_an_argument_error() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::Markdown);
    store
        .lock()
        .create("", "m", "d", "the contents", MemoryCode::default())
        .unwrap();
    let tool = EditMemoryTool::new(store.clone());

    for (args, field) in [
        (json!({ "old_string": "the", "new_string": "a" }), "name"),
        (json!({ "name": "m", "new_string": "a" }), "old_string"),
    ] {
        let outcome = tool.invoke(args, &ctx).await;
        assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
        assert!(outcome.output.contains(field), "{}", outcome.output);
    }
    assert_eq!(store.lock().read("m").unwrap().body(), "the contents");
}

/// The replacement may be omitted — that is how text is cut out — but a non-string is refused all
/// the same.
#[tokio::test]
async fn an_edit_with_an_ill_typed_new_string_is_an_argument_error() {
    let (store, ctx, _dir) = fixture(MemoryStrategy::Markdown);
    store
        .lock()
        .create("", "m", "d", "the contents", MemoryCode::default())
        .unwrap();

    let outcome = EditMemoryTool::new(store.clone())
        .invoke(
            json!({ "name": "m", "old_string": "the", "new_string": 5 }),
            &ctx,
        )
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        outcome.output.contains("`new_string` must be a string"),
        "{}",
        outcome.output
    );
    assert_eq!(store.lock().read("m").unwrap().body(), "the contents");
}

// ---------------------------------------------------------------------------
// The limits a file-shaped create or edit can breach
// ---------------------------------------------------------------------------

/// A store already holding every memory it may refuses the next one as a limit, with the guidance
/// to revise or evict rather than to rephrase.
#[tokio::test]
async fn a_create_past_the_memory_count_cap_is_a_limit() {
    let (store, ctx, _dir) = fixture_with(
        MemoryStrategy::KeywordSearch,
        MemoryCaps {
            max_count: Some(1),
            ..MemoryCaps::UNBOUNDED
        },
    );
    let tool = CreateMemoryTool::new(store.clone());

    assert!(
        tool.invoke(json!({ "name": "a", "contents": "first" }), &ctx)
            .await
            .ok
    );

    let outcome = tool
        .invoke(json!({ "name": "b", "contents": "second" }), &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::LimitExceeded));
    assert!(
        outcome.output.contains("at the maximum of 1 memories"),
        "{}",
        outcome.output
    );
    assert_eq!(store.lock().count(), 1);
}

#[tokio::test]
async fn a_create_past_the_per_memory_cap_is_a_limit() {
    let (store, ctx, _dir) = fixture_with(
        MemoryStrategy::KeywordSearch,
        MemoryCaps {
            max_len_per_memory: Some(8),
            ..MemoryCaps::UNBOUNDED
        },
    );
    let tool = CreateMemoryTool::new(store.clone());

    let outcome = tool
        .invoke(
            json!({ "name": "m", "contents": "contents far past the ceiling" }),
            &ctx,
        )
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::LimitExceeded));
    assert!(
        outcome
            .output
            .contains("memory `m` is 29 characters (max 8)"),
        "{}",
        outcome.output
    );
    assert_eq!(store.lock().count(), 0);
}

#[tokio::test]
async fn a_create_with_an_over_long_description_is_a_limit() {
    let (store, ctx, _dir) = fixture_with(
        MemoryStrategy::Markdown,
        MemoryCaps {
            max_len_description: Some(8),
            ..MemoryCaps::UNBOUNDED
        },
    );
    let tool = CreateMemoryTool::new(store.clone());

    let outcome = tool
        .invoke(
            json!({
                "name": "m",
                "description": "a summary far longer than the ceiling allows",
                "contents": "x",
            }),
            &ctx,
        )
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::LimitExceeded));
    assert!(
        outcome.output.contains("the description for memory `m`"),
        "{}",
        outcome.output
    );
    assert!(outcome.output.contains("(max 8)"), "{}", outcome.output);
    assert_eq!(store.lock().count(), 0);
}

/// An edit is measured after the replacement, so growing a memory past its ceiling is refused and
/// the stored contents are left exactly as they were.
#[tokio::test]
async fn an_edit_past_the_per_memory_cap_is_a_limit() {
    let (store, ctx, _dir) = fixture_with(
        MemoryStrategy::Markdown,
        MemoryCaps {
            max_len_per_memory: Some(10),
            ..MemoryCaps::UNBOUNDED
        },
    );
    store
        .lock()
        .create("", "m", "d", "abc", MemoryCode::default())
        .unwrap();

    let outcome = EditMemoryTool::new(store.clone())
        .invoke(
            json!({ "name": "m", "old_string": "abc", "new_string": "a replacement far too long" }),
            &ctx,
        )
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::LimitExceeded));
    assert!(outcome.output.contains("(max 10)"), "{}", outcome.output);
    assert_eq!(store.lock().read("m").unwrap().body(), "abc");
}
