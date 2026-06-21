//! Your Foray controller.
//!
//! Each tick the harness hands you a [`World`] observation for your colony and
//! applies the [`Action`] you return. You write the body of [`decide`]; the
//! `controller!` macro at the bottom wires it to the wasm contract entry the host
//! invokes. Read `specs/contract.md` for the ABI and the legality rules,
//! `specs/rules.md` for the game, and `specs/baselines.md` for the opponents you
//! must beat.
//!
//! This starter builds and runs as-is, but it is the FLOOR, not a strategy: it
//! drives every agent on a uniformly random legal step and ignores seeds, defence,
//! carry weight, and royal jelly entirely. It will lose. Replace it.
//!
//! You have the SDK's maze helpers available — [`Grid`] (a passability grid and a
//! BFS over the board) and the [`act`]/`util` selectors — so you can pathfind and
//! assemble a legal action without re-deriving any plumbing. The vendored
//! reference controllers under `references/` are worked examples of using them.

use foray_controller_sdk::controller;
use foray_controller_sdk::grid::Grid;
use foray_controller_sdk::util::act;
use foray_core::{Action, Dir, World};

/// Choose this colony's move for every owned agent this tick.
///
/// Replace this body with your strategy. The contract you must keep: return
/// exactly one move per owned agent (the [`act`] helper does this for you by
/// iterating `world.my_agents`). A move into a wall, off the board, or for an
/// agent stalled by carry weight is clamped to `Stop` — it does not forfeit — but
/// naming an agent you do not own, omitting one, or returning malformed output
/// does. See `specs/contract.md`.
fn decide(world: &World) -> Action {
    let grid = Grid::from_world(world);
    act(world, |agent| {
        // Floor behaviour: a random legal step. This is the starting point to
        // delete, not a pattern to extend — a real controller decides per agent
        // who raids, who defends, when to bank a load, and when to spend jelly.
        let choices = grid.legal_dirs(agent.x, agent.y);
        if choices.is_empty() {
            Dir::Stop
        } else {
            // A trivial, deterministic pick so the starter has no randomness to
            // seed; swap in your own logic.
            choices[(world.tick as usize + agent.id as usize) % choices.len()]
        }
    })
}

controller!(decide);
