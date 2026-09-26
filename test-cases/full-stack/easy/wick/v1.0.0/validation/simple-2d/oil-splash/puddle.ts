// oil-splash/puddle — what the points of this category share: an isolated
// night holding Oil Splash alone at a level with its firing due on the next
// tick, the readings of the puddles the firing tick created against the row
// of `OIL_SPLASH_LEVELS` in force, and a lattice of moths dense enough that a
// puddle landing anywhere in the scatter disk overlaps one of them.
// CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them; the readings restate the rules of
// specs/weapons.md ("Oil Splash", "Derived stats", "Persistent effects", and
// "Cooldown timers") that every row point asserts the same way.
//
// WHY THE FIELD IS EMPTY UNLESS A POINT ASKS FOR MOTHS. "Oil Splash fires
// whether or not any enemy exists" (specs/weapons.md, "Oil Splash"), so a
// point about the firing itself poses no enemy: each puddle is created at its
// landing point, and with nothing on the field to pulse over every puddle is
// still in `zones` to read after the firing tick, with the figures its row
// gave it.
//
// WHY A LATTICE. A puddle lands at "an independent uniformly random point of
// the disk of radius OIL_SCATTER (400) about the player's center", so a point
// that poses nothing for the landing cannot know it before the firing tick. A
// point about the pulse on the tick a puddle APPEARS that reads the build's
// own draw therefore stands a moth on every point of a square
// lattice of pitch `LATTICE_PITCH` (80) covering the disk. The farthest a point
// of the plane can be from its nearest lattice point is half the pitch's
// diagonal, 80 / √2 ≈ 56.6, and a level-1 puddle (radius 50) overlaps a moth
// (radius 10) whose center is less than 60 away (specs/weapons.md, "Shapes and
// overlap"), so wherever the puddle lands at least one moth overlaps it.

import { assertEqual, assertWithin } from "../assert";
import {
  ENEMIES,
  FIGURE_TOLERANCE,
  OIL_SCATTER,
  OIL_SPLASH_LEVELS,
  cooldownFor,
  derived,
  type PuddleRow,
} from "../constants";
import {
  armWeapon,
  distance,
  holdWeapon,
  isolate,
  spawnEnemyAt,
  zonesOf,
  type Harness,
  type Point,
  type WickSnapshot,
  type ZoneSnapshot,
} from "../harness";

/** What {@link armOilSplash} posed: the slot it took and the night before the tick. */
export interface Loadout {
  slot: number;
  /** The lamplighter's center on the posed tick. */
  player: Point;
  /** The night as posed, before the firing tick. */
  posed: WickSnapshot;
}

/**
 * Reset to an isolated night holding Oil Splash alone at `level`, with its
 * timer at 0 and `weaponFire` on, so the next `playing` tick is the firing
 * tick: "`setWeaponCooldown(slot, 0)` makes that the next tick"
 * (specs/instrumentation.md). Every other switch stays off: nothing spawns,
 * moves, or touches the lamplighter, and a puddle never moves whatever
 * `effectMotion` holds. No passive is held, so every figure is the table's
 * own (specs/passives.md: every multiplier `1`, `amountBonus` `0`).
 */
export function armOilSplash(h: Harness, level: number): Loadout {
  isolate(h);
  const slot = holdWeapon(h, "oil-splash", level);
  armWeapon(h, slot);
  const posed = h.snapshot();
  assertEqual(posed.run.weapons[slot]?.id, "oil-splash", "the weapon held");
  assertEqual(
    posed.run.weapons[slot]?.level,
    level,
    "Oil Splash's posed level",
  );
  assertEqual(posed.run.weapons[slot]?.cooldown, 0, "Oil Splash's posed timer");
  assertEqual(posed.weaponFire, true, "weaponFire before the firing tick");
  assertEqual(posed.run.zones.length, 0, "zones before the firing tick");
  const { player } = posed.run;
  return { slot, player: { x: player.x, y: player.y }, posed };
}

/** Row `level` of OIL_SPLASH_LEVELS: "row `i` is level `i + 1`" (specs/weapons.md). */
export function oilRow(level: number): PuddleRow {
  return OIL_SPLASH_LEVELS[level - 1];
}

/** Every Oil Splash puddle in `snapshot`, ascending by id. */
export function puddlesOf(snapshot: WickSnapshot): ZoneSnapshot[] {
  return zonesOf(snapshot, "oil-splash").filter(
    (zone) => zone.kind === "puddle",
  );
}

/**
 * Make Oil Splash in `slot` fire on the next tick and run that tick; the
 * puddles that tick created, which are the Oil Splash puddles whose ids were
 * not in `zones` before it ("A pose that creates an entity gives it the next
 * id from `nextId`", specs/instrumentation.md, and `ZoneState.id` is "unique
 * for the run", specs/state.md).
 */
