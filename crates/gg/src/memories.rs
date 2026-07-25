//! The gg **memories** capability: a bounded, model-curated scratchpad whose entries'
//! descriptions are shown up front and whose bodies are **retained across compaction**.
//!
//! A [memory](https://docs.testcabinet.ai/gg/memories/) is *essentially a
//! [skill](crate::skills) the model writes itself*: the same "description up front, body
//! retained across a compaction boundary" shape, but curated at run time rather than
//! authored ahead. The model calls `write_memory` / `update_memory` / `delete_memory` to
//! record durable facts and decisions as it works. Each memory's body is pushed into the
//! context window as a [`Memory`](test_cabinet_core::gg::GgContextSource)-sourced,
//! [`Pinned`](crate::context::Retention::Pinned) item, so the
//! [context accounting](crate::context) attributes it to memories and Phase 2 compaction
//! carries it across the boundary verbatim.
//!
//! # Why bounded
//!
//! Because the model controls memories, they must be **bounded** — otherwise self-curated
//! notes could crowd out the working context. gg enforces three [caps](MemoryCaps): the
//! number of memories, each memory's body length, and the aggregate body length. When a
//! write or update would exceed a cap, the store **rejects it with a
//! [`MemoryError`]** whose message instructs the model to *revise or evict* rather than
//! silently truncating or dropping content. Lengths are measured in characters of a
//! memory's **body**; its `description` is a short one-liner (like a skill's), shown up
//! front and not counted against the caps.
//!
//! # Shapes
//!
//! - [`Memory`] — one curated note (name, description, body).
//! - [`MemoryCaps`] — the three bounds, [resolved](MemoryCaps::resolve) from the
//!   capability's params with documented defaults.
//! - [`MemoryStore`] — the mutable, cap-enforcing set of memories, shared (`Arc<Mutex>`)
//!   between the loop and the memory tools.
//! - [`MemoriesRuntime`] — the loop's live view: whether the capability is on, the shared
//!   store, and the derivations the loop needs (the caps the system prompt states, the
//!   [`MemoryState`](test_cabinet_core::gg::GgTelemetryKind::MemoryState) telemetry, and
//!   the pinned context block).
//!
//! The capability is **ablatable**: when it is off the loop builds a
//! [`disabled`](MemoriesRuntime::disabled) runtime, so there are no memory tools, no prompt
//! text, no context block, and no telemetry — the feature vanishes.

use std::fmt;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use test_cabinet_core::gg::{GgMemoryCaps, GgMemoryEntry, GgTelemetryKind};

use crate::model::Message;
use crate::prompts::{self, MemoriesBlockContext, MemoryItemView};

/// Default [maximum number of memories](MemoryCaps::max_count). A small ceiling — the
/// point is a curated handful of durable facts, not a second transcript.
pub const DEFAULT_MAX_COUNT: usize = 8;

/// Default [per-memory body length cap](MemoryCaps::max_len_per_memory), in characters —
/// roughly a few short paragraphs, enough for a decision or a fact with its rationale.
pub const DEFAULT_MAX_LEN_PER_MEMORY: usize = 2_000;

/// Default [aggregate body length cap](MemoryCaps::max_total_len), in characters, across
/// every memory — a firm ceiling on how much of the window self-curated notes may occupy.
pub const DEFAULT_MAX_TOTAL_LEN: usize = 8_000;

/// The memories capability param naming the [maximum count](MemoryCaps::max_count).
const PARAM_MAX_COUNT: &str = "maxCount";
/// The memories capability param naming the [per-memory cap](MemoryCaps::max_len_per_memory).
const PARAM_MAX_LEN_PER_MEMORY: &str = "maxLenPerMemory";
/// The memories capability param naming the [aggregate cap](MemoryCaps::max_total_len).
const PARAM_MAX_TOTAL_LEN: &str = "maxTotalLen";

