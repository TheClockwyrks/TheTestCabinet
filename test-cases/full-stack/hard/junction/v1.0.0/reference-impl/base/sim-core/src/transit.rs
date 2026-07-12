// Junction — the transit flow: the signature system (specs/transit.md, DESIGN §4), ported
// from `transit.ts`.
//
// Each tick this rebuilds road access, assigns the city's trips onto the network, and
// derives the per-link congestion that feeds back into pathing. The model is AGGREGATE FLOW
// (the spec allows it): residents commute from every developed R tile to the nearest jobs /
// shops, and industry ships goods to the nearest commerce; each trip is routed on a
// multi-source shortest-path tree (`graph::route_field`, weighted by live travel time) and
// its weight laid onto every link it crosses. A link over capacity CONGESTS — its travel
// time climbs, so next tick some trips reroute and the ones that must cross it take longer,
// capping growth through land value. A parallel rail line pulls through-traffic off a jammed
// road corridor — the observable payoff. Visible vehicles are sampled from the active routes
// for legibility; the load they ride is the real computed flow, not decoration.

use crate::constants::*;
use crate::graph::route_field;
use crate::rng::Rng;
use crate::types::{Vehicle, VehicleKind};
use crate::world::{col_of, idx, in_bounds, row_of, World, NEIGHBORS};
use std::collections::BTreeSet;

const VEHICLE_SPEED: f64 = 150.0; // px/s a free-flowing vehicle covers (scaled by congestion)
const GOODS_FRAC: f64 = 0.28; // share of an industry tile's jobs shipped as goods trips
const SPAWN_CHANCE: f64 = 0.06; // per eligible trip source per tick, a visible vehicle sampled

pub fn step_transit(
    world: &mut World,
    vehicles: &mut Vec<Vehicle>,
    rng: &mut Rng,
    next_vehicle_id: &mut u32,
    dt: f64,
) {
    // Roll last tick's load forward (the congestion weight source) and build this tick's fresh.
    let prev = world.load.clone();
    world.prev_load.copy_from_slice(&prev);
    let mut load = vec![0.0f32; TILE_COUNT];
    compute_caps(world);
    compute_access(world);

    // Destinations: developed commerce/industry (jobs + shops) for residents, commerce for
    // goods. Route to the access node each destination reaches the network through.
    let mut job_dests: BTreeSet<usize> = BTreeSet::new();
    let mut com_dests: BTreeSet<usize> = BTreeSet::new();
    for i in 0..TILE_COUNT {
        if !world.developed_at(i) {
            continue;
        }
        let an = world.access_node[i];
        if an < 0 {
            continue;
        }
        match world.zone_at(i) {
            Some(crate::types::ZoneKind::Com) => {
                job_dests.insert(an as usize);
                com_dests.insert(an as usize);
            }
            Some(crate::types::ZoneKind::Ind) => {
                job_dests.insert(an as usize);
            }
            _ => {}
        }
    }

    let job_field = if !job_dests.is_empty() {
        Some(route_field(world, &job_dests.iter().copied().collect::<Vec<_>>()))
    } else {
        None
    };
    let com_field = if !com_dests.is_empty() {
        Some(route_field(world, &com_dests.iter().copied().collect::<Vec<_>>()))
    } else {
        None
    };

    // Residents → jobs/shops.
    if let Some(field) = &job_field {
        for i in 0..TILE_COUNT {
            if world.zone_at(i) != Some(crate::types::ZoneKind::Res) || world.tier[i] == 0 {
                continue;
            }
            let an = world.access_node[i];
            if an < 0 || !field.dist[an as usize].is_finite() {
                continue;
            }
            let trips = COMMUTE_FRAC * POP[Z_RES][world.tier[i] as usize];
            let path = lay_trip_load(&mut load, field, an as usize, trips as f32);
            let kind = if path_has_rail(world, &path) {
                VehicleKind::Tram
            } else {
                VehicleKind::Car
            };
            maybe_spawn(vehicles, rng, next_vehicle_id, &path, kind);
        }
    }
    // Industry → commerce (goods).
    if let Some(field) = &com_field {
        for i in 0..TILE_COUNT {
            if world.zone_at(i) != Some(crate::types::ZoneKind::Ind) || world.tier[i] == 0 {
                continue;
            }
            let an = world.access_node[i];
            if an < 0 || !field.dist[an as usize].is_finite() {
                continue;
            }
            let trips = GOODS_FRAC * JOBS[Z_IND][world.tier[i] as usize];
            let path = lay_trip_load(&mut load, field, an as usize, trips as f32);
            maybe_spawn(vehicles, rng, next_vehicle_id, &path, VehicleKind::Truck);
        }
    }

    world.load = load;
    step_vehicles(world, vehicles, dt);
}

// Per-link capacity from the carrier kind (specs/transit.md): a station reads as a road
// access point (road capacity); rail segments carry far more, so they offload roads.
fn compute_caps(world: &mut World) {
    for i in 0..TILE_COUNT {
        let n = world.net[i];
        let c = if n & (NET_ROAD | NET_STATION) != 0 {
            ROAD_CAP as f32
        } else if n & NET_RAIL != 0 {
            RAIL_CAP as f32
        } else {
            0.0
        };
        world.cap[i] = c;
    }
}

