//! The reference engine driver — the **oracle**.
//!
//! [`Engine`] owns a live [`World`](crate::world) built from a scenario and runs
//! it forward to each scheduled snapshot tick, emitting the canonical
//! [`Snapshot`] at each. This is the single
//! authoritative implementation that defines *the answer*: the native `lattice`
//! CLI uses it to produce expected outputs, and a submission is correct iff it
//! reproduces these snapshots' checksums.
//!
//! It is written for clarity, not minimal fuel — advancing the world one tick at
//! a time over the explicit item lists. A faithful but efficient submission lands
//! on the identical snapshots for a fraction of the work; that gap is the whole
//! point of the case.

use crate::scenario::Scenario;
use crate::state::Snapshot;
use crate::world::World;

/// A scenario loaded into a runnable engine.
#[derive(Debug, Clone)]
pub struct Engine {
    world: World,
    /// The snapshot schedule (ascending), copied from the scenario.
    snapshots: Vec<u64>,
    /// The total tick count to simulate.
    ticks: u64,
}

impl Engine {
    /// Build the engine from a validated scenario.
    pub fn new(scenario: &Scenario) -> Engine {
        Engine {
            world: World::new(scenario),
            snapshots: scenario.snapshots.clone(),
            ticks: scenario.ticks,
        }
    }

    /// Run the whole scenario, returning one canonical [`Snapshot`] per scheduled
    /// snapshot tick in schedule order. This advances the world tick by tick and
    /// captures the state at each snapshot; the final tick is bounded by the
    /// scenario's `ticks`.
    pub fn run(&mut self) -> Vec<Snapshot> {
        let mut out = Vec::with_capacity(self.snapshots.len());
        let mut next = 0usize;
        while self.world.tick < self.ticks && next < self.snapshots.len() {
            self.world.advance();
            while next < self.snapshots.len() && self.snapshots[next] == self.world.tick {
                out.push(self.world.snapshot());
                next += 1;
            }
        }
        out
    }

    /// Run a scenario end to end in one call — the entry the CLI and host drive.
    pub fn solve(scenario: &Scenario) -> Vec<Snapshot> {
        Engine::new(scenario).run()
    }

    /// The live world, for tests that inspect intermediate state.
    pub fn world(&self) -> &World {
        &self.world
    }

    /// Mutable access to the live world, for tests that lay items by hand.
    pub fn world_mut(&mut self) -> &mut World {
        &mut self.world
    }
}

#[cfg(test)]
#[path = "engine.test.rs"]
mod tests;
