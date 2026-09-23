//! Tests for the [scratchpad](crate::memories::MemoryStrategy::Scratchpad) tools —
//! `write_memory`/`update_memory`/`delete_memory` — covering the happy paths, the limit guards
//! surfaced as tool errors, and argument validation. The file-shaped tools are tested in
//! `memories.files.test.rs`. No network.

use std::sync::{Arc, Mutex};

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::memories::{MemoryBinding, MemoryCaps, MemoryStore, MemoryStrategy};
use crate::tools::ToolFailure;

/// The [`MemoryUsageData`] an outcome carries, or a failure naming what it carried instead.
fn usage(outcome: &ToolOutcome) -> &MemoryUsageData {
    match outcome.data.as_ref() {
        Some(ApiData::MemoryUsage(data)) => data,
        other => panic!("expected memory usage, got {other:?}"),
    }
}

/// A [binding](MemoryBinding) onto a scratchpad store bounded by `caps`, plus a throwaway
/// workspace context.
///
/// The binding, rather than the bare store, because that is what a tool takes: a store plus the
/// agent whose calls go through it. These tests attribute to no agent — the empty author — since
/// what they are about is what each call does, not whose call it was.
fn fixture(caps: MemoryCaps) -> (MemoryBinding, ToolContext, TempDir) {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    (
        MemoryBinding::new(
            Arc::new(Mutex::new(MemoryStore::new(
                MemoryStrategy::Scratchpad,
                caps,
            ))),
            "",
        ),
        ctx,
        dir,
    )
}

/// Tiny limits: 2 memories, 10 chars each, 15 total.
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

#[tokio::test]
async fn write_memory_saves_and_reports_usage() {
    // "1 of N" is a count against a ceiling, so this case has to declare one: a store bounded by
    // nothing reports how many memories it holds and nothing to compare that against.
    let (store, ctx, _dir) = fixture(MemoryCaps {
        max_count: Some(64),
        ..MemoryCaps::UNBOUNDED
    });
    let tool = WriteMemoryTool::new(store.clone());

    let outcome = tool
        .invoke(
            json!({ "name": "plan", "description": "the plan", "body": "reach the goal" }),
            &ctx,
        )
        .await;
    assert!(outcome.ok);
    assert!(outcome.output.contains("Saved memory `plan`"));
    // The confirmation reports how full the store now is.
    assert!(outcome.output.contains("1 of"));

    // The store actually holds it.
    let store = store.lock();
    assert_eq!(store.count(), 1);
    assert_eq!(store.memories()[0].body(), "reach the goal");
}

#[tokio::test]
async fn write_memory_surfaces_a_duplicate_as_a_tool_error() {
    let (store, ctx, _dir) = fixture(MemoryCaps::UNBOUNDED);
    let tool = WriteMemoryTool::new(store.clone());
    let args = json!({ "name": "dup", "description": "d", "body": "b" });

    assert!(tool.invoke(args.clone(), &ctx).await.ok);
    let outcome = tool.invoke(args, &ctx).await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("already exists"));
    assert!(outcome.output.contains("update_memory"));
}

#[tokio::test]
async fn write_memory_surfaces_a_cap_breach_as_a_revise_or_evict_error() {
    let (store, ctx, _dir) = fixture(tiny_caps());
    let tool = WriteMemoryTool::new(store.clone());

    // A body over the per-memory cap is refused (not truncated) with actionable guidance.
    let outcome = tool
        .invoke(
            json!({ "name": "m", "description": "d", "body": "way too long a body" }),
            &ctx,
        )
        .await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("(max 10)"), "{}", outcome.output);
    assert_eq!(store.lock().count(), 0);

    // Fill to the count cap, then the next write is refused with evict guidance.
    tool.invoke(
        json!({ "name": "a", "description": "d", "body": "aa" }),
        &ctx,
    )
    .await;
    tool.invoke(
        json!({ "name": "b", "description": "d", "body": "bb" }),
        &ctx,
    )
    .await;
    let outcome = tool
        .invoke(
            json!({ "name": "c", "description": "d", "body": "cc" }),
            &ctx,
        )
        .await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("delete_memory"));
    assert_eq!(store.lock().count(), 2);
}

