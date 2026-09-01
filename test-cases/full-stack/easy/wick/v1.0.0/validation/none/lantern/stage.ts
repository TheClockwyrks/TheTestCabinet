// lantern/stage — what the Lantern checks share: the lanterns a firing tick
// created, the lanterns a snapshot holds, the angles a set stands at about the
// lamplighter, the timer Lantern's firing sets, and the one row check the eight
// `row-N` points each run against their own row of `LANTERN_LEVELS`.
//
// THE FIRING. `specs/weapons.md` ("Cooldown timers"): "On acquisition the timer
// is `0`, so a weapon fires on the first `playing` tick it is held; Taper,
// Lantern, ... need no target and fire the same way", and the harness's
// `fireWeapon` is exactly that: hold Lantern at the level, arm it, turn
// `weaponFire` on, step one tick. Everything else stays held, so the tick counts
// one timer, fires one weapon, and places its set about the lamplighter's
// position of this tick (`specs/world.md`, "One tick", phase 5). A lantern
// "is a zone" of kind `lantern` (`specs/state.md`), created with a fresh id, so
// the set a firing created is read off the tick's snapshot by id.
//
// THE ANGLES. `specs/weapons.md` ("The nearest enemy"): "Angles are in degrees,
// with `0` along `+x` and positive angles turning toward `+y`, which is
// clockwise on screen", so a lantern's angle is `atan2(dy, dx)` about the
// lamplighter's center, normalized into `[0, 360)` — which is `angleFrom` in the
// harness. Which id carries which angle is the build's, so a set is matched
// against the angles it should stand at as a whole rather than in id order.
//
// Every figure below is read from `../constants`, never from a build.

import { assertEqual, assertNear, fail } from "../assert";
import {
  ANGLE_TOL,
  FLOAT_TOL,
  POSITION_TOL,
  TIMER_TOL,
  effectiveCooldown,
  weaponRow,
  type WeaponRow,
} from "../constants";
import {
  angleFrom,
  captureStill,
  distanceBetween,
  fireWeapon,
  isolate,
  player,
  zonesOf,
  type Firing,
  type Harness,
  type WickSnapshot,
  type XY,
  type ZoneView,
} from "../harness";

/**
 * Where a check that reads a set's placement stands the lamplighter: off the
 * origin, so a set placed about the origin rather than about "the player's
 * center" (`specs/weapons.md`, "Lantern") is told apart, and inside the stage
 * the camera carries with it (`specs/world.md`, "The camera and the view").
 */
export const OFF_ORIGIN = { x: 240, y: -120 } as const;

/** The Lantern lanterns among the zones `firing` created, in id order. */
export function lanternsOf(firing: Firing): ZoneView[] {
  return firing.zones.filter(
    (zone) => zone.kind === "lantern" && zone.weapon === "lantern",
  );
}

/** The Lantern lanterns `snapshot` holds, in id order. */
export function lanternsIn(snapshot: WickSnapshot): ZoneView[] {
  return zonesOf(snapshot, "lantern").filter((zone) => zone.kind === "lantern");
}

/**
 * The seconds Lantern's timer reads once it has fired: "On firing, Lantern's
 * cooldown timer is set to `duration` plus the current cooldown, both read on
 * that tick" (`specs/weapons.md`, "Lantern"), the current cooldown being "the
 * table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`" — `1` with no
 * Oil held.
 */
export function lanternTimer(row: WeaponRow): number {
  return (row.duration ?? NaN) + effectiveCooldown(row.cooldown ?? NaN, {});
}

/**
 * The angles at which a set of `amount` lanterns stands on the tick it is
 * created: "lantern `i`, counted from `0`, starts at angle `i × 360 / amount`"
 * (`specs/weapons.md`, "Lantern").
 */
export function startingAngles(amount: number): number[] {
  return Array.from({ length: amount }, (_, i) => (i * 360) / amount);
}

