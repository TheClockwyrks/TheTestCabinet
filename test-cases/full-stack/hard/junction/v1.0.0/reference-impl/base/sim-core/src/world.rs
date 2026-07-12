// Junction — the tile grid: the struct-of-arrays world the sim sweeps every tick
// (specs/map.md, DESIGN §2.2), ported from the TS `world.ts`. Dense arrays indexed by
// `idx = row*MAP_COLS + col` hold the per-tile fields (terrain, zone, carriers, tier, the
// diffusing pollution/land fields, the served/access flags, the live traffic load), plus a
// list of placed 2×2 sources. It also generates the starter valley (a winding river, a
// couple of hills) and the index / buildability / net-bitmask helpers every later module
// keys off. It owns no rendering and no economy — just the land and its shape.

use crate::constants::*;
use crate::rng::Rng;
use crate::types::{Source, Terrain, ZoneKind};

// Terrain integer encodings (must match the TS TERRAIN_ORDER + the renderer's palette map).
pub const T_EARTH: u8 = 0;
pub const T_GRASS: u8 = 1;
pub const T_WATER: u8 = 2;
pub const T_HILL: u8 = 3;

/// 4-neighbour offsets shared by the tile sweeps.
pub const NEIGHBORS: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

#[inline]
pub fn idx(col: i32, row: i32) -> usize {
    (row * MAP_COLS as i32 + col) as usize
}
#[inline]
pub fn col_of(i: usize) -> i32 {
    (i % MAP_COLS) as i32
}
#[inline]
pub fn row_of(i: usize) -> i32 {
    (i / MAP_COLS) as i32
}
#[inline]
pub fn in_bounds(col: i32, row: i32) -> bool {
    col >= 0 && col < MAP_COLS as i32 && row >= 0 && row < MAP_ROWS as i32
}

pub struct World {
    // Per-tile fields (DESIGN §2.2). The u8/f32 arrays are read zero-copy by the renderer.
    pub terrain: Vec<u8>,
    pub zone: Vec<u8>, // 0 = none, else ZoneKind as u8 + 1
    pub net: Vec<u8>,  // carrier bitmask (NET_*)
    pub tier: Vec<u8>, // 0 = empty lot, 1..3 density tier
    pub build: Vec<f32>,
    pub decay: Vec<f32>,
    pub pollution: Vec<f32>,
    pub land: Vec<f32>,
    pub powered: Vec<u8>,
    pub watered: Vec<u8>,
    pub access: Vec<u8>,
    pub road_net: Vec<i16>,
    pub rail_net: Vec<i16>,
    pub power_net: Vec<i16>,
    pub water_net: Vec<i16>,
    pub load: Vec<f32>,
    pub cap: Vec<f32>,

    // Sim scratch / derived static fields (kept here so the tick passes stay cheap sweeps).
    pub prev_load: Vec<f32>,
    pub poll_scratch: Vec<f32>,
    pub water_dist: Vec<f32>,
    pub station_bonus: Vec<f32>,
    pub access_node: Vec<i32>,

    pub sources: Vec<Source>,
    pub next_source_id: u32,
}

impl World {
    pub fn new() -> World {
        World {
            terrain: vec![0; TILE_COUNT],
            zone: vec![0; TILE_COUNT],
            net: vec![0; TILE_COUNT],
            tier: vec![0; TILE_COUNT],
            build: vec![0.0; TILE_COUNT],
            decay: vec![0.0; TILE_COUNT],
            pollution: vec![0.0; TILE_COUNT],
            land: vec![0.0; TILE_COUNT],
            powered: vec![0; TILE_COUNT],
            watered: vec![0; TILE_COUNT],
            access: vec![0; TILE_COUNT],
            road_net: vec![-1; TILE_COUNT],
            rail_net: vec![-1; TILE_COUNT],
            power_net: vec![-1; TILE_COUNT],
            water_net: vec![-1; TILE_COUNT],
            load: vec![0.0; TILE_COUNT],
            cap: vec![0.0; TILE_COUNT],
            prev_load: vec![0.0; TILE_COUNT],
            poll_scratch: vec![0.0; TILE_COUNT],
            water_dist: vec![0.0; TILE_COUNT],
            station_bonus: vec![0.0; TILE_COUNT],
            access_node: vec![-1; TILE_COUNT],
            sources: Vec::new(),
            next_source_id: 1,
        }
    }

