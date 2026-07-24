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
/// (it transfers within the tick it pulls), so only its two cursors are retained:
/// the per-lane, item-agnostic output-preference bitfield ([`SplitterState::out_pref`])
/// and the input-order cursor ([`SplitterState::in_first`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct SplitterState {
    /// The per-lane, **item-agnostic** output alternation cursor: bit `L` is the output
    /// belt (`0`/`1`) the next item on lane `L` (`0` = left, `1` = right) will be sent to,
    /// whatever the item's type (it flips after each item). Only the two low bits are
    /// used. Each lane's cursor is independent; the input lane itself is preserved.
    pub out_pref: u16,
    /// Which input belt (`0`/`1`) the splitter tries first this tick (flips each tick
    /// for input fairness).
    pub in_first: u8,
}

/// An inserter's swing-arm phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum InserterPhase {
    /// Empty-handed and back at the pickup, ready to grab.
    Idle,
    /// Holding an item, counting the forward swing down.
    Swing,
    /// Empty-handed, swinging back to the pickup after a drop (counting the return
    /// down). The arm cannot grab again until the return completes, so the empty
    /// return takes the same time as the loaded swing rather than being instant.
    Return,
}

/// An inserter's retained state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct InserterState {
    /// `idle`, `swing` (loaded, going out), or `return` (empty, coming back).
    pub phase: InserterPhase,
    /// The held item, present only while swinging out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub held: Option<String>,
    /// Ticks remaining in the current motion — the forward swing while `swing`, the
    /// empty return while `return`, and `0` while `idle`.
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

/// A furnace's retained state — the same shape as an assembler's (input and output
/// buffers and a craft countdown), kept as its own type so the two machines stay
/// distinct in the canonical output and the renderer can tell a smelter from an
/// assembler. `craft_left > 0` means the furnace is actively smelting this tick.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct FurnaceState {
    /// The input buffer: item id → count (ore and coal, empty when nothing buffered).
    pub inputs: BTreeMap<String, u16>,
    /// The output buffer: item id → count (the smelted plate).
    pub output: BTreeMap<String, u16>,
    /// Ticks remaining in the current smelt (`0` when not smelting).
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
    Furnace(FurnaceState),
}

impl EntityState {
    /// The canonical 1-byte kind tag for this entity in the byte stream:
    /// `belt=0, splitter=1, inserter=2, assembler=3, source=4, sink=5, furnace=6`.
    /// The furnace was added after the original six, so it takes the next tag (6);
    /// the existing tags are never renumbered, which keeps every furnace-free
    /// scenario's bytes — and therefore its checksum — identical.
    fn kind_tag(&self) -> u8 {
        match self {
            EntityState::Belt(_) => 0,
            EntityState::Splitter(_) => 1,
            EntityState::Inserter(_) => 2,
            EntityState::Assembler(_) => 3,
            EntityState::Source { .. } => 4,
            EntityState::Sink(_) => 5,
            EntityState::Furnace(_) => 6,
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

    /// The checksum this snapshot's **own** `tick` and `entities` canonically hash
    /// to — recomputed here rather than read off [`Snapshot::checksum`].
    ///
    /// [`Snapshot::checksum`] is a plain field, so on a snapshot that was
    /// *deserialized* (rather than built by [`Snapshot::new`]) it is only a claim:
    /// nothing in the JSON ties it to the `entities` alongside it. A submission's
    /// returned state is exactly that case, and a claim is not a simulation — an
    /// engine whose checksums are the oracle's while its entities are something
    /// else would grade as correct and then draw a factory it never computed in
    /// browser playback. The host compares this derived value, not the claim, so
    /// the graded key is the state itself.
    ///
    /// Returns [`UnknownItem`] if the state names an item the prototype table does
    /// not define — a submission can, so that is a wrong answer rather than a panic.
    pub fn derived_checksum(&self) -> Result<String, UnknownItem> {
        Ok(checksum::checksum_string(&canonical_bytes_checked(
            self.tick,
            &self.entities,
        )?))
    }
}

/// A state carried an item id the [prototype table](crate::prototypes) does not
/// define, so it has no canonical `u16` index and cannot be serialized.
///
/// Unreachable for state the engine itself produced (it never invents an item id),
/// which is why [`canonical_bytes`] panics on it. It IS reachable for state that
/// arrived from *outside* — a submission's returned snapshots — so the checked
/// entry points ([`canonical_bytes_checked`], [`Snapshot::derived_checksum`])
/// report it instead of taking the host down with a panic.
/// Implemented by hand rather than derived: this crate is linked into every
/// submission's wasm guest, so it carries no proc-macro dependencies it can avoid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownItem(pub String);

impl std::fmt::Display for UnknownItem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown item id `{}`", self.0)
    }
}

impl std::error::Error for UnknownItem {}

/// The stable `u16` index of an item id, or [`UnknownItem`] if the prototype table
/// does not define it.
fn index_of(id: &str) -> Result<u16, UnknownItem> {
    item_index(id).ok_or_else(|| UnknownItem(id.to_string()))
}

