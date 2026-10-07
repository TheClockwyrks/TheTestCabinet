// Meltdown — instrumentation/render-free-core: the simulation advances on the
// elapsed game time alone, so one second reaches the same place however it was
// divided into frames.
//
// THE RULE. `specs/instrumentation.md`, A render-free core: "Every rate is
// integrated against the game time each frame advances by, so an interval of game
// time reaches the same state however it was divided into frames", and, of the
// clock, "`advance(1, 1)` and
// `advance(1, 120)` cover the same second and reach the same outcome, beyond the
// drift a change in step size explains". `specs/waves.md` says the same of the
// game itself: "The game advances by the elapsed time of every frame ... and
// `simTime` accumulates it".
//
// WHY IT MATTERS BEYOND ITSELF. Every measurement in this project is taken over a
// chosen number of frames of a chosen length. A build whose simulation moves a
// fixed step per frame, or that reads the wall clock, or that reads anything from
// its renderer, gives a different answer to the same second depending on how it
// was cut — and every reading in every other suite becomes a reading of the
// harness's frame size rather than of the build.
//
// TWO GAMES, NOT TWO SPANS OF ONE. The same second cannot be run twice on one
// floor, because the second run would start where the first ended. So two
// harnesses open two pages on the same build, are posed alike, and are each
// given one second: one as a SINGLE frame a second long, the other as `TICK_HZ`
// (`120`) frames of a hundred-and-twentieth each.
//
// WHAT IS READ, AND WHY IT IS READ ON A STRAIGHT ROW. `simTime` must gain exactly
// `1.0` on both — a build that accumulates frames rather than time reads `1/120`
// on the fine harness or `1` frame's worth on the coarse one — and a Mote walking
// the open left corridor must stand in the same place on both. The corridor is
// straight from the vent's opening to the opposite exhaust on an empty floor
// (`specs/floor.md`), so the two runs differ in step size and in NOTHING ELSE: no
// corner is turned, where a hundred and twenty small steps and one large one
// legitimately round a bend differently. The unit's position is POSED rather than
// taken from wherever the entry put it, so the two games open at one point by
// construction.
//
// AND THE UNIT MUST HAVE MOVED. A build frozen solid would put the two readings
// in the same place too, so the travel is held to a floor first. How fast it
// walked is `surge/walks-at-its-speed`'s question, not this one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { tileCX, tileCY } from "../constants";
import { laneTile } from "../fixtures";
import {
  captureStill,
  ConstantClock,
  createHarness,
  distance,
  framesFor,
  poseWalker,
  requireUnit,
  startRun,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The second covered, and the two ways it is divided. */
const SPAN_SECONDS = 1;
const COARSE_FRAMES = 1;
const FINE_FRAMES = TICK_HZ;

/** Where on the left corridor the Mote is posed, in tiles from the vent's edge. */
const START_ALONG = 3;

/**
 * How close the two `simTime` readings must come to the second they covered, in
 * decimal places: within `5e-7`.
 *
 * Not a behavioural tolerance. `simTime` accumulates the game time it was handed,
 * and both harnesses were handed exactly one second, so the only difference a
 * conformant build can introduce is the float's own representation of a sum of
 * a hundred and twenty hundred-and-twentieths.
 */
const TIME_DIGITS = 6;

/**
 * How far apart the two positions may be, in logical stage units.
 *
 * The specification allows "the drift a change in step size explains", and on a
 * straight row there is none to explain: an integration of `speed * dt` over one
 * step and over a hundred and twenty comes to the same displacement. Half a
 * logical unit is a thirty-eighth of a tile against the sixty units a Mote covers
 * in the second (`specs/surge.md`) — room for a float's own accumulation and for
 * nothing else. A build stepping a fixed amount per frame lands a hundred and
 * twenty times further on one harness than on the other.
 */
const POSITION_TOLERANCE = 0.5;

/**
 * How far the Mote must have travelled for the comparison to be about motion.
 *
 * A quarter of the sixty logical units a Mote covers in a second
 * (`specs/surge.md`). A build that never moved would satisfy "the same position"
 * trivially; this is the floor that excludes it, and it is deliberately far below
 * the figure so it decides nothing about the speed.
 */
const MIN_TRAVEL = 15;

let coarse: Harness;
let fine: Harness;

/** Pose one Mote on the open left corridor, at a fixed point, and hand back its id. */
async function poseTheWalker(h: Harness): Promise<number> {
  await startRun(h);
  const id = await poseWalker(h, "mote", "left");
  const at = laneTile("left", START_ALONG);
  await h.debug.setUnitPosition(id, tileCX(at.col), tileCY(at.row));
  return id;
}

beforeEach(async () => {
  // One frame a whole second long, against a hundred and twenty of a
  // hundred-and-twentieth each.
  coarse = await createHarness({
    clock: new ConstantClock((SPAN_SECONDS / COARSE_FRAMES) * 1000),
  });
  fine = await createHarness();
});

afterEach(async () => {
  await coarse.dispose();
  await fine.dispose();
});

it("reaches the same second's state as one frame and as a hundred and twenty", async () => {
  const coarseId = await poseTheWalker(coarse);
  const fineId = await poseTheWalker(fine);

  const coarseOpened = await coarse.snapshot();
  const fineOpened = await fine.snapshot();

  await coarse.advance(COARSE_FRAMES);
  await fine.advance(framesFor(SPAN_SECONDS));

  const coarseClosed = await coarse.snapshot();
  const fineClosed = await fine.snapshot();
  // The floor the second left, on the harness that ran it in whole frames.
  await captureStill(fine, "advanced");

  // The same second of game time, however it was cut.
  assertCloseTo(
    coarseClosed.simTime - coarseOpened.simTime,
    SPAN_SECONDS,
    TIME_DIGITS,
    `the game time ${COARSE_FRAMES} frame of a second added to simTime`,
  );
  assertCloseTo(
    fineClosed.simTime - fineOpened.simTime,
    SPAN_SECONDS,
    TIME_DIGITS,
    `the game time ${FINE_FRAMES} frames of a second added to simTime`,
  );

  // And the same place on the floor, on a build whose unit actually walked.
  const coarseFrom = requireUnit(coarseOpened, coarseId, "the posed Mote");
  const coarseTo = requireUnit(coarseClosed, coarseId, "the posed Mote");
  const fineFrom = requireUnit(fineOpened, fineId, "the posed Mote");
  const fineTo = requireUnit(fineClosed, fineId, "the posed Mote");

  assertGreaterThan(
    distance(coarseFrom, coarseTo),
    MIN_TRAVEL,
    `the Mote walked over the second covered in ${COARSE_FRAMES} frame`,
  );
  assertGreaterThan(
    distance(fineFrom, fineTo),
    MIN_TRAVEL,
    `the Mote walked over the second covered in ${FINE_FRAMES} frames`,
  );
  assertLessThanOrEqual(
    Math.abs(coarseTo.x - fineTo.x),
    POSITION_TOLERANCE,
    "the Mote's x apart after one second, one frame against a hundred and twenty",
  );
  assertLessThanOrEqual(
    Math.abs(coarseTo.y - fineTo.y),
    POSITION_TOLERANCE,
    "the Mote's y apart after one second, one frame against a hundred and twenty",
  );
});