/// One model-curated memory: the `name`/`description` shown up front and the `body`
/// (front-and-center, retained in context) the model wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Memory {
    /// The memory's stable name — the handle `update_memory`/`delete_memory` take.
    name: String,
    /// The one-line description shown up front (not counted against the caps).
    description: String,
    /// The memory's body — the substance, retained in context and measured by the caps.
    body: String,
}

impl Memory {
    /// The memory's length in characters — its **body** length, what the
    /// [caps](MemoryCaps) bound (the short description is not counted).
    pub fn len(&self) -> usize {
        self.body.chars().count()
    }
}

// Name/description/body accessors are the memory's read surface for the tests and for the
// console-facing derivations that read the fields directly; the non-test binary reaches
// the fields internally, so it sees these as unused.
#[allow(dead_code)]
impl Memory {
    /// The memory's name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The memory's description.
    pub fn description(&self) -> &str {
        &self.description
    }

    /// The memory's body.
    pub fn body(&self) -> &str {
        &self.body
    }
}

/// The bounds gg keeps the model's [memories](MemoryStore) within, so self-curated notes
/// cannot crowd out the working context.
///
/// [Resolved](Self::resolve) from the memories capability's params, each falling back to a
/// documented default ([`DEFAULT_MAX_COUNT`], [`DEFAULT_MAX_LEN_PER_MEMORY`],
/// [`DEFAULT_MAX_TOTAL_LEN`]). Lengths are in characters of a memory's body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryCaps {
    /// The maximum number of memories that may exist at once.
    pub max_count: usize,
    /// The maximum length, in characters, of any single memory's body.
    pub max_len_per_memory: usize,
    /// The maximum total body length, in characters, summed across every memory.
    pub max_total_len: usize,
}

impl Default for MemoryCaps {
    fn default() -> Self {
        Self {
            max_count: DEFAULT_MAX_COUNT,
            max_len_per_memory: DEFAULT_MAX_LEN_PER_MEMORY,
            max_total_len: DEFAULT_MAX_TOTAL_LEN,
        }
    }
}

impl MemoryCaps {
    /// Resolve the caps from a memories-capability `params` object: each of `maxCount`,
    /// `maxLenPerMemory`, and `maxTotalLen` overrides its default when present as a
    /// positive integer; a missing, zero, or non-integer value keeps the default.
    pub fn resolve(params: &Value) -> Self {
        let default = Self::default();
        Self {
            max_count: param_usize(params, PARAM_MAX_COUNT).unwrap_or(default.max_count),
            max_len_per_memory: param_usize(params, PARAM_MAX_LEN_PER_MEMORY)
                .unwrap_or(default.max_len_per_memory),
            max_total_len: param_usize(params, PARAM_MAX_TOTAL_LEN)
                .unwrap_or(default.max_total_len),
        }
    }

    /// The contract form of the caps for the
    /// [`MemoryState`](GgTelemetryKind::MemoryState) telemetry.
    fn to_contract(self) -> GgMemoryCaps {
        GgMemoryCaps {
            max_count: self.max_count as u64,
            max_len_per_memory: self.max_len_per_memory as u64,
            max_total_len: self.max_total_len as u64,
        }
    }
}

/// The first positive-integer value of `key` in a params object, or `None`.
fn param_usize(params: &Value, key: &str) -> Option<usize> {
    params
        .get(key)
        .and_then(Value::as_u64)
        .filter(|&n| n > 0)
        .map(|n| n as usize)
}

/// Why a [`MemoryStore`] mutation was refused. Its [`Display`](fmt::Display) is the
/// **model-facing** message the tool returns: every variant tells the model how to
/// proceed (revise or evict), never silently truncating or dropping content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoryError {
    /// A required field (`name`, `description`, or `body`) was empty.
    EmptyField(&'static str),
    /// `write_memory` named a memory that already exists (use `update_memory` instead).
    Duplicate(String),
    /// `update_memory`/`delete_memory` named a memory that does not exist.
    NotFound(String),
    /// The memory's body exceeds the per-memory length cap.
    PerMemoryCap {
        /// The offending memory's name.
        name: String,
        /// The body length that was attempted.
        len: usize,
        /// The per-memory cap.
        cap: usize,
    },
    /// Adding a memory would exceed the count cap.
    CountCap {
        /// The count cap (already reached).
        cap: usize,
    },
    /// The write/update would push the aggregate body length over the total cap.
    TotalCap {
        /// The total length the write/update would produce.
        would_be: usize,
        /// The aggregate cap.
        cap: usize,
    },
}