/// Push a little-endian `u16` of an item id's stable index.
fn push_item(out: &mut Vec<u8>, id: &str) -> Result<(), UnknownItem> {
    out.extend_from_slice(&index_of(id)?.to_le_bytes());
    Ok(())
}

/// Serialize a sorted (item-id-ascending) `item → count` map of `u16` counts.
fn push_u16_map(out: &mut Vec<u8>, map: &BTreeMap<String, u16>) -> Result<(), UnknownItem> {
    // Sort by the canonical item index, not by the string key, so the byte order
    // is the contract's "sorted by item index ascending".
    let mut entries: Vec<(u16, u16)> = map
        .iter()
        .map(|(k, v)| Ok((index_of(k)?, *v)))
        .collect::<Result<_, UnknownItem>>()?;
    entries.sort_by_key(|(idx, _)| *idx);
    out.push(entries.len() as u8);
    for (idx, count) in entries {
        out.extend_from_slice(&idx.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
    }
    Ok(())
}

/// Serialize a sorted (item-id-ascending) `item → count` map of `u64` counts (a
/// sink's totals).
fn push_u64_map(out: &mut Vec<u8>, map: &BTreeMap<String, u64>) -> Result<(), UnknownItem> {
    let mut entries: Vec<(u16, u64)> = map
        .iter()
        .map(|(k, v)| Ok((index_of(k)?, *v)))
        .collect::<Result<_, UnknownItem>>()?;
    entries.sort_by_key(|(idx, _)| *idx);
    out.push(entries.len() as u8);
    for (idx, count) in entries {
        out.extend_from_slice(&idx.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
    }
    Ok(())
}

/// One belt lane's items as the canonical bytes: a `u32` count then each item's
/// `{ pos: u32, item: u16 }`, from the output end backward (ascending `pos`).
fn push_lane(out: &mut Vec<u8>, lane: &[BeltItem]) -> Result<(), UnknownItem> {
    out.extend_from_slice(&(lane.len() as u32).to_le_bytes());
    for item in lane {
        out.extend_from_slice(&item.pos.to_le_bytes());
        push_item(out, &item.item)?;
    }
    Ok(())
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
///
/// # Panics
/// If any entity holds an item id the prototype table does not define. That cannot
/// happen for state the engine produced; for state that arrived from outside the
/// engine — a submission's returned snapshots — use [`canonical_bytes_checked`],
/// which reports it as [`UnknownItem`] instead.
pub fn canonical_bytes(tick: u64, entities: &[EntityState]) -> Vec<u8> {
    canonical_bytes_checked(tick, entities).expect("state only ever holds known item ids")
}

/// [`canonical_bytes`] for state of untrusted provenance: identical bytes, but an
/// unknown item id is returned as [`UnknownItem`] rather than panicking.
///
/// The host serializes a *submission's* snapshots with this to re-derive their
/// checksums, and a submission is arbitrary code that may emit any item string at
/// all — a panic there would abort the grader rather than fail the submission.
pub fn canonical_bytes_checked(
    tick: u64,
    entities: &[EntityState],
) -> Result<Vec<u8>, UnknownItem> {
    let mut out = Vec::new();
    out.extend_from_slice(&tick.to_le_bytes());
    out.extend_from_slice(&(entities.len() as u32).to_le_bytes());
    for entity in entities {
        out.push(entity.kind_tag());
        match entity {
            EntityState::Belt(belt) => {
                push_lane(&mut out, &belt.left)?;
                push_lane(&mut out, &belt.right)?;
            }
            EntityState::Splitter(splitter) => {
                out.extend_from_slice(&splitter.out_pref.to_le_bytes());
                out.push(splitter.in_first);
            }
            EntityState::Inserter(inserter) => {
                let phase = match inserter.phase {
                    InserterPhase::Idle => 0u8,
                    InserterPhase::Swing => 1,
                    InserterPhase::Return => 2,
                };
                out.push(phase);
                match &inserter.held {
                    Some(id) => {
                        out.push(1);
                        push_item(&mut out, id)?;
                    }
                    None => out.push(0),
                }
                out.extend_from_slice(&inserter.swing_left.to_le_bytes());
            }
            EntityState::Assembler(assembler) => {
                push_u16_map(&mut out, &assembler.inputs)?;
                push_u16_map(&mut out, &assembler.output)?;
                out.extend_from_slice(&assembler.craft_left.to_le_bytes());
            }
            EntityState::Source { emit_phase } => {
                out.extend_from_slice(&emit_phase.to_le_bytes());
            }
            EntityState::Sink(sink) => {
                push_u64_map(&mut out, &sink.consumed)?;
            }
            EntityState::Furnace(furnace) => {
                // Same body layout as the assembler (input map, output map,
                // craft_left) — only the kind tag distinguishes the two.
                push_u16_map(&mut out, &furnace.inputs)?;
                push_u16_map(&mut out, &furnace.output)?;
                out.extend_from_slice(&furnace.craft_left.to_le_bytes());
            }
        }
    }
    Ok(out)
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
