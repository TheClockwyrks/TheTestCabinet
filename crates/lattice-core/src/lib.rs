//! The authoritative simulation engine for **Lattice** (on-disk slug
//! `lattice`), the first [performance](../../../apps/docs/) test
//! case.
//!
//! This crate is the single source of truth for the simulation's rules,
//! prototype constants, world state, and the canonical state + checksum that make
//! "correct" a bit-exact notion. It is the **oracle**, not a worked solution: the
//! model is handed the documented rules and the `lattice` CLI (which embeds this
//! engine) and must *reimplement* the simulation, reproducing this crate's
//! outputs with as little fuel as possible.
//!
//! Like [`foray-core`](../../../crates/foray-core), it has **no I/O** and **no
//! wasm-host dependency** — pure rules plus data types — so the exact same crate
//! that defines the answer for the native CLI also compiles to
//! `wasm32-unknown-unknown`, which is what the console's browser visualization
//! instantiates and steps (see `playback`, feature `playback`). The wasm host
//! (wasmtime) lives in `lattice-host`, never here.
//!
//! The authoritative narrative lives in the design docs:
//! `apps/docs/src/content/docs/testing/performance/` (the test-type framing) and
//! `.../lattice/` (Lattice's rules, engine/contract, and reference
//! material).
//!
//! ## Map of the crate
//!
//! - [`prototypes`] — the fixed constants: `TILE`/`SPACING`, belt/inserter tiers,
//!   the item index table, the recipe table, and assembler buffer caps. Pure data
//!   plus lookups; the single source of truth shared with `specs/prototypes.md`.
//! - [`scenario`] — the [`Scenario`] input (blueprint, tick
//!   count, snapshot schedule), its serde/schemars derivations, and validation.
//! - [`state`] — the [`Snapshot`] output, the
//!   [canonical byte serialization](state::canonical_bytes), and the checksum
//!   computed over it.
//! - [`checksum`] — the FNV-1a 64-bit hash and the `fnv1a64:%016x` string format.
//! - [`world`] — the live, fixed-point world built from a scenario: belt lanes,
//!   items, and machine state.
//! - [`tick`] — the one-tick advance in the authoritative six-phase order.
//! - [`engine`] — the [`Engine`] driver: build from a scenario,
//!   run to each snapshot, emit canonical state. The oracle.
//! - [`schema`] — the JSON Schema accessors (feature `schema`).
//! - `playback` — the tick-at-a-time driver behind the console's browser
//!   visualization, and (on wasm32) the C ABI that exposes it (feature
//!   `playback`).

pub mod checksum;
pub mod engine;
pub mod prototypes;
pub mod scenario;
pub mod state;
pub mod tick;
pub mod world;

#[cfg(feature = "schema")]
pub mod schema;

#[cfg(feature = "playback")]
pub mod playback;

// The C ABI is wasm-only: it exports `extern "C"` symbols and holds a `static mut`
// that only makes sense in a single-threaded browser instance. Double-gated so a
// native build with `playback` on still compiles (and can test the driver), and so
// the SDK and reference engines — which also target wasm32 and link this crate —
// never pull the exports in.
#[cfg(all(target_arch = "wasm32", feature = "playback"))]
mod abi;

// Re-export the most-used types at the crate root for ergonomic callers (the CLI,
// the host, the SDK, the reference engines).
pub use checksum::{checksum_string, fnv1a64};
pub use engine::Engine;
pub use scenario::{Dir, Entity, Grid, Lane, SCENARIO_VERSION, Scenario, ScenarioError};
pub use state::{
    AssemblerState, BeltItem, BeltState, EntityState, InserterPhase, InserterState, SinkState,
    Snapshot, SplitterState, canonical_bytes,
};
pub use world::World;

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
