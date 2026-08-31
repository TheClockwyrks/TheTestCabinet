// Meltdown — instrumentation/deterministic-core: the simulation advances on
// elapsed time alone.
//
// specs/instrumentation.md, A deterministic core: "every rate integrated against
// the game time each frame advances by, so an interval of game time reaches the
// same state however it was divided into frames", and "Render-free core. Game
// state advances from the elapsed time the game is handed, independent of a
// canvas, of the frame loop that measured it, and of wall-clock time. The
// dependency runs one way: the simulation reads nothing from the renderer."
// specs/waves.md states the same rule of the run: "The game advances by the
// elapsed time of every frame ... so an interval of game time reaches the same
// state however it was divided into frames."
//
// ONE SECOND, DIVIDED TWO WAYS, ON TWO CLOCKS. The same second is covered as a
// single frame worth `1000` ms and as a hundred and twenty frames worth
// `1000 / 120` ms each. Nothing about the game is posed differently between the
// two: the same run, the same unit, the same tile. Only the division of the
// second changes, and the specification says the division may not matter.
//
// TWO READINGS, AND THEY FAIL DIFFERENT DEFECTS.
//
//   - `simTime` must gain `1.0` on both. It "accumulates the game time the
//     simulation advanced by" (specs/instrumentation.md), so a build that
//     advances by a fixed step per frame rather than by the elapsed time it was
//     handed reads `120` times too little on the single frame, or a hundred and
//     twenty times too much on the divided one.
//   - The unit must be in the SAME PLACE. A Mote walking an open row travels
//     `60` logical units in that second (specs/surge.md), and the wrong model
//     worth naming is the one that moves a unit at most to the next tile centre
//     per frame: it covers one `TILE` (`19` units) on the single frame and the
//     whole `60` on the divided one, which is `41` units apart — eighty times the
//     bound below.
//
// THE ROW IS OPEN AND THE ROUTE IS STRAIGHT. The walker is posed five tiles into
// the left corridor, whose route to the right exhaust runs straight east across
// an empty floor (specs/floor.md, specs/mazing.md), so the second's travel is a
// walk in one direction with no turn in it — which is what makes two divisions of
// it comparable at all, rather than comparing where two builds rounded a corner.
//
// AND NEITHER LEG IS SETTLED FIRST. A settling frame would be worth a different
// amount of game time on each clock, so the two legs would no longer be covering
// the same second.

import { ConstantClock } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLessThanOrEqual } from "../assert";
import {
  TICK_HZ,
  TICK_MS,
  captureStill,
  createHarness,
  startRun,
  unitOf,
  type Harness,
} from "../harness";
import { WALK, poseWalkerOn } from "./scenes";

/** The second the two legs divide, in milliseconds. */
const SECOND_MS = 1000;

/**
 * How closely the two divisions must agree on where the unit ended, in logical
 * units.
 *
 * Half a unit, which is `0.8%` of the `60` logical units a Mote covers in that
 * second (specs/surge.md). A conforming build's two legs differ only by the
 * representation of a hundred and twenty deltas summing to the one — many orders
 * of magnitude below this — while the nearest wrong model, a unit that advances
 * at most one tile per frame, lands `41` units short on the single frame.
 */
const POSITION_UNITS = 0.5;

/**
 * How closely each leg's `simTime` must gain the second, as decimal places.
 *
 * Six places is `5e-7`. The gain is a sum of deltas the clock reported exactly,
 * so a conforming build has nothing to lose but the representation of the sum.
 */
const CLOCK_DIGITS = 6;

/** Where each leg's walker ended, and what its clock gained getting there. */
interface Leg {
  x: number;
  y: number;
  clockGain: number;
}

/** Pose the walk on `harness` and cover one second in `frames` frames. */
async function coverASecond(harness: Harness, frames: number): Promise<Leg> {
  startRun(harness);
  const walker = poseWalkerOn(harness, "mote", WALK.col, WALK.row);
  const opened = harness.snapshot();
  await harness.advance(frames);
  const closed = harness.snapshot();
  const unit = unitOf(closed, walker);
  return {
    x: unit.x,
    y: unit.y,
    clockGain: closed.simTime - opened.simTime,
  };
}

/** The default harness IS the divided leg: its clock is `TICK_HZ` frames a second. */
let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("covers one second identically as one frame and as 120", async () => {
  // The divided second, on the suite's own clock.
  const divided = await coverASecond(h, TICK_HZ);
  captureStill(h, "advanced");

  // The same second as a single frame, on a clock of its own.
  const single = await createHarness({ clock: new ConstantClock(SECOND_MS) });
  let whole: Leg;
  try {
    whole = await coverASecond(single, 1);
  } finally {
    single.dispose();
  }

  assertCloseTo(
    whole.clockGain,
    SECOND_MS / 1000,
    CLOCK_DIGITS,
    "simTime gained by one second covered as a single frame",
  );
  assertCloseTo(
    divided.clockGain,
    (TICK_HZ * TICK_MS) / 1000,
    CLOCK_DIGITS,
    `simTime gained by one second covered as ${TICK_HZ} frames`,
  );

  assertLessThanOrEqual(
    Math.abs(whole.x - divided.x),
    POSITION_UNITS,
    "logical units between where the two divisions left the walker: x",
  );
  assertLessThanOrEqual(
    Math.abs(whole.y - divided.y),
    POSITION_UNITS,
    "logical units between where the two divisions left the walker: y",
  );
});
