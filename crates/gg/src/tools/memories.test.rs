//! Tests for the `write_memory`/`update_memory`/`delete_memory` tools: the happy paths,
//! the cap guards surfaced as tool errors, and argument validation. No network.

use std::sync::{Arc, Mutex};

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::memories::{MemoryCaps, MemoryStore};

/// A shared store bounded by `caps`, plus a throwaway workspace context.
fn fixture(caps: MemoryCaps) -> (Arc<Mutex<MemoryStore>>, ToolContext, TempDir) {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    (Arc::new(Mutex::new(MemoryStore::new(caps))), ctx, dir)
}

/// Tiny caps: 2 memories, 10 chars each, 15 total.
fn tiny_caps() -> MemoryCaps {
    MemoryCaps {
        max_count: 2,
        max_len_per_memory: 10,
        max_total_len: 15,
    }
}

#[tokio::test]
async fn write_memory_saves_and_reports_usage() {
    let (store, ctx, _dir) = fixture(MemoryCaps::default());
    let tool = WriteMemoryTool::new(Arc::clone(&store));

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
    let store = store.lock().unwrap();
    assert_eq!(store.count(), 1);
    assert_eq!(store.memories()[0].body(), "reach the goal");
}

#[tokio::test]
async fn write_memory_surfaces_a_duplicate_as_a_tool_error() {
    let (store, ctx, _dir) = fixture(MemoryCaps::default());
    let tool = WriteMemoryTool::new(Arc::clone(&store));
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
    let tool = WriteMemoryTool::new(Arc::clone(&store));

    // A body over the per-memory cap is refused (not truncated) with actionable guidance.
    let outcome = tool
        .invoke(
            json!({ "name": "m", "description": "d", "body": "way too long a body" }),
            &ctx,
        )
        .await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("per-memory limit"));
    assert!(outcome.output.contains("concise"));
    assert_eq!(store.lock().unwrap().count(), 0);

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
    assert_eq!(store.lock().unwrap().count(), 2);
}

#[tokio::test]
async fn write_memory_validates_missing_arguments() {
    let (store, ctx, _dir) = fixture(MemoryCaps::default());
    let tool = WriteMemoryTool::new(store);

    let outcome = tool
        .invoke(json!({ "name": "m", "description": "d" }), &ctx)
        .await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("body"));
}

#[tokio::test]
async fn update_memory_revises_or_reports_not_found() {
    let (store, ctx, _dir) = fixture(MemoryCaps::default());
    let write = WriteMemoryTool::new(Arc::clone(&store));
    let update = UpdateMemoryTool::new(Arc::clone(&store));

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
    assert_eq!(store.lock().unwrap().memories()[0].body(), "new body");

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
    let (store, ctx, _dir) = fixture(MemoryCaps::default());
    let write = WriteMemoryTool::new(Arc::clone(&store));
    let delete = DeleteMemoryTool::new(Arc::clone(&store));

    write
        .invoke(
            json!({ "name": "m", "description": "d", "body": "b" }),
            &ctx,
        )
        .await;
    let outcome = delete.invoke(json!({ "name": "m" }), &ctx).await;
    assert!(outcome.ok);
    assert!(outcome.output.contains("Deleted memory `m`"));
    assert_eq!(store.lock().unwrap().count(), 0);

    let outcome = delete.invoke(json!({ "name": "m" }), &ctx).await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("no memory named `m`"));
}

#[test]
fn is_memory_tool_recognizes_the_three_tools() {
    assert!(is_memory_tool("write_memory"));
    assert!(is_memory_tool("update_memory"));
    assert!(is_memory_tool("delete_memory"));
    assert!(!is_memory_tool("read_skill"));
    assert!(!is_memory_tool("write_file"));
}