#[tokio::test]
async fn write_memory_validates_missing_arguments() {
    let (store, ctx, _dir) = fixture(MemoryCaps::UNBOUNDED);
    let tool = WriteMemoryTool::new(store.clone());

    let outcome = tool
        .invoke(json!({ "name": "m", "description": "d" }), &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(outcome.output.contains("body"), "{}", outcome.output);
    assert_eq!(store.lock().count(), 0);
}

#[tokio::test]
async fn a_write_with_an_ill_typed_argument_is_an_argument_error() {
    let (store, ctx, _dir) = fixture(MemoryCaps::UNBOUNDED);
    let tool = WriteMemoryTool::new(store.clone());

    let outcome = tool
        .invoke(json!({ "name": 7, "description": "d", "body": "b" }), &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        outcome.output.contains("`name` must be a string"),
        "{}",
        outcome.output
    );
    assert_eq!(store.lock().count(), 0);
}

#[tokio::test]
async fn update_memory_revises_or_reports_not_found() {
    let (store, ctx, _dir) = fixture(MemoryCaps::UNBOUNDED);
    let write = WriteMemoryTool::new(store.clone());
    let update = UpdateMemoryTool::new(store.clone());

    write
        .invoke(
            json!({ "name": "m", "description": "d", "body": "old" }),
            &ctx,
        )
        .await;
    let outcome = update
        .invoke(
            json!({ "name": "m", "description": "d2", "body": "new body" }),
            &ctx,
        )
        .await;
    assert!(outcome.ok);
    assert!(outcome.output.contains("Updated memory `m`"));
    assert_eq!(store.lock().memories()[0].body(), "new body");

    // Updating an unknown memory is an error pointing at write_memory.
    let outcome = update
        .invoke(
            json!({ "name": "ghost", "description": "d", "body": "b" }),
            &ctx,
        )
        .await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("no memory named `ghost`"));
}

#[tokio::test]
async fn delete_memory_evicts_or_reports_not_found() {
    let (store, ctx, _dir) = fixture(MemoryCaps::UNBOUNDED);
    let write = WriteMemoryTool::new(store.clone());
    let delete = DeleteMemoryTool::new(store.clone());

    write
        .invoke(
            json!({ "name": "m", "description": "d", "body": "b" }),
            &ctx,
        )
        .await;
    let outcome = delete.invoke(json!({ "name": "m" }), &ctx).await;
    assert!(outcome.ok);
    assert!(outcome.output.contains("Deleted memory `m`"));
    assert_eq!(store.lock().count(), 0);

    let outcome = delete.invoke(json!({ "name": "m" }), &ctx).await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("no memory named `m`"));
}

// ---------------------------------------------------------------------------
// The structured sidecar and the classified failures
// ---------------------------------------------------------------------------

/// Every successful memory mutation reports both capped axes, so a caller near the character
/// budget can see the ceiling it is about to hit rather than discovering it on the next write.
#[tokio::test]
async fn every_memory_mutation_reports_both_capped_axes() {
    let (store, ctx, _dir) = fixture(tiny_caps());
    let write = WriteMemoryTool::new(store.clone());

    let saved = write
        .invoke(
            json!({ "name": "m", "description": "d", "body": "abc" }),
            &ctx,
        )
        .await;
    assert_eq!(
        usage(&saved),
        &MemoryUsageData {
            count: 1,
            max_count: Some(2),
            total_chars: 3,
            max_total_chars: Some(15),
            // The scratchpad keeps no index, so neither index figure is reported.
            index_chars: None,
            max_index_chars: None,
        }
    );

    let updated = UpdateMemoryTool::new(store.clone())
        .invoke(
            json!({ "name": "m", "description": "d", "body": "abcde" }),
            &ctx,
        )
        .await;
    assert_eq!(usage(&updated).total_chars, 5);

    let deleted = DeleteMemoryTool::new(store.clone())
        .invoke(json!({ "name": "m" }), &ctx)
        .await;
    assert_eq!(usage(&deleted).count, 0);
    assert_eq!(usage(&deleted).total_chars, 0);
}

