//! `random` — the floor reference controller.
//!
//! Each tick, for every owned agent, it picks a **uniformly random legal move**
//! (one of the cardinal directions whose target tile is passable, or `Stop`) and
//! falls back to `Stop` when an agent is boxed in. It does not seek seeds, defend,
//! or even prefer crossing the border — it is the absolute floor described in
//! references.md, and any serious controller should beat it overwhelmingly.
//!
//! The randomness is a hand-rolled [`SplitMix64`](foray_core::rng::SplitMix64) kept
//! in a module global. Because the host reuses one wasm instance for the whole
//! match (decision 2), that global persists across ticks, so the stream advances
//! over the match rather than resetting every tick — distinct draws each tick from
//! one seeded sequence, with no external `rand` dependency.

use foray_controller_sdk::controller;
use foray_controller_sdk::grid::Grid;
use foray_controller_sdk::util::act;
use foray_core::rng::SplitMix64;
use foray_core::{Action, Dir, World};

/// The match-long random stream. A fixed seed keeps a given match reproducible
/// while still spreading draws across agents and ticks.
///
/// Single-threaded wasm, so a plain `static mut` reached through a small unsafe
/// shim is adequate — there is no concurrency in the guest instance.
static mut RNG: SplitMix64 = SplitMix64::new(0x0F0_2A44);

/// Draw the next value from the match-long stream.
fn next_random(bound: usize) -> usize {
    // SAFETY: single-threaded wasm; `tick` is the only caller and runs to
    // completion before the host re-enters the instance.
    unsafe {
        let rng = &raw mut RNG;
        (*rng).below(bound)
    }
}

/// Pick a uniformly random legal direction for every owned agent.
fn decide(world: &World) -> Action {
    let grid = Grid::from_world(world);
    act(world, |agent| {
        // Every passable cardinal step plus `Stop`; an agent with no open
        // neighbour gets only `Stop`, which is the boxed-in fallback.
        let choices = grid.legal_dirs(agent.x, agent.y);
        if choices.is_empty() {
            Dir::Stop
        } else {
            choices[next_random(choices.len())]
        }
    })
}

controller!(decide);