// A zoned tile has road access when it is within WALK_TILES of the road network; the nearest
// road/station tile is its entry node into the transit graph. Multi-source BFS from every
// road/station tile fills both `access` and `access_node` in one pass.
fn compute_access(world: &mut World) {
    for v in world.access.iter_mut() {
        *v = 0;
    }
    for v in world.access_node.iter_mut() {
        *v = -1;
    }
    let mut depth = vec![-1i32; TILE_COUNT];
    let mut queue: Vec<usize> = Vec::new();
    for i in 0..TILE_COUNT {
        if world.net[i] & (NET_ROAD | NET_STATION) != 0 {
            world.access[i] = 1;
            world.access_node[i] = i as i32;
            depth[i] = 0;
            queue.push(i);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let cur = queue[head];
        head += 1;
        let d = depth[cur];
        if d >= WALK_TILES {
            continue;
        }
        let col = col_of(cur);
        let row = row_of(cur);
        let node = world.access_node[cur];
        for (dc, dr) in NEIGHBORS {
            let nc = col + dc;
            let nr = row + dr;
            if !in_bounds(nc, nr) {
                continue;
            }
            let j = idx(nc, nr);
            if depth[j] >= 0 {
                continue; // already reached (a nearer road claimed it)
            }
            depth[j] = d + 1;
            world.access[j] = 1;
            world.access_node[j] = node;
            queue.push(j);
        }
    }
}

// Walk the shortest-path tree from a trip's access node to its nearest destination, adding
// `trips` to every link crossed, and return the tile path (home → destination) for vehicles.
fn lay_trip_load(load: &mut [f32], field: &crate::graph::RouteField, start: usize, trips: f32) -> Vec<usize> {
    let mut path: Vec<usize> = Vec::new();
    let mut cur = start as i32;
    let mut guard = 0;
    while cur >= 0 && guard < TILE_COUNT {
        guard += 1;
        let u = cur as usize;
        load[u] += trips;
        path.push(u);
        if field.dist[u] <= 0.0 {
            break; // reached a destination node
        }
        cur = field.parent[u];
    }
    path
}

fn path_has_rail(world: &World, path: &[usize]) -> bool {
    path.iter().any(|&i| world.net[i] & NET_RAIL != 0)
}

// Sample a visible vehicle from an active route, within the on-screen budget.
fn maybe_spawn(vehicles: &mut Vec<Vehicle>, rng: &mut Rng, next_id: &mut u32, path: &[usize], kind: VehicleKind) {
    if path.len() < 2 {
        return;
    }
    if vehicles.len() >= VEHICLE_CAP_ON_SCREEN {
        return;
    }
    if !rng.bool(SPAWN_CHANCE) {
        return;
    }
    let id = *next_id;
    *next_id += 1;
    vehicles.push(Vehicle {
        id,
        kind,
        path: path.to_vec(),
        seg: 0,
        t: 0.0,
        speed: VEHICLE_SPEED,
        angle: 0.0,
        anim_t: 0.0,
    });
}

// Advance the sampled vehicles along their tile paths, slowed by the congestion of the link
// they are on; retire them at the end of the route.
fn step_vehicles(world: &World, vehicles: &mut Vec<Vehicle>, dt: f64) {
    let mut alive: Vec<Vehicle> = Vec::with_capacity(vehicles.len());
    for mut v in vehicles.drain(..) {
        v.anim_t += dt;
        let from = v.path[v.seg];
        let cap = world.cap[from] as f64;
        let congest = if cap > 0.0 {
            1.0 + (world.load[from] as f64 / cap - 1.0).max(0.0)
        } else {
            1.0
        };
        let tiles_per_sec = v.speed / TILE / congest;
        v.t += tiles_per_sec * dt;
        while v.t >= 1.0 && v.seg < v.path.len() - 1 {
            v.t -= 1.0;
            v.seg += 1;
        }
        if v.seg >= v.path.len() - 1 {
            continue; // reached the destination — retire
        }
        let a = v.path[v.seg];
        let b = v.path[v.seg + 1];
        v.angle = ((row_of(b) - row_of(a)) as f64).atan2((col_of(b) - col_of(a)) as f64);
        alive.push(v);
    }
    *vehicles = alive;
}

/// The current interpolated world-pixel position of a vehicle (for the renderer).
pub fn vehicle_pos(v: &Vehicle) -> (f64, f64) {
    let a = v.path[v.seg];
    let b = v.path[(v.seg + 1).min(v.path.len() - 1)];
    let ax = (col_of(a) as f64 + 0.5) * TILE;
    let ay = (row_of(a) as f64 + 0.5) * TILE;
    let bx = (col_of(b) as f64 + 0.5) * TILE;
    let by = (row_of(b) as f64 + 0.5) * TILE;
    let t = v.t.clamp(0.0, 1.0);
    (ax + (bx - ax) * t, ay + (by - ay) * t)
}

// ---- Traffic signals at road junctions (animated in the renderer) --------------
// A road tile with three or more road neighbours is a junction; it carries an animated
// signal. Rebuilt on any network edit so the signal set tracks the roads.
pub fn rebuild_signals(world: &World, signals: &mut Vec<crate::types::Signal>, rng: &mut Rng) {
    signals.clear();
    for i in 0..TILE_COUNT {
        if world.net[i] & NET_ROAD == 0 {
            continue;
        }
        let col = col_of(i);
        let row = row_of(i);
        let mut n = 0;
        for (dc, dr) in NEIGHBORS {
            let nc = col + dc;
            let nr = row + dr;
            if in_bounds(nc, nr) && world.net[idx(nc, nr)] & NET_ROAD != 0 {
                n += 1;
            }
        }
        if n >= 3 {
            signals.push(crate::types::Signal {
                col,
                row,
                phase: rng.next(),
            });
        }
    }
}
