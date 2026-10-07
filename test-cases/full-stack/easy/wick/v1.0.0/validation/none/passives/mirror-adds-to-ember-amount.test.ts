// Wick — passives/mirror-adds-to-ember-amount: Mirror adds `1` per level to
// ember's amount.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror`" with
// `MIRROR_AMOUNT_PER_LEVEL` (`1`), and ("Amount") "A weapon's amount is its
// table `amount` plus `amountBonus`, so at Mirror level `2` every weapon that
// counts projectiles, puddles, strikes, or lanterns fires two more of them."
// Row 1 of `EMBER_LEVELS` (`specs/weapons.md`) carries amount `1`, so with
// Mirror at its max level `2` one firing produces `3` bolts. Every other
// weapon Mirror raises is a point of its own.
//
// THE POSE. An isolated night with Mirror 2 held through `setPassive` and
// three hounds on a ring `500` units out, one per shape an amount of three
// needs: "With amount `n`, `n` bolts fire on the same tick, one at each of the
// `n` nearest distinct enemies, fewer when fewer enemies exist" (Ember), and
// Spark strikes "on a distinct enemy chosen uniformly at random among the live
// enemies within `SPARK_RANGE` (`600`)". A hound's `hp` is `120`
// (`specs/enemies.md`), which no shape of this tick takes to `0`, and `500` is
// clear of every shape created at the lamplighter's center. Every other
// faculty stays held.
//
// TOLERANCE. None: the reading is a count of the shapes one tick created.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PASSIVES, amountBonus, weaponRow } from "../constants";
import {
  alongAngle,
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { fireVolley, shotsOf } from "./stage";

/** Mirror at its max level, `2`: `amountBonus` `2`. */
const MIRROR_LEVEL = PASSIVES.mirror.maxLevel;

/** The level the weapon is held at: table amount `1`. */
const LEVEL = 1;

/** How many hounds stand on the ring: one per shape an amount of three needs. */
const TARGETS = 3;

/** How far out the ring stands: inside `SPARK_RANGE`, clear of every shape. */
const RING = 500;

/** The amount the weapon fires at level 1 with Mirror 2 held: `1` plus `2`. */
const EXPECTED =
  (weaponRow("ember", LEVEL).amount ?? NaN) +
  amountBonus({ mirror: MIRROR_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates three bolts from a level-1 firing with Mirror 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "mirror", MIRROR_LEVEL);
  for (let i = 0; i < TARGETS; i += 1) {
    const at = alongAngle({ x: 0, y: 0 }, (360 * i) / TARGETS, RING);
    await placeEnemy(h, "hound", at.x, at.y);
  }

  const volley = await fireVolley(h, [{ id: "ember", level: LEVEL }]);
  await captureStill(h, "amount");

  assertEqual(
    shotsOf(volley, "ember").length,
    EXPECTED,
    "the bolts a level-1 firing created with Mirror 2 held",
  );
});
