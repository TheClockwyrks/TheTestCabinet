//! The authoritative game engine for **Foray** (on-disk slug
//! `adversarial-pacman`), the first adversarial test case.
//!
//! This crate is the single source of truth for the game's rules, world state,
//! scoring, and replay handling. It compiles two ways from one implementation —
//! natively, for the [`foray` CLI](../../../crates/foray-cli) that produces a
//! match, and to `wasm32-unknown-unknown`, for the browser that plays it back —
//! so a replay can never drift from the rules that generated it. It has **no I/O**
//! and **no wasm-host dependency**: the wasm host (wasmtime) lives entirely in
//! `foray-cli`, and the browser boundary is the hand-rolled C ABI in [`abi`].
//!
//! The authoritative narrative lives in the design docs:
//! `apps/docs/src/content/docs/testing/adversarial/` (the test-type framing) and
//! `.../adversarial-pacman/` (Foray's rules, architecture, and replay format).
//!
//! ## Map of the crate
//!
//! - [`board`] — the static, mirror-symmetric maze: tiles, walls, the border
//!   column, nests, and the *initial* seed/jelly placements. Includes the
//!   deterministic [`Board::generate`](board::Board::generate) generator and (with
//!   the `map-toml` feature) the TOML map loader.
//! - [`state`] — the live [`MatchState`](state::MatchState): agents, live caches,
//!   active jelly, score, and the decided result. Role is *derived* from position.
//! - [`config`] — the tunable [`Rules`](config::Rules) (carry weight, jelly) and
//!   [`Simulation`](config::Simulation) (timestep, `max_ticks`) constants.
//! - [`contract`] — the controller-facing [`World`](contract::World) observation
//!   and [`Action`](contract::Action) output, plus their JSON Schemas. The only
//!   channel between a controller and the game.
//! - [`tick`] — the one-tick advance: movement → eating → tagging → banking →
//!   jelly, in that exact order.
//! - [`engine`] — the [`Match`](engine::Match) driver used by both the native
//!   host and the browser reconstruction.
//! - [`replay`] — the [`Replay`](replay::Replay) format and the reconstruction
//!   that re-runs the recorded inputs bit-for-bit.
//! - [`abi`] — the wasm-only browser playback ABI (`wasm32` targets with the
//!   `playback` feature; an rlib consumer such as a controller leaves it off so it
//!   does not inherit the exported `alloc`/`replay_*` symbols).

pub mod board;
pub mod config;
pub mod contract;
pub mod engine;
pub mod replay;
pub mod rng;
pub mod state;
pub mod tick;

// The browser playback ABI. Gated on both the `wasm32` target *and* the
// `playback` feature: the feature lets `foray-core` be linked as a plain `rlib`
// into another wasm crate (the controller SDK and the reference controllers
// compile to `wasm32-unknown-unknown` and depend on this crate for the contract
// types) without that crate inheriting — and clashing on — this module's exported
// `alloc`/`replay_*` symbols. The browser cdylib build opts in with
// `--features playback`; an rlib consumer leaves it off.
#[cfg(all(target_arch = "wasm32", feature = "playback"))]
pub mod abi;

/// The shipped map's identity, shared by the artifact generator and the drift
/// test so the committed `maps/mirror-32x16.toml` is reproducible from one place.
pub mod map_artifacts {
    /// The shipped map id (and file stem under `maps/`).
    pub const MAP_ID: &str = "mirror-32x16";
    /// The fixed seed the shipped map is generated from.
    pub const MAP_SEED: u64 = 0x0F0_2A44;
}

// Re-export the most-used types at the crate root for ergonomic callers (the CLI,
// the controller SDK, the reference controllers).
pub use board::{Board, BoardParams, Pos, Team};
pub use config::{Rules, Simulation};
pub use contract::{Action, Dir, Move, World};
pub use engine::{Match, StateSnapshot};
pub use replay::{Replay, ReplayError, TickInput};
pub use state::{Agent, Ended, Kills, MatchResult, MatchState, Role, Score};

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
