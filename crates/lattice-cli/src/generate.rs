//! A small deterministic scenario generator for `lattice gen`.
//!
//! This is a **tooling** concern, not a rule: the generator only lays out a valid
//! blueprint on the grid; the *answer* for whatever it produces still comes from
//! the [`lattice_core`] oracle. So the generator is free to be a simple, readable
//! layout strategy — the only hard requirements are that it (a) is deterministic
//! in the seed (same seed + flags → identical scenario) and (b) always emits a
//! scenario that [`Scenario::validate`](lattice_core::Scenario::validate) accepts.
//!
//! ## Two layouts
//!
//! There are two layout strategies, chosen with `--layout` (see [`Layout`]):
//!
//! - [`Layout::Lines`] (the default) — the grid is filled with independent
//!   horizontal **lines** running east, laid top to bottom in bands. This is the
//!   original strategy; its shapes are documented on [`lines_layout`].
//! - [`Layout::Bus`] — an interconnected **main-bus** factory: self-contained
//!   horizontal **bus-units** stacked in non-overlapping bands, each internally
//!   wired end to end. Its unit shapes are documented on [`bus_layout`].
//!
//! Both share two disciplines. First, **band stacking**: a unit's band is exactly
//! as tall as the shape it holds, and the walk never revisits a row, so footprints
//! can never collide *between* bands — the only overlap risk is *within* a unit's
//! own template, which the [`Placer`] catches by construction. Second, a **flow
//! that settles**: every source feeds something that ultimately drains into a
//! sink, so a generated scenario reaches a steady state rather than jamming.
//!
//! This is a **tooling** concern, not a rule — but it does decide what a scored
//! scenario can measure. A generator that emits only belts and splitters grades
//! only belts and splitters, however much the specs describe.

use std::collections::HashSet;

use lattice_core::prototypes::{BELT_TIERS, ITEMS, RECIPES, Recipe};
use lattice_core::{Dir, Entity, Grid, Lane, SCENARIO_VERSION, Scenario, ScenarioError};

/// Which layout strategy [`scenario_with_layout`] lays down. Parsed straight from
/// the `--layout` flag (clap [`ValueEnum`](clap::ValueEnum): `lines` / `bus`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, clap::ValueEnum)]
pub enum Layout {
    /// Independent east-flowing belt lines in horizontal bands (the original,
    /// default strategy). See [`lines_layout`].
    #[default]
    Lines,
    /// An interconnected main-bus factory of stacked bus-units. See [`bus_layout`].
    Bus,
}

/// Rows a belt line occupies: its own, plus one beneath for a splitter's second
/// tile and that output's branch belt.
const BELT_BAND: i32 = 2;

/// Rows a craft or circuit line occupies — the height of the 3×3 assembler.
const CRAFT_BAND: i32 = 3;

/// The narrowest grid a craft line fits in: source, a belt, the loading inserter,
/// three assembler tiles, the unloading inserter, a belt, and the sink.
const MIN_CRAFT_WIDTH: i32 = 9;

/// The single, fixed source period every **bus** source emits at.
///
/// This is the single most important tuning lever for the transport reference
/// engine. That engine detects the factory's steady-state **cycle** and only
/// fingerprints the world at multiples of `align = LCM(all source periods)` — so
/// its warm-up cost falls as `align` rises. The Lines layout draws random coprime
/// periods (fine — each line is independent and short), but a bus-unit chains
/// several sources through the same machines, and coprime periods would blow the
/// cycle period up until the transport engine could no longer detect it and
/// degraded to the naive cost. **Every** bus source therefore shares this one
/// period, so `align` is exactly it and the whole factory beats in time.
///
/// The value is `4`, not the smallest possible `2`, for two reasons. It must stay
/// **harmonic with the craft times** — 4 divides `LCM(32, 64, 96) = 192`, so the
/// steady-state cycle period stays a tiny 192 and is found quickly (an odd or
/// coprime period would push the cycle out of the transport engine's search
/// window). And doubling the period from 2 halves how often the engine
/// fingerprints during warm-up, roughly halving the transport fuel, while an ore
/// stream every four ticks is still one item per belt tile — dense enough that a
/// draining bus reads as full, not sparse. (Larger still, e.g. 8, would leave gaps
/// in the belts and read as dead tiles.)
const BUS_PERIOD: u32 = 4;

/// The column span of the [`machine_works`] block (its widest tile is `x0 + 23`),
/// reserved so lane splitters and the block never collide.
const MACHINE_WORKS_WIDTH: i32 = 24;

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
/// running `ticks` ticks, using the default [`Layout::Lines`]. Kept as the
/// original entry so existing callers and tests are unchanged; new callers pass a
/// layout with [`scenario_with_layout`]. The `gen` subcommand now always goes
/// through [`scenario_with_layout`] (to honour `--layout`), so in a non-test build
/// of this binary the wrapper has no caller — hence the guarded `allow`.
#[cfg_attr(not(test), allow(dead_code))]
pub fn scenario(seed: u64, width: i32, height: i32, ticks: u64) -> Result<Scenario, ScenarioError> {
    scenario_with_layout(seed, width, height, ticks, Layout::Lines)
}

/// Generate a deterministic, valid scenario from `seed` on a `width x height` grid
/// running `ticks` ticks, using the chosen [`Layout`]. Returns a [`ScenarioError`]
/// only if the grid is too small to place even a single line (a `source` + one
/// `belt` + a `sink` needs at least width 3 and height 1).
pub fn scenario_with_layout(
    seed: u64,
    width: i32,
    height: i32,
    ticks: u64,
    layout: Layout,
) -> Result<Scenario, ScenarioError> {
    if width < 3 || height < 1 {
        return Err(ScenarioError::BadGrid { width, height });
    }

    let mut rng = SplitMix64::new(seed);
    let entities = match layout {
        Layout::Lines => lines_layout(&mut rng, width, height),
        Layout::Bus => bus_layout(&mut rng, width, height),
    };

    Ok(Scenario {
        version: SCENARIO_VERSION,
        grid: Grid { width, height },
        ticks,
        snapshots: snapshot_schedule(ticks),
        entities,
    })
}

