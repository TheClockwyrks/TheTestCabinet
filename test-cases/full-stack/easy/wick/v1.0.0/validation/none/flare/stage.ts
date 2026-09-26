// flare/stage — what the Flare checks share: the burst zones a firing tick
// created, the reading of what a burst did to a posed enemy, and the one row
// check the eight `row-N` points each run against their own row of
// `FLARE_LEVELS`.
//
// THE BURST. `specs/weapons.md` ("Flare"): "On firing, every enemy within
// `radius` of the player's center takes `damage` on that tick, except the
// enemies listed in `FLARE_IMMUNE` (`["dark"]`) ... Flare fires whether or not
// any enemy exists, and amount is ignored. The burst is drawn for
// `FLARE_FLASH` (`0.4`) seconds and has no hitbox after the tick it fires."
// `specs/state.md` lists `burst` among a zone's kinds and `specs/weapons.md`
// ("Shapes and overlap") reads it back: "Every zone's position is the center
// of its shape ... a burst's `radius` is its Flare `radius`". So a firing tick
// leaves one zone of kind `burst` whose `weapon` is `flare`, and `burstsOf`
// below reads the ones a tick created.
//
// WHO IS IN RANGE. ("Shapes and overlap") "An enemy is within `d` of a point
// when the distance from that point to the enemy's center is at most `d`", so
// the test is the distance between centers against `radius`, and the enemy's
// own radius reads nothing into it. A check poses each enemy on an axis
// through the lamplighter's center, so its distance is one coordinate and is
// exact in floating point whichever way a build compares it.
//
// THE FIRING. `specs/weapons.md` ("Cooldown timers"): "On acquisition the
// timer is `0`, so a weapon fires on the first `playing` tick it is held", and
// the harness's `fireWeapon` is exactly that: hold Flare at the level, arm it,
// turn `weaponFire` on, step one tick. Everything else stays held, so the tick
// counts one timer, fires one weapon, and resolves the hits of phase 6
// (`specs/world.md`, "One tick"). `enemyMotion` and `enemyContact` are off, so
// every enemy stands where it was posed on the firing tick and lands nothing.
//
// THE PROBE. A check that asks what a burst did to an enemy reads the firing
// tick's effect on it: ("Hits and death") "A hit removes the shape's damage
// per hit from the enemy's `hp`", and "On any tick an enemy's `hp` is at or
// below `0` after the hits the enemy dies on that tick", so an enemy reads
// `hp` lower by exactly the damage when that leaves it above `0`, and is gone
// when it does not. A moth (`5` hp, `specs/enemies.md`, unscaled at a run
// clock of `0`) dies of any row's damage, so a check that asks only whether an
// enemy was reached reads it as gone. An owl (`2000` hp, an elite, which
// "spawn[s] with their table HP as `maxHp`, unscaled") outlives Flare's
// largest damage, `500` at row 8, so the row checks read the removal exactly.
//
// Every figure below is read from `../constants`, never from a build.

import { assertEqual, assertNear, fail } from "../assert";
import {
  FLOAT_TOL,
  TIMER_TOL,
  type BaseWeaponId,
  weaponRow,
} from "../constants";
import {
  captureStill,
  enemyById,
  fireWeapon,
  isolate,
  placeEnemy,
  type EnemyView,
  type Harness,
  type WickSnapshot,
  type ZoneView,
} from "../harness";

/** The weapon every check here is about. */
export const FLARE: BaseWeaponId = "flare";

/**
 * How far along `+x` from the lamplighter's center the row checks pose their
 * enemy: well inside every row's `640`, and clear of the lamplighter's own
 * circle.
 */
export const TARGET_OFFSET = 100;

/** The Flare bursts among `zones`, in id order. */
export function burstsOf(zones: readonly ZoneView[]): ZoneView[] {
  return zones
    .filter((zone) => zone.kind === "burst" && zone.weapon === FLARE)
    .sort((a, b) => a.id - b.id);
}

