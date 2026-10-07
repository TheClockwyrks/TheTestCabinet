// Wick — spark/splash: a strike hits every enemy within `area` of its
// target's center, and none beyond it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Spark"): "A strike deals `damage` to its target and
//     to every other enemy within `area` of the target's center, on the tick
//     it lands"; the level-1 row has area `40`, damage `15`, and amount `1`.
//   - `specs/weapons.md` ("Shapes and overlap"): "An enemy is within `d` of a
//     point when the distance from that point to the enemy's center is at
//     most `d`", the test a weapon's section names "instead" of overlap, so a
//     moth `35` from the target's center is within `40` and a moth `45` away
//     is not, though its circle of radius `10` overlaps the strike's.
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's damage
//     per hit from the enemy's `hp`"; a moth has HP `5` (`specs/enemies.md`),
//     so a moth the strike reached is gone after the tick.
//   - `specs/weapons.md` ("Spark"): strikes land "among the live enemies within
//     `SPARK_RANGE` (`600`)", so with the target at `590` and the two other
//     moths at `625` and `635` the target is the one eligible enemy.
//
// WHAT IS READ. After the firing tick: the count of Spark strikes, `1`; the
// strike's center, the target's posed center; the moth `35` from that center
// gone or its hp lower; the moth `45` from it standing with its hp exactly as
// it was. A build whose splash tests circle overlap, or reaches its target
// alone, fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Three moths in a line along `+x` and Spark
// alone at level 1, every switch off but `weaponFire`. The target stands at
// `590`, inside the range, and the two probes beyond it at `625` and `635`,
// outside it, so the random choice has one outcome and the probes are reached
// by the splash alone; `enemyMotion` off holds all three where they are posed.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the strike's center against the target's
// posed center. None on the count, on a moth's absence, or on an untouched hp.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { SPARK_RANGE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  armSpark,
  assertStruck,
  assertUnhurt,
  sparkRow,
  strikesIn,
  strikesOn,
} from "./strike";

/** The level held: area 40, amount 1. */
const LEVEL = 1;

/** Where the target stands: inside the range, along +x. */
const TARGET_DX = 590;

/** How far past the target the moth the splash reaches stands. */
const INSIDE_AREA = 35;

/** How far past the target the moth the splash misses stands. */
const OUTSIDE_AREA = 45;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reaches a moth 35 from the target's center and not one 45 from it", async () => {
  const row = sparkRow(LEVEL);
  assertEqual(row.amount, 1, "the level-1 row's amount");
  assertLessThan(INSIDE_AREA, row.area, "the nearer probe against the area");
  assertGreaterThan(
    OUTSIDE_AREA,
    row.area,
    "the farther probe against the area",
  );
  assertLessThan(TARGET_DX, SPARK_RANGE, "the target against the range");
  assertGreaterThan(
    TARGET_DX + INSIDE_AREA,
    SPARK_RANGE,
    "the nearer probe against the range",
  );
  const volley = armSpark(h, LEVEL, [
    { x: TARGET_DX, y: 0 },
    { x: TARGET_DX + INSIDE_AREA, y: 0 },
    { x: TARGET_DX + OUTSIDE_AREA, y: 0 },
  ]);
  const [target, near, far] = volley.targets;

  const after = await h.tick(1);
  captureStill(h, "splash");

  const strikes = strikesIn(after);
  assertEqual(strikes.length, 1, "Spark strikes after the firing tick");
  assertEqual(
    strikesOn(strikes, target).length,
    1,
    "strikes centered on the target at 590",
  );
  assertStruck(volley.posed, after, near.id, "the moth 35 from the target");
  assertUnhurt(volley.posed, after, far.id, "the moth 45 from the target");
});
