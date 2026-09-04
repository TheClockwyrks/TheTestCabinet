// pin/dart — what the points of this category share: an isolated night
// holding Pin alone at a level, facing one way, with its firing due on the
// next tick, and the readings of the darts the firing tick created against
// the row of `PIN_LEVELS` in force. CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them; the readings restate the rules of
// specs/weapons.md ("Pin", "Derived stats", "Projectiles and pierce", and
// "Cooldown timers") that every row point asserts the same way.
//
// WHY THE FIELD IS EMPTY. "Pin fires whether or not any enemy exists"
// (specs/weapons.md, "Pin"), so no enemy is posed: a dart is created at the
// lamplighter's center and "first moving on the next tick" (specs/world.md,
// "One tick", phase 6), and with nothing on the field to hit, every dart is
// still in `projectiles`, at its launch position and velocity, to read after
// the firing tick.

import { assertEqual, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  PIN_LEVELS,
  cooldownFor,
  derived,
  type BoltRow,
} from "../constants";
import {
  armWeapon,
  holdWeapon,
  isolate,
  type Facing,
  type Harness,
  type Point,
  type ProjectileSnapshot,
  type WickSnapshot,
} from "../harness";

/** What {@link armPin} posed: the slot Pin took and the night before the tick. */
export interface Loadout {
  slot: number;
  /** The lamplighter's center on the posed tick. */
  player: Point;
  /** The night as posed, before the firing tick. */
  posed: WickSnapshot;
}

/**
 * Reset to an isolated night holding Pin alone at `level`, facing `facing`,
 * with Pin's timer at 0 and `weaponFire` on, so the next `playing` tick is the
 * firing tick: "`setWeaponCooldown(slot, 0)` makes that the next tick"
 * (specs/instrumentation.md). Every other switch stays off: `effectMotion`
 * off holds each dart at its launch position and velocity for the reading, as
 * phase 6 would anyway before its first move, and nothing spawns, moves, or
 * touches the lamplighter. No key is held, so the lamplighter stands still
 * and `facing` stays as posed (specs/world.md, "Facing").
 *
 * No passive is held, so every derived multiplier reads `1` and every bonus
 * `0`: "A run starts with every passive slot empty" (specs/passives.md), and
 * the pose adds none. The reading below checks that, so a build that hands a
 * run a passive fails the row rather than reading a scaled figure.
 */
export function armPin(
  h: Harness,
  level: number,
  facing: Facing = "right",
): Loadout {
  isolate(h);
  h.debug.setFacing(facing);
  const slot = holdWeapon(h, "pin", level);
  armWeapon(h, slot);
  const posed = h.snapshot();
  assertEqual(posed.run.weapons[slot]?.id, "pin", "the weapon held");
  assertEqual(posed.run.weapons[slot]?.level, level, "Pin's posed level");
  assertEqual(posed.run.weapons[slot]?.cooldown, 0, "Pin's posed timer");
  assertEqual(posed.weaponFire, true, "weaponFire before the firing tick");
  assertEqual(posed.run.player.facing, facing, "the posed facing");
  assertEqual(
    posed.run.passives.length,
    0,
    "passives held, which every multiplier of the readings assumes is none",
  );
  assertEqual(posed.run.enemies.length, 0, "enemies before the firing tick");
  assertEqual(
    posed.run.projectiles.length,
    0,
    "projectiles before the firing tick",
  );
  const { player } = posed.run;
  return { slot, player: { x: player.x, y: player.y }, posed };
}

/** Row `level` of PIN_LEVELS: "row `i` is level `i + 1`" (specs/weapons.md). */
export function pinRow(level: number): BoltRow {
  return PIN_LEVELS[level - 1];
}

/**
 * The velocity a dart leaves with while the lamplighter faces `facing` at
 * `speed`: "fired horizontally in the facing direction at `speed`"
 * (specs/weapons.md, "Pin"), the facing direction being "`+x` for `"right"`
 * and `-x` for `"left"`" (specs/weapons.md, "The nearest enemy").
 */
export function dartVelocity(facing: Facing, speed: number): Point {
  return { x: facing === "right" ? speed : -speed, y: 0 };
}

/**
 * `dart` carries the figures `row` gives a dart fired with no passive held:
 * radius `row.radius × areaMul`, damage `row.damage × damageMul`, speed
 * `row.speed` as the length of its velocity, pierce `row.pierce`, and `ttl`
 * `row.duration`, each as specs/weapons.md ("Derived stats", "Pin", and
 * "Projectiles and pierce") states it. With nothing held every multiplier is
 * `1` (specs/passives.md).
 */
export function assertDartOfRow(
  dart: ProjectileSnapshot,
  row: BoltRow,
  context: string,
): void {
  assertWithin(
    dart.radius,
    row.radius * derived.areaMul({}),
    FIGURE_TOLERANCE,
    `${context}: radius`,
  );
  assertWithin(
    dart.damage,
    row.damage * derived.damageMul({}),
    FIGURE_TOLERANCE,
    `${context}: damage`,
  );
  assertWithin(
    Math.hypot(dart.vx, dart.vy),
    row.speed,
    FIGURE_TOLERANCE,
    `${context}: speed, the length of its velocity`,
  );
  assertEqual(dart.pierce, row.pierce, `${context}: pierce`);
  assertWithin(
    dart.ttl,
    row.duration,
    FIGURE_TOLERANCE,
    `${context}: ttl on the tick it was fired`,
  );
}

/**
 * Pin's timer in `slot` reads `row`'s cooldown after the firing tick: "After
 * firing, the timer is set to the weapon's current cooldown", which "is the
 * table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`"
 * (specs/weapons.md, "Cooldown timers"), `1` times the table figure with no
 * Oil held.
 */
export function assertTimerOfRow(
  after: WickSnapshot,
  slot: number,
  row: BoltRow,
): void {
  assertWithin(
    after.run.weapons[slot]?.cooldown ?? Number.NaN,
    cooldownFor(row.cooldown, {}),
    FIGURE_TOLERANCE,
    "Pin's timer after the firing tick",
  );
}
