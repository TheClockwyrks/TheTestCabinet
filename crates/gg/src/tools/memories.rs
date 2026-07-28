//! The memory tools — how the model curates its own [memories](crate::memories).
//!
//! Which tools exist is the [strategy](crate::memories::MemoryStrategy)'s decision, and the two
//! shapes live in two files:
//!
//! * **This one**, the [scratchpad](crate::memories::MemoryStrategy::Scratchpad)'s
//!   `write_memory` / `update_memory` / `delete_memory`, whose bodies are all in the window;
//! * **[`memories.files.rs`](self::files)**, the file-shaped strategies'
//!   `create_memory` / `read_memory` / `edit_memory` / `search_memories`, whose bodies are not.
//!
//! `delete_memory` is shared: evicting a memory by name means the same thing under every strategy,
//! and a run only ever offers one strategy's set, so there is no ambiguity about which tool a call
//! reaches.
//!
//! Each tool mutates the shared [`MemoryStore`] (behind an `Arc<Mutex<…>>` the tool shares
//! with the [loop](crate::agent)) and returns a [`ToolOutcome`]: a confirmation on success,
//! or — when a mutation would breach a [limit](crate::memories::MemoryCaps) — an **error
//! outcome carrying the store's revise-evict-or-delete guidance**, never a silent truncation. The
//! loop owns the context-window consequences: after a successful mutation it refreshes the
//! pinned [`Memory`](test_cabinet_core::gg::GgContextSource::Memory) block (the memories
//! themselves, or the index, depending on the strategy) and re-emits the
//! [`MemoryState`](test_cabinet_core::gg::GgTelemetryKind::MemoryState) telemetry.
//!
//! The tools are contributed to the registry only when the
//! [`memories`](test_cabinet_core::gg::CAPABILITY_MEMORIES) capability is enabled; when it
//! is off, none are offered (ablation).

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{
    ArgumentError, MemoryUsageData, Tool, ToolContext, ToolData, ToolFailure, ToolOutcome,
    required_str, saturating_u32,
};
use crate::memories::{MemoryChange, MemoryError, MemoryStore};
use crate::model::ToolDefinition;

#[path = "memories.files.rs"]
mod files;

pub use files::{CreateMemoryTool, EditMemoryTool, ReadMemoryTool, SearchMemoriesTool};

/// The `write_memory` tool name.
pub const WRITE_MEMORY_TOOL: &str = "write_memory";
/// The `update_memory` tool name.
pub const UPDATE_MEMORY_TOOL: &str = "update_memory";
/// The `delete_memory` tool name.
pub const DELETE_MEMORY_TOOL: &str = "delete_memory";
/// The `create_memory` tool name.
pub const CREATE_MEMORY_TOOL: &str = "create_memory";
/// The `read_memory` tool name.
pub const READ_MEMORY_TOOL: &str = "read_memory";
/// The `edit_memory` tool name.
pub const EDIT_MEMORY_TOOL: &str = "edit_memory";
/// The `search_memories` tool name.
pub const SEARCH_MEMORIES_TOOL: &str = "search_memories";

/// Whether `name` is one of the memory-**mutating** tools — the loop uses this to know when a
/// successful tool call should refresh the memory block and re-emit its state.
///
/// `read_memory` and `search_memories` are deliberately absent: they change nothing, so a refresh
/// after one would re-send an identical block and re-emit an identical state event.
pub fn is_memory_tool(name: &str) -> bool {
    matches!(
        name,
        WRITE_MEMORY_TOOL
            | UPDATE_MEMORY_TOOL
            | DELETE_MEMORY_TOOL
            | CREATE_MEMORY_TOOL
            | EDIT_MEMORY_TOOL
    )
}

/// A short line describing how full the store is after a mutation, for the confirmation.
///
/// It reports the two figures that can refuse this run's *next* write, which differ by strategy: a
/// [markdown](crate::memories::MemoryStrategy::Markdown) run is bounded by its index rather than by
/// an aggregate body budget, and a limit that has been disabled is left out entirely rather than
/// reported as a number the model would reasonably plan against.
fn usage_note(store: &MemoryStore) -> String {
    let caps = store.caps();
    let count = match caps.max_count {
        Some(cap) => format!("You now hold {} of {cap} memories", store.count()),
        None => format!("You now hold {} memories", store.count()),
    };
    let detail = if store.strategy().has_index() {
        match caps.max_len_index {
            Some(cap) => format!(" (index: {} of {cap} characters)", store.index_len()),
            None => String::new(),
        }
    } else {
        match caps.max_total_len {
            Some(cap) => format!(" ({} of {cap} characters used)", store.total_len()),
            None => String::new(),
        }
    };
    format!("{count}{detail}.")
}

/// The numbers [`usage_note`] renders into a sentence, as the structured sidecar every
/// successful memory mutation carries.
///
/// Every axis is reported because any of them can refuse the next write: a caller near the
/// character budget with room in the count would otherwise have no way to see the limit it was
/// about to hit. A limit that does not apply — disabled, or not used by this strategy — is `None`
/// rather than a sentinel, so a program branches on "is there a limit" instead of on a magic zero.
fn usage_data(store: &MemoryStore) -> ToolData {
    let caps = store.caps();
    let cap_u32 = |cap: Option<usize>| cap.map(saturating_u32);
    ToolData::MemoryUsage(MemoryUsageData {
        count: saturating_u32(store.count()),
        max_count: cap_u32(caps.max_count),
        total_chars: saturating_u32(store.total_len()),
        max_total_chars: cap_u32(caps.max_total_len),
        index_chars: store
            .strategy()
            .has_index()
            .then(|| saturating_u32(store.index_len())),
        max_index_chars: cap_u32(caps.max_len_index),
    })
}