    pub fn terrain_at(&self, i: usize) -> Terrain {
        match self.terrain[i] {
            T_GRASS => Terrain::Grass,
            T_WATER => Terrain::Water,
            T_HILL => Terrain::Hill,
            _ => Terrain::Earth,
        }
    }
    pub fn zone_at(&self, i: usize) -> Option<ZoneKind> {
        ZoneKind::from_code(self.zone[i])
    }
    pub fn set_zone(&mut self, i: usize, kind: Option<ZoneKind>) {
        self.zone[i] = match kind {
            None => 0,
            Some(k) => k.code(),
        };
    }

    #[inline]
    pub fn has_net(&self, i: usize, bit: u8) -> bool {
        self.net[i] & bit != 0
    }
    #[inline]
    pub fn set_net(&mut self, i: usize, bit: u8) {
        self.net[i] |= bit;
    }

    /// A developed tile: zoned and built to at least tier 1.
    #[inline]
    pub fn developed_at(&self, i: usize) -> bool {
        self.zone[i] != 0 && self.tier[i] > 0
    }
}

impl Default for World {
    fn default() -> Self {
        World::new()
    }
}

/// Bare land the city can zone/build on (specs/map.md): earth or grass, never water/hill.
pub fn buildable(w: &World, i: usize) -> bool {
    let t = w.terrain[i];
    t == T_EARTH || t == T_GRASS
}
/// A carrier may cross this tile only as a span (bridge/tunnel): water or hill.
pub fn needs_span(w: &World, i: usize) -> bool {
    let t = w.terrain[i];
    t == T_WATER || t == T_HILL
}

// ---- The starter valley (specs/mode.md) ----------------------------------------
// A mostly-flat buildable valley: broad earth/grass, a winding river across the upper band
// (a water source + amenity) and a couple of low hills that fragment the cheap land. The
// pre-placed road stub is laid by `Game::new_city` from the mode config; this generator
// produces only the terrain and the static water-distance field.
pub fn generate_valley(seed: u32) -> World {
    let mut w = World::new();
    let mut rng = Rng::new(seed);

    // Base ground: mostly earth with scattered grass patches (both buildable; cosmetic).
    for i in 0..TILE_COUNT {
        w.terrain[i] = if rng.next() < 0.28 { T_GRASS } else { T_EARTH };
    }

    // A winding river across the upper third of the map (rows ~10..26).
    for col in 0..MAP_COLS as i32 {
        let centre = 18 + (7.0 * (col as f64 / 13.0).sin() + 2.5 * (col as f64 / 4.0).sin()).round() as i32;
        for d in -1..=1 {
            let row = centre + d;
            if in_bounds(col, row) {
                w.terrain[idx(col, row)] = T_WATER;
            }
        }
    }

    // Two low hills that break up the open ground (kept clear of the river band and stub).
    stamp_hill(&mut w, 22, 52, 5, &mut rng);
    stamp_hill(&mut w, 74, 48, 4, &mut rng);

    compute_water_dist(&mut w);
    w
}

fn stamp_hill(w: &mut World, cc: i32, cr: i32, radius: i32, rng: &mut Rng) {
    for row in (cr - radius)..=(cr + radius) {
        for col in (cc - radius)..=(cc + radius) {
            if !in_bounds(col, row) {
                continue;
            }
            let i = idx(col, row);
            if w.terrain[i] == T_WATER {
                continue;
            }
            let d = (((col - cc) * (col - cc) + (row - cr) * (row - cr)) as f64).sqrt();
            if d <= radius as f64 - 0.5 * rng.next() {
                w.terrain[i] = T_HILL;
            }
        }
    }
}

// BFS distance (in tiles) from every tile to the nearest water tile — static, so the land
// amenity bonus (specs/economy.md) is a cheap lookup each tick rather than a search.
pub fn compute_water_dist(w: &mut World) {
    const INF: f32 = f32::INFINITY;
    for d in w.water_dist.iter_mut() {
        *d = INF;
    }
    let mut queue: Vec<usize> = Vec::new();
    for i in 0..TILE_COUNT {
        if w.terrain[i] == T_WATER {
            w.water_dist[i] = 0.0;
            queue.push(i);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let i = queue[head];
        head += 1;
        let col = col_of(i);
        let row = row_of(i);
        let d = w.water_dist[i] + 1.0;
        for (dc, dr) in NEIGHBORS {
            let nc = col + dc;
            let nr = row + dr;
            if !in_bounds(nc, nr) {
                continue;
            }
            let j = idx(nc, nr);
            if w.water_dist[j] > d {
                w.water_dist[j] = d;
                queue.push(j);
            }
        }
    }
}
