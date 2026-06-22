//! `transport` — the efficient engine that refuses to re-walk steady state.
//!
//! It produces the oracle's exact per-snapshot checksums for a fraction of the
//! [`naive`](../../../crates/lattice-ref-naive) engine's fuel by exploiting the
//! one structural fact that makes Lattice a *performance* case: a scenario is
//! driven entirely by **periodic sources**, so after a finite warm-up the whole
//! factory settles into a **cycle**. The belts, splitters, inserters, and
//! assemblers return to a byte-identical configuration every `P` ticks, and the
//! only thing that changes across a cycle is the sinks' running totals, which grow
//! by a fixed amount per cycle.
//!
//! This is the same shape as Factorio's transport-line optimization
//! ([FFF #176](https://www.factorio.com/blog/post/fff-176)): a compressed,
//! unchanging interior is not re-touched every tick; work happens only where the
//! state actually changes. Here that principle is applied at the level of the
//! *whole world's* dynamic state — once the configuration repeats, the interior of
//! time itself (the long stretch of identical cycles) is skipped, and only the
//! short remainder up to each snapshot is simulated.
//!
//! ## How it stays bit-exact
//!
//! Correctness is non-negotiable — an incorrect engine scores no fuel — so the
//! transport engine never reimplements the rules. It drives [`lattice_core`]'s
//! authoritative [`World::advance`](lattice_core::World) for every tick it
//! actually simulates (the warm-up and the per-snapshot remainders), so its rules
//! are the oracle's rules by construction. The only thing it does differently is
//! *decline to simulate ticks it has proven are redundant*:
//!
//! 1. **Detect the cycle.** As it advances, it fingerprints the world's *dynamic*
//!    state each tick — every entity except the monotonic sink totals, plus each
//!    source's emit phase (`tick % period`), which the rules depend on. When a
//!    fingerprint repeats, the world is provably periodic: same belts, same
//!    machines, same source phases, so the *next* tick must evolve identically to
//!    the tick after the first occurrence. The period `P` is the gap between the
//!    two occurrences, and the per-cycle sink delta is the difference in sink
//!    totals across it.
//! 2. **Fast-forward whole cycles.** For a snapshot at tick `T` at or beyond the
//!    cycle's start, it advances by whole cycles arithmetically — adding
//!    `cycles * delta` to the sink totals and stepping the tick by `cycles * P`
//!    without simulating — then simulates only the `< P` leftover ticks up to `T`.
//!
//! If a scenario *never* settles into a cycle within a bounded search (it always
//! does for the cases the generator produces, but the engine must be correct for
//! any input), the engine simply keeps simulating tick by tick — degrading
//! gracefully to the naive cost rather than ever producing a wrong answer.

use std::collections::HashMap;

use lattice_core::{Entity, Snapshot, World};
use lattice_sdk::{Scenario, simulate};

/// Run the whole scenario efficiently: warm up until the world enters a cycle,
/// then fast-forward whole cycles between snapshots, simulating only the short
/// remainders. Falls back to plain tick-by-tick simulation for a scenario that
/// does not cycle within the search bound.
fn run(scenario: &Scenario) -> Vec<Snapshot> {
    let mut driver = Driver::new(scenario);
    let mut out = Vec::with_capacity(scenario.snapshots.len());
    for &target in &scenario.snapshots {
        driver.advance_to(target);
        out.push(driver.world.snapshot());
    }
    out
}

/// The longest warm-up the engine will simulate tick by tick while hunting for a
/// cycle. The factory configurations the case ships settle far inside this bound
/// (a cycle is at most the LCM of the source periods times the longest pipeline
/// fill, which is small relative to the run length). If no cycle is found within
/// it, the engine stops looking and simulates the rest the naive way — still
/// correct, just not fast. Capping the search keeps the fingerprint map bounded so
/// the optimization never costs *more* memory or fuel than the work it saves.
const MAX_WARMUP_TICKS: u64 = 200_000;

