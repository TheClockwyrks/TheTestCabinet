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
//! The grid is filled with horizontal **lines** running east, laid top to bottom
//! in bands. A line is one of three shapes, chosen by the seed, and between them
//! they exercise every entity and every recipe the simulation has:
//!
//! - a **belt line** (2 rows) — a `source` feeding a run of `belt`s into a `sink`,
//!   sometimes through a `splitter` that balances across *both* its outputs, the
//!   second draining down the reserved row beneath;
//! - a **craft line** (3 rows) — a `source` feeding a belt into an `inserter` that
//!   loads a 3×3 `assembler`, whose output a second inserter lifts back onto a belt
//!   and into a `sink`. Covers the single-input recipes;
//! - a **circuit line** (3 rows) — the two-input chain: two sources feed two belts
//!   into two inserters loading one assembler with both of `circuit`'s inputs, and
//!   the crafted circuits leave by a third inserter.
//!
//! A line's band is as tall as the shape needs, so footprints never collide: a
//! splitter's second tile and its branch belt sit in the belt line's reserved row,
//! and an assembler's three rows are the craft line's band.
//!
//! The seed also perturbs the belt tier, the emitted item, and the emission
//! period, so a batch of generated scenarios spans the belt tiers, the item
//! table, compaction regimes (fast period vs slow belt), and every recipe. (There
//! is nothing to perturb about an inserter — there is one kind, and it always
//! swings at `INSERTER_SWING`.) The snapshot schedule is three evenly-spaced ticks.
//!
//! Keeping the layout this regular makes the generated scenarios easy to reason
//! about and guarantees validity (every anchor is on the grid by construction),
//! while still producing the dense, long-running belts the case's fuel gap needs.
//!
//! This is a **tooling** concern, not a rule — but it does decide what a scored
//! scenario can measure. A generator that emits only belts and splitters grades
//! only belts and splitters, however much the specs describe.

use lattice_core::prototypes::{BELT_TIERS, ITEMS, RECIPES, Recipe};
use lattice_core::{Dir, Entity, Grid, Lane, SCENARIO_VERSION, Scenario, ScenarioError};

/// Rows a belt line occupies: its own, plus one beneath for a splitter's second
/// tile and that output's branch belt.
const BELT_BAND: i32 = 2;

/// Rows a craft or circuit line occupies — the height of the 3×3 assembler.
const CRAFT_BAND: i32 = 3;

