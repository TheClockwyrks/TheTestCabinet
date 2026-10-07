// instrumentation/render-free-core — the simulation advances on the stepped
// time it is handed and on nothing else, so one second of game time handed over
// as a single frame runs the same ticks as one handed over a tick at a time.
//
// specs/instrumentation.md rests the whole surface on it, under A render-free
// core: game state advances "from the elapsed simulation time the game is
// handed, in whole `TICK_DT` ticks as specs/overview.md fixes, with no canvas
// and no wall clock", and "the number of ticks run over an interval of game time
// is the same however that interval was divided into frames". specs/overview.md
// says how: the simulation advances "by the whole `TICK_DT` ticks that delta
// completes, carrying the remainder into the next frame".
//
// SO THE SECOND IS SPENT IN THE DIVISION NO OTHER POINT DRIVES. Every other point
// in this suite drives a clock of one tick a frame, where a fixed step per frame
// and the specification's rule are the same arithmetic. This one hands the
// engine the whole second as ONE frame — a clock of a hundred and twenty ticks a
// frame, and a single `advance(1)` on it. A build that integrates against the
// elapsed time it is handed carries its lane the figure specs/ice.md states; a
// build that runs a FIXED step per frame, one tick whatever it was handed,
// covers a hundred and twentieth of a second and lands a hundred and twentieth
// of the way.
//
// THE WITNESSES ARE THE CLOCK AND ONE LANE. `simTime` says the ticks were
// counted; the vehicle says the strait was carried the distance those ticks are
// worth. specs/ice.md fixes it: "A lane at speed `s` and direction `d` moves
// every one of its vehicles by `d * s * TILE` units per second of game time", so
// a lane posed at `2.0` tiles per second carries its vehicle `64` units over the
// second, read within a tenth of a unit, which is the figure this review item
// states.
//
// WHAT THIS DOES NOT DECIDE. Not the tick's own length, which is
// `instrumentation/tick-length`'s, and not the figure any level's lane runs at,
// which is `ice/lane-speeds`'s.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_HZ, TILE, type LaneDir } from "../constants";
import { assertCloseTo, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseLane,
  startCrossing,
  vehicleOf,
  type Harness,
} from "../harness";

/** The lane the reading is taken on, and the vehicle standing in it. */
const LANE_ROW = 12;
const LANE_KIND = "car" as const;
const START_COL = 10;

/** The motion posed onto it: rightward, at two tiles a second. */
const LANE_SPEED = 2;
const LANE_DIR: LaneDir = 1;

/** What specs/ice.md makes that worth over one second of game time. */
const TRAVEL_PER_SECOND = LANE_DIR * LANE_SPEED * TILE;

/** The span of game time the frame carries, in whole ticks: one second. */
const SPAN_TICKS = TICK_HZ;

/**
 * How far the accumulated `simTime` may sit from the second it was given, as
 * `assertCloseTo` digits.
 *
 * Nine digits is half a nanosecond. A conforming build adds `TICK_DT` a hundred
 * and twenty times and the only distance from `1.0` is the sum of a hundred and
 * twenty doubles — this is that arithmetic, not room for a different reading of
 * the rule. A build advancing one fixed tick per FRAME reports a hundred and
 * twentieth of it.
 */
const SIM_DIGITS = 9;

/**
 * How far the vehicle may finish from the units the second is worth, in stage
 * units.
 *
 * A tenth of a unit, which is the figure this review item states, and about a
 * three-hundredth of a tile. A hundred and twenty additions of `0.5333…` land
 * parts in a quadrillion from `64`; a build stepping once per frame is short by
 * all but one of them.
 */
const TRAVEL_TOLERANCE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries a lane one second's worth over a second handed over as one frame", async () => {
  startCrossing(h);

  // One vehicle on an otherwise empty strait, in a lane posed at the speed and
  // direction this reading is taken against. `poseLane` stops the lane first, so
  // the vehicle lands exactly where it was put.
  const [vehicle] = poseLane(h, LANE_ROW, LANE_KIND, [START_COL]);
  h.debug.setLaneSpeed(LANE_ROW, LANE_SPEED);
  h.debug.setLaneDirection(LANE_ROW, LANE_DIR);

  const posed = h.snapshot();
  const posedX = vehicleOf(posed, vehicle).x;

  // One frame carrying the whole second, and the clock back to one tick a frame
  // in a `finally`, so whatever follows starts from the pace the suite shares.
  h.pace(SPAN_TICKS);
  try {
    await h.advance(1);
  } finally {
    h.pace(1);
  }

  const after = h.snapshot();
  const afterX = vehicleOf(after, vehicle).x;
  // Before the assertions, so a failing frame still leaves the picture of the
  // strait it reached.
  captureStill(h, "after");

  assertCloseTo(
    after.simTime - posed.simTime,
    1,
    SIM_DIGITS,
    `the seconds of simulation time one frame carrying ${SPAN_TICKS} ticks of ` +
      `elapsed time accumulated, which TICK_HZ (${TICK_HZ}) ticks of TICK_DT ` +
      `are worth (specs/overview.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(afterX - posedX - TRAVEL_PER_SECOND),
    TRAVEL_TOLERANCE,
    `the stage units between where one frame carrying ${SPAN_TICKS} ticks ` +
      `carried a lane posed at ${LANE_SPEED} tiles per second and the ` +
      `${TRAVEL_PER_SECOND} units one second of game time is worth ` +
      `(specs/ice.md), which is the same ticks however the second is divided ` +
      `into frames (specs/instrumentation.md)`,
  );
});
