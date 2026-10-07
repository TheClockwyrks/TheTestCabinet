// instrumentation/carries-the-remainder — a frame whose elapsed time is not a
// whole number of ticks leaves its leftover for the next frame, so a run of
// uneven frames spends every millisecond it was handed.
//
// specs/overview.md fixes it: "The engine hands each frame a delta time and the
// simulation advances by the whole `TICK_DT` ticks that delta completes, carrying
// the remainder into the next frame, so the number of ticks run over an interval
// of game time is the same however that interval was divided into frames."
//
// THE FRAMES ARE UNEVEN AND NONE OF THEM IS A TICK. Every other point in this
// suite drives frames of one whole tick, where the leftover is always zero and a
// build that threw its leftover away answers exactly as one that kept it. The
// clock here delivers `5`, `11`, `7` and `23` millisecond frames over and over,
// against a tick of `8.33…` ms, so no frame completes a whole number of ticks and
// the leftover is what the run is made of. A build that keeps it runs the ticks
// the whole stretch is worth; a build that drops each frame's leftover runs three
// ticks per cycle where the stretch is worth five and a half, and lands little
// over half as far.
//
// THE WITNESSES ARE THE CLOCK AND ONE LANE. `simTime` says the ticks were
// counted; the vehicle says the strait was carried the distance those ticks are
// worth. specs/ice.md fixes it: "A lane at speed `s` and direction `d` moves
// every one of its vehicles by `d * s * TILE` units per second of game time".
//
// ONE TICK EITHER SIDE, BECAUSE THE STRETCH DOES NOT OPEN ON A TICK BOUNDARY. A
// build carries a leftover of its own into the first of these frames, worth
// anything under one tick, so the stretch completes either `FLOOR_TICKS` ticks or
// one more. Both are accepted, and the wrong answers this point is about are a
// third of the way off rather than a tick.
//
// WHAT THIS DOES NOT DECIDE. Not the tick's own length, which is
// instrumentation/tick-length's, not that the ticks are the same however a whole
// number of them is divided, which is instrumentation/render-free-core's, and not
// the figure any level's lane runs at, which is ice/lane-speeds's.

import { SequenceClock } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT, TILE, type LaneDir } from "../constants";
import { assertBetween } from "../assert";
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

/**
 * The frame the clock hands over, in milliseconds, cycling.
 *
 * Four uneven frames, none of them a whole tick of `8.33…` ms and none of them a
 * frame length any display happens to deliver. What they are is a host that
 * stutters, which is what the leftover rule exists for.
 */
const STEPS_MS = [5, 11, 7, 23];

/** How many of those frames the stretch runs: twenty-four cycles of the four. */
const FRAMES = 96;

/** What the stretch is worth altogether, in milliseconds. */
const STRETCH_MS = STEPS_MS.reduce((sum, step) => sum + step, 0) * 24;

/** And in whole ticks, from a build that opened the stretch with no leftover. */
const FLOOR_TICKS = Math.floor(STRETCH_MS / (TICK_DT * 1000));

/**
 * How far the accumulated `simTime` may sit from the ticks the stretch completes.
 *
 * Half a nanosecond, either side of a band a whole tick wide. A conforming build
 * adds `TICK_DT` a hundred and thirty-odd times, and the only distance from the
 * figure is the sum of that many doubles.
 */
const SIM_SLACK = 5e-10;

/**
 * How far the vehicle may finish from the units those ticks are worth, in stage
 * units.
 *
 * A tenth of a unit, about a three-hundredth of a tile, either side of the same
 * one-tick band. A build that drops its leftovers is short by twenty-nine units.
 */
const TRAVEL_TOLERANCE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new SequenceClock([...STEPS_MS]) });
});

afterEach(() => {
  h?.dispose();
});

it("spends a run of part-tick frames on the ticks their total completes", async () => {
  startCrossing(h);

  // One vehicle on an otherwise empty strait, in a lane posed at the speed and
  // direction this reading is taken against. `poseLane` stops the lane first, so
  // the vehicle lands exactly where it was put.
  const [vehicle] = poseLane(h, LANE_ROW, LANE_KIND, [START_COL]);
  h.debug.setLaneSpeed(LANE_ROW, LANE_SPEED);
  h.debug.setLaneDirection(LANE_ROW, LANE_DIR);

  const posed = h.snapshot();
  const posedX = vehicleOf(posed, vehicle).x;

  await h.advance(FRAMES);

  const after = h.snapshot();
  const afterX = vehicleOf(after, vehicle).x;
  // Before the assertions, so a failing stretch still leaves the picture of the
  // strait it reached.
  captureStill(h, "after");

  const leastSeconds = FLOOR_TICKS * TICK_DT;
  const mostSeconds = (FLOOR_TICKS + 1) * TICK_DT;
  assertBetween(
    after.simTime - posed.simTime,
    leastSeconds - SIM_SLACK,
    mostSeconds + SIM_SLACK,
    `the seconds of simulation time ${FRAMES} frames of ` +
      `${STEPS_MS.join(", ")} ms accumulated, which is the ${FLOOR_TICKS} ` +
      `whole ticks their ${STRETCH_MS} ms completes, or one more where the ` +
      `stretch opened with a leftover (specs/overview.md)`,
  );

  const travel = LANE_DIR * LANE_SPEED * TILE;
  assertBetween(
    afterX - posedX,
    travel * leastSeconds - TRAVEL_TOLERANCE,
    travel * mostSeconds + TRAVEL_TOLERANCE,
    `the stage units ${FRAMES} frames of ${STEPS_MS.join(", ")} ms carried a ` +
      `lane posed at ${LANE_SPEED} tiles per second, which specs/ice.md makes ` +
      `${travel} units for each second of game time those frames completed`,
  );
});
