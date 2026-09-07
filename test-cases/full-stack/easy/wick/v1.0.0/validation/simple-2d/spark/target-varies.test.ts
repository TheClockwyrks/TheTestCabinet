// Wick — spark/target-varies: the target is chosen at random among the
// enemies in range.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Spark"): "On firing, `amount` strikes land, each on
//     a distinct enemy chosen uniformly at random among the live enemies
//     within `SPARK_RANGE` (`600`) of the player's center". Row 1 of
//     `SPARK_LEVELS` gives amount `1`.
//
// WHAT IS READ. Sixteen level-1 firings over the same four owls in range: the
// strike lands on at least two distinct owls. Under a uniform choice the
// chance that all sixteen land on one owl is `4 × (1/4)^16`, under `1e-9`,
// which is the tolerance this check accepts; a build that always strikes the
// nearest, the lowest id, or the first in its list strikes one owl sixteen
// times and fails. Nothing is posed for the target, so every draw is the
// build's own; a posed target is `instrumentation/set-next-strike-target`.
//
// WHY THE NIGHT IS POSED AS IT IS. Spark alone at level 1 with four owls at
// the posts of `spark/strike`, every switch off but `weaponFire`, so nothing
// moves and each owl's posed center is what a strike is matched against; the
// owls stand at least `250` apart, beyond any area, so each firing's strike is
// centered on one owl alone. Owls rather than moths because a target that
// dies would be replaced under a fresh id, and a picker that takes the first
// or the newest enemy would then wander across the posts without choosing
// anything at random; four enemies whose ids never change are what tell a
// choice from a rule, and an owl's 2000 hp outlives sixteen strikes of 15.
//
// TOLERANCE. `FIGURE_TOLERANCE` on a strike's center against an owl's posed
// center; the counts are whole numbers.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { ENEMIES } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { armSpark, sparkRow, strikesIn, targetOf, targetsFor } from "./strike";

/** The level held: amount 1, one strike a firing. */
const LEVEL = 1;

/** The enemy at every post: HP 2000, alive through sixteen strikes of 15. */
const TYPE = "owl";

/** How many owls stand within range. */
const POSTS = 4;

/** How many times Spark fires. */
const FIRINGS = 16;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("strikes at least two distinct owls over sixteen firings", async () => {
  const row = sparkRow(LEVEL);
  assertEqual(row.amount, 1, "the level-1 row's amount");
  assertGreaterThanOrEqual(
    ENEMIES[TYPE].hp,
    FIRINGS * row.damage + 1,
    "an owl's HP against sixteen strikes",
  );
  const volley = armSpark(h, LEVEL, targetsFor(POSTS), TYPE);
  const owls = volley.targets;
  const struck = owls.map(() => 0);
  const seen = new Set<number>();

  for (let firing = 1; firing <= FIRINGS; firing += 1) {
    armWeapon(h, volley.slot);
    const after = await h.tick(1);
    assertEqual(
      after.run.enemies.length,
      POSTS,
      `owls alive after firing ${firing}`,
    );
    const fresh = strikesIn(after).filter((strike) => !seen.has(strike.id));
    for (const strike of fresh) seen.add(strike.id);
    assertEqual(fresh.length, 1, `new Spark strikes on firing ${firing}`);
    struck[targetOf(fresh[0], owls, `the strike of firing ${firing}`)] += 1;
  }
  captureStill(h, "random");

  assertGreaterThan(
    struck.filter((count) => count > 0).length,
    1,
    `distinct owls struck over ${FIRINGS} firings (strikes per owl: ${struck.join(", ")})`,
  );
});