/// The parenthetical a tool description states this run's limits in, from the limits that are
/// actually in force: `" (at most 8 memories, 2000 characters of body each)"`, or the empty string
/// when every limit named has been disabled.
///
/// Written as a fold over the live limits rather than as a fixed sentence because each is
/// independently configurable *and* independently disableable: a description that named a cap the
/// run does not enforce would have the model rationing something it has plenty of, and one that
/// silently dropped the sentence would leave a dangling "are bounded".
fn bounds_note(limits: &[(Option<usize>, &str)]) -> String {
    let stated: Vec<String> = limits
        .iter()
        .filter_map(|(limit, noun)| limit.map(|limit| format!("{limit} {noun}")))
        .collect();
    if stated.is_empty() {
        String::new()
    } else {
        format!(" (at most {})", stated.join(", "))
    }
}

/// Classify a [`MemoryStore`] refusal, at the one place its error type is matched.
///
/// The store's [`Display`](std::fmt::Display) is the model-facing guidance and is free to be
/// reworded; this mapping is what a caller branches on, and it is derived from the variant, never
/// from that text.
fn failure_for(err: &MemoryError) -> ToolFailure {
    match err {
        // A field the caller supplied was empty, malformed, or asked for something that is really
        // a different call — all of them bad arguments rather than a state gg is in.
        MemoryError::EmptyField(_)
        | MemoryError::InvalidSlug(_)
        | MemoryError::WouldEmpty(_)
        | MemoryError::NoKeywords => ToolFailure::InvalidArgument,
        // The name is already taken, or an edit's search text matched more than once: well-formed,
        // but in conflict with what is stored.
        MemoryError::Duplicate { .. } | MemoryError::EditNotUnique { .. } => ToolFailure::Conflict,
        MemoryError::NotFound { .. } | MemoryError::EditNotFound { .. } => ToolFailure::NotFound,
        // The limits are gg-side ceilings on how much a run may keep, so a caller that is pruning
        // knows to evict rather than to rephrase.
        MemoryError::PerMemoryCap { .. }
        | MemoryError::CountCap { .. }
        | MemoryError::TotalCap { .. }
        | MemoryError::IndexCap { .. } => ToolFailure::LimitExceeded,
    }
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
                 one-line `description`, and the `body`. Every memory you hold stays in your \
                 context window, so they are bounded{}; if a limit is hit, revise an existing \
                 memory with `update_memory` or remove one with `delete_memory` rather than \
                 accruing more.",
                bounds_note(&[
                    (caps.max_count, "memories"),
                    (caps.max_len_per_memory, "characters of body each"),
                    (caps.max_total_len, "characters of body in total"),
                ])
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
            Err(error) => return error.into(),
        };
        self.write(name, description, body)
    }
}

impl WriteMemoryTool {
    /// Record a memory — the **standard, typed** `write_memory` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn write(&self, name: String, description: String, body: String) -> ToolOutcome {
        let mut store = self.store.lock().expect("memory store lock");
        match store.write(&name, &description, &body) {
            Ok(MemoryChange::Written) => ToolOutcome::ok(
                format!("Saved memory `{name}`. {}", usage_note(&store)),
                format!("wrote memory `{name}`"),
            )
            .with_data(usage_data(&store)),
            Ok(_) => unreachable!("write yields Written"),
            Err(err) => ToolOutcome::failed(failure_for(&err), format!("write_memory: {err}")),
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
            Err(error) => return error.into(),
        };
        self.update(name, description, body)
    }
}

impl UpdateMemoryTool {
    /// Revise a memory in place — the **standard, typed** `update_memory` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn update(&self, name: String, description: String, body: String) -> ToolOutcome {
        let mut store = self.store.lock().expect("memory store lock");
        match store.update(&name, &description, &body) {
            Ok(MemoryChange::Updated) => ToolOutcome::ok(
                format!("Updated memory `{name}`. {}", usage_note(&store)),
                format!("updated memory `{name}`"),
            )
            .with_data(usage_data(&store)),
            Ok(_) => unreachable!("update yields Updated"),
            Err(err) => ToolOutcome::failed(failure_for(&err), format!("update_memory: {err}")),
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
            Err(error) => return error.into(),
        };
        self.delete(name)
    }
}

impl DeleteMemoryTool {
    /// Remove a memory — the **standard, typed** `delete_memory` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn delete(&self, name: String) -> ToolOutcome {
        let mut store = self.store.lock().expect("memory store lock");
        match store.delete(&name) {
            Ok(MemoryChange::Deleted) => ToolOutcome::ok(
                format!("Deleted memory `{name}`. {}", usage_note(&store)),
                format!("deleted memory `{name}`"),
            )
            .with_data(usage_data(&store)),
            Ok(_) => unreachable!("delete yields Deleted"),
            Err(err) => ToolOutcome::failed(failure_for(&err), format!("delete_memory: {err}")),
        }
    }
}

/// Extract the `name`, `description`, and `body` string arguments shared by
/// `write_memory` and `update_memory`.
fn write_args(args: &Value, tool: &str) -> Result<(String, String, String), ArgumentError> {
    let name = required_str(args, "name", tool)?;
    let description = required_str(args, "description", tool)?;
    let body = required_str(args, "body", tool)?;
    Ok((name, description, body))
}

#[cfg(test)]
#[path = "memories.test.rs"]
mod tests;
