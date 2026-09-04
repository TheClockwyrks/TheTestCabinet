// Floe — instrumentation/deterministic-core: the simulation advances on the
// stepped time it is given and on nothing else, so one second of game time
// reaches the same state however that second was divided into calls.
//
// `specs/instrumentation.md` rests the whole surface on it, under A deterministic
// core: "every rate integrated in whole `TICK_DT` ticks, as `specs/overview.md`
// fixes, so an interval of game time reaches the same state however it was
// divided into frames", and "Game state advances from the elapsed time the game
// is handed, independent of a canvas, of the frame loop that measured it, and of
// wall-clock time. The dependency runs one way: the simulation reads nothing from
// the renderer." `advance(ticks)` says the same of the clock operation this
// engine alone carries: it "runs `ticks` whole simulation ticks immediately and
// in order, each exactly `TICK_DT`".
//
// SO THE SAME SECOND IS SPENT TWICE, ONE HUNDRED AND TWENTY WAYS APART. One run
// asks for the whole second in a single `advance(120)` — which is what
// `Harness.skip` makes, one call of the build's own clock operation covering the
// span; the other asks for it a tick at a time, in a hundred and twenty separate
// `advance(1)` calls made from this process, so real wall-clock time — tens of
// milliseconds of it, spread across a hundred and twenty round trips into the
// page, with the build's own animation frames running between them — passes
// inside the second the second run covers and not inside the first's. A build
// that integrates against `TICK_DT` reaches the same strait either way; a build
// that reads a clock of its own, or that advances once per CALL rather than once
// per tick, ends the two runs a long way apart.
//
// THE WITNESSES ARE THE EIGHT ICE LANES, WHICH IS WHAT THE ITEM READS. `simTime`
// says the ticks were counted; the vehicles say the strait was carried the same
// distance. One vehicle stands in every ice lane, so the reading is over eight
// different speeds and directions rather than one.
//
// WHAT THIS DOES NOT DECIDE. Not how far a vehicle should have travelled — only
// that both divisions travelled the same distance. `instrumentation/tick-length`
// grades the tick's own length and `ice/lane-speed` the figure each lane runs at.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { ICE_LANES, TICK_HZ, tileLeft, type VehicleKind } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The span of game time each run covers, in whole ticks: exactly one second. */
const SPAN_TICKS = TICK_HZ;

/** The same span in seconds, which is what the undivided run asks for. */
const SPAN_SECONDS = 1;

/** The left edge every posed vehicle starts at, in stage units. */
const START_X = tileLeft(4);

/**
 * How far a run's accumulated `simTime` may sit from the second it was given, as
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
 * How far apart the two divisions may leave one vehicle's left edge, in stage
 * units.
 *
 * A tenth of a unit, which is the figure this review item states, and about a
 * three-hundredth of a tile. The two runs differ only in the order a hundred and
 * twenty doubles are summed, which is parts in a quadrillion; a build reading
 * wall-clock time is out by the whole distance its lanes travelled while this
 * process was making its round trips.
 */
const MAX_DRIFT = 0.1;

/**
 * The least a vehicle must have moved over the second, in stage units.
 *
 * One unit. `specs/ice.md`'s slowest lane runs at `1.5` tiles per second, which
 * is `48` units in a second, so this is a thirtieth of the slowest figure the
 * specification names: a reading that the lanes moved at all, so "both runs
 * reached the same x" is a comparison rather than a tautology, and not a demand
 * for any particular speed.
 */
const MIN_TRAVEL = 1;

/** Every vehicle's left edge, by the row it stands on. */
function edgesByRow(snapshot: FloeSnapshot): Map<number, number> {
  return new Map(snapshot.vehicles.map((item) => [item.row, item.x]));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Pose one vehicle in every ice lane on an empty, quiet strait and spend one
 * second of game time on it, in one call or a tick at a time.
 *
 * `startCrossing` resets first, so `simTime` starts from zero and both runs are
 * posed identically before either is driven.
 */
async function spendTheSecond(
  harness: Harness,
  divided: boolean,
): Promise<{ before: FloeSnapshot; after: FloeSnapshot }> {
  await startCrossing(harness);
  for (const lane of ICE_LANES) {
    // `ICE_LANES` is typed by the shared lane table, whose `kind` spans both
    // bands; every ice lane carries a vehicle kind (specs/ice.md).
    await harness.debug.addVehicle(lane.row, lane.kind as VehicleKind, START_X);
  }
  const before = await harness.snapshot();
  if (divided) {
    for (let tick = 0; tick < SPAN_TICKS; tick += 1) await harness.advance(1);
  } else {
    // ONE call of `advance(120)`, which is what a skip is: the same ticks, asked
    // for together rather than one at a time.
    await harness.skip(SPAN_SECONDS);
  }
  return { before, after: await harness.snapshot() };
}

it("reaches the same strait whether a second is one call or a hundred and twenty", async () => {
  const whole = await spendTheSecond(h, false);
  const divided = await spendTheSecond(h, true);
  // Before the assertions, so a failing division still leaves the picture of the
  // strait the tick-by-tick second reached.
  await captureStill(h, "after");

  assertCloseTo(
    whole.after.simTime - whole.before.simTime,
    1,
    SIM_DIGITS,
    `the seconds of simulation time one advance(${SPAN_TICKS}) accumulated`,
  );
  assertCloseTo(
    divided.after.simTime - divided.before.simTime,
    1,
    SIM_DIGITS,
    `the seconds of simulation time ${SPAN_TICKS} separate advance(1) calls ` +
      `accumulated`,
  );

  const from = edgesByRow(whole.before);
  const wholeEdges = edgesByRow(whole.after);
  const dividedEdges = edgesByRow(divided.after);

  for (const lane of ICE_LANES) {
    const start = from.get(lane.row);
    const one = wholeEdges.get(lane.row);
    const many = dividedEdges.get(lane.row);
    assertEqual(
      typeof one,
      "number",
      `a vehicle still standing on ice row ${lane.row} after one ` +
        `advance(${SPAN_TICKS})`,
    );
    assertEqual(
      typeof many,
      "number",
      `a vehicle still standing on ice row ${lane.row} after ${SPAN_TICKS} ` +
        `separate advance(1) calls`,
    );

    // The witness moved, so "the same x" is a reading rather than a tautology.
    assertGreaterThan(
      Math.abs((one ?? Number.NaN) - (start ?? Number.NaN)),
      MIN_TRAVEL,
      `the stage units the vehicle on ice row ${lane.row} was carried over ` +
        `one second of game time`,
    );

    assertLessThanOrEqual(
      Math.abs((one ?? Number.NaN) - (many ?? Number.NaN)),
      MAX_DRIFT,
      `the stage units between where the vehicle on ice row ${lane.row} ` +
        `finished the second driven as one advance(${SPAN_TICKS}) and where ` +
        `it finished the same second driven as ${SPAN_TICKS} separate ` +
        `advance(1) calls`,
    );
  }
});
