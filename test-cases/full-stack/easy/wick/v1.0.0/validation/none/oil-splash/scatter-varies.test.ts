// Wick — oil-splash/scatter-varies: puddles land at random points.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): each
// puddle is "centered at an independent uniformly random point of the disk of
// radius `OIL_SCATTER` (`400`) about the player's center". Twenty independent
// draws land at more than one point, because a draw that always lands at one
// point is no draw from a disk.
//
// WHAT IS READ. The centers of the puddles twenty level-1 firings create,
// counted as distinct points. Level 1 fires one puddle, so each firing is one
// draw. Nothing is posed for the landing point, so every draw is the build's
// own; where a posed puddle lands is `instrumentation/set-next-puddle-offset`.
//
// THE POSE. An isolated night with Oil Splash alone at level 1, fired through
// the shared `fireOil` and then nineteen times more through `refireOil`.
// Nothing else runs and no enemy is posed, so the puddles pulse on nothing.
//
// TOLERANCE. Two centers are one point when they are within `POSITION_TOL`, so
// a build that reports its positions rounded to the unit still counts a
// repeated point as repeated. The probability that twenty genuine draws from a
// disk of radius `400` all coincide within a millionth of a unit is nil.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import {
  centerOf,
  distinctPoints,
  fireOil,
  puddlesOf,
  refireOil,
} from "./stage";

/** The level fired: row 1, one puddle a firing, one draw a firing. */
const LEVEL = 1;

/** How many firings are read, as the review item states. */
const FIRINGS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands twenty puddles at more than one point", async () => {
  await isolate(h);
  const landings: { x: number; y: number }[] = [];
  let fired = await fireOil(h, LEVEL);
  for (let index = 0; index < FIRINGS; index += 1) {
    if (index > 0) fired = await refireOil(h, fired.slot);
    const puddles = puddlesOf(fired);
    assertGreaterThan(
      puddles.length,
      0,
      `Oil Splash puddles firing ${index} created`,
    );
    landings.push(centerOf(puddles[0]!));
  }
  await captureStill(h, "random");

  assertEqual(landings.length, FIRINGS, "landing points read");
  assertGreaterThan(
    distinctPoints(landings).length,
    1,
    `distinct landing points among ${FIRINGS} firings`,
  );
});
