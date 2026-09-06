// Wick — spark/target-varies: the target is chosen at random among the
// enemies in range.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "On firing,
// `amount` strikes land, each on a distinct enemy chosen uniformly at random
// among the live enemies within `SPARK_RANGE` (`600`) of the player's
// center". Row 1 of `SPARK_LEVELS` gives amount `1`. So over eighty level-1
// firings over the same four owls in range, the strike lands on every one of
// the four at least once: under a uniform choice the chance that some owl is
// never struck is `4 × (3/4)^80`, about `4e-10`, which is the tolerance this
// check accepts. A build that always strikes the nearest, the lowest id, or
// the first in its list strikes one owl eighty times and fails.
//
// THE POSE. An isolated night, Spark held at level 1 with `weaponFire` on, and
// four owls posed once on the target ring `90` degrees apart. Each of eighty
// rounds arms Spark's timer to `0` through `setWeaponCooldown` and runs one
// tick, and the strike's point is read off the zone the tick created, centered
// on the owl it landed on. Owls rather than moths because an owl's `2000` hp
// outlives eighty strikes of `15`, so the same four enemies under the same ids
// stand for every firing and nothing is cleared or re-posed between rounds;
// four enemies whose ids never change are what tell a choice from a rule.
// `enemyMotion` is held so each owl stands where it was posed. Nothing is
// posed for the target itself, so every draw is the build's own; a posed
// target is `instrumentation/set-next-strike-target`.
//
// TOLERANCE. `POSITION_TOL` on each strike's center against a posed point;
// each round's strike count is exact; and every point struck at least once is
// the `4e-10` above.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  fail,
} from "../assert";
import { ENEMIES, weaponRow } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  newZones,
  type Harness,
} from "../harness";
import { SPARK, placeTargets, ringPoints, strikesOf, targetOf } from "./stage";

/** The level whose row is fired: one strike per firing. */
const LEVEL = 1;

/** The enemy at every point: `2000` hp, alive through eighty strikes of `15`. */
const TYPE = "owl";

/** How many firings the draw is watched over. */
const ROUNDS = 80;

/** The four points an owl stands on throughout. */
const POINTS = ringPoints(4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands the level-1 strike on each of four owls in range at least once over eighty firings", async () => {
  const row = weaponRow(SPARK, LEVEL);
  assertEqual(row.amount, 1, "the level-1 row's amount");
  assertGreaterThanOrEqual(
    ENEMIES[TYPE].hp,
    ROUNDS * row.damage + 1,
    "an owl's hp against eighty strikes",
  );

  await isolate(h);
  const slot = await holdWeapon(h, SPARK, LEVEL);
  await enable(h, "weaponFire");
  await placeTargets(h, TYPE, POINTS);

  const struck = POINTS.map(() => 0);
  let before = await h.snapshot();
  for (let round = 1; round <= ROUNDS; round += 1) {
    await armWeapon(h, slot);
    const after = await h.step(1);
    assertLength(
      after.run.enemies ?? [],
      POINTS.length,
      `owls alive after firing ${round}`,
    );
    const strikes = strikesOf(newZones(before, after));
    assertEqual(
      strikes.length,
      1,
      `Spark strike zones firing ${round} created with four owls in range`,
    );
    const index = targetOf(strikes[0]!, POINTS);
    if (index < 0) {
      fail(`firing ${round}'s strike centered on one of the four posed owls`, {
        x: strikes[0]!.x,
        y: strikes[0]!.y,
      });
    }
    struck[index] += 1;
    before = after;
  }
  await captureStill(h, "random");

  for (const [index, count] of struck.entries()) {
    assertGreaterThanOrEqual(
      count,
      1,
      `strikes on the owl at (${POINTS[index]!.x}, ${POINTS[index]!.y}) over ${ROUNDS} firings`,
    );
  }
});