/// The **Lines** layout: independent horizontal lines running east, laid top to
/// bottom in bands. A line is one of three shapes, chosen by the seed, and between
/// them they exercise every entity and every recipe the simulation has:
///
/// - a **belt line** (2 rows) — a `source` feeding a run of `belt`s into a `sink`,
///   sometimes through a `splitter` that balances across *both* its outputs, the
///   second draining down the reserved row beneath;
/// - a **craft line** (3 rows) — a `source` feeding a belt into an `inserter` that
///   loads a 3×3 `assembler`, whose output a second inserter lifts back onto a belt
///   and into a `sink`. Covers the single-input recipes;
/// - a **circuit line** (3 rows) — the two-input chain: two sources feed two belts
///   into two inserters loading one assembler with both of `circuit`'s inputs, and
///   the crafted circuits leave by a third inserter.
///
/// A line's band is as tall as the shape needs, so footprints never collide: a
/// splitter's second tile and its branch belt sit in the belt line's reserved row,
/// and an assembler's three rows are the craft line's band.
///
/// The seed also perturbs the belt tier, the emitted item, and the emission
/// period, so a batch of generated scenarios spans the belt tiers, the item
/// table, compaction regimes (fast period vs slow belt), and every recipe.
fn lines_layout(rng: &mut SplitMix64, width: i32, height: i32) -> Vec<Entity> {
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
        push_circuit_line(&mut entities, rng, width, y);
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
                push_circuit_line(&mut entities, rng, width, y);
            } else {
                push_craft_line(&mut entities, rng, width, y);
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
                rng,
                width,
                height,
                y,
                room_below && !splitter_placed,
            );
            splitter_placed = splitter_placed || room_below;
            y += BELT_BAND;
        }
    }

    entities
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
    let place_splitter = width >= 6 && y + 1 < height && (force_splitter || rng.below(2) == 0);
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

// ---------------------------------------------------------------------------
// The Bus layout
// ---------------------------------------------------------------------------

/// A placement helper for the **bus** layout that records every footprint tile as
/// it places an entity.
///
/// [`Scenario::validate`](lattice_core::Scenario::validate) only checks that an
/// entity's *anchor* is on the grid and that its prototype names resolve — it does
/// **not** check that a multi-tile footprint (a splitter's second tile, an
/// assembler's 3×3) is on-grid or that two footprints do not overlap. The bus
/// templates do a lot of tile arithmetic, so an off-by-one would otherwise slip
/// through validation and only surface as a wrong simulation deep in a solve. Each
/// `Placer` method marks every tile the entity covers and asserts it is on-grid and
/// free first, turning any template bug into an immediate, located failure.
struct Placer {
    width: i32,
    height: i32,
    occupied: HashSet<(i32, i32)>,
    entities: Vec<Entity>,
}

impl Placer {
    fn new(width: i32, height: i32) -> Placer {
        Placer {
            width,
            height,
            occupied: HashSet::new(),
            entities: Vec::new(),
        }
    }

    /// Claim one footprint tile, asserting it is on-grid and not already taken. A
    /// failure here is always a generator bug, never bad input, so a debug
    /// assertion is the right tool — and the `bus_produces_no_footprint_overlaps`
    /// test re-derives the same check from the emitted entities so it holds in any
    /// build (a `debug_assert!` is compiled out of a release build).
    fn occupy(&mut self, x: i32, y: i32) {
        debug_assert!(
            x >= 0 && y >= 0 && x < self.width && y < self.height,
            "footprint tile ({x},{y}) is off the {}x{} grid",
            self.width,
            self.height
        );
        debug_assert!(
            self.occupied.insert((x, y)),
            "footprint tile ({x},{y}) is already occupied"
        );
    }

    fn belt(&mut self, x: i32, y: i32, dir: Dir, tier: &str) {
        self.occupy(x, y);
        self.entities.push(Entity::Belt {
            x,
            y,
            dir,
            tier: tier.to_string(),
        });
    }

    /// Place a source emitting `item` every `period` ticks onto both lanes of the
    /// downstream belt. The period is a tuning lever: the transport reference
    /// fingerprints the world at multiples of `align = LCM(all source periods)`, so
    /// a bus keeps every source's period small and harmonic with the craft times
    /// (all dividing `LCM(32, 64, 96) = 192`). Faster belts want a shorter period to
    /// stay dense (see [`tier_period`]); a `slow` stage keeps the default
    /// [`BUS_PERIOD`], the value `align` settles to.
    fn source_period(&mut self, x: i32, y: i32, dir: Dir, item: &str, period: u32) {
        self.occupy(x, y);
        self.entities.push(Entity::Source {
            x,
            y,
            dir,
            item: item.to_string(),
            lane: Lane::Both,
            period,
        });
    }

    fn sink(&mut self, x: i32, y: i32, dir: Dir) {
        self.occupy(x, y);
        self.entities.push(Entity::Sink { x, y, dir });
    }

    fn inserter(&mut self, x: i32, y: i32, dir: Dir) {
        self.occupy(x, y);
        self.entities.push(Entity::Inserter { x, y, dir });
    }

    /// Place a splitter, claiming both tiles of its two-tile footprint. Its second
    /// tile is one step perpendicular-clockwise of `dir` (for E/W: `(x, y+1)`; for
    /// N/S: `(x+1, y)`), matching [`Entity::Splitter`]'s documented geometry.
    fn splitter(&mut self, x: i32, y: i32, dir: Dir) {
        let (sx, sy) = match dir {
            Dir::E | Dir::W => (x, y + 1),
            Dir::N | Dir::S => (x + 1, y),
        };
        self.occupy(x, y);
        self.occupy(sx, sy);
        self.entities.push(Entity::Splitter { x, y, dir });
    }

    /// Place a 3×3 assembler anchored at `(x, y)`, claiming all nine tiles it
    /// covers (`x..x+3` × `y..y+3`).
    fn assembler(&mut self, x: i32, y: i32, recipe: &str) {
        for dy in 0..3 {
            for dx in 0..3 {
                self.occupy(x + dx, y + dy);
            }
        }
        self.entities.push(Entity::Assembler {
            x,
            y,
            recipe: recipe.to_string(),
        });
    }

    /// A horizontal run of east-facing belts covering `x0..x1` on row `y`.
    fn hbelt(&mut self, x0: i32, x1: i32, y: i32, tier: &str) {
        for x in x0..x1 {
            self.belt(x, y, Dir::E, tier);
        }
    }
}

/// Pick a belt `tier` from the seed. Tiers are cosmetic (every belt runs at the
/// one `BELT_SPEED`), but varying it keeps generated scenarios distinct and spans
/// the tier names a scored set should see.
fn pick_tier(rng: &mut SplitMix64) -> String {
    BELT_TIERS[rng.below(BELT_TIERS.len())].name.to_string()
}

