// Junction — the develop / upgrade / abandon sweep (specs/map.md, DESIGN §4, §3.4).
//
// A zoned tile develops itself when it is connected and served AND there is demand for its
// kind; it grows through three density tiers as land value supports them, and it dilapidates
// and abandons when a precondition is lost. This is a cheap per-tile array pass over the
// gate conditions the transit/utilities/economy passes have already written this tick
// (access, powered, watered, land) plus the monthly RCI demand. Progress is gradual —
// BUILD_TICKS to raise a lot, UPGRADE_TICKS to climb a tier, DECAY_RATE to abandon — so the
// player watches a neighbourhood fill in as it is connected and empty out when neglected. A
// tile crossing into a new tier throws a construction-dust puff for the renderer.

import { BUILD_TICKS, DECAY_RATE, TILE, TILE_COUNT, UPGRADE_TICKS } from "./constants";
import { landFloorForTier } from "./economy";
import { World, colOf, rowOf } from "./world";
import type { Game } from "./sim";

const LAND_HYSTERESIS = 0.12; // slack below the tier's land floor before it abandons

export function stepDevelopment(game: Game): void {
  const w = game.world;
  for (let i = 0; i < TILE_COUNT; i++) {
    const zoneCode = w.zone[i]!;
    if (zoneCode === 0) continue; // unzoned land never develops
    const kind = w.zoneAt(i)!;
    const tier = w.tier[i]!;

    const served = w.access[i]! !== 0 && w.powered[i]! !== 0 && w.watered[i]! !== 0;
    const wanted = demandFor(game, kind) > 0;
    // A developed tile also needs its land not to have collapsed under it (pollution).
    const landOk = tier < 2 || w.land[i]! >= landFloorForTier(tier) - LAND_HYSTERESIS;
    const healthy = served && wanted && (tier === 0 || landOk);

    if (!healthy) {
      abandonStep(game, w, i, tier);
      continue;
    }

    // Growing conditions hold — bleed any dilapidation back down first.
    if (w.decay[i]! > 0) w.decay[i] = Math.max(0, w.decay[i]! - DECAY_RATE);

    if (tier === 0) {
      // Empty lot → build the first low-density building.
      w.build[i]! += 1 / BUILD_TICKS;
      if (w.build[i]! >= 1) {
        w.tier[i] = 1;
        w.build[i] = 0;
        puff(game, i);
      }
    } else if (tier < 3 && w.land[i]! >= landFloorForTier(tier + 1)) {
      // Land supports a denser tier — climb toward it.
      w.build[i]! += 1 / UPGRADE_TICKS;
      if (w.build[i]! >= 1) {
        w.tier[i] = (tier + 1) as 0 | 1 | 2 | 3;
        w.build[i] = 0;
        puff(game, i);
      }
    } else if (w.build[i]! > 0) {
      // Held at its tier (land too low to climb) — let stalled progress relax.
      w.build[i] = Math.max(0, w.build[i]! - 1 / UPGRADE_TICKS);
    }
  }
}

// A tile that lost a precondition dilapidates; at full decay it drops a tier (a tier-1 lot
// reverts to empty), and any construction progress bleeds away.
function abandonStep(game: Game, w: World, i: number, tier: number): void {
  if (w.build[i]! > 0) w.build[i] = Math.max(0, w.build[i]! - DECAY_RATE);
  if (tier === 0) return; // an undeveloped lot has nothing to abandon
  w.decay[i]! += DECAY_RATE;
  if (w.decay[i]! >= 1) {
    w.tier[i] = (tier - 1) as 0 | 1 | 2 | 3;
    w.decay[i] = 0;
    w.build[i] = 0;
    puff(game, i);
  }
}

function demandFor(game: Game, kind: "res" | "com" | "ind"): number {
  return kind === "res" ? game.rci.r : kind === "com" ? game.rci.c : game.rci.d;
}

// A construction-dust puff at a tile crossing into a new tier (paired with the sheet).
function puff(game: Game, i: number): void {
  game.fxQueue.push({ kind: "dust", x: (colOf(i) + 0.5) * TILE, y: (rowOf(i) + 0.5) * TILE, strength: 1 });
}
