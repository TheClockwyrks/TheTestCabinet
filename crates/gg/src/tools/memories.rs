//! The memory tools: `write_memory`, `update_memory`, and `delete_memory` — how the
//! model curates its own [memories](crate::memories).
//!
//! Each tool mutates the shared [`MemoryStore`] (behind an `Arc<Mutex<…>>` the tool shares
//! with the [loop](crate::agent)) and returns a [`ToolOutcome`]: a confirmation on success,
//! or — when a write/update would breach a [cap](crate::memories::MemoryCaps) — an **error
//! outcome carrying the store's revise-or-evict guidance**, never a silent truncation. The
//! loop owns the context-window consequences: after a successful mutation it refreshes the
//! pinned [`Memory`](test_cabinet_core::gg::GgContextSource::Memory) block and re-emits the
//! [`MemoryState`](test_cabinet_core::gg::GgTelemetryKind::MemoryState) telemetry.
//!
//! The tools are contributed to the registry only when the
//! [`memories`](test_cabinet_core::gg::CAPABILITY_MEMORIES) capability is enabled; when it
//! is off, none are offered (ablation).

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{Tool, ToolContext, ToolOutcome, required_str};
use crate::memories::{MemoryChange, MemoryStore};
use crate::model::ToolDefinition;

/// The `write_memory` tool name.
pub const WRITE_MEMORY_TOOL: &str = "write_memory";
/// The `update_memory` tool name.
pub const UPDATE_MEMORY_TOOL: &str = "update_memory";
/// The `delete_memory` tool name.
pub const DELETE_MEMORY_TOOL: &str = "delete_memory";

/// Whether `name` is one of the memory-mutating tools — the loop uses this to know when a
/// successful tool call should refresh the memory block and re-emit its state.
pub fn is_memory_tool(name: &str) -> bool {
    matches!(
        name,
        WRITE_MEMORY_TOOL | UPDATE_MEMORY_TOOL | DELETE_MEMORY_TOOL
    )
}

/// A short line describing how full the store is after a mutation, for the confirmation.
fn usage_note(store: &MemoryStore) -> String {
    let caps = store.caps();
    format!(
        "You now hold {} of {} memories ({} of {} characters used).",
        store.count(),
        caps.max_count,
        store.total_len(),
        caps.max_total_len
    )
}

// ---------------------------------------------------------------------------
// write_memory
// ---------------------------------------------------------------------------

/// Creates a new memory the model curates.
pub struct WriteMemoryTool {
    store: Arc<Mutex<MemoryStore>>,
}

impl WriteMemoryTool {
    /// A tool writing into `store`.
    pub fn new(store: Arc<Mutex<MemoryStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for WriteMemoryTool {
    fn name(&self) -> &str {
        WRITE_MEMORY_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        let caps = self.store.lock().expect("memory store lock").caps();
        ToolDefinition::new(
            WRITE_MEMORY_TOOL,
            format!(
                "Record a new durable memory — a short note you curate that persists for \
                 the session and survives context compaction. Provide a unique `name`, a \
                 one-line `description`, and the `body`. Memories are bounded (at most {} \
                 memories, {} characters of body each, {} characters total); if a limit is \
                 hit, revise an existing memory with `update_memory` or remove one with \
                 `delete_memory` rather than accruing more.",
                caps.max_count, caps.max_len_per_memory, caps.max_total_len
            ),
            json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "A short, unique handle for the memory (used to update or delete it)."
                    },
                    "description": {
                        "type": "string",
                        "description": "A one-line summary of what the memory is for, shown up front."
                    },
                    "body": {
                        "type": "string",
                        "description": "The memory's contents — the fact or decision to remember."
                    }
                },
                "required": ["name", "description", "body"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let (name, description, body) = match write_args(&args, WRITE_MEMORY_TOOL) {
            Ok(fields) => fields,
            Err(message) => return ToolOutcome::error(message),
        };
        let mut store = self.store.lock().expect("memory store lock");
        match store.write(&name, &description, &body) {
            Ok(MemoryChange::Written) => ToolOutcome::ok(
                format!("Saved memory `{name}`. {}", usage_note(&store)),
                format!("wrote memory `{name}`"),
            ),
            Ok(_) => unreachable!("write yields Written"),
            Err(err) => ToolOutcome::error(format!("write_memory: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// update_memory
// ---------------------------------------------------------------------------

/// Revises an existing memory in place.
pub struct UpdateMemoryTool {
    store: Arc<Mutex<MemoryStore>>,
}

impl UpdateMemoryTool {
    /// A tool updating memories in `store`.
    pub fn new(store: Arc<Mutex<MemoryStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for UpdateMemoryTool {
    fn name(&self) -> &str {
        UPDATE_MEMORY_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            UPDATE_MEMORY_TOOL,
            "Revise an existing memory in place: supply its `name` and the new \
             `description` and `body` (both are replaced). Fails if no memory of that name \
             exists (use `write_memory` to create one) or if the new body would exceed a \
             length limit.",
            json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The name of the memory to revise."
                    },
                    "description": {
                        "type": "string",
                        "description": "The new one-line description (replaces the old one)."
                    },
                    "body": {
                        "type": "string",
                        "description": "The new body (replaces the old one)."
                    }
                },
                "required": ["name", "description", "body"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let (name, description, body) = match write_args(&args, UPDATE_MEMORY_TOOL) {
            Ok(fields) => fields,
            Err(message) => return ToolOutcome::error(message),
        };
        let mut store = self.store.lock().expect("memory store lock");
        match store.update(&name, &description, &body) {
            Ok(MemoryChange::Updated) => ToolOutcome::ok(
                format!("Updated memory `{name}`. {}", usage_note(&store)),
                format!("updated memory `{name}`"),
            ),
            Ok(_) => unreachable!("update yields Updated"),
            Err(err) => ToolOutcome::error(format!("update_memory: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// delete_memory
// ---------------------------------------------------------------------------

/// Removes (evicts) a memory.
pub struct DeleteMemoryTool {
    store: Arc<Mutex<MemoryStore>>,
}

impl DeleteMemoryTool {
    /// A tool deleting memories from `store`.
    pub fn new(store: Arc<Mutex<MemoryStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for DeleteMemoryTool {
    fn name(&self) -> &str {
        DELETE_MEMORY_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            DELETE_MEMORY_TOOL,
            "Remove (evict) a memory you no longer need by `name`, freeing room for new \
             ones. Fails if no memory of that name exists.",
            json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The name of the memory to remove."
                    }
                },
                "required": ["name"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let name = match required_str(&args, "name", DELETE_MEMORY_TOOL) {
            Ok(name) => name,
            Err(message) => return ToolOutcome::error(message),
        };
        let mut store = self.store.lock().expect("memory store lock");
        match store.delete(&name) {
            Ok(MemoryChange::Deleted) => ToolOutcome::ok(
                format!("Deleted memory `{name}`. {}", usage_note(&store)),
                format!("deleted memory `{name}`"),
            ),
            Ok(_) => unreachable!("delete yields Deleted"),
            Err(err) => ToolOutcome::error(format!("delete_memory: {err}")),
        }
    }
}

/// Extract the `name`, `description`, and `body` string arguments shared by
/// `write_memory` and `update_memory`.
fn write_args(args: &Value, tool: &str) -> Result<(String, String, String), String> {
    let name = required_str(args, "name", tool)?;
    let description = required_str(args, "description", tool)?;
    let body = required_str(args, "body", tool)?;
    Ok((name, description, body))
}

#[cfg(test)]
#[path = "memories.test.rs"]
mod tests;