/// The source emission period for a belt `tier`. Faster belts want a shorter
/// period so a *flowing* lane stays dense (an express belt clears a tile in ~2.7
/// ticks, so an item every four would leave gaps), while a slow belt at period 4
/// is already one item per tile. All three divide `LCM(32, 64, 96) = 192`, so the
/// steady-state cycle stays the tiny 192 the transport reference detects, and the
/// bus's `align = LCM(periods)` stays 4 (a `slow` stage is always present), keeping
/// the transport engine's warm-up fingerprinting cheap.
fn tier_period(tier: &str) -> u32 {
    match tier {
        "slow" => BUS_PERIOD,
        _ => 2,
    }
}

/// The **Bus** layout: a spread-out west→east factory, correct by construction.
///
/// The grid is filled left-to-right in three regions, but the defining property is
/// that **product-crafting machinery reaches the whole width, out to the east edge
/// — never clustered at one end**:
///
/// **Region 1 — smelting (`x < smelt_x`, with `smelt_x = width/3`).** Iron-ore and
/// copper-ore `source`s sit on the far-west column. Each rides a short ore
/// backbone (confined to the left third, so no raw ore ever travels past
/// `width/2`) that a row of plate `assembler`s taps and lifts onto a full-width
/// horizontal **plate sub-bus** — an iron-plate lane and a copper-plate lane that
/// run east across the entire grid.
///
/// **Region 2 — the plate sub-buses and their product stations (most of the
/// grid).** The iron- and copper-plate lanes run east at reserved rows. Along them,
/// compact **product stations** repeat at a regular horizontal pitch across the
/// full remaining width: each taps the lane(s) beside it, crafts a product through
/// a short local chain, and drains it to a single-item `sink`. Gear stations tap
/// the iron lane; cable stations tap the copper lane; and a handful of deeper
/// **machine cores** (transport-belt, inserter, assembler — plus the circuit they
/// need) tap both lanes and build the craft tree's tips. A **split-merge balancer**
/// splits the iron lane onto a parallel branch that rejoins it downstream, so the
/// layout carries many `splitter`s spread along the bus without ever wasting plate.
///
/// **Region 3 — outputs (the east).** Every product drains to its **own single-item
/// `sink`**, spread down the east side; no `splitter` is ever the last hop.
fn bus_layout(rng: &mut SplitMix64, width: i32, height: i32) -> Vec<Entity> {
    let mut placer = Placer::new(width, height);
    if width >= 40 && height >= 30 {
        full_bus(&mut placer, rng, width, height);
    } else {
        simple_bus(&mut placer, rng, width, height);
    }
    placer.entities
}

/// The east boundary of the ore-smelting region — every raw-ore backbone stays
/// west of this, inside the left half the rule requires (`< width/2`). Pushed as far
/// right as the machine works leaves room for, so the bank fits enough plate smelters
/// that the lanes reach their steady equilibrium quickly (a short transient the
/// transport reference fingerprints cheaply) instead of drifting up for tens of
/// thousands of ticks.
fn smelt_boundary(width: i32) -> i32 {
    (width - MACHINE_WORKS_WIDTH - 1).min(width / 2 - 1).max(6)
}

/// The station columns a pitched row of stations occupies: anchored so the
/// **east-most** station reaches the east edge (`x >= width - 6`) and each
/// consecutive column is within `pitch` of the last, laid from the east edge back
/// to the smelting boundary. `pitch` is chosen `<= width/6` so the assembler-anchor
/// spacing rule holds by construction.
fn station_columns(width: i32, smelt_x: i32, pitch: i32) -> Vec<i32> {
    let mut cols = Vec::new();
    let mut x = width - 3;
    while x >= smelt_x {
        cols.push(x);
        x -= pitch;
    }
    cols.reverse();
    cols
}

/// The full spread-out layout for a generous grid. Two full-width plate lanes fed
/// by left-third smelters, product stations pitched across the whole width, machine
/// cores for the craft-tree tips, and split-merge balancers along the iron lane.
fn full_bus(p: &mut Placer, rng: &mut SplitMix64, width: i32, height: i32) {
    let smelt_x = smelt_boundary(width);
    let tier = pick_tier(rng);
    let period = tier_period(&tier);
    let ibus = 6; // iron-plate lane row
    let cbus = height - 7; // copper-plate lane row (near the bottom)
    // Above-station pitch is `<= width/12`, so even where a balancer displaces one
    // the assembler-anchor gap stays `<= width/6`.
    let pitch = (width / 6).clamp(6, 12);
    let cols = station_columns(width, smelt_x, pitch);
    let mw_lo = smelt_x + 1; // the machine works starts just east of the smelting bank
    let mw_hi = mw_lo + MACHINE_WORKS_WIDTH;

    // Distribution-splitter columns spread across each lane, clear of the smelter
    // drops and the machine-works block. Each is a real 1-in/2-out splitter (never a
    // trivial pass-through): it peels a branch off the lane that curves straight back
    // onto it downstream, so plate is routed through the splitter without being lost.
    let iron_bal = splitter_cols(width, smelt_x, mw_lo, mw_hi, height / 8 + 1);
    let cu_bal = splitter_cols(width, smelt_x, mw_lo, mw_hi, height / 8 + 1);

    // The two full-width plate lanes, each broken at its splitter columns. They
    // dead-end, so plate backs up and the lane reads dense (a busy factory) while
    // staying a light stream the transport reference fingerprints cheaply.
    place_lane_skipping(p, ibus, width, &tier, &iron_bal);
    place_lane_skipping(p, cbus, width, &tier, &cu_bal);
    for &sx in &iron_bal {
        distribution_splitter(p, sx, ibus, true, &tier); // branch in the mid band below
    }
    for &sx in &cu_bal {
        distribution_splitter(p, sx, cbus, false, &tier); // branch just above the lane
    }

    // Smelter banks (left region): iron above its lane, copper below its lane. A
    // single bank per lane keeps the lane a light, moving stream — cheaper for the
    // transport reference to fingerprint than a fully saturated block.
    iron_smelters(p, ibus, smelt_x, &tier, period);
    copper_smelters(p, cbus, smelt_x, &tier, period);

    // Gear stations tap the iron lane from above at every pitch column — this rank
    // alone spreads assembler anchors across the whole width. Cable stations tap the
    // copper lane from below, kept clear of the core columns.
    for &gx in &cols {
        gear_station_above(p, gx, ibus, &tier);
        // Cable stations sit in the band *below* the copper lane, clear of the
        // cores (which live between the lanes), so every column can host one.
        cable_station_below(p, gx, cbus, &tier);
    }

    // The machine works: the craft-tree tips (circuit, transport-belt, inserter,
    // assembler) on shared sub-buses, occupying the mid band across the width.
    machine_works(p, mw_lo, ibus, cbus, &tier);

    // The configuration bay: functional belt/splitter/inserter *configurations*
    // (real balancers, merges, side-loads, "+" intersections, shared-source
    // inserter pairs, and a mixed-item belt) laid in the free band west of the
    // machine works, all carrying **smelted intermediates** off a dedicated bay
    // plate sub-lane. A large grid carries the full set; a medium grid a subset.
    let full = height >= 38;
    config_bay(p, ibus, cbus, width, &tier, period, full);
}