impl fmt::Display for MemoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MemoryError::EmptyField(field) => {
                write!(f, "`{field}` must not be empty.")
            }
            MemoryError::Duplicate(name) => write!(
                f,
                "a memory named `{name}` already exists; use `update_memory` to revise it, \
                 or choose a different name."
            ),
            MemoryError::NotFound(name) => write!(
                f,
                "no memory named `{name}` exists (your current memories are listed in your \
                 context); use `write_memory` to create it."
            ),
            MemoryError::PerMemoryCap { name, len, cap } => write!(
                f,
                "memory `{name}` is {len} characters, over the per-memory limit of {cap}; \
                 make it more concise before saving."
            ),
            MemoryError::CountCap { cap } => write!(
                f,
                "you already hold the maximum of {cap} memories; revise an existing one \
                 with `update_memory`, or remove one with `delete_memory`, before adding \
                 another."
            ),
            MemoryError::TotalCap { would_be, cap } => write!(
                f,
                "this would bring your total memory to {would_be} characters, over the \
                 {cap}-character budget; shorten or delete other memories first."
            ),
        }
    }
}

/// What a successful [`MemoryStore`] mutation did — the loop reports this in the tool's
/// confirmation and the telemetry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryChange {
    /// A new memory was created.
    Written,
    /// An existing memory was revised.
    Updated,
    /// A memory was removed.
    Deleted,
}

/// The mutable, cap-enforcing set of the model's memories.
///
/// The store is the single owner of the memory set; the [tools](crate::tools) and the
/// [loop](crate::agent) share it behind an `Arc<Mutex<…>>`. Every mutation is checked
/// against the [caps](MemoryCaps) *before* it takes effect and refused with a
/// [`MemoryError`] otherwise, so the invariants (count, per-memory length, total length)
/// always hold. Memories are kept in name order for a stable telemetry and prompt-block
/// ordering.
#[derive(Debug, Clone)]
pub struct MemoryStore {
    caps: MemoryCaps,
    memories: Vec<Memory>,
}

impl MemoryStore {
    /// An empty store bounded by `caps`.
    pub fn new(caps: MemoryCaps) -> Self {
        Self {
            caps,
            memories: Vec::new(),
        }
    }

    /// The caps this store enforces.
    pub fn caps(&self) -> MemoryCaps {
        self.caps
    }

    /// The number of memories currently held.
    pub fn count(&self) -> usize {
        self.memories.len()
    }

    /// The total body length, in characters, across every memory.
    pub fn total_len(&self) -> usize {
        self.memories.iter().map(Memory::len).sum()
    }

    /// The memories, in name order. (A read surface for the tests; the loop reaches the
    /// store through the runtime's derivations.)
    #[allow(dead_code)]
    pub fn memories(&self) -> &[Memory] {
        &self.memories
    }

    /// Create a new memory. Refused if any field is empty, a memory of that name already
    /// exists, the body exceeds the per-memory cap, the store is already at the count cap,
    /// or the write would exceed the total-length cap.
    pub fn write(
        &mut self,
        name: &str,
        description: &str,
        body: &str,
    ) -> Result<MemoryChange, MemoryError> {
        let (name, description, body) = validate_fields(name, description, body)?;
        if self.position(&name).is_some() {
            return Err(MemoryError::Duplicate(name));
        }
        let len = body.chars().count();
        self.check_per_memory(&name, len)?;
        if self.memories.len() >= self.caps.max_count {
            return Err(MemoryError::CountCap {
                cap: self.caps.max_count,
            });
        }
        self.check_total(self.total_len() + len)?;
        self.insert(Memory {
            name,
            description,
            body,
        });
        Ok(MemoryChange::Written)
    }

