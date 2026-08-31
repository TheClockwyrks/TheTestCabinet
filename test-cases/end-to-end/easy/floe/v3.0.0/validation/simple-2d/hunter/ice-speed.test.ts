// hunter/ice-speed — a bear on ice footing covers three tiles a second.
//
// specs/hunter.md: `bearIceSpeed(L) = BEAR_ICE_SPEED * BEAR_SPEED_STEP ^ (L - 1)`
// with `BEAR_ICE_SPEED` (3) tiles per second, and a tile is `TILE` (32) units, so
// a level-1 bear on ice covers 96 stage units of game time a second.
//
// THE SCENARIO IS THE MEDIAN, the one row of the strait that carries no lane at
// all: nothing can be on it and nothing can arrive on it, so what is measured is
// the bear's own rate and not the traffic's. The median is ice footing
// (specs/hunter.md lists it among them), which is exactly the footing under test.
//
// The bear is posed with its sense and its routing off, so it travels the axis
// this check steps it along and no route chooses a different tile — the reading is
// a RATE, not a route.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_MEDIAN, TILE, bearIceSpeed } from "../../src/constants";
import { assertBetween } from "../assert";
import {
  captureReplay,
  createHarness,
  poseBear,
  speedOverTicks,
  startCrossing,
  type Harness,
} from "../harness";
import { travelOverTicks } from "./harness";

/** Where the run starts. A tile of travel to the right stays well in bounds. */
const FROM_COL = 5;

/** The level the figure is stated at. */
const LEVEL = 1;

/**
 * The ticks the rate is measured over, which stay inside the one tile the bear
 * was stepped into.
 *
 * At `BEAR_ICE_SPEED` (3) tiles a second a tile is 40 ticks wide, so twenty ticks
 * is halfway across it and stays inside for a build up to twice too fast. Inside
 * the tile every tick is exactly `speed * TILE * TICK_DT` of travel, so the
 * reading is the specification's figure with no arithmetic in between — see
 * `travelOverTicks` for why a window that crossed a tile centre would be reading
 * a rule specs/ does not state. A build fast enough to settle inside the window
 * reads high rather than low, so nothing here can flatter one.
 */
const MEASURE_TICKS = 20;

/** The allowance the item states around the figure. */
const SPEED_TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("covers BEAR_ICE_SPEED tiles of game time a second across the median", async () => {
  startCrossing(h, LEVEL);
  const id = poseBear(h, FROM_COL, ROW_MEDIAN, {
    sense: false,
    routing: false,
  });

  const covered = await captureReplay(h, "glide", () =>
    travelOverTicks(h, id, "right", MEASURE_TICKS),
  );

  const expected = bearIceSpeed(LEVEL) * TILE;
  assertBetween(
    speedOverTicks(covered, MEASURE_TICKS),
    expected * (1 - SPEED_TOLERANCE),
    expected * (1 + SPEED_TOLERANCE),
    `stage units a second on ice at level ${LEVEL}`,
  );
});
