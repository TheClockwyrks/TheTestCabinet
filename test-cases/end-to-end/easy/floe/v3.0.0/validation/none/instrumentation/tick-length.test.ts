// Floe — instrumentation/tick-length: a tick is a fixed `1/120` of a second, and
// a lane's motion is integrated against exactly that.
//
// `specs/overview.md` fixes the figure: "The simulation runs on a fixed timestep
// of `TICK_HZ` (`120`) steps per second, so one simulation tick, `TICK_DT`, is
// exactly `1/120` s. Every rate in this specification is per second and every
// duration is in seconds, and both are integrated in whole ticks of that
// length." `specs/instrumentation.md` gives the surface the operation that spends
// them — `advance(ticks)` "runs `ticks` whole simulation ticks immediately and in
// order, each exactly `TICK_DT`", so "`advance(120)` covers one second of game
// time" — and reports the total on `simTime`, which "adds `TICK_DT` on every
// tick whatever the screen".
//
// THE READING IS TAKEN TWICE, AT ONE TICK AND AT A HUNDRED AND TWENTY. `simTime`
// alone over a hundred and twenty ticks cannot tell a build whose tick is
// `1/120` s from one whose `advance` simply adds the seconds it was asked for
// without running any ticks at all — so a lane is read beside it, and a lane's
// travel is the game's own integration rather than a counter. `specs/ice.md`
// fixes it: "A lane at speed `s` and direction `d` moves every one of its
// vehicles by `d * s * TILE` units per second of game time", so a lane posed at
// `2.0` tiles per second carries its vehicle `64` units over one second and
// exactly a hundred and twentieth of that over one tick.
//
// THE SPEED IS POSED RATHER THAN TAKEN FROM THE TABLE. `2.0` tiles per second is
// `64` units a second and `0.5333…` units a tick, which no level-1 lane runs at
// (`specs/ice.md` gives row `12` `2.1`), so the reading is of the tick's length
// against a figure this check chose and not of the lane table. Which speed a lane
// is laid out at is `ice/lane-speed`'s.
//
// THE LANE IS POSED WELL INSIDE THE STRAIT. It starts ten tiles from the left
// edge and travels two more, so nothing about where a lane wraps — which the
// specification leaves to the build — can reach this reading.
//
// WHAT THIS DOES NOT DECIDE. Not that the game advances itself at all, which
// is `instrumentation/advances-in-real-time`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { TICK_DT, TICK_HZ, TILE } from "../constants";
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

/** What `specs/ice.md` makes that worth over a second, and over one tick. */
const TRAVEL_PER_SECOND = LANE_DIR * LANE_SPEED * TILE;
const TRAVEL_PER_TICK = TRAVEL_PER_SECOND / TICK_HZ;

/**
 * How far the accumulated `simTime` may sit from the seconds those ticks are
 * worth, as `assertCloseTo` digits.
 *
 * Nine digits is half a nanosecond. `TICK_DT` is `1/120`, which is not exact in
 * binary, so a clock summed tick by tick lands a few parts in a quadrillion from
 * the figure — this is that arithmetic and nothing else. A build running its
 * simulation at sixty steps a second reports half.
 */
const SIM_DIGITS = 9;

/**
 * How far the lane's travel may sit from the units it is worth, as
 * `assertCloseTo` digits.
 *
 * Six digits is half a millionth of a stage unit, some twenty-millionths of a
 * tile. A hundred and twenty additions of `0.5333…` land parts in a quadrillion
 * from `64`; a build whose tick is any other length misses by whole units.
 */
const TRAVEL_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spends exactly one one-hundred-and-twentieth of a second per tick", async () => {
  await startCrossing(h);

  // One vehicle on an otherwise empty strait, in a lane posed at the speed and
  // direction this reading is taken against. `poseLane` stops the lane first, so
  // the vehicle lands exactly where it was put.
  const [vehicle] = await poseLane(h, LANE_ROW, LANE_KIND, [START_COL]);
  await h.debug.setLaneSpeed(LANE_ROW, LANE_SPEED);
  await h.debug.setLaneDirection(LANE_ROW, LANE_DIR);

  const posed = await h.snapshot();
  const posedX = requireItem(posed, vehicle, "the posed lane").x;

  await h.advance(1);
  const oneTick = await h.snapshot();
  const oneTickX = requireItem(oneTick, vehicle, "one tick of the lane").x;

  // ONE call of `advance(120)`, which is what a skip is: the specification's
  // own claim that "`advance(120)` covers one second of game time" is about the
  // call rather than about a hundred and twenty of them.
  await h.skip(1);
  const oneSecond = await h.snapshot();
  const oneSecondX = requireItem(
    oneSecond,
    vehicle,
    "one second of the lane",
  ).x;
  // Before the assertions, so a failing tick still leaves the picture of the
  // strait it produced.
  await captureStill(h, "after");

  assertCloseTo(
    oneTick.simTime - posed.simTime,
    TICK_DT,
    SIM_DIGITS,
    `the seconds of simulation time advance(1) accumulated, against TICK_DT ` +
      `(1/${TICK_HZ} s, specs/overview.md)`,
  );
  assertCloseTo(
    oneTickX - posedX,
    TRAVEL_PER_TICK,
    TRAVEL_DIGITS,
    `the stage units advance(1) carried a lane posed at ${LANE_SPEED} tiles ` +
      `per second — one tick of ${TRAVEL_PER_SECOND} units a second ` +
      `(specs/ice.md)`,
  );

  assertCloseTo(
    oneSecond.simTime - oneTick.simTime,
    1,
    SIM_DIGITS,
    `the seconds of simulation time advance(${TICK_HZ}) accumulated, which ` +
      `TICK_HZ (${TICK_HZ}) ticks of TICK_DT are worth (specs/overview.md)`,
  );
  assertCloseTo(
    oneSecondX - oneTickX,
    TRAVEL_PER_SECOND,
    TRAVEL_DIGITS,
    `the stage units advance(${TICK_HZ}) carried a lane posed at ` +
      `${LANE_SPEED} tiles per second, which specs/ice.md makes ` +
      `${LANE_SPEED} * ${TILE} = ${TRAVEL_PER_SECOND} units per second of ` +
      `game time`,
  );
});
