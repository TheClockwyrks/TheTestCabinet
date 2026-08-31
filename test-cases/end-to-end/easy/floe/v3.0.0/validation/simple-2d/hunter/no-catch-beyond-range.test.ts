// hunter/no-catch-beyond-range — a bear just out of reach catches nothing.
//
// specs/hunter.md puts the catch at a straight-line distance between centres of
// AT MOST `BEAR_CATCH_DIST` (`18`) stage units. This is the far side of that
// figure: at `24` units the bear is out of reach, and three seconds of standing
// there costs the critter nothing.
//
// THE OFFSET IS DIAGONAL, so the wrong measures read as different numbers. The
// straight line is `24` and outside the range; the larger of the two axes is
// `16.97` and inside it, so a build that compared axes rather than the hypotenuse
// takes a life here where none is owed. `catches` poses the same diagonal one unit
// INSIDE the figure, and the pair pins the rule from both ends: a build that
// catches at any distance passes there and fails here, and one that never catches
// fails there and passes here.
//
// The catch-test gate is on, because a check that a catch does NOT happen means
// nothing with the gate that decides catches shut. The bear's travel is off, as
// the item states, along with its sense and its routing: a bear that travelled
// would close the gap itself and turn this into a reading of its speed.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, colAt, rowAt, tileCX, tileCY } from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  bearOf,
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The tile the critter stands on: the ice band, which an emptied strait leaves bare. */
const COL = 20;
const ROW = 15;

/** The straight-line distance posed, in stage units, from the item. */
const POSED_DISTANCE = 24;

/** The offset on each axis that puts the two centres exactly that far apart. */
const AXIS_OFFSET = POSED_DISTANCE / Math.SQRT2;

/** The bear's centre, and the tile that centre falls in. */
const BEAR_X = tileCX(COL) + AXIS_OFFSET;
const BEAR_Y = tileCY(ROW) + AXIS_OFFSET;

/** The game time it is held out of reach for, from the item. */
const HOLD_SECONDS = 3;

/**
 * Decimal places the posed separation is confirmed to, before anything is driven.
 *
 * Three places is a thousandth of a stage unit — six thousand times finer than
 * the six units this pose sits outside the figure by, so this can only catch a
 * pose the build did not carry out, never a rounding.
 */
const DISTANCE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs no life over three seconds with a bear beyond BEAR_CATCH_DIST", async () => {
  startCrossing(h);
  h.debug.setCritterTile(COL, ROW);
  h.debug.setCatchTest(true);

  // Settled on the tile its posed centre falls in, so the pose is a bear standing
  // where it stands rather than a bear reported on a tile it is nowhere near.
  const id = poseBear(h, colAt(BEAR_X), rowAt(BEAR_Y), {
    sense: false,
    routing: false,
    travel: false,
  });
  h.debug.setBearPosition(id, BEAR_X, BEAR_Y);

  // The scenario this check needs, read off the game itself: the two centres
  // really are POSED_DISTANCE apart, and the catch test really is running. A
  // life kept with the catch test shut, or with a bear the pose never moved,
  // would say nothing about the figure at all.
  const posed = h.snapshot();
  const bear = bearOf(posed, id);
  assertCloseTo(
    Math.hypot(bear.x - posed.critter.x, bear.y - posed.critter.y),
    POSED_DISTANCE,
    DISTANCE_DIGITS,
    "stage units between the two centres, as posed",
  );
  assertEqual(
    posed.catchTest,
    true,
    "the catch test, opened for this check (specs/instrumentation.md)",
  );

  const after = await captureReplay(h, "near", async () => {
    await h.advance(ticksFor(HOLD_SECONDS));
    return h.snapshot();
  });

  assertEqual(
    after.lives,
    START_LIVES,
    `lives after ${HOLD_SECONDS} s with a bear ${POSED_DISTANCE} units from ` +
      `the critter`,
  );
});