/** The short-way-round distance between two angles, in degrees. */
function angleGap(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/**
 * `lanterns` stand at exactly the angles of `expected` about `center`, each
 * angle taken by a distinct lantern within `ANGLE_TOL`, in whatever id order
 * the build chose.
 */
export function assertAnglesAre(
  lanterns: readonly ZoneView[],
  center: XY,
  expected: readonly number[],
  what: string,
): void {
  const actual = lanterns.map((lantern) => angleFrom(center, lantern));
  assertEqual(actual.length, expected.length, `${what}: lanterns to match`);
  const free = new Set(actual.keys());
  for (const angle of expected) {
    let taken: number | undefined;
    for (const index of free) {
      if (angleGap(actual[index]!, angle) <= ANGLE_TOL) {
        taken = index;
        break;
      }
    }
    if (taken === undefined) {
      fail(
        `${what}: a lantern at ${angle} degrees +/- ${ANGLE_TOL} about the lamplighter`,
        actual,
      );
    }
    free.delete(taken);
  }
}

/**
 * Every lantern of `lanterns` sits exactly `orbit` from `center`: "the circle
 * they ride is centered on the player's center every tick".
 */
export function assertOnOrbit(
  lanterns: readonly ZoneView[],
  center: XY,
  orbit: number,
  what: string,
): void {
  for (const lantern of lanterns) {
    assertNear(
      distanceBetween(center, lantern),
      orbit,
      POSITION_TOL,
      `${what}: lantern ${lantern.id}'s distance from the lamplighter's center`,
    );
  }
}

/**
 * The `row-N` check: hold Lantern at `level` on an isolated night with the
 * lamplighter posed off the origin, run the tick it fires on, write the `row`
 * still, and assert what row `level` of `LANTERN_LEVELS` gives the firing.
 *
 * The lamplighter stands at {@link OFF_ORIGIN} rather than where a fresh run
 * leaves him, because the row's `orbit` column is a distance from "the player's
 * center" and a set placed about the origin sits at exactly that distance from
 * an origin the lamplighter is standing on.
 *
 * `specs/weapons.md` ("Lantern"): "On firing, `amount` lanterns appear on a
 * circle of radius `orbit` around the player's center", "Each lantern is a
 * circle of `radius`, and each is a zone with `ttl` set to `duration`";
 * ("Derived stats") orbit and radius are the "table value × `areaMul`" and
 * damage the "table value × `damageMul`", both `1` with no passive held, and
 * duration is the "table value, unchanged"; ("Amount") "the table amount plus
 * `amountBonus`", `0` with no Mirror held; and the timer after the firing is
 * `duration` plus the current cooldown, as `lanternTimer` states.
 * `specs/instrumentation.md` ("Snapshot shape") has `damage` as "the damage
 * per hit the shape carries" and every zone's `x`, `y` as "its center".
 *
 * TOLERANCE. `POSITION_TOL` on the radius and on the distance from the
 * lamplighter's center, each a table figure times `1`; `FLOAT_TOL` on the
 * damage; `TIMER_TOL` on the ttl and on the timer the firing set. The count is
 * exact.
 */
export async function checkLanternRow(
  h: Harness,
  level: number,
): Promise<void> {
  const row = weaponRow("lantern", level);

  await isolate(h);
  await h.debug.setPlayerPosition(OFF_ORIGIN.x, OFF_ORIGIN.y);
  const firing = await fireWeapon(h, "lantern", level);
  await captureStill(h, "row");

  const lanterns = lanternsOf(firing);
  assertEqual(
    lanterns.length,
    row.amount ?? NaN,
    `Lantern lantern zones the level-${level} firing tick created`,
  );
  const center = player(firing.after);
  for (const lantern of lanterns) {
    assertNear(
      lantern.radius,
      row.radius ?? NaN,
      POSITION_TOL,
      `lantern ${lantern.id}'s radius at level ${level}`,
    );
    assertNear(
      lantern.damage,
      row.damage,
      FLOAT_TOL,
      `lantern ${lantern.id}'s damage at level ${level}`,
    );
    assertNear(
      lantern.ttl ?? NaN,
      row.duration ?? NaN,
      TIMER_TOL,
      `lantern ${lantern.id}'s ttl at level ${level}`,
    );
  }
  assertOnOrbit(lanterns, center, row.orbit ?? NaN, `level ${level}`);
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, "lantern", "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    lanternTimer(row),
    TIMER_TOL,
    `Lantern's timer after the level-${level} firing`,
  );
}
