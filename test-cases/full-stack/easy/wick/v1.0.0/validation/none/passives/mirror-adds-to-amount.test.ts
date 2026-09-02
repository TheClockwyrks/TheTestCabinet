// Wick — passives/mirror-adds-to-amount: Mirror adds `1` per level to every
// weapon's amount.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror`" with
// `MIRROR_AMOUNT_PER_LEVEL` (`1`), and ("Amount") "A weapon's amount is its
// table `amount` plus `amountBonus`, so at Mirror level `2` every weapon that
// counts projectiles, puddles, strikes, or lanterns fires two more of them."
// Row 1 of every table in `specs/weapons.md` carries amount `1` for Ember, Pin,
// Lantern, Oil Splash, Spark, Shard, and Sconce, so with Mirror at its max
// level `2` each firing produces `3`.
//
// THE POSE. An isolated night with Mirror 2 held through `setPassive` and
// `TARGETS` (`3`) hounds posed on a ring `RING` (`500`) units out, one per
// bolt: "With amount `n`, `n` bolts fire on the same tick, one at each of the
// `n` nearest distinct enemies, fewer when fewer enemies exist" (Ember), and
// Spark strikes "on a distinct enemy chosen uniformly at random among the live
// enemies within `SPARK_RANGE` (`600`)", so three enemies inside that range is
// what an amount of three needs. A hound's `hp` is `120` (`specs/enemies.md`),
// which no shape of this tick takes to `0`, and `500` is clear of every shape
// created at the lamplighter's center.
//
// There are `WEAPON_SLOTS` (`6`) weapon slots and seven weapons to read, so the
// night is posed twice: six weapons fire on the first tick and Sconce on the
// second, each from its own isolated run. Every other faculty stays held.
//
// TOLERANCE. None: each reading is a count of the shapes one tick created.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PASSIVES, amountBonus, type WeaponId, weaponRow } from "../constants";
import {
  alongAngle,
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { fireVolley, shapesOf, shotsOf, type Volley } from "./stage";

/** Mirror at its max level, `2`: `amountBonus` `2`. */
const MIRROR_LEVEL = PASSIVES.mirror.maxLevel;

/** The level every weapon is held at: table amount `1` on each. */
const LEVEL = 1;

/** How many hounds stand on the ring: one per shape an amount of three needs. */
const TARGETS = 3;

/** How far out the ring stands: inside `SPARK_RANGE`, clear of every shape. */
const RING = 500;

/** `amountBonus` at Mirror 2: `2`. */
const BONUS = amountBonus({ mirror: MIRROR_LEVEL });

/** The amount `weapon` fires at level 1 with Mirror 2 held: its row's `1` plus `2`. */
const expectedFor = (weapon: WeaponId): number =>
  (weaponRow(weapon, LEVEL).amount ?? NaN) + BONUS;

/** The weapons whose shapes are projectiles, and those whose shapes are zones. */
const SHOTS: readonly WeaponId[] = ["ember", "pin", "shard"];
const SHAPES: readonly WeaponId[] = ["lantern", "oil-splash", "spark"];

/** Pose the night: Mirror held and three hounds on the ring. */
async function stage(h: Harness): Promise<void> {
  await isolate(h);
  await holdPassive(h, "mirror", MIRROR_LEVEL);
  for (let i = 0; i < TARGETS; i += 1) {
    const at = alongAngle({ x: 0, y: 0 }, (360 * i) / TARGETS, RING);
    await placeEnemy(h, "hound", at.x, at.y);
  }
}

/** Assert `weapon`'s firing created its row's amount plus the bonus. */
function assertAmount(
  volley: Volley,
  weapon: WeaponId,
  shapes: "projectiles" | "zones",
): void {
  const created =
    shapes === "projectiles"
      ? shotsOf(volley, weapon)
      : shapesOf(volley, weapon);
  assertEqual(
    created.length,
    expectedFor(weapon),
    `the ${weapon} shapes a level-1 firing created with Mirror 2 held`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates three of every shape a level-1 firing counts with Mirror 2 held", async () => {
  await stage(h);
  const first = await fireVolley(h, [
    ...SHOTS.map((id) => ({ id, level: LEVEL })),
    ...SHAPES.map((id) => ({ id, level: LEVEL })),
  ]);
  await captureStill(h, "amount");
  for (const weapon of SHOTS) assertAmount(first, weapon, "projectiles");
  for (const weapon of SHAPES) assertAmount(first, weapon, "zones");

  await stage(h);
  const second = await fireVolley(h, [{ id: "sconce", level: LEVEL }]);
  assertAmount(second, "sconce", "projectiles");
});
