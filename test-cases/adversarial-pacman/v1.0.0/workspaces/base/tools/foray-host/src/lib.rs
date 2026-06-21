//! The native wasm host for the **Foray** adversarial test case (on-disk slug
//! `adversarial-pacman`).
//!
//! This crate loads two competing controller wasm modules, drives a single match
//! through [`foray-core`](foray_core)'s authoritative rules, meters each per-tick
//! controller invocation against a wasmtime fuel ceiling and a linear-memory cap,
//! and returns the published [`Replay`](foray_core::replay::Replay).
//!
//! ## Why this lives here, not in the CLI or in core
//!
//! The host is factored into its own crate so it has exactly one implementation
//! (lead decision 7):
//!
//! - The [`foray` CLI](../../../crates/foray-cli) is a thin clap wrapper that
//!   reads files, builds a [`Match`](foray_core::engine::Match), and calls
//!   [`run_match`].
//! - The core `AdversarialValidator` (a later phase) depends on this crate to
//!   score a submission, rather than re-implementing the host.
//!
//! `foray-core` must stay wasm-compilable for browser playback, so the wasmtime
//! dependency lives **here** and never in core. This crate marshals JSON across
//! the wasm boundary and hands actions to the engine; it owns **no** game rule.
//!
//! ## The match it runs
//!
//! [`run_match`] runs the single canonical match the validator scores (lead
//! decision 4): the submission as one team, the case's committed baseline
//! opponent as the other, on the case's map and seed. The per-tick loop, the
//! controller ABI, and the sandbox enforcement live in [`match_runner`] and
//! [`controller`].

mod controller;
mod match_runner;

pub use controller::{Controller, InvokeError, LoadError};
pub use match_runner::ForfeitReason;

use foray_core::board::{Board, BoardParams};
use foray_core::config::{BoardParamsSerde, Rules, Simulation};
use foray_core::engine::Match;
use foray_core::replay::Replay;

/// The per-controller, per-tick sandbox limits from the manifest's `[sandbox]`
/// table. Applied to **every** invocation of **every** controller.
#[derive(Debug, Clone, Copy)]
pub struct SandboxLimits {
    /// The wasmtime fuel ceiling for a single tick. Refilled to this value before
    /// each invocation, so it bounds the work of one tick without banking unused
    /// fuel into later ticks.
    pub fuel_per_tick: u64,
    /// The linear-memory cap in bytes. A `memory.grow` that would exceed it is
    /// denied, forfeiting the invocation.
    pub max_memory_bytes: usize,
}

impl Default for SandboxLimits {
    /// The manifest's documented defaults (5,000,000 fuel; 64 MiB).
    fn default() -> SandboxLimits {
        SandboxLimits {
            fuel_per_tick: 5_000_000,
            max_memory_bytes: 64 * 1024 * 1024,
        }
    }
}

/// Everything a match needs that is fixed for its whole run: the controller
/// contract entry name, the sandbox limits, the rules/loop config, and the
/// identity recorded in the replay header (map id, seed, participant ids, board
/// params). The [`Match`] itself (board + live state) is passed separately so a
/// caller can build it however it likes (generate or load a map TOML).
#[derive(Debug, Clone)]
pub struct MatchSetup {
    /// The contract entry the controller exports (the manifest's `[contract] entry`,
    /// `tick` for Foray).
    pub entry: String,
    /// The per-tick sandbox limits.
    pub limits: SandboxLimits,
    /// The map id recorded in the replay (e.g. `"mirror-32x16"`).
    pub map_id: String,
    /// The seed the maze was generated from, recorded so a reconstructor
    /// regenerates the identical board.
    pub seed: u64,
    /// The board-generation parameters, recorded for the same reason.
    pub board_params: BoardParamsSerde,
    /// The model/controller id playing Red (site-facing provenance).
    pub red_id: String,
    /// The model/controller id playing Blue.
    pub blue_id: String,
    /// The rule constants the match runs under.
    pub rules: Rules,
    /// The simulation loop config (timestep, max_ticks).
    pub sim: Simulation,
}

/// The outcome of running a match: the published, browser-playable replay. The
/// committed result inside the replay carries the winner, score, `ended`, and tick
/// count — everything a caller needs to score the run.
#[derive(Debug, Clone)]
pub struct MatchSummary {
    /// The recorded replay, ready to write to `replay.json` and play back.
    pub replay: Replay,
}

/// Run the single canonical match between two controller modules and return its
/// replay. This is the reusable entry both the CLI and the validator call.
///
/// `red_wasm`/`blue_wasm` are the controller module bytes (Red is conventionally
/// the submission, Blue the baseline). `board` is the maze the match runs on — the
/// CLI loads the committed map TOML, but a caller may also generate it; `setup`
/// carries the seed/params that *regenerate* the same board for reconstruction, so
/// `board` and `setup` must describe the same maze.
///
/// A controller that fails to load (does not compile, cannot instantiate, or is
/// missing a contract export) is a build/legality failure, surfaced as a
/// [`RunError`] — the match never starts. A controller that breaks the rules
/// *during* the match (traps, runs out of fuel/memory, or returns a
/// contract-invalid action) **forfeits**, and the returned replay records the
/// forfeit outcome — a match always produces a replay once both controllers load.
pub fn run_match(
    red_wasm: &[u8],
    blue_wasm: &[u8],
    board: Board,
    setup: &MatchSetup,
) -> Result<MatchSummary, RunError> {
    let game = Match::new(board, setup.rules, setup.sim);
    match_runner::run_with_modules(red_wasm, blue_wasm, game, setup)
}

/// Generate the canonical board for `setup` from its seed and board params — the
/// convenience a caller without a map file uses (e.g. a test, or a validator that
/// regenerates rather than ships the TOML).
pub fn board_for(setup: &MatchSetup) -> Board {
    let params: BoardParams = setup.board_params.into();
    Board::generate(setup.map_id.clone(), params, setup.seed)
}

/// Why a match could not be *run*. These are failures that prevent a match from
/// starting at all — distinct from an in-match forfeit, which produces a valid
/// replay rather than an error.
#[derive(Debug, thiserror::Error)]
pub enum RunError {
    /// The wasm engine could not be configured (e.g. fuel metering unavailable in
    /// this build of wasmtime).
    #[error("failed to build the wasm engine: {0}")]
    Engine(String),
    /// Red's controller module failed to load.
    #[error("red controller failed to load: {0}")]
    LoadRed(#[source] LoadError),
    /// Blue's controller module failed to load.
    #[error("blue controller failed to load: {0}")]
    LoadBlue(#[source] LoadError),
}