/// The **configuration bay** — a band of functional belt/splitter/inserter
/// *configurations* laid in the empty region between the two plate lanes, west of the
/// machine works. A dedicated bay iron smelter lifts iron-plate onto a **bay plate
/// sub-lane** ([`bay_iron_smelter`]); every gadget taps that sub-lane, so the bay
/// carries **smelted intermediates** (never raw ore) and never taps — nor starves —
/// the main plate lanes that feed the machine works.
///
/// The structural configurations (#1–#5) **dead-end**: their belts fill with plate
/// and back-pressure to the tap, so they read dense and draw almost nothing at steady
/// state. The flow configurations (#6–#8) drain to their own product sinks.
///
/// - [`balancer_gadget`] — a 1-in/2-out split feeding a real **2-in / 2-out** balancer
///   (#1).
/// - [`merge_gadget`] — a 1-in/2-out split feeding a real **2-in / 1-out** merge (#2).
/// - [`twin_gadget`] — **two inserters from one belt line** (#6), both lifting plate.
/// - [`plus_gadget`] (large) — a vertical plate through belt fed by two perpendicular
///   feeders, one from each side, that also continues past the join: the
///   **T-intersection** (#3), **double side-load** (#4) and **"+"** (#5).
/// - [`mixed_gadget`] (large) — iron-plate + iron-gear merged onto one **mixed-item
///   belt** (#8) that feeds a `transport-belt` assembler (both are its inputs, so the
///   sink stays single-item).
/// - [`cable_twin_gadget`] (large) — **two inserters unloading one assembler** (#7):
///   a copper-cable assembler (a 2-output recipe) unloaded by a pair.
fn config_bay(
    p: &mut Placer,
    ibus: i32,
    cbus: i32,
    width: i32,
    tier: &str,
    period: u32,
    full: bool,
) {
    let pl = ibus + 8; // the bay plate sub-lane row
    let bay_east = smelt_boundary(width) - 1; // = mw_lo - 2, two clear of the works
    bay_iron_smelter(p, pl, bay_east, tier, period);
    // Structural gadgets first, tapping the sub-lane from below, side by side.
    debug_assert!(pl + 4 <= cbus - 2);
    balancer_gadget(p, pl, 6, tier); // #1
    merge_gadget(p, pl, 12, tier); // #2
    twin_gadget(p, pl, 18, tier); // #6
    if full {
        // The taller gadgets fit only a large grid (they reach down toward the copper
        // lane). `plus` and `mixed` sit east along the sub-lane; the copper-cable pair
        // gets its own block lower-west, clear of the short gadgets above it.
        debug_assert!(pl + 12 <= cbus - 2);
        plus_gadget(p, pl, 24, tier); // #3/#4/#5 (centre column 24)
        mixed_gadget(p, pl, 28, tier); // #8
        cable_twin_gadget(p, ibus + 14, tier, period); // #7
    }
}

/// The bay's own iron smelter: an ore backbone in the far-west columns (kept inside
/// the left half so no raw ore ever travels past `width/2`) feeding a short rank of
/// `iron-plate` assemblers that lift plate onto the **bay plate sub-lane** at row
/// `pl`, which runs east to `bay_east`. The sub-lane dead-ends, so it saturates and
/// every gadget tap downstream stays fed.
fn bay_iron_smelter(p: &mut Placer, pl: i32, bay_east: i32, tier: &str, period: u32) {
    let ob = pl - 6; // ore backbone row
    let bank_east = bay_east.min(20); // ~6 plate assemblers — plenty for the bay
    p.source_period(0, ob, Dir::E, "iron-ore", period);
    p.hbelt(1, bank_east, ob, tier);
    let mut cx = 3;
    while cx + 1 < bank_east {
        p.inserter(cx, ob + 1, Dir::S); // ore off the backbone -> plate assembler
        p.assembler(cx - 1, ob + 2, "iron-plate"); // rows ob+2..ob+4 = pl-4..pl-2
        p.inserter(cx, ob + 5, Dir::S); // plate off the assembler -> sub-lane
        cx += 3;
    }
    p.hbelt(1, bay_east + 1, pl, tier); // the bay plate sub-lane
}

/// Tap the bay plate sub-lane at column `x`: an inserter one row below lifts an
/// iron-plate off the lane and drops it onto the gadget belt two rows below.
fn tap_plate(p: &mut Placer, x: i32, pl: i32) {
    p.inserter(x, pl + 1, Dir::S); // pick plate off (x, pl) -> (x, pl+2)
}

/// #1 — a real **2-in / 2-out** balancer, carrying iron-plate. A tap feeds a
/// 1-in/2-out split whose two outputs both feed the balancer's two inputs; the
/// balancer's two outputs dead-end (they fill with plate). Two functional splitters,
/// zero trivial ones.
fn balancer_gadget(p: &mut Placer, pl: i32, c: i32, tier: &str) {
    tap_plate(p, c, pl);
    p.belt(c, pl + 2, Dir::E, tier);
    p.splitter(c + 1, pl + 2, Dir::E); // split: 1-in / 2-out
    p.belt(c + 2, pl + 2, Dir::E, tier);
    p.belt(c + 2, pl + 3, Dir::E, tier);
    p.splitter(c + 3, pl + 2, Dir::E); // balancer: 2-in / 2-out
    p.belt(c + 4, pl + 2, Dir::E, tier); // dead-ends (fills with plate)
    p.belt(c + 4, pl + 3, Dir::E, tier);
}

