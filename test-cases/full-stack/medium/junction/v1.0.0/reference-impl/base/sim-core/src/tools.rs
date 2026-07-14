// Junction — the build tools: legality, cost, and placement (specs/controls.md, DESIGN §4),
// ported from `tools.ts`.
//
// One active tool paints the map: zones as a filled rectangle, roads/rail/wire/pipe as a
// dragged L-run, stations/plants/sources as single stamps. This module owns the LEGALITY
// predicate (with a spoken refusal reason for the illegal-placement cursor), the span-aware
// CAPITAL COST, and the mutation that writes the tile arrays / source list and charges the
// treasury. It does not run the sim or rebuild the networks; the `Game` calls it, then
// re-labels the networks when something was placed.

use crate::constants::*;
use crate::types::{ApplyResult, Budget, Source, SourceKind, Tool};
use crate::world::{buildable, col_of, idx, in_bounds, needs_span, row_of, World, NEIGHBORS};

pub struct PlaceCheck {
    pub ok: bool,
    pub reason: Option<&'static str>,
}
impl PlaceCheck {
    fn ok() -> PlaceCheck {
        PlaceCheck { ok: true, reason: None }
    }
    fn no(reason: &'static str) -> PlaceCheck {
        PlaceCheck { ok: false, reason: Some(reason) }
    }
    fn no_bare() -> PlaceCheck {
        PlaceCheck { ok: false, reason: None }
    }
}

// ---- The tile list a drag paints (specs/controls.md) ---------------------------
pub fn tiles_for_drag(tool: Tool, c0: i32, r0: i32, c1: i32, r1: i32) -> Vec<usize> {
    if let DragKind::Stamp = drag_kind(tool) {
        return if in_bounds(c0, r0) { vec![idx(c0, r0)] } else { vec![] };
    }
    let mut out: Vec<usize> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let push = |c: i32, r: i32, out: &mut Vec<usize>, seen: &mut std::collections::HashSet<usize>| {
        if !in_bounds(c, r) {
            return;
        }
        let i = idx(c, r);
        if seen.insert(i) {
            out.push(i);
        }
    };
    if matches!(drag_kind(tool), DragKind::Rect) {
        let lo = r0.min(r1);
        let hi = r0.max(r1);
        let loc = c0.min(c1);
        let hic = c0.max(c1);
        for r in lo..=hi {
            for c in loc..=hic {
                push(c, r, &mut out, &mut seen);
            }
        }
        return out;
    }
    // Carrier run: along row r0 to c1, then along column c1 to r1.
    let step_c = if c1 >= c0 { 1 } else { -1 };
    let mut c = c0;
    while c != c1 + step_c {
        push(c, r0, &mut out, &mut seen);
        c += step_c;
    }
    let step_r = if r1 >= r0 { 1 } else { -1 };
    let mut r = r0;
    while r != r1 + step_r {
        push(c1, r, &mut out, &mut seen);
        r += step_r;
    }
    out
}

// ---- Legality (specs/controls.md) ----------------------------------------------
pub fn can_place(world: &World, tool: Tool, i: usize) -> PlaceCheck {
    if tool.zone_kind().is_some() {
        if !buildable(world, i) {
            return PlaceCheck::no("CAN'T ZONE WATER/HILL");
        }
        if world.net[i] & NET_CARRIER != 0 {
            return PlaceCheck::no("TILE OCCUPIED");
        }
        if source_covering(world, i).is_some() {
            return PlaceCheck::no("TILE OCCUPIED");
        }
        if world.tier[i] > 0 {
            return PlaceCheck::no("BULLDOZE TO RE-ZONE");
        }
        return PlaceCheck::ok();
    }
    match tool {
        Tool::Road => carrier_check(world, i, NET_RAIL, "ROAD CAN'T CROSS RAIL"),
        Tool::Rail => carrier_check(world, i, NET_ROAD, "RAIL CAN'T CROSS ROAD"),
        Tool::Wire | Tool::Pipe => {
            // Utilities may run under roads/zones; only water/hill needs a span.
            if !buildable(world, i) && !needs_span(world, i) {
                return PlaceCheck::no_bare();
            }
            if source_covering(world, i).is_some() {
                return PlaceCheck::no("TILE OCCUPIED");
            }
            PlaceCheck::ok()
        }
        Tool::Station => {
            if world.net[i] & NET_RAIL == 0 {
                return PlaceCheck::no("STATION NEEDS RAIL");
            }
            if !adjacent_to_road(world, i) {
                return PlaceCheck::no("STATION NEEDS ROAD");
            }
            PlaceCheck::ok()
        }
        Tool::Plant => footprint_check(world, i, false),
        Tool::Source => footprint_check(world, i, true),
        _ => PlaceCheck::no_bare(),
    }
}

