// ice/gap-widens-with-level — every ice lane's gap widens by one tile every
// third level.
//
// specs/ice.md fixes the rule as arithmetic:
//
//     laneGap(row, L) = gap(row) + floor((L - 1) / LEVEL_GAP_EVERY)
//
// with `LEVEL_GAP_EVERY` at `3`, and states the consequence in words: "every
// lane's gap widens by one tile from level `4` and by two tiles from level `7`".
// `setLevel(n)` lays the sixteen lanes out for the level
// (specs/instrumentation.md), so the roster it produces is exactly what this
// reads.
//
// LEVELS 1, 4 AND 7 ARE THE THREE THAT DISTINGUISH THE WRONG MODELS, because
// they are the first level of each of the first three steps. A build that
// widened EVERY level reads one tile too wide at level 4 and four tiles too wide
// at level 7; one that widened every third level starting from level 3 reads a
// tile too wide at 4 and a tile too wide at 7; one that never widened reads the
// base gap at both. Each of those is a whole tile or more from the figure, and
// the bound below is a tenth of a tile.
//
// The measurement is `ice/lane-gaps`'s: the clear ice from one vehicle's right
// edge to the next vehicle's left edge, taken between consecutive vehicles along
// the row.

import { afterEach, beforeEach, it } from "vitest";
import { ICE_LANES, laneGap } from "../constants";
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
 * How far a run of clear ice may sit from the level's figure, in TILES.
 *
 * The tenth of a tile the item is stated at. A gap is a WHOLE number of tiles at
 * every level, so every wrong model of the widening is at least a whole tile
 * away, which this bound is a tenth of.
 */
const GAP_TOLERANCE_TILES = 0.1;

/** One lane's clear ice at one level. */
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

it("widens every ice lane's gap by floor((level - 1) / 3) tiles, at levels 1, 4 and 7", async () => {
  const readings: LevelReading[] = [];
  for (const level of LEVELS) {
    const laid = await layOutLevel(h, level);
    for (const lane of ICE_LANES) {
      const carried = itemsInRow(laid.vehicles, lane.row);
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
      `${where}: vehicles enough to leave a run of clear ice between two of ` +
        "them (specs/ice.md)",
    );
    for (const [index, run] of reading.runs.entries()) {
      assertLessThanOrEqual(
        Math.abs(run - expected),
        GAP_TOLERANCE_TILES,
        `${where}, between vehicles ${index} and ${index + 1}: the clear ice ` +
          `away from ${expected} tiles, was ${run}`,
      );
    }
  }
});
