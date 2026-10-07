// Wick — spark/targets-within-range: a strike lands on an enemy within
// SPARK_RANGE and not on one beyond it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Spark"): "On firing, `amount` strikes land, each on
//     a distinct enemy chosen uniformly at random among the live enemies
//     within `SPARK_RANGE` (`600`) of the player's center", and "A strike
//     deals `damage` to its target and to every other enemy within `area` of
//     the target's center, on the tick it lands"; the level-1 row has amount
//     `1` and area `40`.
//   - `specs/weapons.md` ("Shapes and overlap"): "An enemy is within `d` of a
//     point when the distance from that point to the enemy's center is at
//     most `d`", so a moth at `599` is within the range and one at `601` is
//     not.
//   - `specs/state.md` (`ZoneState`): a strike's "`x`, `y`" is "the center of
//     the circle", the circle a strike lands about its target's center.
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's damage
//     per hit from the enemy's `hp`", and an enemy whose hp is "at or below
//     `0` after the hits ... dies on that tick"; a moth has HP `5`
//     (`specs/enemies.md`) and the strike deals `15`.
//
// WHAT IS READ. After the firing tick with one moth at `599` and one at
// `601`: the count of Spark strikes, `1`; the strike's center, the nearer
// moth's posed center; the nearer moth gone or its hp lower; the farther moth
// standing with its hp exactly as it was. A build whose range takes in the
// moth at `601`, or that strikes nothing, fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Two moths and Spark alone at level 1,
// every switch off but `weaponFire`. `enemyMotion` off holds each moth at its
// posed distance, so the range the firing tick reads is the posed one. The
// moths stand on opposite sides of the lamplighter, `1200` apart, so a strike
// of area `40` on one reaches nothing of the other. With exactly one eligible
// target the random choice has one outcome.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the strike's center against the posed
// center, a figure read back from the build and restated by it. None on the
// count, on a moth's absence, or on an untouched hp, read exactly.

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

/** The level held: amount 1, so the one strike has one target to land on. */
const LEVEL = 1;

/** The nearer moth, one unit inside the range, along +x. */
const INSIDE_DX = 599;

/** The farther moth, one unit outside the range, along -x. */
const OUTSIDE_DX = -601;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands the strike on the moth at 599 and not on the moth at 601", async () => {
  assertEqual(sparkRow(LEVEL).amount, 1, "the level-1 row's amount");
  assertLessThan(INSIDE_DX, SPARK_RANGE, "the nearer moth against the range");
  assertGreaterThan(
    Math.abs(OUTSIDE_DX),
    SPARK_RANGE,
    "the farther moth against the range",
  );
  const volley = armSpark(h, LEVEL, [
    { x: INSIDE_DX, y: 0 },
    { x: OUTSIDE_DX, y: 0 },
  ]);
  const [inside, outside] = volley.targets;

  const after = await h.tick(1);
  captureStill(h, "range");

  const strikes = strikesIn(after);
  assertEqual(strikes.length, 1, "Spark strikes after the firing tick");
  assertEqual(
    strikesOn(strikes, inside).length,
    1,
    "strikes centered on the moth at 599",
  );
  assertStruck(volley.posed, after, inside.id, "the moth at 599");
  assertUnhurt(volley.posed, after, outside.id, "the moth at 601");
});
