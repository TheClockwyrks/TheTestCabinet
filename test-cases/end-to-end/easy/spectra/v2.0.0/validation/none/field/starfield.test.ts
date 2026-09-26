// field/starfield — a starfield sits behind the play field.
//
// specs/field.md, "The starfield": "A starfield is drawn behind the play field,
// holding at least `STARFIELD_MIN` (`40`) marks distinct from the field behind
// them." How a mark is drawn, where they sit and whether they move are the build's,
// so the only thing asserted here is the COUNT, on an empty field, and nothing
// about the look. specs/overview.md's legibility table adds one more requirement —
// "The starfield sits behind the play field and never reads as bright as a drone of
// either band" — which is a row of the table and is reviewed from the captured
// picture rather than asserted, because it is not a question pixels can decide
// without fixing a look the case leaves to the build.
//
// WHAT COUNTS AS A MARK, AND WHY IT IS COUNTED THAT WAY. A mark is a connected
// blob of pixels that stands out from the field BOTH SIDES of it. It is read as
// local contrast rather than against one sampled colour of the field for two
// reasons: specs/overview.md fixes no palette, so nothing here may assume the
// field is a flat colour or that a mark is brighter than it, and a build that lays
// a gradient, a vignette or a nebula behind its stars must not read as forty
// thousand marks or as none. A wash therefore contributes nothing (its interior
// matches the field either side of it) and a body contributes at most one blob too
// large to be a mark. The blobs are found at the canvas's own resolution, so a mark
// a single pixel across counts once and a mark four across does not count four
// times.
//
// THE FIELD IS EMPTY AND THE SHIP IS OUT OF THE WAY. `startPosed` clears all four
// rosters and shuts the wave's three gates, so nothing is on the field but the
// ship, which no pose can remove; it is parked at `SHIP_X_MIN`, the far corner of
// its lane, where it stands over the least of the field. Nothing about the ship is
// discarded by position: it is a body rather than a mark, so the size bound below
// is what leaves it out, and the 0.15% of the field its hull covers is all a
// starfield can lose to it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  SHIP_X_MIN,
  STARFIELD_MIN,
} from "../constants";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
  type Rect,
} from "../harness";
import { countMarks } from "./canvas";

/**
 * How far a pixel must stand out from the field either side of it, on the 0–441
 * RGB scale, to read as a mark rather than as the field.
 *
 * specs/field.md asks only that a mark be "distinct" from the field behind it, and
 * specs/overview.md forbids it from reading as bright as a drone, so the bar has to
 * sit near the bottom of the scale: a starfield is the one thing on the stage the
 * specification asks to be DIM. 12 of 441 is about a thirty-fifth of the scale —
 * over the rounding a canvas round trip leaves on a flat fill, over anything a
 * smooth gradient moves across the 40 units this reads either side of a pixel, and
 * far under anything a viewer would call indistinct.
 */
const MARK_DISTANCE = 12;

/**
 * How far either side of a pixel the field it sits on is read, in logical units.
 *
 * A mark is found by LOCAL contrast, so the reading has to land OFF the mark it is
 * reading. 20 units clears half of `SHARD_SIZE` (28), the smallest drone on the
 * field, and specs/overview.md rules a starfield mark that reads as big and bright
 * as a drone out of the design. It is part of the reading rather than a bound this
 * check asserts.
 */
const MARK_SPAN = 20;

/** The play field, as specs/field.md's table of regions gives it. */
const PLAY_FIELD: Rect = {
  x: FIELD_LEFT,
  y: FIELD_TOP,
  width: FIELD_RIGHT - FIELD_LEFT,
  height: FIELD_BOTTOM - FIELD_TOP,
};

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("draws at least STARFIELD_MIN marks behind an empty play field", async () => {
  await startPosed(harness);
  // The ship into the far corner of its lane, so the one entity no pose can remove
  // stands where the smallest possible part of the field is spoken for.
  await harness.debug.setShipX(SHIP_X_MIN);
  await harness.advance(1);
  await captureStill(harness, "starfield");

  const marks = await countMarks(harness, PLAY_FIELD, {
    minDistance: MARK_DISTANCE,
    span: MARK_SPAN,
  });

  assertGreaterThanOrEqual(
    marks,
    STARFIELD_MIN,
    `marks standing out from the field either side of them, across the empty ` +
      `play field (specs/field.md asks for at least ${STARFIELD_MIN})`,
  );
});
