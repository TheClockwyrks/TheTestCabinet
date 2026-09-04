// taper/stage — what the Taper checks share: the slashes a firing tick
// created, the reading of whether a posed moth was hit by it, and the one row
// check the eight `row-N` points each run against their own row of
// `TAPER_LEVELS`.
//
// THE PROBE. Every check in this directory that asks WHERE a slash reaches
// poses a moth and reads what the firing tick did to it. A moth is the probe
// because `specs/enemies.md` gives it `5` hp, unscaled at a run clock of `0`
// (`hpMul(0)` = `1`), and Taper's smallest damage is `10`, so a moth the slash
// overlaps dies on the tick ("On any tick that leaves `hp` at or below `0`
// the enemy dies on that tick: it is removed") and a moth it misses stands at
// its full hp. So "hit" reads as gone-or-lowered and "untouched" as present at
// the hp it was posed with, and a build that reports neither fails the point
// on the surface's own terms.
//
// THE FIRING. `specs/weapons.md` ("Cooldown timers"): "On acquisition the
// timer is `0`, so a weapon fires on the first `playing` tick it is held", and
// the harness's `fireWeapon` is exactly that: hold Taper at the level, arm it,
// turn `weaponFire` on, step one tick. Everything else stays held, so the tick
// counts one timer, fires one weapon, and resolves the hits of phase 6
// (`specs/world.md`, "One tick"). `enemyMotion` and `enemyContact` are off, so
// a posed moth stands where it was posed and lands nothing.
//
// Every figure below is read from `../constants`, never from a build.

import { assertEqual, assertNear, fail } from "../assert";
import {
  ENEMIES,
  FLOAT_TOL,
  POSITION_TOL,
  TAPER_MAX_AMOUNT,
  TIMER_TOL,
  weaponRow,
} from "../constants";
import {
  captureStill,
  enemyById,
  fireWeapon,
  isolate,
  type EnemyView,
  type Firing,
  type Harness,
  type WickSnapshot,
  type ZoneView,
} from "../harness";

/** A moth's table hp, `5`, which a run clock of `0` leaves unscaled. */
export const MOTH_HP = ENEMIES.moth.hp;

/** A moth's radius, `10`, the circle the slash's rectangle is tested against. */
export const MOTH_RADIUS = ENEMIES.moth.radius;

/** The Taper slashes among the zones `firing` created, in id order. */
export function slashesOf(firing: Firing): ZoneView[] {
  return firing.zones.filter(
    (zone) => zone.kind === "slash" && zone.weapon === "taper",
  );
}

/**
 * The moth `posed` was hit by the tick that left `after`: it is gone, having
 * died of the hit, or its hp is below what it was posed with.
 */
export function assertHit(
  after: WickSnapshot,
  posed: EnemyView,
  what: string,
): void {
  const now = enemyById(after, posed.id);
  if (now === undefined || now.hp < posed.hp) return;
  fail(
    `${what}: moth ${posed.id} hit by the slash (gone, or hp below ${posed.hp})`,
    `present at hp ${now.hp}`,
  );
}

/**
 * The moth `posed` was left alone by the tick that left `after`: still live,
 * at exactly the hp it was posed with.
 */
export function assertUntouched(
  after: WickSnapshot,
  posed: EnemyView,
  what: string,
): void {
  const now = enemyById(after, posed.id);
  if (now !== undefined && now.hp === posed.hp) return;
  fail(
    `${what}: moth ${posed.id} untouched by the slash (present at hp ${posed.hp})`,
    now === undefined ? "gone" : `present at hp ${now.hp}`,
  );
}

/**
 * The `row-N` check: hold Taper at `level` on an isolated night, run the tick
 * it fires on, write the `row` still, and assert what row `level` of
 * `TAPER_LEVELS` gives the firing.
 *
 * `specs/weapons.md` ("Taper"): "A slash is a rectangle of `width × height`",
 * "With amount `2` a second slash fires on the same tick", "Any amount above
 * `TAPER_MAX_AMOUNT` (`2`) adds nothing"; ("Derived stats") width and height
 * are the "table value × `areaMul`" and damage the "table value × `damageMul`",
 * both `1` with no passive held; ("Cooldown timers") "After firing, the timer
 * is set to the weapon's current cooldown", "the table cooldown times
 * `cooldownMul`", so the slot reads the table cooldown on the firing tick.
 * `specs/instrumentation.md` ("Snapshot shape") has "`width` and `height`
 * appear on a slash alone" and `damage` as "the damage per hit the shape
 * carries".
 *
 * TOLERANCE. `POSITION_TOL` on the two lengths and `FLOAT_TOL` on the damage,
 * each a table figure times `1`; `TIMER_TOL` on the timer the firing set. The
 * slash count is exact.
 */
export async function checkTaperRow(h: Harness, level: number): Promise<void> {
  const row = weaponRow("taper", level);
  const amount = Math.min(row.amount ?? 0, TAPER_MAX_AMOUNT);

  await isolate(h);
  await h.debug.setFacing("right");
  const firing = await fireWeapon(h, "taper", level);
  await captureStill(h, "row");

  const slashes = slashesOf(firing);
  assertEqual(
    slashes.length,
    amount,
    `Taper slash zones the level-${level} firing tick created`,
  );
  for (const slash of slashes) {
    assertNear(
      slash.width ?? NaN,
      row.width ?? NaN,
      POSITION_TOL,
      `slash ${slash.id}'s width at level ${level}`,
    );
    assertNear(
      slash.height ?? NaN,
      row.height ?? NaN,
      POSITION_TOL,
      `slash ${slash.id}'s height at level ${level}`,
    );
    assertNear(
      slash.damage,
      row.damage,
      FLOAT_TOL,
      `slash ${slash.id}'s damage at level ${level}`,
    );
  }
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, "taper", "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    row.cooldown ?? NaN,
    TIMER_TOL,
    `Taper's timer after the level-${level} firing`,
  );
}