export async function fireOnce(
  h: Harness,
  slot: number,
): Promise<{ after: WickSnapshot; created: ZoneSnapshot[] }> {
  const before = new Set(puddlesOf(h.snapshot()).map((zone) => zone.id));
  h.debug.setWeaponCooldown(slot, 0);
  const after = await h.tick(1);
  const created = puddlesOf(after).filter((zone) => !before.has(zone.id));
  return { after, created };
}

/**
 * `puddle` carries the figures `row` gives a puddle created with no passive
 * held: radius `row.radius × areaMul`, damage `row.damage × damageMul`, and
 * `ttl` `row.duration`, each as specs/weapons.md ("Derived stats") and
 * specs/state.md (`ZoneState`: "a puddle [holds] its `duration`") state it.
 * A zone created on this tick has not counted down: only a zone "that
 * existed before this tick counts its `ttl` down" (specs/world.md, phase 6).
 * With nothing held every multiplier is `1` (specs/passives.md).
 */
export function assertPuddleOfRow(
  puddle: ZoneSnapshot,
  row: PuddleRow,
  context: string,
): void {
  assertEqual(puddle.kind, "puddle", `${context}: kind`);
  assertWithin(
    puddle.radius,
    row.radius * derived.areaMul({}),
    FIGURE_TOLERANCE,
    `${context}: radius`,
  );
  assertWithin(
    puddle.damage,
    row.damage * derived.damageMul({}),
    FIGURE_TOLERANCE,
    `${context}: damage`,
  );
  assertWithin(
    puddle.ttl ?? Number.NaN,
    row.duration,
    FIGURE_TOLERANCE,
    `${context}: ttl on the tick it was created`,
  );
}

/**
 * Oil Splash's timer in `slot` reads `row`'s cooldown after the firing tick:
 * "After firing, the timer is set to the weapon's current cooldown", which "is
 * the table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`"
 * (specs/weapons.md, "Cooldown timers"), `1` times the table figure with no
 * Oil held.
 */
export function assertTimerOfRow(
  after: WickSnapshot,
  slot: number,
  row: PuddleRow,
): void {
  assertWithin(
    after.run.weapons[slot]?.cooldown ?? Number.NaN,
    cooldownFor(row.cooldown, {}),
    FIGURE_TOLERANCE,
    "Oil Splash's timer after the firing tick",
  );
}

/** The enemy every pulse point stands in a puddle: the smallest common. */
export const PULSE_ENEMY = "moth";

/** A moth's radius, from the `ENEMIES` table of specs/enemies.md. */
export const MOTH_RADIUS = ENEMIES[PULSE_ENEMY].radius;

/**
 * The pitch of the moth lattice, in units. Half its diagonal, 80 / √2 ≈ 56.6,
 * is the farthest any landing point can be from its nearest moth, and a
 * level-1 puddle overlaps a moth whose center is less than 50 + 10 = 60 away.
 */
export const LATTICE_PITCH = 80;

/**
 * How far from the lamplighter's center the lattice reaches: the scatter disk
 * plus half a diagonal, so the nearest lattice point to any landing point,
 * itself within half a diagonal of the disk, is one that was posed.
 */
export const LATTICE_REACH = OIL_SCATTER + LATTICE_PITCH / Math.SQRT2;

/** One moth of the lattice: its id and where it stands. */
export interface LatticeMoth {
  id: number;
  at: Point;
}

/**
 * Stand a moth on every point of the square lattice of pitch `LATTICE_PITCH`
 * centered on `center` and within `LATTICE_REACH` of it, so a level-1 puddle
 * landing anywhere in the scatter disk overlaps at least one. Posed through
 * `spawnEnemy`, so each moth has the health a spawn at the run clock has, 5
 * at time 0 (specs/enemies.md), and takes one level-1 pulse of 4 without
 * dying.
 */
export function poseMothLattice(h: Harness, center: Point): LatticeMoth[] {
  const moths: LatticeMoth[] = [];
  const steps = Math.ceil(LATTICE_REACH / LATTICE_PITCH);
  for (let i = -steps; i <= steps; i += 1) {
    for (let j = -steps; j <= steps; j += 1) {
      const at: Point = {
        x: center.x + i * LATTICE_PITCH,
        y: center.y + j * LATTICE_PITCH,
      };
      if (distance(at, center) > LATTICE_REACH) continue;
      moths.push({ id: spawnEnemyAt(h, PULSE_ENEMY, at.x, at.y), at });
    }
  }
  return moths;
}

/**
 * Whether a moth standing at `at` overlaps a puddle of `radius` centered at
 * `center`: "Two circles overlap when the distance between their centers is
 * less than the sum of their radii" (specs/weapons.md, "Shapes and overlap").
 * A moth within `FIGURE_TOLERANCE` of the boundary is left out, because the
 * exact overlap boundary belongs to the overlap point and a build's own
 * rounding may put such a moth on either side of it.
 */
export function overlapsPuddle(
  at: Point,
  center: Point,
  radius: number,
): boolean {
  return distance(at, center) < radius + MOTH_RADIUS - FIGURE_TOLERANCE;
}