/// #2 — a real **2-in / 1-out** merge, carrying iron-plate. A tap feeds a 1-in/2-out
/// split whose two outputs feed a 2-in/1-out merge that recombines them onto one
/// dead-ending belt. Two functional splitters.
fn merge_gadget(p: &mut Placer, pl: i32, c: i32, tier: &str) {
    tap_plate(p, c, pl);
    p.belt(c, pl + 2, Dir::E, tier);
    p.splitter(c + 1, pl + 2, Dir::E); // split: 1-in / 2-out
    p.belt(c + 2, pl + 2, Dir::E, tier);
    p.belt(c + 2, pl + 3, Dir::E, tier);
    p.splitter(c + 3, pl + 2, Dir::E); // merge: 2-in / 1-out
    p.belt(c + 4, pl + 2, Dir::E, tier); // single output, dead-ends
}

/// #6 — **two inserters drawing from one belt line**. A tap feeds a short plate run;
/// two inserters spaced along it each lift plate into its own sink, so both carry from
/// the shared line.
fn twin_gadget(p: &mut Placer, pl: i32, c: i32, tier: &str) {
    // Two taps feed the run, one just upstream of each pick inserter, so plate reaches
    // both rather than the upstream inserter monopolising a single feed.
    tap_plate(p, c, pl);
    tap_plate(p, c + 2, pl);
    for dx in 0..4 {
        p.belt(c + dx, pl + 2, Dir::E, tier);
    }
    for px in [c + 1, c + 3] {
        p.inserter(px, pl + 3, Dir::S); // lift plate off (px, pl+2) -> sink
        p.sink(px, pl + 4, Dir::S);
    }
}

/// #3, #4, #5 — a **"+" intersection** carrying iron-plate. A vertical plate through
/// belt (fed by a tap and running south) is joined at its centre by two perpendicular
/// feeders, one from the **west** and one from the **east** (each a #3 T-intersection;
/// together a #4 double side-load), while the through belt **continues** south past
/// the join (#5). All three arms tap the sub-lane; the through dead-ends at the bottom.
fn plus_gadget(p: &mut Placer, pl: i32, c: i32, tier: &str) {
    // Through belt: tap at column `c`, running south through the centre (c, pl+3).
    tap_plate(p, c, pl);
    p.belt(c, pl + 2, Dir::S, tier);
    p.belt(c, pl + 3, Dir::S, tier); // the centre tile
    p.belt(c, pl + 4, Dir::S, tier); // collinear downstream (the "+" continues)
    p.belt(c, pl + 5, Dir::S, tier); // dead-ends
    // West feeder: tap two columns west, drop, run south then east into the centre.
    tap_plate(p, c - 2, pl);
    p.belt(c - 2, pl + 2, Dir::S, tier);
    p.belt(c - 2, pl + 3, Dir::E, tier);
    p.belt(c - 1, pl + 3, Dir::E, tier); // side-loads onto (c, pl+3) from the west
    // East feeder: mirror image, side-loading from the east.
    tap_plate(p, c + 2, pl);
    p.belt(c + 2, pl + 2, Dir::S, tier);
    p.belt(c + 2, pl + 3, Dir::W, tier);
    p.belt(c + 1, pl + 3, Dir::W, tier); // side-loads onto (c, pl+3) from the east
}

/// #8 — a **mixed-item belt**. An `iron-gear` assembler feeds a gear belt on one row
/// and a plate tap feeds a plate belt on the row below; a 2-in/1-out merge combines
/// them onto **one belt carrying both iron-gear and iron-plate at once**, which an
/// inserter loads into a `transport-belt` assembler — iron-plate + iron-gear are
/// exactly its two inputs, so the mix is consumed cleanly and its product sink stays
/// single-item. Laid vertically to stay narrow.
fn mixed_gadget(p: &mut Placer, pl: i32, c: i32, tier: &str) {
    // iron-gear stream (row pl+6): tap -> gear assembler -> gear belt running east.
    p.inserter(c + 1, pl + 1, Dir::S); // tap plate -> gear assembler top-mid
    p.assembler(c, pl + 2, "iron-gear"); // cols c..c+2, rows pl+2..pl+4
    p.inserter(c + 1, pl + 5, Dir::S); // gear out (bottom-mid) -> (c+1, pl+6)
    p.belt(c + 1, pl + 6, Dir::E, tier);
    p.belt(c + 2, pl + 6, Dir::E, tier);
    p.belt(c + 3, pl + 6, Dir::E, tier); // -> merge bottom input (c+3, pl+6)
    // iron-plate stream (row pl+7): a separate tap dropped south then run east.
    p.inserter(c - 1, pl + 1, Dir::S);
    p.belt(c - 1, pl + 2, Dir::S, tier);
    p.belt(c - 1, pl + 3, Dir::S, tier);
    p.belt(c - 1, pl + 4, Dir::S, tier);
    p.belt(c - 1, pl + 5, Dir::S, tier);
    p.belt(c - 1, pl + 6, Dir::S, tier);
    p.belt(c - 1, pl + 7, Dir::E, tier);
    p.belt(c, pl + 7, Dir::E, tier);
    p.belt(c + 1, pl + 7, Dir::E, tier);
    p.belt(c + 2, pl + 7, Dir::E, tier);
    p.belt(c + 3, pl + 7, Dir::E, tier); // -> merge top input (c+3, pl+7)
    // Merge (2-in/1-out): gear on pl+6, plate on pl+7, onto ONE mixed belt (pl+6).
    p.splitter(c + 4, pl + 6, Dir::E); // tiles (c+4,pl+6),(c+4,pl+7); output row pl+6
    p.belt(c + 5, pl + 6, Dir::E, tier); // the MIXED belt (iron-gear + iron-plate)
    // Consume the mix in a transport-belt assembler; drain the product to its sink.
    p.inserter(c + 5, pl + 7, Dir::S); // lift the mix off (c+5,pl+6) -> assembler top
    p.assembler(c + 4, pl + 8, "transport-belt"); // cols c+4..c+6, rows pl+8..pl+10
    p.inserter(c + 5, pl + 11, Dir::S); // product out -> sink
    p.sink(c + 5, pl + 12, Dir::S);
}

