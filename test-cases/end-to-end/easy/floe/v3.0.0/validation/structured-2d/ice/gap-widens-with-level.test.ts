// Floe — ice/gap-widens-with-level: every ice lane's gap widens by one tile
// every third level.
//
// specs/ice.md fixes the rule as arithmetic:
//
//     laneGap(row, L) = gap(row) + floor((L - 1) / LEVEL_GAP_EVERY)
//
// with `LEVEL_GAP_EVERY` at `3`, and states the consequence in words: "every
// lane's gap widens by one tile from level `4` and by two tiles from level `7`".
// `setLevel(n)` lays the strait out for the level, so the roster it produces is
// exactly what this reads.
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
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { ICE_LANES, TILE, laneGap } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { clearIceRuns, layOutLevel, vehiclesAlong } from "./harness";

/** The three levels read: the first level of each of the first three steps. */
const LEVELS = [1, 4, 7];

/**
 * How far a run of clear ice may sit from the level's figure, in stage units.
 *
 * The tenth of a tile the item is stated at, `0.1 * TILE`. A gap is a WHOLE
 * number of tiles at every level, so every wrong model of the widening is at
 * least a whole tile — `32` units — away, which this bound is a tenth of.
 */
const GAP_TOLERANCE = 0.1 * TILE;

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
  h.dispose();
});

it("widens every ice lane's gap by floor((level - 1) / 3) tiles, at levels 1, 4 and 7", async () => {
  const readings: LevelReading[] = [];
  for (const level of LEVELS) {
    const laid = await layOutLevel(h, level);
    for (const lane of ICE_LANES) {
      readings.push({
        level,
        row: lane.row,
        count: vehiclesAlong(laid, lane.row).length,
        runs: clearIceRuns(laid, lane.row),
      });
    }
  }
  captureStill(h, "scene");

  for (const reading of readings) {
    const where = `level ${reading.level}, row ${reading.row}`;
    const tiles = laneGap(reading.row, reading.level);
    const expected = tiles * TILE;

    assertGreaterThanOrEqual(
      reading.count,
      2,
      `${where}: vehicles enough to leave a run of clear ice between two of ` +
        `them (specs/ice.md)`,
    );
    for (const [index, run] of reading.runs.entries()) {
      assertLessThanOrEqual(
        Math.abs(run - expected),
        GAP_TOLERANCE,
        `${where}, between vehicles ${index} and ${index + 1}: the clear ice ` +
          `away from ${expected} units (${tiles} tiles), was ${run}`,
      );
    }
  }
});
