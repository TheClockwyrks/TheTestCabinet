//! `naive` — the obvious engine, and the honest floor of the performance case.
//!
//! It does exactly what the [architecture
//! doc](../../../apps/docs/src/content/docs/testing/performance/lattice/architecture.md)
//! describes a naive engine doing: simulate the whole scenario one tick at a time
//! from an empty start, and at each tick *move every item on every belt one step*,
//! advancing every machine. That is `O(ticks x items)` work — and on a large
//! factory run for hundreds of thousands of ticks the overwhelming majority of it
//! is spent re-walking long runs of already-compressed belt that did not change.
//!
//! That re-walking is the whole cost the [`transport`](../../../crates/lattice-ref-transport)
//! engine avoids by storing the gaps between items rather than their absolute
//! positions and flowing a compressed line in constant time. Both engines produce
//! the **identical** canonical checksums — they are both correct — but the naive
//! one pays for every interior item every tick. That fuel gap is the entire point
//! of the case, so this baseline embodies the slow-but-correct approach rather
//! than hedging toward the fast one.
//!
//! ## Why this delegates to `lattice_core::Engine`
//!
//! The naive strategy *is* the move-every-item loop — and that loop is exactly
//! what [`lattice_core`]'s reference world already implements: its
//! [`World::advance`](lattice_core::World) compacts every belt lane item-by-item
//! every tick and walks the explicit per-item lists with no gap compression. So
//! running `lattice_core::Engine` here is not a shortcut around the naive cost;
//! it *is* the naive cost, executed inside the guest sandbox where the fuel meter
//! charges for every one of those per-item steps. Reproducing that loop by hand
//! would only risk drifting from the authoritative rules while doing the same
//! `O(ticks x items)` work — the faithful naive baseline is to run it.

use lattice_sdk::{Scenario, Snapshot, simulate};

/// Run the whole scenario the naive way: advance the world one tick at a time over
/// the explicit per-item belt lists, emitting the canonical snapshot at each
/// scheduled tick. This is the `O(ticks x items)` floor — correct, and
/// deliberately unoptimized.
fn run(scenario: &Scenario) -> Vec<Snapshot> {
    lattice_core::Engine::solve(scenario)
}

simulate!(run);
