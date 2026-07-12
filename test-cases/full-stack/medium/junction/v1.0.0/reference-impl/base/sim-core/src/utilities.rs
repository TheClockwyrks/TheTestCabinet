// Junction — power & water: one mechanism, two carriers (specs/utilities.md, DESIGN §4),
// ported from `utilities.ts`.
//
// Power is generated at a plant and carried on wires; water is drawn at a source and carried
// on pipes. Both are the same shape: supply propagates from a source through its connected
// carrier network and reaches the developed tiles ADJACENT to that network. Each tick this
// marks `powered`/`watered`, resolves OVER-DRAW deterministically (the network can't serve
// past its capacity, so the farthest-from-source tiles are starved first — a visible fringe
// blackout), and reports each utility's city-wide supply-vs-demand to the HUD.

use crate::constants::*;
use crate::types::{Balance, GameStats, Source, SourceKind};
use crate::world::{col_of, idx, in_bounds, row_of, World, NEIGHBORS};
use std::collections::HashMap;

pub fn step_utilities(world: &mut World, stats: &mut GameStats) {
    for v in world.powered.iter_mut() {
        *v = 0;
    }
    for v in world.watered.iter_mut() {
        *v = 0;
    }
    let power = serve_network(
        &world.net,
        &world.power_net,
        &mut world.sources,
        &world.zone,
        &world.tier,
        SourceKind::Plant,
        &mut world.powered,
    );
    let water = serve_network(
        &world.net,
        &world.water_net,
        &mut world.sources,
        &world.zone,
        &world.tier,
        SourceKind::Source,
        &mut world.watered,
    );
    stats.power = Balance {
        supply: power.0,
        demand: power.1,
    };
    stats.water = Balance {
        supply: water.0,
        demand: water.1,
    };
}

struct DemandTile {
    tile: usize,
    comp: i16,
    dist: i32,
    units: f64,
}

#[allow(clippy::too_many_arguments)]
fn serve_network(
    net: &[u8],
    net_arr: &[i16],
    sources: &mut [Source],
    zone: &[u8],
    tier: &[u8],
    kind: SourceKind,
    served: &mut [u8],
) -> (f64, f64) {
    let bit = match kind {
        SourceKind::Plant => NET_WIRE,
        SourceKind::Source => NET_PIPE,
    };
    let mut supply = 0.0;
    let mut demand = 0.0;

    // 1. Component capacities from the sources feeding them, and total supply.
    let mut comp_cap: HashMap<i16, f64> = HashMap::new();
    let mut comp_used: HashMap<i16, f64> = HashMap::new();
    let mut seeds: Vec<usize> = Vec::new();
    for src in sources.iter_mut() {
        src.supplied = 0.0;
        if src.kind != kind {
            continue;
        }
        supply += src.capacity;
        let mut first_comp = -1i16;
        for c in adjacent_carriers(net, net_arr, src.col, src.row, bit) {
            let comp = net_arr[c];
            *comp_cap.entry(comp).or_insert(0.0) += src.capacity;
            if first_comp < 0 {
                first_comp = comp;
            }
            seeds.push(c);
        }
        src.net = first_comp as i32;
    }

    // 2. Distance from a source over the carrier network (farthest-first over-draw order).
    let mut dist = vec![-1i32; TILE_COUNT];
    let mut queue: Vec<usize> = Vec::new();
    for &s in &seeds {
        if dist[s] < 0 {
            dist[s] = 0;
            queue.push(s);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let cur = queue[head];
        head += 1;
        let col = col_of(cur);
        let row = row_of(cur);
        let nd = dist[cur] + 1;
        for (dc, dr) in NEIGHBORS {
            let nc = col + dc;
            let nr = row + dr;
            if !in_bounds(nc, nr) {
                continue;
            }
            let j = idx(nc, nr);
            if net[j] & bit != 0 && dist[j] < 0 {
                dist[j] = nd;
                queue.push(j);
            }
        }
    }

    // 3. The zoned tiles that draw on the network: any tile adjacent to a fed carrier, keyed
    //    to the nearest such carrier's component and distance. A developed tile draws its
    //    tier's demand; an EMPTY zoned lot draws nothing but must still read as reachable so
    //    it can develop (service is a precondition — specs/map.md).
    let mut wants: Vec<DemandTile> = Vec::new();
    for i in 0..TILE_COUNT {
        if zone[i] == 0 {
            continue;
        }
        let z = (zone[i] - 1) as usize;
        let units = if tier[i] > 0 { UTIL_DEMAND[z][tier[i] as usize] } else { 0.0 };
        demand += units;
        let mut best_comp = -1i16;
        let mut best_dist = i32::MAX;
        let col = col_of(i);
        let row = row_of(i);
        for (dc, dr) in NEIGHBORS {
            let nc = col + dc;
            let nr = row + dr;
            if !in_bounds(nc, nr) {
                continue;
            }
            let j = idx(nc, nr);
            if net[j] & bit == 0 || dist[j] < 0 {
                continue;
            }
            if dist[j] < best_dist {
                best_dist = dist[j];
                best_comp = net_arr[j];
            }
        }
        if best_comp >= 0 {
            wants.push(DemandTile {
                tile: i,
                comp: best_comp,
                dist: best_dist,
                units,
            });
        }
    }

    // 4. Allocate each component's capacity nearest-first; tiles past capacity go without.
    wants.sort_by(|a, b| a.comp.cmp(&b.comp).then(a.dist.cmp(&b.dist)).then(a.tile.cmp(&b.tile)));
    for dt in &wants {
        let cap = *comp_cap.get(&dt.comp).unwrap_or(&0.0);
        let used = *comp_used.get(&dt.comp).unwrap_or(&0.0);
        if used + dt.units <= cap {
            served[dt.tile] = 1;
            comp_used.insert(dt.comp, used + dt.units);
        }
    }

    // Report how much each source's component actually drew (for the over-draw HUD read).
    for src in sources.iter_mut() {
        if src.kind != kind {
            continue;
        }
        let used = *comp_used.get(&(src.net as i16)).unwrap_or(&0.0);
        src.supplied = src.capacity.min(used);
    }

    (supply, demand)
}

// Carrier tiles (of `bit`) edge-adjacent to a source's 2×2 footprint.
fn adjacent_carriers(net: &[u8], net_arr: &[i16], col: i32, row: i32, bit: u8) -> Vec<usize> {
    let mut out: Vec<usize> = Vec::new();
    for r in row..=row + 1 {
        for c in col..=col + 1 {
            for (dc, dr) in NEIGHBORS {
                let nc = c + dc;
                let nr = r + dr;
                if !in_bounds(nc, nr) {
                    continue;
                }
                // Skip carriers inside the footprint itself; only outward-facing carriers feed.
                if nc >= col && nc <= col + 1 && nr >= row && nr <= row + 1 {
                    continue;
                }
                let j = idx(nc, nr);
                if net[j] & bit != 0 && net_arr[j] >= 0 {
                    out.push(j);
                }
            }
        }
    }
    out
}
