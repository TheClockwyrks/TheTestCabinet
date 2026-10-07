// halo/stage — what the Halo checks share: the one aura a snapshot holds, the
// target a pulse is posed over, and the one row check the eight `row-N` points
// each run against their own row of `HALO_LEVELS`.
//
// THE AURA. `specs/weapons.md` ("Halo"): "Halo is a permanent aura: one zone of
// kind `aura`, a circle of `radius` centered on the player's center every
// tick. The zone is created on the first `playing` tick Halo is held and none
// exists". So on any `playing` tick Halo is held, a conformant build's snapshot
// holds exactly one zone of kind `aura` whose `weapon` is `halo`, and `auraOf`
// below reads it or fails the point: a build with no aura, or with two, cannot
// be read for the figure the check is about.
//
// THE PULSE. "It is a pulsing effect whose interval is its cooldown: on each
// tick the cooldown timer is due it pulses, every enemy whose circle overlaps
// the aura takes `damage`, and the timer is set to the current cooldown. Halo
// pulses on the first `playing` tick it is held." ("Cooldown timers") "On
// acquisition the timer is `0`, so a weapon fires on the first `playing` tick
// it is held". The harness's `fireWeapon` is exactly that: hold Halo at the
// level, arm it, turn `weaponFire` on, step one tick, so the tick it runs is
// the first pulse. Everything else stays held, so `enemyMotion` off keeps a
// target where it was posed and `enemyContact` off keeps it from hitting back.
//
// THE TARGET. A target is posed `TARGET_OFFSET` (`40`) units along `+x` from
// the lamplighter's center. ("Shapes and overlap") "Two circles overlap when
// the distance between their centers is less than the sum of their radii", and
// the smallest aura in `HALO_LEVELS` is `80`, so a target of any radius at `40`
// overlaps every row's aura. `40` is past the contact distance too,
// `PLAYER_RADIUS` (`12`) plus the largest common radius the checks pose (a rat's
// `12`), so the target overlaps the aura and nothing else. A moth (`hp` `5`)
// is the target where one level-1 pulse of `3` must leave it alive, and a rat
// (`hp` `15`) where every row's damage, `8` at most, must.
//
// Every figure below is read from `../constants`, never from a build.

import { assertEqual, assertNear, fail } from "../assert";
import {
  ENEMIES,
  FLOAT_TOL,
  TIMER_TOL,
  type EnemyId,
  type WeaponId,
  weaponRow,
} from "../constants";
import {
  captureStill,
  fireWeapon,
  isolate,
  mustEnemy,
  placeEnemyNear,
  type EnemyView,
  type Harness,
  type WickSnapshot,
  type ZoneView,
  zonesOfKind,
} from "../harness";

/** The weapon every check here is about. */
export const HALO: WeaponId = "halo";

/** How far along `+x` from the lamplighter's center a target is posed. */
export const TARGET_OFFSET = 40;

/** The auras of `snapshot`: every zone of kind `aura`, in id order. */
export function aurasOf(snapshot: WickSnapshot): ZoneView[] {
  return zonesOfKind(snapshot, "aura");
}

/**
 * The one aura `snapshot` holds, or the point fails: "one zone of kind `aura`"
 * whose `weapon` is `halo`.
 */
export function auraOf(snapshot: WickSnapshot, what: string): ZoneView {
  const auras = aurasOf(snapshot);
  if (auras.length !== 1) {
    fail(
      `exactly one zone of kind aura (${what})`,
      auras.map((zone) => ({ id: zone.id, weapon: zone.weapon })),
    );
  }
  const aura = auras[0]!;
  assertEqual(aura.weapon, HALO, `the aura's weapon (${what})`);
  return aura;
}

/** Pose one enemy of `type` `TARGET_OFFSET` along `+x` from the lamplighter. */
export function placeTarget(h: Harness, type: EnemyId): Promise<EnemyView> {
  return placeEnemyNear(h, type, TARGET_OFFSET, 0);
}

/**
 * The `row-N` check: hold Halo at `level` on an isolated night with one rat
 * overlapping the aura, run the first tick it is held, write the `row` still,
 * and assert what row `level` of `HALO_LEVELS` gives that tick.
 *
 * `specs/weapons.md` ("Halo"): the aura is "a circle of `radius`", its
 * "`radius` and `damage` are recomputed on every tick from the level,
 * `areaMul`, and `damageMul` in force on that tick", and on a pulse "every
 * enemy whose circle overlaps the aura takes `damage`, and the timer is set to
 * the current cooldown"; ("Derived stats") the radius is the "table value ×
 * `areaMul`" and the damage the "table value × `damageMul`", both `1` with no
 * passive held, and the cooldown "table value × `cooldownMul`, floored at
 * `MIN_COOLDOWN`", `1` again so the table figure. So the tick leaves one aura
 * reading the row's radius and damage, the rat at `15` less the row's damage,
 * and the slot's timer at the row's cooldown.
 *
 * TOLERANCE. `FLOAT_TOL` on the radius, the damage, and the rat's `hp`, each a
 * table figure times `1` or `15` less one; `TIMER_TOL` on the timer the pulse
 * set. The aura count is exact.
 */
export async function checkHaloRow(h: Harness, level: number): Promise<void> {
  const row = weaponRow(HALO, level);

  await isolate(h);
  const rat = await placeTarget(h, "rat");
  assertEqual(rat.hp, ENEMIES.rat.hp, "the rat's hp as posed");
  const firing = await fireWeapon(h, HALO, level);
  await captureStill(h, "row");

  const aura = auraOf(firing.after, `on the level-${level} pulse tick`);
  assertNear(
    aura.radius,
    row.radius ?? NaN,
    FLOAT_TOL,
    `the aura's radius at level ${level}`,
  );
  assertNear(
    aura.damage,
    row.damage,
    FLOAT_TOL,
    `the aura's damage at level ${level}`,
  );
  assertNear(
    mustEnemy(firing.after, rat.id).hp,
    ENEMIES.rat.hp - row.damage,
    FLOAT_TOL,
    `the rat's hp on the level-${level} pulse tick`,
  );
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, HALO, "the weapon in the slot that pulsed");
  assertNear(
    slot?.cooldown ?? NaN,
    row.cooldown ?? NaN,
    TIMER_TOL,
    `Halo's timer after the level-${level} pulse`,
  );
}
