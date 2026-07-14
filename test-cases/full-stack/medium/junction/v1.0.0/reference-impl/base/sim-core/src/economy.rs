// Junction — the economy: pollution, land value, RCI demand, and the budget settle
// (specs/economy.md, DESIGN §4, §3.7–§3.8), ported from `economy.ts`.
//
// Pollution + land run every tick; RCI + the budget settle once a month. The RCI/tax
// coefficients live in `constants.rs` (validated by the balance harness); the per-capita and
// growth-baseline factors that are not in that table are fixed here.

use crate::constants::*;
use crate::types::{Budget, Clock, GameStats, Rci};
use crate::world::{col_of, idx, in_bounds, row_of, World, NEIGHBORS};

// Tunables not in the RCI table (the demand-loop shape, fixed here per DESIGN §3.8).
const SHOP_PER_CAPITA: f64 = 0.5;
const WORK_PER_CAPITA: f64 = 0.5;
const GOODS_PER_JOB: f64 = 0.15;
const RCI_BASE: f64 = 55.0;
const RCI_BASE_FADE: f64 = 9000.0;
const RCI_DENOM_PAD: f64 = 40.0;

const IND_CODE: u8 = 3; // ZoneKind::Ind.code()

// ---- Pollution field (every tick) ----------------------------------------------
pub fn step_pollution(world: &mut World) {
    // Emit: industry by tier, congested roads by their over-capacity.
    for i in 0..TILE_COUNT {
        let mut add = 0.0f32;
        if world.zone[i] == IND_CODE && world.tier[i] > 0 {
            add += POLL_EMIT_IND[world.tier[i] as usize] as f32;
        }
        if world.net[i] & (NET_ROAD | NET_STATION) != 0 {
            let cap = world.cap[i] as f64;
            if cap > 0.0 {
                add += (POLL_CONGEST * (world.load[i] as f64 / cap - 1.0).max(0.0)) as f32;
            }
        }
        world.pollution[i] += add;
    }

    // Diffuse to 4-neighbours, then decay; clamp.
    let mut nxt = std::mem::take(&mut world.poll_scratch);
    nxt.copy_from_slice(&world.pollution);
    for i in 0..TILE_COUNT {
        let p = world.pollution[i] as f64;
        if p <= 0.0 {
            continue;
        }
        let col = col_of(i);
        let row = row_of(i);
        let mut out = 0.0f64;
        for (dc, dr) in NEIGHBORS {
            let nc = col + dc;
            let nr = row + dr;
            if !in_bounds(nc, nr) {
                continue;
            }
            let share = p * POLL_DIFFUSE;
            nxt[idx(nc, nr)] += share as f32;
            out += share;
        }
        nxt[i] -= out as f32;
    }
    for i in 0..TILE_COUNT {
        world.pollution[i] = ((nxt[i] as f64 * (1.0 - POLL_DECAY)).clamp(0.0, POLL_MAX)) as f32;
    }
    world.poll_scratch = nxt;
}

// ---- Station land bonus (recomputed on network edits, read each tick) ----------
pub fn compute_station_bonus(world: &mut World) {
    for v in world.station_bonus.iter_mut() {
        *v = 0.0;
    }
    for i in 0..TILE_COUNT {
        if world.net[i] & NET_STATION == 0 {
            continue;
        }
        let sc = col_of(i);
        let sr = row_of(i);
        for row in (sr - LAND_STATION_RADIUS)..=(sr + LAND_STATION_RADIUS) {
            for col in (sc - LAND_STATION_RADIUS)..=(sc + LAND_STATION_RADIUS) {
                if !in_bounds(col, row) {
                    continue;
                }
                let d = (((col - sc) * (col - sc) + (row - sr) * (row - sr)) as f64).sqrt();
                if d > LAND_STATION_RADIUS as f64 {
                    continue;
                }
                let bonus = (LAND_STATION * (1.0 - d / LAND_STATION_RADIUS as f64)) as f32;
                let j = idx(col, row);
                if bonus > world.station_bonus[j] {
                    world.station_bonus[j] = bonus;
                }
            }
        }
    }
}

// ---- Land value (every tick) ---------------------------------------------------
pub fn recompute_land(world: &mut World) {
    for i in 0..TILE_COUNT {
        let mut v = LAND_BASE;
        let wd = world.water_dist[i] as f64;
        if wd <= LAND_AMENITY_RADIUS {
            v += LAND_AMENITY_MAX * (1.0 - wd / LAND_AMENITY_RADIUS);
        }
        v += world.station_bonus[i] as f64;
        if world.powered[i] != 0 && world.watered[i] != 0 && world.access[i] != 0 {
            v += LAND_SERVICE;
        }
        v -= LAND_POLL_K * (world.pollution[i] as f64 / POLL_MAX);
        let mut over = 0.0f64;
        let col = col_of(i);
        let row = row_of(i);
        for (dc, dr) in NEIGHBORS {
            let nc = col + dc;
            let nr = row + dr;
            if !in_bounds(nc, nr) {
                continue;
            }
            let j = idx(nc, nr);
            let cap = world.cap[j] as f64;
            if cap > 0.0 {
                over = over.max(world.load[j] as f64 / cap - 1.0);
            }
        }
        v -= LAND_CONGEST_MAX * over.clamp(0.0, 1.0);
        world.land[i] = v.clamp(0.0, 1.0) as f32;
    }
}

