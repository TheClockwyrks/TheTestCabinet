// Junction — the develop / upgrade / abandon sweep (specs/map.md, DESIGN §4, §3.4), ported
// from `develop.ts`.
//
// A zoned tile develops itself when it is connected and served AND there is demand for its
// kind; it grows through three density tiers as land value supports them, and it dilapidates
// and abandons when a precondition is lost. This is a cheap per-tile pass over the gate
// conditions the transit/utilities/economy passes wrote this tick (access, powered, watered,
// land) plus the monthly RCI demand. A tile crossing into a new tier throws a
// construction-dust puff for the renderer.

use crate::constants::*;
use crate::economy::land_floor_for_tier;
use crate::types::{FxEvent, FxKind, Rci};
use crate::world::{col_of, row_of, World};

const LAND_HYSTERESIS: f64 = 0.12; // slack below the tier's land floor before it abandons

pub fn step_development(world: &mut World, rci: &Rci, fx_queue: &mut Vec<FxEvent>) {
    for i in 0..TILE_COUNT {
        let zone_code = world.zone[i];
        if zone_code == 0 {
            continue; // unzoned land never develops
        }
        let z = (zone_code - 1) as usize;
        let tier = world.tier[i];

        let served = world.access[i] != 0 && world.powered[i] != 0 && world.watered[i] != 0;
        let wanted = demand_for(rci, z) > 0.0;
        // A developed tile also needs its land not to have collapsed under it (pollution).
        let land_ok = tier < 2 || world.land[i] as f64 >= land_floor_for_tier(tier) - LAND_HYSTERESIS;
        let healthy = served && wanted && (tier == 0 || land_ok);

        if !healthy {
            abandon_step(world, i, tier, fx_queue);
            continue;
        }

        // Growing conditions hold — bleed any dilapidation back down first.
        if world.decay[i] > 0.0 {
            world.decay[i] = (world.decay[i] - DECAY_RATE as f32).max(0.0);
        }

        if tier == 0 {
            // Empty lot → build the first low-density building.
            world.build[i] += (1.0 / BUILD_TICKS) as f32;
            if world.build[i] >= 1.0 {
                world.tier[i] = 1;
                world.build[i] = 0.0;
                puff(fx_queue, i);
            }
        } else if tier < 3 && world.land[i] as f64 >= land_floor_for_tier(tier + 1) {
            // Land supports a denser tier — climb toward it.
            world.build[i] += (1.0 / UPGRADE_TICKS) as f32;
            if world.build[i] >= 1.0 {
                world.tier[i] = tier + 1;
                world.build[i] = 0.0;
                puff(fx_queue, i);
            }
        } else if world.build[i] > 0.0 {
            // Held at its tier (land too low to climb) — let stalled progress relax.
            world.build[i] = (world.build[i] - (1.0 / UPGRADE_TICKS) as f32).max(0.0);
        }
    }
}

// A tile that lost a precondition dilapidates; at full decay it drops a tier (a tier-1 lot
// reverts to empty), and any construction progress bleeds away.
fn abandon_step(world: &mut World, i: usize, tier: u8, fx_queue: &mut Vec<FxEvent>) {
    if world.build[i] > 0.0 {
        world.build[i] = (world.build[i] - DECAY_RATE as f32).max(0.0);
    }
    if tier == 0 {
        return; // an undeveloped lot has nothing to abandon
    }
    world.decay[i] += DECAY_RATE as f32;
    if world.decay[i] >= 1.0 {
        world.tier[i] = tier - 1;
        world.decay[i] = 0.0;
        world.build[i] = 0.0;
        puff(fx_queue, i);
    }
}

fn demand_for(rci: &Rci, z: usize) -> f64 {
    match z {
        Z_RES => rci.r,
        Z_COM => rci.c,
        _ => rci.d,
    }
}

// A construction-dust puff at a tile crossing into a new tier (paired with the sheet).
fn puff(fx_queue: &mut Vec<FxEvent>, i: usize) {
    fx_queue.push(FxEvent {
        kind: FxKind::Dust,
        x: (col_of(i) as f64 + 0.5) * TILE,
        y: (row_of(i) as f64 + 0.5) * TILE,
        strength: 1.0,
    });
}
