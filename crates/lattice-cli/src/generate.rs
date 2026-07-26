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

/// Rows a **smelt** bus-unit occupies (see [`push_smelt_unit`]): an ore bus, a
/// row of tap inserters, two feeder rows, a load-inserter row, a 3×3 assembler
/// band, an unload-inserter row, a product row, and the plate collector — top to
/// bottom. The tap columns march the whole width, so the band's height is fixed
/// but the *number* of assemblers grows with the grid.
const SMELT_HEIGHT: i32 = 11;

/// Rows a **gear** bus-unit occupies (see [`push_gear_unit`]): a single east-
/// running line whose two 3×3 assemblers (iron-plate → iron-gear) share the
/// band's three rows.
const GEAR_HEIGHT: i32 = 3;

/// Rows a **circuit** bus-unit occupies (see [`push_circuit_unit`]): a copper
/// smelting-and-cabling line on top (rows 0–2), a curve row (row 3), and an
/// iron-plate-into-circuit line beneath (rows 4–6) — the full two-input chain
/// built entirely from raw-ore sources.
const CIRCUIT_HEIGHT: i32 = 7;

/// Rows a **farm** bus-unit occupies (see [`push_farm_unit`]): an ore bus, a row
/// of tap inserters, a 3×3 assembler band, an unload-inserter row, and a row of
/// sinks — top to bottom. Each assembler is fed *directly* off the bus and dumps
/// straight to a sink, so the band carries a whole row of assemblers with no belt
/// but the one dense bus.
const FARM_HEIGHT: i32 = 7;

/// The narrowest grid a **farm** unit fits in: the first assembler sits over cols
/// 2–4 and the bus runs to an east sink, so a handful of tiles suffice.
const MIN_FARM_WIDTH: i32 = 10;

/// The narrowest grid a **smelt** unit fits in: the first tap column and its 3×3
/// assembler sit at the west (cols 2–4), leaving room for the ore bus, the plate
/// collector, and their shared east sink.
const MIN_SMELT_WIDTH: i32 = 14;

/// The narrowest grid a **gear** unit fits in: its two chained assemblers plus
/// the loading, transfer, and unloading inserters occupy a fixed ten-tile run to
/// the east of the ore backbone, so the sink needs to sit at x ≥ 12.
const MIN_GEAR_WIDTH: i32 = 13;