/// The land floor a target tier requires (specs/economy.md); tier 1 has no floor.
pub fn land_floor_for_tier(tier: u8) -> f64 {
    LAND_TIER[(tier.max(1).min(3)) as usize]
}

// ---- RCI demand (monthly) ------------------------------------------------------
pub fn update_rci(world: &World, rci: &mut Rci, budget: &Budget) {
    let mut pop = 0.0;
    let mut com_jobs = 0.0;
    let mut ind_jobs = 0.0;
    let mut shops = 0.0;
    for i in 0..TILE_COUNT {
        if !world.developed_at(i) {
            continue;
        }
        let t = world.tier[i] as usize;
        match world.zone[i] {
            1 => pop += POP[Z_RES][t],
            2 => {
                com_jobs += JOBS[Z_COM][t];
                shops += SHOP_CAP[Z_COM][t];
            }
            _ => ind_jobs += JOBS[Z_IND][t],
        }
    }
    let jobs = com_jobs + ind_jobs;
    let tax = budget.tax_rate;
    let base = RCI_BASE * (1.0 - pop / RCI_BASE_FADE).max(0.0);

    let r_target = demand(base, RCI_R_JOB_PULL * jobs, RCI_R_VACANCY_PEN * pop, tax);
    let c_target = demand(
        base,
        RCI_C_SHOP_PULL * pop * SHOP_PER_CAPITA + RCI_C_GOODS_PULL * ind_jobs * GOODS_PER_JOB,
        RCI_C_OVERSUPPLY * shops,
        tax,
    );
    let i_target = demand(
        base,
        RCI_I_COM_PULL * shops + RCI_I_WORKFORCE_PULL * pop * WORK_PER_CAPITA,
        RCI_I_OVERSUPPLY * ind_jobs,
        tax,
    );

    rci.r += (r_target - rci.r) * RCI_EASE;
    rci.c += (c_target - rci.c) * RCI_EASE;
    rci.d += (i_target - rci.d) * RCI_EASE;
}

// One demand target in [-clamp, clamp]: a growth baseline plus the normalized (need−supply)
// pressure, less the tax penalty.
fn demand(base: f64, need: f64, supply: f64, tax: f64) -> f64 {
    let t = base + ((need - supply) / (need + supply + RCI_DENOM_PAD)) * RCI_CLAMP - RCI_TAX_PEN * tax;
    t.clamp(-RCI_CLAMP, RCI_CLAMP)
}

// ---- Budget settle (monthly) — returns true if this settle is bankruptcy -------
pub fn settle_budget(world: &World, budget: &mut Budget, stats: &mut GameStats, clock: &mut Clock) -> bool {
    let tax = budget.tax_rate;
    let mut income = 0.0;
    for i in 0..TILE_COUNT {
        if !world.developed_at(i) {
            continue;
        }
        let t = world.tier[i] as usize;
        let occupants = match world.zone[i] {
            1 => POP[Z_RES][t],
            2 => JOBS[Z_COM][t],
            _ => JOBS[Z_IND][t],
        };
        income += occupants * world.land[i] as f64 * tax * TAX_CAPITA;
    }
    let upkeep = compute_upkeep(world);
    let balance = income - upkeep;

    budget.treasury += balance;
    budget.income = income;
    budget.upkeep = upkeep;
    budget.balance = balance;

    stats.months_survived += 1;
    clock.month += 1;
    if clock.month >= MONTH_COUNT {
        clock.month = 0;
        clock.year += 1;
    }

    budget.treasury <= DEBT_LIMIT && balance < 0.0
}

// Monthly upkeep from every placed link and source (specs/transit.md, specs/utilities.md).
pub fn compute_upkeep(world: &World) -> f64 {
    let mut total = 0.0;
    for i in 0..TILE_COUNT {
        let n = world.net[i];
        if n & NET_CARRIER == 0 {
            continue;
        }
        if n & NET_ROAD != 0 {
            total += UPKEEP[crate::types::Tool::Road as usize];
        }
        if n & NET_RAIL != 0 {
            total += UPKEEP[crate::types::Tool::Rail as usize];
        }
        if n & NET_STATION != 0 {
            total += UPKEEP[crate::types::Tool::Station as usize];
        }
        if n & NET_WIRE != 0 {
            total += UPKEEP[crate::types::Tool::Wire as usize];
        }
        if n & NET_PIPE != 0 {
            total += UPKEEP[crate::types::Tool::Pipe as usize];
        }
        if n & NET_SPAN != 0 {
            total += SPAN_UPKEEP_EXTRA;
        }
    }
    for src in &world.sources {
        total += match src.kind {
            crate::types::SourceKind::Plant => UPKEEP[crate::types::Tool::Plant as usize],
            crate::types::SourceKind::Source => UPKEEP[crate::types::Tool::Source as usize],
        };
    }
    total
}