    /// Revise an existing memory in place. Refused if any field is empty, no memory of
    /// that name exists, the new body exceeds the per-memory cap, or the update would push
    /// the aggregate length over the total cap. (The count is unchanged, so the count cap
    /// does not apply.)
    pub fn update(
        &mut self,
        name: &str,
        description: &str,
        body: &str,
    ) -> Result<MemoryChange, MemoryError> {
        let (name, description, body) = validate_fields(name, description, body)?;
        let Some(index) = self.position(&name) else {
            return Err(MemoryError::NotFound(name));
        };
        let len = body.chars().count();
        self.check_per_memory(&name, len)?;
        // Swap the old body out of the total before checking the new one in.
        let total_without_old = self.total_len() - self.memories[index].len();
        self.check_total(total_without_old + len)?;
        self.memories[index] = Memory {
            name,
            description,
            body,
        };
        Ok(MemoryChange::Updated)
    }

    /// Remove a memory. Refused if the name is empty or no memory of that name exists.
    pub fn delete(&mut self, name: &str) -> Result<MemoryChange, MemoryError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(MemoryError::EmptyField("name"));
        }
        let Some(index) = self.position(name) else {
            return Err(MemoryError::NotFound(name.to_string()));
        };
        self.memories.remove(index);
        Ok(MemoryChange::Deleted)
    }

    /// The index of the memory named `name`, if any.
    fn position(&self, name: &str) -> Option<usize> {
        self.memories.iter().position(|m| m.name == name)
    }

    /// Insert `memory`, keeping the set ordered by name.
    fn insert(&mut self, memory: Memory) {
        let at = self
            .memories
            .binary_search_by(|m| m.name.cmp(&memory.name))
            .unwrap_or_else(|at| at);
        self.memories.insert(at, memory);
    }

    /// Refuse a body whose length exceeds the per-memory cap.
    fn check_per_memory(&self, name: &str, len: usize) -> Result<(), MemoryError> {
        if len > self.caps.max_len_per_memory {
            Err(MemoryError::PerMemoryCap {
                name: name.to_string(),
                len,
                cap: self.caps.max_len_per_memory,
            })
        } else {
            Ok(())
        }
    }

    /// Refuse an aggregate length that exceeds the total cap.
    fn check_total(&self, would_be: usize) -> Result<(), MemoryError> {
        if would_be > self.caps.max_total_len {
            Err(MemoryError::TotalCap {
                would_be,
                cap: self.caps.max_total_len,
            })
        } else {
            Ok(())
        }
    }

    /// The [`MemoryState`](GgTelemetryKind::MemoryState) telemetry for the current set.
    fn state_event(&self) -> GgTelemetryKind {
        let memories = self
            .memories
            .iter()
            .map(|m| GgMemoryEntry {
                name: m.name.clone(),
                description: m.description.clone(),
                len: m.len() as u64,
            })
            .collect();
        GgTelemetryKind::MemoryState {
            memories,
            count: self.memories.len() as u64,
            total_len: self.total_len() as u64,
            caps: self.caps.to_contract(),
        }
    }

    /// The pinned context block rendering every in-play memory (name, description, body),
    /// or `None` when there are no memories to show.
    ///
    /// The block is **state only**: a heading and the notes themselves. How to curate them, and
    /// the budget they live within, is stated once in the
    /// [system prompt](crate::prompts::SystemContext::memories) rather than re-sent every turn
    /// the block is refreshed.
    fn context_block(&self) -> Option<Message> {
        if self.memories.is_empty() {
            return None;
        }
        let memories = self
            .memories
            .iter()
            .map(|memory| MemoryItemView {
                name: memory.name.clone(),
                description: memory.description.clone(),
                body: memory.body.clone(),
            })
            .collect();
        Some(Message::user(prompts::render_memories(
            &MemoriesBlockContext { memories },
        )))
    }
}

