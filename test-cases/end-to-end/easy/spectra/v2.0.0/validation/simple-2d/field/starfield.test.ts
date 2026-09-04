// field/starfield — a starfield sits behind the play field.
//
// specs/field.md, "The starfield": "A starfield is drawn behind the play field,
// holding at least `STARFIELD_MIN` (`40`) marks distinct from the field behind
// them." How a mark is drawn, where they sit and whether they move are the build's,
// so the only thing asserted here is the COUNT, on an empty field, and nothing about
// the look. specs/overview.md's legibility table adds one more requirement — "The
// starfield sits behind the play field and never reads as bright as a drone of
// either band" — which is a row of the table and is reviewed from the captured
// picture rather than asserted, because it is not a question pixels can decide
// without fixing a look the case leaves to the build.
//
// WHAT COUNTS AS A MARK, AND WHY IT IS COUNTED THAT WAY. A mark is a connected blob
// of pixels that stands out from the field BOTH SIDES of it. It is read as local
// contrast rather than against one sampled colour of the field for two reasons:
// specs/overview.md fixes no palette, so nothing here may assume the field is a flat
// colour or that a mark is brighter than it, and a build that lays a gradient, a
// vignette or a nebula behind its stars must not read as forty thousand marks or as
// none. A wash therefore contributes nothing (its interior matches the field either
// side of it) and a body contributes at most one blob too large to be a mark. The
// blobs are found at the canvas's own resolution, so a mark a single pixel across
// counts once and a mark four across does not count four times.
//
// THE FIELD IS EMPTY AND THE SHIP IS OUT OF THE WAY. `startPosed` clears all four
// rosters and shuts the wave's three gates, so nothing is on the field but the ship,
// which no pose can remove; it is parked at `SHIP_X_MIN`, the far corner of its lane,
// where it stands over the least of the field. Nothing about the ship is discarded by
// position: it is a body rather than a mark, so the size bound below is what leaves it
// out, and the 0.15% of the field its hull covers is all a starfield can lose to it.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  SHIP_X_MIN,
  STARFIELD_MIN,
} from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Box,
  type Harness,
} from "../harness";
import { countMarksByContrast } from "./canvas";

/**
 * How far a pixel must stand out from the field either side of it, on the 0–441 RGB
 * scale, to read as a mark rather than as the field.
 *
 * specs/field.md asks only that a mark be "distinct" from the field behind it, and
 * specs/overview.md forbids it from reading as bright as a drone, so the bar has to
 * sit near the bottom of the scale: a starfield is the one thing on the stage the
 * specification asks to be DIM. 12 of 441 is about a thirty-fifth of the scale — over
 * the rounding a canvas round trip leaves on a flat fill, over anything a smooth
 * gradient moves across the 20 units this reads either side of a pixel, and far under
 * anything a viewer would call indistinct.
 */
const MARK_DISTANCE = 12;

/**
 * The largest a mark may be, in logical units, on either axis.
 *
 * A bound on what the word "mark" can mean rather than a demand on how a build draws
 * one. `SHARD_SIZE` (28) is the smallest drone on the field, and a starfield mark
 * that reads as big as a drone is the very thing specs/overview.md's legibility row
 * rules out — "so nothing on it is mistaken for something to shoot". 32 is that,
 * rounded up.
 */
const MARK_MAX_EXTENT = 32;

/**
 * How far either side of a pixel the field it sits on is read, in logical units.
 *
 * Above half of `MARK_MAX_EXTENT`, so the reading always lands off the mark it is
 * reading and a mark of any size this check will count is found. 20 is the least
 * that clears 32.
 */
const MARK_SPAN = 20;

/** The play field, as specs/field.md's table of regions gives it. */
const PLAY_FIELD: Box = {
  x: FIELD_LEFT,
  y: FIELD_TOP,
  w: FIELD_RIGHT - FIELD_LEFT,
  h: FIELD_BOTTOM - FIELD_TOP,
};

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws at least STARFIELD_MIN marks behind an empty play field", async () => {
  startPosed(harness);
  // The ship into the far corner of its lane, so the one entity no pose can remove
  // stands where the smallest possible part of the field is spoken for.
  harness.debug.setShipX(SHIP_X_MIN);
  await harness.advance(1);
  captureStill(harness, "starfield");

  const marks = countMarksByContrast(harness, PLAY_FIELD, {
    minDistance: MARK_DISTANCE,
    span: MARK_SPAN,
    maxExtent: MARK_MAX_EXTENT,
  });

  assertGreaterThanOrEqual(
    marks,
    STARFIELD_MIN,
    `marks no wider than ${String(MARK_MAX_EXTENT)} units standing out from the ` +
      `field either side of them, across the empty play field (specs/field.md ` +
      `asks for at least ${String(STARFIELD_MIN)})`,
  );
});
