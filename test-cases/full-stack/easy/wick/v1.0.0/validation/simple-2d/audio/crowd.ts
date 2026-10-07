// audio/crowd — the one night the two "once per tick" points about a weapon
// share: Flare alone over a ring of moths, every one of which the burst
// damages and kills on the same tick. CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// points rather than inside one of them.
//
// WHY FLARE, AND WHY THIS MANY. specs/weapons.md, Flare: "On firing, every
// enemy within `radius` of the player's center takes `damage` on that tick",
// and every row of `FLARE_LEVELS` gives radius `640` and row 1 damage `100`.
// specs/enemies.md gives a moth `5` HP, so one burst damages and kills every
// moth inside the radius on the tick it fires, which is the only way to raise
// one cue's event many times on a single tick.
//
// WHY THE RING. `CROWD_RADIUS` (200) is well inside the row's `640`, so every
// moth is inside the burst with a wide margin, and the moths are spread evenly
// around the lamplighter so no two share a position. No moth stands within
// `PLAYER_RADIUS` plus a moth's radius of the lamplighter, so contact never
// enters the reading, and `enemyContact` is off besides.

import { assertEqual } from "../assert";
import {
  armWeapon,
  holdWeapon,
  isolate,
  pointAt,
  spawnEnemyAt,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** How many moths stand in the burst: the count the review items name. */
export const CROWD = 20;

/** The ring the moths stand on, well inside Flare's radius of 640. */
export const CROWD_RADIUS = 200;

/** The level Flare is held at: row 1, damage 100, radius 640. */
export const FLARE_LEVEL = 1;

/** What {@link poseCrowd} posed. */
export interface CrowdPose {
  /** The slot Flare took. */
  slot: number;
  /** The night as posed, before the firing tick ran. */
  posed: WickSnapshot;
}

/**
 * An isolated night holding Flare alone at row 1, with `CROWD` moths evenly
 * spaced on a circle of `CROWD_RADIUS` about the lamplighter's center, and the
 * weapon armed so the burst fires on the next tick: "`setWeaponCooldown(slot,
 * 0)` makes that the next tick" (specs/instrumentation.md).
 *
 * Every switch but `weaponFire` stays off, so nothing spawns, nothing moves,
 * nothing touches the lamplighter, and the only event of the firing tick is
 * the burst reaching the ring.
 */
export function poseCrowd(h: Harness): CrowdPose {
  isolate(h);
  const { player } = h.snapshot().run;
  for (let i = 0; i < CROWD; i += 1) {
    const at = pointAt(player, CROWD_RADIUS, (i * 360) / CROWD);
    spawnEnemyAt(h, "moth", at.x, at.y);
  }
  const slot = holdWeapon(h, "flare", FLARE_LEVEL);
  const posed = h.snapshot();
  assertEqual(posed.run.enemies.length, CROWD, "the moths posed in the ring");
  assertEqual(posed.run.kills, 0, "kills before the firing tick");
  armWeapon(h, slot);
  return { slot, posed };
}

/**
 * The firing tick reached every moth: none is left alive and `kills` counts
 * all of them, which is what makes the count of cues a reading about the
 * once-per-tick rule rather than about one hit.
 *
 * specs/weapons.md, Hits and death: "An enemy whose `hp` is at or below `0`
 * after the hits of a tick dies"; specs/enemies.md gives a moth `5` HP against
 * row 1's damage of `100`.
 */
export function assertCrowdFell(after: WickSnapshot): void {
  assertEqual(after.run.enemies.length, 0, "moths alive after the burst");
  assertEqual(after.run.kills, CROWD, "kills after the burst");
}