/// The driver wrapping a live [`World`] with the cycle it has discovered (if any).
struct Driver {
    /// The authoritative live world — its [`World::advance`] is the only thing that
    /// ever mutates simulated state, so the rules are the oracle's by construction.
    world: World,
    /// The discovered cycle, once the warm-up finds one. `None` until then (and
    /// forever, for a scenario that does not cycle within [`MAX_WARMUP_TICKS`]).
    cycle: Option<Cycle>,
    /// Fingerprints of dynamic state seen during the warm-up, mapping a state's
    /// fingerprint to the tick it was first seen at and the sink totals then. A
    /// repeat reveals the cycle.
    seen: HashMap<u64, Seen>,
    /// Set once the warm-up has either found a cycle or exhausted its budget, so we
    /// do not keep rebuilding the fingerprint map after the search is over.
    search_done: bool,
    /// The alignment stride: the LCM of every source's period (>= 1). Every source
    /// is back at phase 0 only at multiples of this, so a genuine cycle's period is
    /// always a multiple of it. The engine therefore fingerprints **only at ticks
    /// that are multiples of `align`** — at any other tick the source phases differ
    /// from the start and the dynamic state provably cannot have repeated, so
    /// fingerprinting there would only waste fuel. This is the single change that
    /// makes the warm-up cheap on a dense factory: it cuts the (relatively
    /// expensive) fingerprint work by a factor of `align`.
    align: u64,
}

/// What the warm-up records for a fingerprint: the tick it was first seen and the
/// per-item sink totals at that tick, so the per-cycle delta can be computed when
/// the fingerprint recurs.
struct Seen {
    tick: u64,
    sinks: Vec<HashMap<u16, u64>>,
}

/// A discovered cycle: its period and the sink growth across one period.
struct Cycle {
    /// The number of ticks the dynamic state takes to return to an identical
    /// configuration.
    period: u64,
    /// Per-sink, per-item totals gained over one full period. Indexed parallel to
    /// the world's sink machines (in scenario placement order).
    delta: Vec<HashMap<u16, u64>>,
}

impl Driver {
    fn new(scenario: &Scenario) -> Driver {
        Driver {
            world: World::new(scenario),
            cycle: None,
            seen: HashMap::new(),
            search_done: false,
            align: alignment_stride(scenario),
        }
    }

    /// Advance the world to exactly `target` ticks, using the discovered cycle to
    /// skip whole periods where possible. `target` is always >= the current tick
    /// (snapshots are ascending), so this only ever moves forward.
    fn advance_to(&mut self, target: u64) {
        // Phase 1: keep simulating tick by tick while we are still searching for a
        // cycle (or have given up and must simulate everything). Each step feeds the
        // fingerprint search until it finds a cycle or hits the budget.
        while self.world.tick < target && !self.search_done {
            self.step_and_search();
        }

        // Phase 2: if a cycle was found, leap across whole periods arithmetically
        // until fewer than one period remains, crediting the sinks the per-cycle
        // delta for each skipped cycle. No simulation happens here at all — this is
        // the constant-time-per-cycle flow that beats the naive engine.
        if let Some(cycle) = &self.cycle
            && cycle.period > 0
        {
            let remaining = target - self.world.tick;
            let cycles = remaining / cycle.period;
            if cycles > 0 {
                self.world.tick += cycles * cycle.period;
                credit_sinks(&mut self.world, &cycle.delta, cycles);
            }
        }

        // Phase 3: simulate the short remainder (always < one period when a cycle
        // was found, or the rest of the run when none was). The world's own advance
        // produces the exact tail state, so the snapshot is bit-identical to the
        // oracle's.
        while self.world.tick < target {
            self.world.advance();
        }
    }

    /// Advance one tick and feed the cycle search: at an alignment boundary,
    /// fingerprint the new dynamic state and, if it repeats a fingerprint seen
    /// earlier, record the cycle and stop the search.
    fn step_and_search(&mut self) {
        self.world.advance();

        // Stop searching once the warm-up budget is spent: from here on we simulate
        // tick by tick (the naive cost) rather than grow the map unbounded.
        if self.world.tick >= MAX_WARMUP_TICKS {
            self.search_done = true;
            return;
        }

        // Only a multiple of the alignment stride can begin a cycle (every source is
        // at phase 0 there). Skip the fingerprint at every other tick — advancing
        // the world is cheap; building and hashing the canonical state is not.
        if !self.world.tick.is_multiple_of(self.align) {
            return;
        }

        let fingerprint = dynamic_fingerprint(&self.world);
        let sinks = sink_totals(&self.world);
        if let Some(prev) = self.seen.get(&fingerprint) {
            // The dynamic state (belts/machines + source phases) matches an earlier
            // tick, so the world is periodic from `prev.tick` with this period. The
            // sinks grew by the difference across the period.
            let period = self.world.tick - prev.tick;
            let delta = sink_delta(&prev.sinks, &sinks);
            self.cycle = Some(Cycle { period, delta });
            self.search_done = true;
        } else {
            self.seen.insert(
                fingerprint,
                Seen {
                    tick: self.world.tick,
                    sinks,
                },
            );
        }
    }
}

