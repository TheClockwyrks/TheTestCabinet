//! A small deterministic scenario generator for `lattice gen`.
//!
//! This is a **tooling** concern, not a rule: the generator only lays out a valid
//! blueprint on the grid; the *answer* for whatever it produces still comes from
//! the [`lattice_core`] oracle. So the generator is free to be a simple, readable
//! layout strategy — the only hard requirements are that it (a) is deterministic
//! in the seed (same seed + flags → identical scenario) and (b) always emits a
//! scenario that [`Scenario::validate`](lattice_core::Scenario::validate) accepts.
//!
//! ## The layout
//!
//! The grid is filled with horizontal **lines** running east. Each line is a
//! `source` at its west end feeding a run of `belt` tiles into a `sink` at its
//! east end. The seed perturbs, per line, the belt tier, the source item, the
//! emission period, and whether the line carries a mid-run `splitter` — so a batch
//! of generated scenarios spans the belt tiers, the item table, compaction
//! regimes (fast period vs slow belt), and the splitter balance path. Lines are
//! spaced two rows apart so a splitter's second tile (one row below its anchor)
//! never collides with the next line. The snapshot schedule is three evenly-spaced
//! ticks within the run.
//!
//! Keeping the layout this regular makes the generated scenarios easy to reason
//! about and guarantees validity (every anchor is on the grid by construction),
//! while still producing the dense, long-running belts the case's fuel gap needs.

use lattice_core::prototypes::{BELT_TIERS, ITEMS};
use lattice_core::{Dir, Entity, Grid, Lane, SCENARIO_VERSION, Scenario, ScenarioError};

/// A tiny deterministic PRNG (SplitMix64). Pure, seedable, no dependencies — all
/// the generator needs to make reproducible choices from the seed.
struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> SplitMix64 {
        SplitMix64 { state: seed }
    }

    /// The next pseudo-random `u64`. Standard SplitMix64 mixing.
    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A pseudo-random index into `0..n` (uniform enough for layout choices).
    fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }
}

/// Generate a deterministic, valid scenario from `seed` on a `width x height` grid
/// running `ticks` ticks. Returns a [`ScenarioError`] only if the grid is too
/// small to place even a single line (a `source` + one `belt` + a `sink` needs at
/// least width 3 and height 1).
pub fn scenario(seed: u64, width: i32, height: i32, ticks: u64) -> Result<Scenario, ScenarioError> {
    if width < 3 || height < 1 {
        return Err(ScenarioError::BadGrid { width, height });
    }

    let mut rng = SplitMix64::new(seed);
    let mut entities = Vec::new();

    // Lines run east on every other row, leaving a clear row beneath each line for
    // a splitter's second tile so footprints never overlap.
    let mut y = 0;
    while y < height {
        push_line(&mut entities, &mut rng, width, y);
        y += 2;
    }

    Ok(Scenario {
        version: SCENARIO_VERSION,
        grid: Grid { width, height },
        ticks,
        snapshots: snapshot_schedule(ticks),
        entities,
    })
}

/// Append one east-running line at row `y`: a `source` at the west edge, a run of
/// `belt`s across the width, an optional `splitter` partway along, and a `sink` at
/// the east edge. Every tile is on the grid by construction (the row exists and
/// `0..width` is in range).
fn push_line(entities: &mut Vec<Entity>, rng: &mut SplitMix64, width: i32, y: i32) {
    // Seed the line's character: belt tier, emitted item, and period.
    let tier = BELT_TIERS[rng.below(BELT_TIERS.len())].name.to_string();
    let item = ITEMS[rng.below(ITEMS.len())].to_string();
    // Periods 2..=8 span "faster than any belt can clear" (stalls/compaction) to
    // "sparse stream", exercising the source's emit-and-stall path either way.
    let period = 2 + rng.below(7) as u32;

    // The source sits at the west edge feeding the belt immediately east of it.
    entities.push(Entity::Source {
        x: 0,
        y,
        dir: Dir::E,
        item,
        lane: Lane::Both,
        period,
    });

    // A splitter, on roughly half the lines, sits one tile in from the east end so
    // its second tile (one row south) and the trailing belts both fit. It needs the
    // row below (`y + 1`) free, which the two-row line spacing guarantees.
    let place_splitter = width >= 6 && rng.below(2) == 0;
    let splitter_x = width - 3;

    // The belts run from x=1 up to (but not including) the sink at the east edge,
    // skipping the splitter's tile when one is placed.
    let sink_x = width - 1;
    for x in 1..sink_x {
        if place_splitter && x == splitter_x {
            entities.push(Entity::Splitter { x, y, dir: Dir::E });
            continue;
        }
        entities.push(Entity::Belt {
            x,
            y,
            dir: Dir::E,
            tier: tier.clone(),
        });
    }

    // The sink at the east edge consumes everything the line carries.
    entities.push(Entity::Sink {
        x: sink_x,
        y,
        dir: Dir::E,
    });
}

/// Three evenly-spaced snapshot ticks within `ticks`: a quarter, a half, and the
/// final tick. Strictly ascending and each in `1..=ticks`, so the schedule always
/// validates. For very small `ticks` the quarter/half can collapse onto the same
/// value or zero, so we de-duplicate and clamp to at least tick 1.
fn snapshot_schedule(ticks: u64) -> Vec<u64> {
    let mut raw = vec![ticks / 4, ticks / 2, ticks];
    let mut out = Vec::with_capacity(3);
    for t in raw.drain(..) {
        let t = t.max(1);
        // Keep strictly ascending: drop a tick that did not advance past the last.
        if out.last().map(|&last| t > last).unwrap_or(true) {
            out.push(t);
        }
    }
    out
}

#[cfg(test)]
#[path = "generate.test.rs"]
mod tests;