fn carrier_check(world: &World, i: usize, forbid: u8, forbid_reason: &'static str) -> PlaceCheck {
    if world.net[i] & forbid != 0 {
        return PlaceCheck::no(forbid_reason);
    }
    if source_covering(world, i).is_some() {
        return PlaceCheck::no("TILE OCCUPIED");
    }
    if buildable(world, i) {
        return PlaceCheck::ok();
    }
    if needs_span(world, i) {
        return PlaceCheck::ok(); // priced up as a span
    }
    PlaceCheck::no_bare()
}

// A 2×2 source footprint anchored at (i): every tile buildable and clear; a water source
// additionally must sit beside a water tile.
fn footprint_check(world: &World, i: usize, wants_water: bool) -> PlaceCheck {
    let col = col_of(i);
    let row = row_of(i);
    if col + 1 >= MAP_COLS as i32 || row + 1 >= MAP_ROWS as i32 {
        return PlaceCheck::no("OUT OF BOUNDS");
    }
    for r in row..=row + 1 {
        for c in col..=col + 1 {
            let j = idx(c, r);
            if !buildable(world, j) {
                return PlaceCheck::no("NEEDS FLAT LAND");
            }
            if world.net[j] & NET_CARRIER != 0 {
                return PlaceCheck::no("TILE OCCUPIED");
            }
            if source_covering(world, j).is_some() {
                return PlaceCheck::no("TILE OCCUPIED");
            }
            if world.tier[j] > 0 {
                return PlaceCheck::no("BULLDOZE FIRST");
            }
        }
    }
    if wants_water && !footprint_beside_water(world, col, row) {
        return PlaceCheck::no("SOURCE NEEDS WATER");
    }
    PlaceCheck::ok()
}

fn footprint_beside_water(world: &World, col: i32, row: i32) -> bool {
    for r in row - 1..=row + 2 {
        for c in col - 1..=col + 2 {
            if !in_bounds(c, r) {
                continue;
            }
            if c >= col && c <= col + 1 && r >= row && r <= row + 1 {
                continue;
            }
            if world.terrain[idx(c, r)] == crate::world::T_WATER {
                return true;
            }
        }
    }
    false
}

fn adjacent_to_road(world: &World, i: usize) -> bool {
    let col = col_of(i);
    let row = row_of(i);
    for (dc, dr) in NEIGHBORS {
        let nc = col + dc;
        let nr = row + dr;
        if in_bounds(nc, nr) && world.net[idx(nc, nr)] & (NET_ROAD | NET_STATION) != 0 {
            return true;
        }
    }
    false
}

// ---- Cost (span-aware) ---------------------------------------------------------
pub fn capital_cost_at(world: &World, tool: Tool, i: usize) -> f64 {
    let base = cost_of(tool);
    if is_span_tool(tool) && needs_span(world, i) {
        return base + SPAN_COST_EXTRA;
    }
    base
}

// ---- Apply (charges the treasury, mutates the world) ---------------------------
// Returns the result; the caller re-labels the networks and plays the build cue when
// `placed > 0`.
pub fn apply_tool(world: &mut World, budget: &mut Budget, tool: Tool, tiles: &[usize]) -> ApplyResult {
    if tool == Tool::Bulldoze {
        let (count, _delta) = bulldoze_tiles(world, budget, tiles);
        return ApplyResult {
            placed: count,
            spent: 0.0,
            refused: None,
        };
    }
    let mut placed = 0u32;
    let mut spent = 0.0;
    let mut refused: Option<String> = None;
    for &i in tiles {
        let chk = can_place(world, tool, i);
        if !chk.ok {
            if refused.is_none() {
                refused = chk.reason.map(|s| s.to_string());
            }
            continue;
        }
        let cost = capital_cost_at(world, tool, i);
        if budget.treasury < cost {
            if refused.is_none() {
                refused = Some("NOT ENOUGH FUNDS".to_string());
            }
            break; // a drag run stops at the tile the player can no longer afford
        }
        place_one(world, tool, i);
        budget.treasury -= cost;
        spent += cost;
        placed += 1;
    }
    ApplyResult { placed, spent, refused }
}