/// #7 — **two inserters unloading one assembler**. A short copper chain
/// (ore -> copper-plate -> copper-cable) ends in a single copper-cable assembler
/// (`copper-cable` yields two per craft, so a pair of unloaders both stay busy). One
/// inserter unloads it to the west and one to the east, each onto its own belt into
/// its own copper-cable sink. Self-contained (its own ore source, kept in the left
/// half), so it never touches the plate lanes.
fn cable_twin_gadget(p: &mut Placer, y: i32, tier: &str, period: u32) {
    let cx = 8;
    // ore backbone -> plate assembler -> cable assembler, stacked south.
    p.source_period(0, y, Dir::E, "copper-ore", period);
    p.hbelt(1, cx + 1, y, tier);
    p.inserter(cx, y + 1, Dir::S); // ore off the backbone -> plate assembler
    p.assembler(cx - 1, y + 2, "copper-plate"); // rows y+2..y+4
    p.inserter(cx, y + 5, Dir::S); // plate -> cable assembler
    p.assembler(cx - 1, y + 6, "copper-cable"); // rows y+6..y+8
    // Two inserters unload the ONE cable assembler, west and east.
    p.inserter(cx - 2, y + 7, Dir::W); // pick cable from the assembler's left-mid
    p.belt(cx - 3, y + 7, Dir::W, tier);
    p.sink(cx - 4, y + 7, Dir::W);
    p.inserter(cx + 2, y + 7, Dir::E); // pick cable from the assembler's right-mid
    p.belt(cx + 3, y + 7, Dir::E, tier);
    p.sink(cx + 4, y + 7, Dir::E);
}

/// Columns for lone through-splitters on a plate lane, spread across the width and
/// clear of the smelter tap columns and the machine-works block. Each splitter
/// breaks its lane's run (so no single belt spans the width) and grades as a
/// balancer. Spaced `>= 3` apart so no two are adjacent (which would leave a
/// splitter with no output belt).
fn splitter_cols(width: i32, smelt_x: i32, mw_lo: i32, mw_hi: i32, want: i32) -> Vec<i32> {
    let mut cands = Vec::new();
    // Stop a few columns short of the east edge so no splitter output ends up
    // orthogonally next to the lane's end sink.
    for x in 2..(width - 4) {
        let in_works = x >= mw_lo - 1 && x <= mw_hi + 1;
        let smelter_tap = x < smelt_x && x % 3 == 0; // a smelter drops onto this tile
        if !in_works && !smelter_tap {
            cands.push(x);
        }
    }
    let want = want.max(1) as usize;
    let mut out: Vec<i32> = Vec::new();
    if cands.is_empty() {
        return out;
    }
    for k in 0..want {
        let idx = k * (cands.len() - 1) / want.max(1);
        let c = cands[idx];
        if out.last().is_none_or(|&l| c - l >= 3) {
            out.push(c);
        }
    }
    out
}

/// Place a plate lane at `row`, full width, skipping the splitter columns (a
/// splitter takes each such tile).
fn place_lane_skipping(p: &mut Placer, row: i32, width: i32, tier: &str, bal_cols: &[i32]) {
    for x in 1..width {
        if bal_cols.contains(&x) {
            continue; // a splitter occupies (x, row) and (x, row+1)
        }
        p.belt(x, row, Dir::E, tier);
    }
}

/// Place a **functional** distribution splitter on a plate lane at column `sx`: a
/// real 1-in / 2-out splitter (never a trivial 1-in/1-out pass-through). The lane
/// feeds the splitter's one input; one output continues the lane, and the other peels
/// a short branch off onto the adjacent row that curves straight back and side-loads
/// onto the lane two tiles downstream — so the splitter genuinely routes plate across
/// two output belts without ever losing any (a Factorio main-bus staple).
///
/// `branch_below` puts the branch on the row *south* of the lane (the iron lane, whose
/// mid band lies below it); otherwise it goes *north* (the copper lane, whose stations
/// hang below). The splitter's two-tile footprint always straddles the lane row and
/// the branch row, so `place_lane_skipping` need only skip column `sx`.
///
/// The branch is a short buffer belt: the splitter routes plate onto it (so it is a
/// genuine 1-in/2-out, never a 1-in/1-out pass-through), and once it fills the
/// splitter sends the rest down the lane — so no plate is lost and the lane's
/// throughput is preserved. Kept to a single tile so the extra state the transport
/// reference must fingerprint stays tiny.
fn distribution_splitter(p: &mut Placer, sx: i32, lane_row: i32, branch_below: bool, tier: &str) {
    let anchor_y = if branch_below { lane_row } else { lane_row - 1 };
    let branch_row = if branch_below {
        lane_row + 1
    } else {
        lane_row - 1
    };
    p.splitter(sx, anchor_y, Dir::E);
    // The branch faces east so the splitter recognises it as a live second output.
    p.belt(sx + 1, branch_row, Dir::E, tier);
}

/// Iron smelters: an ore backbone in the left third feeding a row of plate
/// assemblers that lift iron-plate onto the iron lane from above.
fn iron_smelters(p: &mut Placer, ibus: i32, smelt_x: i32, tier: &str, period: u32) {
    let ob = ibus - 6; // ore backbone row
    p.source_period(0, ob, Dir::E, "iron-ore", period);
    p.hbelt(1, smelt_x, ob, tier);
    let mut cx = 3;
    while cx + 1 < smelt_x {
        p.inserter(cx, ob + 1, Dir::S); // ore off the backbone -> plate assembler
        p.assembler(cx - 1, ob + 2, "iron-plate"); // rows ob+2..ob+4
        p.inserter(cx, ob + 5, Dir::S); // plate off the assembler -> iron lane
        cx += 3;
    }
}

/// Copper smelters: an ore backbone in the left third (below the copper lane)
/// feeding plate assemblers that lift copper-plate onto the copper lane from below.
fn copper_smelters(p: &mut Placer, cbus: i32, smelt_x: i32, tier: &str, period: u32) {
    let ob = cbus + 6; // ore backbone row (below the lane)
    p.source_period(0, ob, Dir::E, "copper-ore", period);
    p.hbelt(1, smelt_x, ob, tier);
    let mut cx = 3;
    while cx + 1 < smelt_x {
        p.inserter(cx, ob - 1, Dir::N); // ore off the backbone -> plate assembler
        p.assembler(cx - 1, ob - 4, "copper-plate"); // rows ob-4..ob-2
        p.inserter(cx, ob - 5, Dir::N); // plate off the assembler -> copper lane
        cx += 3;
    }
}