/// The narrowest grid a craft line fits in: source, a belt, the loading inserter,
/// three assembler tiles, the unloading inserter, a belt, and the sink.
const MIN_CRAFT_WIDTH: i32 = 9;

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

    // Walk down the grid in bands, each as tall as the line shape it holds, so
    // footprints never overlap. A craft line needs three rows and a wider grid, so
    // it is only chosen where both fit; everything else falls back to a belt line,
    // which fits any grid this function accepts.
    let craft_fits = width >= MIN_CRAFT_WIDTH;
    let mut y = 0;

    // The two-input chain goes in the first band that can hold it, rather than
    // being left to a dice roll. It is the only shape that proves an engine tracks
    // per-item input buffers, and on a short grid there are too few bands for a
    // random choice to reliably place one — which is exactly how a scored set ends
    // up unable to catch an engine that skipped multi-input recipes.
    if craft_fits && height >= CRAFT_BAND {
        push_circuit_line(&mut entities, &mut rng, width, y);
        y += CRAFT_BAND;
    }
    let mut splitter_placed = false;

    while y < height {
        let rows_left = height - y;
        // Roughly half the bands craft when there is room for them, so a scenario
        // carries both the long belt runs the fuel gap needs and the machine work
        // that proves the rest of the simulation.
        let want_craft = craft_fits && rows_left >= CRAFT_BAND && rng.below(2) == 0;
        if want_craft {
            // One craft line in three is the two-input circuit chain, the only
            // recipe that needs two feeds converging on one assembler.
            if rng.below(3) == 0 {
                push_circuit_line(&mut entities, &mut rng, width, y);
            } else {
                push_craft_line(&mut entities, &mut rng, width, y);
            }
            y += CRAFT_BAND;
        } else {
            // The first belt line always carries a splitter, for the same reason
            // the circuit chain is placed outright: leaving it to a coin flip means
            // some scored scenarios silently grade no balancing at all.
            // A splitter drains its second output down the row beneath, so it can
            // only go on a line that HAS a row beneath it. The band walk can land a
            // belt line on the last row once a 3-row craft band has shifted the
            // parity, and a splitter there would place its branch off the grid.
            let room_below = y + 1 < height;
            push_line(
                &mut entities,
                &mut rng,
                width,
                height,
                y,
                room_below && !splitter_placed,
            );
            splitter_placed = splitter_placed || room_below;
            y += BELT_BAND;
        }
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
fn push_line(
    entities: &mut Vec<Entity>,
    rng: &mut SplitMix64,
    width: i32,
    height: i32,
    y: i32,
    // Whether this line should carry a splitter regardless of the seed's roll. Only
    // ever true on a line that has a row beneath it.
    force_splitter: bool,
) {
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
    // Never without the row beneath: the second tile and its branch belt live there.
    let place_splitter =
        width >= 6 && y + 1 < height && (force_splitter || rng.below(2) == 0);
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

    // Drain the splitter's SECOND output down the reserved row, so it actually
    // balances across two belts rather than routing everything to one. A splitter
    // with one live output is legal and now behaves correctly, but it exercises
    // none of the balancing this entity exists for.
    if place_splitter {
        for x in (splitter_x + 1)..sink_x {
            entities.push(Entity::Belt {
                x,
                y: y + 1,
                dir: Dir::E,
                tier: tier.clone(),
            });
        }
        entities.push(Entity::Sink {
            x: sink_x,
            y: y + 1,
            dir: Dir::E,
        });
    }
}

/// Append one craft line in the band at rows `y..y+3`: a source feeding a belt run
/// into an inserter that loads a 3×3 assembler, whose output a second inserter
/// lifts onto a belt run and into a sink. The flow rides the band's middle row so
/// both inserters line up with the assembler's centre.
///
/// The recipe is a single-input one, and the source emits exactly that input, so
/// the assembler actually crafts rather than sitting starved.
fn push_craft_line(entities: &mut Vec<Entity>, rng: &mut SplitMix64, width: i32, y: i32) {
    let tier = BELT_TIERS[rng.below(BELT_TIERS.len())].name.to_string();
    let recipe = single_input_recipe(rng);
    let feed = recipe.inputs[0].item.to_string();
    // The middle row of the band: the assembler's centre, so an inserter due east
    // of the belt drops into it and one due east of the assembler lifts from it.
    let mid = y + 1;

    // The loading inserter sits far enough east to leave room for the assembler,
    // the unloading inserter, a belt, and the sink.
    let load_x = (width - 6).max(2);
    let asm_x = load_x + 1;
    let unload_x = asm_x + 3;
    let sink_x = width - 1;

    entities.push(Entity::Source {
        x: 0,
        y: mid,
        dir: Dir::E,
        item: feed,
        lane: Lane::Both,
        // Fast enough to keep the assembler fed and back the belt up behind it,
        // which is what makes the inserter's stall path run.
        period: 2 + rng.below(4) as u32,
    });
    for x in 1..load_x {
        entities.push(Entity::Belt {
            x,
            y: mid,
            dir: Dir::E,
            tier: tier.clone(),
        });
    }
    entities.push(Entity::Inserter {
        x: load_x,
        y: mid,
        dir: Dir::E,
    });
    entities.push(Entity::Assembler {
        x: asm_x,
        y,
        recipe: recipe.name.to_string(),
    });
    entities.push(Entity::Inserter {
        x: unload_x,
        y: mid,
        dir: Dir::E,
    });
    for x in (unload_x + 1)..sink_x {
        entities.push(Entity::Belt {
            x,
            y: mid,
            dir: Dir::E,
            tier: tier.clone(),
        });
    }
    entities.push(Entity::Sink {
        x: sink_x,
        y: mid,
        dir: Dir::E,
    });
}

/// Append the two-input `circuit` chain in the band at rows `y..y+3`: two sources
/// feed two belt runs into two inserters that load the *same* assembler with both
/// of the recipe's inputs, and a third inserter lifts the crafted circuits onto a
/// belt into a sink.
///
/// The feeds enter on the band's top and bottom rows (the assembler's outer rows)
/// and the product leaves along the middle, so the three inserters never contend
/// for a tile. This is the only shape that exercises a multi-input recipe, and so
/// the only one that proves an engine tracks per-item input buffers rather than a
/// single count.
fn push_circuit_line(entities: &mut Vec<Entity>, rng: &mut SplitMix64, width: i32, y: i32) {
    let tier = BELT_TIERS[rng.below(BELT_TIERS.len())].name.to_string();
    let recipe = RECIPES
        .iter()
        .find(|r| r.inputs.len() > 1)
        // Every shipped multi-input recipe is `circuit`; fall back to the last
        // recipe rather than panicking if the table ever changes shape.
        .unwrap_or(&RECIPES[RECIPES.len() - 1]);

    let load_x = (width - 6).max(2);
    let asm_x = load_x + 1;
    let unload_x = asm_x + 3;
    let sink_x = width - 1;
    let mid = y + 1;

    // One feed per input, on the assembler's outer rows.
    for (slot, term) in recipe.inputs.iter().enumerate().take(2) {
        let row = if slot == 0 { y } else { y + 2 };
        entities.push(Entity::Source {
            x: 0,
            y: row,
            dir: Dir::E,
            item: term.item.to_string(),
            lane: Lane::Both,
            period: 2 + rng.below(4) as u32,
        });
        for x in 1..load_x {
            entities.push(Entity::Belt {
                x,
                y: row,
                dir: Dir::E,
                tier: tier.clone(),
            });
        }
        entities.push(Entity::Inserter {
            x: load_x,
            y: row,
            dir: Dir::E,
        });
    }

    entities.push(Entity::Assembler {
        x: asm_x,
        y,
        recipe: recipe.name.to_string(),
    });
    entities.push(Entity::Inserter {
        x: unload_x,
        y: mid,
        dir: Dir::E,
    });
    for x in (unload_x + 1)..sink_x {
        entities.push(Entity::Belt {
            x,
            y: mid,
            dir: Dir::E,
            tier: tier.clone(),
        });
    }
    entities.push(Entity::Sink {
        x: sink_x,
        y: mid,
        dir: Dir::E,
    });
}

/// A recipe the seed picks for a craft line: one of the single-input ones, so a
/// single source feed is enough to keep it crafting. The multi-input chain has its
/// own line shape.
fn single_input_recipe(rng: &mut SplitMix64) -> &'static Recipe {
    let simple: Vec<&'static Recipe> = RECIPES.iter().filter(|r| r.inputs.len() == 1).collect();
    simple[rng.below(simple.len())]
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