/**
 * The one burst `zones` holds, or the point fails: a firing tick creates a
 * single burst, since Flare "ignore[s] amount" and has one shape.
 */
export function oneBurst(zones: readonly ZoneView[], what: string): ZoneView {
  const bursts = burstsOf(zones);
  if (bursts.length !== 1) {
    fail(
      `exactly one zone of kind burst (${what})`,
      zones.map((zone) => ({
        id: zone.id,
        kind: zone.kind,
        weapon: zone.weapon,
      })),
    );
  }
  return bursts[0] as ZoneView;
}

/**
 * The enemy `posed` was burned for `damage` by the tick that left `after`: its
 * `hp` is lower by exactly `damage` when that leaves it above `0`, and it is
 * gone when it does not.
 */
export function assertBurned(
  after: WickSnapshot,
  posed: EnemyView,
  damage: number,
  what: string,
): void {
  const left = posed.hp - damage;
  const now = enemyById(after, posed.id);
  if (left <= 0) {
    if (now === undefined) return;
    fail(
      `${what}: ${posed.type} ${posed.id} dead of the burst (hp ${posed.hp} less ${damage})`,
      `present at hp ${now.hp}`,
    );
  }
  if (now === undefined) {
    fail(
      `${what}: ${posed.type} ${posed.id} present at hp ${left} (hp ${posed.hp} less ${damage})`,
      "gone",
    );
  }
  assertNear(
    now.hp,
    left,
    FLOAT_TOL,
    `${what}: ${posed.type} ${posed.id}'s hp`,
  );
}

/**
 * The enemy `posed` was left alone by the tick that left `after`: still live,
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
    `${what}: ${posed.type} ${posed.id} untouched (present at hp ${posed.hp})`,
    now === undefined ? "gone" : `present at hp ${now.hp}`,
  );
}

/**
 * The `row-N` check: hold Flare at `level` on an isolated night with one owl
 * `TARGET_OFFSET` along `+x`, run the tick it fires on, write the `row` still,
 * and assert what row `level` of `FLARE_LEVELS` gives the firing.
 *
 * `specs/weapons.md` ("Flare"): "On firing, every enemy within `radius` of the
 * player's center takes `damage` on that tick"; ("Shapes and overlap") "a
 * burst's `radius` is its Flare `radius`"; ("Derived stats") the radius is the
 * "table value × `areaMul`" and the damage the "table value × `damageMul`",
 * both `1` with no passive held (`specs/passives.md`); ("Hits and death") "A
 * hit removes the shape's damage per hit from the enemy's `hp`"; ("Cooldown
 * timers") "After firing, the timer is set to the weapon's current cooldown",
 * "the table cooldown times `cooldownMul`", so the slot reads the table
 * cooldown after the firing tick. `specs/instrumentation.md` ("Snapshot
 * shape") has `damage` as "the damage per hit the shape carries".
 *
 * TOLERANCE. `FLOAT_TOL` on the burst's radius and damage, each a table figure
 * times `1`, and on the owl's hp, a posed figure less a table figure;
 * `TIMER_TOL` on the timer the firing set. The burst count is exact.
 */
export async function checkFlareRow(h: Harness, level: number): Promise<void> {
  const row = weaponRow(FLARE, level);

  await isolate(h);
  const owl = await placeEnemy(h, "owl", TARGET_OFFSET, 0);
  const firing = await fireWeapon(h, FLARE, level);
  await captureStill(h, "row");

  const burst = oneBurst(firing.zones, `the level-${level} firing tick`);
  assertNear(
    burst.radius,
    row.radius ?? NaN,
    FLOAT_TOL,
    `the burst's radius at level ${level}`,
  );
  assertNear(
    burst.damage,
    row.damage,
    FLOAT_TOL,
    `the burst's damage at level ${level}`,
  );
  assertBurned(firing.after, owl, row.damage, `the level-${level} firing`);

  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, FLARE, "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    row.cooldown ?? NaN,
    TIMER_TOL,
    `Flare's timer after the level-${level} firing`,
  );
}