/// A gear station tapping the iron lane from **above** (rows `ibus-6..ibus-1`):
/// iron-plate up into an `iron-gear` assembler, the gear up to a sink.
fn gear_station_above(p: &mut Placer, gx: i32, ibus: i32, _tier: &str) {
    p.inserter(gx, ibus - 1, Dir::N); // pick iron-plate off the lane -> assembler
    p.assembler(gx - 1, ibus - 4, "iron-gear"); // rows ibus-4..ibus-2
    p.inserter(gx, ibus - 5, Dir::N); // gear off the assembler -> sink
    p.sink(gx, ibus - 6, Dir::N);
}

/// A gear station tapping the iron lane from **below** (rows `ibus+1..ibus+6`).
fn gear_station_below(p: &mut Placer, gx: i32, ibus: i32, _tier: &str) {
    p.inserter(gx, ibus + 1, Dir::S);
    p.assembler(gx - 1, ibus + 2, "iron-gear"); // rows ibus+2..ibus+4
    p.inserter(gx, ibus + 5, Dir::S);
    p.sink(gx, ibus + 6, Dir::S);
}

/// A cable station tapping the copper lane from **below** (rows `cbus+1..cbus+6`).
fn cable_station_below(p: &mut Placer, cx: i32, cbus: i32, _tier: &str) {
    p.inserter(cx, cbus + 1, Dir::S);
    p.assembler(cx - 1, cbus + 2, "copper-cable"); // rows cbus+2..cbus+4
    p.inserter(cx, cbus + 5, Dir::S);
    p.sink(cx, cbus + 6, Dir::S);
}

// The cores build vertically down the tall mid band, fed by two plate risers: an
// **iron riser** (a vertical belt on the core's west edge, tapped off the iron lane
// at the top) and a **copper riser** (on the east edge, tapped off the copper lane
// at the bottom). Both dead-end and so saturate, keeping every tap fed. A core's
// columns, west→east, are: iron riser `cx`, iron-tap gap `cx+1`, the stacked 3-wide
// assemblers `cx+2..cx+4`, copper-tap gap `cx+5`, copper riser `cx+6`. Each stacked
// assembler picks the plate it needs off the adjacent riser (through the gap
// column) and the intermediate it needs off the assembler directly above it; the
// bottom assembler's product drains south to a sink.

/// An iron riser: a vertical belt at column `x` carrying iron-plate down from the
/// iron lane (`ibus`) through row `y1`, fed by a tap inserter at the top. Dead-ends
/// at `y1`, so it saturates and every tap below stays fed.
fn iron_riser(p: &mut Placer, x: i32, ibus: i32, y1: i32, tier: &str) {
    p.inserter(x, ibus + 1, Dir::S); // tap the lane -> riser top
    for y in (ibus + 2)..=y1 {
        p.belt(x, y, Dir::S, tier);
    }
}

/// A copper riser: a vertical belt at column `x` carrying copper-plate up from the
/// copper lane (`cbus`) through row `y0`, fed by a tap inserter at the bottom.
fn copper_riser(p: &mut Placer, x: i32, cbus: i32, y0: i32, tier: &str) {
    p.inserter(x, cbus - 1, Dir::N); // tap the lane -> riser top
    for y in y0..=(cbus - 2) {
        p.belt(x, y, Dir::N, tier);
    }
}

/// Drain a core's bottom assembler (anchor at `cx+2`, rows `y..y+2`) south to its
/// The craft-tree tips, built on two shared dead-end horizontal **sub-buses** in
/// the mid band: a **gear sub-bus** (row `gb`) fed by gear producers that tap the
/// iron lane, and a **circuit sub-bus** (row `qb`) fed by a circuit producer (a
/// copper-riser cable assembler feeding an iron-riser circuit assembler). Four tip
/// stations then hang off the sub-buses, each draining a distinct product east to
/// its own single-item sink:
/// - a **circuit** drain (surplus circuit off the circuit bus);
/// - a **transport-belt** tip (gear bus + iron riser);
/// - an **inserter** tip (gear bus + circuit bus);
/// - an **assembler** tip (an inline transport-belt from the gear bus, combined with
///   the circuit bus).
///
/// Every intermediate rides a belt for a stretch, so the works is a busy, spread
/// block of machinery — not an ore backbone — occupying the whole mid band width.
fn machine_works(p: &mut Placer, x0: i32, ibus: i32, cbus: i32, tier: &str) {
    // Two self-contained vertical stations, each with its copper riser at its clear
    // west edge (so the long riser crosses nothing) and vertical intermediate belts.
    inserter_station(p, x0, ibus, cbus, tier);
    assembler_station(p, x0 + 11, ibus, cbus, tier);
}

/// A **circuit belt** (`cq = x0+3`) and a **gear belt** (`cg = x0+9`), each a
/// dead-end vertical belt fed by a producer at the top, with an `inserter` converge
/// assembler between them tapping circuit (west) and gear (east). Ten columns wide.
fn vertical_source_belts(p: &mut Placer, x0: i32, ibus: i32, cbus: i32, tier: &str) {
    let cq = x0 + 3;
    let cg = x0 + 9;
    let bot = ibus + 14; // vertical belts end just below the converge station, then drain
    // Circuit producer: copper riser (col x0, clear) -> cable -> circuit -> circuit belt.
    copper_riser(p, x0, cbus, ibus + 3, tier); // belts (x0, ibus+3..cbus-2)
    iron_riser(p, x0 + 6, ibus, ibus + 7, tier); // IR1 belts (x0+6, ibus+2..ibus+7)
    p.assembler(x0 + 2, ibus + 2, "copper-cable"); // rows ibus+2..ibus+4
    p.inserter(x0 + 1, ibus + 3, Dir::E); // copper riser -> cable left-mid
    p.assembler(x0 + 2, ibus + 6, "circuit"); // rows ibus+6..ibus+8
    p.inserter(x0 + 5, ibus + 7, Dir::W); // IR1 -> circuit right-mid
    p.inserter(x0 + 3, ibus + 5, Dir::S); // cable bottom -> circuit top-mid
    p.inserter(cq, ibus + 9, Dir::S); // circuit bottom -> circuit belt top
    for y in (ibus + 10)..=bot {
        p.belt(cq, y, Dir::S, tier);
    }
    // Gear producer (anchor x0+8) -> gear belt at cg = x0+9.
    p.inserter(cg, ibus + 1, Dir::S); // iron lane -> gear assembler top-mid
    p.assembler(x0 + 8, ibus + 2, "iron-gear"); // cols x0+8..x0+10, rows ibus+2..ibus+4
    p.inserter(cg, ibus + 5, Dir::S); // gear bottom-mid -> gear belt top
    for y in (ibus + 6)..=bot {
        p.belt(cg, y, Dir::S, tier);
    }
    // Surplus-circuit drain off the circuit belt bottom (sink above the copper lane).
    p.inserter(cq, bot + 1, Dir::S);
    p.sink(cq, bot + 2, Dir::S);
}

