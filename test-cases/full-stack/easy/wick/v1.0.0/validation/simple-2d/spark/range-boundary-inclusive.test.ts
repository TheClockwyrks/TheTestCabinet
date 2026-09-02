// Wick — spark/range-boundary-inclusive: an enemy whose center is exactly
// SPARK_RANGE from the lamplighter's center is within the range.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Spark"): strikes land "among the live enemies
//     within `SPARK_RANGE` (`600`) of the player's center"; the level-1 row
//     has amount `1`.
//   - `specs/weapons.md` ("Shapes and overlap"): "An enemy is within `d` of a
//     point when the distance from that point to the enemy's center is at
//     most `d`", so a distance of exactly `600` is within.
//   - `specs/state.md` (`ZoneState`): a strike's "`x`, `y`" is "the center of
//     the circle", which a strike lands about its target's center.
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's damage
//     per hit from the enemy's `hp`"; a moth has HP `5` (`specs/enemies.md`)
//     against the strike's `15`, so a struck moth dies on the tick.
//
// WHAT IS READ. After the firing tick with the only moth exactly `600` units
// out: the count of Spark strikes, `1`; the strike's center, the moth's posed
// center; the moth gone or its hp lower. A build whose range test is strict
// finds no target and fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Spark alone at level 1, every
// switch off but `weaponFire`. The moth stands along `+x`, so its distance is
// the offset itself, `600` exactly in a double, with no square root to round;
// `enemyMotion` off holds it there for the firing tick. With one moth the
// random choice has one outcome.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the strike's center against the posed
// center. None on the count or on the moth's absence.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPARK_RANGE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  armSpark,
  assertStruck,
  sparkRow,
  strikesIn,
  strikesOn,
} from "./strike";

/** The level held: amount 1. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands the strike on a moth exactly 600 units from the lamplighter", async () => {
  assertEqual(sparkRow(LEVEL).amount, 1, "the level-1 row's amount");
  const volley = armSpark(h, LEVEL, [{ x: SPARK_RANGE, y: 0 }]);
  const [moth] = volley.targets;
  assertEqual(
    Math.hypot(moth.at.x - volley.player.x, moth.at.y - volley.player.y),
    SPARK_RANGE,
    "the posed moth's distance from the lamplighter's center",
  );

  const after = await h.tick(1);
  captureStill(h, "boundary");

  const strikes = strikesIn(after);
  assertEqual(strikes.length, 1, "Spark strikes after the firing tick");
  assertEqual(
    strikesOn(strikes, moth).length,
    1,
    "strikes centered on the moth at 600",
  );
  assertStruck(volley.posed, after, moth.id, "the moth at 600");
});
