// Wick — oil-splash/scatter-within-radius: every puddle lands within
// `OIL_SCATTER` of the lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "On
// firing, `amount` puddles appear, each centered at an independent uniformly
// random point of the disk of radius `OIL_SCATTER` (`400`) about the player's
// center: a distance `OIL_SCATTER × sqrt(u)` at a uniformly random angle, with
// `u` uniform on `[0, 1)`." So the distance from the lamplighter's center on
// the firing tick to each puddle's center is below `400`, whatever `u` and the
// angle were drawn as. ("Derived stats") "`OIL_SCATTER` ... [is] unchanged by
// any passive", and none is held.
//
// WHAT IS READ. Twenty firings, each read as the puddles its tick created
// against the lamplighter's center of that tick, all at once against the one
// bound. The lamplighter is posed off the origin first, so a build measuring
// its scatter from `(0, 0)` rather than from the player is read against the
// right center. Oil Splash is held at level 8, whose row fires four puddles,
// so the twenty firings draw eighty landing points rather than twenty; the
// count is not asserted here beyond there being at least one puddle to read,
// since how many a row fires is the `row-*` points'.
//
// THE POSE. An isolated night, the lamplighter at `(300, -200)`, Oil Splash
// alone at level 8, fired through the shared `fireOil` and then nineteen times
// more through `refireOil`, each a re-armed timer and one tick. Nothing else
// runs, and no enemy is posed, so the puddles pulse on nothing.
//
// TOLERANCE. `POSITION_TOL` above `OIL_SCATTER` on each distance: the bound is
// strict in the specification, and the tolerance only covers a build that
// rounds its draw so that `sqrt(u)` reaches exactly `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { OIL_SCATTER, POSITION_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  distanceBetween,
  isolate,
  type Harness,
} from "../harness";
import { centerOf, fireOil, puddlesOf, refireOil } from "./stage";

/** The level fired: row 8, four puddles a firing. */
const LEVEL = 8;

/** How many firings are read, as the review item states. */
const FIRINGS = 20;

/** Where the lamplighter stands: off the origin, so the center is the player's. */
const PLAYER = { x: 300, y: -200 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands every puddle of twenty firings within 400 of the lamplighter's center", async () => {
  await isolate(h);
  await h.debug.setPlayerPosition(PLAYER.x, PLAYER.y);

  const readings: { firing: number; puddle: number; distance: number }[] = [];
  let fired = await fireOil(h, LEVEL);
  for (let index = 0; index < FIRINGS; index += 1) {
    if (index > 0) fired = await refireOil(h, fired.slot);
    const at = fired.after.run.player;
    const puddles = puddlesOf(fired);
    assertGreaterThan(
      puddles.length,
      0,
      `Oil Splash puddles firing ${index} created`,
    );
    for (const puddle of puddles) {
      readings.push({
        firing: index,
        puddle: puddle.id,
        distance: distanceBetween(centerOf(puddle), at),
      });
    }
  }
  await captureStill(h, "scatter");

  for (const reading of readings) {
    assertLessThanOrEqual(
      reading.distance,
      OIL_SCATTER + POSITION_TOL,
      `the distance from the lamplighter's center to puddle ${reading.puddle} of firing ${reading.firing}`,
    );
  }
});
