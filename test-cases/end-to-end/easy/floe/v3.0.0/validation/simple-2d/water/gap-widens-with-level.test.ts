// water/gap-widens-with-level — every water lane's gap widens by one tile every
// third level.
//
// specs/water.md fixes the rule as arithmetic:
//
//     laneGap(row, L) = gap(row) + floor((L - 1) / LEVEL_GAP_EVERY)
//
// with `LEVEL_GAP_EVERY` at `3`, the same figures the ice band scales by.
// `setLevel(n)` lays the sixteen lanes out for the level
// (specs/instrumentation.md), so the roster it produces is exactly what this
// reads. A widening gap is what keeps a faster lane crossable, so the widening
// and the speeding up are read as separate items and fail separately.
//
// LEVELS 1, 4 AND 7 ARE THE THREE THAT DISTINGUISH THE WRONG MODELS, because
// they are the first level of each of the first three steps. A build that
// widened EVERY level reads one tile too wide at level 4 and four tiles too wide
// at level 7; one that widened every third level starting from level 3 reads a
// tile too wide at 4 and a tile too wide at 7; one that never widened reads the
// base gap at both. Each of those is a whole tile or more from the figure, and
// the bound below is a tenth of a tile.
//
// The measurement is `water/lane-gaps`'s: the open water from one floe's right
// edge to the next floe's left edge, taken between consecutive floes along the
// row.

import { afterEach, beforeEach, it } from "vitest";
import { laneGap, WATER_LANES } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  gapsBetween,
  itemsInRow,
  type Harness,
} from "../harness";
import { layOutLevel } from "./harness";

/** The three levels read: the first level of each of the first three steps. */
const LEVELS = [1, 4, 7];

/**
 * How far a run of open water may sit from the level's figure, in TILES.
 *
 * The tenth of a tile the item is stated at. A gap is a WHOLE number of tiles at
 * every level, so every wrong model of the widening is at least a whole tile
 * away, which this bound is a tenth of.
 */
const GAP_TOLERANCE_TILES = 0.1;

/** One lane's open water at one level. */
interface LevelReading {
  level: number;
  row: number;
  count: number;
  runs: number[];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("widens every water lane's gap by floor((level - 1) / 3) tiles, at levels 1, 4 and 7", async () => {
  const readings: LevelReading[] = [];
  for (const level of LEVELS) {
    const laid = await layOutLevel(h, level);
    for (const lane of WATER_LANES) {
      const carried = itemsInRow(laid.floes, lane.row);
      readings.push({
        level,
        row: lane.row,
        count: carried.length,
        runs: gapsBetween(carried),
      });
    }
  }
  captureStill(h, "scene");

  for (const reading of readings) {
    const where = `level ${reading.level}, row ${reading.row}`;
    const expected = laneGap(reading.row, reading.level);

    assertGreaterThanOrEqual(
      reading.count,
      2,
      `${where}: floes enough to leave a run of open water between two of ` +
        "them (specs/water.md)",
    );
    for (const [index, run] of reading.runs.entries()) {
      assertLessThanOrEqual(
        Math.abs(run - expected),
        GAP_TOLERANCE_TILES,
        `${where}, between floes ${index} and ${index + 1}: the open water ` +
          `away from ${expected} tiles, was ${run}`,
      );
    }
  }
});
