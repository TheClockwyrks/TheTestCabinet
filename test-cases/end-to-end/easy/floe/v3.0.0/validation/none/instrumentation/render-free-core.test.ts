// Floe — instrumentation/render-free-core: the simulation advances on the
// stepped time it is handed and on nothing else, so one second of game time
// spent a tick at a time, with real time passing between the ticks, runs the
// same ticks as one spent in a single call.
//
// `specs/instrumentation.md` rests the whole surface on it, under A render-free
// core: game state advances "from the elapsed simulation time the game is
// handed, in whole `TICK_DT` ticks as `specs/overview.md` fixes, with no canvas
// and no wall clock", and "the number of ticks run over an interval of game
// time is the same however that interval was divided into frames".
// `advance(ticks)` says the same of the clock operation this engine alone
// carries: it "runs `ticks` whole simulation ticks immediately and in order,
// each exactly `TICK_DT`".
//
// SO THE SECOND IS SPENT IN THE DIVISION NO OTHER POINT DRIVES. A hundred and
// twenty separate `advance(1)` calls made from this process, so real wall-clock
// time — tens of milliseconds of it, spread across a hundred and twenty round
// trips into the page, with the build's own animation frames running between
// them — passes inside the second. `instrumentation/tick-length` spends its
// second as ONE `advance(120)`, where no real time passes inside it. A build
// that integrates against `TICK_DT` carries its lanes the figure
// `specs/ice.md` states either way; a build that reads a clock of its own, or
// that advances once per CALL rather than once per tick, lands a long way from
// it.
//
// THE WITNESSES ARE THE CLOCK AND ONE LANE. `simTime` says the ticks were
// counted; the vehicle says the strait was carried the distance those ticks
// are worth. `specs/ice.md` fixes it: "A lane at speed `s` and direction `d`
// moves every one of its vehicles by `d * s * TILE` units per second of game
// time", so a lane posed at `2.0` tiles per second carries its vehicle `64`
// units over the second, read within a tenth of a unit, which is the figure
// this review item states.
//
// WHAT THIS DOES NOT DECIDE. Not the tick's own length, which is
// `instrumentation/tick-length`'s, and not the figure any level's lane runs
// at, which is `ice/lane-speeds`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLessThanOrEqual } from "../assert";
import { TICK_HZ, TILE } from "../constants";
import {
  captureStill,
  createHarness,
  poseLane,
  requireItem,
  startCrossing,
  type Harness,
} from "../harness";

/** The lane the reading is taken on, and the vehicle standing in it. */
const LANE_ROW = 12;
const LANE_KIND = "car" as const;
const START_COL = 10;

/** The motion posed onto it: rightward, at two tiles a second. */
const LANE_SPEED = 2;
const LANE_DIR = 1;

/** What `specs/ice.md` makes that worth over one second of game time. */
const TRAVEL_PER_SECOND = LANE_DIR * LANE_SPEED * TILE;

/** The span of game time the run covers, in whole ticks: exactly one second. */
const SPAN_TICKS = TICK_HZ;

/**
 * How far the accumulated `simTime` may sit from the second it was given, as
 * `assertCloseTo` digits.
 *
 * Nine digits is half a nanosecond. A conforming build adds `TICK_DT` a hundred
 * and twenty times and the only distance from `1.0` is the sum of a hundred and
 * twenty doubles — this is that arithmetic, not room for a different reading of
 * the rule. A build advancing once per CALL rather than once per tick reports
 * `1/120` of it.
 */
const SIM_DIGITS = 9;

/**
 * How far the vehicle may finish from the units the second is worth, in stage
 * units.
 *
 * A tenth of a unit, which is the figure this review item states, and about a
 * three-hundredth of a tile. A hundred and twenty additions of `0.5333…` land
 * parts in a quadrillion from `64`; a build reading wall-clock time is out by
 * the whole distance its lane travelled while this process was making its
 * round trips.
 */
const TRAVEL_TOLERANCE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries a lane one second's worth over a second spent a tick at a time", async () => {
  await startCrossing(h);

  // One vehicle on an otherwise empty strait, in a lane posed at the speed and
  // direction this reading is taken against. `poseLane` stops the lane first, so
  // the vehicle lands exactly where it was put.
  const [vehicle] = await poseLane(h, LANE_ROW, LANE_KIND, [START_COL]);
  await h.debug.setLaneSpeed(LANE_ROW, LANE_SPEED);
  await h.debug.setLaneDirection(LANE_ROW, LANE_DIR);

  const posed = await h.snapshot();
  const posedX = requireItem(posed, vehicle, "the posed lane").x;

  // A hundred and twenty separate calls, each returning to this process before
  // the next is made, so the build's own frames and real time run between them.
  for (let tick = 0; tick < SPAN_TICKS; tick += 1) await h.advance(1);

  const after = await h.snapshot();
  const afterX = requireItem(after, vehicle, "the lane after the second").x;
  // Before the assertions, so a failing division still leaves the picture of
  // the strait the tick-by-tick second reached.
  await captureStill(h, "after");

  assertCloseTo(
    after.simTime - posed.simTime,
    1,
    SIM_DIGITS,
    `the seconds of simulation time ${SPAN_TICKS} separate advance(1) calls ` +
      `accumulated, which TICK_HZ (${TICK_HZ}) ticks of TICK_DT are worth ` +
      `(specs/overview.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(afterX - posedX - TRAVEL_PER_SECOND),
    TRAVEL_TOLERANCE,
    `the stage units between where ${SPAN_TICKS} separate advance(1) calls ` +
      `carried a lane posed at ${LANE_SPEED} tiles per second and the ` +
      `${TRAVEL_PER_SECOND} units one second of game time is worth ` +
      `(specs/ice.md), which is the same ticks however the second is divided ` +
      `(specs/instrumentation.md)`,
  );
});
