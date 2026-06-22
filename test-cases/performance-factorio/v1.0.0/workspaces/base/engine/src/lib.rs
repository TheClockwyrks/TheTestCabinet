//! Your Lattice engine.
//!
//! The harness hands you a whole [`Scenario`] (a static factory layout, a tick
//! count, and a snapshot schedule) and reads back the [`Snapshot`] state you
//! return at each scheduled tick. You write the body of [`run`]; the `simulate!`
//! macro at the bottom wires it to the wasm contract entry the host invokes once
//! per scenario. Read `specs/rules.md` for the simulation, `specs/prototypes.md`
//! for the constants, `specs/contract.md` for the ABI and the scoring, and
//! `specs/canonical-state.md` for the checksum your output is compared by.
//!
//! ## This is the FLOOR — replace it
//!
//! This starter builds and produces *correct* output as-is, but it is the floor,
//! not a solution: its `run` delegates to the buildkit's straightforward
//! reference simulation, which advances the world the obvious way — every tick,
//! visit every belt and move every item one step. That is `O(ticks × items)`
//! work, most of it spent re-confirming that long, already-compressed runs of
//! belt did not change. It is correct, so it passes the gate on the training
//! scenarios; it is slow, so it posts a high fuel number — and on a large enough
//! scenario it overruns the per-scenario fuel ceiling entirely and scores
//! nothing. **Fuel is what you are scored on once you are correct. Lower is
//! better.**
//!
//! Your job is to rewrite `run` as an efficient engine that produces the *same*
//! canonical state (the same checksums) for a fraction of the fuel. The decisive
//! move is the representation: store the **gaps between items** in each maximal
//! straight run of belt as a single transport line, advance a packed run in
//! constant time, cache where the last open gap is, and drive
//! inserters/assemblers/sources/sinks by event rather than polling. Same answer,
//! far less work — that is the whole case.
//!
//! Iterate with the preinstalled `lattice` CLI (see `specs/cli.md`): `lattice run
//! --module target/wasm32-unknown-unknown/release/engine.wasm --scenario <s>`
//! reports correct/incorrect and the fuel, using the same host the validator
//! uses, against the training scenarios under `$LATTICE_HOME/training/`.

use lattice_sdk::{Scenario, Snapshot, simulate};

/// Simulate the whole `scenario` and return the canonical state at each scheduled
/// snapshot tick, in `scenario.snapshots` order.
///
/// Replace this body with your own engine. The contract you must keep: return
/// exactly one [`Snapshot`] per entry in `scenario.snapshots`, in that order, with
/// each snapshot's entities in the scenario's placement order and the canonical
/// checksum set (build snapshots through `lattice_core`'s `Snapshot::new` and it is
/// computed for you). See `specs/contract.md` and `specs/canonical-state.md`.
fn run(scenario: &Scenario) -> Vec<Snapshot> {
    // FLOOR: hand the scenario to the buildkit's reference engine, which simulates
    // tick by tick and moves every item every tick. Correct, but the naive cost —
    // delete this and write a transport-line engine that lands the same snapshots
    // for far less fuel.
    lattice_core::Engine::solve(scenario)
}

simulate!(run);
