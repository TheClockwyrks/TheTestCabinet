// hunter/swim-speed — a bear over open water covers two tiles a second.
//
// specs/hunter.md: `bearSwimSpeed(L) = BEAR_SWIM_SPEED * BEAR_SPEED_STEP ^ (L-1)`
// with `BEAR_SWIM_SPEED` (2) tiles per second, and a bear is swimming when the
// tile it is travelling INTO is on the water band and no floe covers it. A tile is
// `TILE` (32) units, so a level-1 bear swimming covers 64 stage units a second —
// two thirds of what the same bear covers on ice, which is what makes a build
// that runs one speed everywhere read as a different number here.
//
// The scenario is a water row emptied of floes, so every tile the bear steps into
// is open water and the footing under test holds for the whole measurement.
// `startCrossing` empties the floe roster; nothing is put back.
//
// The bear is posed with its sense and its routing off, so the reading is a rate
// and not a route, and it is stepped again on every tick it settles.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength } from "../assert";
import { TILE, bearSwimSpeed } from "../constants";
import {
  captureReplay,
  createHarness,
  itemsOnRow,
  poseBear,
  speedOverTicks,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { stepAcross } from "./harness";

/** A row of the water band, and where the run starts on it. */
const WATER_ROW = 6;
const FROM_COL = 5;

/** The level the figure is stated at. */
const LEVEL = 1;

/** The game time measured over. */
const MEASURE_SECONDS = 1;

/** The allowance the item states around the figure. */
const SPEED_TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("covers BEAR_SWIM_SPEED tiles of game time a second over open water", async () => {
  await startCrossing(h, LEVEL);
  const id = await poseBear(h, FROM_COL, WATER_ROW, {
    sense: false,
    routing: false,
  });

  // The scenario this check needs, read off the game itself: the row really is
  // open water. A floe anywhere on it would make the tiles it covers ice footing,
  // and the rate measured would be a mixture of the two speeds rather than this
  // one.
  assertLength(
    itemsOnRow(await h.snapshot(), WATER_ROW),
    0,
    `floes on water row ${WATER_ROW}, which is measured as open water`,
  );

  const ticks = ticksFor(MEASURE_SECONDS);
  const covered = await captureReplay(h, "swim", () =>
    stepAcross(h, id, "right", ticks),
  );

  const expected = bearSwimSpeed(LEVEL) * TILE;
  assertBetween(
    speedOverTicks(covered, ticks),
    expected * (1 - SPEED_TOLERANCE),
    expected * (1 + SPEED_TOLERANCE),
    `stage units a second swimming at level ${LEVEL}`,
  );
});