fn place_one(world: &mut World, tool: Tool, i: usize) {
    if let Some(kind) = tool.zone_kind() {
        world.set_zone(i, Some(kind));
        return;
    }
    let span = needs_span(world, i);
    match tool {
        Tool::Road => {
            world.set_net(i, NET_ROAD);
            if span {
                world.set_net(i, NET_SPAN);
            }
        }
        Tool::Rail => {
            world.set_net(i, NET_RAIL);
            if span {
                world.set_net(i, NET_SPAN);
            }
        }
        Tool::Wire => {
            world.set_net(i, NET_WIRE);
            if span {
                world.set_net(i, NET_SPAN);
            }
        }
        Tool::Pipe => {
            world.set_net(i, NET_PIPE);
            if span {
                world.set_net(i, NET_SPAN);
            }
        }
        Tool::Station => world.set_net(i, NET_STATION),
        Tool::Plant => add_source(world, SourceKind::Plant, i, POWER_PLANT_CAP),
        Tool::Source => add_source(world, SourceKind::Source, i, WATER_SOURCE_CAP),
        _ => {}
    }
}

fn add_source(world: &mut World, kind: SourceKind, i: usize, capacity: f64) {
    let id = world.next_source_id;
    world.next_source_id += 1;
    world.sources.push(Source {
        id,
        kind,
        col: col_of(i),
        row: row_of(i),
        capacity,
        supplied: 0.0,
        net: -1,
    });
}

// ---- Bulldoze (refund + clear) -------------------------------------------------
pub fn bulldoze_tiles(world: &mut World, budget: &mut Budget, tiles: &[usize]) -> (u32, f64) {
    let mut count = 0u32;
    let mut delta = 0.0;
    for &i in tiles {
        if let Some(si) = source_covering(world, i) {
            let src_kind = world.sources[si].kind;
            let src_cost = match src_kind {
                SourceKind::Plant => cost_of(Tool::Plant),
                SourceKind::Source => cost_of(Tool::Source),
            };
            delta += BULLDOZE_REFUND * src_cost - cost_of(Tool::Bulldoze);
            world.sources.remove(si);
            count += 1;
            continue;
        }
        let cap = existing_capital(world, i);
        if cap <= 0.0 && world.zone[i] == 0 {
            continue; // nothing to raze here
        }
        delta += BULLDOZE_REFUND * cap - cost_of(Tool::Bulldoze);
        world.zone[i] = 0;
        world.net[i] = 0;
        world.tier[i] = 0;
        world.build[i] = 0.0;
        world.decay[i] = 0.0;
        count += 1;
    }
    if count > 0 {
        budget.treasury += delta;
    }
    (count, delta)
}

// The capital originally sunk into a tile's carriers + zone, for the bulldoze refund.
fn existing_capital(world: &World, i: usize) -> f64 {
    let n = world.net[i];
    let mut cap = 0.0;
    if world.zone[i] != 0 {
        cap += cost_of(Tool::ZoneRes);
    }
    if n & NET_ROAD != 0 {
        cap += cost_of(Tool::Road);
    }
    if n & NET_RAIL != 0 {
        cap += cost_of(Tool::Rail);
    }
    if n & NET_STATION != 0 {
        cap += cost_of(Tool::Station);
    }
    if n & NET_WIRE != 0 {
        cap += cost_of(Tool::Wire);
    }
    if n & NET_PIPE != 0 {
        cap += cost_of(Tool::Pipe);
    }
    if n & NET_SPAN != 0 {
        cap += SPAN_COST_EXTRA;
    }
    cap
}

// ---- Shared occupancy helper ---------------------------------------------------
/// The index (into `world.sources`) of the source whose 2×2 footprint covers tile `i`.
pub fn source_covering(world: &World, i: usize) -> Option<usize> {
    let col = col_of(i);
    let row = row_of(i);
    world
        .sources
        .iter()
        .position(|s| col >= s.col && col <= s.col + 1 && row >= s.row && row <= s.row + 1)
}