/// Validate and normalize a write/update's three fields, trimming each and rejecting an
/// empty one. Returns the owned, trimmed `(name, description, body)`.
fn validate_fields(
    name: &str,
    description: &str,
    body: &str,
) -> Result<(String, String, String), MemoryError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(MemoryError::EmptyField("name"));
    }
    let description = description.trim();
    if description.is_empty() {
        return Err(MemoryError::EmptyField("description"));
    }
    // The body keeps its interior formatting but is trimmed of surrounding whitespace.
    let body = body.trim();
    if body.is_empty() {
        return Err(MemoryError::EmptyField("body"));
    }
    Ok((name.to_string(), description.to_string(), body.to_string()))
}

/// The loop's live view of the memories capability: whether it is on and the shared
/// [`MemoryStore`].
///
/// Constructed [enabled](Self::new) with resolved caps or [disabled](Self::disabled) (an
/// ablation's off arm). It hands the [`store`](Self::store) to the memory tools, produces
/// the [caps](Self::caps) the [system prompt](crate::prompts::SystemContext::memories) states,
/// the [`MemoryState`](GgTelemetryKind::MemoryState) [telemetry](Self::state_event), and the
/// pinned [context block](Self::context_block) the loop keeps in the window.
#[derive(Debug, Clone)]
pub struct MemoriesRuntime {
    /// Whether the memories capability is enabled for this run.
    enabled: bool,
    /// The shared, mutable store — the same handle the tools mutate.
    store: Arc<Mutex<MemoryStore>>,
}

impl MemoriesRuntime {
    /// An enabled runtime with an empty store bounded by `caps`.
    pub fn new(caps: MemoryCaps) -> Self {
        Self {
            enabled: true,
            store: Arc::new(Mutex::new(MemoryStore::new(caps))),
        }
    }

    /// A disabled runtime (the memories capability is off): no tools, no prompt text,
    /// no context block, no telemetry.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            store: Arc::new(Mutex::new(MemoryStore::new(MemoryCaps::default()))),
        }
    }

    /// Whether the capability offers memory tools this run (simply whether it is enabled —
    /// unlike skills, memories need no pre-existing library; the model creates them).
    pub fn offers_memories(&self) -> bool {
        self.enabled
    }

    /// The shared store, for binding into the memory tools.
    pub fn store(&self) -> Arc<Mutex<MemoryStore>> {
        Arc::clone(&self.store)
    }

    /// The caps this run enforces.
    pub fn caps(&self) -> MemoryCaps {
        self.store.lock().expect("memory store lock").caps()
    }

    /// The number of in-play memories — reported as the memories figure of a
    /// [compaction](https://docs.testcabinet.ai/gg/compaction/) boundary's retention proof.
    /// Zero when the capability is off (the store is empty).
    pub fn count(&self) -> usize {
        self.store.lock().expect("memory store lock").count()
    }

    /// The [`MemoryState`](GgTelemetryKind::MemoryState) telemetry for the current store,
    /// or `None` when the capability is off. Emitted at session start (empty, with the
    /// caps) and after every successful mutation.
    pub fn state_event(&self) -> Option<GgTelemetryKind> {
        if !self.enabled {
            return None;
        }
        Some(self.store.lock().expect("memory store lock").state_event())
    }

    /// The pinned context block rendering the current memories, or `None` when the
    /// capability is off or there are no memories. The loop keeps this as the single
    /// [`Memory`](test_cabinet_core::gg::GgContextSource::Memory)-sourced item in the
    /// window.
    pub fn context_block(&self) -> Option<Message> {
        if !self.enabled {
            return None;
        }
        self.store
            .lock()
            .expect("memory store lock")
            .context_block()
    }
}

#[cfg(test)]
#[path = "memories.test.rs"]
mod tests;
