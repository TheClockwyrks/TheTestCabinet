// evolutions/evolved — what the points about the six evolved weapons share: an
// isolated night holding one evolved weapon alone, and the readings a hit is
// decided by. CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them; the readings restate rules of
// specs/weapons.md ("Hits and death", "Cooldown timers") and specs/evolutions.md
// ("Passives still apply") that the points of this category assert the same way.
//
// WHY AN EVOLVED WEAPON IS PLACED RATHER THAN EVOLVED INTO. "`level` is ... `1`
// for an evolved one" (specs/instrumentation.md, `setWeapon`), so the surface
// places an evolved weapon directly, and a point about Pyre's slash reaches its
// scenario without the chest, the recipe, or the overlay standing between. The
// points about the recipe itself are the chest points, which reach an evolution
// the real way.
//
// WHY NO PASSIVE IS HELD. "Every derived stat of `specs/passives.md` applies to
// an evolved weapon exactly as to a base weapon" (specs/evolutions.md), and with
// no passive held every multiplier is `1` and `amountBonus` is `0`
// (specs/passives.md), so every figure a row point reads is the fixed row's own.
// A point that is ABOUT a passive holds that one passive and no other.

import { assertEqual, assertWithin, fail } from "../assert";
import { FIGURE_TOLERANCE, cooldownFor, type EvolutionId } from "../constants";
import {
  armWeapon,
  enemyById,
  holdWeapon,
  isolate,
  type Facing,
  type Harness,
  type Point,
  type WickSnapshot,
} from "../harness";

/** What the pose helpers below left: the slot, the center, and the night. */
export interface EvolvedPose {
  /** The slot the evolved weapon took. */
  slot: number;
  /** The lamplighter's center on the posed tick. */
  player: Point;
  /** The night as posed, before any tick ran. */
  posed: WickSnapshot;
}

export interface PoseOptions {
  /** The side the lamplighter faces. Defaults to the fresh run's `"right"`. */
  facing?: Facing;
}

/**
 * Reset to an isolated night holding `id` alone at its single level, with every
 * driver switch off and nothing on the field.
 *
 * "An evolved weapon has a single level and no level table" (specs/evolutions.md),
 * so the level is always `1`. The timer is left exactly as acquisition set it,
 * `0`: "On acquisition the timer is `0`, so a weapon fires on the first
 * `playing` tick it is held" (specs/weapons.md, "Cooldown timers"). A point that
 * needs the firing turns `weaponFire` on through {@link armEvolved}; a point
 * about the placement of an aura or a lantern set needs no switch at all, since
 * "Placement is gated by neither `weaponFire` nor `effectMotion`"
 * (specs/instrumentation.md).
 */
export function poseEvolved(
  h: Harness,
  id: EvolutionId,
  options: PoseOptions = {},
): EvolvedPose {
  isolate(h);
  if (options.facing !== undefined) h.debug.setFacing(options.facing);
  const slot = holdWeapon(h, id, 1);
  const posed = h.snapshot();
  assertEqual(posed.run.weapons[slot]?.id, id, "the weapon held");
  assertEqual(posed.run.weapons[slot]?.level, 1, `${id}'s posed level`);
  assertEqual(posed.run.weapons[slot]?.cooldown, 0, `${id}'s posed timer`);
  assertEqual(
    posed.run.passives.length,
    0,
    "passives held, which every multiplier of the readings assumes is none",
  );
  assertEqual(
    posed.run.player.facing,
    options.facing ?? "right",
    "the posed facing",
  );
  const { player } = posed.run;
  return { slot, player: { x: player.x, y: player.y }, posed };
}

/**
 * {@link poseEvolved}, then the weapon armed to fire on the next `playing`
 * tick: its timer posed to `0` and `weaponFire` on, so the next tick is the
 * firing tick ("`setWeaponCooldown(slot, 0)` makes that the next tick",
 * specs/instrumentation.md). Every other switch stays off.
 */
export function armEvolved(
  h: Harness,
  id: EvolutionId,
  options: PoseOptions = {},
): EvolvedPose {
  const pose = poseEvolved(h, id, options);
  armWeapon(h, pose.slot);
  const posed = h.snapshot();
  assertEqual(posed.weaponFire, true, "weaponFire before the firing tick");
  return { ...pose, posed };
}

/**
 * The weapon in `slot` reads `cooldown` seconds after the firing: "After
 * firing, the timer is set to the weapon's current cooldown"
 * (specs/weapons.md, "Cooldown timers"), which for an evolved weapon is "the
 * fixed cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`"
 * (specs/evolutions.md, "Passives still apply"), `1` times the fixed figure
 * with no Oil held.
 */
export function assertTimerAfterFiring(
  after: WickSnapshot,
  slot: number,
  cooldown: number,
  context: string,
): void {
  assertWithin(
    after.run.weapons[slot]?.cooldown ?? Number.NaN,
    cooldownFor(cooldown, {}),
    FIGURE_TOLERANCE,
    context,
  );
}

/**
 * The enemy `id` took a hit between `before` and `after`: it is gone, having
 * died on the tick, or its hp is lower than it was. Nothing else on an isolated
 * night can touch it.
 */
export function assertHit(
  before: WickSnapshot,
  after: WickSnapshot,
  id: number,
  context: string,
): void {
  const was = enemyById(before, id);
  if (was === undefined) fail(`the posed enemy (${context})`, "not posed");
  const now = enemyById(after, id);
  if (now === undefined || now.hp < was.hp) return;
  fail(`the enemy gone, or its hp below ${was.hp} (${context})`, now.hp);
}

/**
 * The enemy `id` stands in `after` with exactly the hp it had in `before`: no
 * shape reached it, and nothing else on the posed night can.
 */
export function assertUnhurt(
  before: WickSnapshot,
  after: WickSnapshot,
  id: number,
  context: string,
): void {
  const was = enemyById(before, id);
  if (was === undefined) fail(`the posed enemy (${context})`, "not posed");
  const now = enemyById(after, id);
  if (now === undefined) {
    fail(`the enemy present with hp ${was.hp} (${context})`, "gone");
  }
  assertWithin(now.hp, was.hp, FIGURE_TOLERANCE, `${context}: hp`);
}

/**
 * The enemy `id` stands in `after` with `damage` removed from the hp it had in
 * `before`: "A hit removes the shape's damage per hit from the enemy's `hp`"
 * (specs/weapons.md, "Hits and death"). For a probe the hit leaves alive.
 */
export function assertTook(
  before: WickSnapshot,
  after: WickSnapshot,
  id: number,
  damage: number,
  context: string,
): void {
  const was = enemyById(before, id);
  if (was === undefined) fail(`the posed enemy (${context})`, "not posed");
  const now = enemyById(after, id);
  if (now === undefined) {
    fail(`the enemy present with hp ${was.hp - damage} (${context})`, "gone");
  }
  assertWithin(now.hp, was.hp - damage, FIGURE_TOLERANCE, `${context}: hp`);
}
