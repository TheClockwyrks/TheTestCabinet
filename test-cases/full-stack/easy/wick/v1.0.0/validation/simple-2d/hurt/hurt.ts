// hurt/hurt — what the points of this category share: the night a contact hit
// is landed in, the hit that arms the flash, and the figures the hit is read
// against. CASE-PROVIDED.
//
// No review item names this file. Each function is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them.
//
// WHY A CONTACT HIT IS THE ONLY ARRANGEMENT HERE. specs/world.md ("Contact
// damage"): the lamplighter's `hurtFlash` "is set to `HURT_FLASH` on every tick
// on which a contact hit lands", and "a contact hit is the only thing that sets
// it". The surface carries no operation that poses the timer, so every point of
// this category reaches a running flash the way the game does: an enemy posed
// overlapping the lamplighter, and the tick that lands its hit. That is the
// same arrangement the `contact` category's points are posed in, and the same
// enemy figures decide it.
//
// THE ENEMY, AND THE TWO DISTANCES. specs/world.md ("Contact damage"): "the
// enemy's circle overlaps the lamplighter's when the distance between their
// centers is less than the enemy's radius plus `PLAYER_RADIUS`". A rat's radius
// is 12 and its damage 8 (specs/enemies.md, The roster) and `PLAYER_RADIUS` is
// 12, so a rat inside 24 units of the lamplighter's center overlaps it and one
// outside 24 does not. The two offsets below sit well clear of that boundary in
// each direction, so no rounding of the distance can carry either across it;
// the boundary itself is `contact/contact-overlap-strict`'s point, not this
// category's.

import {
  BASE_MAX_HP,
  ENEMIES,
  PLAYER_RADIUS,
  type EnemyId,
} from "../constants";
import {
  enable,
  isolate,
  spawnEnemyNear,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The enemy every point of this category is hit by: radius 12, damage 8. */
export const HITTER: EnemyId = "rat";

/** The distance the hitter overlaps the lamplighter inside: 12 + 12. */
export const CONTACT_DISTANCE = ENEMIES[HITTER].radius + PLAYER_RADIUS;

/** Where the hitter is posed to overlap: 20 units along +x, 4 inside the sum. */
export const OVERLAP_OFFSET = 20;

/** Where the hitter is posed to overlap nothing: 200 units along +x. */
export const CLEAR_OFFSET = 200;

/**
 * The hp one of the hitter's hits leaves a fresh lamplighter at: `100 - 8`.
 *
 * specs/world.md ("Contact damage"): a hit takes
 * `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`, and "armor is 0 with no Brass
 * held", so the rat's 8 lands unreduced. What a point of this category reads it
 * for is the premise that a hit landed at all; `contact/contact-hit` is the
 * point about the figure.
 */
export const HP_AFTER_HIT = BASE_MAX_HP - ENEMIES[HITTER].damage;

/**
 * Reset and pose an isolated `playing` night with `enemyContact` the only
 * driver switch on: nothing alive, nothing on the ground, no weapon held,
 * nothing moving, nothing firing.
 *
 * `enemyContact` is the faculty this category is about, and every other switch
 * stays off, so what a tick can change about `hurtFlash` is a contact hit and
 * the count-down of specs/world.md's timer rule, and nothing else.
 */
export function poseNight(h: Harness): WickSnapshot {
  const posed = isolate(h);
  enable(h, "enemyContact");
  return posed;
}

/**
 * Put one hitter `offset` units along +x of the lamplighter's center; its id.
 *
 * Its `contactCooldown` "is `0` when the enemy spawns" (specs/world.md), and "a
 * timer at `0` stays due on every tick until it is set again", so a hitter
 * posed inside {@link CONTACT_DISTANCE} lands its hit on the next tick run.
 * `enemyMotion` is off in {@link poseNight}, so it holds the offset it was
 * posed at for as long as a point reads it.
 */
export function spawnHitter(h: Harness, offset: number): number {
  return spawnEnemyNear(h, HITTER, offset, 0);
}

/**
 * Pose the night, put a hitter inside contact, and run the one tick that lands
 * its hit; the snapshot that tick left.
 *
 * That tick is the tick the flash is armed on: phase 7 of specs/world.md's One
 * tick counts `hurtFlash` down and then lands the hit, so the snapshot handed
 * back is the arming tick's own reading.
 */
export async function armFlash(h: Harness): Promise<WickSnapshot> {
  poseNight(h);
  spawnHitter(h, OVERLAP_OFFSET);
  return h.tick(1);
}

/**
 * Take every enemy off the field, so no further contact hit can land while the
 * flash a point already armed counts down.
 *
 * The field is emptied rather than `enemyContact` turned off, because
 * specs/world.md's phase 7 counts `hurtFlash` down whatever that switch holds
 * and only the HIT is gated by it: a point that reads the count-down leaves the
 * faculty exactly as the game plays it and removes what there was to hit.
 */
export function clearHitters(h: Harness): void {
  h.debug.clearEnemies();
}