/// The vertical source belts plus an `inserter` converge assembler. Ten columns wide.
fn inserter_station(p: &mut Placer, x0: i32, ibus: i32, cbus: i32, tier: &str) {
    let cg = x0 + 9;
    vertical_source_belts(p, x0, ibus, cbus, tier);
    let iy = ibus + 12; // rows iy..iy+2
    p.assembler(x0 + 5, iy, "inserter"); // cols x0+5..x0+7
    p.inserter(x0 + 4, iy + 1, Dir::E); // circuit belt (cq) -> inserter left-mid
    p.inserter(cg - 1, iy + 1, Dir::W); // gear belt (cg) -> inserter right-mid
    p.inserter(x0 + 6, iy - 1, Dir::N); // inserter top-mid -> sink
    p.sink(x0 + 6, iy - 2, Dir::N);
}

/// A circuit belt (`cq = x0+3`) and a transport-belt belt (`cb = x0+9`), each fed by
/// a producer at the top, with an `assembler` converge assembler between them tapping
/// circuit (west) and transport-belt (east). The transport-belt producer builds an
/// inline gear then a transport-belt; a surplus transport-belt drains to its own
/// sink. Thirteen columns wide (`x0..x0+12`).
fn assembler_station(p: &mut Placer, x0: i32, ibus: i32, cbus: i32, tier: &str) {
    let cq = x0 + 3; // circuit belt
    let cb = x0 + 9; // transport-belt belt
    let bot = ibus + 14; // vertical belts end just below the converge station, then drain
    // Circuit producer: copper riser -> cable -> circuit -> circuit belt.
    copper_riser(p, x0, cbus, ibus + 3, tier);
    iron_riser(p, x0 + 6, ibus, ibus + 7, tier); // IR1 for circuit
    p.assembler(x0 + 2, ibus + 2, "copper-cable");
    p.inserter(x0 + 1, ibus + 3, Dir::E); // copper -> cable left-mid
    p.assembler(x0 + 2, ibus + 6, "circuit");
    p.inserter(x0 + 5, ibus + 7, Dir::W); // IR1 -> circuit right-mid
    p.inserter(x0 + 3, ibus + 5, Dir::S); // cable -> circuit top-mid
    p.inserter(cq, ibus + 9, Dir::S); // circuit -> circuit belt
    for y in (ibus + 10)..=bot {
        p.belt(cq, y, Dir::S, tier);
    }
    // Transport-belt producer: gear (inline, iron lane) then transport-belt (gear + iron).
    p.inserter(x0 + 9, ibus + 1, Dir::S); // iron lane -> gear assembler top-mid
    p.assembler(x0 + 8, ibus + 2, "iron-gear"); // cols x0+8..x0+10
    iron_riser(p, x0 + 12, ibus, ibus + 7, tier); // IR2 for the belt assembler
    p.assembler(x0 + 8, ibus + 6, "transport-belt"); // cols x0+8..x0+10
    p.inserter(x0 + 9, ibus + 5, Dir::S); // gear bottom -> belt top-mid
    p.inserter(x0 + 11, ibus + 7, Dir::W); // IR2 -> belt right-mid
    p.inserter(cb, ibus + 9, Dir::S); // belt bottom-mid -> transport-belt belt top
    for y in (ibus + 10)..=bot {
        p.belt(cb, y, Dir::S, tier);
    }
    // Surplus transport-belt drain.
    p.inserter(cb, bot + 1, Dir::S);
    p.sink(cb, bot + 2, Dir::S);
    // Assembler converge assembler between the two belts.
    let ay = ibus + 12;
    p.assembler(x0 + 5, ay, "assembler"); // cols x0+5..x0+7
    p.inserter(x0 + 4, ay + 1, Dir::E); // circuit belt -> assembler left-mid
    p.inserter(cb - 1, ay + 1, Dir::W); // transport-belt belt -> assembler right-mid
    p.inserter(x0 + 6, ay + 3, Dir::S); // assembler bottom-mid -> sink
    p.sink(x0 + 6, ay + 4, Dir::S);
}

/// A compact fallback for small grids: a single iron plate lane fed by a couple of
/// smelters, a rank of gear stations, and one split-merge balancer. Valid, solving,
/// ore-confined, and single-item-sinked — the spread rules apply only to the
/// generous grids.
fn simple_bus(p: &mut Placer, rng: &mut SplitMix64, width: i32, height: i32) {
    let smelt_x = smelt_boundary(width);
    let tier = pick_tier(rng);
    let period = tier_period(&tier);
    let ibus = 6.min(height - 8).max(2);
    if ibus < 6 || height < 13 {
        // Too small for the aisle. A factory never ships raw ore, so rather than sink
        // it, the fallback is a lone ore source feeding a dead-end backbone (it piles
        // up at the end): valid, solving, and no sink ever consumes raw ore.
        p.source_period(0, 0, Dir::E, "iron-ore", period);
        p.hbelt(1, (width - 1).max(2), 0, &tier);
        return;
    }
    let bal = smelt_x + 2;
    place_lane_skipping(p, ibus, width, &tier, &[bal]);
    iron_smelters(p, ibus, smelt_x, &tier, period);
    // A real 1-in/2-out distribution splitter (branch curves back onto the lane),
    // never a trivial pass-through.
    distribution_splitter(p, bal, ibus, true, &tier);
    let pitch = (width / 6).clamp(4, 7);
    let bottom = height - 1;
    for gx in station_columns(width, smelt_x, pitch) {
        // Skip the splitter's columns and the two branch columns beside it.
        if (bal..=bal + 2).contains(&gx) {
            continue;
        }
        gear_station_above(p, gx, ibus, &tier);
        if ibus + 6 <= bottom {
            gear_station_below(p, gx, ibus, &tier);
        }
    }
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
