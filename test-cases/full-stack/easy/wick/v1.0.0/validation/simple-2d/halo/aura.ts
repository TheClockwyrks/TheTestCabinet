// halo/aura — what the points of this category share: an isolated night
// holding Halo alone at a level, with one enemy standing inside the circle the
// aura will occupy, and the readings of the one aura zone and of a pulse's hit
// against the row of `HALO_LEVELS` in force. CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them; the readings restate the rules of
// specs/weapons.md ("Halo", "Derived stats", "Hits and death", and "Cooldown
// timers") that the points of this category assert the same way.
//
// WHY THE PROBE STANDS WHERE IT DOES. The aura is "centered on the player's
// center every tick" with the row's radius, 80 at level 1 and never below it
// (specs/weapons.md, "Halo"), and an enemy is a circle of its own radius
// (specs/enemies.md), so a probe whose center is 40 units from the
// lamplighter's overlaps the aura at every level: "Two circles overlap when the
// distance between their centers is less than the sum of their radii". It
// stands clear of the lamplighter's own circle (radius 12) and every switch
// but the one a point turns on is off, so nothing moves it, nothing touches it,
// and the aura's pulse is the only thing that can change its hp.
//
// WHY TWO PROBES. A moth has HP 5 and radius 10, the smallest common enemy,
// and the points about the pulse itself use it as their descriptions say. A
// row point reads the exact damage the pulse removed, and rows 5 to 8 deal 5
// or more, which kills a moth ("On any tick an enemy's `hp` is at or below `0`
// after the hits the enemy dies on that tick"), so the row points stand a rat,
// HP 15 and radius 12 (specs/enemies.md), which every row leaves alive.

import { assertEqual, assertWithin, fail } from "../assert";
import {
  ENEMIES,
  FIGURE_TOLERANCE,
  HALO_LEVELS,
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

/** The enemy the pulse points stand in the aura: HP 5, radius 10. */
export const PROBE: EnemyId = "moth";

/** The enemy the row points stand in the aura: HP 15, radius 12. */
export const ROW_PROBE: EnemyId = "rat";

/**
 * Where a probe stands, as an offset along +x from the lamplighter's center:
 * inside every row's radius by at least 40 units, outside the lamplighter's
 * own circle.
 */
export const PROBE_DX = 40;

/** What {@link poseHalo} posed. */
export interface HaloPose {
  /** The slot Halo took. */
  slot: number;
  /** The probe's id, or `null` when none was posed. */
  probe: number | null;
  /** The night as posed, before any tick ran. */
  posed: WickSnapshot;
}

/**
 * Reset to an isolated night holding Halo alone at `level`, with one `probe`
 * enemy standing `PROBE_DX` along +x of the lamplighter's center when one is
 * named. Every switch is left off and the timer is left as `setWeapon` left
 * it: a point that is about the acquisition timer reads it and turns on
 * `weaponFire` through `enable`, and a point that needs a pulse on the next
 * tick poses that through `armWeapon`, "`setWeaponCooldown(slot, 0)` makes
 * that the next tick" (specs/instrumentation.md). The aura does not exist
 * yet: "the aura of Halo or Corona ... appear on the next `playing` tick
 * under the placement rule" (specs/instrumentation.md, `setWeapon`).
 */
export function poseHalo(
  h: Harness,
  level: number,
  probe: EnemyId | null = PROBE,
): HaloPose {
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
  const slot = holdWeapon(h, "halo", level);
  const posed = h.snapshot();
  assertEqual(posed.run.weapons[slot]?.id, "halo", "the weapon held");
  assertEqual(posed.run.weapons[slot]?.level, level, "Halo's posed level");
  assertEqual(posed.run.zones.length, 0, "zones before the first tick");
  return { slot, probe: probeId, posed };
}

/** Every zone of kind `aura` that Halo produced, ascending by id. */
export function haloAuras(snapshot: WickSnapshot): ZoneSnapshot[] {
  return zonesOfKind(snapshot, "aura").filter((zone) => zone.weapon === "halo");
}

/**
 * The one Halo aura in `snapshot`: "one zone of kind `aura`" (specs/weapons.md,
 * "Halo"). Any other count fails the point with `context`.
 */
export function theAura(snapshot: WickSnapshot, context: string): ZoneSnapshot {
  const auras = haloAuras(snapshot);
  if (auras.length !== 1) {
    fail(`exactly one aura zone with weapon halo (${context})`, auras.length);
  }
  return auras[0];
}

/** Row `level` of HALO_LEVELS: "row `i` is level `i + 1`" (specs/weapons.md). */
export function haloRow(level: number): RadialRow {
  return HALO_LEVELS[level - 1];
}

/**
 * The aura carries the figures `row` gives it with no passive held: `radius`
 * `row.radius × areaMul` and `damage` `row.damage × damageMul`, "recomputed on
 * every tick from the level, `areaMul`, and `damageMul` in force on that tick"
 * (specs/weapons.md, "Halo"). With nothing held every multiplier is `1`
 * (specs/passives.md).
 */
export function assertAuraOfRow(
  aura: ZoneSnapshot,
  row: RadialRow,
  context: string,
): void {
  assertWithin(
    aura.radius,
    row.radius * derived.areaMul({}),
    FIGURE_TOLERANCE,
    `${context}: radius`,
  );
  assertWithin(
    aura.damage,
    row.damage * derived.damageMul({}),
    FIGURE_TOLERANCE,
    `${context}: damage`,
  );
}

/**
 * Halo's timer in `slot` reads `row`'s cooldown after a pulse: "the timer is
 * set to the current cooldown" (specs/weapons.md, "Halo"), which "is the
 * table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`" ("Cooldown
 * timers"), `1` times the table figure with no Oil held.
 */
export function assertTimerOfRow(
  after: WickSnapshot,
  slot: number,
  row: RadialRow,
  context = "Halo's timer after the pulse",
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
 * (specs/weapons.md, "Hits and death"). For a probe the pulse leaves alive.
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
 * The probe `id` stands in `after` with exactly the hp it had in `before`:
 * no pulse reached it, and nothing else on the posed night can.
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
