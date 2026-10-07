// hurt/flash — the arrangement every check in this directory shares: one
// contact hit landed on a known tick, and the whole frame read back as pixels.
//
// Nothing here asserts a requirement. The checks in this directory are all
// about `hurtFlash`, and `specs/world.md`, Contact damage, gives the timer
// exactly one setter: "The lamplighter carries `hurtFlash`, a timer that
// counts down with the contact cooldowns in phase 7 and is set to
// `HURT_FLASH` on every tick on which a contact hit lands, whatever the number
// of hits that tick." So every scenario below begins the same way — land a
// contact hit on a tick the check names — and the arrangement is written once
// here rather than in each file.
//
// WHY A RAT, AND WHY IT STANDS 20 UNITS OFF. The same pose the `contact`
// category's checks use, for the same reasons. "The enemy's circle overlaps
// the lamplighter's when the distance between their centers is less than the
// enemy's radius plus `PLAYER_RADIUS`" (`specs/world.md`, Contact damage); a
// rat's radius is `12` (`specs/enemies.md`, Common enemies) and
// `PLAYER_RADIUS` is `12`, so the bound is `24` and a center distance of `20`
// sits inside it by four units. A build whose overlap test is the specified
// one, and one off by a unit either way, both land the hit here; where the
// bound falls exactly is the `contact` category's point, not this one's.
//
// WHY THE HIT LANDS ON THE FIRST TICK. "Every enemy carries its own contact
// cooldown, `contactCooldown`, a timer that is `0` when the enemy spawns", and
// a timer at `0` "stays due on every tick until it is set again"
// (`specs/world.md`, Timers), so a rat posed through the surface hits on the
// very next tick and nothing has to be waited for.
//
// WHY THE WORLD IS OTHERWISE EMPTY. `isolate` leaves a `playing` run holding
// nothing, with every driver switch off, so no weapon can kill the rat before
// it reaches the lamplighter, no director spawns a second enemy, and the rat
// stays exactly where it was posed. `enemyContact` is the one switch a check
// that wants the hit turns on, because the hit is what arms the timer.

import { assertLessThan } from "../assert";
import { ENEMIES, PLAYER_RADIUS, type EnemyId } from "../constants";
import {
  advanceTicks,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
  type PixelRect,
  type WickSnapshot,
} from "../harness";

/** The enemy every scenario here is hit by, as the checklist names it. */
export const HIT_ENEMY: EnemyId = "rat";

/** The center distance the rat is posed at: inside `12 + 12` by four units. */
export const HIT_OFFSET = 20;

/**
 * A center distance no overlap rule can reach: eight times the `24` bound the
 * rat's own radius and `PLAYER_RADIUS` give, and well inside the stage, so the
 * rat is on screen and drawn while touching nothing.
 */
export const CLEAR_OFFSET = 200;

/**
 * Pose the shared world: an isolated `playing` run holding one rat at
 * `offset` units from the lamplighter and nothing else. Answers the rat's id.
 *
 * The driver switches are all left off, so a caller turns on exactly the one
 * its scenario needs.
 */
export function poseRat(h: Harness, offset = HIT_OFFSET): number {
  isolate(h);
  return placeEnemyNear(h, HIT_ENEMY, offset, 0);
}

/**
 * Land one contact hit and hand back the snapshot the tick it landed on left.
 *
 * The rat is posed overlapping, `enemyContact` is turned on, and one tick
 * runs. That the hit LANDED is read back before returning, since every check
 * here is about what the hit did and none of them means anything if no hit
 * arrived: `hp` "falls by `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`"
 * (`specs/world.md`, Contact damage), so a landed hit is a fall in `hp`.
 */
export async function armFlash(h: Harness): Promise<WickSnapshot> {
  if (!(HIT_OFFSET < ENEMIES[HIT_ENEMY].radius + PLAYER_RADIUS)) {
    throw new Error("the posed offset must be inside the overlap bound");
  }
  poseRat(h);
  const before = h.snapshot();
  enable(h, "enemyContact");
  const armed = await advanceTicks(h, 1);
  assertLessThan(
    armed.run.player.hp,
    before.run.player.hp,
    `a ${HIT_ENEMY}'s contact hit landed on the tick (specs/world.md, Contact damage)`,
  );
  return armed;
}

/**
 * The whole canvas read back as pixels: every pixel of the stage the frame
 * drew, since the harness renders the `STAGE_W` x `STAGE_H` stage onto a
 * canvas of exactly that size at a device pixel ratio of `1`.
 *
 * `specs/ui.md` fixes no color, no shape, and no place for the hurt cast, so
 * the whole frame is what a check about it compares.
 */
export function stageFrame(h: Harness): PixelRect {
  return h.pixelRect(0, 0, h.canvas.width, h.canvas.height);
}
