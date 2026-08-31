// hunter/swim-speed — a bear over open water covers two tiles a second.
//
// specs/hunter.md: `bearSwimSpeed(L) = BEAR_SWIM_SPEED * BEAR_SPEED_STEP ^ (L-1)`
// with `BEAR_SWIM_SPEED` (2) tiles per second, and a bear is swimming when the
// tile it is travelling INTO is on the water band and no floe covers it. A tile is
// `TILE` (32) units, so a level-1 bear swimming covers 64 stage units a second —
// two thirds of what the same bear covers on ice, which is what makes a build
// that runs one speed everywhere read as a different number here.
//
// The scenario is a water row emptied of floes, so the tile the bear steps into is
// open water and the footing under test holds for the whole measurement.
// `startCrossing` empties the floe roster; nothing is put back.
//
// The bear is posed with its sense and its routing off, so the reading is a rate
// and not a route.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, bearSwimSpeed } from "../../src/constants";
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

/** A row of the water band, and where the run starts on it. */
const WATER_ROW = 6;
const FROM_COL = 5;

/** The level the figure is stated at. */
const LEVEL = 1;

/**
 * The ticks the rate is measured over, which stay inside the one tile the bear
 * was stepped into.
 *
 * At `BEAR_SWIM_SPEED` (2) tiles a second a tile is 60 ticks wide, so twenty ticks
 * is a third of the way across it. `ice-speed` states the rest of the reasoning:
 * inside the tile the reading is exact, and a build fast enough to settle inside
 * the window reads high rather than low.
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

it("covers BEAR_SWIM_SPEED tiles of game time a second over open water", async () => {
  startCrossing(h, LEVEL);
  const id = poseBear(h, FROM_COL, WATER_ROW, {
    sense: false,
    routing: false,
  });

  const covered = await captureReplay(h, "swim", () =>
    travelOverTicks(h, id, "right", MEASURE_TICKS),
  );

  const expected = bearSwimSpeed(LEVEL) * TILE;
  assertBetween(
    speedOverTicks(covered, MEASURE_TICKS),
    expected * (1 - SPEED_TOLERANCE),
    expected * (1 + SPEED_TOLERANCE),
    `stage units a second swimming at level ${LEVEL}`,
  );
});
