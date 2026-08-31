// hunter/catches — a bear that reaches the critter catches it.
//
// specs/hunter.md: "A bear catches the critter, while the critter is in play, when
// the straight-line distance between their centers,
// `hypot(bearX - critterX, bearY - critterY)`, is at most `BEAR_CATCH_DIST` (`18`)
// stage units. This is the one distance in the game measured in stage units rather
// than in tiles." The critter loses a life, wherever on the strait the two met.
//
// THE OFFSET IS DIAGONAL, AND THAT IS THE WHOLE POINT OF IT. The bear is posed one
// unit inside the range — `17` units from the critter's centre — along the
// diagonal, so the three distances a build might have reached for read as three
// different numbers: the straight line is `17` and inside the range, the sum of
// the two axes is `24.04` and outside it, and the larger of the two axes is `12.02`
// and well inside. A build that measured either of the other two grades
// differently here from one that measured the specified one, and
// `no-catch-beyond-range` poses the same diagonal on the far side of the figure so
// the pair pins the rule from both ends.
//
// The catch-test gate is the one gate this item's requirement IS, so it is the one
// `startCrossing` shut that is opened again. The bear is posed with all three of
// its faculties off: what is read is the catch, not a pursuit that produced one,
// and a frozen bear cannot drift out of the range between the pose and the tick.

import { afterEach, beforeEach, it } from "vitest";
import {
  BEAR_CATCH_DIST,
  START_LIVES,
  tileCX,
  tileCY,
} from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  bearOf,
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  type Harness,
} from "../harness";

/** The tile both bodies stand on: the ice band, which an emptied strait leaves bare. */
const COL = 20;
const ROW = 15;

/**
 * The straight-line distance posed, in stage units: one inside the figure.
 *
 * One unit is a thirty-second of a tile — far too fine for any other rule in the
 * game to be what is being read, and far too coarse for arithmetic to matter.
 */
const POSED_DISTANCE = BEAR_CATCH_DIST - 1;

/** The offset on each axis that puts the two centres exactly that far apart. */
const AXIS_OFFSET = POSED_DISTANCE / Math.SQRT2;

/**
 * Decimal places the posed separation is confirmed to, before anything is driven.
 *
 * Three places is a thousandth of a stage unit — a thousand times finer than the
 * one unit this pose sits inside the figure by, so this can only catch a pose the
 * build did not carry out, never a rounding.
 */
const DISTANCE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs a life when a bear is inside BEAR_CATCH_DIST of the critter", async () => {
  startCrossing(h);
  h.debug.setCritterTile(COL, ROW);
  h.debug.setCatchTest(true);

  const id = poseBear(h, COL, ROW, {
    sense: false,
    routing: false,
    travel: false,
  });
  h.debug.setBearPosition(
    id,
    tileCX(COL) + AXIS_OFFSET,
    tileCY(ROW) + AXIS_OFFSET,
  );

  // The scenario this check needs, read off the game itself: the two centres
  // really are POSED_DISTANCE apart, and the catch test really is running. A life
  // lost from a bear the pose never moved would say nothing about the figure.
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

  const after = await captureReplay(h, "catch", async () => {
    await h.advance(1);
    return h.snapshot();
  });

  assertEqual(
    after.lives,
    START_LIVES - 1,
    `lives after a tick with a bear ${POSED_DISTANCE} units from the critter`,
  );
});
