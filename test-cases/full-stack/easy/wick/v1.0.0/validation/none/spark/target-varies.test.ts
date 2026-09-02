// Wick — spark/target-varies: the target is chosen at random among the
// enemies in range.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "On firing,
// `amount` strikes land, each on a distinct enemy chosen uniformly at random
// among the live enemies within `SPARK_RANGE` (`600`) of the player's
// center"; `specs/instrumentation.md` ("A deterministic core"): "every random
// draw comes from" the one seeded generator, "a strike's target" among them.
// Row 1 of `SPARK_LEVELS` gives amount `1`. So over forty level-1 firings,
// each over the same four points in range, the strike lands on every one of
// the four points at least once: under a uniform choice the chance that some
// point is never struck is `4 × (3/4)^40`, about `4e-5`, which is the
// tolerance this check accepts.
//
// THE POSE. An isolated night from the default seed, Spark held at level 1
// with `weaponFire` on, and forty rounds: the enemies, gems, and pickups are
// cleared, four moths are posed on the target ring `90` degrees apart, Spark's
// timer is armed to `0` through `setWeaponCooldown`, and one tick runs. The
// strike's point is read off the zone the tick created, centered on the moth
// it landed on. Every round poses fresh moths because a moth's `5` hp is below
// the `15` a strike deals, so the struck moth dies on the tick; the four
// points are the same in every round, and the count is over the points.
// `enemyMotion` is held so each moth stands where it was posed.
//
// TOLERANCE. `POSITION_TOL` on each strike's center against a posed point;
// each round's strike count is exact; and every point struck at least once is
// the `4e-5` above.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, fail } from "../assert";
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

/** How many firings the draw is watched over. */
const ROUNDS = 40;

/** The four points a moth stands on in every round. */
const POINTS = ringPoints(4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands the level-1 strike on each of four moths in range at least once over forty firings", async () => {
  await isolate(h);
  const slot = await holdWeapon(h, SPARK, LEVEL);
  await enable(h, "weaponFire");

  const struck = POINTS.map(() => 0);
  for (let round = 0; round < ROUNDS; round += 1) {
    await h.debug.clearEnemies();
    await h.debug.clearGems();
    await h.debug.clearPickups();
    await placeTargets(h, "moth", POINTS);
    await armWeapon(h, slot);
    const before = await h.snapshot();
    const after = await h.step(1);
    const strikes = strikesOf(newZones(before, after));
    assertEqual(
      strikes.length,
      1,
      `Spark strike zones firing ${round + 1} created with four moths in range`,
    );
    const index = targetOf(strikes[0]!, POINTS);
    if (index < 0) {
      fail(
        `firing ${round + 1}'s strike centered on one of the four posed moths`,
        { x: strikes[0]!.x, y: strikes[0]!.y },
      );
    }
    struck[index] += 1;
  }
  await captureStill(h, "random");

  for (const [index, count] of struck.entries()) {
    assertGreaterThanOrEqual(
      count,
      1,
      `strikes on the moth at (${POINTS[index]!.x}, ${POINTS[index]!.y}) over ${ROUNDS} firings`,
    );
  }
});