/// Each way the store can refuse is classified from its own error variant: a taken name is a
/// conflict, an unknown name is not-found, and every cap is a limit.
#[tokio::test]
async fn each_store_refusal_is_classified_from_its_variant() {
    let (store, ctx, _dir) = fixture(tiny_caps());
    let write = WriteMemoryTool::new(store.clone());

    write
        .invoke(
            json!({ "name": "a", "description": "d", "body": "aa" }),
            &ctx,
        )
        .await;

    let duplicate = write
        .invoke(
            json!({ "name": "a", "description": "d", "body": "bb" }),
            &ctx,
        )
        .await;
    assert_eq!(duplicate.failure, Some(ToolFailure::Conflict));

    let unknown = UpdateMemoryTool::new(store.clone())
        .invoke(
            json!({ "name": "ghost", "description": "d", "body": "b" }),
            &ctx,
        )
        .await;
    assert_eq!(unknown.failure, Some(ToolFailure::NotFound));

    let too_long = write
        .invoke(
            json!({ "name": "b", "description": "d", "body": "way too long a body" }),
            &ctx,
        )
        .await;
    assert_eq!(too_long.failure, Some(ToolFailure::LimitExceeded));

    // Fill the count cap, then hit it.
    write
        .invoke(
            json!({ "name": "b", "description": "d", "body": "bb" }),
            &ctx,
        )
        .await;
    let too_many = write
        .invoke(
            json!({ "name": "c", "description": "d", "body": "cc" }),
            &ctx,
        )
        .await;
    assert_eq!(too_many.failure, Some(ToolFailure::LimitExceeded));

    // And an empty required field is the model's mistake, not the store's ceiling.
    let empty = write
        .invoke(json!({ "name": "", "description": "d", "body": "b" }), &ctx)
        .await;
    assert_eq!(empty.failure, Some(ToolFailure::InvalidArgument));

    // As is a missing one.
    let missing = write.invoke(json!({ "name": "d" }), &ctx).await;
    assert_eq!(missing.failure, Some(ToolFailure::InvalidArgument));
}

/// The loop refreshes the pinned block and re-emits the state after a *mutation*, so the predicate
/// covers every strategy's mutating tools and neither of the two that only read.
#[test]
fn is_memory_tool_recognizes_every_mutating_memory_tool() {
    assert!(is_memory_tool("write_memory"));
    assert!(is_memory_tool("update_memory"));
    assert!(is_memory_tool("create_memory"));
    assert!(is_memory_tool("edit_memory"));
    assert!(is_memory_tool("delete_memory"));
    // Reads change nothing, so a refresh after one would re-send an identical block.
    assert!(!is_memory_tool("read_memory"));
    assert!(!is_memory_tool("search_memories"));
    assert!(!is_memory_tool("read_skill"));
    assert!(!is_memory_tool("write_file"));
}

// ---------------------------------------------------------------------------
// The limits a scratchpad write or update can breach
// ---------------------------------------------------------------------------

/// The aggregate budget is a separate ceiling from the per-memory one, and a model that has just
/// been refused needs to know *which* it ran out of: rewriting the body shorter fixes one of them
/// and evicting a memory fixes the other.
#[tokio::test]
async fn a_write_past_the_total_character_cap_is_a_limit() {
    // 10 characters each, 15 in total: two bodies that each fit individually cannot both be held.
    let (store, ctx, _dir) = fixture(MemoryCaps {
        max_count: None,
        max_len_per_memory: Some(10),
        max_total_len: Some(15),
        ..MemoryCaps::UNBOUNDED
    });
    let tool = WriteMemoryTool::new(store.clone());

    let first = tool
        .invoke(
            json!({ "name": "a", "description": "d", "body": "aaaaaaaaaa" }),
            &ctx,
        )
        .await;
    assert!(first.ok, "{}", first.output);

    let second = tool
        .invoke(
            json!({ "name": "b", "description": "d", "body": "bbbbbbbbbb" }),
            &ctx,
        )
        .await;
    assert_eq!(second.failure, Some(ToolFailure::LimitExceeded));
    // The diagnostic names the aggregate budget and its ceiling, not the per-memory one — the
    // body it just refused is exactly the size of a body it accepted a moment ago.
    assert!(
        second
            .output
            .contains("total memory would be 20 characters"),
        "{}",
        second.output
    );
    assert!(second.output.contains("(max 15)"), "{}", second.output);
    assert_eq!(store.lock().count(), 1);
}

