// flare/burst — what the points of this category share: an isolated night
// holding Flare alone at a level, with one probe standing well inside the
// burst's radius, and the readings of the one burst zone, of the damage it
// removed, and of the timer it left against the row of `FLARE_LEVELS` in
// force. CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them; the readings restate the rules of
// specs/weapons.md ("Flare", "Derived stats", "Hits and death", and "Cooldown
// timers") that the points of this category assert the same way.
//
// WHY THE PROBE STANDS WHERE IT DOES. A burst reaches "every enemy within
// `radius` of the player's center" (specs/weapons.md, "Flare"), and every row
// of `FLARE_LEVELS` gives radius 640, so a probe 100 units along +x of the
// lamplighter's center is inside the burst at every level with a wide margin,
// and stands where the stage draws it. The boundary itself is its own point.
//
// WHY THE PROBE IS A MOTHWING. A point that reads how much damage the burst
// removed needs a probe the burst leaves alive, and the rows deal 100 to 500.
// A mothwing has HP 600 and takes 500 at the top row (specs/enemies.md), so
// one probe survives every row and the reading is the exact difference of two
// stated figures. Every common tops out at 120 and would die on row 1, and
// the Dark is listed in `FLARE_IMMUNE` and takes nothing at all.

import { assertEqual, assertWithin, fail } from "../assert";
import {
  ENEMIES,
  FIGURE_TOLERANCE,
  FLARE_LEVELS,
  cooldownFor,
  derived,
  type EnemyId,
  type RadialRow,
} from "../constants";
import {
  enemyById,
  holdWeapon,
  isolate,
  present,
  spawnEnemyNear,
  zonesOfKind,
  type Harness,
  type WickSnapshot,
  type ZoneSnapshot,
} from "../harness";

/** The enemy the points that read a hp difference stand in the burst. */
export const PROBE: EnemyId = "mothwing";

/**
 * Where a probe stands, as an offset along +x from the lamplighter's center:
 * inside every row's radius of 640 by a wide margin, and on the stage.
 */
export const PROBE_DX = 100;

/** What {@link poseFlare} posed. */
export interface FlarePose {
  /** The slot Flare took. */
  slot: number;
  /** The probe's id, or `null` when none was posed. */
  probe: number | null;
  /** The night as posed, before any tick ran. */
  posed: WickSnapshot;
}

/**
 * Reset to an isolated night holding Flare alone at `level`, with one `probe`
 * enemy standing `PROBE_DX` along +x of the lamplighter's center when one is
 * named. Every switch is left off and the timer is left as `setWeapon` left
 * it: a point that wants the firing on the next tick poses it through
 * `armWeapon`, "`setWeaponCooldown(slot, 0)` makes that the next tick"
 * (specs/instrumentation.md), which is also what turns `weaponFire` on.
 */
export function poseFlare(
  h: Harness,
  level: number,
  probe: EnemyId | null = PROBE,
): FlarePose {
  isolate(h);
  const probeId = probe === null ? null : spawnEnemyNear(h, probe, PROBE_DX, 0);
  if (probeId !== null && probe !== null) {
    const placed = present(enemyById(h.snapshot(), probeId), "the posed probe");
    assertWithin(
      placed.hp,
      ENEMIES[probe].hp,
      FIGURE_TOLERANCE,
      `the ${probe}'s hp at spawn`,
    );
  }
  const slot = holdWeapon(h, "flare", level);
  const posed = h.snapshot();
  assertEqual(posed.run.weapons[slot]?.id, "flare", "the weapon held");
  assertEqual(posed.run.weapons[slot]?.level, level, "Flare's posed level");
  assertEqual(posed.run.zones.length, 0, "zones before the firing tick");
  return { slot, probe: probeId, posed };
}

/** Every zone of kind `burst` that Flare produced, ascending by id. */
export function flareBursts(snapshot: WickSnapshot): ZoneSnapshot[] {
  return zonesOfKind(snapshot, "burst").filter(
    (zone) => zone.weapon === "flare",
  );
}

/**
 * The one Flare burst in `snapshot`: Flare fires one burst on a firing tick
 * and "amount is ignored" (specs/weapons.md, "Flare"). Any other count fails
 * the point with `context`.
 */
export function theBurst(
  snapshot: WickSnapshot,
  context: string,
): ZoneSnapshot {
  const bursts = flareBursts(snapshot);
  if (bursts.length !== 1) {
    fail(
      `exactly one burst zone with weapon flare (${context})`,
      bursts.length,
    );
  }
  return bursts[0];
}

/** Row `level` of FLARE_LEVELS: "row `i` is level `i + 1`" (specs/weapons.md). */
export function flareRow(level: number): RadialRow {
  return FLARE_LEVELS[level - 1];
}

/**
 * The burst carries the figures `row` gives it with no passive held: `radius`
 * `row.radius × areaMul` and `damage` `row.damage × damageMul`
 * (specs/weapons.md, "Derived stats"; specs/state.md, `ZoneState`: "a burst's
 * is its Flare `radius`"). With nothing held every multiplier is `1`
 * (specs/passives.md).
 */
export function assertBurstOfRow(
  burst: ZoneSnapshot,
  row: RadialRow,
  context: string,
): void {
  assertWithin(
    burst.radius,
    row.radius * derived.areaMul({}),
    FIGURE_TOLERANCE,
    `${context}: radius`,
  );
  assertWithin(
    burst.damage,
    row.damage * derived.damageMul({}),
    FIGURE_TOLERANCE,
    `${context}: damage`,
  );
}

/**
 * Flare's timer in `slot` reads `row`'s cooldown after the firing: "After
 * firing, the timer is set to the weapon's current cooldown" (specs/weapons.md,
 * "Cooldown timers"), which "is the table cooldown times `cooldownMul`,
 * floored at `MIN_COOLDOWN`", `1` times the table figure with no Oil held.
 */
export function assertTimerOfRow(
  after: WickSnapshot,
  slot: number,
  row: RadialRow,
  context = "Flare's timer after the firing",
): void {
  assertWithin(
    after.run.weapons[slot]?.cooldown ?? Number.NaN,
    cooldownFor(row.cooldown, {}),
    FIGURE_TOLERANCE,
    context,
  );
}

/**
 * The probe `id` stands in `after` with `damage` removed from the hp it had in
 * `before`: "A hit removes the shape's damage per hit from the enemy's `hp`"
 * (specs/weapons.md, "Hits and death"). For a probe the burst leaves alive.
 */
export function assertProbeTook(
  before: WickSnapshot,
  after: WickSnapshot,
  id: number,
  damage: number,
  context: string,
): void {
  const was = present(enemyById(before, id), `the posed probe (${context})`);
  const now = present(enemyById(after, id), `the probe after (${context})`);
  assertWithin(now.hp, was.hp - damage, FIGURE_TOLERANCE, `${context}: hp`);
}

/**
 * The probe `id` stands in `after` with exactly the hp it had in `before`: no
 * burst reached it, and nothing else on the posed night can.
 */
export function assertProbeUnhurt(
  before: WickSnapshot,
  after: WickSnapshot,
  id: number,
  context: string,
): void {
  const was = present(enemyById(before, id), `the posed probe (${context})`);
  const now = enemyById(after, id);
  if (now === undefined) {
    fail(`the probe present with hp ${was.hp} (${context})`, "gone");
  }
  assertWithin(now.hp, was.hp, FIGURE_TOLERANCE, `${context}: hp`);
}