/// The narrowest grid a **circuit** unit fits in: its copper and iron machinery
/// occupy a fixed twelve-tile run to the east of the two raw-ore backbones, so
/// the circuit assembler's product inserter and sink land at the east edge.
const MIN_CIRCUIT_WIDTH: i32 = 16;

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

    fn source(&mut self, x: i32, y: i32, dir: Dir, item: &str) {
        self.occupy(x, y);
        self.entities.push(Entity::Source {
            x,
            y,
            dir,
            item: item.to_string(),
            lane: Lane::Both,
            period: BUS_PERIOD,
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
}

/// Pick a belt `tier` from the seed. Tiers are cosmetic (every belt runs at the
/// one `BELT_SPEED`), but varying it keeps generated scenarios distinct and spans
/// the tier names a scored set should see.
fn pick_tier(rng: &mut SplitMix64) -> String {
    BELT_TIERS[rng.below(BELT_TIERS.len())].name.to_string()
}

/// The **Bus** layout: a realistic, interconnected main-bus factory of
/// self-contained horizontal **bus-units**, stacked in non-overlapping bands top
/// to bottom (the same band discipline the Lines layout uses to guarantee no
/// overlap). Five unit shapes, wired end to end, between them cover every entity,
/// both belt-to-belt feeding modes (curve and side-load), the multi-input recipe,
/// and — crucially — the **whole craft tree grown from raw ore alone**. Every
/// `source` in a bus scenario emits only `iron-ore` or `copper-ore`; every
/// intermediate (`iron-plate`, `copper-plate`, `copper-cable`, `iron-gear`,
/// `circuit`) is *crafted on the grid* by an assembler chain, never spawned:
///
/// - a **farm unit** ([`push_farm_unit`], 7 rows) — the primary filler: a whole
///   row of plate `assembler`s tapped *directly* off one dense ore bus, each
///   dumping straight to a sink, with no feed or product belts. It makes the grid
///   busy and densely occupied (a row of working machines) while adding almost no
///   moving-belt mass — which is what keeps the transport engine's warm-up cheap on
///   a large grid, since that warm-up pays for every belt item it fingerprints;
/// - an **ore belt unit** ([`push_belt_unit`], 1–2 rows) — a `source` at the west
///   edge into a full-width `belt` run into an east `sink`, optionally through a
///   `splitter` draining its second output down a reserved row. A dense ore bus for
///   naive mass and the layout's `splitter`; it fills densely (an ore stream at
///   [`BUS_PERIOD`] leaves no empty tile);
/// - a **smelt unit** ([`push_smelt_unit`], 11 rows) — an ore bus tapped by a
///   *row of columns marching the whole width*, each `inserter`-tapping ore onto a
///   south feeder into a 3×3 plate `assembler`, whose crafted plate curves and
///   side-loads onto a shared ore collector into a sink. Exercises belt→belt taps,
///   curves, and side-load merges;
/// - a **gear unit** ([`push_gear_unit`], 3 rows) — an iron-ore backbone feeding a
///   chained `iron-plate` → `iron-gear` pair (two adjacent assemblers bridged by a
///   single transfer inserter), the crafted gear leaving to a sink. Proves the
///   two-stage iron chain and delivers a *product* (`iron-gear`) to a sink;
/// - a **circuit unit** ([`push_circuit_unit`], 7 rows) — the full two-input
///   chain from ore: a copper line (`copper-ore` → `copper-plate` → `copper-cable`)
///   whose cable curves south into a `circuit` assembler, and an iron line
///   (`iron-ore` → `iron-plate`) whose plate feeds the same assembler's other
///   slot; the crafted `circuit` (the other *product*) leaves to a sink. This is
///   the only unit reaching the multi-input recipe and the real copper chain.
///
/// The circuit unit, then the gear unit, then one smelt unit are placed **outright
/// whenever they fit**, in that order: between them they guarantee — on any seed —
/// that both products reach sinks, that the copper chain and every intermediate
/// exist, and that taps/curves/side-loads are graded. A forced two-row ore belt
/// unit then guarantees a `splitter`. The rest of the grid is filled biased hard to
/// farm units (dense occupancy and craft work for almost no belt mass), with the
/// occasional gear or ore belt unit.
///
/// **Every bus source emits at the one fixed [`BUS_PERIOD`]** — see that constant
/// for why a single small harmonic period is what lets the transport engine detect
/// the cycle instead of degrading to the naive cost. The craft tree deepens the
/// warm-up (buffers must fill through the copper chain — which is why the circuit
/// unit bleeds its surplus cable, so the chain settles fast), but the ore backbones
/// dwarf it in naive mass, so the transport engine still leaps whole cycles for a
/// tiny fraction of the naive fuel.
fn bus_layout(rng: &mut SplitMix64, width: i32, height: i32) -> Vec<Entity> {
    let mut placer = Placer::new(width, height);

    let circuit_fits = width >= MIN_CIRCUIT_WIDTH && height >= CIRCUIT_HEIGHT;
    let gear_fits = width >= MIN_GEAR_WIDTH && height >= GEAR_HEIGHT;
    let smelt_fits = width >= MIN_SMELT_WIDTH && height >= SMELT_HEIGHT;
    let farm_fits = width >= MIN_FARM_WIDTH && height >= FARM_HEIGHT;
    let mut y = 0;

    // The circuit unit goes down first whenever it fits: it is the only unit with
    // the multi-input recipe and the full copper chain, and on its own it delivers
    // the `circuit` product to a sink. Leaving that to a dice roll is exactly how a
    // scored set ends up unable to catch an engine that skipped the multi-input
    // recipe (see the Lines layout's circuit line).
    if circuit_fits {
        push_circuit_unit(&mut placer, rng, width, y);
        y += CIRCUIT_HEIGHT;
    }
    // Then a gear unit, so the *other* product (`iron-gear`) always reaches a sink
    // and the two-stage iron chain is always present.
    if gear_fits && height - y >= GEAR_HEIGHT {
        push_gear_unit(&mut placer, rng, width, y);
        y += GEAR_HEIGHT;
    }
    // Then one smelt unit when the remaining height holds it: it is the unit that
    // exercises inserter belt→belt taps, a curve, and a side-load merge, and packs
    // many plate assemblers across the whole width.
    if smelt_fits && height - y >= SMELT_HEIGHT {
        push_smelt_unit(&mut placer, rng, width, y);
        y += SMELT_HEIGHT;
    }
    // A forced two-row ore belt unit guarantees a `splitter` on any grid wide and
    // tall enough for one (the belt unit always carries a splitter when it has its
    // second row), for the same reason the circuit unit is placed outright: leaving
    // it to a coin flip means some scored scenarios silently grade no balancing.
    if width >= 6 && height - y >= BELT_BAND {
        push_belt_unit(&mut placer, rng, width, height, y, true);
        y += BELT_BAND;
    }

    // Fill the rest, biased hard to **farm units**. A farm packs a whole row of
    // assemblers across the grid over one dense ore bus with no other belt, so it
    // makes the factory *busy and densely occupied* while adding almost no
    // moving-belt mass — and moving-belt mass is precisely what the transport
    // engine pays to fingerprint every cycle during its warm-up. Filling with farms
    // rather than long packed belts is what keeps the big grid's transport fuel far
    // under the naive fuel while the grid stays visibly full of working machines. An
    // occasional gear unit adds a crafted product and a packed backbone, and a belt
    // unit lands where a band is too short for a farm (and adds an extra splitter).
    // The smelt unit is deliberately *not* in the fill — it is placed exactly once
    // (above); one is enough for the taps/curve/side-load grading, and a batch of
    // its sparse feeder/product belts would be the only dead belt on the grid.
    while y < height {
        let rows_left = height - y;
        if farm_fits && rows_left >= FARM_HEIGHT && rng.below(4) != 0 {
            push_farm_unit(&mut placer, rng, width, y);
            y += FARM_HEIGHT;
        } else if gear_fits && rows_left >= GEAR_HEIGHT && rng.below(2) == 0 {
            push_gear_unit(&mut placer, rng, width, y);
            y += GEAR_HEIGHT;
        } else {
            // An ore belt unit takes a second row for a splitter's branch when the
            // band has one to spare; on the last single row it is a plain packed bus.
            let two_rows = rows_left >= BELT_BAND;
            push_belt_unit(&mut placer, rng, width, height, y, two_rows);
            y += if two_rows { BELT_BAND } else { 1 };
        }
    }

    placer.entities
}

/// Append a **belt unit** at row `y`: a `source` at the west edge, a full-width
/// `belt` run east into a `sink`, and — when the band has a spare row and the grid
/// is wide enough — a `splitter` one tile in from the east end draining its second
/// output down the reserved row `y + 1` into its own sink.
///
/// This is the bus layout's packed-belt workhorse: a long saturated run is the
/// bulk of the naive engine's per-tick item mass, while costing the transport
/// engine almost nothing once the run compacts to a frozen block. The emitted item
/// is a **raw ore** — `iron-ore` or `copper-ore`, seed-chosen — never a crafted
/// intermediate: in the bus layout only assembler chains produce plates, cables,
/// gears, and circuits, so a source that spawned one would be a fiction the case
/// grades as real. (Which ore rides a backbone belt is cosmetic — it never feeds a
/// machine — but keeping it to the two raw ores is what makes "no source spawns an
/// intermediate" hold for every belt on the grid.)
fn push_belt_unit(
    placer: &mut Placer,
    rng: &mut SplitMix64,
    width: i32,
    height: i32,
    y: i32,
    two_rows: bool,
) {
    let tier = pick_tier(rng);
    let item = if rng.below(2) == 0 {
        "iron-ore"
    } else {
        "copper-ore"
    };
    let sink_x = width - 1;

    placer.source(0, y, Dir::E, item);

    // A splitter needs the row beneath for its second tile and branch belt, and
    // enough width to sit clear of the source and sink.
    let place_splitter = two_rows && y + 1 < height && width >= 6;
    let splitter_x = width - 3;

    for x in 1..sink_x {
        if place_splitter && x == splitter_x {
            placer.splitter(x, y, Dir::E);
            continue;
        }
        placer.belt(x, y, Dir::E, &tier);
    }
    placer.sink(sink_x, y, Dir::E);

    // Drain the splitter's second output down the reserved row into its own sink,
    // so it actually balances across two belts rather than sending everything one
    // way.
    if place_splitter {
        for x in (splitter_x + 1)..sink_x {
            placer.belt(x, y + 1, Dir::E, &tier);
        }
        placer.sink(sink_x, y + 1, Dir::E);
    }
}

/// Append a **smelt unit** in the band at rows `y..y+11`. The band, top to bottom:
///
/// ```text
///  y+0   ore bus:  source ── belt run ────────────────────────────── sink
///  y+1   tap inserter (S)   tap inserter (S)   tap inserter (S)   …   (every 8th column)
///  y+2   feeder belt (S)    feeder belt (S)    feeder belt (S)    …
///  y+3   feeder belt (S)    feeder belt (S)    feeder belt (S)    …
///  y+4   load inserter (S)  load inserter (S)  load inserter (S)  …
///  y+5 ┐                  ┐                  ┐
///  y+6 ├ 3×3 asm (plate)  ├ 3×3 asm (plate)  ├ 3×3 asm (plate)   …
///  y+7 ┘                  ┘                  ┘
///  y+8   unload inserter   unload inserter    unload inserter     …
///  y+9   product belt (S)  product belt (S)   product belt (S)    …
///  y+10  collector: ─── belt run ─────────────────────────────────── sink
/// ```
///
/// Each **tap column** is one full interconnection: a tap `inserter` lifts ore off
/// the bus belt (a belt→belt tap) and drops it onto a south feeder belt; the
/// feeder carries it down to a load inserter that feeds a 3×3 plate `assembler`; an
/// unload inserter lifts the crafted plate onto a south product belt that turns
/// into the collector (a curve) and side-loads onto it (a merge), the collector
/// running east into a sink. All the tap columns smelt the same ore (the bus
/// carries one), chosen by the seed.
///
/// The columns **march the whole width** — one every eight tiles — so a single
/// band packs several assemblers across the grid. Both full-width belts carry their
/// own raw-ore stream so they stay dense: the ore bus feeds the taps, and the
/// bottom collector is itself an ore belt the plates merge into (flowing at the
/// source rate, with gaps for the side-loads) — not a sparse plate-only line that
/// would read as dead belt. The eight-tile spacing is what keeps the ore bus dense:
/// each tap drains it only 1/16 of a tick, so a tap every eight tiles stays well
/// under what the (period-[`BUS_PERIOD`]) source refills, and the bus never depletes
/// into empty stretches the way a tighter row of taps would.
fn push_smelt_unit(placer: &mut Placer, rng: &mut SplitMix64, width: i32, y: i32) {
    let tier = pick_tier(rng);
    // One ore per bus; every tap smelts it. Either single-input plate recipe works.
    let (ore, recipe) = if rng.below(2) == 0 {
        ("copper-ore", "copper-plate")
    } else {
        ("iron-ore", "iron-plate")
    };
    let sink_x = width - 1;
    let collector_row = y + 10;

    // Both full-width belts carry their **own raw-ore stream** so they stay dense:
    // the top ore bus is what the taps lift from, and the bottom collector is an ore
    // belt the crafted plates *side-load into* — it flows at the source's rate (with
    // gaps a plate can merge into) rather than being a sparse plate-only line that
    // would read as dead belt. Both drain into their own east sink. (A plate that
    // merges into the ore stream just rides it to the collector's sink; the sink
    // consumes ore and plate alike.)
    placer.source(0, y, Dir::E, ore);
    for x in 1..sink_x {
        placer.belt(x, y, Dir::E, &tier);
    }
    placer.sink(sink_x, y, Dir::E);
    placer.source(0, collector_row, Dir::E, ore);
    for x in 1..sink_x {
        placer.belt(x, collector_row, Dir::E, &tier);
    }
    placer.sink(sink_x, collector_row, Dir::E);

    // Tap columns every eight tiles across the width. A column at `cx` anchors its
    // 3-wide assembler over `cx-1..cx+1`, so the step of 8 leaves a five-tile gap
    // between adjacent assemblers. The first column sits at `cx = 3` (assembler over
    // 2..4, clear of the source at x = 0) and the last is the greatest
    // `cx ≤ sink_x - 2` (assembler right edge `cx+1 ≤ sink_x - 1`, one tile clear of
    // the east sinks). The wide spacing keeps the ore bus dense: each tap drains it
    // only 1/16 of a tick, so this many taps stays under what the source refills.
    let mut cx = 3;
    while cx <= sink_x - 2 {
        // Tap: pick ore off the bus above (behind, north) and drop onto the feeder
        // below (in front, south).
        placer.inserter(cx, y + 1, Dir::S);
        placer.belt(cx, y + 2, Dir::S, &tier);
        placer.belt(cx, y + 3, Dir::S, &tier);
        // Load: pick off the feeder above, drop into the assembler's top-middle
        // tile below.
        placer.inserter(cx, y + 4, Dir::S);
        placer.assembler(cx - 1, y + 5, recipe);
        // Unload: pick from the assembler's bottom-middle tile above, drop onto the
        // product belt below.
        placer.inserter(cx, y + 8, Dir::S);
        // Product flows south and turns into the collector (a perpendicular
        // belt-to-belt feed) running east to the sink.
        placer.belt(cx, y + 9, Dir::S, &tier);
        cx += 8;
    }
}

/// Append a **farm unit** in the band at rows `y..y+7` — a row of plate assemblers
/// fed *directly* off one ore bus, with **no feed or product belts at all**:
///
/// ```text
///  y+0   ore bus:  source ── belt run ────────────────────────────── sink
///  y+1   tap inserter (S)      tap inserter (S)      …   (every 8th column)
///  y+2 ┐                     ┐
///  y+3 ├ 3×3 asm (plate)     ├ 3×3 asm (plate)       …
///  y+4 ┘                     ┘
///  y+5   unload inserter (S)   unload inserter (S)   …
///  y+6   sink                  sink                  …
/// ```
///
/// The tap `inserter` lifts ore off the bus and drops it **straight into the
/// assembler below** (no feeder belt), and the unload inserter lifts the crafted
/// plate **straight into a sink** (no product belt). The unit is therefore almost
/// pure machinery: a whole row of assemblers crafting across the grid over one
/// dense ore bus, adding lots of occupancy and craft work but almost no moving-belt
/// mass — the opposite trade to the packed ore belt unit. This is what fills a
/// large grid *densely and busily* without inflating the transport engine's warm-up
/// cost (which pays for every belt item it fingerprints each cycle).
///
/// Taps are spaced every eight tiles (assemblers over `cx-1..cx+1`, a five-tile gap
/// between them) so the bus, which each tap drains only 1/16 of a tick, stays dense
/// rather than being emptied by a too-tight row of taps.
fn push_farm_unit(placer: &mut Placer, rng: &mut SplitMix64, width: i32, y: i32) {
    let tier = pick_tier(rng);
    let (ore, recipe) = if rng.below(2) == 0 {
        ("copper-ore", "copper-plate")
    } else {
        ("iron-ore", "iron-plate")
    };
    let sink_x = width - 1;

    // The one dense ore bus the whole row of assemblers taps from.
    placer.source(0, y, Dir::E, ore);
    for x in 1..sink_x {
        placer.belt(x, y, Dir::E, &tier);
    }
    placer.sink(sink_x, y, Dir::E);

    // A row of assemblers, each fed directly off the bus and dumping to its own
    // sink. The first sits over cols 2..4 (clear of the source); the step of eight
    // leaves the bus dense between taps.
    let mut cx = 3;
    while cx <= sink_x - 2 {
        // Tap ore off the bus above straight into the assembler below.
        placer.inserter(cx, y + 1, Dir::S);
        placer.assembler(cx - 1, y + 2, recipe);
        // Lift the crafted plate off the assembler straight into a sink.
        placer.inserter(cx, y + 5, Dir::S);
        placer.sink(cx, y + 6, Dir::S);
        cx += 8;
    }
}

/// Append a **gear unit** in the band at rows `y..y+3` — the two-stage iron chain,
/// crafted entirely from raw ore. The flow rides the band's middle row (`y+1`, the
/// assemblers' centre line) west to east:
///
/// ```text
///  y+0 ┐                  ┐
///  y+1 │ source(iron-ore) ── ore belt run ── [load]→ iron-plate asm →[xfer]→ iron-gear asm →[unload]→ belt → sink
///  y+2 ┘                  ┘
/// ```
///
/// A single `iron-ore` `source` floods a long packed ore backbone (naive mass);
/// a load `inserter` feeds the first assembler `iron-ore` → `iron-plate`; a single
/// **transfer inserter** bridges the two adjacent assemblers, lifting a plate out
/// of the first and dropping it straight into the second (`iron-plate` → the
/// `iron-gear` assembler, whose recipe needs two plates per gear — matched to the
/// plate assembler's one-plate-per-craft output); an unload inserter lifts the
/// crafted `iron-gear` onto a short belt into the sink. The product (`iron-gear`)
/// thus reaches a sink from ore with no spawned intermediate anywhere.
///
/// The machinery is pinned to the *east* so the ore backbone west of it is long
/// and packed while the product belt east of it is a single tile — a long
/// carrying-nothing product run would otherwise read as dead belt.
fn push_gear_unit(placer: &mut Placer, rng: &mut SplitMix64, width: i32, y: i32) {
    let tier = pick_tier(rng);
    let mid = y + 1;
    let sink_x = width - 1;

    // The ten-tile machinery run [load | plate-asm(3) | xfer | gear-asm(3) | unload]
    // then a one-tile product belt and the sink, pinned to the east edge.
    let load_x = sink_x - 10;
    let plate_x = load_x + 1; // iron-plate assembler, cols load_x+1..load_x+3
    let xfer_x = load_x + 4; // transfer inserter between the two assemblers
    let gear_x = load_x + 5; // iron-gear assembler, cols load_x+5..load_x+7
    let unload_x = load_x + 8; // lifts the gear onto the product belt

    // Source floods the ore backbone; belts run packed up to the load inserter.
    placer.source(0, mid, Dir::E, "iron-ore");
    for x in 1..load_x {
        placer.belt(x, mid, Dir::E, &tier);
    }
    placer.inserter(load_x, mid, Dir::E); // ore off the belt → iron-plate assembler
    placer.assembler(plate_x, y, "iron-plate");
    placer.inserter(xfer_x, mid, Dir::E); // plate out of the plate asm → gear asm
    placer.assembler(gear_x, y, "iron-gear");
    placer.inserter(unload_x, mid, Dir::E); // gear out → product belt
    for x in (unload_x + 1)..sink_x {
        placer.belt(x, mid, Dir::E, &tier);
    }
    placer.sink(sink_x, mid, Dir::E);
}

/// Append a **circuit unit** in the band at rows `y..y+7` — the full two-input
/// `circuit` chain, every input crafted from raw ore. A copper line on top and an
/// iron line beneath both flood long packed ore backbones (naive mass), and their
/// products converge on one circuit assembler near the east edge:
///
/// ```text
///  y+0 ┐                        ┐                    ┐
///  y+1 │ src(copper-ore) ─ ore ─[load]→ copper-plate asm →[xfer]→ copper-cable asm →[unload]→ ↓ cable
///  y+2 ┘                        ┘                    ┘                                        ↓  (curve S)
///  y+3                                                              cable [inserter S] ───────┘
///  y+4 ┐                        ┐                    ┌ (cable drops in from the north) ┐
///  y+5 │ src(iron-ore) ─ ore ──[load]→ iron-plate asm →[xfer]→ belt → belt →[load]→ circuit asm →[unload]→ sink
///  y+6 ┘                        ┘                                                     └ (plate in from the west) ┘
/// ```
///
/// The copper line crafts `copper-ore` → `copper-plate` → `copper-cable`, then the
/// cable curves *south* (a two-tile vertical run) and a south-facing inserter drops
/// it into the top slot of the `circuit` assembler. The iron line crafts
/// `iron-ore` → `iron-plate`, which rides a short belt east into a load inserter
/// that drops it into the assembler's west slot. With both inputs present the
/// assembler crafts `circuit` (1 plate + 3 cable per craft), and an unload inserter
/// hands the product straight to the sink at the east edge.
///
/// The copper line **over-produces** cable — two per craft where a circuit needs
/// only one per plate — so a second unload inserter bleeds the surplus straight to
/// a small sink. Without that bleed the surplus backs the cable buffer up and
/// stalls the whole copper chain, and the unit only reaches its steady cycle after
/// many craft periods; that long transient is what would dominate the transport
/// engine's warm-up. Bleeding it lets the copper chain run free and the factory
/// settle far sooner. So `copper-cable` reaches a sink here (via the bleed) while
/// the *products* `iron-gear` and `circuit` reach sinks as the crafted goods they
/// are; this is the unit whose entity list carries the `copper-plate` and
/// `copper-cable` assemblers that prove the real copper chain exists.
fn push_circuit_unit(placer: &mut Placer, rng: &mut SplitMix64, width: i32, y: i32) {
    let tier = pick_tier(rng);
    let sink_x = width - 1;
    let cu_mid = y + 1; // copper line centre (assemblers rows y..y+2)
    let ic_mid = y + 5; // iron/circuit line centre (assemblers rows y+4..y+6)

    // All machinery hangs off a fixed twelve-tile run ending at the east sink, so
    // both ore backbones (cols 1..mx on their rows) stay long and packed.
    let mx = sink_x - 12;

    // --- Copper line: copper-ore → copper-plate → copper-cable, out to a cable belt.
    placer.source(0, cu_mid, Dir::E, "copper-ore");
    for x in 1..mx {
        placer.belt(x, cu_mid, Dir::E, &tier);
    }
    placer.inserter(mx, cu_mid, Dir::E); // ore → copper-plate assembler
    placer.assembler(mx + 1, y, "copper-plate"); // cols mx+1..mx+3, rows y..y+2
    placer.inserter(mx + 4, cu_mid, Dir::E); // plate → copper-cable assembler
    placer.assembler(mx + 5, y, "copper-cable"); // cols mx+5..mx+7, rows y..y+2
    placer.inserter(mx + 8, cu_mid, Dir::E); // cable out → the vertical cable belt
    // The cable curves south down to the circuit assembler's top slot: two belt
    // tiles then a south-facing inserter that drops into the assembler.
    placer.belt(mx + 9, cu_mid, Dir::S, &tier); // dropped here, flows S
    placer.belt(mx + 9, y + 2, Dir::S, &tier);
    placer.inserter(mx + 9, y + 3, Dir::S); // cable → circuit assembler top-middle
    // A second unload inserter drains the copper-cable assembler's *surplus* into a
    // sink. The recipe makes two cable per craft but a circuit needs only one cable
    // per plate, so the cable line over-produces ~2×; without a bleed the surplus
    // backs the cable buffer up, stalls the copper chain, and the whole unit only
    // settles into its steady cycle after many craft periods — which is what
    // dominates the transport engine's warm-up. Bleeding the surplus lets the copper
    // chain run free, so the factory reaches its cycle far sooner (a much cheaper
    // warm-up) while the cable it *does* need still flows to the circuit assembler.
    placer.inserter(mx + 6, y + 3, Dir::S); // surplus cable off the assembler's south
    placer.sink(mx + 6, y + 4, Dir::S);

    // --- Iron/circuit line: iron-ore → iron-plate, plate east into the circuit asm.
    placer.source(0, ic_mid, Dir::E, "iron-ore");
    for x in 1..mx {
        placer.belt(x, ic_mid, Dir::E, &tier);
    }
    placer.inserter(mx, ic_mid, Dir::E); // ore → iron-plate assembler
    placer.assembler(mx + 1, y + 4, "iron-plate"); // cols mx+1..mx+3, rows y+4..y+6
    placer.inserter(mx + 4, ic_mid, Dir::E); // plate out → short plate belt
    placer.belt(mx + 5, ic_mid, Dir::E, &tier);
    placer.belt(mx + 6, ic_mid, Dir::E, &tier);
    placer.inserter(mx + 7, ic_mid, Dir::E); // plate off the belt → circuit asm west slot
    placer.assembler(mx + 8, y + 4, "circuit"); // cols mx+8..mx+10, rows y+4..y+6
    placer.inserter(mx + 11, ic_mid, Dir::E); // circuit out → sink
    placer.sink(sink_x, ic_mid, Dir::E); // sink_x == mx + 12
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
