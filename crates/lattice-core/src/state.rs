//! The `state` output: the canonical factory state at one snapshot tick, the
//! canonical byte serialization of it, and the FNV-1a checksum over those bytes.
//!
//! Two layers live here, and keeping them separate is the whole determinism
//! story:
//!
//! - The **JSON `Snapshot`** (these serde types) is the human-readable wire form
//!   — what crosses the wasm boundary and what a reviewer diffs on a mismatch.
//!   Its `checksum` field is the comparison key.
//! - The **canonical bytes** ([`canonical_bytes`]) are a fixed-width,
//!   little-endian, item-index-encoded serialization that is independent of JSON
//!   formatting and of the implementation language. The checksum is computed over
//!   *these bytes*, never the JSON text, so two faithful engines emit
//!   byte-identical buffers and therefore identical checksums regardless of how
//!   they format their JSON.
//!
//! The byte layout is specified verbatim in `specs/canonical-state.md`; this
//! module is its authoritative implementation.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::checksum;
use crate::prototypes::item_index;

/// One item on a belt lane, as the JSON output spells it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct BeltItem {
    /// Position in units from the lane's output end (`0..TILE`).
    pub pos: u32,
    /// The item id.
    pub item: String,
}

/// One belt's two lanes, each listing its items from the output end backward
/// (ascending `pos`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct BeltState {
    /// The left lane (relative to the belt's direction of travel).
    pub left: Vec<BeltItem>,
    /// The right lane.
    pub right: Vec<BeltItem>,
}

/// A splitter's retained state. A base splitter holds **no items between ticks**
/// (it transfers within the tick it pulls), so only the two round-robin cursors
/// are retained.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct SplitterState {
    /// Which input the splitter pulls from next (`0` or `1`).
    pub rr_in: u8,
    /// Which of the four output lanes the splitter pushes to next, in `0..4`,
    /// grouped by belt: `belt = rr_out >> 1`, `lane = rr_out & 1` (`0` = left,
    /// `1` = right).
    pub rr_out: u8,
}

/// An inserter's swing-arm phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum InserterPhase {
    /// Empty-handed, waiting to pick up.
    Idle,
    /// Holding an item, counting the swing down.
    Swing,
}

/// An inserter's retained state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct InserterState {
    /// `idle` or `swing`.
    pub phase: InserterPhase,
    /// The held item, present only while swinging.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub held: Option<String>,
    /// Ticks remaining in the current swing (`0` while idle).
    pub swing_left: u16,
}

/// An assembler's retained state. Buffers are item-id → count maps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct AssemblerState {
    /// The input buffer: item id → count (empty map when nothing buffered).
    pub inputs: BTreeMap<String, u16>,
    /// The output buffer: item id → count.
    pub output: BTreeMap<String, u16>,
    /// Ticks remaining in the current craft (`0` when not crafting).
    pub craft_left: u16,
}

/// A sink's retained state: per-item running consumed counts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct SinkState {
    /// Item id → total consumed.
    pub consumed: BTreeMap<String, u64>,
}

/// One entity's state, externally tagged so the array stays parallel to the
/// scenario's `entities` (`{ "belt": {...} }`, `{ "sink": {...} }`, …).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum EntityState {
    Belt(BeltState),
    Splitter(SplitterState),
    Inserter(InserterState),
    Assembler(AssemblerState),
    /// A source holds no item state at rest; `emit_phase` is `tick % period`, so
    /// a mid-period snapshot is self-describing.
    Source {
        emit_phase: u32,
    },
    Sink(SinkState),
}

impl EntityState {
    /// The canonical 1-byte kind tag for this entity in the byte stream:
    /// `belt=0, splitter=1, inserter=2, assembler=3, source=4, sink=5`.
    fn kind_tag(&self) -> u8 {
        match self {
            EntityState::Belt(_) => 0,
            EntityState::Splitter(_) => 1,
            EntityState::Inserter(_) => 2,
            EntityState::Assembler(_) => 3,
            EntityState::Source { .. } => 4,
            EntityState::Sink(_) => 5,
        }
    }
}

/// The complete canonical state at one snapshot tick.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct Snapshot {
    /// The tick this snapshot was taken at.
    pub tick: u64,
    /// The FNV-1a checksum over the [canonical bytes](canonical_bytes) of this
    /// snapshot, formatted `fnv1a64:%016x`. This is the validator's comparison
    /// key.
    pub checksum: String,
    /// The per-entity state, in scenario placement order.
    pub entities: Vec<EntityState>,
}

impl Snapshot {
    /// Build a snapshot for `tick` from the per-entity states, computing the
    /// canonical checksum over the canonical bytes. Every engine that produces an
    /// identical entity list at an identical tick gets an identical checksum.
    pub fn new(tick: u64, entities: Vec<EntityState>) -> Snapshot {
        let bytes = canonical_bytes(tick, &entities);
        Snapshot {
            tick,
            checksum: checksum::checksum_string(&bytes),
            entities,
        }
    }
}

