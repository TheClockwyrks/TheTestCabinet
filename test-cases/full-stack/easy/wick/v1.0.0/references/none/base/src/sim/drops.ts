// Wick — gems and pickups through a tick (specs/world.md "Gems",
// "Pickups").

import {
  BREAD_HEAL,
  COLLECT_RADIUS,
  CUES,
  GEM_SPEED,
  GEM_VALUES,
  PICKUP_ITEM_RADIUS,
  PLAYER_RADIUS,
  TICK_DT,
} from "../constants";
import type { Pickup } from "../state";
import { pickupRadius, xpMul } from "../stats";
import type { TickContext } from "./context";
import { distance } from "./geometry";
import { heal } from "./lamplighter";
import { gainXp, openChest } from "./progression";

/** Whether a pickup meets the collection condition. */
function collectible(ctx: TickContext, pickup: Pickup): boolean {
  return distance(pickup, ctx.run.player) < PICKUP_ITEM_RADIUS + PLAYER_RADIUS;
}

/**
 * Phase 8: every bread and draft meeting the condition is collected, and of
 * the chests meeting it the lowest id alone.
 */
export function collectPickups(ctx: TickContext): void {
  const { run } = ctx;
  const chest = run.pickups
    .filter((pickup) => pickup.kind === "chest" && collectible(ctx, pickup))
    .reduce<Pickup | null>(
      (lowest, pickup) =>
        lowest === null || pickup.id < lowest.id ? pickup : lowest,
      null,
    );
  const remaining: Pickup[] = [];
  for (const pickup of run.pickups) {
    if (pickup.kind === "chest") {
      if (pickup !== chest) remaining.push(pickup);
      continue;
    }
    if (!collectible(ctx, pickup)) {
      remaining.push(pickup);
      continue;
    }
    if (pickup.kind === "bread") heal(ctx, BREAD_HEAL);
    else for (const gem of run.gems) gem.attracted = true;
    ctx.cues.add(CUES.pickup);
  }
  run.pickups = remaining;
  if (chest !== null) {
    run.chestResult = openChest(ctx);
    ctx.chestCollected = true;
  }
}

/**
 * Phase 9: every gem within `pickupRadius` becomes attracted, every
 * attracted gem moves toward the lamplighter, and every gem within
 * `COLLECT_RADIUS` is collected. A gem dropped on this tick rests for it.
 */
export function attractAndCollectGems(ctx: TickContext): void {
  const { run } = ctx;
  const radius = pickupRadius(run.passives);
  const multiplier = xpMul(run.passives);
  const player = run.player;
  run.gems = run.gems.filter((gem) => {
    if (distance(gem, player) <= radius) gem.attracted = true;
    if (gem.attracted && gem.bornTick < run.tick) {
      const gap = distance(gem, player);
      const step = GEM_SPEED * TICK_DT;
      if (gap <= step) {
        gem.x = player.x;
        gem.y = player.y;
      } else {
        gem.x += ((player.x - gem.x) / gap) * step;
        gem.y += ((player.y - gem.y) / gap) * step;
      }
    }
    if (distance(gem, player) > COLLECT_RADIUS) return true;
    gainXp(run, GEM_VALUES[gem.tier] * multiplier);
    ctx.cues.add(CUES.gem);
    return false;
  });
}