/// The description is measured against its own ceiling, so an over-long one-liner is refused even
/// when the body it summarizes is well within every other limit.
#[tokio::test]
async fn a_write_with_an_over_long_description_is_a_limit() {
    let (store, ctx, _dir) = fixture(MemoryCaps {
        max_len_description: Some(8),
        ..MemoryCaps::UNBOUNDED
    });
    let tool = WriteMemoryTool::new(store.clone());

    let outcome = tool
        .invoke(
            json!({
                "name": "m",
                "description": "a summary far longer than the ceiling allows",
                "body": "b",
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

/// A revision is bounded by the same per-memory ceiling a write is: growing a memory past it is
/// refused rather than truncated, and the memory keeps the body it had.
#[tokio::test]
async fn an_update_past_the_per_memory_cap_is_a_limit() {
    let (store, ctx, _dir) = fixture(tiny_caps());
    let write = WriteMemoryTool::new(store.clone());
    let update = UpdateMemoryTool::new(store.clone());

    assert!(
        write
            .invoke(
                json!({ "name": "m", "description": "d", "body": "short" }),
                &ctx
            )
            .await
            .ok
    );

    let outcome = update
        .invoke(
            json!({ "name": "m", "description": "d", "body": "way too long a body" }),
            &ctx,
        )
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::LimitExceeded));
    assert!(outcome.output.contains("(max 10)"), "{}", outcome.output);
    assert_eq!(store.lock().memories()[0].body(), "short");
}

/// The same for the description half of a revision.
#[tokio::test]
async fn an_update_with_an_over_long_description_is_a_limit() {
    let (store, ctx, _dir) = fixture(MemoryCaps {
        max_len_description: Some(8),
        ..MemoryCaps::UNBOUNDED
    });
    let write = WriteMemoryTool::new(store.clone());
    let update = UpdateMemoryTool::new(store.clone());

    assert!(
        write
            .invoke(
                json!({ "name": "m", "description": "short", "body": "b" }),
                &ctx
            )
            .await
            .ok
    );

    let outcome = update
        .invoke(
            json!({
                "name": "m",
                "description": "a summary far longer than the ceiling allows",
                "body": "b2",
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
    assert_eq!(store.lock().memories()[0].description(), "short");
}

// ---------------------------------------------------------------------------
// The argument diagnostics update_memory and delete_memory raise
// ---------------------------------------------------------------------------

/// Every field `update_memory` declares required is read as required, and the diagnostic names the
/// one that is missing rather than saying the call was malformed.
#[tokio::test]
async fn an_update_missing_a_required_argument_is_an_argument_error() {
    let (store, ctx, _dir) = fixture(MemoryCaps::UNBOUNDED);
    let tool = UpdateMemoryTool::new(store);

    for (args, field) in [
        (json!({ "description": "d", "body": "b" }), "name"),
        (json!({ "name": "m", "body": "b" }), "description"),
        (json!({ "name": "m", "description": "d" }), "body"),
    ] {
        let outcome = tool.invoke(args, &ctx).await;
        assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
        assert!(outcome.output.contains(field), "{}", outcome.output);
    }
}

/// A field of the wrong JSON type is the model's mistake too, and is told apart from an absent one.
#[tokio::test]
async fn an_update_with_an_ill_typed_argument_is_an_argument_error() {
    let (store, ctx, _dir) = fixture(MemoryCaps::UNBOUNDED);
    let tool = UpdateMemoryTool::new(store);

    let outcome = tool
        .invoke(json!({ "name": 7, "description": "d", "body": "b" }), &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        outcome.output.contains("`name` must be a string"),
        "{}",
        outcome.output
    );
}

#[tokio::test]
async fn a_delete_missing_its_name_is_an_argument_error() {
    let (store, ctx, _dir) = fixture(MemoryCaps::UNBOUNDED);
    let tool = DeleteMemoryTool::new(store);

    let outcome = tool.invoke(json!({}), &ctx).await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(outcome.output.contains("name"), "{}", outcome.output);
}

#[tokio::test]
async fn a_delete_with_an_ill_typed_name_is_an_argument_error() {
    let (store, ctx, _dir) = fixture(MemoryCaps::UNBOUNDED);
    let tool = DeleteMemoryTool::new(store);

    let outcome = tool.invoke(json!({ "name": [] }), &ctx).await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        outcome.output.contains("`name` must be a string"),
        "{}",
        outcome.output
    );
}
