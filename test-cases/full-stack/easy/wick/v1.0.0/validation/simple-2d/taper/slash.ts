// taper/slash — what the points of this category share: an isolated night
// holding Taper alone with its firing due on the next tick, and the two
// readings of whether a slash hit a posed moth. CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them; the readings restate one rule of
// specs/weapons.md ("Hits and death"): "A hit removes the shape's damage per
// hit from the enemy's `hp`", and "On any tick an enemy's `hp` is at or below
// `0` after the hits the enemy dies on that tick". A moth has HP 5
// (specs/enemies.md) and every Taper row deals at least 10, so a moth a slash
// hit is GONE after the tick, and a moth a slash missed stands with its hp
// exactly as it was.

import { assertEqual, fail } from "../assert";
import {
  armWeapon,
  enemyById,
  holdWeapon,
  isolate,
  type Facing,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The enemy every probe of this category is: HP 5, radius 10. */
export const PROBE = "moth";

/**
 * Reset to an isolated night holding Taper alone at `level`, facing `facing`,
 * with its timer at 0 and `weaponFire` on, so the next `playing` tick is the
 * firing tick: "`setWeaponCooldown(slot, 0)` makes that the next tick"
 * (specs/instrumentation.md). Every other switch stays off, so nothing on the
 * field moves, spawns, or touches the lamplighter, and the slash is the only
 * thing that can change a moth. Answers the slot Taper took.
 */
export function armTaper(
  h: Harness,
  level: number,
  facing: Facing = "right",
): number {
  isolate(h);
  h.debug.setFacing(facing);
  const slot = holdWeapon(h, "taper", level);
  armWeapon(h, slot);
  const posed = h.snapshot();
  assertEqual(posed.run.weapons[slot]?.id, "taper", "the weapon held");
  assertEqual(posed.run.weapons[slot]?.level, level, "Taper's posed level");
  assertEqual(posed.run.player.facing, facing, "the posed facing");
  return slot;
}

/**
 * The moth `id` took a hit on the ticks between `before` and `after`: it is
 * gone, having died on the tick, or its hp is lower than it was.
 */
export function assertHit(
  before: WickSnapshot,
  after: WickSnapshot,
  id: number,
  context: string,
): void {
  const was = enemyById(before, id);
  if (was === undefined) fail(`the posed moth (${context})`, "not posed");
  const now = enemyById(after, id);
  if (now === undefined || now.hp < was.hp) return;
  fail(`the moth gone, or its hp below ${was.hp} (${context})`, now.hp);
}

/**
 * The moth `id` took no hit on the ticks between `before` and `after`: it
 * stands with its hp exactly as it was, since nothing else on the posed night
 * can touch it.
 */
export function assertUnhurt(
  before: WickSnapshot,
  after: WickSnapshot,
  id: number,
  context: string,
): void {
  const was = enemyById(before, id);
  if (was === undefined) fail(`the posed moth (${context})`, "not posed");
  const now = enemyById(after, id);
  if (now === undefined) {
    fail(`the moth present with hp ${was.hp} (${context})`, "gone");
  }
  assertEqual(now.hp, was.hp, `${context}: hp`);
}