/// Add `cycles` periods' worth of `delta` to every sink's running totals. This is
/// the only place sink state advances without simulating — it is exact because the
/// cycle is provably periodic, so each skipped cycle deposits precisely `delta`.
fn credit_sinks(world: &mut World, delta: &[HashMap<u16, u64>], cycles: u64) {
    let mut sink_index = 0;
    for machine in &mut world.machines {
        if let lattice_core::world::Machine::Sink(sink) = machine {
            for (&item, &per_cycle) in &delta[sink_index] {
                *sink.consumed.entry(item).or_insert(0) += per_cycle * cycles;
            }
            sink_index += 1;
        }
    }
}

/// The per-sink, per-item totals right now, parallel to the world's sink machines
/// in placement order. Used as the cycle-search baseline and to compute the
/// per-cycle delta.
fn sink_totals(world: &World) -> Vec<HashMap<u16, u64>> {
    world
        .machines
        .iter()
        .filter_map(|m| match m {
            lattice_core::world::Machine::Sink(sink) => Some(sink.consumed.clone()),
            _ => None,
        })
        .collect()
}

/// The per-sink item growth from `before` to `after` (both parallel to the sink
/// machines). Counts only ever rise, so each entry is `after - before`.
fn sink_delta(before: &[HashMap<u16, u64>], after: &[HashMap<u16, u64>]) -> Vec<HashMap<u16, u64>> {
    before
        .iter()
        .zip(after)
        .map(|(b, a)| {
            a.iter()
                .map(|(&item, &after_count)| {
                    let before_count = b.get(&item).copied().unwrap_or(0);
                    (item, after_count - before_count)
                })
                .collect()
        })
        .collect()
}

/// The alignment stride for a scenario: the LCM of every source's period, or `1`
/// if there are no sources. Every source returns to emit phase 0 only at multiples
/// of this, so the steady-state cycle's period is necessarily a multiple of it —
/// which is exactly why the engine only needs to fingerprint at these boundaries.
///
/// The LCM is clamped to at least `1` (so the modulo in [`Driver::step_and_search`]
/// is well-defined for a source-less scenario) and saturates rather than overflows
/// for a pathological set of coprime periods; a saturated stride just means the
/// engine fingerprints less often, never wrongly.
fn alignment_stride(scenario: &Scenario) -> u64 {
    let mut stride = 1u64;
    for entity in &scenario.entities {
        if let Entity::Source { period, .. } = entity {
            stride = lcm(stride, (*period).max(1) as u64);
        }
    }
    stride.max(1)
}

/// The least common multiple of `a` and `b`, saturating on overflow (a saturated
/// stride only makes the engine fingerprint less often, never incorrectly).
fn lcm(a: u64, b: u64) -> u64 {
    if a == 0 || b == 0 {
        return a.max(b);
    }
    (a / gcd(a, b)).saturating_mul(b)
}

/// The greatest common divisor of `a` and `b` (Euclid's algorithm).
fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let t = b;
        b = a % b;
        a = t;
    }
    a
}

/// A fingerprint of the world's **dynamic** state: everything that drives the next
/// tick, but *not* the monotonic sink totals (which never affect future ticks) and
/// *not* the absolute tick (only each source's phase matters). Two ticks with the
/// same fingerprint provably evolve identically, which is what makes a fingerprint
/// repeat a genuine cycle.
///
/// It is built from the canonical [`Snapshot`](lattice_core::Snapshot) the world
/// already knows how to produce — the belts' exact item layouts, the machines'
/// exact buffers/timers, and each source's `emit_phase` — with the sinks zeroed
/// out, then hashed with the same FNV-1a the checksum uses. Reusing the canonical
/// serialization means the fingerprint captures exactly the state the rules read.
fn dynamic_fingerprint(world: &World) -> u64 {
    let snapshot = world.snapshot();
    // Re-serialize the entities with sinks neutralized, so a sink's ever-growing
    // total never perturbs the fingerprint (it cannot change how the world ticks).
    let entities: Vec<lattice_core::EntityState> = snapshot
        .entities
        .into_iter()
        .map(|state| match state {
            lattice_core::EntityState::Sink(_) => {
                lattice_core::EntityState::Sink(lattice_core::SinkState {
                    consumed: Default::default(),
                })
            }
            other => other,
        })
        .collect();
    // Hash over the canonical bytes at a fixed tick (0) so only the dynamic content
    // — including each source's emit_phase, which `to_state` derives from the live
    // tick and is preserved in `entities` — enters the fingerprint, never the
    // absolute tick.
    let bytes = lattice_core::canonical_bytes(0, &entities);
    lattice_core::fnv1a64(&bytes)
}

simulate!(run);

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