/// Push a little-endian `u16` of an item id's stable index. Panics only if the id
/// is not a known item, which cannot happen for state the engine itself produced
/// (it never invents an item id).
fn push_item(out: &mut Vec<u8>, id: &str) {
    let index = item_index(id).expect("state only ever holds known item ids");
    out.extend_from_slice(&index.to_le_bytes());
}

/// Serialize a sorted (item-id-ascending) `item → count` map of `u16` counts.
fn push_u16_map(out: &mut Vec<u8>, map: &BTreeMap<String, u16>) {
    // Sort by the canonical item index, not by the string key, so the byte order
    // is the contract's "sorted by item index ascending".
    let mut entries: Vec<(u16, u16)> = map
        .iter()
        .map(|(k, v)| (item_index(k).expect("known item id"), *v))
        .collect();
    entries.sort_by_key(|(idx, _)| *idx);
    out.push(entries.len() as u8);
    for (idx, count) in entries {
        out.extend_from_slice(&idx.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
    }
}

/// Serialize a sorted (item-id-ascending) `item → count` map of `u64` counts (a
/// sink's totals).
fn push_u64_map(out: &mut Vec<u8>, map: &BTreeMap<String, u64>) {
    let mut entries: Vec<(u16, u64)> = map
        .iter()
        .map(|(k, v)| (item_index(k).expect("known item id"), *v))
        .collect();
    entries.sort_by_key(|(idx, _)| *idx);
    out.push(entries.len() as u8);
    for (idx, count) in entries {
        out.extend_from_slice(&idx.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
    }
}

/// One belt lane's items as the canonical bytes: a `u32` count then each item's
/// `{ pos: u32, item: u16 }`, from the output end backward (ascending `pos`).
fn push_lane(out: &mut Vec<u8>, lane: &[BeltItem]) {
    out.extend_from_slice(&(lane.len() as u32).to_le_bytes());
    for item in lane {
        out.extend_from_slice(&item.pos.to_le_bytes());
        push_item(out, &item.item);
    }
}

/// The canonical byte serialization of a snapshot. All multi-byte integers are
/// little-endian and fixed-width; item ids are encoded as their `u16` stable
/// index. The layout is, in order:
///
/// 1. `tick: u64`
/// 2. `entity_count: u32`
/// 3. for each entity in placement order: a 1-byte `kind` tag then its body (see
///    [`EntityState`] and the per-kind helpers above).
///
/// This is the exact buffer the checksum is taken over.
pub fn canonical_bytes(tick: u64, entities: &[EntityState]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&tick.to_le_bytes());
    out.extend_from_slice(&(entities.len() as u32).to_le_bytes());
    for entity in entities {
        out.push(entity.kind_tag());
        match entity {
            EntityState::Belt(belt) => {
                push_lane(&mut out, &belt.left);
                push_lane(&mut out, &belt.right);
            }
            EntityState::Splitter(splitter) => {
                out.push(splitter.rr_in);
                out.push(splitter.rr_out);
            }
            EntityState::Inserter(inserter) => {
                let phase = match inserter.phase {
                    InserterPhase::Idle => 0u8,
                    InserterPhase::Swing => 1,
                };
                out.push(phase);
                match &inserter.held {
                    Some(id) => {
                        out.push(1);
                        push_item(&mut out, id);
                    }
                    None => out.push(0),
                }
                out.extend_from_slice(&inserter.swing_left.to_le_bytes());
            }
            EntityState::Assembler(assembler) => {
                push_u16_map(&mut out, &assembler.inputs);
                push_u16_map(&mut out, &assembler.output);
                out.extend_from_slice(&assembler.craft_left.to_le_bytes());
            }
            EntityState::Source { emit_phase } => {
                out.extend_from_slice(&emit_phase.to_le_bytes());
            }
            EntityState::Sink(sink) => {
                push_u64_map(&mut out, &sink.consumed);
            }
        }
    }
    out
}

/// The JSON Schemas the manifest seeds verbatim, generated from the very types
/// the engine (de)serializes so they cannot drift.
#[cfg(feature = "schema")]
pub fn state_schema() -> serde_json::Value {
    let schema = schemars::schema_for!(Vec<Snapshot>);
    serde_json::to_value(schema).expect("the state schema serializes")
}

/// The state schema as the canonical pretty-printed string seeded into the case.
#[cfg(feature = "schema")]
pub fn state_schema_string() -> String {
    let mut text =
        serde_json::to_string_pretty(&state_schema()).expect("the state schema serializes");
    text.push('\n');
    text
}

#[cfg(test)]
#[path = "state.test.rs"]
mod tests;
